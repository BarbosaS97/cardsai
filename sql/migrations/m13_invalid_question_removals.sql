-- m13_invalid_question_removals.sql
-- Auditoria de questões estruturalmente inválidas removidas pela Edge Function
-- detect-invalid-questions (alternativas duplicadas/vazias, gabarito sem correspondência).
-- Execute no Supabase SQL Editor.

-- Sem FK para questions(id): a linha já foi excluída no momento em que este registro é criado.
CREATE TABLE IF NOT EXISTS public.invalid_question_removals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL,
  generation_id UUID REFERENCES public.generations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot JSONB NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invalid_question_removals_generation_id ON public.invalid_question_removals(generation_id);

ALTER TABLE public.invalid_question_removals ENABLE ROW LEVEL SECURITY;

-- Somente o dono da geração ou um admin pode ver o histórico de remoções.
-- Inserção é feita exclusivamente pela Edge Function via service role (bypassa RLS).
DROP POLICY IF EXISTS "invalid_question_removals_select" ON public.invalid_question_removals;
CREATE POLICY "invalid_question_removals_select" ON public.invalid_question_removals
  FOR SELECT USING (
    public.is_admin_user() OR
    EXISTS (SELECT 1 FROM public.generations WHERE id = generation_id AND user_id = auth.uid())
  );

GRANT SELECT ON public.invalid_question_removals TO authenticated;
