-- ============================================
-- Tabela: mindmaps
-- Execute no SQL Editor do Supabase
-- ============================================

CREATE TABLE IF NOT EXISTS public.mindmaps (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  generation_id  UUID         NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
  titulo         TEXT         NOT NULL DEFAULT '',
  topicos        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  anotacoes      JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- SVG path strings (user drawings)
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(generation_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS mindmaps_generation_id_idx ON public.mindmaps(generation_id);
CREATE INDEX IF NOT EXISTS mindmaps_user_id_idx       ON public.mindmaps(user_id);

-- Row Level Security
ALTER TABLE public.mindmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mindmaps"
  ON public.mindmaps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mindmaps"
  ON public.mindmaps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mindmaps"
  ON public.mindmaps FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mindmaps"
  ON public.mindmaps FOR DELETE
  USING (auth.uid() = user_id);
