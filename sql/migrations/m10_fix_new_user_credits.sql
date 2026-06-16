-- m10_fix_new_user_credits.sql
-- Corrige créditos do plano Grátis de 2 → 5 gerações.
-- Execute no Supabase SQL Editor.

-- ── 1. Corrige o trigger de criação de novos usuários ────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits, is_admin)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    5,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Corrige o default da coluna credits para novos registros diretos ──────
ALTER TABLE public.profiles ALTER COLUMN credits SET DEFAULT 5;

-- ── 3. Backfill: ajusta usuários existentes com 2 créditos para 5 ─────────
-- Afeta apenas quem ainda tem exatamente 2 créditos (nunca os consumiu nem comprou mais).
-- Usuários com 0, 1, 3, 4+ créditos ficam intactos.
UPDATE public.profiles
SET    credits    = 5,
       updated_at = NOW()
WHERE  credits = 2
  AND  subscription_status = 'free'
  AND  unlimited_access    = FALSE
  AND  is_admin            = FALSE;
