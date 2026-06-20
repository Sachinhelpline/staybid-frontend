-- v267 (Passport Phase 2c) — admin config/issue/adjust.
-- Additive: one new column on passport_profiles for admin-granted bonus XP.
--
-- The passport engine (lib/passport/engine.ts) is deterministic — stamps →
-- XP → rank. A plain xp write would be overwritten on the next /api/passport
-- load. bonus_xp is added on TOP of the computed XP every load, so an admin
-- adjustment persists. Admin "grant stamp" needs no schema change — a manual
-- passport_stamps row (source_type='admin') is counted naturally.
--
-- Applied live via Supabase MCP at v267 ship time.

ALTER TABLE public.passport_profiles
  ADD COLUMN IF NOT EXISTS bonus_xp INTEGER NOT NULL DEFAULT 0;

-- Verify:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='passport_profiles'
--      AND column_name='bonus_xp';
--   -> integer · 0 · NO
