// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — FUTURE live phase plan P0–P9 (metadata only). OFFLINE. NO I/O.
// Nothing here executes anything. Every phase that can change external state needs its OWN fresh, exact Owner
// authorization + a CLEAR_OF_RECORDED_COLLISION result for its OWN actionId (which is NOT authorization).
//
// Ordering (source-justified — see ARCHITECTURE-DECISIONS.md §ordering):
//   P5 (Authority standby deploy) MUST precede P6 (dedicated attester deploy): the UNCHANGED accepted attester resolves
//   LIVE_AI_03B_READER_SERVICE_NAME through resolvePeerAllowlist() at boot and exits 70 (fail closed) if the name does
//   not resolve to an exact private address. P7 binds the executor attester to the Authority's CURRENT literal /128,
//   so the Authority must NOT be redeployed between P5 and the end of P8.
// ─────────────────────────────────────────────────────────────────────────
import { SERVICES, TARGET, CANONICAL_ACTION_ID } from "../src/constants.mjs";
import { DEDICATED_PLAN, AUTHORITY_PLAN } from "./reference-plan.mjs";

const ENVC = "ai-staging";
const DRN = SERVICES.dedicatedReaderAttester.name, AUN = SERVICES.authority.name, EXN = SERVICES.executorAttester.name;
export const EXECUTOR_PEER_CIDRS_ENV = "LIVE_AI_03B_EXECUTOR_ATTESTER_ALLOWED_PEER_CIDRS";

const v = (names) => names.map((n) => "railway-variable-name:" + n);

