-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-07-26 · v511 · Hotel gallery photo CATEGORIES (Phase B)
--
-- Airbnb-style "browse photos by space" — Bedroom / Bathroom / Views / Exterior…
-- We store a per-photo category as a JSONB MAP keyed by the exact image URL that
-- already lives in `hotels.images` (text[]):
--
--     image_categories = { "<image-url>": "<category-slug>", … }
--
-- WHY a URL-keyed map (not the `hotel_images` table / not a new table):
--   • the guest gallery renders from `hotels.images` (text[]) — this maps 1:1 to
--     exactly those URLs, so a tag can never point at a photo the guest can't see;
--   • additive + forward-only, NO FK (house rule), touches nothing existing;
--   • `GET /api/hotels/[id]` + `GET /api/partner/hotel` both `select=*`, so the
--     column round-trips to guest + partner with ZERO route change.
--
-- Untagged photos (every existing hotel today) simply have no key → the guest
-- gallery shows only "All"/"Rooms" exactly as before. Fully backward-compatible.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE hotels ADD COLUMN IF NOT EXISTS image_categories jsonb;

COMMENT ON COLUMN hotels.image_categories IS
  'Phase B (v511): map of gallery image URL -> category slug (bedroom/bathroom/living/dining/exterior/views/amenities). Keys are URLs from hotels.images. Untagged photos are simply absent.';
