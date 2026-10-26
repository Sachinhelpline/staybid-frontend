#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — REAL-TEDDY G-PUBLIC browser smoke (S1–S6 evidence), offline, no credentials.
//
// Drives the REAL built app (V=1, P=1, preview=1, live=1, NEXT_PUBLIC_LIVE_AI_PUBLIC_ADMISSION=1) in Chromium
// through the owner-runnable preview on its "customer" route (tests/live-ai/travel-buddy-live-preview.mjs):
// Teddy → LiveAiProvider → ORIGINAL conversation + gateway-client → the ORIGINAL gateway source in-process
// on the NEW PUBLIC composition (live-ai-public-main.ts → released BudgetCore, strict in-memory store).
// Fakes (labelled): the offline keyword model, the in-memory budget store, the TTS + realtime-transcription
// provider seams, getUserMedia/RTCPeerConnection, the session route's JWT verification (a TEST-ONLY opaque
// bearer stands in for the strict verified-customer gate, which tests/security covers). NOTHING here is
// real-provider proof — it proves the browser wiring of sign-in gating, the approved-answer voice path, the
// one-session mic turn, mute, and read-only network behaviour.
//
// SAFETY — refuses to run unless external egress is unreachable (offline namespace, loopback only).
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startLivePreview } from "./travel-buddy-live-preview.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(REPO, "tests/live-ai/.build/public-smoke"));
const CHROMIUM = process.env.TB_SMOKE_CHROMIUM || "/opt/pw-browsers/chromium";
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const log = [];
const note = (s) => { log.push(s); console.log(s); };
let pass = 0, fail = 0;
const results = [];
const ok = (c, l, f) => { results.push({ f: f || "", ok: !!c, l }); if (c) { pass++; note("  ✓ " + (f ? `[${f}] ` : "") + l); } else { fail++; note("  ✗ " + (f ? `[${f}] ` : "") + l); } };

const reach = (h, p) => new Promise((r) => { const s = net.connect({ host: h, port: p, timeout: 1500 }); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); }); });
for (const [h, p] of [["1.1.1.1", 443], ["8.8.8.8", 53]]) {
  if (await reach(h, p)) { console.error(`REFUSING: external egress to ${h}:${p} is reachable — run inside an offline namespace.`); process.exit(3); }
}
note("• offline guard: external egress unreachable (1.1.1.1:443, 8.8.8.8:53)");

const preview = await startLivePreview({ appPort: 3950, port: 3951, route: "customer", log: (m) => note("  " + m) });
const BASE = preview.url.replace(/\/$/, "");
note(`• live preview up at ${BASE} (route "customer" — PUBLIC composition)`);
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const browserNet = { external: [], nonGet: [] };
const TEST_BEARER = "test-only-opaque-bearer-0123456789abcdef";   // NOT a credential; never verified as a JWT here

