-- ─────────────────────────────────────────────────────────────────────────
-- Complaints schema upgrade + admin audit log (v98, May 2026)
--
-- 1. `complaints` table EXISTS (legacy Prisma model: id, bookingId,
--    customerId, description, videoUrl, fraudScore, status, adminNote,
--    createdAt) but is missing the columns the admin Complaints page
--    has been reading + writing since Session 1 (Apr 2026):
--       type, subject, priority, hotelId, bidId, paymentId,
--       customerPhone, refundAmount, adminNotes (plural), updatedAt,
--       resolvedAt, metadata
--    Without these the admin PATCH /api/admin/complaints/resolve fires
--    against unknown columns and the type/priority filters return empty.
--    v98 ships ALTER TABLE … ADD COLUMN IF NOT EXISTS for each.
--    Existing rows keep working.
--
-- 2. `admin_action_logs` — fresh table, audit trail for every admin
--    mutation. /admin/settings → Action Logs tab has been reading from
--    this table since Session 1 but nothing was writing.
--
-- Additive only. Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Extend existing complaints table ────────────────────────────────
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS type           TEXT NOT NULL DEFAULT 'general';
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS subject        TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS priority       TEXT NOT NULL DEFAULT 'low';
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "hotelId"      TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "bidId"        TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS paymentId      TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS customerPhone  TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "adminNotes"   TEXT;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS refundAmount   NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS metadata       JSONB;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS "updatedAt"    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS resolvedAt     TIMESTAMPTZ;

-- Relax NOT NULL on bookingId so general complaints (e.g. payment/account)
-- can be filed without an attached booking. Existing rows are untouched.
ALTER TABLE public.complaints ALTER COLUMN "bookingId" DROP NOT NULL;
ALTER TABLE public.complaints ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE public.complaints ALTER COLUMN description  DROP NOT NULL;

-- Default id generator so customer-side INSERTs don't have to mint one
ALTER TABLE public.complaints ALTER COLUMN id SET DEFAULT ('cmplt_' || gen_random_uuid()::text);

CREATE INDEX IF NOT EXISTS idx_complaints_customer ON public.complaints("customerId");
CREATE INDEX IF NOT EXISTS idx_complaints_hotel    ON public.complaints("hotelId");
CREATE INDEX IF NOT EXISTS idx_complaints_status   ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_type     ON public.complaints(type);
CREATE INDEX IF NOT EXISTS idx_complaints_priority ON public.complaints(priority);
CREATE INDEX IF NOT EXISTS idx_complaints_created  ON public.complaints("createdAt" DESC);

GRANT ALL ON public.complaints TO anon, authenticated, service_role;

-- ── 2. admin_action_logs (new) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id           TEXT PRIMARY KEY DEFAULT ('log_' || gen_random_uuid()::text),
  "adminId"    TEXT,
  "adminPhone" TEXT,
  "adminName"  TEXT,
  action       TEXT NOT NULL,
  "targetType" TEXT,
  "targetId"   TEXT,
  details      JSONB,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin     ON public.admin_action_logs("adminId");
CREATE INDEX IF NOT EXISTS idx_admin_logs_target    ON public.admin_action_logs("targetType", "targetId");
CREATE INDEX IF NOT EXISTS idx_admin_logs_action    ON public.admin_action_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_timestamp ON public.admin_action_logs(timestamp DESC);

GRANT ALL ON public.admin_action_logs TO anon, authenticated, service_role;

ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_action_logs' AND policyname='admin_logs_all_anon') THEN
    EXECUTE 'CREATE POLICY admin_logs_all_anon ON public.admin_action_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
