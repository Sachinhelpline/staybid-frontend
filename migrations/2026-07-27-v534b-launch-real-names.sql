-- ─────────────────────────────────────────────────────────────────────────────
-- v534b — Launch curation Phase 2: real property names ("no fake dump").
--
-- The 17 curated launch hotels named "StayBid Circle · <city>" read as a brand
-- placeholder, not a real property. Give them real resort names (drop the
-- "StayBid Circle · " prefix; name the 7 bare ones). Display-only content change
-- (name); no logic keys on hotel name (attribution/scope key on id + owner_type
-- + owner_user_id), so this is safe + reversible. Guarded per id.
--
-- Dehradun (deh03 "Colonial Heritage Dehradun") and Dhanaulti (202601
-- "Dhanaulti Village Resort By Woodora") are already real — untouched.
--
-- ROLLBACK (old names) if ever needed:
--   hco-seed-mus='StayBid Circle · Mussoorie Ridge Retreat', hco-seed-ris='StayBid Circle · Rishikesh Ganga View',
--   hco-seed-shi='StayBid Circle · Shimla Colonial Suites', hco-seed-man='StayBid Circle · Manali Riverside Lodge',
--   hco-seed-kanatal='StayBid Circle · Kanatal', hco-seed-kasol='StayBid Circle · Kasol',
--   hco-seed-jaipur='StayBid Circle · Jaipur', hco-seed-pushkar='StayBid Circle · Pushkar',
--   hco-seed-jai='StayBid Circle · Jaisalmer Desert Haveli', hco-seed-uda='StayBid Circle · Udaipur Lake Palace Stay',
--   hco-seed-nainital='StayBid Circle · Nainital', hco-seed-corbett='StayBid Circle · Corbett',
--   hco-seed-lansdowne='StayBid Circle · Lansdowne', hco-seed-goa='StayBid Circle · Goa Beachside Resort',
--   hco-seed-crg='StayBid Circle · Coorg Coffee Estate', hco-seed-ker='StayBid Circle · Munnar Hills Retreat',
--   hco-seed-leh='StayBid Circle · Leh Himalayan Lodge'
-- ─────────────────────────────────────────────────────────────────────────────

update hotels set name = 'Mussoorie Ridge Retreat'      where id = 'hco-seed-mus';
update hotels set name = 'Rishikesh Ganga View'         where id = 'hco-seed-ris';
update hotels set name = 'Shimla Colonial Suites'       where id = 'hco-seed-shi';
update hotels set name = 'Manali Riverside Lodge'       where id = 'hco-seed-man';
update hotels set name = 'Kanatal Pinewood Retreat'     where id = 'hco-seed-kanatal';
update hotels set name = 'Parvati Riverside Kasol'      where id = 'hco-seed-kasol';
update hotels set name = 'Amber Haveli Jaipur'          where id = 'hco-seed-jaipur';
update hotels set name = 'Pushkar Desert Rose'          where id = 'hco-seed-pushkar';
update hotels set name = 'Jaisalmer Desert Haveli'      where id = 'hco-seed-jai';
update hotels set name = 'Udaipur Lake Palace Stay'     where id = 'hco-seed-uda';
update hotels set name = 'Naini Lakeview Resort'        where id = 'hco-seed-nainital';
update hotels set name = 'Corbett Jungle Retreat'       where id = 'hco-seed-corbett';
update hotels set name = 'Lansdowne Pine Manor'         where id = 'hco-seed-lansdowne';
update hotels set name = 'Goa Beachside Resort'         where id = 'hco-seed-goa';
update hotels set name = 'Coorg Coffee Estate'          where id = 'hco-seed-crg';
update hotels set name = 'Munnar Hills Retreat'         where id = 'hco-seed-ker';
update hotels set name = 'Leh Himalayan Lodge'          where id = 'hco-seed-leh';

-- verify:
-- select id, name, city from hotels
-- where id in ('hco-seed-mus','hco-seed-ris','hco-seed-shi','hco-seed-man','hco-seed-kanatal',
--   'hco-seed-kasol','hco-seed-jaipur','hco-seed-pushkar','hco-seed-jai','hco-seed-uda','hco-seed-nainital',
--   'hco-seed-corbett','hco-seed-lansdowne','hco-seed-goa','hco-seed-crg','hco-seed-ker','hco-seed-leh')
-- order by city;
