-- m5_subscriptions.sql
-- Adiciona suporte a assinaturas Pro (mensal/anual) e limite mensal de gerações
-- Execute no Supabase SQL Editor

-- ── Novas colunas em profiles ─────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status   TEXT        NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan     TEXT,
  ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_features_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monthly_generations   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_reset_date    DATE;

-- ── Coluna plan em pix_charges ────────────────────────────────────────────────
ALTER TABLE public.pix_charges
  ADD COLUMN IF NOT EXISTS plan TEXT;

-- ── Tabela monthly_usage (analytics) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monthly_usage (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month      DATE        NOT NULL,
  generations INTEGER   NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month)
);

-- ── consume_credit atualizado ─────────────────────────────────────────────────
-- Ordem de prioridade:
--   1. Admin / unlimited_access → sempre ok
--   2. Assinante Pro ativo → limite mensal de 60
--   3. Créditos avulsos (credits > 0) → consome 1 crédito
--   4. Plano grátis → limite mensal de 5
CREATE OR REPLACE FUNCTION public.consume_credit(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_credits               INTEGER;
  v_is_admin              BOOLEAN;
  v_unlimited             BOOLEAN;
  v_subscription_status   TEXT;
  v_subscription_end_date TIMESTAMPTZ;
  v_monthly_generations   INTEGER;
  v_monthly_reset_date    DATE;
  v_current_month         DATE;
  v_pro_limit             CONSTANT INTEGER := 60;
  v_free_limit            CONSTANT INTEGER := 5;
BEGIN
  SELECT credits, is_admin, unlimited_access,
         subscription_status, subscription_end_date,
         monthly_generations, monthly_reset_date
  INTO   v_credits, v_is_admin, v_unlimited,
         v_subscription_status, v_subscription_end_date,
         v_monthly_generations, v_monthly_reset_date
  FROM   public.profiles
  WHERE  id = p_user_id;

  -- 1. Admin / ilimitado
  IF v_is_admin OR v_unlimited THEN RETURN TRUE; END IF;

  v_current_month := DATE_TRUNC('month', NOW())::DATE;

  -- Reset contador mensal se virou o mês
  IF v_monthly_reset_date IS NULL OR v_monthly_reset_date < v_current_month THEN
    v_monthly_generations := 0;
    UPDATE public.profiles
    SET    monthly_generations = 0,
           monthly_reset_date  = v_current_month,
           updated_at          = NOW()
    WHERE  id = p_user_id;
  END IF;

  -- 2. Assinante Pro ativo
  IF v_subscription_status = 'active'
     AND v_subscription_end_date IS NOT NULL
     AND v_subscription_end_date > NOW()
  THEN
    IF v_monthly_generations >= v_pro_limit THEN RETURN FALSE; END IF;
    UPDATE public.profiles
    SET    monthly_generations = v_monthly_generations + 1, updated_at = NOW()
    WHERE  id = p_user_id;
    RETURN TRUE;
  END IF;

  -- 3. Créditos avulsos
  IF v_credits > 0 THEN
    UPDATE public.profiles
    SET    credits = credits - 1, updated_at = NOW()
    WHERE  id = p_user_id;
    RETURN TRUE;
  END IF;

  -- 4. Plano grátis
  IF v_monthly_generations >= v_free_limit THEN RETURN FALSE; END IF;
  UPDATE public.profiles
  SET    monthly_generations = v_monthly_generations + 1, updated_at = NOW()
  WHERE  id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── activate_subscription ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_user_id UUID,
  p_plan    TEXT,
  p_days    INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET    subscription_status   = 'active',
         subscription_plan     = p_plan,
         subscription_end_date = NOW() + (p_days || ' days')::INTERVAL,
         updated_at            = NOW()
  WHERE  id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário % não encontrado', p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── grant_credits_with_pro_bonus ──────────────────────────────────────────────
-- Credita créditos avulsos + garante 30 dias de acesso Pro
CREATE OR REPLACE FUNCTION public.grant_credits_with_pro_bonus(
  p_user_id UUID,
  p_credits INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET    credits           = COALESCE(credits, 0) + p_credits,
         pro_features_until = GREATEST(
           COALESCE(pro_features_until, NOW()),
           NOW()
         ) + INTERVAL '30 days',
         updated_at = NOW()
  WHERE  id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário % não encontrado', p_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Permissões ────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.activate_subscription        TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits_with_pro_bonus TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credit               TO authenticated;
