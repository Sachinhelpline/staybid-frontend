-- v326 — Channel Manager Phase B: per-unit OTA/Airbnb cross-listing.
-- Applied live to uxxhbdqedazpmvbvaosh via MCP apply_migration
-- (name: v326_channel_manager_per_unit).
--
-- Additive + idempotent. NULL = hotel-level (zero regression for every
-- existing feed / connection). A StayBid Circle investor attaches an OTA iCal
-- feed to a specific physical unit they own (hotel_room_units.id); the classic
-- full-hotel owner keeps NULL (hotel-level) and manages everything as before.
--
-- Naming follows each table's existing convention:
--   ota_feeds            → camelCase quoted → "unitId"
--   channel_connections  → snake_case       → unit_id
--
-- channel_connections.unit_id is RESERVED for a future admin per-unit
-- connector. The Phase-B partner flow keys off ota_feeds."unitId" and does NOT
-- auto-link a per-unit channel_connections row (the (hotel_id, ota) unique
-- index means two investors' Booking.com feeds on the same hotel would collide
-- — so unit-scoped feeds live purely as ota_feeds rows; hotel-level feeds keep
-- auto-linking their operator-level connection as before).

ALTER TABLE public.ota_feeds
  ADD COLUMN IF NOT EXISTS "unitId" TEXT;

ALTER TABLE public.channel_connections
  ADD COLUMN IF NOT EXISTS unit_id TEXT;

-- Only per-unit rows are indexed (partial) — the vast majority stay NULL.
CREATE INDEX IF NOT EXISTS idx_ota_feeds_unit
  ON public.ota_feeds ("unitId") WHERE "unitId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_connections_unit
  ON public.channel_connections (unit_id) WHERE unit_id IS NOT NULL;
