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

export const timeout = 60000

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
  generation_id: string
  text: string
  alternatives: string[]
  correct_answer: string
  explanation: string | null
  topic: string | null
}

function buildReviewMessages(q: QuestionRow): { role: string; content: string }[] {
  const prompt = `Analise atentamente a questão abaixo.

Verifique:
- O enunciado é claro e correto?
- As alternativas são coerentes e distintas?
- O gabarito está correto?
- A explicação justifica o gabarito?

Resolva a questão de forma independente antes de decidir se o gabarito está correto — não confie cegamente na informação fornecida abaixo.

Se encontrar erro, corrija. Se estiver correta, apenas confirme.

Assunto/Tópico: ${q.topic || 'Geral'}
Enunciado: ${q.text}
Alternativas:
${q.alternatives.map(a => `  ${a}`).join('\n')}
Gabarito informado: ${q.correct_answer}
Explicação informada: ${q.explanation || '(nenhuma)'}

Responda APENAS em JSON (sem markdown, sem texto fora do JSON), no seguinte formato:
{
  "correta": true ou false,
  "texto": "enunciado (igual ao original se já estiver correto, ou corrigido se necessário)",
  "alternativas": ["A) ...", "B) ...", ...],
  "gabarito": "A",
  "explicacao": "explicação (igual à original se já estiver correta, ou nova explicação corrigida e coerente com o gabarito)",
  "motivo": "breve descrição do que foi corrigido, ou \\"Nenhuma correção necessária\\" se estiver tudo certo"
}

REGRAS OBRIGATÓRIAS:
- Mantenha o MESMO número de alternativas (${q.alternatives.length}) e os mesmos prefixos de letra.
- Todas as alternativas devem ser DIFERENTES entre si — nunca repita o mesmo texto em duas alternativas.
- "gabarito" deve ser uma letra que corresponda a uma alternativa que você mesmo verificou ser a correta.
- Use apenas conhecimento real, consolidado e verificável. Nunca invente leis, artigos, fórmulas, fatos ou dados.
- Todo o conteúdo deve estar em português.`

  return [
    {
      role: 'system',
      content:
        'Você é um especialista revisor de questões de múltipla escolha, chamado sob demanda por um usuário que suspeita de um erro nesta ' +
        'questão específica. Resolva a questão de forma independente e completa antes de confiar no gabarito informado. Nunca invente ' +
        'informações. Seja honesto: se encontrar um erro real, corrija por completo; se a questão já estiver correta, apenas confirme sem alterá-la. ' +
        'Retorne APENAS JSON válido.',
    },
    { role: 'user', content: prompt },
  ]
}

