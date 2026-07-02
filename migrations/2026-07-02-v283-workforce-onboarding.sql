-- v283 Gap 3 — Workforce onboarding + worker panel
-- Applied live to Supabase project uxxhbdqedazpmvbvaosh (name: v283_workforce_onboarding).
-- Additive-only. Turns the read-only workforce_workers catalog into an
-- onboardable + admin-reviewable directory. Existing 24 seeded rows are
-- flipped to status='approved' so they keep surfacing in the public hire feed.
--
-- Auth model:
--   • Worker onboarding    → /host/workforce/join → /api/host/workforce/apply
--                            (status='pending', available=false, active=true, verified=false)
--   • Worker sign-in       → /worker → phone-OTP (Railway) → /api/worker/login
--                            (matched by last-10-digit phone → workforce_workers row)
--   • Admin approve/reject → /admin/host/catalog (Workers tab) → /api/admin/host/workers
--   • Public hire catalog  → /api/host/workforce filters status='approved'

ALTER TABLE public.workforce_workers
  ADD COLUMN IF NOT EXISTS phone        TEXT,
  ADD COLUMN IF NOT EXISTS email        TEXT,
  ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS applied_note TEXT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

-- status ∈ pending | approved | rejected | suspended  (enforced in the API layer;
-- no DB CHECK so a future status can be added without a migration).

CREATE INDEX IF NOT EXISTS idx_wkr_status ON public.workforce_workers (status);
CREATE INDEX IF NOT EXISTS idx_wkr_phone  ON public.workforce_workers (phone);

-- Keep the 24 pre-seeded catalog workers visible in the public hire feed.
UPDATE public.workforce_workers SET status = 'approved' WHERE status IS NULL;
