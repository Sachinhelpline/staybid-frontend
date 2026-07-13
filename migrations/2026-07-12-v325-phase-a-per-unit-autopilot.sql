-- StayBid Circle multi-investor blueprint — Phase A: per-unit autopilot mode.
-- APPLIED LIVE via Supabase MCP (migration `v325_phase_a_per_unit_autopilot`).
--
-- Today hotels.autopilot_mode is per-HOTEL (v130). On a multi-investor operated
-- hotel that means one investor changing the mode would change auto-accept for
-- EVERY owner's rooms. This adds a per-PHYSICAL-UNIT override so each investor
-- controls only their own rooms.
--
--   autopilot_mode = NULL  -> inherit the hotel-level hotels.autopilot_mode
--                             (every existing unit today; ZERO regression).
--                = 'auto' | 'hybrid' | 'manual' -> this owner's per-room choice.
--
-- Bids carry assignedUnitId (already stored by /api/bids/place when a customer
-- books a SPECIFIC owned room). The accept logic (place + schedule-accept)
-- resolves the effective mode via lib/autopilot-server.loadEffectiveAutopilotMode:
-- unit override if set, else hotel-level, else 'auto' (fail-safe). Additive +
-- idempotent.

ALTER TABLE public.hotel_room_units
  ADD COLUMN IF NOT EXISTS autopilot_mode TEXT DEFAULT NULL;

ALTER TABLE public.hotel_room_units
  ADD COLUMN IF NOT EXISTS autopilot_updated_at TIMESTAMPTZ DEFAULT NULL;

-- Bulletproof the value set (NULL = inherit; otherwise one of the 3 known modes).
ALTER TABLE public.hotel_room_units
  DROP CONSTRAINT IF EXISTS hru_autopilot_mode_chk;
ALTER TABLE public.hotel_room_units
  ADD CONSTRAINT hru_autopilot_mode_chk
  CHECK (autopilot_mode IS NULL OR autopilot_mode IN ('auto','hybrid','manual'));

-- Fast lookup of units that have an explicit override (admin/reporting; small).
CREATE INDEX IF NOT EXISTS idx_hru_autopilot_override
  ON public.hotel_room_units (autopilot_mode)
  WHERE autopilot_mode IS NOT NULL;
