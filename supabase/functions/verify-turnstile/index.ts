import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Método não permitido' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { token } = await req.json()

    if (!token || typeof token !== 'string' || token.length > 2048) {
      return new Response(JSON.stringify({ success: false, error: 'Token inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const secretKey = Deno.env.get('TURNSTILE_SECRET_KEY')
    if (!secretKey) {
      console.error('TURNSTILE_SECRET_KEY não configurada')
      return new Response(JSON.stringify({ success: false, error: 'Configuração interna ausente' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Obtém o IP real do visitante para validação adicional do Cloudflare
    const remoteip =
      req.headers.get('CF-Connecting-IP') ??
      req.headers.get('X-Forwarded-For')?.split(',')[0].trim() ??
      undefined

    const body = new URLSearchParams({ secret: secretKey, response: token })
    if (remoteip) body.set('remoteip', remoteip)

    const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    })

    if (!cfRes.ok) {
      console.error('Cloudflare siteverify HTTP error:', cfRes.status)
      return new Response(JSON.stringify({ success: false, error: 'Erro ao verificar desafio' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await cfRes.json()

    // Cloudflare retorna { success: true/false, error-codes: [...] }
    if (!result.success) {
      console.warn('Turnstile falhou:', result['error-codes'])
    }

    return new Response(
      JSON.stringify({ success: !!result.success }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: any) {
    console.error('verify-turnstile erro:', err.message)
    return new Response(JSON.stringify({ success: false, error: 'Erro interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
