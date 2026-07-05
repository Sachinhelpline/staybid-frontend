-- StayCircle™ investor KYC (v294.18, Phase 4). Applied live via Supabase MCP
-- to project uxxhbdqedazpmvbvaosh. Circle's OWN identity/payout KYC —
-- completely separate from the hotel video-verification flow.
CREATE TABLE IF NOT EXISTS public.circle_kyc (
  user_id        text PRIMARY KEY,
  full_name      text,
  pan            text,
  aadhaar_last4  text,
  bank_account   text,
  bank_ifsc      text,
  bank_holder    text,
  status         text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','submitted','verified','rejected')),
  review_note    text,
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.circle_kyc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS circle_kyc_all_anon ON public.circle_kyc;
CREATE POLICY circle_kyc_all_anon ON public.circle_kyc
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
