-- ═══════════════════════════════════════════════════════════════════════════
-- STAY-LIFECYCLE-OPS-01 — multi-unit physical room assignment: ATOMIC
-- mutation authority, ongoing synchronization of every occupancy writer, ONE
-- cross-table serialization strategy, and authorization closure.
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ NOT APPLIED TO PRODUCTION by the PR that introduces it. Applying it is an
--    OWNER-controlled operation.
--    SAFE CUTOVER = CODE-FIRST, FAIL-CLOSED (M8). Deploy v753 FIRST, THEN apply
--    this migration. Pre-migration the code READS the legacy row (fallback) and
--    REFUSES every occupancy WRITE — the assignment RPCs 503
--    `unit_assignment_rpc_unavailable` (PGRST202) and the walk-in pinned writes
--    503 `unit_assignment_authority_unavailable` (the stay_assignment_ready()
--    probe is absent). The ONLY sanctioned assignment write path is the atomic RPC
--    below, so no non-atomic / unguarded multi-step write path exists in the
--    application at all. The code-first 503 covers the NEW authority surfaces (the
--    assignment RPCs + walk-in pins). Two residual races that the 503 alone does
--    NOT cover are closed at the SCHEMA level by M8-R1 (see the sections below):
--      • a PRE-EXISTING pinned room_blocks writer (OTA sync, b2b/circle/trade
--        verify, inventory holds) is still active during the code-first window and
--        could pin a unit a live legacy assignment already holds → the LOCKED,
--        FAIL-CLOSED cutover preflight at the TOP refuses the migration
--        (stay_assignment_preflight_conflict, full rollback) if any such conflict
--        exists, and its EXCLUSIVE lock stops a concurrent writer racing the
--        preflight→activation gap;
--      • an OLD v752 in-flight request finishing AFTER activation could write a
--        divergent legacy-only row → the LEGACY-TABLE CONVERGENCE GUARD at the END
--        refuses a legacy write with no matching active line.
--    Applying the migration FIRST is NOT safe (a v752 partner could write a
--    divergent legacy assignment during the migration→deploy gap). See the M8-R1
--    preflight (top) + legacy guard (end), the M8 stay_assignment_ready() probe,
--    and the M5 source-table authorization closure.
--
-- WHY
--   • public.bid_unit_assignments has PRIMARY KEY ("bidId") — ONE unit per bid —
--     so an N-room booking cannot be represented and a re-assignment
--     destructively overwrites history.
--   • It carries the permissive `all_anon_all` RLS policy (anon + authenticated:
--     ALL, qual/with_check = true): any client could write/delete any assignment.
--   • Occupancy of a physical unit was claimed from several places
--     (bids."assignedUnitId" stamped by the unit-level booking flow, unit-pinned
--     room_blocks from walk-in / OTA / inventory holds) with no shared authority,
--     so line-vs-block and block-vs-block claims could race or bypass checks.
--
-- SCHEMA CONTRACT (after)
--   public.bid_unit_assignment_lines  — NEW, authoritative, history-preserving:
--     one row per (bid, unit) with status active | superseded | released |
--     completed; partial UNIQUE (bid_id, unit_id) WHERE active; partial UNIQUE
--     (bid_id, slot) WHERE active; stay_from / stay_to denormalised from
--     bid_requests at write time + EXCLUDE USING gist (unit_id =, daterange &&)
--     WHERE active AND dated → the DATABASE refuses the SAME unit on OVERLAPPING
--     nights even under concurrent writes (btree_gist). Backfilled legacy rows
--     without dates do not participate (they stay server/trigger-checked).
--   public.bid_unit_assignments       — LEGACY, kept as the SLOT-1 MIRROR so
--     every existing single-unit reader keeps working; maintained ONLY by the
--     RPC / sync trigger (never by clients).
--   bids."assignedUnitId"             — unchanged column; mirrored to slot 1.
--
-- ATOMIC MUTATION AUTHORITY (M1)
--   stay_assign_units / stay_release_units / stay_assign_block_unit /
--   stay_release_block_unit are plpgsql RPCs. Each runs in ONE transaction:
--   lock → re-validate → close superseded lines → insert target lines → update
--   legacy slot-1 mirror → update bids."assignedUnitId" (or the block). Every
--   refusal is RAISE EXCEPTION (SQLSTATE P0001, MESSAGE = error code, DETAIL =
--   unit id), so a refused or failed call ROLLS BACK everything — the previous
--   assignment state is left exactly as it was. SECURITY INVOKER is sufficient:
--   the only caller is the server's service_role (BYPASSRLS, owns every
--   privilege needed); EXECUTE is REVOKED from PUBLIC / anon / authenticated.
--
-- ONGOING WRITER SYNCHRONIZATION (M2)
--   trg_stay_sync_bid_unit_assignment (AFTER INSERT OR UPDATE OF "assignedUnitId",
--   status ON bids): whenever ANY writer (the unit-level booking flow in
--   app/api/bids/place, the Railway backend, a manual script) puts an occupying
--   booking (ACCEPTED / CONFIRMED / CHECKED_IN) on a unit, an ACTIVE line is
--   ensured (unit validated: exact hotel, exact category, active; conflicts
--   re-checked under the unit lock); CHECKED_OUT → lines 'completed'; terminal
--   (CANCELLED/EXPIRED/REJECTED/DECLINED) → 'released'; a cleared column releases
--   that unit's line. INVARIANT: no occupying booking can hold a unit solely in
--   bids."assignedUnitId" while absent from the authoritative lines table. The
--   trigger function is SECURITY DEFINER with a PINNED search_path because the
--   role that legitimately mutates `bids` (Railway's DB role, the server's
--   anon-fallback headers) has NO privilege on the service_role-only lines
--   table; the function body touches only the named public tables.
--
-- ONE SERIALIZATION STRATEGY ACROSS LINES AND BLOCKS (M3)
--   Every physical-unit occupancy writer — both bid RPCs, both block RPCs, the
--   bids sync trigger and the room_blocks guard trigger (BEFORE INSERT OR UPDATE
--   OF "assignedUnitId","fromDate","toDate") — takes
--   pg_advisory_xact_lock(hashtext('sb_unit:' || unit_id)) and THEN re-checks
--   occupancy with stay_unit_conflict_count(), a VOLATILE function (fresh
--   snapshot after the lock, so a competitor's just-committed row is seen).
--   Concurrent line-vs-block / block-vs-block / line-vs-line claims on the same
--   unit-night therefore serialize deterministically: the first to hold the lock
--   wins, the second re-checks and RAISES (rolling its own write back). The
--   lines EXCLUDE constraint is the final line-vs-line backstop. The guard also
--   validates exact hotel / category / active and derives "assignedUnitNumber"
--   SERVER-SIDE (a client value is never trusted). Writers that go through
--   room_blocks without the app (OTA sync pinned imports, inventory holds) are
--   covered because the guard is a table trigger.
--
-- PRIVILEGE / RLS CONTRACT (after)
--   bid_unit_assignment_lines : RLS ENABLED + FORCED, ZERO client policies;
--                               anon/authenticated: NOTHING; service_role: ALL.
--   bid_unit_assignments      : RLS ENABLED + FORCED; the permissive
--                               `all_anon_all` policy is DROPPED; anon/
--                               authenticated: NOTHING; service_role: ALL.
--   RPC + helper functions    : EXECUTE revoked from PUBLIC/anon/authenticated,
--                               granted to service_role only.
--   Trigger functions         : EXECUTE revoked from PUBLIC/anon/authenticated
--                               (firing a trigger needs no EXECUTE at runtime —
--                               proven by tests/concurrency/stay-unit-assignment
--                               .pg.test.js with a non-owner role). Calling a
--                               trigger function directly is impossible.
--
-- Additive / forward-only. TEXT ids (CUIDs), NO FK constraints (repo contract).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- M8-R1 — ZERO-CORRUPTION CUTOVER PREFLIGHT (must run FIRST, under lock).
-- ═══════════════════════════════════════════════════════════════════════════
-- This migration MUST be applied as ONE transaction (the Supabase CLI / a BEGIN…
-- COMMIT wrapper does this; the concurrency test applies the whole file as one
-- implicit transaction). Two guarantees:
--   (B) SERIALIZE occupancy writers behind the whole migration: an EXCLUSIVE lock
--       on every occupancy source is taken BEFORE the preflight and held until the
--       migration COMMITs (which activates the triggers + RLS). So no concurrent
--       pinned-block / bids write can slip between the preflight and activation —
--       it waits for COMMIT and then meets the now-active guard.
--   (A) FAIL CLOSED on any pre-existing conflict the code-first window could have
--       created: during code-first (v753 deployed, migration NOT yet applied) the
--       assignment RPCs + walk-in pins fail closed 503, but PRE-EXISTING pinned
--       room_blocks writers (OTA sync, b2b/circle/trade verify, inventory holds)
--       stay active and unguarded. One of them could pin a unit that a LIVE legacy
--       assignment (bid_unit_assignments row, or bids."assignedUnitId" stamp on an
--       occupying bid) already holds on overlapping nights. The line backfill below
--       would then create an ACTIVE line whose EXCLUDE constraint only checks
--       line-vs-line — it would NOT see the pre-existing pinned block, so the
--       migration could finish with BOTH occupations (a one-unit/one-night
--       violation). The preflight refuses exactly that: if ANY live assignment
--       (legacy row OR occupying bids."assignedUnitId") overlaps a unit-pinned
--       room_blocks row on the same unit + checkout-exclusive dates, it RAISEs
--       stay_assignment_preflight_conflict and the WHOLE transaction rolls back —
--       ZERO durable schema / RLS / trigger changes. The owner frees the unit and
--       re-applies. Unknown assignment dates are treated as a conflict (fail closed).
lock table public.bids, public.bid_requests, public.room_blocks, public.bid_unit_assignments in exclusive mode;
do $$
declare v_conflict integer;
begin
  with live_assign as (
    select a."unitId" as unit_id, r."checkIn"::date as f, r."checkOut"::date as t
      from public.bid_unit_assignments a
      join public.bids b on b.id = a."bidId"
      left join public.bid_requests r on r.id = b."requestId"
     where upper(coalesce(b.status, '')) in ('ACCEPTED', 'CONFIRMED', 'CHECKED_IN')
       and a."unitId" is not null
    union
    select b."assignedUnitId" as unit_id, r."checkIn"::date as f, r."checkOut"::date as t
      from public.bids b
      left join public.bid_requests r on r.id = b."requestId"
     where b."assignedUnitId" is not null
       and upper(coalesce(b.status, '')) in ('ACCEPTED', 'CONFIRMED', 'CHECKED_IN')
  )
  select count(*) into v_conflict
    from public.room_blocks rb
    join live_assign la on la.unit_id = rb."assignedUnitId"
   where rb."assignedUnitId" is not null
     and (la.f is null or la.t is null                                   -- unknown dates → fail closed
          or (la.f < rb."toDate"::date and rb."fromDate"::date < la.t)); -- checkout-exclusive overlap
  if v_conflict > 0 then
    raise exception 'stay_assignment_preflight_conflict' using errcode = 'P0001',
      detail = v_conflict || ' live assignment(s) overlap a unit-pinned room_block — free the unit before applying';
  end if;
end $$;

-- btree_gist lets the EXCLUDE constraint combine `unit_id =` with a range `&&`.
create extension if not exists btree_gist;

create table if not exists public.bid_unit_assignment_lines (
  id            text primary key,                 -- bual_<bid>_<unit>_<uuid>
  bid_id        text        not null,
  hotel_id      text        not null,             -- denormalised from the bid (integrity checks)
  room_id       text        not null,             -- the booked room CATEGORY
  unit_id       text        not null,             -- hotel_room_units.id
  unit_number   text        not null,             -- display copy at assignment time
  slot          integer     not null default 1,   -- 1..numRooms
  status        text        not null default 'active',  -- active | superseded | released | completed
  assigned_by   text,                              -- verified partner subject / 'lifecycle'
  assigned_at   timestamptz not null default now(),
  released_at   timestamptz,
  released_by   text,
  reason        text,                              -- "transfer: <reason>", "reassigned before check-in", "unassigned", "lifecycle: <status>"
  stay_from     date,                              -- denormalised stay range [stay_from, stay_to)
  stay_to       date,
  constraint bual_slot_chk   check (slot >= 1),
  constraint bual_stay_chk   check (stay_from is null or stay_to is null or stay_from < stay_to)
);
-- (re)establish the status check idempotently (adds 'completed' = finished stay, no longer occupying)
alter table public.bid_unit_assignment_lines drop constraint if exists bual_status_chk;
alter table public.bid_unit_assignment_lines
  add constraint bual_status_chk check (status in ('active','superseded','released','completed'));

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
  if not exists (select 1 from pg_constraint where conname = 'excl_bual_unit_night_overlap') then
    alter table public.bid_unit_assignment_lines
      add constraint excl_bual_unit_night_overlap
      exclude using gist (unit_id with =, daterange(stay_from, stay_to, '[)') with &&)
      where (status = 'active' and stay_from is not null and stay_to is not null);
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Occupancy helpers (called by the RPCs and both triggers)
-- ═══════════════════════════════════════════════════════════════════════════
-- Per-unit serialization point shared by EVERY occupancy writer.
create or replace function public.stay_lock_unit(p_unit_id text) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtext('sb_unit:' || p_unit_id)::bigint);
$$;

