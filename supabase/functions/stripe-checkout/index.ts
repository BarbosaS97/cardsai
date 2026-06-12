import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(),
})

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

// Price IDs dos planos Pro — configurar como secrets no Supabase:
//   supabase secrets set PRO_MONTHLY_PRICE_ID=price_xxx
//   supabase secrets set PRO_ANNUAL_PRICE_ID=price_xxx
function getProPriceId(plan: string): string | null {
  if (plan === 'pro_monthly') return Deno.env.get('PRO_MONTHLY_PRICE_ID') ?? null
  if (plan === 'pro_annual')  return Deno.env.get('PRO_ANNUAL_PRICE_ID')  ?? null
  return null
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

    const body = await req.json()
    // plan: 'credits_5' | 'pro_monthly' | 'pro_annual'
    // Para créditos também aceita legacy: { credits, priceId }
    const { plan, credits, priceId, couponCode } = body

    const isProPlan = plan === 'pro_monthly' || plan === 'pro_annual'
    const isCreditsPlan = plan === 'credits_5' || (!isProPlan && credits && priceId)

    if (!isProPlan && !isCreditsPlan) {
      return json({ error: 'Plano inválido. Use plan: credits_5 | pro_monthly | pro_annual' }, 400)
    }

    let resolvedPriceId: string
    let resolvedCredits: number
    let resolvedPlan: string

    if (isProPlan) {
      const ppId = getProPriceId(plan)
      if (!ppId) {
        return json({
          error: `Price ID do plano "${plan}" não configurado. Configure PRO_MONTHLY_PRICE_ID ou PRO_ANNUAL_PRICE_ID nos secrets do Supabase.`,
        }, 500)
      }
      resolvedPriceId = ppId
      resolvedCredits = 0
      resolvedPlan = plan
    } else {
      // credits_5 ou legacy credits
      if (!priceId || !credits) {
        return json({ error: 'priceId e credits são obrigatórios para compra de créditos' }, 400)
      }
      resolvedPriceId = priceId
      resolvedCredits = Number(credits)
      resolvedPlan = 'credits_5'
    }

    const sessionParams: Record<string, unknown> = {
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: 'payment',
      success_url: 'https://cardsquestoes.com.br/pricing.html?success=true&plan=' + resolvedPlan,
      cancel_url: 'https://cardsquestoes.com.br/pricing.html?canceled=true',
      metadata: {
        user_id: user.id,
        plan: resolvedPlan,
        credits: String(resolvedCredits),
        coupon_id: '',
      },
    }

    // Cupom de desconto (apenas para créditos avulsos)
    if (couponCode && isCreditsPlan) {
      const svc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )

      const { data: coupon } = await svc
        .from('coupons')
        .select('id, stripe_coupon_id, discount_type, discount_value, is_active, expires_at, max_uses, used_count')
        .eq('code', String(couponCode).toUpperCase().trim())
        .single()

      const isValid = coupon?.is_active
        && !(coupon.expires_at && new Date(coupon.expires_at) < new Date())
        && !(coupon.max_uses != null && coupon.used_count >= coupon.max_uses)

      if (isValid) {
        let stripeCouponId: string = coupon.stripe_coupon_id

        if (!stripeCouponId) {
          const params: Stripe.CouponCreateParams = { duration: 'once' }
          if (coupon.discount_type === 'percentage') {
            params.percent_off = Number(coupon.discount_value)
          } else {
            params.amount_off = Math.round(Number(coupon.discount_value) * 100)
            params.currency = 'brl'
          }
          const created = await stripe.coupons.create(params)
          stripeCouponId = created.id
          await svc.from('coupons').update({ stripe_coupon_id: stripeCouponId }).eq('id', coupon.id)
        }

        sessionParams.discounts = [{ coupon: stripeCouponId }]
        ;(sessionParams.metadata as Record<string, string>).coupon_id = coupon.id
      }
    }

    const session = await stripe.checkout.sessions.create(
      sessionParams as Stripe.Checkout.SessionCreateParams
    )

    return json({ url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('stripe-checkout error:', message)
    return json({ error: message }, 500)
  }
})
