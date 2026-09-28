#!/usr/bin/env node
// LIVE-AI-03B — M7 STEP 1 — gateway suite: the REAL accepted budget authority (unchanged) + the
// candidate service_tier pin, compiled from the scratchpad CLONE (repo HEAD 9270c282 + ONE narrow diff).
//   • §16 A–I cache-write accounting with the V2 three-row catalog (real createBudgetCore + real
//     createPriceCatalog; fake store extracted VERBATIM from the accepted tests/live-ai/live-ai-03b.test.js);
//   • regressions 37–39: the real 03B request body carries service_tier:"default"; the ACCEPTED
//     (unmodified) body lacks it and is rejected by the first-probe request contract;
//   • optional E2E (env M7_PG_SOCKET): load the ACTIVATED V2 catalog from a throwaway local PG via the
//     REAL loadStagingPriceCatalog and prove the same reservation/settlement numbers.
// NO provider network (fake fetch), NO credential, NO live DB.
import fs from "node:fs"; import path from "node:path"; import cp from "node:child_process";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import * as G from "../catalog/v2-digest-gen.mjs";
import { reviewedV2Rows, checkV2Catalog } from "../catalog/v2-catalog-contract.mjs";
import { checkFirstProbeRequestBody } from "../approval/first-probe-request-contract.mjs";

const M7 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = process.env.M7_CLONE || path.join(M7, "repo");
const ORIG = process.env.REPO || "/home/user/staybid-frontend";
const require = createRequire(import.meta.url);
let pass = 0, fail = 0; const fails = [];
const ok = (c, l) => { if (c) pass++; else { fail++; fails.push(l); console.error("  ✗ " + l); } };
const eq = (a, b, l) => ok(a === b, l + (a === b ? "" : ` [got ${a} want ${b}]`));

// module resolution for the compiled gateway (fastify, pg, …): the ACCEPTED repo's node_modules, read-only.
fs.mkdirSync(path.join(M7, "tests", ".build"), { recursive: true });
if (!fs.existsSync(path.join(M7, "tests", ".build", "node_modules"))) fs.symlinkSync(path.join(ORIG, "node_modules"), path.join(M7, "tests", ".build", "node_modules"));
function compile(name, srcDir) {
  const B = path.join(M7, "tests", ".build", name), SRC = path.join(B, "src"), OUT = path.join(B, "out");
  fs.rmSync(B, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) if (f.endsWith(".ts") && !f.endsWith(".d.ts")) fs.copyFileSync(path.join(srcDir, f), path.join(SRC, f));
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(ORIG, "node_modules/@types")], types: ["node"], lib: ["es2020", "dom"], strict: true, noEmitOnError: false }, include: ["*.ts"] }));
  cp.spawnSync(process.execPath, [require.resolve("typescript/bin/tsc", { paths: [ORIG] }), "-p", path.join(SRC, "tsconfig.json")], { cwd: ORIG, encoding: "utf8" });
  if (!fs.existsSync(path.join(OUT, "live-ai-budget-authority.js"))) { console.error("COMPILE GATE FAILED " + name); process.exit(2); }
  return OUT;
}
const GW = compile("gw-candidate", path.join(CLONE, "server/voice-gateway"));
const GW0 = compile("gw-accepted", path.join(ORIG, "server/voice-gateway"));
const AUTH = require(path.join(GW, "live-ai-budget-authority.js"));
const PRICING = require(path.join(GW, "live-ai-budget-pricing.js"));
const RESP = require(path.join(GW, "openai-responses.js"));
const RESP0 = require(path.join(GW0, "openai-responses.js"));
const MAIN = require(path.join(GW, "live-ai-staging-main.js"));

// ── budget authority + pricing are BYTE-IDENTICAL between candidate and accepted (no accounting-core change) ──
for (const f of ["live-ai-budget-authority.ts", "live-ai-budget-pricing.ts", "live-ai-budget-store.ts", "live-ai-staging-main.ts", "live-ai-03b-controller.ts"])
  eq(fs.readFileSync(path.join(CLONE, "server/voice-gateway", f), "utf8"), fs.readFileSync(path.join(ORIG, "server/voice-gateway", f), "utf8"), `G00 ${f} unchanged (accounting core untouched)`);

