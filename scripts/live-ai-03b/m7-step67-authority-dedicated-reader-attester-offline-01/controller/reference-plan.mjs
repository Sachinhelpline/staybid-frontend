// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — Railway variable / reference plans (Owner-Mac controller). OFFLINE candidate. NO I/O.
//
// Two exact plans, each destination → source:
//   A. AUTHORITY caller plan: 15 names = the 2 EXISTING DB credential references (verified, never touched) + 13 NEW
//      single-level Railway references (6 executor-attester, 6 dedicated-reader-attester, 1 anchor).
//   B. DEDICATED reader-attester plan: the accepted ATTESTER_ENV names + 2 non-secret public-key custody names.
// Rules enforced by validatePlans() (and by the tests):
//   • the Authority NEVER references a signing key, an observer credential, attester-side custody or a superuser name;
//   • only the DEDICATED attester references the M5 observer credential + the accepted AI-STAGING anchor;
//   • no reference CHAIN: every source is a plain stored variable or a Railway-provided variable (RAILWAY_PRIVATE_DOMAIN);
//   • the existing M5 reader attester / reader host are SOURCES ONLY — no destination on them, ever;
//   • generated secrets (signing key, channel secret) exist only on the dedicated attester; the Authority reads the
//     channel secret by reference, never the signing key.
// ─────────────────────────────────────────────────────────────────────────
import {
  SERVICES, TARGET, DB_ENV, AUTHORITY_EXECUTOR_ATTESTER_ENV as EX, AUTHORITY_READER_ATTESTER_ENV as RD, AUTHORITY_ANCHOR_ENV,
  DEDICATED_ATTESTER_ENV as DA, DEDICATED_PUBLIC_CUSTODY_ENV as DP, DEDICATED_READER_ATTESTER_ISSUER, DEDICATED_READER_ATTESTER_PORT,
  DEDICATED_READER_ATTESTER_BIND_HOST, STEP67_FORBIDDEN_ENV_NAMES, STEP67_FORBIDDEN_ENV_PATTERNS,
} from "../src/constants.mjs";

export const RAILWAY_PROVIDED = Object.freeze(["RAILWAY_PRIVATE_DOMAIN"]);
export const ref = (serviceName, variable) => "${{" + serviceName + "." + variable + "}}";
const REF_RE = /^\$\{\{([a-z0-9-]{1,63})\.([A-Z][A-Z0-9_]{1,127})\}\}$/;
export function parseReference(v) { const m = typeof v === "string" ? REF_RE.exec(v) : null; return m ? { service: m[1], variable: m[2] } : null; }

const EXN = SERVICES.executorAttester.name, DRN = SERVICES.dedicatedReaderAttester.name, M5N = SERVICES.m5ReaderAttester.name, AUN = SERVICES.authority.name;

/** A. Authority caller plan (destination on the Authority service). `kind:"existing"` entries are NEVER written. */
export const AUTHORITY_PLAN = Object.freeze([
  { dest: DB_ENV.executorDbUrl, kind: "existing", note: "Step11B executor credential reference — verified, never touched" },
  { dest: DB_ENV.readerDbUrl, kind: "existing", note: "M7 authority-side reader credential reference — verified, never touched" },
  { dest: EX.issuer, kind: "reference", service: EXN, variable: "LIVE_AI_03B_EXECUTOR_ATTESTER_ISSUER" },
  { dest: EX.publicKeyDerB64, kind: "reference", service: EXN, variable: "LIVE_AI_03B_EXECUTOR_ATTESTER_PUBKEY_DER_B64" },
  { dest: EX.fingerprint, kind: "reference", service: EXN, variable: "LIVE_AI_03B_EXECUTOR_ATTESTER_FINGERPRINT" },
  { dest: EX.host, kind: "reference", service: EXN, variable: "RAILWAY_PRIVATE_DOMAIN" },
  { dest: EX.port, kind: "reference", service: EXN, variable: "LIVE_AI_03B_EXECUTOR_ATTESTER_PORT" },
  { dest: EX.channelSecret, kind: "reference", service: EXN, variable: "LIVE_AI_03B_EXECUTOR_ATTESTER_CHANNEL_SECRET" },
  { dest: RD.issuer, kind: "reference", service: DRN, variable: DA.issuer },
  { dest: RD.publicKeyDerB64, kind: "reference", service: DRN, variable: DP.publicKeyDerB64 },
  { dest: RD.fingerprint, kind: "reference", service: DRN, variable: DP.fingerprint },
  { dest: RD.host, kind: "reference", service: DRN, variable: "RAILWAY_PRIVATE_DOMAIN" },
  { dest: RD.port, kind: "reference", service: DRN, variable: DA.port },
  { dest: RD.channelSecret, kind: "reference", service: DRN, variable: DA.channelSecret },
  { dest: AUTHORITY_ANCHOR_ENV, kind: "reference", service: M5N, variable: DA.anchorJson },
].map(Object.freeze));