async function newPage(w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN" });
  await ctx.addInitScript((o) => {
    try { sessionStorage.setItem("sb_welcome_shown", "1"); } catch {}
    if (o.signedIn) { try { localStorage.setItem("sb_token", o.bearer); localStorage.setItem("sb_token_type", "backend"); localStorage.setItem("sb_user", JSON.stringify({ id: "test-only-customer", name: "Test Guest" })); } catch {} }
    window.__speechTouched = [];
    const trap = (n) => function () { window.__speechTouched.push(n); throw new Error("blocked in smoke: " + n); };
    try { window.SpeechRecognition = trap("SpeechRecognition"); window.webkitSpeechRecognition = trap("webkitSpeechRecognition"); } catch {}
    try { if (window.speechSynthesis) { window.speechSynthesis.speak = () => window.__speechTouched.push("speechSynthesis.speak"); } } catch {}
    window.__caps = [];
    let last = "";
    setInterval(() => { const el = document.querySelector(".tb-sr"); const t = el ? el.textContent || "" : ""; if (t && t !== last) { last = t; window.__caps.push(t); } }, 60);
  }, { signedIn: !!opts.signedIn, bearer: TEST_BEARER });
  await ctx.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") { browserNet.external.push(`${req.method()} ${u.origin}`); return route.abort("blockedbyclient"); }
    if (req.method() !== "GET" && req.method() !== "HEAD") browserNet.nonGet.push(`${req.method()} ${u.pathname}`);
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return { ctx, page, errors };
}
const caps = (page) => page.evaluate(() => window.__caps.map((c) => c.replace(/^(Buddy|Note|Aap|You): /, "")).join(" ⏎ "));
async function waitCap(page, re, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(await caps(page))) return true; await page.waitForTimeout(150); } return false; }
async function until(pred, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return !!(await pred()); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png") });
const tourVisible = (page) => page.locator(".driver-popover").isVisible().catch(() => false);
async function settleTour(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 7000) {
    if (await tourVisible(page)) { await page.locator(".driver-popover-close-btn").click(); await page.locator(".driver-popover").waitFor({ state: "detached", timeout: 10000 }).catch(() => {}); return true; }
    await page.waitForTimeout(200);
  }
  return false;
}
async function tapTeddy(page) {
  const m = page.locator("button.tb-mascot");
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    if (await tourVisible(page)) { await page.locator(".driver-popover-close-btn").click().catch(() => {}); await page.locator(".driver-popover").waitFor({ state: "detached", timeout: 10000 }).catch(() => {}); continue; }
    if (await m.isVisible().catch(() => false)) { try { await m.click({ timeout: 3000 }); return; } catch { /* retry */ } }
    await page.waitForTimeout(200);
  }
  await m.click({ timeout: 5000 });
}
async function typeTurn(page, text) {
  const input = page.locator("input.tb-input");
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator("button.tb-more").click();
    await page.locator(".tb-chip", { hasText: "Type instead" }).click();
  }
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.click();
  await page.keyboard.type(text, { delay: 5 });
  await page.locator(".tb-type-row button.tb-send").click();
}
const frames = () => preview.gateway.frames;
const framesSince = (i) => preview.gateway.frames.slice(i);

