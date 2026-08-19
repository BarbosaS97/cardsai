-- m15_quality_assessments.sql
-- Auditoria da avaliação de qualidade pedagógica (Edge Function assess-quality):
-- pontua clareza, alternativas, dificuldade, relevância e originalidade (0-10 cada) e
-- registra a nota final (Ruim/Média/Boa/Ótima) de toda questão avaliada, além do
-- antes/depois de qualquer substituição feita. Execute no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.quality_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  clareza SMALLINT NOT NULL,
  alternativas_score SMALLINT NOT NULL,
  dificuldade_score SMALLINT NOT NULL,
  relevancia_score SMALLINT NOT NULL,
  originalidade_score SMALLINT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('Ruim', 'Média', 'Boa', 'Ótima')),
  replaced BOOLEAN NOT NULL DEFAULT false,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_assessments_question_id ON public.quality_assessments(question_id);
CREATE INDEX IF NOT EXISTS idx_quality_assessments_generation_id ON public.quality_assessments(generation_id);

ALTER TABLE public.quality_assessments ENABLE ROW LEVEL SECURITY;

-- Somente o dono da geração ou um admin pode ver o histórico de avaliações.
-- Inserção é feita exclusivamente pela Edge Function via service role (bypassa RLS).
DROP POLICY IF EXISTS "quality_assessments_select" ON public.quality_assessments;
CREATE POLICY "quality_assessments_select" ON public.quality_assessments
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

GRANT SELECT ON public.quality_assessments TO authenticated;
