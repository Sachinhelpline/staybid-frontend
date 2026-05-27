-- v240 — Future-proof Place Bid vs Negotiate detection.
--
-- APPLIED LIVE to Supabase project uxxhbdqedazpmvbvaosh on 2026-05-27 via
-- MCP apply_migration `v240_bid_requests_source_column` + a one-shot
-- backfill UPDATE for legacy rows.
--
-- Background:
--   /my-bids "Place Bid" section was repeatedly going empty (v233 /
--   v234 / now v240). Pre-v240 detection was a 3-way OR:
--     (a) b.flow === "place"             ← bids table has NO flow column
--     (b) /\bGuest bid\b/i.test(message)  ← Railway can strip the message
--     (c) /max ₹/i.test(message)          ← same
--   If Railway didn't preserve the message verbatim, every Place Bid
--   fell into Negotiate. Sachin: "future proof solution karo na ki
--   alteration".
--
-- Fix: stamp the flow at bid_request creation. /api/bids/request
-- accepts a `source` field; /api/bids/my already spreads the request
-- object, so frontend reads b.request.source directly. No more regex.
--
-- Forward-only. Schema constraint enforces the enum.

ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'negotiate'
    CHECK (source IN ('place', 'negotiate', 'direct', 'flash'));

CREATE INDEX IF NOT EXISTS idx_bid_requests_source
  ON public.bid_requests (source);

COMMENT ON COLUMN public.bid_requests.source IS
  'Flow that created this request. place=reverse-auction (/bid → broadcasts to N hotels); negotiate=single-hotel /hotels/[id] Negotiate; direct=Book Now; flash=Flash Deal. Stamped at insert time. Frontend reads via b.request.source on /api/bids/my.';

-- Backfill: any historical request linked to a bid whose message starts
-- with "Guest bid " is canonically a Place Bid. /hotels Negotiate never
-- emits that exact prefix (uses "Guest's preferred price:" or
-- Razorpay/Flash-Deal/Book Now tokens). One-shot data fix so legacy
-- rows land in the right /my-bids section immediately.
UPDATE public.bid_requests br
   SET source = 'place'
 WHERE source = 'negotiate'
   AND EXISTS (
     SELECT 1 FROM public.bids b
      WHERE b."requestId" = br.id
        AND b.message LIKE 'Guest bid %'
   );

-- Verification after apply:
--   SELECT source, COUNT(*) FROM bid_requests GROUP BY source;
-- Expected post-backfill: place=~142, negotiate=remaining.
