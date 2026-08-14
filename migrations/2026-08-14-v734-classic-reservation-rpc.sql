-- ════════════════════════════════════════════════════════════════════════
-- v734 — Classic (unit-less) reservation: atomic pre-payment RPC
--
-- CONTEXT (Phases 1–4C read-only design):
--   The M4 hotel_owner classic branch (inventory_blocks.unit_id NULL, capacity
--   = rooms.quantity) reserved capacity via a NON-ATOMIC read (classicCategoryFree
--   → unitsFreeForRange). Two concurrent buyers could BOTH see free ≥ 1 and BOTH
--   complete checkout → oversell. The unit branch already prevents this via
--   assignFreeUnit + the self-excluding overlap re-guard on unit_id; the classic
--   branch had no such guard because there is no unit to key on.
--
--   PHASE 4B/4C moves the classic reservation to a SINGLE ATOMIC RPC that runs
--   BEFORE Razorpay order creation. A loser 409s with the client's browser NEVER
--   opening the Razorpay modal — no captured payment to refund.
--
-- WHAT THIS MIGRATION DOES (additive-only):
--   • CREATE OR REPLACE FUNCTION reserve_classic_block(...) — the atomic gate.
--   • CREATE OR REPLACE FUNCTION assert_classic_hold_still_ours(text) — the
--     pure-read helper the classic verify path calls INSTEAD of upserting
--     `invhold_<blockId>` (which would silently recreate a released hold and
--     reintroduce the post-payment race).
--
-- WHAT IT DOES NOT DO:
--   • No new tables. No column additions. No FK. No touching of existing rows.
--   • No changes to unitsFreeForRange / getOccupations / assignFreeUnit /
--     roomHasActiveUnits — they remain the single availability reader.
--   • No changes to the M4 unit-inventory branch (unit_id NOT NULL) — that path
--     is already race-safe via assignFreeUnit + the overlap re-guard.
--
-- SEBI-SAFE / CIRCLE-LOCKED contract preserved:
--   • Only the CATEGORY hold + pending block are written (no ownership shift).
--   • room_blocks.source='inventory' + assignedUnitId=NULL matches the v729
--     precedent (unitsFreeForRange counts it against rooms.quantity as-is).
--
-- ════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────
-- reserve_classic_block — atomic classic reservation for the pre-payment
-- boundary. Called from every classic-branch checkout route BEFORE the
-- Razorpay order is created.
--
-- CONCURRENCY CONTRACT
--   1. pg_advisory_xact_lock keyed on (hotelId, roomId) serialises every caller
--      for the same room. Two rooms lock independently. The lock is released at
--      COMMIT or ROLLBACK. No lock on `rooms`, so guest availability reads are
--      untouched.
--   2. Idempotency check runs INSIDE the lock. A same-blockId retry returns
--      `already_reserved` deterministically — never races into a duplicate-PK
--      500.
--   3. Peak occupancy = MAX per night of (Σ room_blocks) ∪ (Σ hard-blocking bids
--      × numRooms). Mirrors lib/availability.ts::getOccupations EXACTLY:
--      status IN (ACCEPTED, COUNTER, CONFIRMED, CHECKED_IN); PENDING excluded.
--   4. A pre-existing `invhold_<blockId>` row with a mismatched shape → 409
--      (`hold_id_conflict`), never silent success. `source='inventory'`, no
--      `assignedUnitId`.
--
-- RETURN
--   jsonb — always includes { ok, code }. Success adds block_id, hold_id,
--   capacity, occupied. Failure adds capacity/occupied where meaningful.
--
-- CALLERS
--   lib/inventory/assign.ts::reserveClassicAtomically wraps this RPC and is
--   the only route into it from application code.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserve_classic_block(
  p_block_id             TEXT,
  p_hotel_id             TEXT,
  p_room_id              TEXT,
  p_investor_user_id     TEXT,
  p_date_from            DATE,
  p_date_to              DATE,
  p_buy_price_per_night  NUMERIC,
  p_buy_total            NUMERIC,
  p_metadata             JSONB,
  p_razorpay_order_id    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_lock_key   BIGINT;
  v_hold_id    TEXT;
  v_existing   RECORD;
  v_existing_hold RECORD;
  v_capacity   INT;
  v_peak_occ   INT;
  v_nights     INT;
BEGIN
  -- Argument gate (parity with lib/inventory/assign.ts guards).
  IF p_block_id IS NULL OR length(btrim(p_block_id)) = 0
     OR p_hotel_id IS NULL OR length(btrim(p_hotel_id)) = 0
     OR p_room_id IS NULL OR length(btrim(p_room_id)) = 0
     OR p_investor_user_id IS NULL OR length(btrim(p_investor_user_id)) = 0
     OR p_date_from IS NULL OR p_date_to IS NULL
     OR p_date_to <= p_date_from THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_request');
  END IF;

  v_hold_id := 'invhold_' || p_block_id;
  v_nights  := (p_date_to - p_date_from)::int;

  -- Classic guard: the RPC is ONLY for rooms with no active physical units.
  -- Callers use assignFreeUnit first; only when it returns null do they call
  -- this RPC. Belt-and-braces: refuse if hotel_room_units carries an active
  -- row for this (hotelId, roomId).
  IF EXISTS (
    SELECT 1 FROM public.hotel_room_units
     WHERE "hotelId" = p_hotel_id
       AND "roomId"  = p_room_id
       AND status    = 'active'
     LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_classic');
  END IF;

  -- ── SERIALIZATION BOUNDARY ─────────────────────────────────────────
  -- Every subsequent statement runs one-caller-at-a-time per (hotel, room).
  v_lock_key := ('x' || substr(md5(p_hotel_id || ':' || p_room_id), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── Idempotent-replay short-circuit (INSIDE the lock — Correction 1) ─
  -- Same blockId under way / already committed → return the SAME success
  -- without a second write. All identity fields must match, or a mismatch
  -- means the id was minted for a different reservation — 409.
  SELECT id, status, hotel_id, room_id, unit_id, date_from, date_to,
         investor_user_id
    INTO v_existing
    FROM public.inventory_blocks
   WHERE id = p_block_id;

  IF FOUND THEN
    IF v_existing.hotel_id           <> p_hotel_id
       OR v_existing.room_id         <> p_room_id
       OR v_existing.unit_id         IS NOT NULL
       OR v_existing.date_from       <> p_date_from
       OR v_existing.date_to         <> p_date_to
       OR v_existing.investor_user_id <> p_investor_user_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'block_id_conflict');
    END IF;
    IF v_existing.status IN ('pending_payment','owned','listed','sold') THEN
      RETURN jsonb_build_object(
        'ok', true, 'code', 'already_reserved',
        'block_id', p_block_id, 'hold_id', v_hold_id
      );
    END IF;
    -- else: status IN ('expired','cancelled','refunded') → fall through and
    -- re-reserve (the prior hold has already been released by the lifecycle
    -- cron's releaseHold path).
  END IF;

  -- ── Diagnostic invhold check (Correction 2) ────────────────────────
  -- If a room_blocks row already exists at this deterministic id, refuse
  -- to succeed unless it matches our reservation EXACTLY. A mismatched
  -- pre-existing row means an unrelated code path created it — never
  -- silently overwrite or merge.
  SELECT id, "hotelId", "roomId", "fromDate", "toDate",
         source, "assignedUnitId", "createdBy"
    INTO v_existing_hold
    FROM public.room_blocks
   WHERE id = v_hold_id;

  IF FOUND THEN
    IF v_existing_hold."hotelId"       <> p_hotel_id
       OR v_existing_hold."roomId"     <> p_room_id
       OR v_existing_hold."fromDate"   <> p_date_from
       OR v_existing_hold."toDate"     <> p_date_to
       OR v_existing_hold.source       <> 'inventory'
       OR v_existing_hold."assignedUnitId" IS NOT NULL
       OR v_existing_hold."createdBy"  <> p_investor_user_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'hold_id_conflict');
    END IF;
    -- Existing hold matches exactly → treat as idempotent no-op below.
  END IF;

  -- ── Capacity signal — rooms.quantity (classic-only). ───────────────
  SELECT COALESCE(quantity, 0) INTO v_capacity
    FROM public.rooms
   WHERE id = p_room_id;
  IF v_capacity IS NULL OR v_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_capacity_signal');
  END IF;

  -- ── Peak occupancy (Correction 3) ──────────────────────────────────
  -- Union of two sources, exactly matching lib/availability.ts::getOccupations:
  --   1. room_blocks: every overlapping row contributes 1 per night (walk_in,
  --      ota_ical, manual, group, inventory — all counted).
  --   2. bids: rows in ACCEPTED/COUNTER/CONFIRMED/CHECKED_IN, joined on
  --      "requestId" → bid_requests.checkIn/checkOut, contribute
  --      max(1, "numRooms") per overlapping night. PENDING is EXCLUDED (v247).
  -- Peak = MAX per-night sum across [from, to).
  WITH nights AS (
    SELECT gs::date AS d
      FROM generate_series(p_date_from, p_date_to - INTERVAL '1 day', '1 day') gs
  ),
  rb_occ AS (
    SELECT n.d, COUNT(*)::int AS c
      FROM nights n
      JOIN public.room_blocks rb
        ON rb."roomId"   = p_room_id
       AND rb."fromDate" <= n.d
       AND rb."toDate"   >  n.d
     GROUP BY n.d
  ),
  bid_occ AS (
    SELECT n.d,
           COALESCE(SUM(GREATEST(1, COALESCE(b."numRooms", 1))), 0)::int AS c
      FROM nights n
      JOIN public.bids b
        ON b."roomId" = p_room_id
       AND b.status IN ('ACCEPTED','COUNTER','CONFIRMED','CHECKED_IN')
      JOIN public.bid_requests r
        ON r.id = b."requestId"
       AND r."checkIn"::date  <= n.d
       AND r."checkOut"::date >  n.d
     GROUP BY n.d
  ),
  per_night AS (
    SELECT n.d,
           COALESCE(rb.c, 0) + COALESCE(bo.c, 0) AS occ
      FROM nights n
      LEFT JOIN rb_occ  rb ON rb.d = n.d
      LEFT JOIN bid_occ bo ON bo.d = n.d
  )
  SELECT COALESCE(MAX(occ), 0) INTO v_peak_occ FROM per_night;

  IF v_capacity - v_peak_occ < 1 THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'category_full',
      'capacity', v_capacity, 'occupied', v_peak_occ
    );
  END IF;

  -- ── Two-in-one write under the held lock ───────────────────────────
  -- If we already found a matching existing block+hold above, the INSERTs
  -- are no-ops (ON CONFLICT DO NOTHING); the return value is the same
  -- shape either way.
  INSERT INTO public.inventory_blocks (
    id, investor_user_id, hotel_id, unit_id, room_id,
    date_from, date_to, nights,
    buy_price_per_night, buy_total,
    status, razorpay_order_id, metadata,
    created_at, updated_at
  ) VALUES (
    p_block_id, p_investor_user_id, p_hotel_id, NULL, p_room_id,
    p_date_from, p_date_to, v_nights,
    p_buy_price_per_night, p_buy_total,
    'pending_payment', p_razorpay_order_id,
    COALESCE(p_metadata, '{}'::jsonb),
    now(), now()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.room_blocks (
    id, "hotelId", "roomId", "fromDate", "toDate",
    source, note, "createdBy", "assignedUnitId"
  ) VALUES (
    v_hold_id, p_hotel_id, p_room_id, p_date_from, p_date_to,
    'inventory', 'StayBid Circle B2B pre-buy hold (classic)',
    p_investor_user_id, NULL
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'reserved',
    'block_id', p_block_id, 'hold_id', v_hold_id,
    'capacity', v_capacity, 'occupied', v_peak_occ + 1
  );
END;
$$;

COMMENT ON FUNCTION public.reserve_classic_block(TEXT, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, NUMERIC, JSONB, TEXT)
IS 'v734 — atomic pre-payment classic reservation. Serialises callers on (hotelId, roomId) with pg_advisory_xact_lock; peak occupancy unions room_blocks + hard-blocking bids exactly like unitsFreeForRange. Returns jsonb {ok, code, ...}. See migration for the full contract.';

-- ──────────────────────────────────────────────────────────────────────
-- assert_classic_hold_still_ours — pure-read helper the classic verify
-- path uses instead of writeHold's upsert. If the hold is gone (expiry
-- cron released it) OR its shape drifted, verify must NOT silently
-- recreate it and reintroduce the post-payment race — it must land in
-- the ops-reconciliation surface (needsOpsReview).
--
-- RETURN
--   jsonb { ok, held, mismatch, reason? }.
--   held=true only when the row exists AND every identity field matches.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_classic_hold_still_ours(
  p_block_id  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_hold_id   TEXT;
  v_block     RECORD;
  v_hold      RECORD;
BEGIN
  IF p_block_id IS NULL OR length(btrim(p_block_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'bad_request');
  END IF;
  v_hold_id := 'invhold_' || p_block_id;

  SELECT id, hotel_id, room_id, unit_id, date_from, date_to, investor_user_id, status
    INTO v_block
    FROM public.inventory_blocks
   WHERE id = p_block_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'block_missing');
  END IF;
  IF v_block.unit_id IS NOT NULL THEN
    -- Unit-inventory block; the caller should have taken the M4 unit branch,
    -- not this classic assert path. Return not_classic so verify falls back.
    RETURN jsonb_build_object('ok', false, 'held', false, 'reason', 'not_classic');
  END IF;

  SELECT id, "hotelId", "roomId", "fromDate", "toDate",
         source, "assignedUnitId", "createdBy"
    INTO v_hold
    FROM public.room_blocks
   WHERE id = v_hold_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'held', false, 'reason', 'hold_missing');
  END IF;

  IF v_hold."hotelId"          <> v_block.hotel_id
     OR v_hold."roomId"        <> v_block.room_id
     OR v_hold."fromDate"      <> v_block.date_from
     OR v_hold."toDate"        <> v_block.date_to
     OR v_hold.source          <> 'inventory'
     OR v_hold."assignedUnitId" IS NOT NULL
     OR v_hold."createdBy"     <> v_block.investor_user_id THEN
    RETURN jsonb_build_object('ok', true, 'held', false, 'mismatch', true, 'reason', 'hold_shape_drift');
  END IF;

  RETURN jsonb_build_object('ok', true, 'held', true, 'hold_id', v_hold_id);
END;
$$;

COMMENT ON FUNCTION public.assert_classic_hold_still_ours(TEXT)
IS 'v734 — pure-read verify helper for the classic branch. Replaces writeHold''s upsert so a released hold is never silently recreated post-payment.';

-- Callable via PostgREST from server routes (SB_H uses the service_role key,
-- which already has EXECUTE on public functions by default). No GRANTs needed.
