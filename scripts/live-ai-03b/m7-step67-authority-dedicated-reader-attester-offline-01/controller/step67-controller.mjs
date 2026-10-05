#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — Owner-Mac phase controller (FUTURE USE ONLY). OFFLINE candidate.
//
// One phase per invocation. DRY-RUN BY DEFAULT: a dry run makes ZERO runner calls and prints the exact plan
// (argv lists; stdin values are shown only as their class, never their content). `--execute` additionally
// requires, for every phase that needs Owner authorization:
//   --owner-authorization-ref <REF>      a non-secret label of the fresh, exact Owner authorization for THIS phase
//   --confirm-action-id <ACTION_ID>      must equal the phase's canonical actionId
//   --collision-guard-result <file>      a Programme Collision Guard V1 result for THIS actionId, outcome CLEAR
//                                        (CLEAR is NOT authorization; it is only a precondition)
// Every executed phase: refuses unless the previous phase receipt is PASS; creates PX.attempt-started with O_EXCL
// BEFORE its first external call (a prior marker ⇒ refuse, NO auto-retry); writes PX.receipt.json exactly once.
// The runner is spawn(…, { shell:false }) with an allowlisted environment. Railway stdout of a `variable set` is
// DISCARDED (never parsed, printed or stored). Values travel on stdin only. No `railway variables` listing, no
// delete, no domain/proxy, no `railway run/up/connect`, no SQL, no Railway MCP, no CORE-PROD.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { SERVICES, TARGET, AUTHORITY_VERIFY_COMMAND_PATH, AUTHORITY_PEER_IDENTITY_COMMAND_PATH, DB_ENV,
  STEP67_FORBIDDEN_ENV_NAMES, STEP67_FORBIDDEN_ENV_PATTERNS, SUCCESS_MARKER } from "../src/constants.mjs";
import { assertReceiptSafe, holdMarker } from "../src/receipt.mjs";
import { beginOwnerAttempt, writeOwnerReceiptOnce, isValidRunId } from "../src/one-shot-guard.mjs";
import { ARGV } from "./railway-argv.mjs";
import { buildNamesOnlyDocument, isNamesOnlyDocument, parseNamesOnlyState, commitOf, deploymentIdOf, isPrivateOnly, frozenSnapshotOf } from "./names-only-state.mjs";
import { DEDICATED_PLAN, AUTHORITY_PLAN, authorityWrites } from "./reference-plan.mjs";
import { DEDICATED_SERVICE_SPEC, AUTHORITY_SERVICE_SPEC, compareServiceInstance } from "./dedicated-service-spec.mjs";
import { generateDedicatedIdentity, dedicatedWrites } from "./dedicated-attester-provisioning.mjs";
import { phaseOf, previousPhase, EXECUTOR_PEER_CIDRS_ENV } from "./future-live-phase-plan.mjs";
import { resolvePeerAllowlist } from "../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs";
import { EXPECTED_AUTHORITY_PRIVATE_DOMAIN } from "../src/authority-peer-identity.mjs";

