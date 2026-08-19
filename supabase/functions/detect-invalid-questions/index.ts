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

const VALID_LETTERS = ['A', 'B', 'C', 'D', 'E']
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000
const MAX_REPORTED_ITEMS = 200

function normalizeAltText(alt: string): string {
  return String(alt).replace(/^[A-E]\)\s*/, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

interface QuestionRow {
  id: string
  generation_id: string
  text: string
  alternatives: string[]
  correct_answer: string
}

// Checagem determinística (sem IA): detecta o que já é mecanicamente verificável —
// alternativas ausentes/vazias, duplicadas entre si, ou gabarito que não aponta para
// nenhuma alternativa existente. Não detecta se o conteúdo está semanticamente certo
// (isso é papel da revisão por IA em review-questions).
function findInvalidReasons(q: QuestionRow): string[] {
  const reasons: string[] = []

  if (!Array.isArray(q.alternatives) || q.alternatives.length < 2) {
    reasons.push('alternativas_ausentes')
    return reasons
  }

  const normalized = q.alternatives.map(a => normalizeAltText(String(a ?? '')))

  if (normalized.some(n => n.length <= 3)) {
    reasons.push('alternativa_vazia')
  }

  const seen = new Set<string>()
  let hasDup = false
  for (const n of normalized) {
    if (n.length > 3) {
      if (seen.has(n)) hasDup = true
      seen.add(n)
    }
  }
  if (hasDup) reasons.push('alternativas_duplicadas')

  const letters = VALID_LETTERS.slice(0, q.alternatives.length)
  const correct = String(q.correct_answer ?? '').trim().toUpperCase()
  if (!letters.includes(correct)) {
    reasons.push('gabarito_invalido')
  }

  return reasons
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()
  const elapsed = () => `${Math.round((Date.now() - startTime) / 1000)}s`

  try {
    const body = await req.json().catch(() => ({}))
    const generationId: string | null = typeof body.generationId === 'string' ? body.generationId : null
    const all = body.all === true
    const remove = body.remove === true
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = Math.max(parseInt(body.offset, 10) || 0, 0)

    if (!generationId && !all) {
      return new Response(JSON.stringify({ error: 'Informe generationId ou all: true' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (generationId && all) {
      return new Response(JSON.stringify({ error: 'Use generationId OU all: true, não ambos' }), {
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

    // Modo "all" e remoção efetiva ("remove: true") sempre exigem um admin autenticado de
    // verdade — nunca a chamada interna do fluxo de geração nem um usuário comum.
    if ((all || remove) && isInternalCall) {
      return new Response(
        JSON.stringify({ error: 'Modo "all" e remoção exigem autenticação de administrador' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let userId: string | null = null
    let isAdmin = false

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
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', userId).single()
      isAdmin = !!profile?.is_admin
    }

    if ((all || remove) && !isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem usar o modo "all" ou remover questões' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let generationOwnerId: string | null = null
    if (generationId) {
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
      generationOwnerId = generation.user_id

      if (!isInternalCall && generation.user_id !== userId && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Sem permissão' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    let query = supabase.from('questions').select('id, generation_id, text, alternatives, correct_answer')
    query = generationId
      ? query.eq('generation_id', generationId).order('order_index', { ascending: true })
      : query.order('id', { ascending: true }).range(offset, offset + limit - 1)

    const { data: questions, error: qErr } = await query
    if (qErr) throw new Error(`Falha ao buscar questões: ${qErr.message}`)

    if (!questions || questions.length === 0) {
      console.log('✅ Detecção concluída: 0 analisadas, 0 inválidas')
      return new Response(
        JSON.stringify({ success: true, scanned: 0, invalid: 0, removed: 0, ...(generationId ? {} : { hasMore: false }) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const invalid: { question: QuestionRow; reasons: string[] }[] = []
    for (const q of questions as QuestionRow[]) {
      const reasons = findInvalidReasons(q)
      if (reasons.length > 0) invalid.push({ question: q, reasons })
    }

    let removed = 0
    if (remove && invalid.length > 0) {
      const ownerByGeneration = new Map<string, string>()
      if (!generationId) {
        const genIds = [...new Set(invalid.map(i => i.question.generation_id))]
        const { data: gens } = await supabase.from('generations').select('id, user_id').in('id', genIds)
        for (const g of gens ?? []) ownerByGeneration.set(g.id, g.user_id)
      }

      const idsToRemove = invalid.map(i => i.question.id)
      const { error: deleteErr } = await supabase.from('questions').delete().in('id', idsToRemove)

      if (deleteErr) {
        console.error('❌ Falha ao remover questões inválidas:', deleteErr.message)
      } else {
        removed = invalid.length

        const auditRows = invalid.map(i => ({
          question_id: i.question.id,
          generation_id: i.question.generation_id,
          user_id: generationId ? generationOwnerId : (ownerByGeneration.get(i.question.generation_id) ?? null),
          reasons: i.reasons,
          snapshot: {
            text: i.question.text,
            alternatives: i.question.alternatives,
            correct_answer: i.question.correct_answer,
          },
        }))

        const { error: auditErr } = await supabase.from('invalid_question_removals').insert(auditRows)
        if (auditErr) console.error('❌ Falha ao salvar auditoria de remoção:', auditErr.message)

        // Recalcula question_count das gerações afetadas para manter o contador exato.
        const affectedGenIds = [...new Set(invalid.map(i => i.question.generation_id))]
        await Promise.all(
          affectedGenIds.map(async (genId) => {
            const { count } = await supabase
              .from('questions')
              .select('id', { count: 'exact', head: true })
              .eq('generation_id', genId)
            await supabase.from('generations').update({ question_count: count ?? 0 }).eq('id', genId)
          }),
        )
      }
    }

    const statusSuffix = invalid.length > 0 ? '' : ' (nenhuma questão inválida encontrada)'
    console.log(
      `✅ Detecção concluída: ${questions.length} analisadas, ${invalid.length} inválidas, ${removed} removidas${statusSuffix} — ${elapsed()}`,
    )

    return new Response(
      JSON.stringify({
        success: true,
        scanned: questions.length,
        invalid: invalid.length,
        removed,
        questions: invalid.slice(0, MAX_REPORTED_ITEMS).map(i => ({
          id: i.question.id,
          generation_id: i.question.generation_id,
          reasons: i.reasons,
          text: i.question.text?.substring(0, 120),
        })),
        ...(generationId ? {} : { hasMore: questions.length === limit, nextOffset: offset + questions.length }),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na detecção de questões inválidas:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao detectar questões inválidas. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