// ── verbatim accepted fake store ──
const T = fs.readFileSync(path.join(ORIG, "tests/live-ai/live-ai-03b.test.js"), "utf8");
const m = T.match(/function mkPgLikeStore\(nowRef\) \{[\s\S]*?\n\}\n/);
if (!m) { console.error("cannot extract mkPgLikeStore"); process.exit(2); }
const mkPgLikeStore = new Function(m[0].replace(/"reasoning\.v1"/g, JSON.stringify(G.V2_ID)) + "\nreturn mkPgLikeStore;")();

const toRaw = (e) => ({ // exactly the loadStagingPriceCatalog conversion
  provider: e.provider, model: e.model, serviceTier: e.service_tier === null ? null : String(e.service_tier), billingDimension: e.billing_dimension,
  currencyCode: e.currency_code, unitSize: PRICING.parseInt64(e.unit_size), rateMicros: PRICING.parseInt64(e.rate_micros),
  effectiveFromMs: Date.parse(e.effective_from), effectiveUntilMs: e.effective_until === null ? null : Date.parse(e.effective_until),
  verifiedAtMs: Date.parse(e.verified_at), verificationExpiresAtMs: Date.parse(e.verification_expires_at),
  sourceId: e.source_id, sourceDigest: e.source_digest, status: e.status });
const NOWMS = Date.parse(G.T0) + 3600000;
const catalogFrom = (entries) => PRICING.createPriceCatalog(G.V2_ID, entries.map(toRaw));
const V2CAT = catalogFrom(reviewedV2Rows("active").entries);
async function core(cat, money = BigInt(105920), nowMs = NOWMS) {
  const nowRef = { t: nowMs };
  const c = AUTH.createBudgetCore({ store: mkPgLikeStore(nowRef), catalog: cat, clock: { nowMs: () => nowRef.t }, hashSession: (s) => "d_" + s, mintRef: (k, n) => `${k}-${n}`, controlTimers: { set: () => 0, clear: () => {} }, controlIntervalMs: 5000, bootNonce: "boot" });
  await c.prepareProviderLease({ gatewaySessionId: "gw", subjectDigest: "s", projectId: "live-ai-03b", acquisitionKey: "acq", maxControlStalenessMs: 15000, leaseTtlMs: 60000, amounts: { moneyMicros: money, providerCalls: BigInt(1), executionAdmissions: BigInt(0) } });
  return c;
}
const U = (input, cached, cw, output, reasoning = 0) => ({ inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: cw, outputTokens: output, reasoningTokens: reasoning, totalTokens: input + output });
const cd = (a, b) => (a === 0n ? 0n : (a + b - 1n) / b);
const trueBill = (u) => { // published bill (all four tiers; cached 0.20/M)
  const ord = BigInt(u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens);
  return cd(ord * 2000000n, 1000000n) + cd(BigInt(u.cachedInputTokens) * 200000n, 1000000n) + cd(BigInt(u.cacheWriteTokens) * 2500000n, 1000000n) + cd(BigInt(u.outputTokens) * 12000000n, 1000000n);
};
async function settleCase(u, cat = V2CAT) {
  const c = await core(cat); const rid = c.reserveReasoning03b("gw", "turn1");
  const worst = c.quoteReasoning03bWorstCaseMicros();
  c.settleUsage("gw", "turn1", u); const p = c.inspect("gw").provider;
  return { rid, worst: worst === null ? null : Number(worst), charged: Number(p.chargedMoneyMicros), revoked: p.revoked === true };
}

