-- OFFLINE CANDIDATE WRAPPER. NO AUTOMATIC EXECUTION.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_user<>'live_ai_03b_executor' OR session_user<>'live_ai_03b_executor' THEN RAISE EXCEPTION 'v3-restore: restricted executor role required'; END IF; END $$;
SELECT live_ai_03b_trusted_v3.restore_catalog_v3_inactive(:'verified_claims_json'::jsonb,:'execution_id');
COMMIT;