-- Number of OTHER live occupations of a unit overlapping [p_from, p_to):
--   • ACTIVE lines of OTHER occupying bids (dated → range overlap; undated → the
--     bid_requests dates; undated AND no request dates → counted, fail closed);
--   • room_blocks pinned to the unit (any source) overlapping the range, except
--     the caller's own block.
-- VOLATILE on purpose: each statement takes a fresh snapshot, so a competitor's
-- row committed while we waited for the advisory lock IS seen.
create or replace function public.stay_unit_conflict_count(
  p_unit_id text, p_from date, p_to date, p_exclude_bid text, p_exclude_block text
) returns integer language plpgsql volatile as $$
declare v_lines integer; v_blocks integer;
begin
  select count(*) into v_lines
    from public.bid_unit_assignment_lines l
    left join public.bids b on b.id = l.bid_id
    left join public.bid_requests r on r.id = b."requestId"
   where l.unit_id = p_unit_id and l.status = 'active'
     and (p_exclude_bid is null or l.bid_id <> p_exclude_bid)
     and upper(coalesce(b.status, '')) in ('ACCEPTED','CONFIRMED','CHECKED_IN')
     and (
       (l.stay_from is not null and l.stay_to is not null and l.stay_from < p_to and p_from < l.stay_to)
       or (l.stay_from is null and r."checkIn" is not null and r."checkOut" is not null
           and r."checkIn"::date < p_to and p_from < r."checkOut"::date)
       or (l.stay_from is null and (r."checkIn" is null or r."checkOut" is null))
     );
  select count(*) into v_blocks
    from public.room_blocks rb
   where rb."assignedUnitId" = p_unit_id
     and (p_exclude_block is null or rb.id <> p_exclude_block)
     and rb."fromDate"::date < p_to and p_from < rb."toDate"::date;
  return v_lines + v_blocks;
