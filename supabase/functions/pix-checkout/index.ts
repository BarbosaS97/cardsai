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

// Preços fixos dos planos Pro (em R$)
const PRO_PLAN_PRICES: Record<string, number> = {
  pro_monthly: 59.90,
  pro_annual:  598.80,
  credits_5:   14.90,
}

// Descrições dos planos para o comentário da cobrança
const PRO_PLAN_LABELS: Record<string, string> = {
  pro_monthly: 'Pro Mensal (30 dias) — CardsQuestõesAI',
  pro_annual:  'Pro Anual (365 dias) — CardsQuestõesAI',
  credits_5:   '5 créditos avulsos — CardsQuestõesAI',
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
    // Para retrocompat: aceita também { credits, priceRaw } sem plan
    const { plan, credits, priceRaw, couponCode } = body

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let finalPrice: number
    let resolvedPlan: string
    let resolvedCredits: number
    let couponDbId: string | null = null
    let chargeComment: string

    const isProPlan = plan === 'pro_monthly' || plan === 'pro_annual'
    const isCreditsPlan = plan === 'credits_5' || (!isProPlan && credits && priceRaw)

    if (isProPlan) {
      finalPrice      = PRO_PLAN_PRICES[plan]
      resolvedPlan    = plan
      resolvedCredits = 0
      chargeComment   = PRO_PLAN_LABELS[plan]
    } else if (isCreditsPlan) {
      resolvedCredits = credits ? Number(credits) : 5
      resolvedPlan    = 'credits_5'
      finalPrice      = priceRaw ? Number(priceRaw) : PRO_PLAN_PRICES.credits_5
      chargeComment   = PRO_PLAN_LABELS.credits_5
    } else {
      return json({ error: 'Parâmetros inválidos. Informe plan: credits_5 | pro_monthly | pro_annual' }, 400)
    }

    // Aplica cupom de desconto (válido para qualquer plano conforme plan_type do cupom)
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
        value:     valueInCentavos,
        comment:   chargeComment,
        expiresIn: 3600,
      }),
    })

    if (!pixRes.ok) {
      const errText = await pixRes.text()
      console.error('OpenPix error:', errText)
      return json({ error: 'Erro ao gerar QR Code PIX. Tente novamente.' }, 500)
    }

    const pixData = await pixRes.json()
    const charge  = pixData.charge

    if (!charge?.brCode) {
      console.error('OpenPix invalid response:', JSON.stringify(pixData))
      return json({ error: 'Resposta inválida da OpenPix' }, 500)
    }

    const expiresAt = charge.expiresDate
      ? new Date(charge.expiresDate).toISOString()
      : null

    const { error: insertErr } = await svc.from('pix_charges').insert({
      user_id:        user.id,
      correlation_id: correlationID,
      credits:        resolvedCredits,
      amount:         valueInCentavos,
      coupon_id:      couponDbId,
      plan:           resolvedPlan,
      status:         'pending',
      expires_at:     expiresAt,
    })

    if (insertErr) {
      console.error('pix_charges insert error:', JSON.stringify(insertErr))
      return json({ error: 'Erro ao registrar cobrança PIX. Tente novamente.' }, 500)
    }

    return json({
      correlationID,
      brCode:      charge.brCode,
      qrCodeImage: charge.qrCodeImage ?? null,
      value:       finalPrice,
      expiresDate: charge.expiresDate ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('pix-checkout error:', message)
    return json({ error: message }, 500)
  }
})
