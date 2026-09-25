// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §M1-R3 — DATABASE-CLOCK TARGET CONTRACT (OFFLINE). Node built-ins only.
// Guards the deployment/target contract against drift: the clock DB is a DIRECT bounded read-only PostgreSQL
// session to the anchored AI-STAGING Railway service; there is NO operational Supabase / PostgREST / SB_URL / HTTP
// clock dependency. Any mention of those terms in production SOURCE must be a negative/exclusion comment or the
// UNSUPPORTED_CLOCK_ENV exclusion list — never a read. Docs must state the direct-PostgreSQL contract.
// ─────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DB_CLOCK_QUERY } from "../db-clock-probe.mjs";
import { READER_ENV, ATTESTER_ENV, UNSUPPORTED_CLOCK_ENV } from "../production-config.mjs";
import { FIXED } from "../../trusted-activation-boundary-01/pricing-approval-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAND = resolve(HERE, "..");
let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const read = (rel) => readFileSync(resolve(CAND, rel), "utf8");
const FORBIDDEN = /SB_URL|Supabase|supabase|PostgREST|postgrest/;

const PROD_SOURCE = ["production-config.mjs", "production-db-clock.mjs", "production-reader.mjs", "production-attester.mjs"];

function run() {
  // ── A. the clock query is a DIRECT PostgreSQL clock, never an HTTP/REST source ──
  ok("A1. clock query uses clock_timestamp()", /clock_timestamp\(\)/.test(DB_CLOCK_QUERY));
  ok("A2. clock query is not an HTTP/REST call", !/http|rest|fetch|supabase|postgrest/i.test(DB_CLOCK_QUERY));

  // ── B. production reads ONLY the direct reader/observer DB URL names as the clock connection ──
  ok("B1. reader clock credential is the direct reader DB URL name", READER_ENV.readerDbUrl === "LIVE_AI_03B_TRUSTED_READER_DB_URL");
  ok("B2. attester clock credential is the direct observer DB URL name", ATTESTER_ENV.observerDbUrl === "LIVE_AI_03B_ATTESTER_OBSERVER_DB_URL");
  ok("B3. neither clock credential name is a Supabase/PostgREST/SB_URL name", !FORBIDDEN.test(READER_ENV.readerDbUrl) && !FORBIDDEN.test(ATTESTER_ENV.observerDbUrl));

  // ── C. any Supabase/PostgREST/SB_URL mention in production SOURCE is a comment or the exclusion list — never a read ──
  for (const f of PROD_SOURCE) {
    const lines = read(f).split("\n");
    let offending = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!FORBIDDEN.test(line)) continue;
      const t = line.trim();
      const isComment = t.startsWith("//") || t.startsWith("*");
      const isExclusionList = /UNSUPPORTED_CLOCK_ENV/.test(line) || /"SB_URL"|"SUPABASE_URL"|"POSTGREST_URL"|"SUPABASE_SERVICE_ROLE_KEY"|"NEXT_PUBLIC_SUPABASE_URL"/.test(line);
      if (!isComment && !isExclusionList) { offending = `${f}:${i + 1}: ${t}`; break; }
    }
    ok(`C. ${f} mentions the forbidden clock sources only in comments/exclusion (no operational read)`, offending === null || (console.log("   offending:", offending), false));
  }

  // ── D. no production file reads an SB_URL/Supabase/PostgREST env value as a connection string ──
  for (const f of PROD_SOURCE) {
    const src = read(f);
    ok(`D. ${f} never dereferences env[SB_URL/SUPABASE/POSTGREST]`, !/env\[\s*["'`](SB_URL|SUPABASE_URL|POSTGREST_URL|NEXT_PUBLIC_SUPABASE_URL)["'`]\s*\]/.test(src) && !/process\.env\.(SB_URL|SUPABASE_URL|POSTGREST_URL)/.test(src));
  }
  ok("D-list. UNSUPPORTED_CLOCK_ENV names SB_URL + Supabase + PostgREST as non-sources", UNSUPPORTED_CLOCK_ENV.includes("SB_URL") && UNSUPPORTED_CLOCK_ENV.includes("SUPABASE_URL") && UNSUPPORTED_CLOCK_ENV.includes("POSTGREST_URL"));

  // ── E. the anchored AI-STAGING PostgreSQL service is the target, CORE-PROD excluded ──
  ok("E1. anchored pg service id is the AI-STAGING pg service", FIXED.ai_staging_postgres === "b7362594-a01b-4623-a982-394707a6cec2");
  ok("E2. CORE-PROD pg service is a distinct excluded id", FIXED.core_excluded_postgres !== FIXED.ai_staging_postgres);

  // ── F. docs state the direct-PostgreSQL contract + the anchored pg service, and exclude Supabase/PostgREST/SB_URL ──
  const dc = read("DEPLOYMENT-CONTRACT.md");
  ok("F1. deployment contract names direct PostgreSQL as the clock", /direct[^.\n]*PostgreSQL/i.test(dc) && /clock_timestamp\(\)/.test(dc));
  ok("F2. deployment contract names the anchored pg service id", dc.includes(FIXED.ai_staging_postgres));
  ok("F3. deployment contract explicitly excludes Supabase/PostgREST/SB_URL as the clock", /NO\s+Supabase[^.]*NO\s+PostgREST[^.]*NO\s+`?SB_URL`?/i.test(dc.replace(/\n/g, " ")));
  const rm = read("README.md");
  ok("F4. README names the direct-PostgreSQL target + excludes Supabase/PostgREST/SB_URL", /direct[^.\n]*PostgreSQL/i.test(rm) && /No Supabase, no PostgREST, no `?SB_URL`?/i.test(rm));

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE DATABASE-CLOCK TARGET CONTRACT (§M1-R3): PASS");
  process.exitCode = 0;
}
run();
