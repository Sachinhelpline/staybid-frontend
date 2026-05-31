-- 2026-05-31 — Hotel data revert
-- Incident: on 2026-05-31 07:32:55 UTC a bulk write overwrote the
-- name/city/state/description/images of 31 of 32 hotels to a single hotel's
-- values ("Christ Church View Stay", Shimla). Only STB-2026-01019
-- ("The Grand Resort Dhanaulti") escaped. rooms, lat/lng, hotel_scores and
-- every other table were intact. This is the same recurring failure mode that
-- previously collapsed 17 hotels to "Himalayan Pearl Retreat".
--
-- The original names/descriptions/photo URLs were NOT recoverable (not in the
-- repo, not in any queryable backup). This migration restores a coherent,
-- distinct catalog:
--   * city   — exact, recovered from hotel_scores
--   * state  — derived (Shimla/Manali -> Himachal Pradesh, else Uttarakhand)
--   * name   — reconstructed from each hotel's intact room character + city
--   * images — pulled from each hotel's OWN intact, curl-verified room photos
--              (distinct per hotel)
--   * 202601 — exact original name restored ("Dhanaulti Village Resort By Woodora")
-- lat/lng/starRating/isActive/isVerified are left untouched.
--
-- Applied live via Supabase MCP on 2026-05-31. This file is the audit record.

WITH m(id, name, descr) AS (VALUES
 ('mus01','The Crown Mussoorie','Hilltop luxury retreat near Mall Road with sweeping Doon valley views, plush suites and fine mountain dining.'),
 ('mus02','Heritage Inn Mussoorie','Colonial-era boutique stay blending old-world charm with cosy heritage rooms in the heart of the Queen of Hills.'),
 ('mus03','Pine Valley Family Resort Mussoorie','Spacious family cottages and suites set amid deodar pines, perfect for a relaxed hill-station holiday.'),
 ('mus04','Cloud View Mussoorie','Premium rooms above the clouds with panoramic ridge views, ideal for couples and quiet getaways.'),
 ('mus05','Mountain Stay Mussoorie','Comfortable value mountain rooms a short walk from Camel''s Back Road and Gun Hill.'),
 ('dha01','Pine Lodge Dhanaulti','Tranquil pinewood lodge wrapped in Himalayan forest, offering deluxe rooms and starry-night quiet.'),
 ('dha02','Eco Cabin Retreat Dhanaulti','Sustainable eco cabins and cottages amid the Eco Park deodars, made for nature lovers.'),
 ('dha03','Heritage Cottage Dhanaulti','Charming stone heritage cottages with crackling fireplaces and uninterrupted valley views.'),
 ('dha04','Apple Orchard Resort Dhanaulti','Boutique resort set in a working apple orchard, with garden chalets and farm-fresh meals.'),
 ('dha05','Family Camp Dhanaulti','Adventure family camping suites and tents under the pines with bonfires, treks and mountain air.'),
 ('ris01','Ganga View Rishikesh','Riverside rooms overlooking the holy Ganga, steps from the ghats, yoga and evening aarti.'),
 ('ris02','Wellness Retreat Rishikesh','Serene wellness and yoga retreat with healing suites, meditation decks and Ayurvedic dining.'),
 ('ris03','Boutique Stay Rishikesh','Stylish boutique rooms near Laxman Jhula blending riverside calm with modern comfort.'),
 ('ris04','Spring Pool Resort Rishikesh','Resort with a spring-fed pool, lush gardens and premium rooms by the foothills.'),
 ('ris05','Adventure Camp Rishikesh','Riverside adventure camp with rafting, cliff-jumping and cosy safari tents along the Ganga.'),
 ('deh01','Executive Inn Dehradun','Modern executive suites in the heart of Dehradun, ideal for business and leisure travellers.'),
 ('deh02','Robbers Cave View Dehradun','Comfortable stay near the famous Robbers Cave (Guchhupani), with easy access to Sahastradhara.'),
 ('deh03','Colonial Heritage Dehradun','Gracious colonial-style heritage rooms set in leafy gardens in the Doon valley.'),
 ('deh04','Spa Retreat Dehradun','Relaxing spa retreat with indulgent suites, wellness therapies and valley-view lawns.'),
 ('deh05','Hills Gateway Dehradun','Your gateway to the hills with well-appointed rooms en route to Mussoorie and Rishikesh.'),
 ('shi01','Heritage Ridge Shimla','Heritage rooms on the historic Ridge with colonial architecture and Mall Road at your doorstep.'),
 ('shi02','Mall Road Stay Shimla','Centrally located stay on Mall Road, walking distance to Christ Church, Scandal Point and the Ridge.'),
 ('shi03','Adventure Heights Shimla','Hilltop adventure stay with suites, trails and panoramic Himalayan vistas above Shimla.'),
 ('shi04','Bay Heights Shimla','Premium height-view suites overlooking the Shimla hills, made for memorable mountain escapes.'),
 ('shi05','Hilltop Cottage Shimla','Cosy pinewood hilltop cottages with valley views, fireplaces and old-Shimla charm.'),
 ('man01','Hadimba Cottage Manali','Forest cottages near the Hadimba temple amid towering deodars in Old Manali.'),
 ('man02','Old Manali Stays','Riverside boutique stay in laid-back Old Manali, close to cafes and the Manu temple.'),
 ('man03','Solang Ski Resort Manali','Premium suites near Solang Valley with skiing, paragliding and snow-capped views.'),
 ('man04','Beas View Manali','Comfortable rooms overlooking the Beas river, a short hop from Mall Road Manali.'),
 ('man05','Rohtang Gateway Resort Manali','Premium mountain resort on the road to Rohtang Pass, with grand Himalayan panoramas.'),
 ('202601','Dhanaulti Village Resort By Woodora','Rustic-luxe village resort in Dhanaulti by Woodora, with pahadi cottages, orchard views and home-style mountain cuisine.')
)
UPDATE hotels h
SET name = m.name,
    description = m.descr,
    city = hs.city,
    state = CASE WHEN hs.city IN ('Shimla','Manali') THEN 'Himachal Pradesh' ELSE 'Uttarakhand' END,
    images = COALESCE(
      (SELECT (array_agg(DISTINCT img))[1:6]
         FROM rooms r CROSS JOIN unnest(r.images) img
        WHERE r."hotelId" = h.id),
      h.images)
FROM m
JOIN hotel_scores hs ON hs.hotel_id = m.id
WHERE h.id = m.id AND h.name = 'Christ Church View Stay';
