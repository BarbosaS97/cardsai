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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ valid: false, error: 'Não autenticado' }, 401)

    // plan_type: 'credits' | 'subscription'
    const { code, plan_type } = await req.json()

    if (!code || !plan_type) {
      return json({ valid: false, error: 'Informe o código do cupom e o tipo de plano' }, 400)
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ valid: false, error: 'Não autenticado' }, 401)

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: coupon, error: couponErr } = await svc
      .from('coupons')
      .select('*')
      .eq('code', String(code).toUpperCase().trim())
      .single()

    if (couponErr || !coupon) {
      return json({ valid: false, error: 'Cupom não encontrado' })
    }

    if (!coupon.is_active) {
      return json({ valid: false, error: 'Cupom inativo' })
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return json({ valid: false, error: 'Cupom expirado' })
    }

    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return json({ valid: false, error: 'Cupom esgotado' })
    }

    // Valida se o cupom é permitido para o tipo de plano solicitado
    const couponPlanType: string = coupon.plan_type ?? 'all'
    if (couponPlanType !== 'all' && couponPlanType !== plan_type) {
      const label = couponPlanType === 'subscription'
        ? 'assinaturas Pro'
        : 'créditos avulsos'
      return json({ valid: false, error: `Cupom válido apenas para ${label}` })
    }

    // Verifica limite por usuário
    if (coupon.max_uses_per_user !== null) {
      const { count } = await svc
        .from('coupon_usages')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('user_id', user.id)

      if ((count ?? 0) >= coupon.max_uses_per_user) {
        return json({ valid: false, error: 'Você já utilizou este cupom' })
      }
    }

    return json({
      valid: true,
      coupon_id: coupon.id,
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: Number(coupon.discount_value),
      description: coupon.description ?? '',
      stripe_coupon_id: coupon.stripe_coupon_id ?? null,
    })

  } catch (_err) {
    return json({ valid: false, error: 'Erro interno ao validar cupom' }, 500)
  }
})
