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

const VALID_LETTERS = ['A', 'B', 'C', 'D', 'E']
const SCORE_BATCH_SIZE = 10
const MAX_REPLACEMENT_ATTEMPTS = 2

// Média mínima para cada nota. Além da média, qualquer critério isolado abaixo de
// MIN_CRITERION força a nota para "Ruim" — evita que uma única falha grave (ex:
// alternativas sem sentido) seja mascarada por uma média alta nos demais critérios.
const GRADE_THRESHOLDS = { OTIMA: 8.5, BOA: 7, MEDIA: 5 }
const MIN_CRITERION = 4

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

function normalizeTextKey(text: string): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 70)
}

interface QuestionRow {
  id: string
  text: string
  alternatives: string[]
  correct_answer: string
  explanation: string | null
  topic: string | null
}

interface QualityScores {
  clareza: number
  alternativas: number
  dificuldade: number
  relevancia: number
  originalidade: number
}

type Grade = 'Ruim' | 'Média' | 'Boa' | 'Ótima'

function clampScore(n: any): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 5
  return Math.min(10, Math.max(0, Math.round(v)))
}

function computeGrade(scores: QualityScores): Grade {
  const values = [scores.clareza, scores.alternativas, scores.dificuldade, scores.relevancia, scores.originalidade]
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const min = Math.min(...values)

  if (min < MIN_CRITERION) return 'Ruim'
  if (avg >= GRADE_THRESHOLDS.OTIMA) return 'Ótima'
  if (avg >= GRADE_THRESHOLDS.BOA) return 'Boa'
  if (avg >= GRADE_THRESHOLDS.MEDIA) return 'Média'
  return 'Ruim'
}

