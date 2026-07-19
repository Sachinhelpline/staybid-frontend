-- v366 — Model 3 Phase C: admin lever to protect Model-2 pricing on the OVERLAP.
-- For Circle-operated (host_circle) properties that could appear in BOTH Model 2
-- (fixed 2×) and Model 3 (auction from cost), the admin can raise the Model-3
-- min-bid floor to a MULTIPLE of the Spine cost so the auction can't undercut the
-- fixed channel. Default 1.0 = raw cost (no change to current behaviour). Only
-- applied to host_circle hotels at lot-publish time; classic hotels stay at 1×.
ALTER TABLE public.auction_config
  ADD COLUMN IF NOT EXISTS circle_floor_multiplier NUMERIC NOT NULL DEFAULT 1.0;

COMMENT ON COLUMN public.auction_config.circle_floor_multiplier IS
  'Model-3 min-bid floor multiplier for Circle-operated (host_circle) lots only (protects Model-2 fixed pricing on the overlap). Default 1.0 = raw Spine cost.';