/** mutationClass values are the Programme Collision Guard V1 enum; effect keys follow its grammar. */
export const PHASES = Object.freeze([
  { phase: "P0", title: "read-only prestate (names-only) + collision-guard CLEAR record + schema capability check",
    actionId: "M7-STEP6-7-P0-READ-ONLY-PRESTATE", mutationClass: "READ_ONLY", requiresOwnerAuthorization: false, executor: "controller",
    effectKeys: [`read-only-verify:${ENVC}:m7-step67:p0-prestate`], principals: [],
    preconditions: ["railway CLI authenticated as Owner", "names-only document passes isNamesOnlyDocument()"],
    produces: ["P0.receipt.json: M5 frozen snapshot (deployment ids + variable NAMES), executor attester deployment/commit, dedicated service absent"] },
  { phase: "P1", title: "Git preservation of THIS package on the designated branch (Owner push; controller verifies blobs)",
    actionId: "M7-STEP6-7-P1-GIT-PRESERVATION", mutationClass: "PROGRAMME_PHASE", requiresOwnerAuthorization: true, executor: "owner-git + controller-verify",
    effectKeys: [`programme-phase-execute:${ENVC}:m7-step67:p1-git-preservation`], principals: [],
    preconditions: ["P0 PASS", "reviewed manifest sha256 recorded"],
    produces: ["P1.receipt.json: reviewed commit, package + accepted dependency blob hashes equal the manifest"] },
  { phase: "P2", title: "create the dedicated private service shell (Owner dashboard) + controller read-only verification",
    actionId: "M7-STEP6-7-P2-DEDICATED-SERVICE-SHELL", mutationClass: "RAILWAY_SERVICE_CONFIG", requiresOwnerAuthorization: true, executor: "owner-dashboard + controller-verify",
    effectKeys: [`railway-service-config-set:${ENVC}:${DRN}:create`], principals: [],
    preconditions: ["P1 PASS", "service name exactly " + DRN, "no domain, no TCP proxy, 1 replica, NOT deployed, no variables"],
    produces: ["P2.receipt.json: dedicated service id (recorded for P3..P9)"] },
  { phase: "P3", title: "stage the dedicated attester variables (NEW key + NEW channel secret generated in memory; stdin only; --skip-deploys)",
    actionId: "M7-STEP6-7-P3-DEDICATED-ATTESTER-VARIABLES", mutationClass: "RAILWAY_SERVICE_VARIABLE", requiresOwnerAuthorization: true, executor: "controller",
    effectKeys: [`railway-service-variable-set:${ENVC}:${DRN}:attester-env`], principals: v(DEDICATED_PLAN.map((e) => e.dest)),
    preconditions: ["P2 PASS", "dedicated service has zero variables", "M5 + executor fingerprints supplied as PUBLIC pins"],
    produces: ["P3.receipt.json: public issuer + new fingerprint (the future P8 --expected-reader-attester-fingerprint)"] },
  { phase: "P4", title: "stage the Authority Step6/7 caller references (13 single-level ${{…}} references; stdin only; --skip-deploys)",
    actionId: "M7-STEP6-7-P4-AUTHORITY-CALLER-REFERENCES", mutationClass: "RAILWAY_SERVICE_VARIABLE", requiresOwnerAuthorization: true, executor: "controller",
    effectKeys: [`railway-service-variable-set:${ENVC}:${AUN}:step67-caller-refs`], principals: v(AUTHORITY_PLAN.filter((e) => e.kind === "reference").map((e) => e.dest)),
    preconditions: ["P3 PASS", "both existing DB reference names present on the Authority", "no forbidden name on the Authority"],
    produces: ["P4.receipt.json: names written (values never recorded)"] },
  { phase: "P5", title: "deploy the Authority in STANDBY (Owner dashboard; start command = standby entrypoint) + controller verification",
    actionId: "M7-STEP6-7-P5-AUTHORITY-STANDBY-DEPLOY", mutationClass: "DEPLOYMENT", requiresOwnerAuthorization: true, executor: "owner-dashboard + controller-verify",
    effectKeys: [`railway-deployment:${ENVC}:${AUN}:step67-standby`], principals: [],
    preconditions: ["P4 PASS", "P1 commit selected as the deployment source"],
    produces: ["P5.receipt.json: Authority deployment id (MUST stay unchanged through P8)"] },
  { phase: "P6", title: "deploy the dedicated reader attester (UNCHANGED accepted code; sole peer = Authority) + controller verification",
    actionId: "M7-STEP6-7-P6-DEDICATED-ATTESTER-DEPLOY", mutationClass: "DEPLOYMENT", requiresOwnerAuthorization: true, executor: "owner-dashboard + controller-verify",
    effectKeys: [`railway-deployment:${ENVC}:${DRN}:initial`], principals: [],
    preconditions: ["P5 PASS (the Authority private name must resolve, else the accepted attester exits 70)", "Authority deployment id == P5"],
    produces: ["P6.receipt.json: dedicated attester deployment id"] },
  { phase: "P7", title: "executor attester peer binding: Authority self-reported literal /128 → stdin variable set → redeploy (same commit)",
    actionId: "M7-STEP6-7-P7-EXECUTOR-PEER-BINDING", mutationClass: "COMPOSITE", requiresOwnerAuthorization: true, executor: "controller",
    effectKeys: [`railway-service-variable-set:${ENVC}:${EXN}:allowed-peer-cidrs`, `railway-deployment:${ENVC}:${EXN}:peer-binding-redeploy`],
    principals: v([EXECUTOR_PEER_CIDRS_ENV]),
    preconditions: ["P6 PASS", "Authority deployment id == P5", "executor attester commit == pinned source commit"],
    produces: ["P7.receipt.json: literal CIDRs (private, exact /128 or /32), new executor attester deployment id, commit unchanged"] },
  { phase: "P8", title: "ONE-SHOT Step6/7 verification inside the Authority (railway ssh; verification-only entrypoint)",
    actionId: CANONICAL_ACTION_ID, mutationClass: "READ_ONLY", requiresOwnerAuthorization: true, executor: "controller",
    effectKeys: [`read-only-verify:${ENVC}:m7-step67:p8-dual-binding`], principals: [],
    preconditions: ["P7 PASS", "Authority deployment id == P5", "dedicated attester deployment id == P6", "no prior P8 attempt marker"],
    produces: ["P8.receipt.json: the parsed, leak-guarded Step6/7 receipt (PASS ⇒ " + "READY_FOR_REVIEWER_TRUST_ROOT" + ")"] },
  { phase: "P9", title: "read-only post-verification: M5 reader host + M5 attester unchanged vs P0; no new public surface",
    actionId: "M7-STEP6-7-P9-READ-ONLY-POSTVERIFY", mutationClass: "READ_ONLY", requiresOwnerAuthorization: false, executor: "controller",
    effectKeys: [`read-only-verify:${ENVC}:m7-step67:p9-postverify`], principals: [],
    preconditions: ["P8 receipt present (PASS or HOLD)"],
    produces: ["P9.receipt.json: M5 snapshot equality, private-only checks"] },
].map((p) => Object.freeze({ ...p, targets: Object.freeze({ environmentClass: ENVC, projectId: TARGET.projectId, environmentId: TARGET.environmentId,
  postgresServiceId: TARGET.postgresServiceId, authorityServiceId: SERVICES.authority.id }) })));

