-- ═══════════════════════════════════════════════════════════════════════════
-- social-media Storage bucket — already applied to Supabase via the
-- `social_media_bucket` migration on 2026-05-10. Captured here for
-- repo history / future fresh-environment provisioning.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('social-media', 'social-media', TRUE, 104857600, NULL)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DO $$ BEGIN
  CREATE POLICY social_media_public_read ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'social-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_media_anon_write ON storage.objects
    FOR INSERT TO anon, authenticated
    WITH CHECK (bucket_id = 'social-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY social_media_anon_update ON storage.objects
    FOR UPDATE TO anon, authenticated
    USING (bucket_id = 'social-media')
    WITH CHECK (bucket_id = 'social-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
