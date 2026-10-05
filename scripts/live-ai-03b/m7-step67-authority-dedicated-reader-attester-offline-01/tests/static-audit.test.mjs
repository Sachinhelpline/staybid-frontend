// TEST-ONLY — static audits + predecessor byte-identity. OFFLINE.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, eq, ok, run } from "./_harness.mjs";
import { mutationAudit, secretLeakAudit, modelIdAudit } from "../tools/static-audit.mjs";
import { checkPredecessors } from "../tools/check-predecessors.mjs";
import { importClosure } from "../tools/import-closure.mjs";
import { assertReceiptSafe } from "../src/receipt.mjs";
import { REQUIRED_AUTHORITY_NAMES } from "../src/step67-config.mjs";
import { AUTHORITY_PLAN } from "../controller/reference-plan.mjs";
import { STEP67_FORBIDDEN_ENV_NAMES, STEP67_FORBIDDEN_ENV_PATTERNS, SERVICES } from "../src/constants.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const directImports = (p) => Array.from(read(p).matchAll(/from\s*["']([^"']+)["']/g)).map((m) => m[1]);
const runtimeFiles = () => ["src", "controller"].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".mjs")).map((f) => d + "/" + f));

test("S01", "mutation audit: no SQL literal, no activation/provisioning/Phase A/SQL03/gateway/provider routine, no v1 reader channel, no railway delete/list/run/up/domain/proxy", async () => {
  const f = mutationAudit(); eq(f.length, 0, JSON.stringify(f));
});
test("S02", "secret-leak audit: no key, PEM, JWT, cloud key, credentialed URL (outside *.example.test fixtures) or long base64 run in the package", async () => {
  const f = secretLeakAudit(); eq(f.length, 0, JSON.stringify(f));
});
test("S03", "no model identifier anywhere in the package", async () => { eq(modelIdAudit().length, 0); });
test("S04", "predecessor byte-identity: every accepted dependency equals the baseline blob; no tracked file modified", async () => {
  const r = checkPredecessors();
  eq(r.ok, true, JSON.stringify(r)); ok(r.checked >= 40, "closure size " + r.checked);
});
test("S05", "runtime import boundary: src/ + controller/ import no provisioner, provisioning entrypoint, guarded clients, or the v1 reader channel constructor", async () => {
  for (const p of runtimeFiles()) for (const s of directImports(p))
    ok(!/provisioner\.mjs|provisioning-offline-01\/src\/production-entrypoint|guarded-clients|gateway|provider/.test(s), p + " imports " + s);
  // the accepted v1 module may be used ONLY for its config validator + constant — never its channel constructor
  for (const p of runtimeFiles()) for (const m of read(p).matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*attestation-source-channel\.mjs["']/g))
    ok(m[1].split(",").map((x) => x.trim()).every((n) => ["validateAttesterChannelConfig", "MIN_CHANNEL_SECRET_LEN"].includes(n)), p + " v1 import " + m[1]);
  ok(importClosure().bareSpecifiers.every((s) => s.startsWith("node:") || s === "pg"), "only node built-ins + accepted pg");
});
test("S06", "entrypoints: canonical realpath main guard; standby + peer-identity import no DB, attester, socket or child-process module", async () => {
  for (const p of ["src/step67-verification-entrypoint.mjs", "src/authority-standby-entrypoint.mjs", "src/authority-peer-identity.mjs", "controller/step67-controller.mjs"])
    ok(/realpathSync\(fileURLToPath\(import\.meta\.url\)\) === realpathSync\(resolve\(process\.argv\[1\]\)\)/.test(read(p)), p);
  for (const p of ["src/authority-standby-entrypoint.mjs", "src/authority-peer-identity.mjs"])
    for (const s of directImports(p)) ok(!/node:net|node:child_process|reader-session|executor-session|attestation|pg$/.test(s), p + " imports " + s);
});
test("S07", "Authority secret custody: exactly the 15 caller names, none of a forbidden class (no signing key, observer credential, superuser)", async () => {
  eq(REQUIRED_AUTHORITY_NAMES.slice().sort().join(","), AUTHORITY_PLAN.map((e) => e.dest).sort().join(","));
  for (const n of REQUIRED_AUTHORITY_NAMES) ok(!STEP67_FORBIDDEN_ENV_NAMES.includes(n) && !STEP67_FORBIDDEN_ENV_PATTERNS.some((re) => re.test(n)), n);
});
test("S08", "M5 preservation: the M5 attester / reader-host ids appear ONLY as pins in constants.mjs (no write path names them)", async () => {
  for (const p of runtimeFiles()) {
    const t = read(p);
    if (p === "src/constants.mjs") continue;
    ok(!t.includes(SERVICES.m5ReaderAttester.id) && !t.includes(SERVICES.m5ReaderHost.id), p);
  }
});
test("S09", "documentation carries the mandatory later v1→v2 production integration item and the known B item", async () => {
  const docs = ["README-OWNER.md", "ARCHITECTURE-DECISIONS.md", "FUTURE-LIVE-SEQUENCE.md"].map(read).join("\n");
  ok(docs.includes("MANDATORY LATER PRODUCTION-COMPOSITION INTEGRATION ITEM"), "mandatory item");
  ok(/stale comment/i.test(docs) && docs.includes("executor-attestation.mjs"), "B item");
});

test("S10", "samples: every sample receipt is SYNTHETIC, leak-guard safe and grants no authorization", async () => {
  const files = readdirSync(join(ROOT, "samples")).filter((f) => f.endsWith(".synthetic.json"));
  eq(files.length, 3);
  for (const f of files) {
    const j = JSON.parse(read("samples/" + f));
    ok(/^SYNTHETIC SAMPLE/.test(j.note), f); ok(/^synthetic-/.test(j.receipt.runId), f);
    eq(assertReceiptSafe(j.receipt).ok, true, f); eq(j.receipt.liveAuthorization, "THIS_RECEIPT_GRANTS_NO_AUTHORIZATION");
  }
});

await run("static-audit.test.mjs");
