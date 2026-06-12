import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  try {
    const body = await req.json()
    const { event, charge } = body

    if (event !== 'OPENPIX:CHARGE_COMPLETED' || !charge?.correlationID) {
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    const { correlationID } = charge

    const { data: pixCharge, error: findErr } = await supabase
      .from('pix_charges')
      .select('id, user_id, credits, status, coupon_id, plan')
      .eq('correlation_id', correlationID)
      .single()

    if (findErr || !pixCharge) {
      console.error('PIX charge not found for correlationID:', correlationID)
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    // Idempotência
    if (pixCharge.status === 'completed') {
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    await supabase
      .from('pix_charges')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('correlation_id', correlationID)

    const plan    = pixCharge.plan ?? ''
    const userId  = pixCharge.user_id
    const credits = pixCharge.credits

    if (plan === 'pro_monthly') {
      const { error } = await supabase.rpc('activate_subscription', {
        p_user_id: userId,
        p_plan:    'pro_monthly',
        p_days:    30,
      })
      if (error) {
        console.error('pix-webhook: activate_subscription (pro_monthly) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), { status: 500 })
      }
      console.log(`✅ PIX Pro Mensal ativado para ${userId}`)

    } else if (plan === 'pro_annual') {
      const { error } = await supabase.rpc('activate_subscription', {
        p_user_id: userId,
        p_plan:    'pro_annual',
        p_days:    365,
      })
      if (error) {
        console.error('pix-webhook: activate_subscription (pro_annual) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to activate subscription' }), { status: 500 })
      }
      console.log(`✅ PIX Pro Anual ativado para ${userId}`)

    } else if (plan === 'credits_5' && credits > 0) {
      const { error } = await supabase.rpc('grant_credits_with_pro_bonus', {
        p_user_id: userId,
        p_credits: credits,
      })
      if (error) {
        console.error('pix-webhook: grant_credits_with_pro_bonus falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to update credits' }), { status: 500 })
      }
      console.log(`✅ PIX ${credits} créditos + bônus Pro para ${userId}`)

    } else if (credits > 0) {
      // Retrocompatibilidade com cobranças antigas (sem plan)
      const { error } = await supabase.rpc('increment_credits', {
        p_user_id: userId,
        p_amount:  credits,
      })
      if (error) {
        console.error('pix-webhook: increment_credits (legacy) falhou:', error)
        return new Response(JSON.stringify({ error: 'Failed to update credits' }), { status: 500 })
      }
      console.log(`✅ PIX ${credits} créditos (legacy) para ${userId}`)
    }

    if (pixCharge.coupon_id) {
      await supabase.rpc('record_coupon_usage', {
        p_coupon_id: pixCharge.coupon_id,
        p_user_id:   userId,
      })
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    console.error('pix-webhook error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
  }
})
