-- ─────────────────────────────────────────────────────────────────────────────
-- v536b — Launch curation Phase 3: real, guest-authentic property descriptions.
--
-- The 17 curated host_circle launch hotels carried SEED descriptions with two
-- "fake dump" tells that a real guest would reject:
--   1. Internal jargon leaking into guest copy — every one opened
--      "A StayBid-operated … available for Circle pre-buy."
--   2. Wrong geography — "Kasol (near Leh)", "Jaipur (near Udaipur)",
--      "Pushkar (near Udaipur)", "Nainital (near Dhanaulti)",
--      "Corbett (near Rishikesh)" — factually incorrect, reads as a template.
--
-- This replaces them with real, city-authentic descriptions: accurate geography,
-- genuine seasonal peaks kept, no operational/internal language. Display-only
-- (hotels.description); no logic keys on description, so safe + reversible.
-- Guarded per id. Dehradun (deh03) + Dhanaulti (202601) already had real
-- descriptions — untouched.
--
-- ROLLBACK (old seed descriptions) if ever needed — see git history of the seed
-- migrations; each was "A StayBid-operated … " as read live on 2026-07-27.
-- ─────────────────────────────────────────────────────────────────────────────

update hotels set description = 'A hillside retreat perched above the Mussoorie ridge, with cedar-scented air and sweeping Doon-valley views. Cosy fireplaces, terraced gardens and an easy stroll to the Mall Road.' where id = 'hco-seed-mus';

update hotels set description = 'A calm Ganga-view stay in Rishikesh, moments from the riverside ghats and Lakshman Jhula. Yoga at dawn, river breeze by evening, the Himalayan foothills all around.' where id = 'hco-seed-ris';

update hotels set description = 'Colonial-era suites in the heart of Shimla, with wood-panelled interiors and pine-clad views, a short walk from the Ridge and Mall Road.' where id = 'hco-seed-shi';

update hotels set description = 'A riverside lodge on the banks of the Beas, framed by apple orchards and deodar forest — the sound of the river and a short drive from Old Manali.' where id = 'hco-seed-man';

update hotels set description = 'A quiet pinewood retreat in Kanatal, tucked among deodar forest on the Chamba–Dhanaulti ridge. Star-lit nights, crisp mountain mornings, far from the crowds.' where id = 'hco-seed-kanatal';

update hotels set description = 'A riverside stay in Kasol along the Parvati river, ringed by pine slopes and Himalayan peaks — the gateway to the Malana and Kheerganga trails.' where id = 'hco-seed-kasol';

update hotels set description = 'A heritage-style haveli stay in Jaipur, the Pink City, with jharokha windows and courtyard charm, close to Amber Fort, the City Palace and the old bazaars.' where id = 'hco-seed-jaipur';

update hotels set description = 'A tranquil desert stay in Pushkar, beside the sacred lake and ghats with the Aravalli hills on the horizon — home to the famous camel fair each autumn.' where id = 'hco-seed-pushkar';

update hotels set description = 'A sandstone desert haveli in the Golden City of Jaisalmer, with carved balconies and fort views. Peak Nov–Feb desert season, open year-round.' where id = 'hco-seed-jai';

update hotels set description = 'A lake-view heritage stay in Udaipur, the City of Lakes, overlooking Pichola''s palaces and ghats. Peak Oct–Mar and wedding season, open year-round.' where id = 'hco-seed-uda';

update hotels set description = 'A lakeview resort in Nainital, overlooking the emerald Naini lake and the surrounding hills, a short walk from the Mall and the boat jetty.' where id = 'hco-seed-nainital';

update hotels set description = 'A jungle retreat on the edge of Jim Corbett, amid sal forest and the Kosi river — made for safari mornings and birdsong evenings.' where id = 'hco-seed-corbett';

update hotels set description = 'A pine-clad manor in the colonial hill town of Lansdowne, wrapped in oak and deodar forest — quiet, cantonment-calm and refreshingly uncrowded.' where id = 'hco-seed-lansdowne';

update hotels set description = 'A beachside resort in Goa, steps from the sand and the surf, with palm-shaded decks and sunset views. Peak Nov–Feb, open year-round.' where id = 'hco-seed-goa';

update hotels set description = 'A coffee-estate resort in the misty hills of Coorg, Karnataka, surrounded by plantations and birdsong. Peak Oct–Dec and spring, open year-round.' where id = 'hco-seed-crg';

update hotels set description = 'A tea-country retreat in the rolling hills of Munnar, Kerala, amid emerald plantations and cool highland air. Peak Oct–Feb, open year-round.' where id = 'hco-seed-ker';

update hotels set description = 'A Himalayan lodge in Leh, framed by the stark beauty of Ladakh''s peaks and monasteries. Peak Jun–Sep season, open year-round.' where id = 'hco-seed-leh';

-- verify:
-- select id, name, city, left(description, 60) as desc_preview from hotels
-- where id like 'hco-seed-%' order by city;
