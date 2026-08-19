import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set([
  'https://cardsquestoes.com.br',
  'https://www.cardsquestoes.com.br',
])

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://cardsquestoes.com.br',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

const MAX_PDF_TEXT_LENGTH = 500_000 // 500 KB de texto

export const timeout = 600000

function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.substring(start, i + 1)
    }
  }
  return null
}

function cleanText(raw: string): string {
  let t = raw
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/t\.me\/[^\s]*/gi, '')
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/(canal\s+de\s+telegram|grupo\s+de\s+whatsapp|entre\s+no\s+(canal|grupo)|siga\s+(o\s+)?canal|clique\s+aqui|inscreva[- ]se|compartilhe|acesse\s+o\s+link|siga[- ]nos|ingresse\s+neste\s+canal)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Remove linhas repetidas mais de 3 vezes (cabeçalhos/rodapés de página)
  const lines = t.split('\n')
  const counts = new Map<string, number>()
  for (const l of lines) {
    const k = l.trim().toLowerCase()
    if (k.length > 15) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return lines
    .filter(l => {
      const k = l.trim().toLowerCase()
      return k.length <= 15 || (counts.get(k) ?? 0) <= 3
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const JUNK_RE = [/https?:\/\//i, /t\.me\//i, /telegram/i, /whatsapp/i, /inscreva[- ]se/i, /clique\s+aqui/i, /siga[- ]nos/i, /canal\s+de/i]
function isJunk(text: string): boolean {
  return JUNK_RE.some(p => p.test(text))
}

function normalizeAltText(alt: string): string {
  return String(alt).replace(/^[A-E]\)\s*/, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function hasDuplicateAlternatives(alternatives: string[]): boolean {
  const seen = new Set<string>()
  for (const alt of alternatives) {
    const key = normalizeAltText(alt)
    if (!key || seen.has(key)) return true
    seen.add(key)
  }
  return false
}

// Valida estrutura da questão: alternativas presentes, não-vazias, todas distintas entre si,
// e gabarito apontando para uma alternativa que realmente existe. Trunca ao altCount se necessário.
// Retorna false se qualquer verificação falhar — a questão deve ser descartada.
function sanitizeAndValidateQuestion(q: any, altCount: number): boolean {
  if (!Array.isArray(q.alternatives) || q.alternatives.length < 4) return false
  if (!q.alternatives.every((a: any) => typeof a === 'string' && normalizeAltText(a).length > 3)) return false

  if (q.alternatives.length > altCount) {
    q.alternatives = q.alternatives.slice(0, altCount)
  }

  if (hasDuplicateAlternatives(q.alternatives)) return false

  const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, q.alternatives.length)
  if (!letters.includes(q.correct_answer)) return false

  return true
}

function loadApiKeys(): string[] {
  const keys: string[] = []
  for (let i = 1; i <= 10; i++) {
    const k = Deno.env.get(`DEEPSEEK_API_KEY_${i}`)
    if (k) keys.push(k)
  }
  if (keys.length === 0) {
    const legacy = Deno.env.get('DEEPSEEK_API_KEY')
    if (legacy) keys.push(legacy)
  }
  return keys
}

let _rrIndex = 0

async function callDeepSeek(
  keys: string[],
  messages: { role: string; content: string }[],
  maxTokens: number,
  temperature = 0.3,
): Promise<string> {
  const startIdx = _rrIndex++ % keys.length
  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % keys.length
    const apiKey = keys[keyIdx]
    const keyLabel = `KEY_${keyIdx + 1}`
    console.log(`🔑 DeepSeek ${keyLabel}`)
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages, temperature, max_tokens: maxTokens }),
    })
    if (res.status === 429) {
      console.warn(`⚠️ ${keyLabel} rate limit (429) — tentando próxima chave`)
      continue
    }
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`DeepSeek ${keyLabel} HTTP ${res.status}: ${txt.substring(0, 200)}`)
    }
    const data = await res.json()
    return data.choices[0].message.content as string
  }
  throw new Error('Todas as chaves DeepSeek estão com rate limit (429)')
}

interface ModeConfig {
  alternativesCount: number
  questionStyle: string
  flashcardStyle: string
  pegadinhas: string
}

interface DifficultyConfig {
  label: string
  questionDepth: string
  distractorStrategy: string
  flashcardDepth: string
  systemSuffix: string
}

