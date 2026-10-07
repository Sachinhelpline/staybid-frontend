-- OFFLINE CANDIDATE WRAPPER. FUTURE LIVE USE REQUIRES SEPARATE AUTHORIZATION + RESOLVED SUCCESSOR RUNTIME PIN.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_user<>'live_ai_03b_executor' OR session_user<>'live_ai_03b_executor' THEN RAISE EXCEPTION 'v3-activate: restricted executor role required'; END IF; END $$;
SELECT live_ai_03b_trusted_v3.activate_catalog_v3(:'verified_claims_json'::jsonb,:'execution_id');
COMMIT;
