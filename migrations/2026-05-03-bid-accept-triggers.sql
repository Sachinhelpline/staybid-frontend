-- Replaces the "backend follow-up" code that was meant for staybid-Live's
-- bid-accept handler. Runs entirely inside Postgres so the frontend ships
-- without any Railway/Express change.
--
-- When a bid transitions to ACCEPTED, automatically:
--   1. Write influencer_commissions row (if bid_request was attributed)
--   2. Credit loyalty points (5 pts per ₹100 spent) + history row
--   3. Enqueue a booking_confirmed notification (drained by external cron)
--
-- Idempotent: only fires on transitions FROM something-else TO ACCEPTED, and
-- every INSERT is guarded by NOT EXISTS so re-running is safe.

CREATE OR REPLACE FUNCTION public.fn_on_bid_accepted()
RETURNS TRIGGER AS $$
DECLARE
  v_influencer_id   TEXT;
  v_pct             NUMERIC := 0.12;
  v_amount          NUMERIC;
  v_points          INT;
  v_cur_balance     INT;
  v_cur_lifetime    INT;
  v_new_balance     INT;
BEGIN
  IF UPPER(COALESCE(NEW.status, '')) <> 'ACCEPTED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND UPPER(COALESCE(OLD.status, '')) = 'ACCEPTED' THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.amount, 0)::numeric;

  -- Influencer commission (Session 1 + 3)
  IF NEW."requestId" IS NOT NULL THEN
    SELECT influencer_id INTO v_influencer_id
      FROM public.bid_requests WHERE id = NEW."requestId";
    IF v_influencer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.influencer_commissions WHERE bid_id = NEW.id
    ) THEN
      INSERT INTO public.influencer_commissions
        (influencer_id, bid_id, hotel_id, booking_amount, commission_percentage, commission_amount, status)
      VALUES
        (v_influencer_id, NEW.id, NEW."hotelId", v_amount, v_pct, v_amount * v_pct, 'pending');
      UPDATE public.influencers
        SET total_earnings = COALESCE(total_earnings, 0) + (v_amount * v_pct), updated_at = NOW()
        WHERE id = v_influencer_id;
      UPDATE public.influencer_referral_codes
        SET conversions_count = COALESCE(conversions_count, 0) + 1
        WHERE influencer_id = v_influencer_id
          AND (hotel_id IS NULL OR hotel_id = NEW."hotelId");
    END IF;
  END IF;

  -- Loyalty points (Session 4)
  IF NEW."customerId" IS NOT NULL AND v_amount > 0 THEN
    v_points := FLOOR(v_amount / 100)::INT * 5;
    IF v_points > 0 AND NOT EXISTS (
      SELECT 1 FROM public.points_history
       WHERE user_id = NEW."customerId" AND source_type='booking' AND source_id = NEW.id
    ) THEN
      SELECT balance, lifetime_earned INTO v_cur_balance, v_cur_lifetime
        FROM public.user_points WHERE user_id = NEW."customerId";
      IF NOT FOUND THEN
        INSERT INTO public.user_points (user_id, balance, lifetime_earned, lifetime_redeemed, tier)
          VALUES (NEW."customerId", v_points, v_points, 0, 'silver');
        v_new_balance := v_points;
      ELSE
        v_new_balance := COALESCE(v_cur_balance, 0) + v_points;
        UPDATE public.user_points
          SET balance = v_new_balance,
              lifetime_earned = COALESCE(lifetime_earned, 0) + v_points,
              updated_at = NOW()
          WHERE user_id = NEW."customerId";
      END IF;
      INSERT INTO public.points_history
        (user_id, delta, type, reason, source_type, source_id, balance_after)
      VALUES
        (NEW."customerId", v_points, 'earned', 'Booking confirmed', 'booking', NEW.id, v_new_balance);
    END IF;
  END IF;

  -- Notification (Session 6 — drained by external cron / Edge Function)
  IF NEW."customerId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.notification_queue
     WHERE user_id = NEW."customerId" AND template = 'booking_confirmed'
       AND payload->>'bidId' = NEW.id
  ) THEN
    INSERT INTO public.notification_queue (user_id, channel, template, payload)
    VALUES (
      NEW."customerId", 'whatsapp', 'booking_confirmed',
      jsonb_build_object(
        'bidId',     NEW.id,
        'hotelId',   NEW."hotelId",
        'amount',    v_amount,
        'points',    COALESCE(v_points, 0),
        'influencerId', v_influencer_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_on_bid_accepted ON public.bids;
CREATE TRIGGER trg_on_bid_accepted
  AFTER INSERT OR UPDATE OF status ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.fn_on_bid_accepted();
