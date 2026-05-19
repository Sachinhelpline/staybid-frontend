-- Hybrid AI + human customer support system (v138 era)
-- Additive: no existing column/table touched.
--
-- ENUMS:
--   support_status: ai_active → escalated → agent_active → resolved/closed
--   support_sender: who wrote the message (user/ai/agent/system)
--   support_escalation_reason: why AI handed off
--
-- TABLES:
--   support_conversations — one row per chat session
--   support_messages — every message (user/ai/agent/system)
--
-- AGENT ROLE:
--   Reuses existing public.users.role TEXT column. Valid roles for
--   support access: 'admin', 'super_admin', 'support_agent' (new value,
--   no enum change because users.role has no enum constraint).

-- ─── ENUMS ────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE support_status AS ENUM (
    'ai_active',
    'escalated',
    'agent_active',
    'resolved',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_sender AS ENUM (
    'user',
    'ai',
    'agent',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_escalation_reason AS ENUM (
    'user_request',
    'low_confidence',
    'sentiment_negative',
    'specific_intent',
    'ai_disabled',
    'agent_manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── support_conversations ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_conversations (
  id                  TEXT PRIMARY KEY DEFAULT ('sc_' || replace(gen_random_uuid()::text, '-', '')),
  user_id             TEXT,                          -- null for anonymous sessions
  anonymous_id        TEXT,                          -- client-generated id for pre-login chats
  status              support_status NOT NULL DEFAULT 'ai_active',
  subject             TEXT,                          -- auto-generated from first message
  assigned_agent_id   TEXT,                          -- users.id of agent who claimed it
  assigned_agent_name TEXT,                          -- denormalized for display
  escalation_reason   support_escalation_reason,
  escalated_at        TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  resolved_by         TEXT,                          -- agent or 'user' or 'system'
  last_message_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_sender support_sender,
  user_unread_count   INT NOT NULL DEFAULT 0,
  agent_unread_count  INT NOT NULL DEFAULT 0,
  ai_message_count    INT NOT NULL DEFAULT 0,
  agent_message_count INT NOT NULL DEFAULT 0,
  user_message_count  INT NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
                                                     -- { pageUrl, userAgent, locale, tier }
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supconv_user
  ON public.support_conversations (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_supconv_anon
  ON public.support_conversations (anonymous_id, last_message_at DESC)
  WHERE anonymous_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supconv_queue
  ON public.support_conversations (status, last_message_at ASC);

CREATE INDEX IF NOT EXISTS idx_supconv_assigned
  ON public.support_conversations (assigned_agent_id, status, last_message_at DESC)
  WHERE assigned_agent_id IS NOT NULL;

-- ─── support_messages ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_messages (
  id              TEXT PRIMARY KEY DEFAULT ('sm_' || replace(gen_random_uuid()::text, '-', '')),
  conversation_id TEXT NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender          support_sender NOT NULL,
  sender_id       TEXT,                              -- user_id or agent_id (null for ai/system)
  sender_name     TEXT,                              -- denormalized display name
  body            TEXT NOT NULL,
  ai_suggested    BOOLEAN NOT NULL DEFAULT FALSE,    -- true if agent used AI-suggested reply
  ai_model        TEXT,                              -- e.g. claude-haiku-4-5-20251001
  ai_tokens_in    INT,
  ai_tokens_out   INT,
  ai_confidence   NUMERIC(3,2),                      -- 0.00-1.00 self-reported
  ai_should_escalate BOOLEAN,                        -- AI suggests handing off
  attachments     JSONB,                             -- future: image/voice attachments
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supmsg_conv
  ON public.support_messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_supmsg_unread_user
  ON public.support_messages (conversation_id)
  WHERE read_at IS NULL AND sender IN ('ai', 'agent', 'system');

-- ─── updated_at auto-touch trigger ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_supconv_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_supconv_touch_updated_at ON public.support_conversations;
CREATE TRIGGER trg_supconv_touch_updated_at
  BEFORE UPDATE ON public.support_conversations
  FOR EACH ROW EXECUTE FUNCTION public.fn_supconv_touch_updated_at();

-- ─── GRANT + RLS (matches 2026-05-13-rls-everywhere.sql precedent) ───
GRANT ALL ON public.support_conversations TO anon, authenticated, service_role;
GRANT ALL ON public.support_messages      TO anon, authenticated, service_role;

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_conversations' AND policyname='all_anon_all') THEN
    CREATE POLICY all_anon_all ON public.support_conversations
      FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_messages' AND policyname='all_anon_all') THEN
    CREATE POLICY all_anon_all ON public.support_messages
      FOR ALL TO anon, authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;
