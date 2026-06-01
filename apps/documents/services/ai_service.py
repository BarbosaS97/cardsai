import json
import time
import logging
from openai import OpenAI
from django.conf import settings

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 70_000

SYSTEM_PROMPT = (
    'Você é um especialista em criação de material educacional. '
    'Gere materiais de estudo completos em português brasileiro. '
    'Retorne sempre um JSON válido e completo seguindo exatamente a estrutura solicitada.'
)

USER_PROMPT = """\
Analise o texto abaixo (extraído de um PDF) e gere materiais de estudo.

Gere EXATAMENTE:
- 50 questões de múltipla escolha com 4 opções (A, B, C, D)
- 100 flashcards (frente e verso)

Retorne APENAS um objeto JSON com esta estrutura (sem markdown, sem texto extra):
{{
  "summary": "Resumo do conteúdo em 2-3 parágrafos",
  "topics": ["Tópico 1", "Tópico 2", "Tópico 3"],
  "questions": [
    {{
      "question": "Enunciado da questão",
      "option_a": "Primeira opção",
      "option_b": "Segunda opção",
      "option_c": "Terceira opção",
      "option_d": "Quarta opção",
      "correct_option": "a",
      "explanation": "Explicação detalhada de por que esta resposta está correta",
      "topic": "Nome do tópico",
      "difficulty": "easy"
    }}
  ],
  "flashcards": [
    {{
      "front": "Pergunta ou conceito",
      "back": "Resposta ou definição completa",
      "topic": "Nome do tópico"
    }}
  ]
}}

TEXTO DO DOCUMENTO:
{text}
"""


def generate_study_materials(text: str) -> dict:
    text = _prepare_text(text)
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    for attempt in range(3):
        try:
            logger.info(f'OpenAI attempt {attempt + 1}/3 | model={settings.OPENAI_MODEL}')
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': USER_PROMPT.format(text=text)},
                ],
                response_format={'type': 'json_object'},
                temperature=0.7,
                max_tokens=16000,
                timeout=180,
            )
            result = json.loads(response.choices[0].message.content)
            _validate(result)
            logger.info(
                f'Geração OK: {len(result["questions"])} questões, '
                f'{len(result["flashcards"])} flashcards'
            )
            return result

        except json.JSONDecodeError as e:
            logger.error(f'JSON parse error (attempt {attempt + 1}): {e}')
            if attempt == 2:
                raise ValueError('Erro ao interpretar resposta da IA. Tente novamente.')
            time.sleep(2 ** attempt)

        except Exception as e:
            logger.error(f'OpenAI error (attempt {attempt + 1}): {e}')
            if attempt == 2:
                raise
            wait = 60 if 'rate_limit' in str(e).lower() else 2 ** attempt
            time.sleep(wait)

    raise ValueError('Falha após 3 tentativas.')


def _prepare_text(text: str) -> str:
    if len(text) <= MAX_TEXT_CHARS:
        return text
    # Amostra início + meio + fim para cobrir todo o conteúdo
    chunk = MAX_TEXT_CHARS // 3
    mid = len(text) // 2
    return (
        text[:chunk]
        + '\n\n[... conteúdo intermediário omitido por limite de tokens ...]\n\n'
        + text[mid - chunk // 2: mid + chunk // 2]
        + '\n\n[... conteúdo final omitido por limite de tokens ...]\n\n'
        + text[-chunk:]
    )


def _validate(result: dict) -> None:
    for key in ('summary', 'topics', 'questions', 'flashcards'):
        if key not in result:
            raise ValueError(f"Campo '{key}' ausente na resposta da IA.")
    if len(result['questions']) < 10:
        raise ValueError(
            f"IA gerou apenas {len(result['questions'])} questões (mínimo esperado: 10)."
        )
    if len(result['flashcards']) < 20:
        raise ValueError(
            f"IA gerou apenas {len(result['flashcards'])} flashcards (mínimo esperado: 20)."
        )
    required_q = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option']
    for i, q in enumerate(result['questions'][:3]):
        for field in required_q:
            if field not in q:
                raise ValueError(f"Campo '{field}' ausente na questão {i + 1}.")
