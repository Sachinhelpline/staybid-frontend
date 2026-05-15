-- ─────────────────────────────────────────────────────────────────────────
-- StayPoints redemption system (v124, May 2026-05-15)
--
-- Replaces the v82-era "mark amenity done" pattern with a full lifecycle:
--   1. Admin curates a catalog of redemption rules (points → benefit).
--   2. Customer spends points → system generates a unique alphanumeric
--      code + a barcode-ready 12-digit numeric + (for cash-back kinds)
--      credits wallet_credits.
--   3. At checkout (coupons / wallet credits) OR at hotel desk (amenities),
--      the code is validated + marked used. Wallet credits debit on bid commit.
--   4. Admin sees the full audit trail in /admin/redemption-codes; partner
--      panel can scan/enter a code to mark amenity fulfilled.
--
-- Additive only — no existing tables touched. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────── 1. Catalog of redemption rules (admin-editable) ──────────────────
CREATE TABLE IF NOT EXISTS public.redemption_rules (
  id                            TEXT PRIMARY KEY DEFAULT ('rr_' || gen_random_uuid()::text),
  slug                          TEXT NOT NULL UNIQUE,          -- 'free_breakfast', 'wallet_500'
  title                         TEXT NOT NULL,
  description                   TEXT,
  kind                          TEXT NOT NULL,                  -- 'coupon' | 'wallet_credit' | 'amenity' | 'voucher'
  points_cost                   INT NOT NULL,                   -- StayPoints required
  value_inr                     NUMERIC(10,2) NOT NULL DEFAULT 0,  -- ₹ value (for coupons / wallet credits)
  min_tier                      TEXT NOT NULL DEFAULT 'silver', -- silver | gold | platinum
  max_per_user_per_month        INT NOT NULL DEFAULT 5,         -- spam guard
  validity_days                 INT NOT NULL DEFAULT 90,        -- code TTL after issue
  icon                          TEXT,                           -- emoji or icon name
  terms                         TEXT,                           -- short T&Cs displayed at redemption
  display_order                 INT NOT NULL DEFAULT 100,
  active                        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemption_rules_active ON public.redemption_rules(active);
CREATE INDEX IF NOT EXISTS idx_redemption_rules_kind   ON public.redemption_rules(kind);
CREATE INDEX IF NOT EXISTS idx_redemption_rules_tier   ON public.redemption_rules(min_tier);

GRANT ALL ON public.redemption_rules TO anon, authenticated, service_role;
ALTER TABLE public.redemption_rules ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='redemption_rules' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.redemption_rules FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─────── 2. Issued codes (one row per redemption) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.redemption_codes (
  id                  TEXT PRIMARY KEY DEFAULT ('rdm_' || gen_random_uuid()::text),
  code                TEXT NOT NULL UNIQUE,                    -- 'STAY-X9P2-A7B3' (human-typeable)
  barcode_value       TEXT NOT NULL,                           -- 12-digit numeric for Code128/EAN
  user_id             TEXT NOT NULL,
  rule_id             TEXT NOT NULL,
  rule_slug           TEXT,                                    -- denormalised for fast filtering
  kind                TEXT NOT NULL,                           -- mirror of rule.kind at issue-time
  title               TEXT,                                    -- mirror of rule.title at issue-time
  value_inr           NUMERIC(10,2) NOT NULL DEFAULT 0,
  points_spent        INT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',          -- active | used | expired | revoked
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  used_on_bid_id      TEXT,                                    -- coupon / wallet_credit kinds
  used_by_hotel_id    TEXT,                                    -- amenity kind — partner who fulfilled
  used_by_partner_id  TEXT,                                    -- which partner user marked fulfilled
  revoked_at          TIMESTAMPTZ,
  revoked_by          TEXT,                                    -- admin id if revoked
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_redemption_codes_user        ON public.redemption_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_status      ON public.redemption_codes(status);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_expires     ON public.redemption_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_rule        ON public.redemption_codes(rule_id);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_issued      ON public.redemption_codes(issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemption_codes_used_bid    ON public.redemption_codes(used_on_bid_id) WHERE used_on_bid_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_redemption_codes_used_hotel  ON public.redemption_codes(used_by_hotel_id) WHERE used_by_hotel_id IS NOT NULL;

GRANT ALL ON public.redemption_codes TO anon, authenticated, service_role;
ALTER TABLE public.redemption_codes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='redemption_codes' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.redemption_codes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─────── 3. Wallet credits (real ₹ balance, distinct from spend-tracker) ──
CREATE TABLE IF NOT EXISTS public.wallet_credits (
  user_id             TEXT PRIMARY KEY,
  balance_inr         NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_credited   NUMERIC(12,2) NOT NULL DEFAULT 0,
  lifetime_debited    NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT ALL ON public.wallet_credits TO anon, authenticated, service_role;
ALTER TABLE public.wallet_credits ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wallet_credits' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.wallet_credits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.wallet_credit_history (
  id              TEXT PRIMARY KEY DEFAULT ('wch_' || gen_random_uuid()::text),
  user_id         TEXT NOT NULL,
  delta_inr       NUMERIC(12,2) NOT NULL,                     -- positive for credit, negative for debit
  type            TEXT NOT NULL,                              -- 'credit_from_points' | 'debit_on_booking' | 'refund' | 'admin_adjust'
  reason          TEXT,
  source_type     TEXT,                                       -- 'redemption_code' | 'bid' | 'admin'
  source_id       TEXT,
  balance_after   NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wch_user ON public.wallet_credit_history(user_id);
CREATE INDEX IF NOT EXISTS idx_wch_type ON public.wallet_credit_history(type);
CREATE INDEX IF NOT EXISTS idx_wch_created ON public.wallet_credit_history(created_at DESC);

GRANT ALL ON public.wallet_credit_history TO anon, authenticated, service_role;
ALTER TABLE public.wallet_credit_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wallet_credit_history' AND policyname='all_anon_all') THEN
    EXECUTE 'CREATE POLICY all_anon_all ON public.wallet_credit_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─────── 4. Seed the platform-default catalog ──────────────────────────────
-- These are the rules every customer sees on /points/redeem out of the box.
-- Admin can edit / disable / add via /admin/redemption-rules.
INSERT INTO public.redemption_rules (slug, title, description, kind, points_cost, value_inr, min_tier, max_per_user_per_month, validity_days, icon, terms, display_order)
SELECT * FROM (VALUES
  ('wallet_100',        '₹100 Wallet Credit',     'Add ₹100 to your StayBid wallet. Use at any booking, anytime.',          'wallet_credit', 1000,  100, 'silver',   3, 365, '💰', 'Credits to your wallet. Use across multiple bookings.',                            10),
  ('wallet_500',        '₹500 Wallet Credit',     'Add ₹500 to your StayBid wallet. Best value for frequent travellers.',   'wallet_credit', 4500,  500, 'silver',   2, 365, '💰', 'Credits to your wallet. Use across multiple bookings.',                            11),
  ('wallet_1000',       '₹1000 Wallet Credit',    'Add ₹1000 to your wallet. Stack with any booking.',                       'wallet_credit', 8500, 1000, 'gold',     2, 365, '💎', 'Gold tier and above. Credits to wallet.',                                          12),

  ('coupon_100',        '₹100 OFF Coupon',        'Single-use ₹100 discount on your next booking.',                          'coupon',         900,  100, 'silver',   5,  90, '🎟️', 'One-time use. Applies on booking total. Min booking ₹500.',                       20),
  ('coupon_500',        '₹500 OFF Coupon',        'Single-use ₹500 discount on your next booking.',                          'coupon',        4200,  500, 'silver',   3,  90, '🎟️', 'One-time use. Applies on booking total. Min booking ₹2000.',                      21),
  ('coupon_1000',       '₹1000 OFF Coupon',       'Single-use ₹1000 discount. Big-ticket savings.',                          'coupon',        8000, 1000, 'gold',     2,  90, '🎁', 'Gold tier and above. Min booking ₹4000.',                                          22),

  ('breakfast_free',    'Free Breakfast',         'Complimentary breakfast for two on your next stay.',                      'amenity',        500,    0, 'silver',   3,  60, '🥐', 'Show this code at the hotel desk on check-in. Valid for 2 guests, 1 meal.',       30),
  ('drink_welcome',     'Welcome Drink',          'Complimentary welcome drink at your next stay.',                          'amenity',        300,    0, 'silver',   3,  60, '🥂', 'Show this code at the hotel desk on check-in. Valid for 1 drink per guest.',      31),
  ('late_checkout',     'Late Check-out (2 PM)',  'Check out at 2 PM instead of 11 AM. No rush.',                            'amenity',        800,    0, 'silver',   2,  60, '🌅', 'Show this code at the hotel desk on check-in. Subject to availability.',          32),
  ('room_upgrade',      'Room Upgrade',           'Upgrade to the next room category at no extra cost.',                     'amenity',       3000,    0, 'gold',     1,  60, '🏨', 'Gold tier and above. Subject to availability at check-in.',                       33),
  ('airport_pickup',    'Airport Pickup',         'Free airport pickup to the hotel.',                                       'amenity',       2500,    0, 'gold',     1,  60, '🚗', 'Gold tier and above. Notify hotel 24h in advance with flight details.',           34),
  ('spa_voucher',       'Spa Voucher (60 min)',   'Complimentary 60-minute spa session.',                                    'amenity',       5000,    0, 'platinum', 1,  60, '🧖', 'Platinum tier exclusive. Subject to spa availability.',                            35)
) AS s(slug, title, description, kind, points_cost, value_inr, min_tier, max_per_user_per_month, validity_days, icon, terms, display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.redemption_rules r WHERE r.slug = s.slug);

NOTIFY pgrst, 'reload schema';
