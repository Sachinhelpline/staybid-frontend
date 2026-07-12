-- v321 — Web Push (FCM) device-token registry.
-- Stores the FCM registration token per (user, device) so the Railway
-- notification drainer can send native/web push to a customer's devices.
-- Additive, isolated: no existing table touched. Permissive RLS to match
-- the project baseline (all other tables are anon-permissive; writes go
-- through the server route with SB_H service-role anyway).

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id          TEXT PRIMARY KEY DEFAULT ('pt_' || replace(gen_random_uuid()::text, '-', '')),
  user_id     TEXT NOT NULL,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'web',   -- web | android | ios
  user_agent  TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per FCM token (re-registering the same device upserts).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_tokens_token ON public.push_tokens (token);
-- Fast "all tokens for this user" lookup for the sender.
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id) WHERE enabled;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_tokens_all_anon ON public.push_tokens;
CREATE POLICY push_tokens_all_anon ON public.push_tokens
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
