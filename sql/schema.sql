-- ============================================
-- QuestõesCardsAI - Schema SQL para Supabase
-- Execute este arquivo no SQL Editor do Supabase
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABELAS
-- ============================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  credits INTEGER NOT NULL DEFAULT 5,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  unlimited_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration: add unlimited_access if table already exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS unlimited_access BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT '',
  pdf_name TEXT DEFAULT '',
  page_count INTEGER DEFAULT 0,
  summary TEXT DEFAULT '',
  topics JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT DEFAULT '',
  question_count INTEGER DEFAULT 0,
  flashcard_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer TEXT NOT NULL DEFAULT 'A',
  explanation TEXT DEFAULT '',
  topic TEXT DEFAULT '',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.flashcards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  topic TEXT DEFAULT '',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ÍNDICES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_status ON public.generations(status);
CREATE INDEX IF NOT EXISTS idx_questions_generation_id ON public.questions(generation_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_generation_id ON public.flashcards(generation_id);

-- ============================================
-- FUNÇÕES
-- ============================================

-- Verifica se o usuário atual é admin (SECURITY DEFINER bypassa RLS)
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Cria perfil automaticamente ao registrar usuário
-- Nota: promoção a admin deve ser feita manualmente via SQL, nunca por email hardcoded.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Consome 1 crédito (retorna TRUE se sucesso)
CREATE OR REPLACE FUNCTION public.consume_credit(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_credits INTEGER;
  v_is_admin BOOLEAN;
BEGIN
  SELECT credits, is_admin INTO v_credits, v_is_admin
  FROM public.profiles WHERE id = p_user_id;

  IF v_is_admin THEN RETURN TRUE; END IF;
  IF v_credits <= 0 THEN RETURN FALSE; END IF;

  UPDATE public.profiles
  SET credits = credits - 1, updated_at = NOW()
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adiciona créditos a um usuário (somente admin; retorna novo saldo)
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_new_credits INTEGER;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores podem adicionar créditos';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser um número positivo';
  END IF;
  UPDATE public.profiles
  SET credits = credits + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new_credits;
  IF v_new_credits IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
  RETURN v_new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reseta créditos de um usuário para um valor específico (somente admin; retorna novo saldo)
CREATE OR REPLACE FUNCTION public.reset_credits(p_user_id UUID, p_amount INTEGER DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
  v_new_credits INTEGER;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada: apenas administradores podem resetar créditos';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Quantidade não pode ser negativa';
  END IF;
  UPDATE public.profiles
  SET credits = p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO v_new_credits;
  IF v_new_credits IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
  RETURN v_new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alterna acesso ilimitado de um usuário (somente admin)
CREATE OR REPLACE FUNCTION public.toggle_unlimited_access(p_user_id UUID, p_value BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;
  UPDATE public.profiles
  SET unlimited_access = p_value, updated_at = NOW()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Alterna privilégios de admin de um usuário (somente admin)
CREATE OR REPLACE FUNCTION public.toggle_admin(p_user_id UUID, p_value BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;
  UPDATE public.profiles
  SET is_admin = p_value, updated_at = NOW()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin_user());

DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_admin_user());

-- Generations
DROP POLICY IF EXISTS "generations_select" ON public.generations;
CREATE POLICY "generations_select" ON public.generations
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "generations_insert" ON public.generations;
CREATE POLICY "generations_insert" ON public.generations
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "generations_update" ON public.generations;
CREATE POLICY "generations_update" ON public.generations
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "generations_delete" ON public.generations;
CREATE POLICY "generations_delete" ON public.generations
  FOR DELETE USING (user_id = auth.uid() OR public.is_admin_user());

-- Questions
DROP POLICY IF EXISTS "questions_select" ON public.questions;
CREATE POLICY "questions_select" ON public.questions
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "questions_insert" ON public.questions;
CREATE POLICY "questions_insert" ON public.questions
  FOR INSERT WITH CHECK (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "questions_delete" ON public.questions;
CREATE POLICY "questions_delete" ON public.questions
  FOR DELETE USING (public.is_admin_user());

-- Flashcards
DROP POLICY IF EXISTS "flashcards_select" ON public.flashcards;
CREATE POLICY "flashcards_select" ON public.flashcards
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "flashcards_insert" ON public.flashcards;
CREATE POLICY "flashcards_insert" ON public.flashcards
  FOR INSERT WITH CHECK (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "flashcards_delete" ON public.flashcards;
CREATE POLICY "flashcards_delete" ON public.flashcards
  FOR DELETE USING (public.is_admin_user());

-- ============================================
-- PERMISSÕES
-- ============================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcards TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credit TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_credits TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_unlimited_access TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user TO authenticated, anon;

-- ============================================
-- NOTA: Para criar o admin, acesse o site e registre
-- com o email admin@cardsai.com / admin123
-- O trigger criará o perfil automaticamente com créditos ilimitados
-- ============================================
