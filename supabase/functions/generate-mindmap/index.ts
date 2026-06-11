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


function cut(s: string, n: number): string {
  return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '')
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const body = await req.json()
    const { generationId, action = 'get', anotacoes } = body

    if (!generationId) {
      return json({ error: 'generationId é obrigatório' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authorization header ausente' }, 401)
    }

    // Service role client — full DB access
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // User client — verify auth
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return json({ error: 'Não autorizado' }, 401)
    }
    const userId = user.id

    // Verify ownership of the generation
    const { data: gen, error: genErr } = await supa
      .from('generations')
      .select('id, title, pdf_name, topics')
      .eq('id', generationId)
      .eq('user_id', userId)
      .single()

    if (genErr || !gen) {
      return json({ error: 'Geração não encontrada ou sem permissão' }, 403)
    }

    // ── Action: save-draw ─────────────────────────────────────
    if (action === 'save-draw') {
      if (!Array.isArray(anotacoes)) {
        return json({ error: 'anotacoes deve ser array' }, 400)
      }

      // Only update if the record already exists (mindmap must be fetched/created first via 'get')
      const { error: updErr } = await supa
        .from('mindmaps')
        .update({ anotacoes, updated_at: new Date().toISOString() })
        .eq('generation_id', generationId)
        .eq('user_id', userId)

      if (updErr) console.warn('save-draw update error:', updErr.message)

      return json({ ok: true })
    }

    // ── Action: get (default) — fetch existing or build from DB ──
    const { data: existing, error: existErr } = await supa
      .from('mindmaps')
      .select('topicos, anotacoes')
      .eq('generation_id', generationId)
      .single()

    if (!existErr && existing) {
      // Return cached map
      return json({ topicos: existing.topicos, anotacoes: existing.anotacoes })
    }

    // First time: build tree structure from flashcards + topics
    const { data: flashcards } = await supa
      .from('flashcards')
      .select('front, back, topic')
      .eq('generation_id', generationId)
      .order('order_index')

    const byTopic: Record<string, { front: string; back: string }[]> = {}
    for (const f of (flashcards ?? [])) {
      const t = ((f.topic as string) || 'Geral').trim()
      if (!byTopic[t]) byTopic[t] = []
      byTopic[t].push({ front: f.front as string, back: f.back as string })
    }

    const rawTopics: string[] = Array.isArray(gen.topics) && gen.topics.length > 0
      ? (gen.topics as string[]).slice(0, 5)
      : Object.keys(byTopic).slice(0, 5)

    const topicos = rawTopics.map((tp, i) => ({
      label: cut(tp, 24),
      colorIdx: i,
      children: (byTopic[tp] ?? []).slice(0, 5).map((f) => ({
        label: cut(f.front, 42),
        detail: f.back,
      })),
    }))

    const titulo = ((gen.title as string) || (gen.pdf_name as string) || 'Mapa Mental').trim()

    // Save to DB (upsert to handle race conditions)
    const { error: insertErr } = await supa
      .from('mindmaps')
      .upsert(
        { generation_id: generationId, user_id: userId, titulo, topicos, anotacoes: [] },
        { onConflict: 'generation_id', ignoreDuplicates: false },
      )

    if (insertErr) {
      console.warn('Erro ao persistir mindmap:', insertErr.message)
    }

    return json({ topicos, anotacoes: [] })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Erro fatal:', msg)
    return json({ error: 'Erro interno' }, 500)
  }
})
