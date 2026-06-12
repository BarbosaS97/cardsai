-- Migration: adiciona plan_type à tabela coupons
-- Define em qual tipo de compra o cupom pode ser usado:
--   'all'          → válido para assinaturas Pro e créditos avulsos
--   'subscription' → válido apenas para Pro Mensal e Pro Anual
--   'credits'      → válido apenas para Créditos Avulsos

ALTER TABLE coupons
ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'all'
  CHECK (plan_type IN ('all', 'subscription', 'credits'));

-- Índice opcional para queries por tipo
CREATE INDEX IF NOT EXISTS idx_coupons_plan_type ON coupons (plan_type);
