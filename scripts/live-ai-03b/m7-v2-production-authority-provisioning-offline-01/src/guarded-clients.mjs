// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 PRODUCTION AUTHORITY PROVISIONING — sealed, role-scoped DB clients. OFFLINE candidate.
//
// The ONLY client objects the frozen runtime ever receives. Each wraps exactly ONE bound physical connection
// (the one whose token the independent attestation bound) and exposes only query(). They are constructed after
// the role binding succeeded and can never be re-pointed at another connection.
//   • executor client: admits EXACTLY the preserved ACTIVATE_SQL_V2 statement, at most ONCE (the activation is a
//     one-shot); restoration, table DML, lifecycle SQL or any other text is refused before reaching the wire.
//   • reader client:   admits EXACTLY the eight statements of the preserved, content-verified V2 registry (no
//     caller SQL, no dynamic SQL); parameters only for the ledger query (approval_id, execution_id).
// Both refuse once their physical connection is dead (no silent reconnect ⇒ the attested session cannot change).
// ─────────────────────────────────────────────────────────────────────────
import { ACTIVATE_SQL_V2 } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-restricted-activation-adapter.mjs";
import { V2_QUERY_REGISTRY, LEDGER_COMMITTED_QUERY_V2, REGISTRY_SELF_CHECK, V2_REGISTRY_DIGEST } from "../../m7-step2-runtime-rebinding-offline-01/runtime/v2-query-registry.mjs";

const READER_SQL = new Set(Object.values(V2_QUERY_REGISTRY));
function refuse(code) { const e = new Error("guarded_client_refused"); e.code = code; return e; }
const IDRE = /^[A-Za-z0-9._:-]{8,128}$/;

export function makeGuardedExecutorClient(session, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!session || !session.physical || typeof session.physical.query !== "function") throw new Error("guarded_executor_session_absent");
  const physical = session.physical; let used = false;
  const client = {
    async query(sql, params) {
      if (physical.isDead()) throw refuse("EXECUTOR_CONNECTION_DEAD");
      if (sql !== ACTIVATE_SQL_V2) throw refuse("EXECUTOR_SQL_NOT_ADMITTED");
      if (!Array.isArray(params) || params.length !== 2 || typeof params[0] !== "string" || typeof params[1] !== "string" || !IDRE.test(params[1])) throw refuse("EXECUTOR_PARAMS_NOT_ADMITTED");
      if (used) throw refuse("EXECUTOR_ACTIVATION_ALREADY_ISSUED");
      used = true; // claimed before the wire: an ambiguous outcome can never lead to a second issue
      return physical.query(sql, params);
    },
  };
  if (testBoundary) client.__testFixture = true; // the frozen production validators refuse any test-built client
  return Object.freeze(client);
}

export function makeGuardedReaderClient(session, opts) {
  const testBoundary = !!(opts && opts.testBoundary === true);
  if (!REGISTRY_SELF_CHECK.ok || REGISTRY_SELF_CHECK.digest !== V2_REGISTRY_DIGEST) throw new Error("guarded_reader_registry_integrity");
  if (!session || !session.physical || typeof session.physical.query !== "function") throw new Error("guarded_reader_session_absent");
  const physical = session.physical;
  const client = {
    async query(sql, params) {
      if (typeof physical.isDead === "function" && physical.isDead()) throw refuse("READER_CONNECTION_DEAD");
      if (!READER_SQL.has(sql)) throw refuse("READER_SQL_NOT_ADMITTED");
      const p = params === undefined ? [] : params;
      if (!Array.isArray(p)) throw refuse("READER_PARAMS_NOT_ADMITTED");
      if (sql === LEDGER_COMMITTED_QUERY_V2) { if (p.length !== 2 || !p.every((x) => typeof x === "string" && IDRE.test(x))) throw refuse("READER_PARAMS_NOT_ADMITTED"); }
      else if (p.length !== 0) throw refuse("READER_PARAMS_NOT_ADMITTED");
      return physical.query(sql, p);
    },
    statementTimeoutMs: session.effectiveStatementTimeoutMs,
  };
  if (testBoundary) client.__testFixture = true;
  return Object.freeze(client);
}
