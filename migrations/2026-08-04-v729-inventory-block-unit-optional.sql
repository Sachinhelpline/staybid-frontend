-- v729 — Cross-channel oversell CORE FIX (Phase 2): classic (unit-less) B2B buyability.
--
-- Additive, forward-only. RECORDS the DDL applied live to Supabase project
-- uxxhbdqedazpmvbvaosh (2026-08-04). Re-running is a no-op (idempotent —
-- DROP NOT NULL on an already-nullable column is a no-op).
--
-- WHY: CLASSIC hotels store capacity as rooms.quantity with NO hotel_room_units
-- rows, so a Circle Model-2 (B2B) buyer of a `hotel_owner` listing on a classic
-- property cannot be assigned a physical unit (assignFreeUnit → null). Before
-- v729 that checkout DEAD-ENDED (409, listing creatable but UNBUYABLE). v729
-- completes the buy on a CATEGORY-level hold instead: the buyer's
-- inventory_blocks row is minted with unit_id NULL and verify writes a
-- room_blocks category hold (NO assignedUnitId) that the availability engine
-- (unitsFreeForRange) already subtracts from rooms.quantity — NO engine change.
--
-- This requires inventory_blocks.unit_id to be NULLABLE (a classic block holds
-- the room CATEGORY, not a specific unit). It mirrors EXACTLY the v343/M4
-- precedent that made b2b_listings.unit_id + b2b_trades.unit_id nullable for
-- hotel_owner listings. It purely RELAXES a constraint: every existing row
-- already has a unit_id, and every non-classic code path still sets one — so
-- nothing changes for hotels WITH units (byte-identical). No CHECK / unique / FK
-- depends on unit_id (verified live: the only unit_id index is the plain btree
-- idx_inv_blocks_unit_range (unit_id, date_from, date_to), where NULLs are
-- permitted and distinct).

ALTER TABLE public.inventory_blocks ALTER COLUMN unit_id DROP NOT NULL;

COMMENT ON COLUMN public.inventory_blocks.unit_id IS
  'Physical hotel_room_units id for a unit-assigned block. NULL for a v729 CLASSIC (unit-less) category block — inventory is held at the room-category level via a room_blocks hold counted against rooms.quantity.';
