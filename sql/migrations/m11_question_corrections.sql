-- m11_question_corrections.sql
-- Auditoria de correções automáticas feitas pela revisão de qualidade das questões
-- (Edge Function review-questions). Execute no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.question_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  issues_found JSONB NOT NULL DEFAULT '[]'::jsonb,
  before JSONB NOT NULL,
  after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_question_corrections_question_id ON public.question_corrections(question_id);
CREATE INDEX IF NOT EXISTS idx_question_corrections_generation_id ON public.question_corrections(generation_id);

ALTER TABLE public.question_corrections ENABLE ROW LEVEL SECURITY;

-- Somente o dono da geração ou um admin pode ver o histórico de correções.
-- Inserção é feita exclusivamente pela Edge Function via service role (bypassa RLS).
DROP POLICY IF EXISTS "question_corrections_select" ON public.question_corrections;
CREATE POLICY "question_corrections_select" ON public.question_corrections
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

GRANT SELECT ON public.question_corrections TO authenticated;
