// ═════════════════════════════════════════════════════════════════════════
// v734 — apply the MINIMAL set of migrations the concurrency suite needs.
//
// The full migrations/ tree touches ~150 files, most of which are unrelated
// seed data / rebrand ships / demo rows. Running them all on a fresh
// throwaway cluster would take minutes AND fail because many of them expect
// a rich pre-existing dataset (host_circle hotels, Spine data, live listings).
//
// We instead apply ONLY the schema pieces the RPC + tests reach:
//   1. Minimal DDL for rooms / hotel_room_units / room_blocks / bids /
//      bid_requests / inventory_blocks — inlined below to match the LIVE
//      column names (verified against migrations/*.sql).
//   2. The v734 migration file itself (source of truth for the RPC).
//
// This is intentionally a schema SUBSET, not a full mirror — the suite tests
// concurrency semantics of the RPC against the columns it actually reads.
// A regression against a column addition elsewhere would be caught by tsc /
// next build in the normal ship pipeline; the concurrency guarantee proven
// here does not depend on those other columns.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const V734 = path.join(REPO, "migrations", "2026-08-14-v734-classic-reservation-rpc.sql");

const MINIMAL_SCHEMA = `
-- rooms: id + quantity (the capacity signal unitsFreeForRange falls back to).
CREATE TABLE IF NOT EXISTS public.rooms (
  id        TEXT PRIMARY KEY,
  "hotelId" TEXT,
  quantity  INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hotel_room_units: the classic guard checks for active rows here. Only the
-- columns the RPC reads are declared.
CREATE TABLE IF NOT EXISTS public.hotel_room_units (
  id            TEXT PRIMARY KEY,
  "hotelId"     TEXT NOT NULL,
  "roomId"      TEXT NOT NULL,
  "roomNumber"  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  owner_user_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- room_blocks: full shape from migrations/2026-04-24-availability.sql +
-- assignedUnitId from later ships (used by getOccupations).
CREATE TABLE IF NOT EXISTS public.room_blocks (
  id                    TEXT PRIMARY KEY,
  "hotelId"             TEXT NOT NULL,
  "roomId"              TEXT NOT NULL,
  "fromDate"            DATE NOT NULL,
  "toDate"              DATE NOT NULL,
  source                TEXT NOT NULL DEFAULT 'manual',
  "guestName"           TEXT,
  "guestPhone"          TEXT,
  "guestEmail"          TEXT,
  amount                NUMERIC,
  note                  TEXT,
  "externalRef"         TEXT,
  provider              TEXT,
  "feedId"              TEXT,
  "assignedUnitId"      TEXT,
  "assignedUnitNumber"  TEXT,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"           TEXT,
  CONSTRAINT room_blocks_date_range CHECK ("toDate" > "fromDate")
);
CREATE INDEX IF NOT EXISTS room_blocks_room_dates_idx
  ON public.room_blocks ("roomId", "fromDate", "toDate");

-- bids + bid_requests: minimal shape the getOccupations SELECT reads.
CREATE TABLE IF NOT EXISTS public.bid_requests (
  id         TEXT PRIMARY KEY,
  "checkIn"  DATE,
  "checkOut" DATE,
  guests     INT
);
CREATE TABLE IF NOT EXISTS public.bids (
  id               TEXT PRIMARY KEY,
  "hotelId"        TEXT NOT NULL,
  "roomId"         TEXT NOT NULL,
  "customerId"     TEXT,
  "requestId"      TEXT,
  status           TEXT NOT NULL,
  amount           NUMERIC,
  "numRooms"       INT,
  "assignedUnitId" TEXT,
  message          TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- inventory_blocks: exact shape from migrations/2026-07-12-v327 +
-- v729 (unit_id nullable). Only the columns the RPC + tests reach.
CREATE TABLE IF NOT EXISTS public.inventory_blocks (
  id                      TEXT PRIMARY KEY,
  investor_user_id        TEXT NOT NULL,
  hotel_id                TEXT NOT NULL,
  unit_id                 TEXT,               -- v729 nullable
  room_id                 TEXT NOT NULL,
  date_from               DATE NOT NULL,
  date_to                 DATE NOT NULL,
  nights                  INTEGER NOT NULL,
  buy_price_per_night     NUMERIC,
  buy_total               NUMERIC,
  resale_price_per_night  NUMERIC,
  platform_fee_pct        NUMERIC,
  status                  TEXT NOT NULL DEFAULT 'draft',
  buyback_enabled         BOOLEAN NOT NULL DEFAULT false,
  razorpay_order_id       TEXT,
  razorpay_payment_id     TEXT,
  purchased_at            TIMESTAMPTZ,
  listed_at               TIMESTAMPTZ,
  sold_at                 TIMESTAMPTZ,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_blocks_status_chk CHECK (
    status IN ('draft','quoted','pending_payment','owned','listed','sold','expired','cancelled','refunded')
  ),
  CONSTRAINT inventory_blocks_range_chk CHECK (date_to > date_from AND nights > 0)
);
CREATE INDEX IF NOT EXISTS idx_inv_blocks_room_range
  ON public.inventory_blocks (room_id, date_from, date_to);
`;

async function applyAll(client) {
  await client.query(MINIMAL_SCHEMA);
  const v734Sql = fs.readFileSync(V734, "utf8");
  await client.query(v734Sql);
}

module.exports = { applyAll };