// Pontuação em LOTE (barata, ~5 chamadas para 50 questões): a correção factual já foi
// verificada nas etapas anteriores (review-questions / validate-content), então aqui a
// IA só precisa julgar qualidade pedagógica — uma tarefa mais leve que cabe bem em lote.
function buildScoringMessages(batch: QuestionRow[]): { role: string; content: string }[] {
  const input = batch.map((q, i) => ({
    index: i,
    topic: q.topic || 'Geral',
    text: q.text,
    alternatives: q.alternatives,
    explanation: q.explanation || '',
  }))

  const prompt = `Avalie a QUALIDADE PEDAGÓGICA (não a correção factual — isso já foi verificado em etapas anteriores) das ${batch.length} questões abaixo. Para CADA questão, dê uma nota de 0 a 10 em cada critério:

1. clareza: o enunciado é claro, objetivo e bem formulado, sem ambiguidade?
2. alternativas: as alternativas incorretas são plausíveis, distintas entre si e bem elaboradas (não óbvias, não absurdas)?
3. dificuldade: o nível de desafio é bem calibrado — nem trivial demais, nem impossivelmente difícil?
4. relevancia: o tema abordado é relevante e importante dentro do assunto?
5. originalidade: a questão é original e específica, ou é genérica/repetitiva (ex: pergunta de definição simples e óbvia)?

Questões:
${JSON.stringify(input)}

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):
{"results": [{"index": 0, "clareza": 8, "alternativas": 7, "dificuldade": 8, "relevancia": 9, "originalidade": 6}, ...]}`

  return [
    {
      role: 'system',
      content:
        'Você é um especialista em avaliação pedagógica de questões de múltipla escolha, atuando como um editor exigente de banca examinadora. ' +
        'Avalie apenas a QUALIDADE (clareza, qualidade das alternativas, calibração de dificuldade, relevância do tema, originalidade) — não questione ' +
        'a correção factual do gabarito, que já foi validada em etapas anteriores. Seja criterioso e realista: a maioria das questões deve ficar entre ' +
        '5 e 8; reserve notas 9-10 para questões realmente excepcionais e notas abaixo de 4 para questões genuinamente fracas em algum critério. ' +
        'Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]
}

// Geração de substituta: uma chamada dedicada por questão fraca (não em lote), já que
// aqui a IA precisa criar conteúdo novo e original, não apenas julgar o existente.
function buildReplacementMessages(weak: QuestionRow, generationContext: string): { role: string; content: string }[] {
  const altCount = Math.max(weak.alternatives.length, 4)
  const letters = VALID_LETTERS.slice(0, altCount)

  const prompt = `A questão abaixo foi avaliada como de BAIXA QUALIDADE pedagógica e precisa ser SUBSTITUÍDA por uma nova questão de qualidade ÓTIMA sobre o mesmo assunto.

CONTEXTO DA GERAÇÃO: ${generationContext}
ASSUNTO/TÓPICO: ${weak.topic || 'Geral'}

QUESTÃO FRACA A SUBSTITUIR (apenas para referência do assunto — NÃO reaproveite o enunciado nem as alternativas):
${weak.text}

Crie uma questão de múltipla escolha COMPLETAMENTE NOVA sobre este mesmo assunto, seguindo estes critérios de qualidade ÓTIMA:
1. Enunciado muito claro, objetivo e bem formulado, sem ambiguidade
2. ${altCount} alternativas (${letters.join(', ')}) plausíveis e claramente distintas entre si — nenhuma óbvia, absurda ou vazia
3. Gabarito correto: resolva a questão você mesmo, de forma independente, antes de decidir a alternativa correta
4. Dificuldade bem calibrada — nem trivial, nem impossível
5. Tema relevante e questão específica e original (evite perguntas genéricas de definição óbvia)
6. Explicação detalhada e educativa, coerente com o gabarito

Use apenas conhecimento real, consolidado e verificável. NUNCA invente leis, artigos, fórmulas, fatos ou dados.

Retorne APENAS este JSON (sem markdown, sem texto fora do JSON):
{
  "text": "novo enunciado",
  "alternatives": ["${letters[0]}) ...", "${letters[1]}) ...", ${letters.slice(2).map(l => `"${l}) ..."`).join(', ')}],
  "correct_answer": "X",
  "explanation": "explicação detalhada",
  "topic": "subtópico específico"
}`

  return [
    {
      role: 'system',
      content:
        'Você é um especialista em criar questões de múltipla escolha de altíssima qualidade pedagógica. ' +
        'Crie questões claras, originais, com alternativas plausíveis e gabarito verificado por você mesmo antes de responder. ' +
        'Use apenas conhecimento real e academicamente consolidado. Nunca invente informações. Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]
}

function sanitizeReplacement(
  item: any,
  altCount: number,
): { text: string; alternatives: string[]; correct_answer: string; explanation: string; topic: string | null } | null {
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  if (text.length < 10) return null

  let alternatives = Array.isArray(item?.alternatives) ? item.alternatives.map((a: any) => String(a).trim()) : []
  if (alternatives.length < 4 || !alternatives.every((a: string) => normalizeAltText(a).length > 3)) return null
  if (alternatives.length > altCount) alternatives = alternatives.slice(0, altCount)
  if (hasDuplicateAlternatives(alternatives)) return null

  const letters = VALID_LETTERS.slice(0, alternatives.length)
  const correctAnswer = typeof item?.correct_answer === 'string' ? item.correct_answer.trim().toUpperCase() : ''
  if (!letters.includes(correctAnswer)) return null

  const explanation = typeof item?.explanation === 'string' ? item.explanation.trim() : ''
  if (explanation.length < 5) return null

  const topic = typeof item?.topic === 'string' && item.topic.trim() ? item.topic.trim() : null

  return { text, alternatives, correct_answer: correctAnswer, explanation, topic }
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
      console.log('✅ Avaliação de qualidade concluída: 0 avaliadas, 0 substituídas (nenhuma questão encontrada para esta geração)')
      return new Response(JSON.stringify({ success: true, assessed: 0, replaced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const keys = loadApiKeys()
    if (keys.length === 0) throw new Error('Nenhuma DEEPSEEK_API_KEY configurada')

    const generationContext = [generation.title, generation.study_mode ? `modo: ${generation.study_mode}` : null]
      .filter(Boolean)
      .join(' — ') || 'Sem contexto adicional'

    // ── 1. Pontuação em lote ──────────────────────────────────────────────
    const batches: QuestionRow[][] = []
    for (let i = 0; i < questions.length; i += SCORE_BATCH_SIZE) {
      batches.push((questions as QuestionRow[]).slice(i, i + SCORE_BATCH_SIZE))
    }

    console.log(`📊 Avaliando qualidade de ${questions.length} questões (geração ${generationId}) em ${batches.length} lote(s)...`)

    const batchResults = await Promise.all(
      batches.map(async (batch, batchIdx) => {
        try {
          const raw = await callDeepSeek(keys, buildScoringMessages(batch), 2000, 0.3)
          const parsed = tentarParsearJSON(raw)
          const results = parsed && Array.isArray(parsed.results) ? parsed.results : []
          console.log(`✅ Lote ${batchIdx + 1}/${batches.length}: ${results.length}/${batch.length} pontuadas`)
          return { batch, results, failed: false }
        } catch (e: any) {
          console.error(`❌ Lote ${batchIdx + 1}/${batches.length} falhou:`, e.message)
          return { batch, results: [] as any[], failed: true }
        }
      }),
    )

    const scoreFailedBatches = batchResults.filter(b => b.failed).length

    const assessed: { question: QuestionRow; scores: QualityScores; grade: Grade }[] = []
    for (const { batch, results } of batchResults) {
      for (const item of results) {
        const idx = Number(item?.index)
        const question = batch[idx]
        if (!question) continue
        const scores: QualityScores = {
          clareza: clampScore(item.clareza),
          alternativas: clampScore(item.alternativas),
          dificuldade: clampScore(item.dificuldade),
          relevancia: clampScore(item.relevancia),
          originalidade: clampScore(item.originalidade),
        }
        assessed.push({ question, scores, grade: computeGrade(scores) })
      }
    }

    const gradeCounts: Record<Grade, number> = { Ruim: 0, Média: 0, Boa: 0, Ótima: 0 }
    for (const a of assessed) gradeCounts[a.grade]++

    // ── 2. Substituição individual das questões Ruim/Média ───────────────
    const weakItems = assessed.filter(a => a.grade === 'Ruim' || a.grade === 'Média')
    const existingKeys = new Set((questions as QuestionRow[]).map(q => normalizeTextKey(q.text)))

    let replaced = 0
    const replacementSnapshots: { question: QuestionRow; scores: QualityScores; grade: Grade; before: any; after: any }[] = []

    if (weakItems.length > 0) {
      console.log(`🔄 ${weakItems.length} questão(ões) fraca(s) — gerando substitutas...`)

      const replacements = await Promise.all(
        weakItems.map(async ({ question, scores, grade }) => {
          const altCount = question.alternatives.length || 4
          for (let attempt = 1; attempt <= MAX_REPLACEMENT_ATTEMPTS; attempt++) {
            try {
              const raw = await callDeepSeek(keys, buildReplacementMessages(question, generationContext), 2500, 0.6)
              const parsed = tentarParsearJSON(raw)
              const fixed = sanitizeReplacement(parsed, altCount)
              if (!fixed) continue
              const key = normalizeTextKey(fixed.text)
              if (key !== normalizeTextKey(question.text) && existingKeys.has(key)) continue // colidiu com outra questão já existente
              existingKeys.add(key)
              return { question, scores, grade, fixed }
            } catch (e: any) {
              console.error(`❌ Substituição da questão ${question.id} tentativa ${attempt}:`, e.message)
            }
          }
          console.warn(`⚠️ Não foi possível gerar substituta válida para a questão ${question.id} — mantendo original`)
          return null
        }),
      )

      const toUpdate = replacements.filter((r): r is NonNullable<typeof r> => r !== null)

      if (toUpdate.length > 0) {
        const updateResults = await Promise.all(
          toUpdate.map(r =>
            supabase
              .from('questions')
              .update({
                text: r.fixed.text,
                alternatives: r.fixed.alternatives,
                correct_answer: r.fixed.correct_answer,
                explanation: r.fixed.explanation,
                ...(r.fixed.topic ? { topic: r.fixed.topic } : {}),
              })
              .eq('id', r.question.id),
          ),
        )

        for (let i = 0; i < toUpdate.length; i++) {
          if (updateResults[i].error) {
            console.error(`❌ Falha ao salvar substituição da questão ${toUpdate[i].question.id}:`, updateResults[i].error!.message)
            continue
          }
          const r = toUpdate[i]
          replacementSnapshots.push({
            question: r.question,
            scores: r.scores,
            grade: r.grade,
            before: {
              text: r.question.text,
              alternatives: r.question.alternatives,
              correct_answer: r.question.correct_answer,
              explanation: r.question.explanation,
            },
            after: r.fixed,
          })
        }
        replaced = replacementSnapshots.length
      }
    }

    // ── 3. Auditoria: registra a avaliação de TODA questão pontuada ──────
    const replacedIds = new Set(replacementSnapshots.map(r => r.question.id))
    const auditRows = assessed.map(a => {
      const wasReplaced = replacedIds.has(a.question.id)
      const snapshot = wasReplaced ? replacementSnapshots.find(r => r.question.id === a.question.id) : null
      return {
        question_id: a.question.id,
        generation_id: generationId,
        user_id: generation.user_id,
        clareza: a.scores.clareza,
        alternativas_score: a.scores.alternativas,
        dificuldade_score: a.scores.dificuldade,
        relevancia_score: a.scores.relevancia,
        originalidade_score: a.scores.originalidade,
        grade: a.grade,
        replaced: wasReplaced,
        before: snapshot?.before ?? null,
        after: snapshot?.after ?? null,
      }
    })

    if (auditRows.length > 0) {
      const { error: auditErr } = await supabase.from('quality_assessments').insert(auditRows)
      if (auditErr) console.error('❌ Falha ao salvar auditoria de avaliação de qualidade:', auditErr.message)
    }

    const statusSuffix =
      replaced > 0
        ? ''
        : scoreFailedBatches > 0
          ? ` (falha ao avaliar ${scoreFailedBatches}/${batches.length} lote(s))`
          : ' (todas as questões já estavam Boa ou Ótima)'
    console.log(
      `✅ Avaliação de qualidade concluída: ${assessed.length} avaliadas, ${replaced} substituídas${statusSuffix} ` +
      `(Ótima=${gradeCounts['Ótima']} Boa=${gradeCounts['Boa']} Média=${gradeCounts['Média']} Ruim=${gradeCounts['Ruim']}) — ${elapsed()}`,
    )

    return new Response(
      JSON.stringify({ success: true, assessed: assessed.length, replaced, grades: gradeCounts }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na avaliação de qualidade:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao avaliar qualidade. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