async function accounting(label, cat) {
  // A — full base input, no cache write
  const a = await settleCase(U(32768, 0, 0, 2000), cat);
  eq(a.worst, 105920, `${label} A1 reservation (worst case) = 105,920`);
  ok(typeof a.rid === "string", `${label} A2 reservation ADMITTED under the 105,920 one-call ceiling`);
  eq(a.charged, 89536, `${label} A3 exact settlement 32768×2.00 + 2000×12.00 = 89,536 ≤ reservation`);
  // B — full cache-write input
  const b = await settleCase(U(32768, 0, 32768, 2000), cat);
  eq(b.charged, 105920, `${label} B1 all-cache-write actual = 105,920 = reservation (no under-reservation)`);
  eq(BigInt(b.charged), trueBill(U(32768, 0, 32768, 2000)), `${label} B2 recorded charge == published bill`);
  // C — partial cache write
  const cu = U(32768, 0, 10000, 2000); const c = await settleCase(cu, cat);
  eq(c.charged, 94536, `${label} C1 partial cache-write exact tier charge 22768×2.00 + 10000×2.50 + 2000×12 = 94,536`);
  ok(c.charged <= 105920 && BigInt(c.charged) === trueBill(cu), `${label} C2 partial charge ≤ reservation and == published bill`);
  // D — cached tokens with the cached tier intentionally ABSENT ⇒ full reservation retained
  const du = U(32768, 5000, 0, 2000); const d = await settleCase(du, cat);
  eq(d.charged, 105920, `${label} D1 cached usage, no cached tier ⇒ FULL 105,920 retained (conservative)`);
  ok(BigInt(d.charged) >= trueBill(du), `${label} D2 NO under-accounting (retained ${d.charged} ≥ published bill ${trueBill(du)})`);
  // H — over-cap usage ⇒ existing incident + revoke preserved
  const h = await settleCase(U(40000, 0, 0, 100), cat);
  ok(h.revoked === true && h.charged === 105920, `${label} H1 usage > 32768 input ⇒ over-cap revoke + full retain (existing behaviour preserved)`);
  const h2 = await settleCase(U(1000, 0, 0, 2500), cat);
  ok(h2.revoked === true, `${label} H2 usage > 2000 output ⇒ over-cap revoke`);
  // I — exhaustive grid: never charge/authorize more than reserved; never under-account the published bill
  let maxCharged = 0, under = 0, over = 0, n = 0;
  const grid = [0, 1, 1023, 1024, 5000, 16384, 32767, 32768];
  for (const input of grid) for (const cwf of [0, 0.25, 0.5, 1]) for (const cf of [0, 0.3]) for (const out of [0, 1, 999, 2000]) {
    const cw = Math.floor(input * cwf), cached = Math.min(Math.floor(input * cf), input - cw);
    const u = U(input, cached, cw, out); const r = await settleCase(u, cat); n++;
    if (r.charged > maxCharged) maxCharged = r.charged;
    if (r.charged > 105920) over++;
    if (BigInt(r.charged) < trueBill(u)) under++;
  }
  eq(over, 0, `${label} I1 across ${n} admissible usages no settlement exceeds the 105,920 reservation`);
  eq(under, 0, `${label} I2 across ${n} admissible usages no settlement is below the published bill (no under-accounting)`);
  ok(maxCharged === 105920, `${label} I3 the maximum charge equals the reservation exactly`);
}

// ─────────── §16 with the in-memory V2 catalog (real createPriceCatalog) ───────────
{ const r = reviewedV2Rows("active"); ok(checkV2Catalog(r.version, r.entries, "active", new Date(NOWMS).toISOString().replace(".000Z", "Z")).ok, "G01 the reviewed active V2 rows pass the V2 catalog contract"); }
eq(V2CAT.size, 3, "G02 real createPriceCatalog accepts all THREE V2 rows (none dropped)");
await accounting("§16[mem]", V2CAT);
// E / F / G — what the gateway would do with a non-conforming candidate (why the contract + DB reject it first)
{ const e = reviewedV2Rows("active").entries.filter((x) => x.service_tier !== "cache_write");
  const r = await settleCase(U(32768, 0, 32768, 2000), catalogFrom(e));
  ok(r.worst === 89536 && r.charged === 89536 && BigInt(r.charged) < trueBill(U(32768, 0, 32768, 2000)), "E1 missing cache-write row ⇒ gateway would reserve 89,536 < 105,920 bill (HB-1) — so the V2 contract/DB/approval REJECT it before provider authority"); }
{ const e = reviewedV2Rows("active").entries.map((x) => x.service_tier === "cache_write" ? { ...x, rate_micros: 2400000 } : x);
  const r = await settleCase(U(32768, 0, 32768, 2000), catalogFrom(e));
  ok(r.worst < 105920, "F1 cache-write rate < 2.50/M ⇒ gateway would under-reserve (" + r.worst + ") — so it is REJECTED by contract/DB/approval"); }
{ const e = reviewedV2Rows("active").entries.map((x) => x.service_tier === "cache_write" ? { ...x, rate_micros: "2.5e6" } : x);
  const cat = catalogFrom(e); eq(cat.size, 2, "G1 malformed cache-write rate ⇒ the released validator DROPS the row (would silently fall back to base)");
  const r = await settleCase(U(32768, 0, 0, 2000), cat); eq(r.worst, 89536, "G2 …and the worst case would fall to 89,536 — hence malformed rates are REJECTED upstream (contract + BIGINT column)"); }

