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

    // Only process completed charges
    if (event !== 'OPENPIX:CHARGE_COMPLETED' || !charge?.correlationID) {
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    const { correlationID } = charge

    const { data: pixCharge, error: findErr } = await supabase
      .from('pix_charges')
      .select('id, user_id, credits, status')
      .eq('correlation_id', correlationID)
      .single()

    if (findErr || !pixCharge) {
      console.error('PIX charge not found for correlationID:', correlationID)
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    // Idempotency: skip if already processed
    if (pixCharge.status === 'completed') {
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    await supabase
      .from('pix_charges')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('correlation_id', correlationID)

    const { error: creditErr } = await supabase.rpc('increment_credits', {
      p_user_id: pixCharge.user_id,
      p_amount: pixCharge.credits,
    })

    if (creditErr) {
      console.error('Failed to increment credits for PIX charge:', correlationID, creditErr)
      return new Response(JSON.stringify({ error: 'Failed to update credits' }), { status: 500 })
    }

    console.log(`PIX payment confirmed: ${correlationID} — ${pixCharge.credits} créditos para ${pixCharge.user_id}`)
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err) {
    console.error('pix-webhook error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 })
  }
})
