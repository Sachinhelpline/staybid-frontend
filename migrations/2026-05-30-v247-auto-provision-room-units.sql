-- ─────────────────────────────────────────────────────────────────────────
-- Auto-provision hotel_room_units from rooms.quantity (v247, 2026-05-30)
--
-- WHY: v247 added real per-unit inventory blocking. The availability layer
-- (app/api/availability/units + lib/availability.unitsFreeForRange) prefers
-- the per-unit grid in `hotel_room_units`, falling back to `rooms.quantity`
-- as virtual units. As of this migration the grid was populated for only
-- 1 of 32 hotels (4 units), so 31 hotels relied on the fallback. This
-- migration makes the grid REAL and FUTURE-PROOF:
--
--   1. Backfills units for every existing room category (one active unit per
--      rooms.quantity).
--   2. Installs a trigger on `rooms` so a NEW room (new-hotel onboarding) or a
--      quantity increase auto-provisions the matching units — no manual setup.
--
-- DESIGN — additive only, idempotent, safe to re-run:
--   • Never deletes or deactivates a unit. A quantity DECREASE is a no-op
--     (we only ever top up to `quantity` active units); a partner can
--     deactivate surplus units by hand. This protects units that already
--     carry bid_unit_assignments / room_blocks.
--   • New unit numbers continue from the highest existing numeric roomNumber
--     (base 100 if none), so auto units coexist with partner-set "101..104"
--     style numbers without collision. Tagged note='auto-provisioned (v247)'
--     so partners can spot + rename them.
--   • A unique index on ("roomId","roomNumber") guarantees idempotency.
--   • Capacity is UNCHANGED vs the pre-migration quantity-fallback
--     (unitsTotal == quantity either way), so availability math does not
--     shift — this only swaps virtual units for real, renameable rows.
--
-- SECURITY DEFINER: hotel_room_units has RLS (permissive all_anon_all policy
-- from 2026-05-13-rls-everywhere). The function runs as owner so the trigger
-- can insert regardless of which role inserts the room.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Idempotency / integrity: one unit number per category.
CREATE UNIQUE INDEX IF NOT EXISTS hotel_room_units_room_number_uniq
  ON public.hotel_room_units ("roomId", "roomNumber");

-- 2) Top up a single room to `quantity` active units. Additive only.
CREATE OR REPLACE FUNCTION public.provision_room_units(p_room_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hotel  text;
  v_qty    int;
  v_active int;
  v_base   int;
  i        int := 0;
BEGIN
  SELECT "hotelId", COALESCE(quantity, 0)
    INTO v_hotel, v_qty
    FROM public.rooms
   WHERE id = p_room_id;

  -- No room, no hotel, or non-positive quantity → nothing to do.
  IF v_hotel IS NULL OR COALESCE(v_qty, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_active
    FROM public.hotel_room_units
   WHERE "roomId" = p_room_id AND status = 'active';

  -- Already enough active units (covers re-runs + quantity decreases).
  IF v_active >= v_qty THEN
    RETURN;
  END IF;

  -- Continue numbering after the highest existing numeric unit number for
  -- this category; base 100 when the category has no numeric units yet.
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace("roomNumber", '\D', '', 'g'), '')::int),
           100
         )
    INTO v_base
    FROM public.hotel_room_units
   WHERE "roomId" = p_room_id;

  WHILE v_active + i < v_qty LOOP
    i := i + 1;
    INSERT INTO public.hotel_room_units ("hotelId", "roomId", "roomNumber", status, note)
    VALUES (v_hotel, p_room_id, (v_base + i)::text, 'active', 'auto-provisioned (v247)')
    ON CONFLICT ("roomId", "roomNumber") DO NOTHING;
  END LOOP;
END $$;

-- 3) Trigger: new room (onboarding) OR quantity bump → provision units.
--    AFTER UPDATE OF quantity also fires on a decrease, where provision is a
--    no-op (early return above), so it never removes units.
CREATE OR REPLACE FUNCTION public.trg_provision_room_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.provision_room_units(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rooms_provision_units ON public.rooms;
CREATE TRIGGER trg_rooms_provision_units
  AFTER INSERT OR UPDATE OF quantity ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_provision_room_units();

-- 4) Backfill every existing room category.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.rooms WHERE COALESCE(quantity, 0) > 0 LOOP
    PERFORM public.provision_room_units(r.id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
