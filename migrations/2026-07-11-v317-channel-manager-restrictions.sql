-- v317 — Unified Channel Manager, Phase 3 (room mapping + rates + restrictions).
--
-- Phase 3 consumes the channel_room_mappings table locked in the v315
-- migration (room ↔ OTA ref + markup) and adds a per-room-date restrictions
-- data model: stop-sell, min-stay, max-stay. These ride on the existing
-- room_date_overrides table (camelCase quoted columns, like the v132.3 file)
-- so the partner's per-date editor + the future ARI push (Phase 6 certified
-- API adapters) share one source of truth.
--
-- Additive + idempotent. Applied live via Supabase MCP at v317 ship time.

ALTER TABLE public.room_date_overrides ADD COLUMN IF NOT EXISTS "stopSell" BOOLEAN;   -- true = do not sell this room on this date on ANY channel
ALTER TABLE public.room_date_overrides ADD COLUMN IF NOT EXISTS "minStay"  INTEGER;   -- minimum nights (NULL = no restriction)
ALTER TABLE public.room_date_overrides ADD COLUMN IF NOT EXISTS "maxStay"  INTEGER;   -- maximum nights (NULL = no restriction)
