#!/usr/bin/env node
// OFFLINE review tool — static audits over THIS package's files only (accepted dependencies are byte-identity checked
// separately by check-predecessors.mjs). Prints one JSON result; exit 0 clean / 1 findings.
//   mutationAudit   : no SQL string literal of any kind, no call/import of an activation, provisioning, Phase A, SQL03,
//                     gateway or provider routine; the controller has no railway delete/listing/run/up/domain/proxy token.
//   secretLeakAudit : no PEM block, private-key DER prefix, JWT, cloud/API key shape, credentialed URL (other than the
//                     synthetic *.example.test fixtures), or long base64 run anywhere in the package.
//   modelIdAudit    : no model identifier anywhere in the package.
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listPackageFiles, PACKAGE_ROOT } from "./import-closure.mjs";

const rel = (p) => relative(PACKAGE_ROOT, p).split(sep).join("/");
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => { const i = l.search(/(^|[^:"'`\\])\/\/(?![^"'`]*["'`]\s*[,)\]])/); return i >= 0 ? l.slice(0, i + 1) : l; }).join("\n");
}
const RUNTIME = (f) => /^(src|controller)\//.test(rel(f)) && f.endsWith(".mjs");
const SQL_LITERAL = /["'`]\s*(SELECT|ALTER|CREATE|GRANT|REVOKE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COPY|SET\s+ROLE|BEGIN|COMMIT)\b/;
const FORBIDDEN_CALLS = [/composeTrustedExecutorProductionV2/, /activate_catalog_v2\s*\(/, /restore_catalog_v2_inactive\s*\(/, /provisioner\.mjs/, /m7-v2-production-authority-provisioning-offline-01\/src\/production-entrypoint\.mjs/,
  /guarded-clients\.mjs/, /\bsql03\s*\(/i, /\brunPhaseA\b|\bphaseA\s*\(/, /m7-step1-hb1[^"']*sql/i, /gateway-store|gateway-service|provider-adapter/i];
const FORBIDDEN_RAILWAY_TOKENS = ['"delete"', '"variables"', '"up"', '"run"', '"connect"', '"domain"', '"down"', '"link"', '"add"', '"tcp-proxy"', '"logs"', '"shell"'];
export function mutationAudit(files = listPackageFiles()) {
  const findings = [];
  for (const f of files.filter(RUNTIME)) {
    const code = stripComments(readFileSync(f, "utf8"));
    if (SQL_LITERAL.test(code)) findings.push({ file: rel(f), reason: "sql_string_literal" });
    for (const re of FORBIDDEN_CALLS) if (re.test(code)) findings.push({ file: rel(f), reason: "forbidden_routine:" + re.source });
    if (/import\s*\{[^}]*\bcreateAttestationSourceChannel\b[^}]*\}/.test(code)) findings.push({ file: rel(f), reason: "v1_reader_channel_import" });
    if (rel(f).startsWith("controller/")) for (const t of FORBIDDEN_RAILWAY_TOKENS) if (code.includes(t)) findings.push({ file: rel(f), reason: "railway_token:" + t });
    if (/mcp__|Railway__/.test(code)) findings.push({ file: rel(f), reason: "mcp_reference" });
  }
  return findings;
}
const SECRET_SHAPES = [["pem", /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/], ["ed25519_pkcs8_der_b64", new RegExp(["MC4C", "AQAw"].join(""))], ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ/],
  ["aws", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/], ["github", /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/], ["razorpay", /\brzp_(live|test)_[A-Za-z0-9]{6,}/], ["sk", /\bsk-[A-Za-z0-9_-]{16,}/],
  ["long_base64", /[A-Za-z0-9+/]{80,}={0,2}/]];
const CRED_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:"'`]+:[^\s/@"'`]+@([^\s/:"'`]+)/gi;
export function secretLeakAudit(files = listPackageFiles()) {
  const findings = [];
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const [n, re] of SECRET_SHAPES) if (re.test(t)) findings.push({ file: rel(f), reason: n });
    for (const m of t.matchAll(CRED_URL)) if (!/(^|\.)example\.test$/.test(m[1]) && !(rel(f).startsWith("tests/") && m[1] === "h")) findings.push({ file: rel(f), reason: "credentialed_url" });
  }
  return findings;
}
export function modelIdAudit(files = listPackageFiles()) {
  const re = new RegExp(["claude-(opus|sonnet|haiku|fable)", "\\b(opus|sonnet|haiku|fable)[ -]?\\d", "claude[ -](opus|sonnet|haiku|fable)"].join("|"), "i");
  return files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => ({ file: rel(f), reason: "model_identifier" }));
}
const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || "")); } catch { return false; } })();
if (isMain) {
  const r = { mutation: mutationAudit(), secretLeak: secretLeakAudit(), modelId: modelIdAudit() };
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.mutation.length + r.secretLeak.length + r.modelId.length ? 1 : 0;
}
