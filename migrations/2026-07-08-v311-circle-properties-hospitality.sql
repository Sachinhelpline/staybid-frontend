-- v311 — StayCircle admin Add-property god-level upgrade.
--
-- Additive hospitality columns so the admin StayCircle "Add property" form
-- matches the host onboarding richness (property type + star rating +
-- amenities). `description` already exists on circle_properties and is reused
-- for the short description. All nullable; existing rows unaffected.
--
-- Applied live via Supabase MCP (apply_migration v311_circle_properties_hospitality).

ALTER TABLE public.circle_properties
  ADD COLUMN IF NOT EXISTS property_type text,
  ADD COLUMN IF NOT EXISTS star_rating integer,
  ADD COLUMN IF NOT EXISTS amenities text[];
