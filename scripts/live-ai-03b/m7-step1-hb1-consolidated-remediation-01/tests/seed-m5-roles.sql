-- TEST-ONLY seed of the M4/M5 predecessor role shapes on a THROWAWAY local cluster (synthetic passwords).
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE live_ai_03b_attester_observer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
GRANT pg_read_all_stats TO live_ai_03b_attester_observer;
ALTER ROLE live_ai_03b_attester_observer SET default_transaction_read_only = on;
ALTER ROLE live_ai_03b_attester_observer SET statement_timeout = '2s';
ALTER ROLE live_ai_03b_reader PASSWORD 'synthetic-test-reader-pw';
ALTER ROLE live_ai_03b_attester_observer PASSWORD 'synthetic-test-observer-pw';
COMMIT;