function sanitizeReview(
  original: QuestionRow,
  item: any,
): { text: string; alternatives: string[]; correct_answer: string; explanation: string } | null {
  const text = typeof item?.texto === 'string' ? item.texto.trim() : ''
  if (text.length < 10) return null

  const alternatives = Array.isArray(item?.alternativas)
    ? item.alternativas.map((a: any) => String(a).trim())
    : []
  const altsValid =
    alternatives.length === original.alternatives.length &&
    alternatives.length >= 4 &&
    alternatives.every((a: string) => a.length > 3)
  if (!altsValid) return null
  if (hasDuplicateAlternatives(alternatives)) return null

  const correctAnswer = typeof item?.gabarito === 'string' ? item.gabarito.trim().toUpperCase() : ''
  const validLetters = VALID_LETTERS.slice(0, alternatives.length)
  if (!validLetters.includes(correctAnswer)) return null

  const explanation = typeof item?.explicacao === 'string' ? item.explicacao.trim() : ''
  if (explanation.length < 5) return null

  return { text, alternatives, correct_answer: correctAnswer, explanation }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { questionId } = body

    if (!questionId) {
      return new Response(JSON.stringify({ error: 'questionId é obrigatório' }), {
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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
    const userId = user.id

    const { data: question, error: qErr } = await supabase
      .from('questions')
      .select('id, generation_id, text, alternatives, correct_answer, explanation, topic')
      .eq('id', questionId)
      .single()

    if (qErr || !question) {
      return new Response(JSON.stringify({ error: 'Questão não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: generation, error: genErr } = await supabase
      .from('generations')
      .select('id, user_id')
      .eq('id', question.generation_id)
      .single()

    if (genErr || !generation) {
      return new Response(JSON.stringify({ error: 'Geração não encontrada' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (generation.user_id !== userId) {
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', userId).single()
      if (!profile?.is_admin) {
        return new Response(JSON.stringify({ error: 'Sem permissão para revisar esta questão' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const keys = loadApiKeys()
    if (keys.length === 0) throw new Error('Nenhuma DEEPSEEK_API_KEY configurada')

    console.log(`🔍 Revisão individual solicitada — questão ${questionId} (usuário ${userId})`)

    const raw = await callDeepSeek(keys, buildReviewMessages(question as QuestionRow), 2000, 0.2)
    const parsed = tentarParsearJSON(raw)

    if (!parsed) {
      console.error(`❌ Revisão individual: resposta da IA sem JSON válido para questão ${questionId}`)
      return new Response(JSON.stringify({ error: 'Não foi possível revisar a questão agora. Tente novamente.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fixed = sanitizeReview(question as QuestionRow, parsed)
    if (!fixed) {
      console.error(`❌ Revisão individual: correção estruturalmente inválida para questão ${questionId}`)
      return new Response(JSON.stringify({ error: 'A revisão retornou um resultado inválido. Tente novamente.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const q = question as QuestionRow
    const unchanged =
      fixed.text === q.text &&
      fixed.correct_answer === q.correct_answer &&
      fixed.explanation === (q.explanation ?? '') &&
      JSON.stringify(fixed.alternatives) === JSON.stringify(q.alternatives)

    const motivo = typeof parsed.motivo === 'string' && parsed.motivo.trim() ? parsed.motivo.trim() : null

    if (unchanged) {
      console.log(`✅ Revisão individual concluída: questão ${questionId} já estava correta`)
      return new Response(
        JSON.stringify({
          success: true,
          corrected: false,
          motivo: motivo ?? 'Nenhuma correção necessária.',
          question: { id: q.id, text: q.text, alternatives: q.alternatives, correct_answer: q.correct_answer, explanation: q.explanation, topic: q.topic },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: updateErr } = await supabase
      .from('questions')
      .update({
        text: fixed.text,
        alternatives: fixed.alternatives,
        correct_answer: fixed.correct_answer,
        explanation: fixed.explanation,
      })
      .eq('id', questionId)

    if (updateErr) {
      console.error(`❌ Falha ao salvar revisão individual da questão ${questionId}:`, updateErr.message)
      return new Response(JSON.stringify({ error: 'Falha ao salvar a correção. Tente novamente.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: auditErr } = await supabase.from('question_corrections').insert({
      question_id: q.id,
      generation_id: q.generation_id,
      user_id: generation.user_id,
      issues_found: motivo ? [motivo] : ['revisao_manual'],
      before: { text: q.text, alternatives: q.alternatives, correct_answer: q.correct_answer, explanation: q.explanation },
      after: fixed,
    })
    if (auditErr) console.error('❌ Falha ao salvar auditoria da revisão individual:', auditErr.message)

    console.log(`✅ Revisão individual concluída: questão ${questionId} corrigida (${motivo ?? 'sem motivo informado'})`)

    return new Response(
      JSON.stringify({
        success: true,
        corrected: true,
        motivo: motivo ?? 'Correção aplicada.',
        question: { id: q.id, text: fixed.text, alternatives: fixed.alternatives, correct_answer: fixed.correct_answer, explanation: fixed.explanation, topic: q.topic },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na revisão individual:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao revisar questão. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
