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

function limparJSON(texto: string): string {
  texto = texto.replace(/```json\n?/g, '').replace(/```\n?/g, '')
  const first = texto.indexOf('{')
  const last = texto.lastIndexOf('}')
  if (first !== -1 && last !== -1) {
    texto = texto.substring(first, last + 1)
  }
  texto = texto.replace(/\}\s*\{/g, '},{')
  texto = texto.replace(/\]\s*\[/g, '],[')
  texto = texto.replace(/,(\s*[}\]])/g, '$1')
  return texto
}

function tentarParsearJSON(raw: string): any | null {
  const extracted = extractFirstObject(raw)
  if (extracted) {
    try { return JSON.parse(extracted) } catch { /* fall through */ }
  }
  try { return JSON.parse(limparJSON(raw)) } catch { return null }
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
  temperature = 0.1,
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

const VALID_LETTERS = ['A', 'B', 'C', 'D', 'E']

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

interface QuestionRow {
  id: string
  text: string
  alternatives: string[]
  correct_answer: string
  explanation: string | null
  topic: string | null
}

// Segunda camada de verificação, independente da revisão estrutural de review-questions:
// resolve a questão do zero usando o método apropriado à área de conhecimento (Direito,
// Matemática, Português, História, ou qualquer outro assunto), em vez de apenas comparar
// contra o gabarito informado. Uma chamada por questão (não em lote), para dar à IA espaço
// suficiente para raciocinar com profundidade sobre cada questão individualmente.
function buildValidationMessages(q: QuestionRow, generationContext: string): { role: string; content: string }[] {
  const prompt = `Você é um especialista revisor multidisciplinar. Sua tarefa é validar se o GABARITO desta questão está PRECISAMENTE correto, usando o método de verificação apropriado à área de conhecimento do assunto abaixo. Esta é uma segunda camada de verificação, independente de qualquer revisão anterior — não confie cegamente no gabarito informado; resolva a questão você mesmo, do zero.

CONTEXTO DA GERAÇÃO: ${generationContext}
ASSUNTO/TÓPICO DESTA QUESTÃO: ${q.topic || 'Geral'}

QUESTÃO:
Enunciado: ${q.text}
Alternativas:
${q.alternatives.map(a => `  ${a}`).join('\n')}
Gabarito informado: ${q.correct_answer}
Explicação informada: ${q.explanation || '(nenhuma)'}

MÉTODO DE VALIDAÇÃO — identifique a área de conhecimento do assunto acima e aplique o método correspondente:
- DIREITO: identifique a lei, artigo ou súmula especificamente envolvida. Baseie-se apenas no texto normativo REAL — nunca invente dispositivos, incisos ou efeitos jurídicos que a lei citada não prevê.
- MATEMÁTICA/EXATAS: resolva o problema passo a passo, mostrando o cálculo completo, ANTES de comparar com as alternativas.
- PORTUGUÊS/LINGUÍSTICA: verifique regras gramaticais, ortográficas, de concordância ou de interpretação textual especificamente aplicáveis ao enunciado.
- HISTÓRIA/GEOGRAFIA/CIÊNCIAS/outras áreas: verifique fatos, datas, conceitos, nomes e relações contra conhecimento consolidado e academicamente aceito — nunca invente eventos ou dados.
- Qualquer outro assunto: aplique o mesmo rigor — resolva a questão de forma completa e independente antes de validar.

PROCESSO OBRIGATÓRIO:
1. Identifique a área de conhecimento do assunto.
2. Resolva a questão de forma COMPLETA e INDEPENDENTE, como se estivesse respondendo-a do zero, SEM olhar o gabarito informado.
3. Só então compare sua resposta com o gabarito informado.
4. Se divergirem, o gabarito informado está ERRADO — corrija completamente a questão.
5. Também corrija se encontrar alternativas incoerentes, vazias, duplicadas, ou enunciado ambíguo — mesmo que o gabarito esteja certo.

Se TUDO estiver correto (gabarito preciso, alternativas coerentes, explicação correta), retorne apenas:
{"status": "ok"}

Se houver QUALQUER problema, retorne a questão CORRIGIDA POR COMPLETO:
{
  "status": "corrected",
  "subject_area": "direito" | "matematica" | "portugues" | "historia" | "outro",
  "reasoning": "resumo em 1-3 frases do raciocínio que levou à correção (para auditoria)",
  "issues": ["gabarito_incorreto" | "nenhuma_alternativa_correta" | "alternativa_duplicada" | "alternativa_incoerente" | "enunciado_confuso" | "explicacao_inconsistente"],
  "text": "enunciado (corrigido se necessário, senão igual ao original)",
  "alternatives": ["A) ...", "B) ...", ...],
  "correct_answer": "X",
  "explanation": "explicação corrigida e coerente com o gabarito correto"
}

REGRAS OBRIGATÓRIAS:
- Mantenha o MESMO número de alternativas (${q.alternatives.length}) e os mesmos prefixos de letra.
- Todas as alternativas devem ser DIFERENTES entre si.
- "correct_answer" deve corresponder a uma alternativa que você mesmo verificou ser a correta.
- Use apenas conhecimento real, consolidado e verificável. NUNCA invente leis, artigos, fórmulas, fatos ou dados.
- Todo o conteúdo deve estar em português.

Retorne APENAS o JSON, sem markdown, sem texto fora do JSON.`

  return [
    {
      role: 'system',
      content:
        'Você é um especialista revisor multidisciplinar (Direito, Matemática, Português, História, Ciências e qualquer outra área), ' +
        'atuando como segunda camada de controle de qualidade após uma revisão anterior. Sua função é validar com rigor máximo se o ' +
        'gabarito de cada questão está PRECISAMENTE correto, resolvendo cada questão de forma independente e completa antes de confiar ' +
        'em qualquer gabarito informado. Nunca invente leis, artigos, fórmulas, fatos ou dados — use apenas conhecimento real e verificável. ' +
        'Seja conservador ao corrigir: só marque "corrected" quando tiver certeza de um problema real. Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]
}

function sanitizeValidation(
  original: QuestionRow,
  item: any,
): { text: string; alternatives: string[]; correct_answer: string; explanation: string } | null {
  const text = typeof item.text === 'string' ? item.text.trim() : ''
  if (text.length < 10) return null

  const alternatives = Array.isArray(item.alternatives)
    ? item.alternatives.map((a: any) => String(a).trim())
    : []
  const altsValid =
    alternatives.length === original.alternatives.length &&
    alternatives.length >= 4 &&
    alternatives.every((a: string) => a.length > 3)
  if (!altsValid) return null
  if (hasDuplicateAlternatives(alternatives)) return null

  const correctAnswer = typeof item.correct_answer === 'string' ? item.correct_answer.trim().toUpperCase() : ''
  const validLetters = VALID_LETTERS.slice(0, alternatives.length)
  if (!validLetters.includes(correctAnswer)) return null

  const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : ''
  if (explanation.length < 5) return null

  return { text, alternatives, correct_answer: correctAnswer, explanation }
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
    const { generationId } = body

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
    const token = authHeader.substring('Bearer '.length).trim()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // Chamada interna (process-pdf/generate-subject usam a service role key diretamente
    // após a revisão) pula a checagem de usuário.
    const isInternalCall = token === serviceRoleKey

    let userId: string | null = null
    if (!isInternalCall) {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user }, error: userError } = await userClient.auth.getUser()
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Não autorizado' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      userId = user.id
    }

    const { data: generation, error: genErr } = await supabase
      .from('generations')
      .select('id, user_id, title, study_mode')
      .eq('id', generationId)
      .single()

    if (genErr || !generation) {
      return new Response(JSON.stringify({ error: 'Geração não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!isInternalCall) {
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', userId!).single()
      if (generation.user_id !== userId && !profile?.is_admin) {
        return new Response(JSON.stringify({ error: 'Sem permissão' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const { data: questions, error: qErr } = await supabase
      .from('questions')
      .select('id, text, alternatives, correct_answer, explanation, topic')
      .eq('generation_id', generationId)
      .order('order_index', { ascending: true })

    if (qErr) throw new Error(`Falha ao buscar questões: ${qErr.message}`)

    if (!questions || questions.length === 0) {
      console.log('✅ Validação de conteúdo concluída: 0 analisadas, 0 corrigidas (nenhuma questão encontrada para esta geração)')
      return new Response(JSON.stringify({ success: true, validated: 0, corrected: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const keys = loadApiKeys()
    if (keys.length === 0) throw new Error('Nenhuma DEEPSEEK_API_KEY configurada')

    const generationContext = [generation.title, generation.study_mode ? `modo: ${generation.study_mode}` : null]
      .filter(Boolean)
      .join(' — ') || 'Sem contexto adicional'

    console.log(`🔬 Validando conteúdo de ${questions.length} questões (geração ${generationId}), uma chamada por questão...`)

    // Uma chamada de IA por questão (não em lote): dá à IA espaço dedicado para
    // raciocinar profundamente sobre cada questão individual, em vez de avaliar
    // várias de uma vez com atenção diluída.
    const results = await Promise.all(
      (questions as QuestionRow[]).map(async (q) => {
        try {
          const messages = buildValidationMessages(q, generationContext)
          const raw = await callDeepSeek(keys, messages, 2000, 0.1)
          const parsed = tentarParsearJSON(raw)
          return { question: q, item: parsed, failed: !parsed }
        } catch (e: any) {
          console.error(`❌ Validação da questão ${q.id} falhou:`, e.message)
          return { question: q, item: null, failed: true }
        }
      }),
    )

    const failedCount = results.filter(r => r.failed).length

    const candidates: { id: string; original: QuestionRow; fixed: NonNullable<ReturnType<typeof sanitizeValidation>>; issues: string[]; subjectArea: string | null; reasoning: string | null }[] = []

    for (const { question, item } of results) {
      if (!item || item.status !== 'corrected') continue

      const fixed = sanitizeValidation(question, item)
      if (!fixed) {
        console.warn(`⚠️ Correção de conteúdo inválida descartada para questão ${question.id}`)
        continue
      }

      const unchanged =
        fixed.text === question.text &&
        fixed.correct_answer === question.correct_answer &&
        fixed.explanation === (question.explanation ?? '') &&
        JSON.stringify(fixed.alternatives) === JSON.stringify(question.alternatives)
      if (unchanged) continue

      candidates.push({
        id: question.id,
        original: question,
        fixed,
        issues: Array.isArray(item.issues) ? item.issues : [],
        subjectArea: typeof item.subject_area === 'string' ? item.subject_area : null,
        reasoning: typeof item.reasoning === 'string' ? item.reasoning : null,
      })
    }

    let corrected = 0
    if (candidates.length > 0) {
      const updateResults = await Promise.all(
        candidates.map(c =>
          supabase
            .from('questions')
            .update({
              text: c.fixed.text,
              alternatives: c.fixed.alternatives,
              correct_answer: c.fixed.correct_answer,
              explanation: c.fixed.explanation,
            })
            .eq('id', c.id),
        ),
      )

      const auditRows: any[] = []
      for (let i = 0; i < candidates.length; i++) {
        if (updateResults[i].error) {
          console.error(`❌ Falha ao salvar validação de conteúdo da questão ${candidates[i].id}:`, updateResults[i].error!.message)
          continue
        }
        const c = candidates[i]
        auditRows.push({
          question_id: c.id,
          generation_id: generationId,
          user_id: generation.user_id,
          subject_area: c.subjectArea,
          issues_found: c.issues,
          reasoning: c.reasoning,
          before: {
            text: c.original.text,
            alternatives: c.original.alternatives,
            correct_answer: c.original.correct_answer,
            explanation: c.original.explanation,
          },
          after: c.fixed,
        })
      }

      if (auditRows.length > 0) {
        const { error: auditErr } = await supabase.from('content_validations').insert(auditRows)
        if (auditErr) console.error('❌ Falha ao salvar auditoria de validação de conteúdo:', auditErr.message)
      }
      corrected = auditRows.length
    }

    const statusSuffix =
      corrected > 0
        ? ''
        : failedCount > 0
          ? ` (falha ao validar ${failedCount}/${questions.length} questão(ões))`
          : ' (nenhum problema de conteúdo encontrado)'
    console.log(`✅ Validação de conteúdo concluída: ${questions.length} analisadas, ${corrected} corrigidas${statusSuffix} — ${elapsed()}`)

    return new Response(
      JSON.stringify({ success: true, validated: questions.length, corrected }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na validação de conteúdo:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao validar conteúdo. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