/** B. Dedicated reader-attester plan (destination on the NEW service). Values of `generated-*` are produced in memory in P3. */
export const DEDICATED_PLAN = Object.freeze([
  { dest: DA.observerDbUrl, kind: "reference", service: M5N, variable: DA.observerDbUrl, note: "reuse the accepted least-privilege observer credential (custody by reference; no new role/password)" },
  { dest: DA.anchorJson, kind: "reference", service: M5N, variable: DA.anchorJson, note: "reuse the accepted AI-STAGING AiStagingDeploymentAnchorV1 (binds cluster, not attester service)" },
  { dest: DA.readerServiceName, kind: "reference", service: AUN, variable: "RAILWAY_PRIVATE_DOMAIN", note: "SOLE peer = the Authority's private service name" },
  { dest: DA.signingKeyPkcs8B64, kind: "generated-secret", note: "NEW distinct Ed25519 signing key (P3, in memory, stdin only)" },
  { dest: DA.channelSecret, kind: "generated-secret", note: "NEW distinct v2 channel secret (P3, in memory, stdin only)" },
  { dest: DP.publicKeyDerB64, kind: "generated-public", note: "public SPKI DER of the new key (non-secret custody for the Authority)" },
  { dest: DP.fingerprint, kind: "generated-public", note: "sha256 fingerprint of the new public key (non-secret)" },
  { dest: DA.issuer, kind: "literal", value: DEDICATED_READER_ATTESTER_ISSUER },
  { dest: DA.bindHost, kind: "literal", value: DEDICATED_READER_ATTESTER_BIND_HOST },
  { dest: DA.port, kind: "literal", value: DEDICATED_READER_ATTESTER_PORT },
  { dest: DA.aiStagingProjectId, kind: "literal", value: TARGET.projectId },
  { dest: DA.aiStagingEnvironmentId, kind: "literal", value: TARGET.environmentId },
  { dest: DA.aiStagingPgServiceId, kind: "literal", value: TARGET.postgresServiceId },
].map(Object.freeze));

const forbiddenName = (n) => STEP67_FORBIDDEN_ENV_NAMES.includes(n) || STEP67_FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n));

