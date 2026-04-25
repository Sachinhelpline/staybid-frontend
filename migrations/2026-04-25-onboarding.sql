-- ============================================================================
-- StayBid Onboarding System — Migration (2026-04-25)
-- Tables: onboarding_users, otp_codes, agents, hotel_drafts
-- Adds: hotel_serial_seq + STB-YYYY-XXXXX unique hotel id
-- RLS DISABLED for these tables (server-side service-role access only)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. onboarding_users — separate auth pool (partner + property owners)
--    Customer panel uses the existing `users` table; this is intentionally
--    isolated so password-based login lives only on the partner/onboarding
--    side and we don't disturb the customer OTP-only flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.onboarding_users (
  id              TEXT PRIMARY KEY DEFAULT ('ou_' || gen_random_uuid()::text),
  email           TEXT UNIQUE,
  phone           TEXT UNIQUE,
  name            TEXT,
  password_hash   TEXT,                       -- bcrypt
  role            TEXT NOT NULL DEFAULT 'owner',  -- owner | agent | admin
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  agent_code      TEXT,                       -- if role='agent', their unique code
  referred_by     TEXT,                       -- agent_code of referring agent
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onb_users_email ON public.onboarding_users(email);
CREATE INDEX IF NOT EXISTS idx_onb_users_phone ON public.onboarding_users(phone);
CREATE INDEX IF NOT EXISTS idx_onb_users_agent_code ON public.onboarding_users(agent_code);

ALTER TABLE public.onboarding_users DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. otp_codes — short-lived OTPs for email + phone first-time verification
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id           TEXT PRIMARY KEY DEFAULT ('otp_' || gen_random_uuid()::text),
  identifier   TEXT NOT NULL,                 -- email OR phone
  channel      TEXT NOT NULL,                 -- 'email' | 'sms' | 'whatsapp'
  code_hash    TEXT NOT NULL,                 -- sha256 of 6-digit code
  purpose      TEXT NOT NULL DEFAULT 'signup',-- 'signup' | 'reset' | 'login'
  attempts     INT NOT NULL DEFAULT 0,
  consumed     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_identifier ON public.otp_codes(identifier, purpose, consumed);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON public.otp_codes(expires_at);

ALTER TABLE public.otp_codes DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. agents — directory of platform agents who can onboard hotels on behalf
--    of owners. Each gets a sticky agent_code (e.g. AGT-9X7K).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agents (
  id           TEXT PRIMARY KEY DEFAULT ('agt_' || gen_random_uuid()::text),
  agent_code   TEXT UNIQUE NOT NULL,
  user_id      TEXT REFERENCES public.onboarding_users(id) ON DELETE SET NULL,
  full_name    TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  city         TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_code ON public.agents(agent_code);
ALTER TABLE public.agents DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. hotel_drafts — wizard state (search → fetch → edit → submit). Survives
--    page reloads so an agent can resume an in-progress onboarding.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hotel_drafts (
  id              TEXT PRIMARY KEY DEFAULT ('drf_' || gen_random_uuid()::text),
  user_id         TEXT NOT NULL REFERENCES public.onboarding_users(id) ON DELETE CASCADE,
  search_query    TEXT,
  search_city     TEXT,
  selected_source TEXT,                       -- 'serpapi' | 'tavily' | 'mock' | 'manual'
  source_ref      TEXT,                       -- external id (e.g. google place id)
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full editable hotel + rooms + photos
  status          TEXT NOT NULL DEFAULT 'draft',       -- draft | submitted | live
  hotel_id        TEXT,                       -- set when submitted -> live (STB-YYYY-XXXXX)
  agent_code      TEXT,                       -- if onboarded by an agent
  owner_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_user ON public.hotel_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON public.hotel_drafts(status);
ALTER TABLE public.hotel_drafts DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. hotel_serial_seq — monotonically increasing counter for STB-YYYY-XXXXX
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.hotel_serial_seq START 1000 INCREMENT 1;

CREATE OR REPLACE FUNCTION public.next_hotel_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  n INT;
BEGIN
  n := nextval('public.hotel_serial_seq');
  RETURN 'STB-' || EXTRACT(YEAR FROM NOW())::text || '-' || LPAD(n::text, 5, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. hotels table — ensure onboarding columns exist (best-effort, non-breaking)
-- ---------------------------------------------------------------------------
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS onboarded_via   TEXT;     -- 'self' | 'agent'
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS onboarded_by    TEXT;     -- onboarding_users.id
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS onboarding_agent TEXT;    -- agent_code
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS public_id       TEXT UNIQUE; -- STB-YYYY-XXXXX
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS source          TEXT;     -- where data came from
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS amenities       JSONB;
ALTER TABLE public.hotels ADD COLUMN IF NOT EXISTS photos          JSONB;    -- array of urls
