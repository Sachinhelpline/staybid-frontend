-- 2026-05-31 — Future-proof guard against the recurring hotel-data corruption.
--
-- Twice now a buggy bulk write has collapsed many hotels to ONE identical name:
--   * 2026-05-31 — 31 hotels -> "Christ Church View Stay"
--   * earlier    — 17 hotels -> "Himalayan Pearl Retreat"
-- Both wiped the distinct catalog and were hard to recover.
--
-- This installs statement-level triggers on public.hotels that ABORT any
-- INSERT or UPDATE touching more than 5 rows that collapses them to a single
-- identical name. Legitimate operations are unaffected:
--   * single-hotel onboarding / partner edit  -> 1 row, passes
--   * distinct multi-hotel seed                -> many DISTINCT names, passes
--   * bulk toggle of some other column         -> names stay distinct, passes
-- Only the exact corruption signature (many rows, one name) is blocked.
--
-- Applied live via Supabase MCP on 2026-05-31. This file is the audit record.
-- To run an intentional mass rename, disable the two triggers first.

CREATE OR REPLACE FUNCTION guard_mass_hotel_rename() RETURNS trigger AS $$
DECLARE
  affected int;
  distinct_names int;
  the_name text;
BEGIN
  SELECT count(*), count(DISTINCT name) INTO affected, distinct_names FROM newtab;
  IF affected > 5 AND distinct_names = 1 THEN
    SELECT name INTO the_name FROM newtab LIMIT 1;
    RAISE EXCEPTION 'StayBid guard: blocked mass hotel write — % rows collapsed to one identical name "%". This matches the recurring hotel-data corruption pattern; aborting to protect the catalog. If intentional, disable triggers trg_guard_mass_hotel_rename_ins / _upd first.', affected, the_name;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_mass_hotel_rename_upd ON public.hotels;
CREATE TRIGGER trg_guard_mass_hotel_rename_upd
AFTER UPDATE ON public.hotels
REFERENCING NEW TABLE AS newtab
FOR EACH STATEMENT EXECUTE FUNCTION guard_mass_hotel_rename();

DROP TRIGGER IF EXISTS trg_guard_mass_hotel_rename_ins ON public.hotels;
CREATE TRIGGER trg_guard_mass_hotel_rename_ins
AFTER INSERT ON public.hotels
REFERENCING NEW TABLE AS newtab
FOR EACH STATEMENT EXECUTE FUNCTION guard_mass_hotel_rename();