const difficultyConfig: Record<string, DifficultyConfig> = {
  facil: {
    label: 'Fácil',
    questionDepth:
      'Crie questões SIMPLES E DIRETAS sobre conceitos fundamentais. Uma questão = um conceito claro. Pergunte definições, identificações e fatos objetivos presentes explicitamente no texto. Evite qualquer ambiguidade ou inferência.',
    distractorStrategy:
      'Alternativas incorretas devem ser CLARAMENTE ERRADAS para quem leu o texto com atenção básica. NÃO use pegadinhas. Cada incorreta deve ser facilmente refutável com uma frase direta do texto.',
    flashcardDepth:
      'Definições simples e diretas. Uma ideia por flashcard. Linguagem acessível ao iniciante no assunto.',
    systemSuffix:
      'NÍVEL FÁCIL: priorize clareza absoluta. Questões básicas sem ambiguidade, testando conhecimento direto e explícito do texto.',
  },
  medio: {
    label: 'Médio',
    questionDepth:
      'Crie questões que exigem COMPREENSÃO e APLICAÇÃO. Misture questões diretas com questões que relacionam dois conceitos ou exigem inferência a partir do texto. Não pergunte apenas o que está explícito — exija interpretação.',
    distractorStrategy:
      'Alternativas incorretas devem ser PLAUSÍVEIS para quem estudou superficialmente, diferindo da correta em pelo menos um detalhe específico. Algumas alternativas podem ser "quase corretas".',
    flashcardDepth:
      'Definição completa com contexto e exemplos. Inclua relações entre conceitos quando relevante.',
    systemSuffix:
      'NÍVEL MÉDIO: equilibre clareza e desafio. Questões que exigem compreensão real, com alternativas plausíveis mas distinguíveis pelo texto.',
  },
  dificil: {
    label: 'Difícil',
    questionDepth:
      'Crie questões COMPLEXAS que exigem ANÁLISE e SÍNTESE de múltiplos conceitos do texto. Exija distinção entre conceitos similares, identificação de exceções, comparação de elementos. Cada questão deve ser desafiadora mesmo para quem leu com atenção.',
    distractorStrategy:
      'Alternativas incorretas OBRIGATORIAMENTE com pegadinhas: inversão de termos-chave, troca de ordem, elemento quase-correto. Devem ser MUITO PLAUSÍVEIS, diferindo da correta em detalhes SUTIS. Um leitor descuidado vai errar.',
    flashcardDepth:
      'Conteúdo aprofundado: definição técnica + exceções + casos especiais + relações com outros conceitos do texto.',
    systemSuffix:
      'NÍVEL DIFÍCIL: questões complexas com pegadinhas obrigatórias, alternativas muito similares entre si e análise de múltiplos conceitos combinados.',
  },
  expert: {
    label: 'Expert',
    questionDepth:
      'Crie questões de ALTO NÍVEL que exigem DOMÍNIO COMPLETO. Combine MÚLTIPLOS CONCEITOS em uma única questão. Use casos extremos, explore nuances e contradições aparentes, exija análise crítica. NENHUMA questão deve ser respondível por memorização simples — o aluno precisa realmente entender.',
    distractorStrategy:
      'Alternativas incorretas EXTREMAMENTE CONVINCENTES: diferem da correta apenas em aspectos TÉCNICOS MUITO PRECISOS. Cada incorreta representa um EQUÍVOCO SOFISTICADO que um estudante avançado cometeria. O erro deve ser sutil, específico e relevante — nunca trivial.',
    flashcardDepth:
      'Conteúdo especializado: definição técnica precisa + exceções + casos de borda + implicações práticas + conexões com outros temas + aspectos frequentemente mal compreendidos.',
    systemSuffix:
      'NÍVEL EXPERT: máxima complexidade. Questões que separam quem memorizou de quem realmente entendeu. Alternativas extremamente convincentes, combinação de múltiplos conceitos, casos extremos.',
  },
}

const modeConfig: Record<string, ModeConfig> = {
  concurso: {
    alternativesCount: 5,
    questionStyle:
      "literal, baseada em lei seca e súmulas. Use expressões como 'Segundo o art. X...', 'De acordo com a CF/88...', 'A Súmula Vinculante X do STF estabelece que...'",
    flashcardStyle:
      "no formato: 'Referência: [art./inciso/súmula] → Conteúdo: [dispositivo completo]'",
    pegadinhas:
      'Inclua pegadinhas comuns em concursos: inversão de palavras-chave, troca de números, confusão entre princípios ou institutos semelhantes.',
  },
  oab: {
    alternativesCount: 5,
    questionStyle:
      "como casos práticos e situações-problema. Use narrativas com nomes ('João, servidor público, foi exonerado...') e pergunte qual a medida cabível ou a posição jurídica correta.",
    flashcardStyle:
      "no formato: 'Conceito: [definição] → Posição STF/STJ: [entendimento] → Exceções: [casos especiais]'",
    pegadinhas:
      'Crie situações ambíguas onde mais de um instituto poderia se aplicar, exigindo raciocínio jurídico para identificar o correto.',
  },
  vestibular: {
    alternativesCount: 4,
    questionStyle:
      'contextualizada e interdisciplinar. Use contextos históricos ou sociais, peça causas, consequências e relações entre eventos ou conceitos.',
    flashcardStyle:
      "no formato: 'Conceito: [definição] → Exemplo: [caso concreto] → Contexto: [momento histórico ou social]'",
    pegadinhas:
      'Crie alternativas que troquem causa por consequência, ou que confundam autor com obra, época ou corrente.',
  },
  faculdade: {
    alternativesCount: 4,
    questionStyle:
      'direta, com linguagem acadêmica, focada no conteúdo programático. Pergunte definições, classificações e aplicações diretas de conceitos teóricos.',
    flashcardStyle:
      "no formato: 'Conceito: [definição teórica] → Aplicação: [como usar] → Autores: [principais referências]'",
    pegadinhas:
      'Foco em testar conhecimento real, sem pegadinhas. As alternativas incorretas devem ser claramente distinguíveis da correta.',
  },
}

