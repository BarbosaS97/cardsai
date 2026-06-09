-- Run this in the Supabase SQL Editor to create the pix_charges table

CREATE TABLE IF NOT EXISTS public.pix_charges (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  correlation_id text        NOT NULL UNIQUE,
  credits        integer     NOT NULL,
  amount         integer     NOT NULL, -- in centavos (BRL)
  coupon_id      uuid        REFERENCES public.coupons(id),
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'completed', 'expired')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pix_charges_correlation
  ON public.pix_charges (correlation_id);

CREATE INDEX IF NOT EXISTS idx_pix_charges_user_status
  ON public.pix_charges (user_id, status);

ALTER TABLE public.pix_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pix charges"
  ON public.pix_charges FOR SELECT
  USING (auth.uid() = user_id);
