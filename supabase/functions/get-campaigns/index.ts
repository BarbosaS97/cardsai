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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

const VALID_POSITIONS = new Set(['credits_page', 'landing_page', 'both'])

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url      = new URL(req.url)
    const position = url.searchParams.get('position') ?? ''

    if (!VALID_POSITIONS.has(position)) {
      return json({ error: 'Parâmetro position inválido. Use: credits_page, landing_page ou both.' }, 400)
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Retorna campanhas ativas para a posição solicitada ou para 'both'
    const posFilter = position === 'both' ? ['both'] : [position, 'both']

    const { data, error } = await svc
      .from('campaigns')
      .select('id, nome, descricao, codigo_cupom, link_destino, posicao, created_at')
      .eq('ativo', true)
      .in('posicao', posFilter)
      .order('created_at', { ascending: false })

    if (error) return json({ error: error.message }, 500)

    return json(data ?? [])

  } catch (_err) {
    return json({ error: 'Erro interno' }, 500)
  }
})
