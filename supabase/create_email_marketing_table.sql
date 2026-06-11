-- Email Marketing: tabela de envios
-- Execute no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.email_marketing_sends (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  html_body        TEXT        NOT NULL,
  sent_by          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  total_recipients INTEGER     NOT NULL DEFAULT 0,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  error_count      INTEGER     NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'completed',  -- sending | completed | failed
  is_test          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ
);

-- RLS
ALTER TABLE public.email_marketing_sends ENABLE ROW LEVEL SECURITY;

-- Admins podem ler todos os registros
CREATE POLICY "admin_email_sends_select"
  ON public.email_marketing_sends
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- Admins podem excluir registros
CREATE POLICY "admin_email_sends_delete"
  ON public.email_marketing_sends
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = TRUE
    )
  );

-- Inserção e atualização apenas via service role (Edge Function)
-- Nenhuma política adicional de INSERT/UPDATE necessária para clientes autenticados