export const CONTROLLER_VERSION = "m7-step67-controller-v1";
export const PHASE_RECEIPT_SCHEMA = "staybid-m7-step67-controller-phase-receipt-v1";
const COLLISION_RESULT_SCHEMA = "staybid-programme-collision-check-result-v1";
const AUTH_REF = /^[A-Z0-9][A-Z0-9_.:-]{2,159}$/;
const HEX64 = /^[0-9a-f]{64}$/, HEX40 = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SPAWN_ENV_ALLOWLIST = Object.freeze(["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "TMPDIR", "XDG_CONFIG_HOME"]);
const forbiddenName = (n) => STEP67_FORBIDDEN_ENV_NAMES.includes(n) || STEP67_FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** Production runner: no shell, allowlisted env, stdin piped (value never in argv), outputs captured (never echoed). */
export function makeSpawnRunner({ env = process.env, timeoutMs = 600000 } = {}) {
  const childEnv = {};
  for (const k of SPAWN_ENV_ALLOWLIST) if (typeof env[k] === "string") childEnv[k] = env[k];
  return Object.freeze({
    run(bin, argv, { stdin = null } = {}) {
      if (!["railway", "git"].includes(bin)) return Promise.reject(new Error("binary_not_permitted"));
      return new Promise((res) => {
        let out = "", err = "", done = false;
        const ch = spawn(bin, argv, { shell: false, env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
        const t = setTimeout(() => { if (!done) { try { ch.kill("SIGTERM"); } catch {} } }, timeoutMs);
        ch.stdout.on("data", (d) => { if (out.length < 4 * 1024 * 1024) out += d; });
        ch.stderr.on("data", (d) => { if (err.length < 65536) err += d; });
        ch.on("error", () => { done = true; clearTimeout(t); res({ code: 127, stdout: "", stderr: "" }); });
        ch.on("close", (code) => { done = true; clearTimeout(t); res({ code: code === null ? 128 : code, stdout: out, stderr: err }); });
        if (stdin !== null) ch.stdin.end(stdin); else ch.stdin.end();
      });
    },
  });
}

const fail = (reason, facts = {}) => ({ ok: false, reason, facts });
function readJsonFile(path, max = 262144) {
  try { const st = lstatSync(path); if (!st.isFile() || st.isSymbolicLink() || st.size > max) return null; return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
function priorReceipt(stateDir, phase) { return readJsonFile(join(stateDir, phase + ".receipt.json")); }

/** Validate a Collision Guard V1 result for the phase (structure + CLEAR + exact actionId). Never treated as authorization. */
export function checkCollisionResult(obj, actionId) {
  if (!obj || obj.schema !== COLLISION_RESULT_SCHEMA) return fail("collision_result_schema");
  if (obj.outcome !== "CLEAR_OF_RECORDED_COLLISION" || obj.decision !== "CLEAR_OF_RECORDED_COLLISION_ONLY") return fail("collision_result_not_clear");
  if (!obj.candidate || obj.candidate.actionId !== actionId) return fail("collision_result_action_mismatch");
  if (obj.liveAuthorization !== "LIVE_AUTHORIZATION_NOT_GRANTED_BY_COLLISION_GUARD") return fail("collision_result_authorization_statement_missing");
  return { ok: true };
}

/** Pure option validation + gate evaluation (no I/O except reading the prior receipt / collision file). */
export function evaluateGates(o) {
  const p = phaseOf(o.phase);
  if (!p) return fail("phase_unknown");
  if (!isValidRunId(o.runId)) return fail("run_id_invalid");
  if (typeof o.stateDir !== "string" || !o.stateDir) return fail("state_dir_required");
  const prev = previousPhase(p.phase);
  if (prev) {
    const r = priorReceipt(o.stateDir, prev);
    if (!r || r.schema !== PHASE_RECEIPT_SCHEMA || r.phase !== prev) return fail("previous_phase_receipt_absent:" + prev);
    if (p.phase === "P9" ? !["PASS", "HOLD"].includes(r.outcome) : r.outcome !== "PASS") return fail("previous_phase_not_pass:" + prev);
  }
  if (!o.execute) return { ok: true, phase: p, dryRun: true };
  if (p.requiresOwnerAuthorization) {
    if (!AUTH_REF.test(o.ownerAuthorizationRef || "")) return fail("owner_authorization_ref_required");
    if (o.confirmActionId !== p.actionId) return fail("confirm_action_id_mismatch");
    const c = checkCollisionResult(o.collisionGuardResultPath ? readJsonFile(o.collisionGuardResultPath, 65536) : null, p.actionId);
    if (!c.ok) return c;
  }
  return { ok: true, phase: p, dryRun: false };
}

/** Names-only state fetch (document written to the state dir; non-secret by construction). */
async function fetchState(ctx, phase, dedicatedServiceId) {
  const doc = buildNamesOnlyDocument({ dedicatedServiceId });
  if (!isNamesOnlyDocument(doc)) return fail("names_only_document_refused");
  const docPath = join(ctx.stateDir, phase + ".state.graphql");
  try { writeFileSync(docPath, doc + "\n", { mode: 0o600 }); } catch { return fail("state_document_write_failed"); }
  const r = await ctx.runner.run("railway", ARGV.namesOnlyState(docPath).argv);
  if (r.code !== 0) return fail("names_only_state_cli_failed");
  const s = parseNamesOnlyState(r.stdout);
  return s.ok ? s : fail(s.reason);
}
const m5Snapshot = (snap) => ({ m5ReaderAttester: frozenSnapshotOf(snap, "m5ReaderAttester", SERVICES.m5ReaderAttester.id),
  m5ReaderHost: frozenSnapshotOf(snap, "m5ReaderHost", SERVICES.m5ReaderHost.id) });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function m5Unchanged(ctx, snap) {
  const p0 = priorReceipt(ctx.stateDir, "P0");
  if (!p0 || !p0.facts || !p0.facts.m5) return false;
  return sameJson(m5Snapshot(snap), p0.facts.m5);
}
const receiptFacts = (ctx, phase) => { const r = priorReceipt(ctx.stateDir, phase); return r && r.facts ? r.facts : {}; };

/** Phase bodies. Each returns { ok, reason?, facts }. All external calls go through ctx.runner. */
const BODY = {
  async P0(ctx) {
    const v = await ctx.runner.run("railway", ARGV.version().argv); if (v.code !== 0) return fail("railway_cli_unavailable");
    const w = await ctx.runner.run("railway", ARGV.whoami().argv); if (w.code !== 0) return fail("railway_not_authenticated");
    const s = await fetchState(ctx, "P0", null); if (!s.ok) return s;
    const snap = s.snapshot;
    for (const a of ["authority", "executorAttester", "m5ReaderAttester", "m5ReaderHost"]) if (!snap.inst[a] || !snap.inst[a].si) return fail("service_instance_absent:" + a);
    for (const a of ["authority", "executorAttester", "m5ReaderAttester", "m5ReaderHost"]) if (!isPrivateOnly(snap.inst[a])) return fail("not_private_only:" + a);
    if (commitOf(snap.inst.executorAttester.si) !== SERVICES.executorAttester.sourceCommit) return fail("executor_attester_commit_not_pinned");
    if (deploymentIdOf(snap.inst.executorAttester.si) !== SERVICES.executorAttester.deploymentId) return fail("executor_attester_deployment_not_pinned");
    if (deploymentIdOf(snap.inst.m5ReaderAttester.si) !== SERVICES.m5ReaderAttester.deploymentId) return fail("m5_reader_attester_deployment_not_pinned");
    if (snap.services.some((x) => x.name === SERVICES.dedicatedReaderAttester.name)) return fail("dedicated_service_already_exists_reconcile");
    const an = snap.namesBy[SERVICES.authority.id] || [];
    if (!an.includes(DB_ENV.executorDbUrl) || !an.includes(DB_ENV.readerDbUrl)) return fail("authority_db_references_absent");
    if (an.some(forbiddenName)) return fail("authority_holds_forbidden_name");
    if (AUTHORITY_PLAN.some((e) => e.kind === "reference" && an.includes(e.dest))) return fail("authority_step67_names_already_present_reconcile");
    return { ok: true, facts: { m5: m5Snapshot(snap), executorAttester: { deploymentId: deploymentIdOf(snap.inst.executorAttester.si), sourceCommitPin: commitOf(snap.inst.executorAttester.si) },
      authorityDeploymentId: deploymentIdOf(snap.inst.authority.si), authorityVariableNames: an, schemaCapability: "names_only_fields_present" } };
  },
  async P1(ctx) {
    const o = ctx.opts;
    if (!HEX40.test(o.reviewedCommit || "")) return fail("reviewed_commit_required");
    if (!HEX64.test(o.manifestSha256 || "")) return fail("manifest_sha256_required");
    const mPath = join(ctx.packageRoot, "EVIDENCE-MANIFEST.json");
    let mText; try { mText = readFileSync(mPath); } catch { return fail("manifest_absent"); }
    if (sha256(mText) !== o.manifestSha256) return fail("manifest_sha256_mismatch");
    const m = JSON.parse(mText.toString("utf8"));
    const files = (m.files || []).filter((f) => f.repoPath && f.gitBlobSha1);
    if (!files.length) return fail("manifest_without_git_blobs");
    const e = await ctx.runner.run("git", ["cat-file", "-e", o.reviewedCommit + "^{commit}"]); if (e.code !== 0) return fail("reviewed_commit_absent_locally");
    const ls = await ctx.runner.run("git", ["ls-tree", "-r", "--full-tree", o.reviewedCommit, "--", ...Array.from(new Set(files.map((f) => f.repoPath)))]);
    if (ls.code !== 0) return fail("git_ls_tree_failed");
    const blobs = new Map();
    for (const line of ls.stdout.split("\n")) { const mm = /^\d{6} blob ([0-9a-f]{40})\t(.+)$/.exec(line); if (mm) blobs.set(mm[2], mm[1]); }
    for (const f of files) if (blobs.get(f.repoPath) !== f.gitBlobSha1) return fail("blob_mismatch_at_reviewed_commit");
    return { ok: true, facts: { reviewedGitCommit: o.reviewedCommit, manifestSha256: o.manifestSha256, filesVerified: files.length } };
  },
  async P2(ctx) {
    const id = ctx.opts.dedicatedServiceId; if (!UUID.test(id || "")) return fail("dedicated_service_id_required");
    if (Object.values(SERVICES).some((x) => x.id === id) || id === TARGET.postgresServiceId) return fail("dedicated_service_id_collides_with_pinned_service");
    const s = await fetchState(ctx, "P2", id); if (!s.ok) return s;
    const snap = s.snapshot;
    const svc = snap.services.filter((x) => x.name === SERVICES.dedicatedReaderAttester.name);
    if (svc.length !== 1 || svc[0].id !== id) return fail("dedicated_service_identity_mismatch");
    const bad = compareServiceInstance(snap.inst.dedicated && snap.inst.dedicated.si, DEDICATED_SERVICE_SPEC, { expectDeployed: false });
    if (bad.length) return fail("dedicated_service_spec_mismatch:" + bad[0]);
    if (snap.inst.dedicated.si.latestDeployment) return fail("dedicated_service_already_deployed");
    if (!isPrivateOnly(snap.inst.dedicated)) return fail("dedicated_service_not_private_only");
    if ((snap.namesBy[id] || []).length !== 0) return fail("dedicated_service_has_variables");
    if (!m5Unchanged(ctx, snap)) return fail("m5_snapshot_changed");
    return { ok: true, facts: { dedicatedServiceId: id } };
  },
  async P3(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId; if (!UUID.test(id || "")) return fail("p2_dedicated_service_id_absent");
    const { m5ReaderAttesterFingerprint: m5fp, executorAttesterFingerprint: exfp } = ctx.opts;
    if (!HEX64.test(m5fp || "") || !HEX64.test(exfp || "")) return fail("public_fingerprint_pins_required");
    const s = await fetchState(ctx, "P3", id); if (!s.ok) return s;
    if ((s.snapshot.namesBy[id] || []).length !== 0) return fail("dedicated_service_has_variables");
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    const g = generateDedicatedIdentity({ forbiddenFingerprints: [m5fp, exfp] }); if (!g.ok) return fail(g.reason);
    const w = dedicatedWrites(g.identity); if (!w.ok) return fail(w.reason);
    const written = [];
    for (const x of w.writes) {
      const r = await ctx.runner.run("railway", ARGV.variableSet(id, x.name).argv, { stdin: x.stdinValue });   // stdout discarded
      if (r.code !== 0) return fail("variable_set_failed_partial_state_ambiguous", { variableNamesWritten: written });
      written.push(x.name);
    }
    const post = await fetchState(ctx, "P3post", id); if (!post.ok) return fail("post_state_unavailable_ambiguous", { variableNamesWritten: written });
    const want = DEDICATED_PLAN.map((e) => e.dest).sort();
    if (!sameJson(post.snapshot.namesBy[id] || [], want)) return fail("dedicated_variable_names_mismatch_after_write", { variableNamesWritten: written });
    return { ok: true, facts: { dedicatedServiceId: id, issuer: g.identity.issuer, expectedReaderAttesterFingerprint: g.identity.fingerprint,
      forbiddenReaderAttesterFingerprint: m5fp, expectedExecutorAttesterFingerprint: exfp, variableNamesWritten: written } };
  },
  async P4(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId;
    const s = await fetchState(ctx, "P4", id); if (!s.ok) return s;
    const an = s.snapshot.namesBy[SERVICES.authority.id] || [];
    if (!an.includes(DB_ENV.executorDbUrl) || !an.includes(DB_ENV.readerDbUrl)) return fail("authority_db_references_absent");
    if (an.some(forbiddenName)) return fail("authority_holds_forbidden_name");
    const writes = authorityWrites();
    if (writes.some((x) => an.includes(x.name))) return fail("authority_step67_names_already_present_reconcile");
    if (!sameJson(s.snapshot.namesBy[id] || [], DEDICATED_PLAN.map((e) => e.dest).sort())) return fail("dedicated_variables_not_as_p3");
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    const written = [];
    for (const x of writes) {
      const r = await ctx.runner.run("railway", ARGV.variableSet(SERVICES.authority.id, x.name).argv, { stdin: x.stdinValue });
      if (r.code !== 0) return fail("variable_set_failed_partial_state_ambiguous", { variableNamesWritten: written });
      written.push(x.name);
    }
    const post = await fetchState(ctx, "P4post", id); if (!post.ok) return fail("post_state_unavailable_ambiguous", { variableNamesWritten: written });
    const pn = post.snapshot.namesBy[SERVICES.authority.id] || [];
    if (!AUTHORITY_PLAN.every((e) => pn.includes(e.dest)) || pn.some(forbiddenName)) return fail("authority_names_mismatch_after_write", { variableNamesWritten: written });
    return { ok: true, facts: { variableNamesWritten: written } };
  },
  async P5(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId;
    const s = await fetchState(ctx, "P5", id); if (!s.ok) return s;
    const a = s.snapshot.inst.authority;
    const bad = compareServiceInstance(a && a.si, AUTHORITY_SERVICE_SPEC, { expectDeployed: true });
    if (bad.length) return fail("authority_spec_mismatch:" + bad[0]);
    if (!isPrivateOnly(a)) return fail("authority_not_private_only");
    if (commitOf(a.si) !== receiptFacts(ctx, "P1").reviewedGitCommit) return fail("authority_commit_not_reviewed_commit");
    if (deploymentIdOf(a.si) === receiptFacts(ctx, "P0").authorityDeploymentId) return fail("authority_not_redeployed_in_p5");
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    return { ok: true, facts: { authorityDeploymentId: deploymentIdOf(a.si) } };
  },
  async P6(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId;
    const s = await fetchState(ctx, "P6", id); if (!s.ok) return s;
    if (deploymentIdOf(s.snapshot.inst.authority.si) !== receiptFacts(ctx, "P5").authorityDeploymentId) return fail("authority_redeployed_since_p5");
    const d = s.snapshot.inst.dedicated;
    const bad = compareServiceInstance(d && d.si, DEDICATED_SERVICE_SPEC, { expectDeployed: true });
    if (bad.length) return fail("dedicated_spec_mismatch:" + bad[0]);
    if (!isPrivateOnly(d)) return fail("dedicated_not_private_only");
    if (commitOf(d.si) !== receiptFacts(ctx, "P1").reviewedGitCommit) return fail("dedicated_commit_not_reviewed_commit");
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    return { ok: true, facts: { dedicatedDeploymentId: deploymentIdOf(d.si) } };
  },
  async P7(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId;
    const s = await fetchState(ctx, "P7", id); if (!s.ok) return s;
    if (deploymentIdOf(s.snapshot.inst.authority.si) !== receiptFacts(ctx, "P5").authorityDeploymentId) return fail("authority_redeployed_since_p5");
    if (deploymentIdOf(s.snapshot.inst.dedicated.si) !== receiptFacts(ctx, "P6").dedicatedDeploymentId) return fail("dedicated_redeployed_since_p6");
    const exBefore = s.snapshot.inst.executorAttester.si;
    if (commitOf(exBefore) !== SERVICES.executorAttester.sourceCommit) return fail("executor_attester_commit_not_pinned");
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    const pr = await ctx.runner.run("railway", ARGV.sshAuthorityNode(AUTHORITY_PEER_IDENTITY_COMMAND_PATH).argv);
    const lines = (pr.stdout || "").split("\n").filter((l) => l.startsWith("STEP67_AUTHORITY_PEER_IDENTITY "));
    if (pr.code !== 0 || lines.length !== 1) return fail("authority_peer_identity_unavailable");
    let rep; try { rep = JSON.parse(lines[0].slice("STEP67_AUTHORITY_PEER_IDENTITY ".length)); } catch { return fail("authority_peer_identity_unparseable"); }
    if (!rep || rep.ok !== true || rep.serviceName !== EXPECTED_AUTHORITY_PRIVATE_DOMAIN || !Array.isArray(rep.cidrs)) return fail("authority_peer_identity_refused");
    // re-validate with the ACCEPTED resolver (exact host, private, ≤4, no loopback/public/unspecified)
    const again = await resolvePeerAllowlist({ serviceName: EXPECTED_AUTHORITY_PRIVATE_DOMAIN,
      resolver: async () => rep.cidrs.map((c) => { const m = /^(.+)\/(32|128)$/.exec(String(c)); return { address: m ? m[1] : "invalid" }; }) });
    if (!again.ok || !sameJson(again.cidrs, rep.cidrs.slice().sort())) return fail("authority_peer_cidrs_not_exact_private_hosts");
    const sr = await ctx.runner.run("railway", ARGV.variableSet(SERVICES.executorAttester.id, EXECUTOR_PEER_CIDRS_ENV).argv, { stdin: again.cidrs.join(",") });
    if (sr.code !== 0) return fail("executor_peer_cidrs_set_failed_ambiguous");
    const rd = await ctx.runner.run("railway", ARGV.redeploy(SERVICES.executorAttester.id).argv);
    if (rd.code !== 0) return fail("executor_attester_redeploy_failed_ambiguous", { peerCidrsStaged: true });
    let after = null;
    for (let i = 0; i < ctx.pollAttempts; i++) {
      await ctx.wait(ctx.pollIntervalMs);
      const st = await fetchState(ctx, "P7poll", id); if (!st.ok) continue;
      const si = st.snapshot.inst.executorAttester.si;
      if (deploymentIdOf(si) !== deploymentIdOf(exBefore) && si.latestDeployment && ["SUCCESS", "FAILED", "CRASHED"].includes(si.latestDeployment.status)) { after = st.snapshot; break; }
    }
    if (!after) return fail("executor_attester_redeploy_not_observed_ambiguous", { peerCidrsStaged: true });
    const si = after.inst.executorAttester.si;
    if (si.latestDeployment.status !== "SUCCESS") return fail("executor_attester_redeploy_not_success");
    if (commitOf(si) !== SERVICES.executorAttester.sourceCommit) return fail("executor_attester_commit_changed");
    if (!isPrivateOnly(after.inst.executorAttester)) return fail("executor_attester_not_private_only");
    if (deploymentIdOf(after.inst.authority.si) !== receiptFacts(ctx, "P5").authorityDeploymentId) return fail("authority_redeployed_during_p7");
    return { ok: true, facts: { peerHosts: again.addresses.map((a) => ({ address: a.address, type: a.type })), executorAttesterDeploymentId: deploymentIdOf(si),
      sourceCommitPin: commitOf(si) } };
  },
  async P8(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId, p3 = receiptFacts(ctx, "P3");
    const pins = { expectedExecutorAttesterFingerprint: p3.expectedExecutorAttesterFingerprint, expectedReaderAttesterFingerprint: p3.expectedReaderAttesterFingerprint,
      forbiddenReaderAttesterFingerprint: p3.forbiddenReaderAttesterFingerprint };
    if (!Object.values(pins).every((x) => HEX64.test(x || ""))) return fail("p3_public_pins_absent");
    const s = await fetchState(ctx, "P8", id); if (!s.ok) return s;
    if (deploymentIdOf(s.snapshot.inst.authority.si) !== receiptFacts(ctx, "P5").authorityDeploymentId) return fail("authority_redeployed_since_p5");
    if (deploymentIdOf(s.snapshot.inst.dedicated.si) !== receiptFacts(ctx, "P6").dedicatedDeploymentId) return fail("dedicated_redeployed_since_p6");
    if (deploymentIdOf(s.snapshot.inst.executorAttester.si) !== receiptFacts(ctx, "P7").executorAttesterDeploymentId) return fail("executor_attester_redeployed_since_p7");
    const argv = ["--run-id", ctx.opts.runId, "--expected-executor-attester-fingerprint", pins.expectedExecutorAttesterFingerprint,
      "--expected-reader-attester-fingerprint", pins.expectedReaderAttesterFingerprint, "--forbidden-reader-attester-fingerprint", pins.forbiddenReaderAttesterFingerprint];
    const r = await ctx.runner.run("railway", ARGV.sshAuthorityNode(AUTHORITY_VERIFY_COMMAND_PATH, argv).argv);
    const lines = (r.stdout || "").split("\n").filter((l) => l.startsWith("STEP67_RECEIPT "));
    if (lines.length !== 1) return fail("step67_receipt_absent_or_ambiguous_no_retry");
    let rec; try { rec = JSON.parse(lines[0].slice("STEP67_RECEIPT ".length)); } catch { return fail("step67_receipt_unparseable_no_retry"); }
    const safe = assertReceiptSafe(rec); if (!safe.ok) return fail("step67_receipt_unsafe_no_retry");
    if (rec.runId !== ctx.opts.runId || !sameJson(rec.pins, pins)) return fail("step67_receipt_binding_mismatch");
    const pass = rec.outcome === "PASS" && rec.marker === SUCCESS_MARKER && r.code === 0;
    if (!pass && (rec.outcome === "PASS" || r.code === 0)) return fail("step67_receipt_exit_code_inconsistent");
    const post = await fetchState(ctx, "P8post", id);
    const stable = post.ok && deploymentIdOf(post.snapshot.inst.authority.si) === receiptFacts(ctx, "P5").authorityDeploymentId;
    if (!stable) return fail("authority_deployment_changed_during_p8_ambiguous", { step67Receipt: rec });
    return pass ? { ok: true, facts: { step67Receipt: rec } } : fail("step67_hold:" + String(rec.reason || "unknown").slice(0, 60), { step67Receipt: rec });
  },
  async P9(ctx) {
    const id = receiptFacts(ctx, "P2").dedicatedServiceId;
    const s = await fetchState(ctx, "P9", id); if (!s.ok) return s;
    if (!m5Unchanged(ctx, s.snapshot)) return fail("m5_snapshot_changed");
    for (const a of ["authority", "executorAttester", "m5ReaderAttester", "m5ReaderHost", "dedicated"]) if (!isPrivateOnly(s.snapshot.inst[a])) return fail("not_private_only:" + a);
    if ((s.snapshot.namesBy[SERVICES.authority.id] || []).some(forbiddenName)) return fail("authority_holds_forbidden_name");
    return { ok: true, facts: { m5Unchanged: true, privateOnly: true } };
  },
};

/** Dry-run plan text (no runner call). stdin values are rendered as their CLASS only. */
export function dryRunPlan(phase) {
  const lines = [`DRY-RUN ${phase.phase} ${phase.actionId} (${phase.mutationClass}) — NO external call made`, `  ${phase.title}`];
  for (const p of phase.preconditions) lines.push("  precondition: " + p);
  if (phase.phase === "P3") for (const e of DEDICATED_PLAN) lines.push(`  railway variable set ${e.dest} --stdin --skip-deploys --service <P2 dedicated id> …  stdin=<${e.kind}>`);
  if (phase.phase === "P4") for (const w of authorityWrites()) lines.push(`  railway ${ARGV.variableSet(SERVICES.authority.id, w.name).argv.join(" ")}  stdin=<reference expression>`);
  if (phase.phase === "P7") lines.push(`  railway ${ARGV.sshAuthorityNode(AUTHORITY_PEER_IDENTITY_COMMAND_PATH).argv.join(" ")}`,
    `  railway ${ARGV.variableSet(SERVICES.executorAttester.id, EXECUTOR_PEER_CIDRS_ENV).argv.join(" ")}  stdin=<literal exact-host CIDRs>`,
    `  railway ${ARGV.redeploy(SERVICES.executorAttester.id).argv.join(" ")}`);
  if (phase.phase === "P8") lines.push(`  railway ssh … -s ${SERVICES.authority.id} -- node ${AUTHORITY_VERIFY_COMMAND_PATH} --run-id <id> <3 public fingerprint pins from P3>`);
  return lines.join("\n");
}

/** Run one phase. Returns { exit, receipt?, text }. */
export async function runPhase(opts, { runner, packageRoot, wait = (ms) => new Promise((r) => setTimeout(r, ms)), pollAttempts = 40, pollIntervalMs = 15000, now = () => new Date().toISOString() } = {}) {
  const g = evaluateGates(opts);
  if (!g.ok) return { exit: 3, text: holdMarker("GATE_" + g.reason) };
  if (g.dryRun) return { exit: 0, text: dryRunPlan(g.phase) };
  const p = g.phase;
  const att = beginOwnerAttempt(opts.stateDir, p.phase, opts.runId);
  if (!att.ok) return { exit: 3, text: holdMarker("ONE_SHOT_" + att.reason) };
  const ctx = { opts, stateDir: opts.stateDir, runner, packageRoot, wait, pollAttempts, pollIntervalMs };
  const startedUtc = now();
  let r;
  try { r = await BODY[p.phase](ctx); } catch { r = fail("controller_unexpected_failure_ambiguous"); }
  const receipt = { schema: PHASE_RECEIPT_SCHEMA, version: CONTROLLER_VERSION, phase: p.phase, actionId: p.actionId, mutationClass: p.mutationClass, runId: opts.runId,
    startedUtc, finishedUtc: now(), ownerAuthorizationRef: p.requiresOwnerAuthorization ? opts.ownerAuthorizationRef : null,
    collisionGuardOutcome: p.requiresOwnerAuthorization ? "CLEAR_OF_RECORDED_COLLISION" : null,
    outcome: r.ok ? "PASS" : "HOLD", reason: r.ok ? null : String(r.reason).replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120), facts: r.facts || {},
    marker: r.ok ? `M7_STEP6_7_CONTROLLER_${p.phase}_PASS` : holdMarker(p.phase + "_" + r.reason), liveAuthorization: "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION" };
  const safe = assertReceiptSafe(receipt);
  const text = safe.ok ? JSON.stringify(receipt) : JSON.stringify({ schema: PHASE_RECEIPT_SCHEMA, phase: p.phase, actionId: p.actionId, runId: opts.runId, outcome: "HOLD",
    reason: "receipt_refused_unsafe", facts: {}, marker: holdMarker(p.phase + "_RECEIPT_REFUSED_UNSAFE"), liveAuthorization: "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION" });
  const w = writeOwnerReceiptOnce(opts.stateDir, p.phase, text);
  if (!w.ok) return { exit: 3, text: holdMarker("RECEIPT_" + w.reason) };
  return { exit: r.ok && safe.ok ? 0 : 3, receipt: JSON.parse(text), text };
}

const FLAG = Object.freeze({ "--phase": "phase", "--state-dir": "stateDir", "--run-id": "runId", "--owner-authorization-ref": "ownerAuthorizationRef",
  "--confirm-action-id": "confirmActionId", "--collision-guard-result": "collisionGuardResultPath", "--dedicated-service-id": "dedicatedServiceId",
  "--reviewed-commit": "reviewedCommit", "--manifest-sha256": "manifestSha256", "--m5-reader-attester-fingerprint": "m5ReaderAttesterFingerprint",
  "--executor-attester-fingerprint": "executorAttesterFingerprint" });
export function parseControllerArgs(argv) {
  const o = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") { o.execute = true; continue; }
    const k = FLAG[argv[i]]; const v = argv[i + 1];
    if (!k || typeof v !== "string" || v.startsWith("--") || o[k] !== undefined) return { ok: false, reason: "usage" };
    o[k] = v; i++;
  }
  return { ok: true, opts: o };
}
async function main() {
  try { process.umask(0o077); } catch {}
  const a = parseControllerArgs(process.argv.slice(2));
  if (!a.ok || !a.opts.phase || !a.opts.stateDir || !a.opts.runId) { process.stdout.write(holdMarker("USAGE") + "\n"); process.exitCode = 64; return; }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = await runPhase({ ...a.opts, stateDir: resolve(a.opts.stateDir) }, { runner: makeSpawnRunner(), packageRoot });
  process.stdout.write(r.text + "\n");
  process.exitCode = r.exit;
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
