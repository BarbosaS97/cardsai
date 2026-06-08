-- Migração: Rate limiting para gerações de IA
-- Execute no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generation_rate_limits (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_gen_rate_limits_user
  ON public.generation_rate_limits (user_id, window_start DESC);

ALTER TABLE public.generation_rate_limits ENABLE ROW LEVEL SECURITY;

-- Somente o service_role (Edge Functions) escreve nessa tabela
CREATE POLICY "rate_limits_service_only" ON public.generation_rate_limits
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ─── Função: tenta reservar um slot de geração ───────────────────────────────
-- Retorna TRUE se dentro do limite, FALSE se excedeu.
-- Incrementa o contador atomicamente (INSERT ... ON CONFLICT DO UPDATE).
-- Janela: 1 hora | Limite padrão: 10 gerações por hora por usuário.
-- Usuários com unlimited_access ou is_admin são isentos.

CREATE OR REPLACE FUNCTION public.check_generation_rate_limit(
  p_user_id      UUID,
  p_max_per_hour INTEGER DEFAULT 10
)
RETURNS BOOLEAN
SECURITY DEFINER
LANGUAGE plpgsql AS $$
DECLARE
  v_window   TIMESTAMPTZ;
  v_count    INTEGER;
  v_exempt   BOOLEAN;
BEGIN
  -- Admins e usuários ilimitados ficam isentos do rate limit
  SELECT (is_admin OR unlimited_access)
    INTO v_exempt
    FROM public.profiles
    WHERE id = p_user_id;

  IF v_exempt THEN RETURN TRUE; END IF;

  v_window := date_trunc('hour', NOW());

  INSERT INTO public.generation_rate_limits (user_id, window_start, count)
    VALUES (p_user_id, v_window, 1)
    ON CONFLICT (user_id, window_start)
    DO UPDATE SET count = generation_rate_limits.count + 1
    RETURNING count INTO v_count;

  RETURN v_count <= p_max_per_hour;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_generation_rate_limit TO authenticated;

-- Limpeza automática de janelas antigas (opcional, executar via pg_cron ou manualmente)
-- DELETE FROM public.generation_rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
