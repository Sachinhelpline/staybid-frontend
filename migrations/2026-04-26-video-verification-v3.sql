-- v3 — multi-segment + adaptive delivery + dispute verdict (applied via MCP)
ALTER TABLE public.vp_videos     ADD COLUMN IF NOT EXISTS segments JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.vp_videos     ADD COLUMN IF NOT EXISTS urls JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.vp_videos     ADD COLUMN IF NOT EXISTS merge_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.vp_videos     ADD COLUMN IF NOT EXISTS pre_upload_score INT;

ALTER TABLE public.vp_complaints ADD COLUMN IF NOT EXISTS ai_verdict TEXT;
ALTER TABLE public.vp_complaints ADD COLUMN IF NOT EXISTS ai_confidence INT;
ALTER TABLE public.vp_complaints ADD COLUMN IF NOT EXISTS discrepancies JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.vp_complaints ADD COLUMN IF NOT EXISTS recommended_resolution TEXT;
ALTER TABLE public.vp_complaints ADD COLUMN IF NOT EXISTS auto_approvable BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
