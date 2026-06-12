-- m8_admin_set_plan_dates.sql
-- Adiciona suporte a datas de início e fim personalizadas na promoção de planos.
-- Substitui a versão anterior (m7). Execute no Supabase SQL Editor.
--
-- Parâmetros novos:
--   p_start_date : timestamptz — início da assinatura (default: NOW())
--   p_end_date   : timestamptz — fim da assinatura    (default: start + p_days)
--
-- Lógica para planos Pro:
--   1. Se p_end_date for informado → usa diretamente como subscription_end_date
--   2. Se p_start_date for informado mas não p_end_date → start + p_days
--   3. Se nenhum for informado → NOW() + p_days   (comportamento original)
--
-- Lógica para créditos:
--   - Se p_end_date for informado → usa como pro_features_until
--   - Caso contrário → mantém comportamento original (+30 dias de bônus)

CREATE OR REPLACE FUNCTION public.admin_set_plan(
  p_user_id    UUID,
  p_plan       TEXT,
  p_credits    INTEGER     DEFAULT 5,
  p_days       INTEGER     DEFAULT NULL,
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date   TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_days  INTEGER;
  v_start TIMESTAMPTZ;
  v_end   TIMESTAMPTZ;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores podem alterar planos';
  END IF;

  v_start := COALESCE(p_start_date, NOW());

  -- ── Grátis: remove assinatura e bônus Pro ────────────────────────────────
  IF p_plan = 'free' THEN
    UPDATE public.profiles
    SET subscription_status   = 'free',
        subscription_plan     = NULL,
        subscription_end_date = NULL,
        pro_features_until    = NULL,
        updated_at            = NOW()
    WHERE id = p_user_id;

  -- ── Créditos Avulsos: adiciona créditos + bônus Pro ──────────────────────
  ELSIF p_plan = 'credits' THEN
    v_end := CASE
      WHEN p_end_date IS NOT NULL THEN p_end_date
      ELSE GREATEST(COALESCE(
             (SELECT pro_features_until FROM public.profiles WHERE id = p_user_id),
             v_start
           ), v_start) + INTERVAL '30 days'
    END;

    UPDATE public.profiles
    SET credits            = COALESCE(credits, 0) + COALESCE(p_credits, 5),
        pro_features_until = v_end,
        updated_at         = NOW()
    WHERE id = p_user_id;

  -- ── Pro Mensal / Pro Anual ────────────────────────────────────────────────
  ELSIF p_plan IN ('pro_monthly', 'pro_annual') THEN
    v_days := CASE
      WHEN p_days IS NOT NULL AND p_days > 0 THEN p_days
      WHEN p_plan = 'pro_monthly'             THEN 30
      ELSE                                         365
    END;

    v_end := CASE
      WHEN p_end_date IS NOT NULL THEN p_end_date
      ELSE v_start + (v_days || ' days')::INTERVAL
    END;

    UPDATE public.profiles
    SET subscription_status   = 'active',
        subscription_plan     = p_plan,
        subscription_end_date = v_end,
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
