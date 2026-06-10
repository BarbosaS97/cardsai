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

    const { credits, priceId, couponCode } = await req.json()

    if (!priceId || !credits) {
      return json({ error: 'priceId e credits são obrigatórios' }, 400)
    }

    const sessionParams: Record<string, unknown> = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: 'https://cardsquestoes.com.br/pricing.html?success=true',
      cancel_url: 'https://cardsquestoes.com.br/pricing.html?canceled=true',
      metadata: { user_id: user.id, credits: String(credits), coupon_id: '' },
    }

    if (couponCode) {
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
          // Create Stripe coupon dynamically since admin didn't pre-link one
          const params: Stripe.CouponCreateParams = { duration: 'once' }

          if (coupon.discount_type === 'percentage') {
            params.percent_off = Number(coupon.discount_value)
          } else {
            // amount_off must be in centavos (BRL smallest unit)
            params.amount_off = Math.round(Number(coupon.discount_value) * 100)
            params.currency = 'brl'
          }

          const created = await stripe.coupons.create(params)
          stripeCouponId = created.id

          // Cache for future uses
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
