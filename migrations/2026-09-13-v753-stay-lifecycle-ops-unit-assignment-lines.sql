-- ═══════════════════════════════════════════════════════════════════════════
-- STAY-LIFECYCLE-OPS-01 — multi-unit physical room assignment + authorization
-- closure for the assignment surface.
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ NOT APPLIED TO PRODUCTION by the PR that introduces it. Applying it is an
--    OWNER-controlled operation. Deploy order: apply this migration FIRST, then
--    deploy the code. (The code is backward compatible pre-migration: it falls
--    back to the legacy single-unit row for reads and single-unit writes, and
--    fails closed only for a multi-unit write it cannot represent.)
--
-- WHY
--   • public.bid_unit_assignments has PRIMARY KEY ("bidId") — ONE unit per bid —
--     so an N-room booking (bids."numRooms" > 1) cannot be represented and a
--     re-assignment destructively overwrites history.
--   • It also carries the permissive `all_anon_all` RLS policy from
--     2026-05-13-rls-everywhere (anon + authenticated: ALL, qual/with_check =
--     true), i.e. any client could write/delete any assignment directly.
--
-- SCHEMA CONTRACT (after)
--   public.bid_unit_assignment_lines  — NEW, authoritative, history-preserving:
--     one row per (bid, unit) with status active | superseded | released;
--     partial UNIQUE (bid_id, unit_id) WHERE active  → no duplicate live line;
--     partial UNIQUE (bid_id, slot)    WHERE active  → deterministic slots 1..N;
--     stay_from / stay_to (denormalised from bid_requests at write time) +
--     EXCLUDE USING gist (unit_id =, daterange(stay_from, stay_to, '[)') &&)
--     WHERE active AND dated → the DATABASE refuses two active lines that put
--     the SAME unit on OVERLAPPING nights, even under concurrent writes (the
--     server-side findUnitConflicts check is the fast path; this is the final
--     authority; the server maps the 23P01 → 409 unit_conflict). Backfilled
--     legacy rows without dates do not participate in the EXCLUDE (they stay
--     server-checked) — nothing is invented for them.
--   public.bid_unit_assignments       — LEGACY, kept as the SLOT-1 MIRROR so
--     every existing single-unit reader (availability calendar, customer
--     "allocated room") keeps working unchanged. Backfilled into the lines
--     table below (idempotent).
--   bids."assignedUnitId"             — unchanged column; mirrored to slot 1.
--
-- PRIVILEGE / RLS CONTRACT (after)
--   bid_unit_assignment_lines : RLS ENABLED + FORCED, ZERO client policies;
--                               anon/authenticated: NOTHING; service_role: ALL.
--   bid_unit_assignments      : RLS ENABLED + FORCED; the permissive
--                               `all_anon_all` policy is DROPPED; anon/
--                               authenticated: NOTHING; service_role: ALL.
--   Every server path that touches these tables already elevates to the
--   service role (lib/sb-server SB_H / lib/onboard/supabase-admin / the stay
--   store) — SUPABASE_SERVICE_ROLE_KEY is a production requirement already
--   (admin gate, verified-stay evidence). No client reads these tables
--   directly (verified by source grep). The customer "allocated room" read
--   (/api/my/unit-assignments) and the availability engine are server routes.
--
-- Additive / forward-only. TEXT ids (CUIDs), NO FK constraints (repo contract).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- btree_gist lets the EXCLUDE constraint combine `unit_id =` with a range `&&`.
create extension if not exists btree_gist;

create table if not exists public.bid_unit_assignment_lines (
  id            text primary key,                 -- bual_<bid>_<unit>_<ts36>
  bid_id        text        not null,
  hotel_id      text        not null,             -- denormalised from the bid (integrity checks)
  room_id       text        not null,             -- the booked room CATEGORY
  unit_id       text        not null,             -- hotel_room_units.id
  unit_number   text        not null,             -- display copy at assignment time
  slot          integer     not null default 1,   -- 1..numRooms
  status        text        not null default 'active',  -- active | superseded | released
  assigned_by   text,                              -- verified partner subject
  assigned_at   timestamptz not null default now(),
  released_at   timestamptz,
  released_by   text,
  reason        text,                              -- e.g. "transfer: <reason>", "reassigned before check-in", "unassigned"
  stay_from     date,                              -- denormalised stay range [stay_from, stay_to)
  stay_to       date,
  constraint bual_status_chk check (status in ('active','superseded','released')),
  constraint bual_slot_chk   check (slot >= 1),
  constraint bual_stay_chk   check (stay_from is null or stay_to is null or stay_from < stay_to)
);

