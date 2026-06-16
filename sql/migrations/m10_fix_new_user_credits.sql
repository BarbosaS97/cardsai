-- m10_fix_new_user_credits.sql
-- Corrige o trigger handle_new_user: novos usuários devem começar com credits = 0.
-- O plano Grátis é 5 gerações/mês, controlado pela coluna monthly_generations
-- na função consume_credit — NÃO por créditos avulsos.
-- O valor antigo credits = 2 dava 2 extras sobre as 5 mensais (total = 7 no 1º mês).
-- Execute no Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, credits, is_admin)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    0,   -- Plano Grátis: 5 gerações/mês via monthly_generations (sem créditos avulsos)
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
