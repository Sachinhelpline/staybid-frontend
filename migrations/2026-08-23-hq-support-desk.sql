-- HQ Support Desk (Phase A) — unified ticket store shared by the HQ panel
-- (staybid-hq → staybid-Live /internal/support/*) and the partner (hotel owner)
-- dashboard (/api/partner/support/*). Additive, no FK, TEXT ids (repo convention).
-- RLS enabled with NO anon/authenticated policy → only the service-role key
-- (server routes on both apps) reads/writes. Customer support (support_conversations)
-- and complaints are untouched.
--
-- Applied live via Supabase MCP apply_migration (project uxxhbdqedazpmvbvaosh).

CREATE TABLE IF NOT EXISTS public.hq_support_tickets (
  id           TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,
  party_type   TEXT NOT NULL,                    -- hotel_owner | investor | agent | vendor
  source       TEXT NOT NULL DEFAULT 'internal', -- partner (self-raised) | internal (HQ-logged)
  contact_name TEXT,
  contact_ref  TEXT,                             -- phone / email / free ref
  owner_scope  TEXT,                             -- resolved owner id (partner-created; scopes their reads)
  hotel_id     TEXT,
  category     TEXT,
  priority     TEXT NOT NULL DEFAULT 'normal',
  status       TEXT NOT NULL DEFAULT 'open',     -- open | in_progress | resolved | closed
  role_id      TEXT,                             -- assigned HQ role (uuid-as-text)
  assignee_id  TEXT,                             -- assigned HQ employee (uuid-as-text)
  created_by   TEXT NOT NULL,                    -- employee id OR owner id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hq_support_tickets_status_idx  ON public.hq_support_tickets (status, assignee_id);
CREATE INDEX IF NOT EXISTS hq_support_tickets_owner_idx   ON public.hq_support_tickets (owner_scope);
CREATE INDEX IF NOT EXISTS hq_support_tickets_updated_idx ON public.hq_support_tickets (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.hq_support_messages (
  id           TEXT PRIMARY KEY,
  ticket_id    TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  author_kind  TEXT NOT NULL DEFAULT 'employee', -- employee | partner
  author_name  TEXT,
  body         TEXT,
  file_name    TEXT,
  storage_path TEXT,
  mime_type    TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hq_support_messages_ticket_idx ON public.hq_support_messages (ticket_id, created_at);

ALTER TABLE public.hq_support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_support_messages ENABLE ROW LEVEL SECURITY;