async function generateQuestions(
  keys: string[],
  partText: string,
  partIndex: number,
  config: ModeConfig,
  diffConfig: DifficultyConfig,
  targetCount: number,
): Promise<{ questions: any[]; topics: string[] }> {
  const letters = ['A', 'B', 'C', 'D', 'E'].slice(0, config.alternativesCount)

  const prompt = `EXTRAIA do texto abaixo conceitos, definições, artigos, nomes e informações REAIS. Crie EXATAMENTE ${targetCount} questões de múltipla escolha ESPECÍFICAS e ÚNICAS.

━━━ REGRAS ABSOLUTAS — VIOLAÇÃO INVALIDA A QUESTÃO ━━━

REGRA 0 — QUANTIDADE OBRIGATÓRIA:
Você DEVE gerar EXATAMENTE ${targetCount} questões — nem mais, nem menos.
Se o texto tiver conteúdo suficiente para mais de ${targetCount} questões, escolha os ${targetCount} conceitos MAIS IMPORTANTES.
Se o texto tiver menos de ${targetCount} conceitos distintos, crie questões sobre aspectos diferentes do mesmo conceito.

REGRA 1 — INÍCIO DA PERGUNTA:
A questão NUNCA deve começar com "Segundo o texto", "De acordo com o texto", "Conforme o texto", "O texto afirma que", "Conforme visto no texto" ou qualquer variação similar.
A questão deve começar DIRETAMENTE com o sujeito, conceito ou instituto.
❌ PROIBIDO: "Segundo o texto, o Direito Constitucional Comparado é aquele que:"
❌ PROIBIDO: "De acordo com o texto, a participação do AGU na ADI é:"
✅ CORRETO: "O Direito Constitucional Comparado é aquele que:"
✅ CORRETO: "A participação do AGU na ADI é:"

REGRA 2 — ALTERNATIVAS:
NUNCA escreva "conforme o texto", "segundo o texto", "de acordo com o texto" dentro das alternativas.
A alternativa deve conter APENAS a informação real, sem referenciar a fonte.
❌ PROIBIDO: "obrigatória, conforme o texto"
❌ PROIBIDO: "facultativa, segundo o texto"
✅ CORRETO: "obrigatória"
✅ CORRETO: "facultativa"

REGRA 3 — DISTINÇÃO ENTRE ALTERNATIVAS:
As alternativas devem ser CLARAMENTE DISTINTAS. Não use alternativas que diferem apenas por uma palavra de sentido próximo.
❌ PROBLEMÁTICO: "eficácia contra todos, efeito vinculante e efeito ex tunc" vs "eficácia contra todos, efeito vinculante e efeito ex nunc" (diferença sutil demais para alternativas simples)
✅ MELHOR: cada alternativa apresenta uma ideia ou valor claramente diferente

REGRA 4 — CONTEÚDO REAL:
Cada questão DEVE mencionar um elemento concreto do texto: nome, artigo, prazo, conceito específico.
❌ PROIBIDO: "Questão sobre [tópico]: qual afirmação está correta?"
❌ PROIBIDO: "A) Correta conforme o texto" / "B) Incorreta conforme o texto"

REGRA 5 — O QUE NÃO EXTRAIR:
Ignore completamente e NÃO crie questões sobre:
- Cabeçalhos e rodapés repetitivos (ex: nome do curso, nome do professor)
- URLs, links, endereços de Telegram, WhatsApp ou redes sociais
- Convites para seguir canais, grupos ou se inscrever
- Números de página, marcas de seção, linhas de pontilhado
- Textos promocionais ou chamadas para ação ("Clique aqui", "Compartilhe")
- E-mails e menções de contato

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):
{
  "questions": [
    {
      "text": "Questão direta iniciando com o conceito/instituto (NUNCA com 'Segundo o texto')",
      "alternatives": ["${letters[0]}) informação real sem referência ao texto", "${letters[1] || 'B'}) outra informação real"${config.alternativesCount >= 3 ? `, "${letters[2] || 'C'}) terceira opção distinta"` : ''}${config.alternativesCount >= 4 ? `, "${letters[3] || 'D'}) quarta opção distinta"` : ''}${config.alternativesCount === 5 ? `, "${letters[4] || 'E'}) quinta opção distinta"` : ''}],
      "correct_answer": "A",
      "explanation": "Explicação citando trecho do texto. Cada alternativa incorreta: por que está errada.",
      "topic": "tópico específico do texto"
    }
  ],
  "topics": ["tópico real 1", "tópico real 2"]
}

MODO (${config.questionStyle.substring(0, 120)}):
NÍVEL ${diffConfig.label}: ${diffConfig.questionDepth.substring(0, 150)} | Distratores: ${diffConfig.distractorStrategy.substring(0, 120)}

REGRAS FINAIS:
- QUANTIDADE OBRIGATÓRIA: EXATAMENTE ${targetCount} questões no array "questions"
- ${config.alternativesCount} alternativas (${letters.join(', ')}), todas com informação real e sem referência ao texto
- Distribua correct_answer entre ${letters.join(', ')}
- Cada questão deve abordar um conceito DIFERENTE das demais

Texto:
${partText.substring(0, 12000)}`

  try {
    const raw = await callDeepSeek(
      keys,
      [
        {
          role: 'system',
          content:
            'Você é um especialista em criar questões de múltipla escolha baseadas estritamente em textos fornecidos. ' +
            'NUNCA invente informações. ' +
            'NUNCA inicie uma questão com "Segundo o texto", "De acordo com o texto", "Conforme o texto" ou qualquer variação — a questão começa diretamente com o conceito ou sujeito. ' +
            'NUNCA escreva "conforme o texto" ou "segundo o texto" dentro das alternativas — as alternativas contêm apenas a informação real. ' +
            'NUNCA use alternativas genéricas como "Correta conforme o texto". ' +
            'Cada questão DEVE mencionar um elemento concreto (nome, artigo, data, conceito) presente no texto. ' +
            `${diffConfig.systemSuffix} Retorne APENAS JSON válido.`,
        },
        { role: 'user', content: prompt },
      ],
      7500,
    )
    const jsonStr = extractFirstObject(raw)
    if (!jsonStr) {
      console.log(`⚠️ Q parte ${partIndex + 1}: resposta sem JSON válido`)
      return { questions: [], topics: [] }
    }
    const result = JSON.parse(jsonStr)
    const questions = Array.isArray(result) ? result : (result.questions ?? [])
    const topics = result.topics ?? []
    console.log(`✅ Q parte ${partIndex + 1}: ${questions.length} questões`)
    return { questions, topics }
  } catch (e: any) {
    console.error(`❌ Q parte ${partIndex + 1}:`, e.message)
    return { questions: [], topics: [] }
  }
}

