-- ============================================================================
-- v281 — Property Listing Submissions (Gap 2: property clash separation)
-- ============================================================================
-- Separates the two conflated property concepts:
--   A) SOURCING side — a property owner submits their property to be leased/
--      rented/sourced THROUGH StayBid. Lands in discovery_properties with
--      status='pending_review'. Admin reviews → 'available' (goes live in the
--      /host/properties discovery feed) or 'rejected'.
--   B) LIVE side — a hotel partner runs their OWN property on StayBid via the
--      existing /onboard flow (untouched by this migration).
--
-- Additive only: extends the status CHECK + adds a submitted_by column so we
-- can attribute owner submissions and build the admin review queue.
-- ============================================================================

-- 1) Extend the status enum to include the review lifecycle.
ALTER TABLE public.discovery_properties
  DROP CONSTRAINT IF EXISTS discovery_properties_status_check;

ALTER TABLE public.discovery_properties
  ADD CONSTRAINT discovery_properties_status_check
  CHECK (status IN ('pending_review','available','shortlisted','rented','inactive','rejected'));

-- 2) Attribute owner submissions (nullable — curated/seed rows have none).
ALTER TABLE public.discovery_properties
  ADD COLUMN IF NOT EXISTS submitted_by TEXT;

-- 3) Fast lookup for the admin "pending submissions" review queue.
CREATE INDEX IF NOT EXISTS idx_discovery_props_pending
  ON public.discovery_properties (status, created_at DESC)
  WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_discovery_props_submitter
  ON public.discovery_properties (submitted_by, created_at DESC);
