import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=denonext'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature')
  const body = await req.text()
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

  let event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret)
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId   = session.metadata?.user_id
    const plan     = session.metadata?.plan ?? ''
    const credits  = parseInt(session.metadata?.credits ?? '0')
    const couponId = session.metadata?.coupon_id

    if (!userId) {
      console.error('stripe-webhook: user_id ausente no metadata')
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    if (plan === 'pro_monthly') {
      // Ativa assinatura Pro Mensal — 30 dias
      const { error } = await supabase.rpc('activate_subscription', {
        p_user_id: userId,
        p_plan:    'pro_monthly',
        p_days:    30,
      })
      if (error) {
        console.error('stripe-webhook: activate_subscription (pro_monthly) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), { status: 500 })
      }
      console.log(`✅ Pro Mensal ativado para ${userId}`)

    } else if (plan === 'pro_annual') {
      // Ativa assinatura Pro Anual — 365 dias
      const { error } = await supabase.rpc('activate_subscription', {
        p_user_id: userId,
        p_plan:    'pro_annual',
        p_days:    365,
      })
      if (error) {
        console.error('stripe-webhook: activate_subscription (pro_annual) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), { status: 500 })
      }
      console.log(`✅ Pro Anual ativado para ${userId}`)

    } else if (plan === 'credits_5' && credits > 0) {
      // Créditos avulsos — adiciona créditos + 30 dias Pro features
      const { error } = await supabase.rpc('grant_credits_with_pro_bonus', {
        p_user_id: userId,
        p_credits: credits,
      })
      if (error) {
        console.error('stripe-webhook: grant_credits_with_pro_bonus falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to update credits' }), { status: 500 })
      }
      console.log(`✅ ${credits} créditos + bônus Pro concedidos para ${userId}`)

    } else if (credits > 0) {
      // Retrocompatibilidade com compras antigas (sem plan no metadata)
      const { error } = await supabase.rpc('increment_credits', {
        p_user_id: userId,
        p_amount:  credits,
      })
      if (error) {
        console.error('stripe-webhook: increment_credits (legacy) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to update credits' }), { status: 500 })
      }
      console.log(`✅ ${credits} créditos (legacy) adicionados para ${userId}`)
    }

    // Registra uso de cupom (se houver)
    if (couponId) {
      await supabase.rpc('record_coupon_usage', {
        p_coupon_id: couponId,
        p_user_id:   userId,
      })
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})