try {
  // ── S1 — signed OUT: the public route never admits an anonymous guest ───────────────────────────
  note("\n• S1 Signed-out guest: Teddy asks to sign in; ZERO gateway sessions, ZERO model calls");
  {
    const { ctx, page, errors } = await newPage(390, 844, { signedIn: false });
    const m0 = preview.gateway.model.calls.length, b0 = preview.broker.calls.length;
    await page.goto(BASE + "/hotels?city=Dehradun", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await typeTurn(page, "show me the stays");
    ok(await waitCap(page, /sign in to talk with Teddy's real AI|sign in kariye/i, 20000), "signed-out ⇒ Teddy says to sign in (explicit, actionable — no silent stall)", "S1");
    await page.locator("button.tb-more").click();
    ok(await page.locator(".tb-chip", { hasText: /^Sign in$/ }).isVisible().catch(() => false), "a \"Sign in\" chip is offered in Teddy's options", "S1");
    await shot(page, "S1_390_signed_out");
    ok(preview.broker.calls.length === b0 && !preview.admissions.includes("bearer"), `no gateway session was minted for the signed-out guest (broker calls ${preview.broker.calls.length - b0}; admissions ${JSON.stringify(preview.admissions)})`, "S1");
    ok(preview.gateway.model.calls.length === m0, "ZERO model calls for the signed-out guest", "S1");
    ok(errors.length === 0, "no uncaught page errors" + (errors.length ? ": " + errors.join(" | ") : ""), "S1");
    await ctx.close();
  }

  // ── S2 — signed IN, voice ON: verified answer → browser approval → provider-seam speech → audio ───
  note("\n• S2 Signed-in customer, typed turn, voice ON: verified answer, then the EXACT text is voiced via approval");
  {
    const { ctx, page, errors } = await newPage(390, 844, { signedIn: true });
    const m0 = preview.gateway.model.calls.length, b0 = preview.broker.calls.length, f0 = frames().length, v0 = preview.voice.tts.length;
    await page.goto(BASE + "/hotels?city=Dehradun", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await typeTurn(page, "show me the stays");
    ok(await waitCap(page, /[0-9]+ matching stays? (is|are) shown/, 40000), "signed-in ⇒ the verified IC02 compiled answer is shown", "S2");
    const calls = preview.broker.calls.slice(b0);
    ok(calls.length === 1 && calls[0].route === "customer" && calls[0].gatewayStatus === 200 && preview.admissions.includes("bearer"), "ONE gateway session, admitted on the PUBLIC route (auth:true pub1 subject) after the bearer was presented", "S2");
    ok(preview.gateway.model.calls.length - m0 >= 1, `the (offline) model planned the turn (${preview.gateway.model.calls.length - m0} call(s))`, "S2");
    ok(await until(() => framesSince(f0).some((f) => f.dir === "c2s" && f.t === "answer.approve")), "the browser APPROVED the verified answer (answer.approve)", "S2");
    ok(await until(() => preview.voice.tts.length > v0), "the gateway voiced it through the TTS provider SEAM (fake adapter, counted)", "S2");
    const spoken = preview.voice.tts[preview.voice.tts.length - 1] || "";
    ok(/[0-9]+ matching stays? (is|are) shown/.test(spoken), `the voiced text is the verified canonical answer ("${spoken}")`, "S2");
    ok(await until(() => framesSince(f0).some((f) => f.dir === "s2c" && f.t === "audio.start") && framesSince(f0).some((f) => f.dir === "s2c" && f.t === "audio.end")), "audio.start → audio.end reached the browser", "S2");
    ok((await page.evaluate(() => window.__speechTouched)).length === 0, "the device speech engines were NEVER used (provider-seam speech only)", "S2");
    await shot(page, "S2_390_signed_in_answer");
    ok(errors.length === 0, "no uncaught page errors" + (errors.length ? ": " + errors.join(" | ") : ""), "S2");
    await ctx.close();
  }

  // ── S3 — signed IN, microphone: ONE session start for the whole reviewed voice turn ─────────────
  note("\n• S3 Signed-in microphone turn: real gateway negotiation (no shim), transcript review, SAME session answers");
  {
    const { ctx, page, errors } = await newPage(390, 844, { signedIn: true });
    const b0 = preview.broker.calls.length, s0 = preview.voice.stt.length;
    await page.goto(BASE + "/hotels?city=Rishikesh", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    ok((await page.evaluate(() => window.__OG.gum)) === 0, "activation alone never requests the microphone", "S3");
    await page.locator("button.tb-close-type").first().click().catch(() => {});
    await tapTeddy(page);
    await page.locator(".tb-voice-live").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("[data-og-harness] [data-og-phrase]").first().waitFor({ state: "visible", timeout: 15000 });
    ok((await page.evaluate(() => window.__OG.gum)) === 1, "exactly ONE getUserMedia — on the explicit mic tap", "S3");
    const micCalls = preview.broker.calls.slice(b0);
    ok(micCalls.length === 1 && micCalls[0].mode === "microphone" && micCalls[0].gatewayStatus === 200 && !micCalls[0].shim, "the REAL gateway admitted the microphone session on the public route (NO negotiation shim)", "S3");
    ok(preview.voice.stt.length - s0 === 1, "exactly ONE realtime-transcription negotiation through the provider SEAM (fake adapter)", "S3");
    await page.locator("[data-og-harness] [data-og-phrase]", { hasText: "show me the stays" }).click();
    await page.locator(".tb-review").waitFor({ state: "visible", timeout: 15000 });
    ok((await page.evaluate(() => window.__OG.tracksStopped)) >= 1, "the mic track stopped when the transcript arrived (no hot mic during review)", "S3");
    await page.locator(".tb-review button.tb-send").click();
    ok(await waitCap(page, /[0-9]+ matching stays? (is|are) shown/, 40000), "the reviewed voice text got the verified answer", "S3");
    ok(preview.broker.calls.length - b0 === 1, `G-RATE: ONE gateway session start for the whole reviewed voice turn (got ${preview.broker.calls.length - b0})`, "S3");
    await shot(page, "S3_390_mic_answer");
    ok(errors.length === 0, "no uncaught page errors" + (errors.length ? ": " + errors.join(" | ") : ""), "S3");
    await ctx.close();
  }

  // ── S4 — MUTE: no approval, no speech spend ─────────────────────────────────────────────────────
  note("\n• S4 Mute: a muted Teddy never approves an answer for speech (zero TTS)");
  {
    const { ctx, page, errors } = await newPage(390, 844, { signedIn: true });
    await page.goto(BASE + "/hotels?city=Dehradun", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await page.locator("button.tb-more").click();
    await page.locator(".tb-chip[aria-pressed]", { hasText: "Mute voice" }).click();
    await page.keyboard.press("Escape").catch(() => {});
    const f0 = frames().length, v0 = preview.voice.tts.length;
    await typeTurn(page, "show me the stays");
    ok(await waitCap(page, /[0-9]+ matching stays? (is|are) shown/, 40000), "muted ⇒ the verified answer is still shown as a caption", "S4");
    await page.waitForTimeout(1200);
    ok(!framesSince(f0).some((f) => f.dir === "c2s" && f.t === "answer.approve"), "muted ⇒ NO answer.approve", "S4");
    ok(preview.voice.tts.length === v0, "muted ⇒ ZERO TTS synthesis", "S4");
    ok(errors.length === 0, "no uncaught page errors" + (errors.length ? ": " + errors.join(" | ") : ""), "S4");
    await ctx.close();
  }
} catch (e) {
  fail++; note("  ✗ harness exception: " + (e && e.stack || e));
} finally {
  await browser.close().catch(() => {});
}

note("\n• S5/S6 Network (browser + preview)");
const nonGet = Array.from(new Set(browserNet.nonGet));
note(`  browser external requests aborted: ${browserNet.external.length}`);
note(`  browser non-GET requests: ${nonGet.join(", ") || "none"}`);
note(`  preview BLOCKED (403): ${Array.from(new Set(preview.blocked)).join(", ") || "none"}`);
note(`  gateway sessions minted: ${preview.broker.calls.length} (shim: ${preview.broker.calls.filter((c) => c.shim).length})`);
note(`  offline model calls: ${preview.gateway.model.calls.length} · TTS seam: ${preview.voice.tts.length} · transcription seam: ${preview.voice.stt.length}`);
ok(nonGet.every((x) => x === "POST /api/live-ai/session" || x === "POST /api/pricing/spine"), "S5 — the ONLY browser writes are POST /api/live-ai/session and the pre-existing hotel-detail POST /api/pricing/spine (refused 403 — R3)", "S5");
ok(!preview.blocked.some((x) => /\/api\/(bids|bid|book|bookings|payments?|razorpay)/i.test(x)), "S5 — no bid / booking / payment write ever attempted", "S5");
ok(preview.networkAttempts.length === 0, "S6 — the in-process gateway made ZERO network attempts", "S6");
ok(preview.broker.calls.every((c) => !c.shim), "S6 — the disclosed mic-negotiation shim was NEVER used on the public route", "S6");
await preview.stop();
note(`\nPublic smoke: ${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(OUT, "public-smoke-log.txt"), log.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "public-smoke-results.json"), JSON.stringify({ pass, fail, results, nonGet, blocked: preview.blocked, brokerCalls: preview.broker.calls, modelCalls: preview.gateway.model.calls, admissions: preview.admissions, ttsCalls: preview.voice.tts.length, sttCalls: preview.voice.stt.length }, null, 2));
process.exit(fail ? 1 : 0);
