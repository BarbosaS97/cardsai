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
  temperature = 0.2,
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

interface QuestionRow {
  id: string
  text: string
  alternatives: string[]
  correct_answer: string
  explanation: string | null
  topic: string | null
}

const VALID_LETTERS = ['A', 'B', 'C', 'D', 'E']
const REVIEW_BATCH_SIZE = 10

function buildReviewMessages(batch: QuestionRow[]): { role: string; content: string }[] {
  const input = batch.map((q, i) => ({
    index: i,
    topic: q.topic || 'Geral',
    text: q.text,
    alternatives: q.alternatives,
    correct_answer: q.correct_answer,
    explanation: q.explanation || '',
  }))

  const prompt = `Revise as ${batch.length} questões de múltipla escolha abaixo. Para CADA questão, faça isto:

1. Resolva a questão de forma INDEPENDENTE, como se não conhecesse o "correct_answer" informado, usando apenas conhecimento real e consolidado sobre o tema ("topic").
2. Compare sua resposta com o "correct_answer" fornecido.
3. Verifique também:
   - O enunciado ("text") é claro, objetivo e sem ambiguidade?
   - Todas as alternativas fazem sentido e são plausíveis?
   - Nenhuma alternativa é duplicada ou apenas uma repetição disfarçada de outra?
   - A "explanation" realmente justifica corretamente por que a alternativa correta está certa?
4. Se TUDO estiver correto, retorne apenas: {"index": N, "status": "ok"}
5. Se houver QUALQUER problema, retorne a questão CORRIGIDA POR COMPLETO:
   {
     "index": N,
     "status": "corrected",
     "issues": ["gabarito_incorreto" | "alternativa_duplicada" | "alternativa_incoerente" | "enunciado_confuso" | "explicacao_inconsistente", ...],
     "text": "enunciado corrigido",
     "alternatives": ["A) ...", "B) ...", ...],
     "correct_answer": "X",
     "explanation": "explicação corrigida, coerente com o gabarito correto"
   }

REGRAS OBRIGATÓRIAS PARA CORREÇÃO:
- Mantenha o MESMO número de alternativas de cada questão original e os mesmos prefixos de letra (ex: "A) ", "B) ").
- "correct_answer" deve ser sempre uma letra que corresponda a uma das alternativas retornadas.
- Corrija apenas o que estiver realmente errado — não reescreva questões que já estão corretas.
- Use apenas conhecimento real e academicamente consolidado. Nunca invente informações, artigos ou fatos.
- Todo o conteúdo deve estar em português.

Questões a revisar:
${JSON.stringify(input)}

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):
{"results": [{"index": 0, "status": "ok"}, {"index": 1, "status": "corrected", "issues": ["gabarito_incorreto"], "text": "...", "alternatives": ["A) ...", "B) ..."], "correct_answer": "B", "explanation": "..."}]}`

  return [
    {
      role: 'system',
      content:
        'Você é um revisor rigoroso de questões de múltipla escolha, atuando como banca examinadora de controle de qualidade. ' +
        'Sua função é detectar e corrigir gabaritos incorretos, alternativas incoerentes ou duplicadas, enunciados confusos e explicações ' +
        'inconsistentes com o gabarito. Resolva cada questão de forma independente antes de validar o gabarito informado — nunca assuma que ' +
        'está correto sem verificar. Seja conservador: só marque como "corrected" quando houver um problema real. Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]
}

function sanitizeCorrection(
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

    // Chamada interna (process-pdf/generate-subject usam a service role key
    // diretamente após salvar as questões) pula a checagem de usuário.
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
      .select('id, user_id')
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
      return new Response(JSON.stringify({ success: true, reviewed: 0, corrected: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const keys = loadApiKeys()
    if (keys.length === 0) throw new Error('Nenhuma DEEPSEEK_API_KEY configurada')

    const batches: QuestionRow[][] = []
    for (let i = 0; i < questions.length; i += REVIEW_BATCH_SIZE) {
      batches.push(questions.slice(i, i + REVIEW_BATCH_SIZE) as QuestionRow[])
    }

    console.log(`🔍 Revisando ${questions.length} questões (geração ${generationId}) em ${batches.length} lote(s)...`)

    const batchResults = await Promise.all(
      batches.map(async (batch, batchIdx) => {
        try {
          const messages = buildReviewMessages(batch)
          const raw = await callDeepSeek(keys, messages, 7500, 0.2)
          const parsed = tentarParsearJSON(raw)
          const results = parsed && Array.isArray(parsed.results) ? parsed.results : []
          console.log(`✅ Lote ${batchIdx + 1}/${batches.length}: ${results.length}/${batch.length} avaliadas`)
          return { batch, results }
        } catch (e: any) {
          console.error(`❌ Lote ${batchIdx + 1}/${batches.length} falhou:`, e.message)
          return { batch, results: [] as any[] }
        }
      }),
    )

    const candidates: { id: string; original: QuestionRow; fixed: NonNullable<ReturnType<typeof sanitizeCorrection>>; issues: string[] }[] = []

    for (const { batch, results } of batchResults) {
      for (const item of results) {
        if (!item || item.status !== 'corrected') continue
        const idx = Number(item.index)
        const original = batch[idx]
        if (!original) continue

        const fixed = sanitizeCorrection(original, item)
        if (!fixed) {
          console.warn(`⚠️ Correção inválida descartada para questão ${original.id}`)
          continue
        }

        const unchanged =
          fixed.text === original.text &&
          fixed.correct_answer === original.correct_answer &&
          fixed.explanation === (original.explanation ?? '') &&
          JSON.stringify(fixed.alternatives) === JSON.stringify(original.alternatives)
        if (unchanged) continue

        candidates.push({ id: original.id, original, fixed, issues: Array.isArray(item.issues) ? item.issues : [] })
      }
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
          console.error(`❌ Falha ao salvar correção da questão ${candidates[i].id}:`, updateResults[i].error!.message)
          continue
        }
        const c = candidates[i]
        auditRows.push({
          question_id: c.id,
          generation_id: generationId,
          user_id: generation.user_id,
          issues_found: c.issues,
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
        const { error: auditErr } = await supabase.from('question_corrections').insert(auditRows)
        if (auditErr) console.error('❌ Falha ao salvar auditoria de correções:', auditErr.message)
      }
      corrected = auditRows.length
    }

    console.log(`🎉 Revisão concluída em ${elapsed()}: ${questions.length} analisadas, ${corrected} corrigidas`)

    return new Response(
      JSON.stringify({ success: true, reviewed: questions.length, corrected }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na revisão:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao revisar questões. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
