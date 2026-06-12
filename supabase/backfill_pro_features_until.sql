-- Backfill pro_features_until para usuários que compraram créditos antes
-- da função grant_credits_with_pro_bonus existir (usavam apenas increment_credits).
--
-- Estratégia:
--   1. Usuários com pix_charges concluídas de créditos → pro_features_until = MAX(completed_at) + 30 dias
--   2. Usuários com créditos > 0 mas sem nenhum histórico rastreável (compras antigas via Stripe
--      sem plan no metadata) → pro_features_until = NOW() + 30 dias como concessão de boa-fé.
--
-- Execute no Supabase SQL Editor. Revise o resultado antes com os SELECTs abaixo.

-- ─── Preview: quem seria afetado ─────────────────────────────────────────────

-- Usuários com PIX concluído de créditos sem pro ainda ativo:
SELECT p.id, p.email, MAX(pc.completed_at) AS last_purchase,
       MAX(pc.completed_at) + INTERVAL '30 days' AS new_pro_until,
       p.pro_features_until AS current_pro_until
FROM profiles p
JOIN pix_charges pc ON pc.user_id = p.id
WHERE pc.status = 'completed'
  AND pc.credits > 0
  AND (p.pro_features_until IS NULL OR p.pro_features_until < NOW())
  AND (p.subscription_status IS NULL OR p.subscription_status != 'active')
GROUP BY p.id, p.email, p.pro_features_until;

-- Usuários com créditos > 0 mas sem pro_features_until e sem pix_charges rastreável:
SELECT id, email, credits, pro_features_until
FROM profiles
WHERE credits > 0
  AND (pro_features_until IS NULL OR pro_features_until < NOW())
  AND (subscription_status IS NULL OR subscription_status != 'active')
  AND id NOT IN (
    SELECT DISTINCT user_id FROM pix_charges WHERE status = 'completed' AND credits > 0
  );

-- ─── Execução: backfill por PIX (data real da compra) ────────────────────────

UPDATE profiles p
SET pro_features_until = GREATEST(
  COALESCE(p.pro_features_until, '1970-01-01'::timestamptz),
  sub.new_pro_until
)
FROM (
  SELECT pc.user_id,
         MAX(pc.completed_at) + INTERVAL '30 days' AS new_pro_until
  FROM pix_charges pc
  WHERE pc.status = 'completed'
    AND pc.credits > 0
  GROUP BY pc.user_id
) sub
WHERE p.id = sub.user_id
  AND (p.subscription_status IS NULL OR p.subscription_status != 'active')
  AND (p.pro_features_until IS NULL OR p.pro_features_until < sub.new_pro_until);

-- ─── Execução: backfill de boa-fé para compradores Stripe antigos (sem data) ─
-- Só aplica a usuários com créditos > 0 sem pro ativo e sem registro em pix_charges.
-- O prazo de 30 dias a partir de NOW() é uma concessão única.

UPDATE profiles
SET pro_features_until = NOW() + INTERVAL '30 days'
WHERE credits > 0
  AND (pro_features_until IS NULL OR pro_features_until < NOW())
  AND (subscription_status IS NULL OR subscription_status != 'active')
  AND id NOT IN (
    SELECT DISTINCT user_id FROM pix_charges WHERE status = 'completed' AND credits > 0
  );

-- ─── Verificação final ───────────────────────────────────────────────────────

SELECT id, email, credits, pro_features_until, subscription_status
FROM profiles
WHERE pro_features_until > NOW()
ORDER BY pro_features_until DESC
LIMIT 50;