export const PHASE_ORDER = Object.freeze(PHASES.map((p) => p.phase));
export const phaseOf = (id) => PHASES.find((p) => p.phase === id) || null;
export const previousPhase = (id) => { const i = PHASE_ORDER.indexOf(id); return i > 0 ? PHASE_ORDER[i - 1] : null; };

/** Local copy of the Collision Guard V1 effect-key grammar (the guard itself stays a separate, independent tool). */
const KINDS = ["read-only-verify", "railway-service-variable-set", "railway-service-config-set", "railway-deployment", "programme-phase-execute"];
export function validatePhasePlan(phases = PHASES) {
  const ids = new Set();
  for (const p of phases) {
    if (ids.has(p.actionId)) return { ok: false, reason: "duplicate_action_id" };
    ids.add(p.actionId);
    if (!/^[A-Z0-9][A-Z0-9-]{2,95}$/.test(p.actionId)) return { ok: false, reason: "action_id_grammar:" + p.phase };
    if (p.mutationClass !== "READ_ONLY" && p.requiresOwnerAuthorization !== true) return { ok: false, reason: "mutation_without_owner_authorization:" + p.phase };
    for (const k of p.effectKeys) {
      const parts = k.split(":");
      if (parts.length < 3 || !KINDS.includes(parts[0]) || parts[1] !== ENVC || !parts.slice(2).every((s) => /^[a-z0-9_.-]{1,96}$/.test(s))) return { ok: false, reason: "effect_key_grammar:" + k };
      if (p.mutationClass === "READ_ONLY" && parts[0] !== "read-only-verify") return { ok: false, reason: "read_only_phase_with_exclusive_effect:" + p.phase };
    }
    const txt = JSON.stringify(p);
    if (txt.includes(TARGET.coreProdProjectId) || txt.includes(TARGET.coreProdPostgresId)) return { ok: false, reason: "core_prod_in_phase" };
    if (/sql03|activate_catalog|restore_catalog|phase-a|gateway|provider|alter role/i.test(p.effectKeys.join(" ") + " " + p.title)) return { ok: false, reason: "forbidden_scope_in_phase:" + p.phase };
    if (txt.includes(SERVICES.m5ReaderAttester.id) || txt.includes(SERVICES.m5ReaderHost.id)) return { ok: false, reason: "m5_service_is_a_phase_target:" + p.phase };
  }
  const order = phases.map((p) => p.phase), p5 = order.indexOf("P5"), p6 = order.indexOf("P6");
  if ((p5 >= 0 || p6 >= 0) && !(p5 >= 0 && p6 === p5 + 1)) return { ok: false, reason: "authority_must_deploy_before_dedicated_attester" };
  return { ok: true };
}