/** Static validation of both plans. Returns { ok:true } or { ok:false, reason }. */
export function validatePlans(authorityPlan = AUTHORITY_PLAN, dedicatedPlan = DEDICATED_PLAN) {
  const plainSources = new Map();   // service → set of names that are stored plain (not references) on that service
  const dedPlain = new Set(dedicatedPlan.filter((e) => e.kind !== "reference").map((e) => e.dest));
  plainSources.set(DRN, dedPlain);
  const destA = new Set();
  for (const e of authorityPlan) {
    if (destA.has(e.dest)) return { ok: false, reason: "authority_duplicate_destination" };
    destA.add(e.dest);
    if (forbiddenName(e.dest)) return { ok: false, reason: "authority_forbidden_destination:" + e.dest };
    if (e.kind === "existing") continue;
    if (e.kind !== "reference") return { ok: false, reason: "authority_non_reference_entry:" + e.dest };
    if (forbiddenName(e.variable)) return { ok: false, reason: "authority_references_forbidden_source:" + e.variable };
    if (![EXN, DRN, M5N].includes(e.service)) return { ok: false, reason: "authority_unexpected_source_service:" + e.service };
    if (e.service === M5N && e.variable !== DA.anchorJson) return { ok: false, reason: "authority_m5_reference_not_anchor" };
    if (e.service === DRN && !RAILWAY_PROVIDED.includes(e.variable) && !dedPlain.has(e.variable)) return { ok: false, reason: "authority_reference_chain_or_unknown:" + e.variable };
  }
  if (destA.size !== 15) return { ok: false, reason: "authority_plan_size_not_15" };
  const destD = new Set();
  for (const e of dedicatedPlan) {
    if (destD.has(e.dest)) return { ok: false, reason: "dedicated_duplicate_destination" };
    destD.add(e.dest);
    if (e.kind === "reference") {
      if (e.service === M5N && ![DA.observerDbUrl, DA.anchorJson].includes(e.variable)) return { ok: false, reason: "dedicated_unexpected_m5_reference:" + e.variable };
      if (e.service === M5N && e.variable === DA.signingKeyPkcs8B64) return { ok: false, reason: "dedicated_shares_m5_signing_key" };
      if (e.service === M5N && e.variable === DA.channelSecret) return { ok: false, reason: "dedicated_shares_m5_channel_secret" };
      if (e.service === AUN && e.variable !== "RAILWAY_PRIVATE_DOMAIN") return { ok: false, reason: "dedicated_unexpected_authority_reference" };
      if (![M5N, AUN].includes(e.service)) return { ok: false, reason: "dedicated_unexpected_source_service" };
    } else if (!["generated-secret", "generated-public", "literal"].includes(e.kind)) return { ok: false, reason: "dedicated_unknown_kind" };
  }
  for (const n of Object.values(DA)) if (n !== DA.clockStatementTimeoutMs && !destD.has(n)) return { ok: false, reason: "dedicated_plan_missing_required:" + n };
  if (dedicatedPlan.find((e) => e.dest === DA.signingKeyPkcs8B64).kind !== "generated-secret") return { ok: false, reason: "dedicated_signing_key_not_generated" };
  if (dedicatedPlan.find((e) => e.dest === DA.channelSecret).kind !== "generated-secret") return { ok: false, reason: "dedicated_channel_secret_not_generated" };
  return { ok: true };
}

/** The exact stdin VALUE the controller stages for each NEW Authority destination (a reference expression, never a resolved value). */
export function authorityWrites(plan = AUTHORITY_PLAN) {
  return plan.filter((e) => e.kind === "reference").map((e) => Object.freeze({ name: e.dest, stdinValue: ref(e.service, e.variable), class: "reference_expression" }));
}

/**
 * TEST/REVIEW ONLY: simulate Railway reference resolution (single level, exactly like the plans require) from a map
 * { "<service>": { VAR: value } }. Used to prove the resolved Authority/dedicated environments satisfy the ACCEPTED loaders.
 */
export function simulateResolution(plan, sourceValues, literalValues = {}) {
  const env = {};
  for (const e of plan) {
    if (e.kind === "existing") { env[e.dest] = (literalValues[e.dest] !== undefined) ? literalValues[e.dest] : undefined; continue; }
    if (e.kind === "reference") {
      const v = sourceValues[e.service] ? sourceValues[e.service][e.variable] : undefined;
      if (typeof v === "string" && parseReference(v)) throw new Error("reference_chain_detected");
      env[e.dest] = v;
    } else if (e.kind === "literal") env[e.dest] = e.value;
    else env[e.dest] = literalValues[e.dest];
  }
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}
