-- ── Campanhas promocionais ──────────────────────────────────────────────────
-- Execute este script no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS campaigns (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT        NOT NULL,
  descricao    TEXT        NOT NULL,
  codigo_cupom TEXT,
  link_destino TEXT        NOT NULL DEFAULT '/pricing.html',
  ativo        BOOLEAN     NOT NULL DEFAULT true,
  posicao      TEXT        NOT NULL DEFAULT 'both'
                           CHECK (posicao IN ('credits_page', 'landing_page', 'both')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Admin pode fazer tudo
CREATE POLICY "Admin full access on campaigns" ON campaigns
  USING      (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = true))
  WITH CHECK (auth.uid() IN (SELECT id FROM profiles WHERE is_admin = true));

-- Qualquer visitante (incluindo anônimo) pode ler campanhas ativas
CREATE POLICY "Anyone can read active campaigns" ON campaigns
  FOR SELECT USING (ativo = true);
