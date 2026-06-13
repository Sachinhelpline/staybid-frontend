-- ============================================================================
-- v252 — Onboarding Express era (2026-06-12)
-- Additive-only. Forward-only. Applied via Supabase MCP + kept here as the
-- audit trail (CLAUDE.md migration discipline).
--
-- Adds:
--  1. Flexible commission (5–15%) — per-hotel + per-agreement metadata
--  2. Digital KYC mode tracking on kyc_submissions
--  3. Bank verification mode + penny-drop status on bank_details
--  4. onboarding_consents — granular consent ledger (data-scrape / OTA rates /
--     price-compare / image rights / DPDP privacy / commission / legal)
--  5. onboarding_events — full audit trail of every onboarding step
--  6. host_agreements e-sign metadata (typed signature name, method)
-- ============================================================================

-- 1. Per-hotel agreed commission (5–15). NULL = platform default.
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC
    CHECK (commission_percent IS NULL OR (commission_percent >= 5 AND commission_percent <= 15));

-- 2. Digital KYC tracking
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS kyc_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (kyc_mode IN ('digital', 'manual', 'hybrid'));
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS digital_provider TEXT;        -- 'mock' | 'surepass' | 'cashfree' | ...
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS gstin_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 3. Bank verification metadata
ALTER TABLE public.bank_details
  ADD COLUMN IF NOT EXISTS verify_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (verify_mode IN ('digital', 'manual'));
ALTER TABLE public.bank_details
  ADD COLUMN IF NOT EXISTS penny_drop_status TEXT;       -- 'pending' | 'verified' | 'failed' | NULL
ALTER TABLE public.bank_details
  ADD COLUMN IF NOT EXISTS name_match_score NUMERIC;     -- 0–100 holder-name match from penny drop
ALTER TABLE public.bank_details
  ADD COLUMN IF NOT EXISTS bank_branch_address TEXT;     -- from IFSC lookup

-- 4. Granular consent ledger — one row per (user, hotel, consent_key) grant.
--    Append-only: revocations are new rows with granted=false.
CREATE TABLE IF NOT EXISTS public.onboarding_consents (
  id          TEXT PRIMARY KEY DEFAULT ('cns_' || gen_random_uuid()::text),
  user_id     TEXT NOT NULL,
  hotel_id    TEXT,
  consent_key TEXT NOT NULL,        -- see lib/onboard/legal.ts CONSENT_ITEMS
  granted     BOOLEAN NOT NULL DEFAULT TRUE,
  version     TEXT,                 -- agreement version under which consent was taken
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onb_consents_user  ON public.onboarding_consents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onb_consents_hotel ON public.onboarding_consents (hotel_id, consent_key);

-- 5. Onboarding audit events — god-mode memory of the entire journey.
CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id         TEXT PRIMARY KEY DEFAULT ('oev_' || gen_random_uuid()::text),
  user_id    TEXT,
  hotel_id   TEXT,
  agent_code TEXT,
  event      TEXT NOT NULL,         -- 'search' | 'ai_prefill' | 'kyc_digital_pan' | 'bank_penny_drop' | 'agreement_signed' | 'published' | ...
  payload    JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_onb_events_user  ON public.onboarding_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onb_events_hotel ON public.onboarding_events (hotel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onb_events_event ON public.onboarding_events (event, created_at DESC);

-- 6. E-sign metadata on host_agreements (IT Act 2000 §10A click-wrap record)
ALTER TABLE public.host_agreements
  ADD COLUMN IF NOT EXISTS signature_name TEXT;          -- typed full legal name
ALTER TABLE public.host_agreements
  ADD COLUMN IF NOT EXISTS signed_method TEXT NOT NULL DEFAULT 'clickwrap';  -- 'clickwrap' | 'otp_clickwrap'
ALTER TABLE public.host_agreements
  ADD COLUMN IF NOT EXISTS onboarded_via TEXT;           -- 'self' | 'agent'
ALTER TABLE public.host_agreements
  ADD COLUMN IF NOT EXISTS agent_code TEXT;

-- RLS — permissive anon policies matching project precedent
ALTER TABLE public.onboarding_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_events  ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY onboarding_consents_all_anon ON public.onboarding_consents
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY onboarding_events_all_anon ON public.onboarding_events
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
