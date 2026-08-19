-- m14_content_validations.sql
-- Auditoria da validação de conteúdo (Edge Function validate-content): segunda camada de
-- verificação, independente de review-questions, que resolve cada questão do zero usando
-- o método apropriado à área de conhecimento (Direito, Matemática, Português, História, etc.)
-- antes de confiar no gabarito informado. Execute no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.content_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_area TEXT,
  issues_found JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning TEXT,
  before JSONB NOT NULL,
  after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_validations_question_id ON public.content_validations(question_id);
CREATE INDEX IF NOT EXISTS idx_content_validations_generation_id ON public.content_validations(generation_id);

ALTER TABLE public.content_validations ENABLE ROW LEVEL SECURITY;

-- Somente o dono da geração ou um admin pode ver o histórico de validações.
-- Inserção é feita exclusivamente pela Edge Function via service role (bypassa RLS).
DROP POLICY IF EXISTS "content_validations_select" ON public.content_validations;
CREATE POLICY "content_validations_select" ON public.content_validations
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

GRANT SELECT ON public.content_validations TO authenticated;