end $$;

-- Smallest free slot number among a bid's ACTIVE lines.
create or replace function public.stay_next_free_slot(p_bid_id text) returns integer
language plpgsql volatile as $$
declare v_slot integer := 1;
begin
  while exists (select 1 from public.bid_unit_assignment_lines where bid_id = p_bid_id and status = 'active' and slot = v_slot) loop
    v_slot := v_slot + 1;
  end loop;
  return v_slot;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- M1 — ATOMIC assignment-set mutation (the ONLY sanctioned write path)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.stay_assign_units(
  p_bid_id text, p_unit_ids text[], p_partner_subject text, p_mode text, p_reason text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_bid record; v_unit record; v_status text; v_mode text := lower(coalesce(p_mode, 'assign'));
  v_ids text[]; v_raw_count integer; v_required integer; v_from date; v_to date;
  v_lock text[]; v_u text; v_reason text; v_now timestamptz := now(); v_assigned jsonb;
  v_slot1_unit text; v_slot1_num text;
begin
  -- distinct requested ids, first-occurrence order; duplicates are a malformed request
  select array_agg(x order by ord) into v_ids
    from (select x, min(ord) as ord from unnest(p_unit_ids) with ordinality as t(x, ord)
           where coalesce(btrim(x), '') <> '' group by x) s;
  select count(*) into v_raw_count from unnest(p_unit_ids) x where coalesce(btrim(x), '') <> '';
  if v_ids is null or coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'no_units' using errcode = 'P0001';
  end if;
  if array_length(v_ids, 1) <> v_raw_count then
    raise exception 'duplicate_unit' using errcode = 'P0001';
  end if;

  -- serialize per bid (row lock) + lifecycle gate
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'bid_not_found' using errcode = 'P0001'; end if;
  v_status := upper(coalesce(v_bid.status, ''));
  if v_status = 'CHECKED_OUT' then raise exception 'stay_completed' using errcode = 'P0001'; end if;
  if v_status = 'CHECKED_IN' then
    if v_mode <> 'transfer' then raise exception 'transfer_confirmation_required' using errcode = 'P0001'; end if;
    if coalesce(btrim(p_reason), '') = '' then raise exception 'transfer_reason_required' using errcode = 'P0001'; end if;
  elsif v_status not in ('ACCEPTED', 'CONFIRMED') then
    raise exception 'bid_not_reservable' using errcode = 'P0001';
  elsif v_mode = 'transfer' then
    raise exception 'transfer_only_while_checked_in' using errcode = 'P0001';
  end if;
  v_required := greatest(1, coalesce(v_bid."numRooms", 1));
  if array_length(v_ids, 1) > v_required then raise exception 'too_many_units' using errcode = 'P0001'; end if;

  -- stay range (server-read)
  select r."checkIn"::date, r."checkOut"::date into v_from, v_to
    from public.bid_requests r where r.id = v_bid."requestId";
  if v_from is null or v_to is null or v_from >= v_to then
    raise exception 'stay_dates_unavailable' using errcode = 'P0001';
  end if;

  -- ONE serialization strategy: advisory xact locks on every involved unit, sorted
  select array_agg(distinct x order by x) into v_lock
    from unnest(v_ids || coalesce((select array_agg(unit_id) from public.bid_unit_assignment_lines
                                     where bid_id = p_bid_id and status = 'active'), '{}'::text[])) x;
  foreach v_u in array v_lock loop perform public.stay_lock_unit(v_u); end loop;

  -- validate every requested unit under the locks (exact hotel / category / active / no live overlap)
  foreach v_u in array v_ids loop
    select * into v_unit from public.hotel_room_units where id = v_u;
    if not found then raise exception 'unit_not_found' using errcode = 'P0001', detail = v_u; end if;
    if v_unit."hotelId" <> v_bid."hotelId" then raise exception 'unit_wrong_hotel' using errcode = 'P0001', detail = v_u; end if;
    if v_unit."roomId" <> v_bid."roomId" then raise exception 'unit_wrong_category' using errcode = 'P0001', detail = v_u; end if;
    if lower(coalesce(v_unit.status, '')) <> 'active' then raise exception 'unit_inactive' using errcode = 'P0001', detail = v_u; end if;
    if public.stay_unit_conflict_count(v_u, v_from, v_to, p_bid_id, null) > 0 then
      raise exception 'unit_conflict' using errcode = 'P0001', detail = v_u;
    end if;
  end loop;

  v_reason := case when v_mode = 'transfer' then 'transfer: ' || left(btrim(p_reason), 300) else 'reassigned before check-in' end;

  -- close every active line not in the target set (history preserved, never deleted)
  update public.bid_unit_assignment_lines
     set status = 'superseded', released_at = v_now, released_by = p_partner_subject, reason = v_reason
   where bid_id = p_bid_id and status = 'active' and not (unit_id = any (v_ids));

  -- insert the missing target lines (existing active lines keep their slot)
  foreach v_u in array v_ids loop
    if not exists (select 1 from public.bid_unit_assignment_lines where bid_id = p_bid_id and unit_id = v_u and status = 'active') then
      insert into public.bid_unit_assignment_lines
        (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, reason, stay_from, stay_to)
      select 'bual_' || p_bid_id || '_' || v_u || '_' || replace(gen_random_uuid()::text, '-', ''),
             p_bid_id, v_bid."hotelId", v_bid."roomId", v_u, u."roomNumber", public.stay_next_free_slot(p_bid_id),
             'active', p_partner_subject, v_now, case when v_mode = 'transfer' then v_reason else null end, v_from, v_to
        from public.hotel_room_units u where u.id = v_u;
    end if;
  end loop;

  -- slot-1 mirror (legacy readers) + bids."assignedUnitId" — same transaction.
  -- The mirror is the LOWEST active slot (an existing line keeps its slot).
  select unit_id, unit_number into v_slot1_unit, v_slot1_num
    from public.bid_unit_assignment_lines
   where bid_id = p_bid_id and status = 'active' order by slot asc limit 1;
  insert into public.bid_unit_assignments ("bidId", "unitId", "unitNumber", "assignedBy", "assignedAt")
  values (p_bid_id, v_slot1_unit, v_slot1_num, p_partner_subject, v_now)
  on conflict ("bidId") do update
    set "unitId" = excluded."unitId", "unitNumber" = excluded."unitNumber",
        "assignedBy" = excluded."assignedBy", "assignedAt" = excluded."assignedAt";
  update public.bids set "assignedUnitId" = v_slot1_unit where id = p_bid_id;

  select jsonb_agg(jsonb_build_object('unitId', unit_id, 'unitNumber', unit_number, 'slot', slot) order by slot)
    into v_assigned from public.bid_unit_assignment_lines where bid_id = p_bid_id and status = 'active';
  return jsonb_build_object('ok', true, 'action', v_mode, 'required', v_required,
                            'assigned', coalesce(v_assigned, '[]'::jsonb));
end $$;

create or replace function public.stay_release_units(p_bid_id text, p_partner_subject text, p_reason text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_bid record; v_status text; v_released text[]; v_u text;
begin
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'bid_not_found' using errcode = 'P0001'; end if;
  v_status := upper(coalesce(v_bid.status, ''));
  if v_status = 'CHECKED_OUT' then raise exception 'stay_completed' using errcode = 'P0001'; end if;
  if v_status = 'CHECKED_IN' then raise exception 'unassign_not_allowed_in_house' using errcode = 'P0001'; end if;
  select coalesce(array_agg(unit_id order by unit_id), '{}'::text[]) into v_released
    from public.bid_unit_assignment_lines where bid_id = p_bid_id and status = 'active';
  foreach v_u in array v_released loop perform public.stay_lock_unit(v_u); end loop;
  update public.bid_unit_assignment_lines
     set status = 'released', released_at = now(), released_by = p_partner_subject,
         reason = coalesce(nullif(btrim(p_reason), ''), 'unassigned')
   where bid_id = p_bid_id and status = 'active';
  delete from public.bid_unit_assignments where "bidId" = p_bid_id;
  update public.bids set "assignedUnitId" = null where id = p_bid_id;
  return jsonb_build_object('ok', true, 'released', to_jsonb(v_released));
end $$;

-- Walk-in / OTA / manual block: pin a unit atomically (the BEFORE UPDATE guard
-- trigger below validates, serializes and derives the unit number).
create or replace function public.stay_assign_block_unit(p_block_id text, p_unit_id text, p_partner_subject text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_block record; v_num text;
begin
  select * into v_block from public.room_blocks where id = p_block_id for update;
  if not found then raise exception 'block_not_found' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_unit_id), '') = '' then raise exception 'no_units' using errcode = 'P0001'; end if;
  update public.room_blocks set "assignedUnitId" = p_unit_id where id = p_block_id;
  select "assignedUnitNumber" into v_num from public.room_blocks where id = p_block_id;
  return jsonb_build_object('ok', true, 'unitId', p_unit_id, 'unitNumber', v_num);
end $$;

create or replace function public.stay_release_block_unit(p_block_id text, p_partner_subject text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_block record;
begin
  select * into v_block from public.room_blocks where id = p_block_id for update;
  if not found then raise exception 'block_not_found' using errcode = 'P0001'; end if;
  update public.room_blocks set "assignedUnitId" = null, "assignedUnitNumber" = null where id = p_block_id;
  return jsonb_build_object('ok', true);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- M2 — keep EVERY bids."assignedUnitId" writer synchronized with the lines table
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER (pinned search_path): the roles that legitimately write
-- `bids` (Railway's DB role, the server's anon-fallback) hold no privilege on
-- the service_role-only lines table; the body touches only the named tables.
create or replace function public.stay_sync_bid_unit_assignment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_unit record; v_from date; v_to date; v_required integer; v_active integer; v_actor text;
begin
  -- M5 tripwire (defense in depth). This SECURITY DEFINER function is the ONLY
  -- occupancy writer that reaches the service_role-only lines/mirror tables, so it
  -- is the privilege-bridge surface. The PRIMARY closure is the REVOKE of anon/
  -- authenticated write on public.bids (M5 section at the end of this migration):
  -- an untrusted PostgREST role can no longer INSERT/UPDATE bids at all, so this
  -- trigger is never reached by anon/authenticated. This tripwire refuses the bridge
  -- even if a write grant is ever re-added. A NULL/absent claim (a direct DB or
  -- backend connection, e.g. Railway) is TRUSTED and allowed, so it never breaks a
  -- legitimate server/service_role writer.
  begin v_actor := current_setting('request.jwt.claims', true)::json->>'role'; exception when others then v_actor := null; end;
  if v_actor in ('anon', 'authenticated') then
    raise exception 'unit_assignment_forbidden_role' using errcode = 'P0001', detail = coalesce(v_actor, '');
  end if;
  v_status := upper(coalesce(new.status, ''));

  -- lifecycle exits: a finished stay no longer occupies its unit (history kept)
  if v_status = 'CHECKED_OUT' then
    update public.bid_unit_assignment_lines
       set status = 'completed', released_at = now(), released_by = 'lifecycle', reason = 'lifecycle: CHECKED_OUT'
     where bid_id = new.id and status = 'active';
    return new;
  end if;
  if v_status in ('CANCELLED', 'EXPIRED', 'REJECTED', 'DECLINED') then
    update public.bid_unit_assignment_lines
       set status = 'released', released_at = now(), released_by = 'lifecycle', reason = 'lifecycle: ' || v_status
     where bid_id = new.id and status = 'active';
    return new;
  end if;
  -- PENDING / COUNTER / unknown: a bid that does not occupy inventory yet
  if v_status not in ('ACCEPTED', 'CONFIRMED', 'CHECKED_IN') then return new; end if;

  -- column cleared by a writer → that unit is released
  if new."assignedUnitId" is null then
    if tg_op = 'UPDATE' and old."assignedUnitId" is not null then
      update public.bid_unit_assignment_lines
         set status = 'released', released_at = now(), released_by = 'lifecycle', reason = 'assignedUnitId cleared'
       where bid_id = new.id and unit_id = old."assignedUnitId" and status = 'active';
      delete from public.bid_unit_assignments where "bidId" = new.id and "unitId" = old."assignedUnitId";
    end if;
    return new;
  end if;

  -- occupying booking on a unit: ensure an ACTIVE line exists (validated + serialized)
  perform public.stay_lock_unit(new."assignedUnitId");
  if not exists (select 1 from public.bid_unit_assignment_lines
                  where bid_id = new.id and unit_id = new."assignedUnitId" and status = 'active') then
    select * into v_unit from public.hotel_room_units where id = new."assignedUnitId";
    if not found then raise exception 'unit_not_found' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
    if v_unit."hotelId" <> new."hotelId" then raise exception 'unit_wrong_hotel' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
    if v_unit."roomId" <> new."roomId" then raise exception 'unit_wrong_category' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
    if lower(coalesce(v_unit.status, '')) <> 'active' then raise exception 'unit_inactive' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
    select r."checkIn"::date, r."checkOut"::date into v_from, v_to from public.bid_requests r where r.id = new."requestId";
    if v_from is not null and v_to is not null and v_from < v_to then
      if public.stay_unit_conflict_count(new."assignedUnitId", v_from, v_to, new.id, null) > 0 then
        raise exception 'unit_conflict' using errcode = 'P0001', detail = new."assignedUnitId";
      end if;
    else
      v_from := null; v_to := null; -- undated: server-side checks apply; the EXCLUDE cannot protect it
    end if;
    insert into public.bid_unit_assignment_lines
      (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, reason, stay_from, stay_to)
    values ('bual_' || new.id || '_' || new."assignedUnitId" || '_' || replace(gen_random_uuid()::text, '-', ''),
            new.id, new."hotelId", new."roomId", new."assignedUnitId", v_unit."roomNumber",
            public.stay_next_free_slot(new.id), 'active', 'lifecycle', now(), 'synced from bids.assignedUnitId', v_from, v_to);
    -- the column IS the primary unit → keep the legacy slot-1 mirror truthful
    insert into public.bid_unit_assignments ("bidId", "unitId", "unitNumber", "assignedBy", "assignedAt")
    values (new.id, new."assignedUnitId", v_unit."roomNumber", 'lifecycle', now())
    on conflict ("bidId") do update
      set "unitId" = excluded."unitId", "unitNumber" = excluded."unitNumber", "assignedAt" = excluded."assignedAt";
    -- a direct writer CHANGED the primary unit: supersede the old one only when the
    -- booking would otherwise exceed its room count (the RPC manages sets itself)
    if tg_op = 'UPDATE' and old."assignedUnitId" is not null and old."assignedUnitId" <> new."assignedUnitId" then
      v_required := greatest(1, coalesce(new."numRooms", 1));
      select count(*) into v_active from public.bid_unit_assignment_lines where bid_id = new.id and status = 'active';
      if v_active > v_required then
        update public.bid_unit_assignment_lines
           set status = 'superseded', released_at = now(), released_by = 'lifecycle', reason = 'assignedUnitId changed'
         where bid_id = new.id and unit_id = old."assignedUnitId" and status = 'active';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_stay_sync_bid_unit_assignment on public.bids;
create trigger trg_stay_sync_bid_unit_assignment
  after insert or update of "assignedUnitId", status on public.bids
  for each row execute function public.stay_sync_bid_unit_assignment();

-- ═══════════════════════════════════════════════════════════════════════════
-- M3 — room_blocks unit pins: validate, serialize, derive the number server-side
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.stay_guard_room_block_unit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_unit record; v_actor text;
begin
  -- M5 tripwire (defense in depth) — see stay_sync_bid_unit_assignment. The primary
  -- closure is the REVOKE of anon/authenticated write on public.room_blocks (M5
  -- section below); a NULL/absent claim (direct DB / backend) is trusted.
  begin v_actor := current_setting('request.jwt.claims', true)::json->>'role'; exception when others then v_actor := null; end;
  if v_actor in ('anon', 'authenticated') then
    raise exception 'unit_assignment_forbidden_role' using errcode = 'P0001', detail = coalesce(v_actor, '');
  end if;
  if new."assignedUnitId" is null then return new; end if;
  if tg_op = 'UPDATE'
     and new."assignedUnitId" is not distinct from old."assignedUnitId"
     and new."fromDate" is not distinct from old."fromDate"
     and new."toDate" is not distinct from old."toDate" then
    return new;
  end if;
  perform public.stay_lock_unit(new."assignedUnitId");
  select * into v_unit from public.hotel_room_units where id = new."assignedUnitId";
  if not found then raise exception 'unit_not_found' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
  if v_unit."hotelId" <> new."hotelId" then raise exception 'unit_wrong_hotel' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
  if v_unit."roomId" <> new."roomId" then raise exception 'unit_wrong_category' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
  if lower(coalesce(v_unit.status, '')) <> 'active' then raise exception 'unit_inactive' using errcode = 'P0001', detail = new."assignedUnitId"; end if;
  if public.stay_unit_conflict_count(new."assignedUnitId", new."fromDate"::date, new."toDate"::date, null, new.id) > 0 then
    raise exception 'unit_conflict' using errcode = 'P0001', detail = new."assignedUnitId";
  end if;
  new."assignedUnitNumber" := v_unit."roomNumber"; -- never a client value
  return new;
end $$;

drop trigger if exists trg_stay_guard_room_block_unit on public.room_blocks;
create trigger trg_stay_guard_room_block_unit
  before insert or update of "assignedUnitId", "fromDate", "toDate" on public.room_blocks
  for each row execute function public.stay_guard_room_block_unit();

-- ═══════════════════════════════════════════════════════════════════════════
-- Function privileges: service_role only; no generic/public mutation authority
-- ═══════════════════════════════════════════════════════════════════════════
revoke execute on function public.stay_lock_unit(text) from public, anon, authenticated;
revoke execute on function public.stay_unit_conflict_count(text, date, date, text, text) from public, anon, authenticated;
revoke execute on function public.stay_next_free_slot(text) from public, anon, authenticated;
revoke execute on function public.stay_assign_units(text, text[], text, text, text) from public, anon, authenticated;
revoke execute on function public.stay_release_units(text, text, text) from public, anon, authenticated;
revoke execute on function public.stay_assign_block_unit(text, text, text) from public, anon, authenticated;
revoke execute on function public.stay_release_block_unit(text, text) from public, anon, authenticated;
revoke execute on function public.stay_sync_bid_unit_assignment() from public, anon, authenticated;
revoke execute on function public.stay_guard_room_block_unit() from public, anon, authenticated;
grant execute on function public.stay_lock_unit(text) to service_role;
grant execute on function public.stay_unit_conflict_count(text, date, date, text, text) to service_role;
grant execute on function public.stay_next_free_slot(text) to service_role;
grant execute on function public.stay_assign_units(text, text[], text, text, text) to service_role;
grant execute on function public.stay_release_units(text, text, text) to service_role;
grant execute on function public.stay_assign_block_unit(text, text, text) to service_role;
grant execute on function public.stay_release_block_unit(text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill (idempotent). Line status follows the bid's lifecycle so a finished
-- or dead stay never occupies a unit; only live stays get ACTIVE lines.
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.bid_unit_assignment_lines
  (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, reason, stay_from, stay_to)
select
  'bual_' || a."bidId" || '_' || a."unitId" || '_bf',
  a."bidId", u."hotelId", u."roomId", a."unitId", a."unitNumber", 1,
  case when upper(coalesce(b.status,'')) in ('ACCEPTED','CONFIRMED','CHECKED_IN') then 'active'
       when upper(coalesce(b.status,'')) = 'CHECKED_OUT' then 'completed' else 'released' end,
  a."assignedBy", a."assignedAt", 'backfill: legacy bid_unit_assignments',
  r."checkIn"::date, r."checkOut"::date
from public.bid_unit_assignments a
join public.hotel_room_units u on u.id = a."unitId"
left join public.bids b on b.id = a."bidId"
left join public.bid_requests r on r.id = b."requestId" and r."checkIn" < r."checkOut"
where not exists (select 1 from public.bid_unit_assignment_lines l where l.bid_id = a."bidId" and l.unit_id = a."unitId")
on conflict (id) do nothing;

-- LIVE stays stamped ONLY on bids."assignedUnitId" (unit-level booking flow)
insert into public.bid_unit_assignment_lines
  (id, bid_id, hotel_id, room_id, unit_id, unit_number, slot, status, assigned_by, assigned_at, reason, stay_from, stay_to)
select
  'bual_' || b.id || '_' || b."assignedUnitId" || '_bf',
  b.id, u."hotelId", u."roomId", b."assignedUnitId", u."roomNumber", 1, 'active', 'backfill', now(),
  'backfill: bids.assignedUnitId', r."checkIn"::date, r."checkOut"::date
from public.bids b
join public.hotel_room_units u on u.id = b."assignedUnitId"
left join public.bid_requests r on r.id = b."requestId" and r."checkIn" < r."checkOut"
where b."assignedUnitId" is not null
  and upper(coalesce(b.status,'')) in ('ACCEPTED','CONFIRMED','CHECKED_IN')
  and not exists (select 1 from public.bid_unit_assignment_lines l
                   where l.bid_id = b.id and l.unit_id = b."assignedUnitId" and l.status = 'active')
on conflict (id) do nothing;

-- Legacy slot-1 mirror for LIVE stays that were stamped only on bids."assignedUnitId"
-- (keeps the single-unit readers truthful for pre-existing rows).
insert into public.bid_unit_assignments ("bidId", "unitId", "unitNumber", "assignedBy", "assignedAt")
select b.id, b."assignedUnitId", u."roomNumber", 'backfill', now()
from public.bids b
join public.hotel_room_units u on u.id = b."assignedUnitId"
where b."assignedUnitId" is not null
  and upper(coalesce(b.status,'')) in ('ACCEPTED','CONFIRMED','CHECKED_IN')
  and not exists (select 1 from public.bid_unit_assignments a where a."bidId" = b.id)
on conflict ("bidId") do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- M8 — safe cutover probe. A read-only, side-effect-free authority signal so the
-- application can FAIL CLOSED before any occupancy write when the migration is not
-- yet applied. The deploy order is CODE-FIRST: deploy v753 (every occupancy WRITE
-- fails closed 503 while this function / the RPCs are absent — reads fall back to
-- the legacy row), THEN apply this migration (writes become available). That order
-- prevents BOTH (1) old-v752 legacy-only assignment writes after schema activation
-- (v752 is fully replaced before the migration) and (2) new-v753 unguarded pinned
-- writes before the guard/trigger exist (they 503). SECURITY INVOKER; EXECUTE
-- service_role only.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.stay_assignment_ready() returns boolean
language sql security invoker set search_path = public, pg_temp as $$ select true $$;
revoke execute on function public.stay_assignment_ready() from public, anon, authenticated;
grant  execute on function public.stay_assignment_ready() to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- M5 — SOURCE-TABLE AUTHORIZATION CLOSURE (public.bids + public.room_blocks)
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: before this migration public.bids carried policies all_anon_all (anon,
-- authenticated: ALL true/true) + "public rw" (public: ALL true/true), and
-- public.room_blocks carried all_anon_all — with anon/authenticated holding full
-- INSERT/UPDATE/DELETE table grants. The public anon key is, by design, PUBLIC, so
-- ANY holder could bypass the hardened Next routes and directly mutate bids /
-- room_blocks via PostgREST. Combined with the NEW SECURITY DEFINER occupancy
-- triggers introduced above, an untrusted direct write to bids.assignedUnitId /
-- status (or a pinned room_block) would drive a privileged trigger into the
-- service_role-only assignment lines/mirror — a privilege bridge.
--
-- CLOSURE: revoke DIRECT public/anon/authenticated MUTATION of both tables and
-- preserve every legitimate server writer through service_role (which every
-- frontend server route already uses — lib/sb-server SB_H sends the service-role
-- key in Authorization when SUPABASE_SERVICE_ROLE_KEY is set; verified: no browser
-- component and no SB_H_ANON_ONLY path writes these tables). READS are preserved
-- (a permissive SELECT policy stays open) — this closes MUTATION only, not the
-- broad customer/partner read surface. This section lands in the SAME atomic
-- migration as the triggers, so the bridge never exists for even one moment.
--
-- ⚠ OWNER PREREQUISITE (OD3, apply-time): every legitimate writer of bids /
-- room_blocks MUST use the service_role key before applying. The frontend is
-- proven safe (all server routes use SB_H=service_role; the anon fallback only
-- engages when SUPABASE_SERVICE_ROLE_KEY is unset, which already fails closed
-- elsewhere and is a documented production requirement). An EXTERNAL writer
-- (Railway) that writes these tables via the ANON key — NOT observable from this
-- repo — would begin failing closed; confirm Railway uses the service_role key
-- (or a BYPASSRLS/granted role) before applying.

alter table public.bids        enable row level security;
alter table public.room_blocks enable row level security;

-- Drop EVERY existing policy on each table (name-independent) so no permissive
-- write policy survives, then install exactly ONE permissive SELECT policy.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'bids' loop
    execute format('drop policy if exists %I on public.bids', p.policyname);
  end loop;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'room_blocks' loop
    execute format('drop policy if exists %I on public.room_blocks', p.policyname);
  end loop;
end $$;

create policy bids_select_all        on public.bids        for select to public using (true);
create policy room_blocks_select_all on public.room_blocks for select to public using (true);

-- Revoke the write surface from every untrusted role; keep SELECT.
revoke insert, update, delete, truncate on public.bids        from anon, authenticated, public;
revoke insert, update, delete, truncate on public.room_blocks from anon, authenticated, public;
grant  select                          on public.bids        to   anon, authenticated;
grant  select                          on public.room_blocks to   anon, authenticated;
-- Legitimate server writers only (service_role bypasses RLS + holds the grant).
grant  select, insert, update, delete  on public.bids        to   service_role;
grant  select, insert, update, delete  on public.room_blocks to   service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- M8-R1 — LEGACY-TABLE CONVERGENCE GUARD (closes the old-v752 in-flight write).
-- ═══════════════════════════════════════════════════════════════════════════
-- After the cutover, an OLD v752 request still in flight could finish and write a
-- legacy public.bid_unit_assignments row DIRECTLY (v752 does not know about the
-- lines table), producing a legacy-only assignment that diverges from the lines.
-- The legacy table is maintained ONLY by the atomic RPCs / sync trigger / this
-- migration's backfill, all of which insert the authoritative ACTIVE line BEFORE
-- the slot-1 mirror. So a direct legacy write with NO matching active line is an
-- out-of-contract writer → REFUSE it. This makes a post-migration legacy-only
-- write converge (refuse) safely instead of diverging. Created LAST so the
-- backfills above (which write the mirror only after their lines exist) are
-- unaffected. Fires on INSERT/UPDATE only (releases DELETE the mirror). SECURITY
-- DEFINER + pinned search_path; a NULL/absent request.jwt.claims role (direct DB /
-- service_role backend) is trusted for the SAME anon/authenticated tripwire as the
-- other definer functions.
create or replace function public.stay_guard_legacy_assignment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor text;
begin
  begin v_actor := current_setting('request.jwt.claims', true)::json->>'role'; exception when others then v_actor := null; end;
  if v_actor in ('anon', 'authenticated') then
    raise exception 'unit_assignment_forbidden_role' using errcode = 'P0001', detail = coalesce(v_actor, '');
  end if;
  if not exists (
    select 1 from public.bid_unit_assignment_lines l
     where l.bid_id = new."bidId" and l.unit_id = new."unitId" and l.status = 'active'
  ) then
    raise exception 'legacy_assignment_without_line' using errcode = 'P0001', detail = coalesce(new."bidId", '');
  end if;
  return new;
end $$;

drop trigger if exists trg_stay_guard_legacy_assignment on public.bid_unit_assignments;
create trigger trg_stay_guard_legacy_assignment
  before insert or update on public.bid_unit_assignments
  for each row execute function public.stay_guard_legacy_assignment();

revoke execute on function public.stay_guard_legacy_assignment() from public, anon, authenticated;
