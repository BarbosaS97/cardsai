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

// Inteiro aleatório uniforme em [0, maxExclusive) via crypto, com rejection sampling
// para eliminar o viés de módulo (garante randomização real, não apenas Math.random()).
function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0
  const range = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  let x: number
  do {
    crypto.getRandomValues(buf)
    x = buf[0]
  } while (x >= range)
  return x % maxExclusive
}

function secureShuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function stripLetterPrefix(alt: string): string {
  return alt.replace(/^[A-E]\)\s*/, '').trim()
}

interface QuestionRow {
  id: string
  generation_id: string
  alternatives: string[]
  correct_answer: string
}

function randomizeQuestion(q: QuestionRow): { alternatives: string[]; correct_answer: string } | null {
  if (!Array.isArray(q.alternatives) || q.alternatives.length < 2) return null

  const letters = VALID_LETTERS.slice(0, q.alternatives.length)
  const correctIdx = letters.indexOf((q.correct_answer || '').trim().toUpperCase())
  if (correctIdx === -1) return null

  const items = q.alternatives.map((alt, i) => ({
    content: stripLetterPrefix(String(alt)),
    wasCorrect: i === correctIdx,
  }))

  const shuffled = secureShuffle(items)
  const alternatives = shuffled.map((item, i) => `${letters[i]}) ${item.content}`)
  const newCorrectIdx = shuffled.findIndex(item => item.wasCorrect)
  const correct_answer = letters[newCorrectIdx]

  return { alternatives, correct_answer }
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

    // Chamada interna (process-pdf/generate-subject usam a service role key diretamente
    // após a geração) pula a checagem de usuário — mas só é aceita no modo por geração.
    // O modo "all" (todas as questões do sistema) sempre exige um admin autenticado de verdade.
    const isInternalCall = token === serviceRoleKey

    if (all && isInternalCall) {
      return new Response(JSON.stringify({ error: 'Modo "all" exige autenticação de administrador' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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

    if (all && !isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Apenas administradores podem randomizar todas as questões do sistema' }),
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

    let query = supabase.from('questions').select('id, generation_id, alternatives, correct_answer')
    query = generationId
      ? query.eq('generation_id', generationId).order('order_index', { ascending: true })
      : query.order('id', { ascending: true }).range(offset, offset + limit - 1)

    const { data: questions, error: qErr } = await query
    if (qErr) throw new Error(`Falha ao buscar questões: ${qErr.message}`)

    if (!questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, changed: 0, ...(generationId ? {} : { hasMore: false }) }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // No modo "all", precisamos saber o dono de cada questão (via generation_id) para a auditoria.
    const ownerByGeneration = new Map<string, string>()
    if (!generationId) {
      const genIds = [...new Set((questions as any[]).map(q => q.generation_id))]
      const { data: gens } = await supabase.from('generations').select('id, user_id').in('id', genIds)
      for (const g of gens ?? []) ownerByGeneration.set(g.id, g.user_id)
    }

    const updates: { id: string; generation_id: string; before: any; after: { alternatives: string[]; correct_answer: string } }[] = []

    for (const q of questions as QuestionRow[]) {
      const result = randomizeQuestion(q)
      if (!result) continue

      const unchanged =
        result.correct_answer === q.correct_answer &&
        JSON.stringify(result.alternatives) === JSON.stringify(q.alternatives)
      if (unchanged) continue

      updates.push({
        id: q.id,
        generation_id: q.generation_id,
        before: { alternatives: q.alternatives, correct_answer: q.correct_answer },
        after: result,
      })
    }

    let changed = 0
    if (updates.length > 0) {
      const updateResults = await Promise.all(
        updates.map(u =>
          supabase
            .from('questions')
            .update({ alternatives: u.after.alternatives, correct_answer: u.after.correct_answer })
            .eq('id', u.id),
        ),
      )

      const auditRows: any[] = []
      for (let i = 0; i < updates.length; i++) {
        if (updateResults[i].error) {
          console.error(`❌ Falha ao salvar randomização da questão ${updates[i].id}:`, updateResults[i].error!.message)
          continue
        }
        const u = updates[i]
        auditRows.push({
          question_id: u.id,
          generation_id: u.generation_id,
          user_id: generationId ? generationOwnerId : (ownerByGeneration.get(u.generation_id) ?? null),
          before: u.before,
          after: u.after,
        })
      }

      if (auditRows.length > 0) {
        const { error: auditErr } = await supabase.from('answer_randomizations').insert(auditRows)
        if (auditErr) console.error('❌ Falha ao salvar auditoria de randomização:', auditErr.message)
      }
      changed = auditRows.length
    }

    console.log(`🎲 Randomização concluída em ${elapsed()}: ${questions.length} processadas, ${changed} alteradas`)

    return new Response(
      JSON.stringify({
        success: true,
        processed: questions.length,
        changed,
        ...(generationId ? {} : { hasMore: questions.length === limit, nextOffset: offset + questions.length }),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('❌ Erro fatal na randomização:', error.message)
    return new Response(JSON.stringify({ error: 'Erro interno ao randomizar respostas. Tente novamente.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
