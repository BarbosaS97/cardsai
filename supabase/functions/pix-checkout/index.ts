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

    const { credits, priceRaw, couponCode } = await req.json()

    if (!credits || !priceRaw) {
      return json({ error: 'credits e priceRaw são obrigatórios' }, 400)
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let finalPrice = Number(priceRaw)
    let couponDbId: string | null = null

    if (couponCode) {
      const { data: coupon } = await svc
        .from('coupons')
        .select('id, discount_type, discount_value, is_active, expires_at, max_uses, used_count')
        .eq('code', String(couponCode).toUpperCase().trim())
        .single()

      const isValid = coupon?.is_active
        && !(coupon.expires_at && new Date(coupon.expires_at) < new Date())
        && !(coupon.max_uses != null && coupon.used_count >= coupon.max_uses)

      if (isValid) {
        const discount = coupon.discount_type === 'percentage'
          ? finalPrice * (Number(coupon.discount_value) / 100)
          : Math.min(Number(coupon.discount_value), finalPrice)
        finalPrice = Math.max(0, finalPrice - discount)
        couponDbId = coupon.id
      }
    }

    // OpenPix requires value in centavos
    const valueInCentavos = Math.round(finalPrice * 100)

    if (valueInCentavos < 1) {
      return json({ error: 'Valor mínimo para PIX é R$ 0,01' }, 400)
    }

    const correlationID = `cardsai-${user.id.replace(/-/g, '').slice(0, 12)}-${Date.now()}`

    const pixRes = await fetch('https://api.openpix.com.br/api/v1/charge', {
      method: 'POST',
      headers: {
        'Authorization': Deno.env.get('OPENPIX_APP_ID')!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        correlationID,
        value: valueInCentavos,
        comment: `${credits} gerações - CardsQuestõesAI`,
        expiresIn: 3600,
      }),
    })

    if (!pixRes.ok) {
      const errText = await pixRes.text()
      console.error('OpenPix error:', errText)
      return json({ error: 'Erro ao gerar QR Code PIX. Tente novamente.' }, 500)
    }

    const pixData = await pixRes.json()
    const charge = pixData.charge

    if (!charge?.brCode) {
      console.error('OpenPix invalid response:', JSON.stringify(pixData))
      return json({ error: 'Resposta inválida da OpenPix' }, 500)
    }

    const expiresAt = charge.expiresDate
      ? new Date(charge.expiresDate).toISOString()
      : null

    const { error: insertErr } = await svc.from('pix_charges').insert({
      user_id: user.id,
      correlation_id: correlationID,
      credits: Number(credits),
      amount: valueInCentavos,
      coupon_id: couponDbId,
      status: 'pending',
      expires_at: expiresAt,
    })

    if (insertErr) {
      console.error('pix_charges insert error:', JSON.stringify(insertErr))
      return json({ error: 'Erro ao registrar cobrança PIX. Tente novamente.' }, 500)
    }

    return json({
      correlationID,
      brCode: charge.brCode,
      qrCodeImage: charge.qrCodeImage ?? null,
      value: finalPrice,
      expiresDate: charge.expiresDate ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('pix-checkout error:', message)
    return json({ error: message }, 500)
  }
})
