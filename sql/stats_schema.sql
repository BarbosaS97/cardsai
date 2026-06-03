-- ============================================
-- CardsQuestõesAI — Estatísticas de Desempenho
-- Execute no SQL Editor do Supabase
-- ============================================

-- Tentativas de questões: uma linha por resposta do usuário
CREATE TABLE IF NOT EXISTS public.question_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  selected_answer TEXT NOT NULL DEFAULT '',
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessões de estudo: cada vez que o usuário abre um material
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  questions_correct INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

-- Revisões de flashcards: sabia / não sabia
CREATE TABLE IF NOT EXISTS public.flashcard_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  flashcard_id UUID REFERENCES public.flashcards(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  knew_it BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_question_attempts_user_id      ON public.question_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_generation_id ON public.question_attempts(generation_id);
CREATE INDEX IF NOT EXISTS idx_question_attempts_question_id   ON public.question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id          ON public.study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_user_id       ON public.flashcard_reviews(user_id);

-- ── Row Level Security ───────────────────────────────────────────

ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;

-- question_attempts
DROP POLICY IF EXISTS "qa_select" ON public.question_attempts;
CREATE POLICY "qa_select" ON public.question_attempts
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "qa_insert" ON public.question_attempts;
CREATE POLICY "qa_insert" ON public.question_attempts
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "qa_delete" ON public.question_attempts;
CREATE POLICY "qa_delete" ON public.question_attempts
  FOR DELETE USING (user_id = auth.uid() OR public.is_admin_user());

-- study_sessions
DROP POLICY IF EXISTS "ss_select" ON public.study_sessions;
CREATE POLICY "ss_select" ON public.study_sessions
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "ss_insert" ON public.study_sessions;
CREATE POLICY "ss_insert" ON public.study_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ss_update" ON public.study_sessions;
CREATE POLICY "ss_update" ON public.study_sessions
  FOR UPDATE USING (user_id = auth.uid());

-- flashcard_reviews
DROP POLICY IF EXISTS "fr_select" ON public.flashcard_reviews;
CREATE POLICY "fr_select" ON public.flashcard_reviews
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin_user());

DROP POLICY IF EXISTS "fr_insert" ON public.flashcard_reviews;
CREATE POLICY "fr_insert" ON public.flashcard_reviews
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── Permissões ───────────────────────────────────────────────────

GRANT SELECT, INSERT, DELETE         ON public.question_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.study_sessions    TO authenticated;
GRANT SELECT, INSERT                 ON public.flashcard_reviews TO authenticated;
