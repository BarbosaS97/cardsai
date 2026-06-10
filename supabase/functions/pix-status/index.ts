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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autenticado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Não autenticado' }, 401)

    const { correlationId } = await req.json()
    if (!correlationId) return json({ error: 'correlationId obrigatório' }, 400)

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: charge, error: queryErr } = await svc
      .from('pix_charges')
      .select('status, credits, expires_at')
      .eq('correlation_id', correlationId)
      .eq('user_id', user.id)
      .single()

    if (queryErr) {
      if (queryErr.code === 'PGRST116') {
        // PostgREST "no rows returned" — cobrança não existe
        return json({ status: 'not_found' })
      }
      console.error('pix_charges query error:', JSON.stringify(queryErr))
      return json({ error: 'Erro ao consultar cobrança' }, 500)
    }

    if (!charge) {
      return json({ status: 'not_found' })
    }

    // Mark as expired if past expiry and still pending
    if (charge.status === 'pending' && charge.expires_at && new Date(charge.expires_at) < new Date()) {
      await svc.from('pix_charges').update({ status: 'expired' }).eq('correlation_id', correlationId)
      return json({ status: 'expired' })
    }

    return json({ status: charge.status, credits: charge.credits })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('pix-status error:', message)
    return json({ error: message }, 500)
  }
})
