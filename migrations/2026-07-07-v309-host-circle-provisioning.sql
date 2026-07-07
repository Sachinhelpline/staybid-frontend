-- v309 (Host Property-Listing Redesign, Phase 4) — StayBid-Circle provisioning.
--
-- When an admin approves a `discovery_properties` listing (the sourcing /
-- lease-out catalog), we create a REAL bookable `hotels` row that StayBid
-- operates, plus its rooms + physical units, and grant the original lister
-- dashboard access. The locked owner-model (with Sachin):
--
--   • hotels.ownerId   = "hco_<propId>"     — a DISTINCT per-property host-circle
--                                             owner id ("alag owner ID per
--                                             property"). Never a real person's
--                                             id, never the shared circle
--                                             sentinel — so two host-circle
--                                             properties never clash, and a
--                                             lister's classic hotels
--                                             (ownerId=<user id>) stay separate.
--   • hotels.owner_type = 'host_circle'      — discriminator (admin sees it).
--   • hotels.account_type = 'staybid_operated'
--   • hotel_room_units.owner_user_id = <submitted_by>  — the lister owns the
--                                             physical units, so the EXISTING
--                                             resolveOperatedHotelIds surfaces
--                                             the hotel on /partner/dashboard via
--                                             the read-time scope union (zero
--                                             read-path changes).
--
-- Additive + idempotent. Existing hotels/listings untouched.

-- 1) owner_type discriminator on hotels (nullable → existing = classic owner).
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS owner_type TEXT;

-- 2) Traceability + idempotency link back on the listing.
ALTER TABLE public.discovery_properties
  ADD COLUMN IF NOT EXISTS provisioned_hotel_id TEXT;
ALTER TABLE public.discovery_properties
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ;

-- 3) Extend the listing status lifecycle to allow 'provisioned'.
ALTER TABLE public.discovery_properties
  DROP CONSTRAINT IF EXISTS discovery_properties_status_check;
ALTER TABLE public.discovery_properties
  ADD CONSTRAINT discovery_properties_status_check
  CHECK (status IN (
    'pending_review','available','shortlisted','rented','inactive','rejected','provisioned'
  ));

-- 4) Index the discriminator so admin/partner scope filters stay cheap.
CREATE INDEX IF NOT EXISTS idx_hotels_owner_type
  ON public.hotels (owner_type) WHERE owner_type IS NOT NULL;