create unique index if not exists uniq_bual_active_bid_unit
  on public.bid_unit_assignment_lines (bid_id, unit_id) where status = 'active';
create unique index if not exists uniq_bual_active_bid_slot
  on public.bid_unit_assignment_lines (bid_id, slot) where status = 'active';
create index if not exists idx_bual_bid
  on public.bid_unit_assignment_lines (bid_id);
create index if not exists idx_bual_unit_active
  on public.bid_unit_assignment_lines (unit_id) where status = 'active';

-- DB-enforced clash-freedom: no two ACTIVE, DATED lines may put the same unit on
-- overlapping nights (checkout-exclusive daterange '[)'). Idempotent add.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'excl_bual_unit_night_overlap'
  ) then
    alter table public.bid_unit_assignment_lines
      add constraint excl_bual_unit_night_overlap
      exclude using gist (
        unit_id with =,
        daterange(stay_from, stay_to, '[)') with &&
      ) where (status = 'active' and stay_from is not null and stay_to is not null);
  end if;
end $$;

-- RLS: deny-by-default. ENABLE + FORCE; only BYPASSRLS (service_role) may touch it.
alter table public.bid_unit_assignment_lines enable row level security;
alter table public.bid_unit_assignment_lines force  row level security;
drop policy if exists bual_all on public.bid_unit_assignment_lines;
revoke all on public.bid_unit_assignment_lines from anon, authenticated;
grant  all on public.bid_unit_assignment_lines to   service_role;

-- ── LEGACY table: close the client mutation surface ─────────────────────────
alter table public.bid_unit_assignments enable row level security;
alter table public.bid_unit_assignments force  row level security;
drop policy if exists all_anon_all on public.bid_unit_assignments;
revoke all on public.bid_unit_assignments from anon, authenticated;
grant  all on public.bid_unit_assignments to   service_role;

-- ── Backfill: every existing legacy row becomes an ACTIVE slot-1 line ───────
-- Idempotent (skips bids that already have an active line for that unit).
-- A legacy row whose unit no longer exists in hotel_room_units cannot carry the
-- hotel/room denormalisation and is skipped (it remains readable via the legacy
-- mirror; the server read path falls back to it).
insert into public.bid_unit_assignment_lines
  (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, stay_from, stay_to)
select
  'bual_' || a."bidId" || '_' || a."unitId" || '_bf',
  a."bidId", u."hotelId", u."roomId", a."unitId", a."unitNumber", 1, 'active', a."assignedBy", a."assignedAt",
  r."checkIn"::date, r."checkOut"::date
from public.bid_unit_assignments a
join public.hotel_room_units u on u.id = a."unitId"
left join public.bids b on b.id = a."bidId"
left join public.bid_requests r on r.id = b."requestId" and r."checkIn" < r."checkOut"
where not exists (
  select 1 from public.bid_unit_assignment_lines l
  where l.bid_id = a."bidId" and l.unit_id = a."unitId" and l.status = 'active'
)
on conflict (id) do nothing;

-- ── Backfill: LIVE stays stamped ONLY on bids."assignedUnitId" (Circle / unit-
-- level booking flows write that column directly, never the legacy table) ────
insert into public.bid_unit_assignment_lines
  (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, stay_from, stay_to)
select
  'bual_' || b.id || '_' || b."assignedUnitId" || '_bf',
  b.id, u."hotelId", u."roomId", b."assignedUnitId", u."roomNumber", 1, 'active', null, now(),
  r."checkIn"::date, r."checkOut"::date
from public.bids b
join public.hotel_room_units u on u.id = b."assignedUnitId"
left join public.bid_requests r on r.id = b."requestId" and r."checkIn" < r."checkOut"
where b."assignedUnitId" is not null
  and b.status in ('ACCEPTED','CONFIRMED','CHECKED_IN')
  and not exists (
    select 1 from public.bid_unit_assignment_lines l
    where l.bid_id = b.id and l.unit_id = b."assignedUnitId" and l.status = 'active'
  )
on conflict (id) do nothing;
