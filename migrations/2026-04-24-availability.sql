-- ═══════════════════════════════════════════════════════════════════════
-- StayBid — Real-time Availability + PMS foundation (2026-04-24)
-- PURE ADDITIVE. Zero changes to existing tables. Safe to run on prod.
-- Run this in Supabase → SQL editor once.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. ROOM_BLOCKS  ─────────────────────────────────────────────────
--   Single source of truth for every non-bid occupancy signal.
--   source = 'walk_in'  → manual entry from partner panel (offline guest)
--          = 'ota_ical' → imported from Booking.com / Airbnb / GoIbibo iCal
--          = 'manual'   → admin/owner blocked the room (maintenance, etc.)
--          = 'group'    → bulk corporate / event block
-- Bids with status = 'ACCEPTED' are treated as blocks at query time —
-- NOT duplicated here, to keep bids as the single source of truth for bids.
create table if not exists public.room_blocks (
  id            text primary key default gen_random_uuid()::text,
  "hotelId"     text not null,
  "roomId"      text not null,
  "fromDate"    date not null,
  "toDate"      date not null,           -- exclusive (checkout day)
  source        text not null default 'manual',
  "guestName"   text,
  "guestPhone"  text,
  "guestEmail"  text,
  amount        numeric,
  note          text,
  "externalRef" text,                    -- iCal UID / OTA booking id (dedupe key)
  provider      text,                    -- 'booking' | 'airbnb' | 'mmt' | 'goibibo' | 'agoda' | 'other'
  "feedId"      text,                    -- ota_feeds.id if source = ota_ical
  "createdAt"   timestamptz not null default now(),
  "createdBy"   text,
  constraint room_blocks_date_range check ("toDate" > "fromDate")
);

create index if not exists room_blocks_room_dates_idx
  on public.room_blocks ("roomId", "fromDate", "toDate");
create index if not exists room_blocks_hotel_idx
  on public.room_blocks ("hotelId");
create index if not exists room_blocks_external_ref_idx
  on public.room_blocks ("externalRef") where "externalRef" is not null;

alter table public.room_blocks disable row level security;

-- ─── 2. OTA_FEEDS  ───────────────────────────────────────────────────
--   Hotel owners paste their iCal URL from Booking.com / Airbnb / MMT.
--   We fetch and diff into room_blocks with source='ota_ical' on demand.
create table if not exists public.ota_feeds (
  id              text primary key default gen_random_uuid()::text,
  "hotelId"       text not null,
  "roomId"        text not null,
  provider        text not null,
  "icalUrl"       text not null,
  label           text,                   -- user-friendly name ("Deluxe @ Booking.com")
  active          boolean not null default true,
  "lastSyncAt"    timestamptz,
  "lastSyncStatus" text,                  -- 'ok' | 'error' | 'empty'
  "lastSyncError" text,
  "lastEventCount" int default 0,
  "createdAt"     timestamptz not null default now()
);

create index if not exists ota_feeds_room_idx on public.ota_feeds ("roomId");
create index if not exists ota_feeds_hotel_idx on public.ota_feeds ("hotelId");

alter table public.ota_feeds disable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- Done. No existing data touched.
-- ═══════════════════════════════════════════════════════════════════════
