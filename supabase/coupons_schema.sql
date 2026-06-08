-- ─────────────────────────────────────────────────────────────────────────────
-- Coupons System
-- Run this in the Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Tabela principal de cupons
CREATE TABLE IF NOT EXISTS coupons (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT          UNIQUE NOT NULL,
  description        TEXT,
  discount_type      TEXT          NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value     DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
  stripe_coupon_id   TEXT,
  -- NULL = válido para todos os pacotes; array com strings '5','10','20','50' = restrito
  valid_for_packages TEXT[],
  max_uses           INTEGER       CHECK (max_uses IS NULL OR max_uses > 0),
  used_count         INTEGER       NOT NULL DEFAULT 0,
  max_uses_per_user  INTEGER       NOT NULL DEFAULT 1 CHECK (max_uses_per_user > 0),
  expires_at         TIMESTAMPTZ,
  is_active          BOOLEAN       NOT NULL DEFAULT true,
  created_by         UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_coupons_code      ON coupons (code);
CREATE INDEX IF NOT EXISTS idx_coupons_is_active ON coupons (is_active);

-- Tabela de uso por usuário
CREATE TABLE IF NOT EXISTS coupon_usages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id  UUID        NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, user_id)   -- 1 registro por par (cupom, usuário)
);

CREATE INDEX IF NOT EXISTS idx_coupon_usages_user ON coupon_usages (user_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE coupons       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_usages ENABLE ROW LEVEL SECURITY;

-- Admins podem fazer tudo em coupons
CREATE POLICY "coupons_admin_all" ON coupons
  FOR ALL TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());

-- Usuários autenticados podem ler cupons ativos (para validação no frontend)
CREATE POLICY "coupons_user_read_active" ON coupons
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Admins podem ver e gerenciar todos os usos
CREATE POLICY "coupon_usages_admin_all" ON coupon_usages
  FOR ALL TO authenticated
  USING (is_admin_user());

-- Usuários veem apenas seus próprios usos
CREATE POLICY "coupon_usages_user_select" ON coupon_usages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Usuários inserem apenas seus próprios registros
CREATE POLICY "coupon_usages_user_insert" ON coupon_usages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─── Função: registrar uso de cupom ─────────────────────────────────────────
-- Chame esta função via RPC após confirmação do pagamento.
-- Ela incrementa used_count e insere em coupon_usages atomicamente.

CREATE OR REPLACE FUNCTION record_coupon_usage(
  p_coupon_id UUID,
  p_user_id   UUID,
  p_session_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO coupon_usages (coupon_id, user_id, session_id)
    VALUES (p_coupon_id, p_user_id, p_session_id)
    ON CONFLICT (coupon_id, user_id) DO NOTHING;

  UPDATE coupons
    SET used_count = used_count + 1
    WHERE id = p_coupon_id;
END;
$$;
