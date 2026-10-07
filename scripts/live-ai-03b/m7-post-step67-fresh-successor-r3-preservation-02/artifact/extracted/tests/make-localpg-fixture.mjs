import * as G from '../src/v3-digest-gen.mjs';
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const ts=v=>`TIMESTAMPTZ ${q(v)}`;
const v1=G.entryRows(G.V1.id,G.V1_RATES,G.V1.t0,G.V1.expiry,G.V1.source_digest,'inactive');
const v2=G.entryRows(G.V2.id,G.V2_RATES,G.V2.t0,G.V2.expiry,G.V2.source_digest,'inactive');
const row=e=>`(${[e.id,e.catalog_version_id,e.provider,e.model].map(q).join(',')},${e.service_tier===null?'NULL':q(e.service_tier)},${q(e.billing_dimension)},${q(e.currency_code)},${e.unit_size},${e.rate_micros},${ts(e.effective_from)},NULL,${ts(e.verified_at)},${ts(e.verification_expires_at)},${q(e.source_id)},${q(e.source_digest)},'inactive',${ts(e.created_at)})`;
process.stdout.write(`\\set ON_ERROR_STOP on
CREATE ROLE live_ai_03b_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE live_ai_03b_executor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE TABLE public.budget_price_catalog_versions(id text PRIMARY KEY,status text NOT NULL,effective_from timestamptz NOT NULL,effective_until timestamptz,catalog_digest text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE public.budget_price_catalog_entries(id text PRIMARY KEY,catalog_version_id text NOT NULL,provider text NOT NULL,model text NOT NULL,service_tier text,billing_dimension text NOT NULL,currency_code text NOT NULL,unit_size bigint NOT NULL,rate_micros bigint NOT NULL,effective_from timestamptz NOT NULL,effective_until timestamptz,verified_at timestamptz NOT NULL,verification_expires_at timestamptz NOT NULL,source_id text NOT NULL,source_digest text NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE public.budget_policy_versions(id text PRIMARY KEY,project_id text NOT NULL,status text NOT NULL,effective_from timestamptz NOT NULL,effective_until timestamptz,session_money_ceiling_micros bigint NOT NULL,session_provider_calls int NOT NULL,session_execution_admissions int NOT NULL,subject_day_money_ceiling_micros bigint NOT NULL,project_day_money_ceiling_micros bigint NOT NULL,project_month_money_ceiling_micros bigint NOT NULL,global_day_money_ceiling_micros bigint NOT NULL,policy_digest text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE public.budget_control_epochs(scope_type text NOT NULL,scope_key_digest text NOT NULL,control_epoch int NOT NULL,enabled boolean NOT NULL,killed boolean NOT NULL,record_digest text NOT NULL,PRIMARY KEY(scope_type,scope_key_digest));
ALTER TABLE public.budget_price_catalog_versions OWNER TO live_ai_03b_fn_owner;
ALTER TABLE public.budget_price_catalog_entries OWNER TO live_ai_03b_fn_owner;
ALTER TABLE public.budget_policy_versions OWNER TO live_ai_03b_fn_owner;
ALTER TABLE public.budget_control_epochs OWNER TO live_ai_03b_fn_owner;
CREATE SCHEMA live_ai_03b_trusted AUTHORIZATION live_ai_03b_fn_owner;
CREATE TABLE live_ai_03b_trusted.approval_consumption(approval_id text PRIMARY KEY,execution_id text NOT NULL,content_digest text NOT NULL,active_catalog_digest text NOT NULL,action text NOT NULL,consumed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE live_ai_03b_trusted.approval_consumption OWNER TO live_ai_03b_fn_owner;
CREATE SCHEMA live_ai_03b_trusted_v2 AUTHORIZATION live_ai_03b_fn_owner;
CREATE FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$;
ALTER FUNCTION live_ai_03b_trusted_v2.activate_catalog_v2(jsonb,text) OWNER TO live_ai_03b_fn_owner;
ALTER FUNCTION live_ai_03b_trusted_v2.restore_catalog_v2_inactive(jsonb,text) OWNER TO live_ai_03b_fn_owner;
INSERT INTO public.budget_price_catalog_versions VALUES
(${q(G.V1.id)},'inactive',${ts(G.V1.t0)},NULL,${q(G.V1.inactive_catalog_digest)},${ts(G.V1.t0)}),
(${q(G.V2.id)},'inactive',${ts(G.V2.t0)},NULL,${q(G.V2.inactive_catalog_digest)},${ts(G.V2.t0)});
INSERT INTO public.budget_price_catalog_entries(id,catalog_version_id,provider,model,service_tier,billing_dimension,currency_code,unit_size,rate_micros,effective_from,effective_until,verified_at,verification_expires_at,source_id,source_digest,status,created_at) VALUES
${[...v1,...v2].map(row).join(',\n')};
INSERT INTO public.budget_policy_versions VALUES(${q(G.DORMANT.policy_id)},'live-ai-03b','inactive',${ts(G.DORMANT.t0)},NULL,0,0,0,0,0,0,0,${q(G.DORMANT.policy_digest)},${ts(G.DORMANT.t0)});
INSERT INTO public.budget_control_epochs VALUES('global','global',1,false,false,${q(G.DORMANT.control_global_digest)}),('project','live-ai-03b',1,false,false,${q(G.DORMANT.control_project_digest)});
`);
