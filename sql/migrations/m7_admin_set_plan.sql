-- m7_admin_set_plan.sql
-- Permite que admins promovam qualquer usuário a qualquer plano via painel admin.
-- Execute no Supabase SQL Editor.

-- ─── Função principal ─────────────────────────────────────────────────────────
-- p_plan    : 'free' | 'credits' | 'pro_monthly' | 'pro_annual'
-- p_credits : créditos a adicionar (somente para p_plan = 'credits', default 5)
-- p_days    : dias de acesso (somente para planos Pro; NULL usa o padrão do plano)

CREATE OR REPLACE FUNCTION public.admin_set_plan(
  p_user_id UUID,
  p_plan    TEXT,
  p_credits INTEGER DEFAULT 5,
  p_days    INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_days INTEGER;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores podem alterar planos';
  END IF;

  -- ── Grátis: remove assinatura e bônus Pro ─────────────────────────────────
  IF p_plan = 'free' THEN
    UPDATE public.profiles
    SET subscription_status   = 'free',
        subscription_plan     = NULL,
        subscription_end_date = NULL,
        pro_features_until    = NULL,
        updated_at            = NOW()
    WHERE id = p_user_id;

  -- ── Créditos Avulsos: adiciona créditos + 30 dias Pro de bônus ────────────
  ELSIF p_plan = 'credits' THEN
    UPDATE public.profiles
    SET credits            = COALESCE(credits, 0) + COALESCE(p_credits, 5),
        pro_features_until = GREATEST(
                               COALESCE(pro_features_until, NOW()),
                               NOW()
                             ) + INTERVAL '30 days',
        updated_at         = NOW()
    WHERE id = p_user_id;

  -- ── Pro Mensal / Pro Anual ────────────────────────────────────────────────
  ELSIF p_plan IN ('pro_monthly', 'pro_annual') THEN
    v_days := CASE
      WHEN p_days IS NOT NULL AND p_days > 0 THEN p_days
      WHEN p_plan = 'pro_monthly'             THEN 30
      ELSE                                         365
    END;
    UPDATE public.profiles
    SET subscription_status   = 'active',
        subscription_plan     = p_plan,
        subscription_end_date = NOW() + (v_days || ' days')::INTERVAL,
        updated_at            = NOW()
    WHERE id = p_user_id;

  ELSE
    RAISE EXCEPTION 'Plano inválido: %. Use: free | credits | pro_monthly | pro_annual', p_plan;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário % não encontrado', p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_set_plan TO authenticated;