async function generateFlashcards(
  keys: string[],
  partText: string,
  partIndex: number,
  diffConfig: DifficultyConfig,
  targetCount: number,
): Promise<any[]> {
  const prompt = `CRIE EXATAMENTE ${targetCount} flashcards de estudo ATIVOS usando ESTRATÉGIAS VARIADAS de memorização. Use APENAS informações REAIS e ESPECÍFICAS do texto.

QUANTIDADE OBRIGATÓRIA: Crie EXATAMENTE ${targetCount} flashcards — nem mais, nem menos.

ESTRATÉGIAS (varie — não use sempre a mesma):

1. PERGUNTA DIRETA — frente: pergunta específica | verso: resposta objetiva
   ✅ Frente: "Quais são os efeitos jurídicos da perda dos direitos políticos?"
      Verso: "Impossibilidade definitiva de votar, ser votado e exercer função política"

2. LACUNA/OMISSÃO — frente: frase com ___ | verso: a palavra/dado omitido + significado breve
   ✅ Frente: "O art. 37 da CF lista ___ princípios da Administração Pública"
      Verso: "5 — LIMPE: Legalidade, Impessoalidade, Moralidade, Publicidade, Eficiência"

3. COMPARAÇÃO — frente: "Diferença entre X e Y?" | verso: distinção clara
   ✅ Frente: "Diferença entre suspensão e perda dos direitos políticos?"
      Verso: "Suspensão: temporária. Perda: definitiva e permanente"

4. LISTA/MNEMÔNICO — frente: "Quais são os tipos/requisitos de X?" | verso: lista curta
   ✅ Frente: "Quais são as hipóteses de perda dos direitos políticos?"
      Verso: "1) Cancelamento de naturalização 2) Incapacidade civil absoluta 3) Condenação criminal transitada em julgado"

5. VERDADEIRO OU FALSO — frente: afirmação | verso: "Verdadeiro" ou "Falso — [correção]"
   ✅ Frente: "A perda dos direitos políticos é temporária"
      Verso: "Falso — é definitiva. Temporária é a suspensão"

REGRAS:
- Frente: máximo 15 palavras
- Verso: máximo 3 linhas, direto ao ponto
- NÃO comece o verso com "Referência:", "Texto:", "Conteúdo:" ou similares
- NÃO crie flashcards genéricos como "Conceito importante" ou "Ponto relevante"
- Use elementos concretos do texto: artigos, nomes, valores, conceitos específicos

IGNORE COMPLETAMENTE (não crie flashcard sobre):
- URLs, links, endereços de Telegram, WhatsApp ou redes sociais
- Cabeçalhos repetitivos (nome do curso, nome do professor)
- Convites para seguir canais, grupos ou se inscrever
- Números de página, rodapés, separadores
- Textos promocionais ("Clique aqui", "Compartilhe", "Ingresse no canal")

Retorne APENAS este JSON (sem markdown):
{
  "flashcards": [
    {
      "front": "Pergunta, lacuna ou afirmação (máx. 15 palavras)",
      "back": "Resposta direta e objetiva (máx. 3 linhas)",
      "topic": "tópico específico"
    }
  ]
}

Nível ${diffConfig.label}: ${diffConfig.flashcardDepth.substring(0, 150)}

REGRAS FINAIS:
- QUANTIDADE OBRIGATÓRIA: EXATAMENTE ${targetCount} flashcards no array "flashcards"
- Cada flashcard deve abordar um conceito DIFERENTE dos demais
- Use elementos concretos do texto: artigos, nomes, valores, conceitos específicos

Texto:
${partText.substring(0, 12000)}`

  try {
    const raw = await callDeepSeek(
      keys,
      [
        {
          role: 'system',
          content:
            'Você cria flashcards de estudo baseados estritamente no texto fornecido. ' +
            'NUNCA use front/back genérico. Cada flashcard deve referenciar um elemento concreto do texto. ' +
            'NUNCA crie flashcard sobre URLs, Telegram, WhatsApp, cabeçalhos repetitivos, rodapés, números de página ou textos promocionais. ' +
            'Retorne APENAS JSON válido.',
        },
        { role: 'user', content: prompt },
      ],
      4000,
    )
    const jsonStr = extractFirstObject(raw)
    if (!jsonStr) {
      console.log(`⚠️ FC parte ${partIndex + 1}: resposta sem JSON válido`)
      return []
    }
    const result = JSON.parse(jsonStr)
    const flashcards = Array.isArray(result) ? result : (result.flashcards ?? [])
    console.log(`✅ FC parte ${partIndex + 1}: ${flashcards.length} flashcards`)
    return flashcards
  } catch (e: any) {
    console.error(`❌ FC parte ${partIndex + 1}:`, e.message)
    return []
  }
}

