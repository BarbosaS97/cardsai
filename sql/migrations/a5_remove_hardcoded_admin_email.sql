-- Migração A-5: Remove email de admin hardcoded do trigger de criação de usuário
-- Execute no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────────────────

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

-- Se ainda não existe uma conta de admin, crie uma pelo Supabase Auth
-- e depois execute o comando abaixo para promovê-la:
--
-- UPDATE public.profiles
-- SET is_admin = true, credits = 999999
-- WHERE email = 'seu-email-de-admin@dominio.com';
