-- m9_track_monthly_usage.sql
-- Atualiza consume_credit para registrar uso em monthly_usage (assinantes Pro),
-- tornando-a a fonte de verdade do contador mensal exibido no modal.

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
    SET    monthly_generations = v_monthly_generations + 1,
           updated_at          = NOW()
    WHERE  id = p_user_id;
    -- Registra em monthly_usage (fonte de verdade para o modal)
    INSERT INTO public.monthly_usage (user_id, month, generations)
    VALUES (p_user_id, v_current_month, 1)
    ON CONFLICT (user_id, month)
    DO UPDATE SET generations = public.monthly_usage.generations + 1,
                 updated_at   = NOW();
    RETURN TRUE;
  END IF;

  -- 3. Créditos avulsos
  IF v_credits > 0 THEN
    UPDATE public.profiles
    SET    credits    = credits - 1,
           updated_at = NOW()
    WHERE  id = p_user_id;
    RETURN TRUE;
  END IF;

  -- 4. Plano grátis
  IF v_monthly_generations >= v_free_limit THEN RETURN FALSE; END IF;
  UPDATE public.profiles
  SET    monthly_generations = v_monthly_generations + 1,
         updated_at          = NOW()
  WHERE  id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
