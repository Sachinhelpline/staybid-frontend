-- ═══════════════════════════════════════════════════════════════════════════
-- v312 — StayCircle onboarding tracking  (2026-07-08)
--
-- Customer-facing "List your property" (/circle/onboard) submits a
-- circle_properties row with status='pending'. These two additive columns let
-- the admin queue know WHO submitted it + how to reach them.
--
--   submitted_by  — users.id of the customer who listed it (NULL for admin adds)
--   owner_contact — { name, phone, email } captured at submission for admin review
--
-- The shared <CircleOnboardForm> drives BOTH the admin editor (publishes
-- directly) and this customer route (status='pending' → admin approval). Only
-- difference is the caller.
--
-- APPLIED LIVE to project uxxhbdqedazpmvbvaosh via Supabase MCP
-- (migration name: 2026_05_18_... → v312_circle_properties_onboarding_tracking).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.circle_properties
  ADD COLUMN IF NOT EXISTS submitted_by TEXT;

ALTER TABLE public.circle_properties
  ADD COLUMN IF NOT EXISTS owner_contact JSONB;

-- customer "my submissions" lookup (filter by submitter, partial — only real rows)
CREATE INDEX IF NOT EXISTS idx_circle_props_submitter
  ON public.circle_properties (submitted_by)
  WHERE submitted_by IS NOT NULL;

-- admin review-queue lookup (filter by status)
CREATE INDEX IF NOT EXISTS idx_circle_props_status
  ON public.circle_properties (status);

-- The existing status CHECK only allowed active/inactive/sold_out/coming_soon.
-- Customer submissions land 'pending'; admin rejection sets 'rejected'.
-- (applied live as migration v312_circle_properties_status_pending_rejected)
ALTER TABLE public.circle_properties
  DROP CONSTRAINT IF EXISTS circle_properties_status_check;

ALTER TABLE public.circle_properties
  ADD CONSTRAINT circle_properties_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text, 'active'::text, 'inactive'::text,
    'sold_out'::text, 'coming_soon'::text, 'rejected'::text
  ]));
