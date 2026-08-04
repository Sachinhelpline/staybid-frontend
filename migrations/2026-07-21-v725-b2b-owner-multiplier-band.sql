-- v725 — B2B (Model-2) owner price control: a bounded resale-multiplier band.
--
-- Until now a classic owner had ZERO control over their B2B ask (fixed at the
-- admin global 2×). This adds an admin-set BAND [min,max] within which the OWNER
-- may pick their own resale multiplier on their listing — keeping Model-2
-- "regulated" (bounded, not free pricing) while giving the owner real agency.
-- Default band 1.5×–3.0× (contains the existing 2× global, so an untouched
-- listing prices identically). Additive.

ALTER TABLE b2b_fee_config
  ADD COLUMN IF NOT EXISTS resale_multiplier_min numeric DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS resale_multiplier_max numeric DEFAULT 3.0;

UPDATE b2b_fee_config
  SET resale_multiplier_min = COALESCE(resale_multiplier_min, 1.5),
      resale_multiplier_max = COALESCE(resale_multiplier_max, 3.0)
  WHERE id = 'default';
