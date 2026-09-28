// TEST-ONLY attester for the THROWAWAY local PostgreSQL cluster. It stands in for the independent,
// Owner-controlled attestation authority: it INDEPENDENTLY observes the reader's live session through its
// own superuser connection (pg_stat_activity + has_table_privilege over the catalog) — it never trusts the
// requester — and signs an AiStagingReaderAttestationV1 with a per-run SYNTHETIC Ed25519 key under a
// TEST-ONLY issuer (production refuses TEST-ONLY issuers). The local cluster is NOT AI-STAGING; the
// AI-STAGING target ids it attests are the fixed contract ids standing in for the throwaway cluster.
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize, publicKeyFingerprintFromDerB64 } from "../../m7-step1-hb1-consolidated-remediation-01/approval/pricing-approval-contract-v2.mjs";
import { ATTESTATION_CONTRACT, ATTESTATION_DOMAIN } from "../../private-reader-production-integration-offline-01/reader-attestation.mjs";
import { connectionTokenFor } from "../../private-reader-production-integration-offline-01/reader-session.mjs";
import { TARGETS_V2 } from "../identity/v2-identity.mjs";

const SESSIONS_SQL = "SELECT pid, to_char(backend_start AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS backend_start, application_name, usename "
  + "FROM pg_stat_activity WHERE backend_type='client backend'";
const PRIV_SQL = "SELECT "
  + "(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege($1, c.oid, 'SELECT')) AS select_public, "
  + "(SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m') "
  + "AND (has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE') OR has_table_privilege($1, c.oid, 'TRUNCATE'))) AS write_count, "
  + "has_table_privilege($1, 'public.budget_envelope_allocations', 'SELECT') AS forbidden, "
  + "EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1) AS role_member, "
  + "(pg_has_role($1, 'live_ai_03b_executor', 'MEMBER') OR pg_has_role($1, 'live_ai_03b_fn_owner', 'MEMBER') "
  + "OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=$1)) AS owner_or_exec, "
  + "EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname LIKE 'live_ai_03b%' AND has_function_privilege($1, p.oid, 'EXECUTE')) AS routine";

export function makeLocalPgAttester({ superClient, nowProvider = Date.now, issuer = "TEST-ONLY-localpg-attester", lifetimeMs = 300000 }) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const fingerprint = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  let issued = 0;
  const source = {
    async obtain(req) {
      const sessions = (await superClient.query(SESSIONS_SQL)).rows;
      const s = sessions.find((x) => connectionTokenFor({ pid: Number(x.pid), backendStart: x.backend_start, applicationName: x.application_name }) === req.connectionToken);
      if (!s) throw new Error("no such session");
      const p = (await superClient.query(PRIV_SQL, [s.usename])).rows[0];
      const t = nowProvider();
      const payload = {
        contract: ATTESTATION_CONTRACT, domain: ATTESTATION_DOMAIN, issuer, keyId: fingerprint, issuedAtMs: t, expiresAtMs: t + lifetimeMs, requestNonce: req.requestNonce,
        target: { projectId: TARGETS_V2.project, environmentId: TARGETS_V2.environment, pgServiceId: TARGETS_V2.postgres },
        connection: { token: req.connectionToken, role: s.usename },
        privileges: { currentUser: s.usename, effectiveSelectOnly: p.write_count === 0, writePrivilegeCount: p.write_count, selectGrantCount: p.select_public,
          forbiddenObjectAccessible: p.forbidden === true, unapprovedRoleMembership: p.role_member === true, unapprovedRoutineAuthority: p.routine === true, ownerOrExecutorAuthority: p.owner_or_exec === true },
      };
      issued++;
      return { payload, signatureB64: sign(null, Buffer.from(canonicalize(payload), "utf8"), privateKey).toString("base64") };
    },
  };
  return { source, trustRootConfig: { issuer, publicKeyDerB64, fingerprint }, issued: () => issued };
}
