import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ valid: false, error: 'Não autenticado' }, 401)

    const { code, package_size } = await req.json()

    if (!code || !package_size) {
      return json({ valid: false, error: 'Informe o código do cupom e o pacote' }, 400)
    }

    // Identificar o usuário pelo token da requisição
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ valid: false, error: 'Não autenticado' }, 401)

    // Service client para contornar RLS e ler cupons inativos / verificar usos
    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Buscar cupom pelo código (case-insensitive via UPPER no banco)
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

    if (
      Array.isArray(coupon.valid_for_packages) &&
      coupon.valid_for_packages.length > 0 &&
      !coupon.valid_for_packages.includes(String(package_size))
    ) {
      return json({ valid: false, error: 'Cupom não válido para este pacote' })
    }

    // Verificar limite por usuário
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
    })

  } catch (_err) {
    return json({ valid: false, error: 'Erro interno ao validar cupom' }, 500)
  }
})