async function generateSummary(keys: string[], text: string): Promise<string> {
  try {
    return await callDeepSeek(
      keys,
      [
        {
          role: 'user',
          content: `Crie um resumo estruturado e completo deste texto acadêmico.

REGRAS:
- NÃO use asteriscos (*) ou (**)
- Use hífen (-) para listas
- Títulos de seção em MAIÚSCULAS
- Cubra todos os tópicos e conceitos importantes

FORMATO:
NOME DO TÓPICO
- Conceito: explicação detalhada
- Ponto importante: desenvolvimento

Texto:
${text.substring(0, 14000)}`,
        },
      ],
      2500,
    )
  } catch (e: any) {
    console.error('Erro no resumo:', e.message)
    return 'Resumo gerado automaticamente.'
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`

  try {
    const body = await req.json()
    const { generationId, mode = 'concurso', difficulty = 'medio' } = body
    const pdfText = String(body.pdfText ?? '')

    // A-5 (M-5): Limite de tamanho do texto enviado
    if (pdfText.length > MAX_PDF_TEXT_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'Texto muito longo. Máximo: 500.000 caracteres.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!generationId) {
      return new Response(JSON.stringify({ error: 'generationId é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization header ausente' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = user.id

    // A-4: Valida que o generationId pertence ao usuário autenticado
    const { data: genOwnership, error: genOwnerErr } = await supabase
      .from('generations')
      .select('id')
      .eq('id', generationId)
      .eq('user_id', userId)
      .single()

    if (genOwnerErr || !genOwnership) {
      return new Response(JSON.stringify({ error: 'Geração não encontrada ou sem permissão' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limiting: máx 10 gerações por hora
    const { data: withinLimit, error: rlErr } = await supabase
      .rpc('check_generation_rate_limit', { p_user_id: userId })

    if (rlErr || !withinLimit) {
      return new Response(
        JSON.stringify({ error: 'Limite de gerações atingido. Aguarde antes de gerar novamente.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // A-3: Consome crédito ANTES de chamar a DeepSeek (previne TOCTOU)
    const { data: creditOk, error: creditErr } = await supabase
      .rpc('consume_credit', { p_user_id: userId })

    if (creditErr || !creditOk) {
      return new Response(JSON.stringify({ error: 'Créditos insuficientes' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const config = modeConfig[mode] ?? modeConfig.concurso
    const diffConfig = difficultyConfig[difficulty] ?? difficultyConfig.medio

    const text = cleanText(pdfText)
    console.log(`📄 Texto bruto: ${pdfText.length} chars → limpo: ${text.length} chars | modo: ${mode} | userId: ${userId}`)

    await supabase.from('generations').update({ status: 'processing' }).eq('id', generationId)

    const keys = loadApiKeys()
    if (keys.length === 0) throw new Error('Nenhuma DEEPSEEK_API_KEY configurada')
    console.log(`🔑 ${keys.length} chave(s) DeepSeek disponível(eis)`)

    const TARGET_QUESTIONS = 50
    const TARGET_FLASHCARDS = 100
    const numParts = 5
    const partSize = Math.ceil(text.length / numParts)
    // Partes NÃO sobrepostas: cada parte cobre uma fatia exclusiva do texto
    const parts = Array.from({ length: numParts }, (_, i) =>
      text.substring(i * partSize, Math.min((i + 1) * partSize, text.length)),
    ).filter(p => p.trim().length > 200)

    const questionsPerPart = Math.ceil(TARGET_QUESTIONS / parts.length)          // 10 se 5 partes
    const flashcardsPerPart = Math.ceil((TARGET_FLASHCARDS + 10) / parts.length) // 22 se 5 partes (buffer p/ dedup)

    console.log(`🚀 Lançando ${parts.length * 2 + 1} chamadas paralelas à DeepSeek (${questionsPerPart}Q + ${flashcardsPerPart}FC por parte)...`)

    const [questionResults, flashcardResults, finalSummary] = await Promise.all([
      Promise.all(parts.map((part, i) => generateQuestions(keys, part, i, config, diffConfig, questionsPerPart))),
      Promise.all(parts.map((part, i) => generateFlashcards(keys, part, i, diffConfig, flashcardsPerPart))),
      generateSummary(keys, text),
    ])

    console.log(`⏱️ API concluída em ${elapsed()}`)

    let allQuestions: any[] = []
    let allFlashcards: any[] = []
    let allTopics: string[] = []

    for (const r of questionResults) {
      allQuestions.push(...r.questions)
      allTopics.push(...r.topics)
    }
    for (const fc of flashcardResults) {
      allFlashcards.push(...fc)
    }

    console.log(`📊 Total gerado: ${allQuestions.length}Q, ${allFlashcards.length}FC`)

    // Fallback apenas se a IA falhou completamente em todas as chamadas paralelas
    if (allQuestions.length === 0 && allFlashcards.length === 0) {
      console.log('⚠️ IA falhou em todas as partes — tentando chamada única de recuperação')
      try {
        const recoveryResult = await generateQuestions(keys, text.substring(0, 8000), 0, config, diffConfig, TARGET_QUESTIONS)
        allQuestions.push(...recoveryResult.questions)
        allTopics.push(...recoveryResult.topics)
        const recoveryFC = await generateFlashcards(keys, text.substring(0, 8000), 0, diffConfig, TARGET_FLASHCARDS)
        allFlashcards.push(...recoveryFC)
        console.log(`🔄 Recuperação: ${allQuestions.length}Q, ${allFlashcards.length}FC`)
      } catch (recoveryErr: any) {
        console.error('❌ Recuperação também falhou:', recoveryErr.message)
      }
    }

    const altCount = config.alternativesCount

    // Sanitizador: descarta questões com alternativas ausentes, vazias, duplicadas
    // entre si, ou com gabarito que não corresponde a nenhuma alternativa real.
    for (const q of allQuestions) {
      if (!sanitizeAndValidateQuestion(q, altCount)) {
        console.warn(`⚠️ Q inválida descartada: alternatives=${JSON.stringify(q.alternatives)?.substring(0, 80)} correct_answer=${q.correct_answer}`)
        q._discard = true
      }
    }

    // Remove questões marcadas para descarte e questões sem texto
    const before = allQuestions.length
    allQuestions = allQuestions.filter((q: any) => !q._discard && q.text && q.text.trim().length > 10)
    if (allQuestions.length < before) {
      console.warn(`⚠️ ${before - allQuestions.length} questão(ões) descartadas`)
    }

    const uniqueTopics = [...new Set(allTopics)]

    // Deduplicação por texto normalizado (primeiros 70 chars)
    const seenQ = new Set<string>()
    allQuestions = allQuestions
      .filter((q: any) => {
        if (isJunk(q.text ?? '')) return false
        const key = (q.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 70)
        if (seenQ.has(key)) return false
        seenQ.add(key)
        return true
      })
      .slice(0, TARGET_QUESTIONS)

    // Fallback cirúrgico: completa exatamente até TARGET_QUESTIONS se a validação/dedup removeu demais
    if (allQuestions.length < TARGET_QUESTIONS) {
      const missing = TARGET_QUESTIONS - allQuestions.length
      console.log(`⚠️ ${allQuestions.length} questões após dedup — gerando ${missing} adicionais...`)
      try {
        const extraQ = await generateQuestions(keys, text.substring(0, 12000), 99, config, diffConfig, missing + 3)
        for (const q of extraQ.questions) {
          if (allQuestions.length >= TARGET_QUESTIONS) break
          if (isJunk(q.text ?? '') || !q.text || q.text.trim().length <= 10) continue
          if (!sanitizeAndValidateQuestion(q, altCount)) continue
          const key = (q.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 70)
          if (seenQ.has(key)) continue
          seenQ.add(key)
          allQuestions.push(q)
        }
        console.log(`🔄 Após fallback Q: ${allQuestions.length}Q`)
      } catch (e: any) {
        console.error('❌ Fallback de questões falhou:', e.message)
      }
    }

    const seenFC = new Set<string>()
    allFlashcards = allFlashcards
      .filter((f: any) => {
        if (isJunk(f.front ?? '') || isJunk(f.back ?? '')) return false
        if ((f.front ?? '').trim().length <= 5) return false
        const key = (f.front ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 50)
        if (seenFC.has(key)) return false
        seenFC.add(key)
        return true
      })
      .slice(0, TARGET_FLASHCARDS)

    // Fallback cirúrgico: completa exatamente até TARGET_FLASHCARDS se a dedup removeu demais
    if (allFlashcards.length < TARGET_FLASHCARDS) {
      const missing = TARGET_FLASHCARDS - allFlashcards.length
      console.log(`⚠️ ${allFlashcards.length} flashcards após dedup — gerando ${missing} adicionais...`)
      try {
        // Pede missing + 5 para absorver novas duplicatas; usa o texto inteiro como fonte
        const extraFC = await generateFlashcards(keys, text.substring(0, 12000), 99, diffConfig, missing + 5)
        for (const f of extraFC) {
          if (allFlashcards.length >= TARGET_FLASHCARDS) break
          if (isJunk(f.front ?? '') || isJunk(f.back ?? '')) continue
          if ((f.front ?? '').trim().length <= 5) continue
          const key = (f.front ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 50)
          if (seenFC.has(key)) continue
          seenFC.add(key)
          allFlashcards.push(f)
        }
        console.log(`🔄 Após fallback FC: ${allFlashcards.length}FC`)
      } catch (e: any) {
        console.error('❌ Fallback de flashcards falhou:', e.message)
      }
    }

    console.log(`📊 Após dedup: ${allQuestions.length}Q (target ${TARGET_QUESTIONS}), ${allFlashcards.length}FC (target ${TARGET_FLASHCARDS})`)

    const questionRows = allQuestions.map((q, i) => ({
      generation_id: generationId,
      text: q.text,
      alternatives: q.alternatives,
      correct_answer: q.correct_answer,
      explanation: q.explanation ?? null,
      topic: q.topic ?? 'Geral',
      order_index: i + 1,
    }))

    const flashcardRows = allFlashcards.map((f, i) => ({
      generation_id: generationId,
      front: f.front,
      back: f.back,
      topic: f.topic ?? 'Geral',
      order_index: i + 1,
    }))

    const BATCH = 25
    const insertResults = await Promise.all([
      ...Array.from({ length: Math.ceil(questionRows.length / BATCH) }, (_, i) =>
        supabase.from('questions').insert(questionRows.slice(i * BATCH, (i + 1) * BATCH)),
      ),
      ...Array.from({ length: Math.ceil(flashcardRows.length / BATCH) }, (_, i) =>
        supabase.from('flashcards').insert(flashcardRows.slice(i * BATCH, (i + 1) * BATCH)),
      ),
    ])

    let insertErrors = 0
    for (const r of insertResults) {
      if (r.error) {
        console.error('❌ INSERT ERROR:', r.error.message, r.error.details)
        insertErrors++
      }
    }
    if (insertErrors > 0) {
      throw new Error(`${insertErrors} batch(es) de inserção falharam — verifique os logs acima`)
    }
    console.log(`✅ ${questionRows.length}Q + ${flashcardRows.length}FC salvos em ${elapsed()}`)

    // Revisão automática de qualidade: corrige gabarito, alternativas, enunciado e explicação
    // antes de liberar a geração para o usuário. Falha aqui não deve travar a geração.
    try {
      const reviewRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/review-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ generationId }),
      })
      if (reviewRes.ok) {
        const reviewData = await reviewRes.json()
        console.log(`🔍 Revisão automática: ${reviewData.reviewed ?? 0} analisadas, ${reviewData.corrected ?? 0} corrigidas`)
      } else {
        console.warn(`⚠️ Revisão automática retornou HTTP ${reviewRes.status}`)
      }
    } catch (reviewErr: any) {
      console.error('⚠️ Revisão automática falhou (questões mantidas como geradas):', reviewErr.message)
    }

    // Segunda camada de verificação: valida o CONTEÚDO de cada questão de forma independente
    // (resolve do zero, adaptando o método ao assunto), pois a revisão acima também pode errar.
    try {
      const validateRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/validate-content`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ generationId }),
      })
      if (validateRes.ok) {
        const validateData = await validateRes.json()
        console.log(`🔬 Validação de conteúdo automática: ${validateData.validated ?? 0} analisadas, ${validateData.corrected ?? 0} corrigidas`)
      } else {
        console.warn(`⚠️ Validação de conteúdo automática retornou HTTP ${validateRes.status}`)
      }
    } catch (validateErr: any) {
      console.error('⚠️ Validação de conteúdo automática falhou (questões mantidas como estavam):', validateErr.message)
    }

    // Avaliação de qualidade pedagógica: pontua cada questão e substitui as fracas
    // (Ruim/Média) por novas, mantendo sempre o total de questões da geração.
    try {
      const assessRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/assess-quality`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ generationId }),
      })
      if (assessRes.ok) {
        const assessData = await assessRes.json()
        console.log(`📊 Avaliação de qualidade automática: ${assessData.assessed ?? 0} avaliadas, ${assessData.replaced ?? 0} substituídas`)
      } else {
        console.warn(`⚠️ Avaliação de qualidade automática retornou HTTP ${assessRes.status}`)
      }
    } catch (assessErr: any) {
      console.error('⚠️ Avaliação de qualidade automática falhou (questões mantidas como estavam):', assessErr.message)
    }

    // Randomiza a posição das alternativas/gabarito para evitar viés de letra (ex: sempre "C").
    // Roda por último, depois da revisão, para cobrir também questões corrigidas por ela.
    try {
      const randomizeRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/randomize-answers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ generationId }),
      })
      if (randomizeRes.ok) {
        const randomizeData = await randomizeRes.json()
        console.log(`🎲 Randomização automática: ${randomizeData.processed ?? 0} processadas, ${randomizeData.changed ?? 0} alteradas`)
      } else {
        console.warn(`⚠️ Randomização automática retornou HTTP ${randomizeRes.status}`)
      }
    } catch (randomizeErr: any) {
      console.error('⚠️ Randomização automática falhou (ordem original mantida):', randomizeErr.message)
    }

    console.log(`📝 Atualizando status da geração ${generationId} para 'completed'...`)
    const now = new Date().toISOString()
    const { data: updatedRows, error: updateError } = await supabase
      .from('generations')
      .update({
        summary: finalSummary,
        topics: uniqueTopics.slice(0, 10),
        status: 'completed',
        study_mode: mode,
        question_count: questionRows.length,
        flashcard_count: flashcardRows.length,
        completed_at: now,
        updated_at: now,
      })
      .eq('id', generationId)
      .select('id')

    if (updateError) {
      console.error('❌ UPDATE ERROR — geração NÃO marcada como completed:', updateError.message)
      console.error('❌ UPDATE DETAILS:', JSON.stringify(updateError))
    } else if (!updatedRows || updatedRows.length === 0) {
      console.error(`⚠️ UPDATE afetou 0 linhas — generationId: ${generationId} (RLS ou ID inválido?)`)
    } else {
      console.log(`✅ Geração ${generationId} marcada como completed com sucesso`)
    }

    console.log(`🎉 Concluído em ${elapsed()}!`)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('❌ Erro fatal:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao processar. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
