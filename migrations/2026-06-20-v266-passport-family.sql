-- ═══════════════════════════════════════════════════════════════════════
-- v266 — Passport Phase 2b: Family Passport (additive). Applied live via
-- Supabase MCP (migration name: v266_passport_family_additive) on project
-- uxxhbdqedazpmvbvaosh. ADDITIVE-ONLY.
--
-- A family is owned by one Explorer; members share a combined collection
-- view. One family per owner (uniq owner_user_id); one membership per user
-- (uniq member user_id). Owner adds members by Explorer ID.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.passport_families (
  id            TEXT PRIMARY KEY DEFAULT ('pfm_'::text || gen_random_uuid()::text),
  owner_user_id TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT 'My Family',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_passport_families_owner ON public.passport_families (owner_user_id);

CREATE TABLE IF NOT EXISTS public.passport_family_members (
  id           TEXT PRIMARY KEY DEFAULT ('pfmm_'::text || gen_random_uuid()::text),
  family_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'member'
  display_name TEXT,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passport_family_members_uniq UNIQUE (family_id, user_id)
);
-- one membership per user (a user belongs to at most one family)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pfm_user ON public.passport_family_members (user_id);
CREATE INDEX IF NOT EXISTS idx_pfm_family ON public.passport_family_members (family_id);

ALTER TABLE public.passport_families        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passport_family_members  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS passport_families_all_anon       ON public.passport_families;
DROP POLICY IF EXISTS passport_family_members_all_anon ON public.passport_family_members;

CREATE POLICY passport_families_all_anon       ON public.passport_families       FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY passport_family_members_all_anon ON public.passport_family_members FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
