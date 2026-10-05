// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — EXACT Railway CLI argv builders + classification (Owner-Mac controller). OFFLINE. NO I/O.
// Every builder returns { argv, mutation:boolean, stdinCarriesValue:boolean }. NO argv ever carries a variable VALUE:
// values travel on stdin only (`variable set NAME --stdin`, the Step11B-proven pattern). There is deliberately NO
// builder for: variable delete, `variables` listing (value output), service delete, domain/TCP-proxy creation,
// `railway run`, `railway up`, `connect`, or any CORE-PROD target.
// ─────────────────────────────────────────────────────────────────────────
import { TARGET, SERVICES } from "../src/constants.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[A-Z][A-Z0-9_]{1,127}$/;
function svc(id) {
  if (!UUID.test(id || "")) throw new Error("service_id_invalid");
  if (id === TARGET.coreProdProjectId || id === TARGET.coreProdPostgresId) throw new Error("core_prod_refused");
  return id;
}
const scope = ["--environment", TARGET.environmentId, "--project", TARGET.projectId];

export const ARGV = Object.freeze({
  version: () => ({ argv: ["--version"], mutation: false, stdinCarriesValue: false }),
  whoami: () => ({ argv: ["whoami", "--json"], mutation: false, stdinCarriesValue: false }),
  sshHelp: () => ({ argv: ["ssh", "--help"], mutation: false, stdinCarriesValue: false }),
  variableSetHelp: () => ({ argv: ["variable", "set", "--help"], mutation: false, stdinCarriesValue: false }),
  /** names-only GraphQL state (document file path; the document is proven value-free by names-only-state.mjs). */
  namesOnlyState: (docPath) => ({ argv: ["api", "-f", docPath, "--compact"], mutation: false, stdinCarriesValue: false }),
  /** set ONE variable on ONE service; the value (secret, public or a ${{…}} reference expression) is on stdin only. */
  variableSet: (serviceId, name) => {
    if (!NAME.test(name)) throw new Error("variable_name_invalid");
    // the M5 reader attester, the M5 reader host and Postgres are NEVER a write target; the executor attester only for its peer allowlist
    if ([SERVICES.m5ReaderAttester.id, SERVICES.m5ReaderHost.id, TARGET.postgresServiceId].includes(serviceId)) throw new Error("frozen_service_write_refused");
    if (serviceId === SERVICES.executorAttester.id && name !== "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS") throw new Error("executor_attester_write_limited_to_peer_cidrs");
    return { argv: ["variable", "set", name, "--stdin", "--skip-deploys", "--service", svc(serviceId), ...scope, "--json"], mutation: true, stdinCarriesValue: true };
  },
  /** redeploy the existing deployment of ONE service (no --from-source ⇒ same build/commit). Used ONLY for the executor attester in P7. */
  redeploy: (serviceId) => {
    if (svc(serviceId) !== SERVICES.executorAttester.id) throw new Error("redeploy_only_permitted_for_executor_attester");
    return { argv: ["deployment", "redeploy", "--service", serviceId, ...scope, "--yes", "--json"], mutation: true, stdinCarriesValue: false };
  },
  /** run ONE fixed node script inside the Authority container (read-only helpers only). */
  sshAuthorityNode: (scriptPath, args = []) => {
    if (!/^scripts\/live-ai-03b\/m7-step67-authority-dedicated-reader-attester-offline-01\/src\/(step67-verification-entrypoint|authority-peer-identity)\.mjs$/.test(scriptPath)) throw new Error("ssh_script_not_permitted");
    for (const a of args) if (typeof a !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(a)) throw new Error("ssh_arg_not_permitted");
    return { argv: ["ssh", "-p", TARGET.projectId, "-e", TARGET.environmentId, "-s", SERVICES.authority.id, "--", "node", scriptPath, ...args], mutation: false, stdinCarriesValue: false };
  },
});
