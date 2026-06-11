-- Tabela de sketches vinculados a cada geração
CREATE TABLE IF NOT EXISTS sketches (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  canvas_data   jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, generation_id)
);

-- Index para lookup rápido
CREATE INDEX IF NOT EXISTS idx_sketches_generation_id ON sketches(generation_id);
CREATE INDEX IF NOT EXISTS idx_sketches_user_id       ON sketches(user_id);

-- Row-level security
ALTER TABLE sketches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own sketches" ON sketches
  FOR ALL USING (auth.uid() = user_id);

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_sketches_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_sketches_updated_at
  BEFORE UPDATE ON sketches
  FOR EACH ROW EXECUTE FUNCTION update_sketches_updated_at();
