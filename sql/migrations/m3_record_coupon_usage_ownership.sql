-- Migração M-3: record_coupon_usage só pode ser chamada pelo próprio usuário
-- Execute no SQL Editor do Supabase
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_coupon_usage(
  p_coupon_id  UUID,
  p_user_id    UUID,
  p_session_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Garante que o chamador só pode registrar uso em seu próprio nome.
  -- auth.uid() é NULL quando chamado pelo service_role (backend confiável),
  -- então a verificação só é exigida para chamadas diretas de clientes.
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;

  INSERT INTO coupon_usages (coupon_id, user_id, session_id)
    VALUES (p_coupon_id, p_user_id, p_session_id)
    ON CONFLICT (coupon_id, user_id) DO NOTHING;

  UPDATE coupons
    SET used_count = used_count + 1
    WHERE id = p_coupon_id;
END;
$$;