// ─────────── 37–39: provider request service tier pin ───────────
function fetchCapture() { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => JSON.stringify({ status: "completed", model: "gpt-5.6-terra", output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) }; }; f.calls = calls; return f; }
async function bodyOf(R) {
  const fetchImpl = fetchCapture(); const adm = R.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
  await R.runReasoning03bProviderCall(adm, { apiKey: "synthetic-test-key-not-a-secret", inputSnapshot: { a: 1 }, fetchImpl });
  return { body: JSON.parse(fetchImpl.calls[0].init.body), n: fetchImpl.calls.length, url: fetchImpl.calls[0].url };
}
{ const { body, n, url } = await bodyOf(RESP);
  eq(body.service_tier, "default", "R37 the REAL 03B provider request carries service_tier:\"default\" (#37)");
  eq(RESP.REASONING_03B_SERVICE_TIER, "default", "R37b the pin is a fixed module constant (never browser/model/user-chosen)");
  ok(checkFirstProbeRequestBody(body).ok, "R37c the candidate request body satisfies the first-probe request contract");
  eq(url, "https://api.openai.com/v1/responses", "R37d endpoint unchanged"); eq(n, 1, "R37e exactly one fetch (zero retries) unchanged");
  ok(body.model === "gpt-5.6-terra" && body.reasoning.effort === "low" && body.max_output_tokens === 2000 && body.store === false && body.background === false && body.stream === false && Array.isArray(body.tools) && body.tools.length === 0 && body.truncation === "disabled" && body.text.format.type === "json_schema" && body.text.format.strict === true && body.text.format.name === "live_ai_plan", "R37f model/effort/max_output/store/background/stream/tools/truncation/json_schema UNCHANGED");
  const { body: b0 } = await bodyOf(RESP0);
  const { service_tier, ...rest } = body; void service_tier;
  eq(JSON.stringify(rest), JSON.stringify(b0), "R37g the ONLY request-body difference vs the accepted body is the added service_tier field");
  eq(checkFirstProbeRequestBody(b0).reason, "service_tier_missing", "R38 the ACCEPTED body (no service_tier ⇒ project-inherited 'auto') is REJECTED by the first-probe contract (#38)");
  for (const tier of ["auto", "flex", "priority", "fast", "scale", "ultrafast", "Default", ""]) eq(checkFirstProbeRequestBody({ ...body, service_tier: tier }).reason, "service_tier_not_default", `R39 unexpected service tier '${tier}' rejected (#39)`);
  eq(checkFirstProbeRequestBody({ ...body, service_tier: undefined }).reason, "service_tier_not_default", "R39b undefined service tier rejected");
  eq(checkFirstProbeRequestBody({ ...body, extra: 1 }).reason, "body_keys_not_exact", "R39c unexpected extra request field rejected");
  const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 }); const adm0 = RESP0.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
  eq(adm.admissionDigest, adm0.admissionDigest, "R37h admission contract + digest unchanged by the pin"); }
{ const f = fetchCapture(); const adm = RESP.buildProviderCallAdmissionV1({ inputSnapshot: { a: 1 }, deadlineMs: 20000 });
  const o = await RESP.runReasoning03bProviderCall(adm, { apiKey: null, inputSnapshot: { a: 1 }, fetchImpl: f });
  ok(o.kind === "PROVIDER_UNAVAILABLE" && f.calls.length === 0, "R55 no API key ⇒ ZERO fetch (the pin grants no provider authority)"); }

// ─────────── optional E2E: REAL loader over the activated V2 in a throwaway local PG ───────────
if (process.env.M7_PG_SOCKET) {
  const { Pool } = require(path.join(ORIG, "node_modules/pg"));
  const pool = new Pool({ host: process.env.M7_PG_SOCKET, user: "live_ai_03b_reader", database: "railway", max: 2 });
  const r = await MAIN.loadStagingPriceCatalog(pool);
  ok(r.ok === true, "E2E1 REAL loadStagingPriceCatalog loads the activated catalog from local PG" + (r.ok ? "" : ` [${r.reason}]`));
  if (r.ok) {
    eq(r.catalog.version, G.V2_ID, "E2E2 the loaded (single, unambiguous) active version is V2 — V1 is never selected");
    eq(r.catalog.size, 3, "E2E3 exactly the three V2 entries loaded (no V1 row)");
    await accounting("§16[pg]", r.catalog);
  }
  await pool.end();
} else { console.log("  (E2E skipped here: run via tests/m7-localpg.test.sh, which supplies M7_PG_SOCKET)"); }

console.log(`\nm7-gateway: ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
