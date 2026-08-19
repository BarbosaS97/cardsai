-- m12_answer_randomizations.sql
-- Auditoria da randomização de posição das alternativas / gabarito
-- (Edge Function randomize-answers). Execute no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.answer_randomizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  before JSONB NOT NULL,
  after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_answer_randomizations_question_id ON public.answer_randomizations(question_id);
CREATE INDEX IF NOT EXISTS idx_answer_randomizations_generation_id ON public.answer_randomizations(generation_id);

ALTER TABLE public.answer_randomizations ENABLE ROW LEVEL SECURITY;

-- Somente o dono da geração ou um admin pode ver o histórico de randomizações.
-- Inserção é feita exclusivamente pela Edge Function via service role (bypassa RLS).
DROP POLICY IF EXISTS "answer_randomizations_select" ON public.answer_randomizations;
CREATE POLICY "answer_randomizations_select" ON public.answer_randomizations
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

GRANT SELECT ON public.answer_randomizations TO authenticated;
