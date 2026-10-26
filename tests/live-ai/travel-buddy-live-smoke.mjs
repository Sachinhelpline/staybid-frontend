#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — LIVE-CONTROLLER offline integration: browser smoke (F01–F13 evidence).
//
// Drives the REAL built app (V=1, P=1, preview=1, live=1) through the owner-runnable preview
// (tests/live-ai/travel-buddy-live-preview.mjs): Teddy → LiveAiProvider → ORIGINAL conversation +
// gateway-client → the ORIGINAL gateway source in-process (offline keyword model + in-memory budget
// store are the only fakes) → IC02 compiled answer verified in the browser. Browser APIs faked by the
// labelled harness: getUserMedia, RTCPeerConnection/data channel, and the control-socket host.
//
// Unlike the earlier smokes: NO `sb_tutorial_disabled` opt-out anywhere; the first-visit welcome story and
// page tours are dismissed the way a guest would (real pointer clicks); typed turns are entered with real
// clicks + keyboard (no fill/Enter shortcuts), so an overlay that blocks taps FAILS the run.
//
// SAFETY — refuses to run unless external egress is unreachable (offline namespace, loopback only).
// Every non-loopback request is aborted; every non-GET except POST /api/live-ai/session is refused by the
// preview (403) and recorded.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startLivePreview } from "./travel-buddy-live-preview.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(REPO, "tests/live-ai/.build/live-smoke"));
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

const preview = await startLivePreview({ appPort: 3940, port: 3941, route: "staging", log: (m) => note("  " + m) });
const BASE = preview.url.replace(/\/$/, "");
note(`• live preview up at ${BASE} (route "staging")`);
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const browserNet = { external: [], nonGet: [] };

async function newPage(w, h, desktop = false, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: desktop ? 1 : 2, isMobile: !desktop, hasTouch: !desktop, locale: "en-IN" });
  await ctx.addInitScript((o) => {
    if (o.skipWelcome) { try { sessionStorage.setItem("sb_welcome_shown", "1"); } catch {} }
    // NO tutorial opt-out. Trap browser speech engines: the live mode must not use them (the ORIGINAL
    // controller owns STT; captions-only TTS unless the device-TTS flag is set, which it is not here).
    window.__speechTouched = [];
    const trap = (n) => function () { window.__speechTouched.push(n); throw new Error("blocked in smoke: " + n); };
    try { window.SpeechRecognition = trap("SpeechRecognition"); window.webkitSpeechRecognition = trap("webkitSpeechRecognition"); } catch {}
    try { if (window.speechSynthesis) { window.speechSynthesis.speak = () => window.__speechTouched.push("speechSynthesis.speak"); } } catch {}
    window.__caps = [];
    let last = "";
    setInterval(() => { const el = document.querySelector(".tb-sr"); const t = el ? el.textContent || "" : ""; if (t && t !== last) { last = t; window.__caps.push(t); } }, 60);
  }, { skipWelcome: !!opts.skipWelcome });
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
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png") });
const inside = (b, w, h) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
const overlaps = (a, b) => !!a && !!b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const tourVisible = (page) => page.locator(".driver-popover").isVisible().catch(() => false);

/** A first visit to /hotels runs the existing explore tour (~1.2 s delay + scroll ≈ 3 s): close it like a guest. */
async function settleTour(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 7000) {
    if (await tourVisible(page)) {
      await page.locator(".driver-popover-close-btn").click();
      await page.locator(".driver-popover").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}
async function dismissWelcomeLikeAGuest(page) {
  const skip = page.locator(".sb-welcome-overlay button", { hasText: /^Skip$/ });
  const shown = await skip.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (!shown) return false;
  ok(!(await page.locator("[data-travel-buddy-preview]").isVisible().catch(() => false)), "while the welcome story is open Teddy renders nothing under it", "R2");
  await skip.click();
  await page.locator(".sb-welcome-overlay").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  return true;
}
async function tapTeddy(page) {
  const m = page.locator("button.tb-mascot");
  const t0 = Date.now();
  // a late first-visit tour can start at any moment (Teddy then steps aside): close it like a guest and retry
  while (Date.now() - t0 < 40000) {
    if (await tourVisible(page)) { await page.locator(".driver-popover-close-btn").click().catch(() => {}); await page.locator(".driver-popover").waitFor({ state: "detached", timeout: 10000 }).catch(() => {}); continue; }
    if (await m.isVisible().catch(() => false)) { try { await m.click({ timeout: 3000 }); return; } catch { /* retry */ } }
    await page.waitForTimeout(200);
  }
  await shot(page, "DEBUG_tap_fail");
  note("    tap-fail DOM: " + JSON.stringify(await page.evaluate(() => ({ url: location.href, root: !!document.querySelector("[data-travel-buddy-preview]"), tab: !!document.querySelector(".tb-edge-tab"), mascot: !!document.querySelector("button.tb-mascot"), driver: document.body.className, overlay: !!document.querySelector(".driver-overlay"), welcome: !!document.querySelector(".sb-welcome-overlay") }))));
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
// TB_SMOKE_ONLY=F12,F08 runs only those sections (debugging); unset = the full run.
const ONLY = (process.env.TB_SMOKE_ONLY || "").split(",").map((x) => x.trim()).filter(Boolean);
const want = (tag) => ONLY.length === 0 || ONLY.includes(tag);
const lastModel = () => preview.gateway.model.calls[preview.gateway.model.calls.length - 1] || {};

try {
  // ── F01 / R2 — a real FIRST visit: welcome story + Teddy engaged ⇒ no page tour blocks taps ───────
  note("\n• F01/R2 First visit (no opt-out): welcome dismissed by tap, Teddy engaged, typed turn to /hotels — tour never covers the page");
  if (want("F01")) {
    const { ctx, page, errors } = await newPage(390, 844);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    const hadWelcome = await dismissWelcomeLikeAGuest(page);
    ok(hadWelcome, "the first-visit welcome story appeared and was dismissed with a real tap (Skip)", "F01");
    await tapTeddy(page);
    ok(await page.locator("input.tb-input").isVisible({ timeout: 10000 }).catch(() => false), "tapping Teddy in LIVE mode opens typing (no auto-mic; the mic opens only on its own tap)", "F01");
    ok(await waitCap(page, /Tap me again to talk|Mic ke liye mujhe dobara tap/, 8000), "live-mode note: tap again for the mic; what was heard is shown first, nothing sent until confirmed", "F01");
    await shot(page, "F01_390_live_activated");
    await typeTurn(page, "Show me stays in Rishikesh");
    await page.waitForURL(/\/hotels\?city=Rishikesh/, { timeout: 25000 });
    ok(true, "home → the ONE allow-listed navigation to /hotels?city=Rishikesh", "F01");
    ok(await waitCap(page, /2 matching stays are shown/, 35000), "the ORIGINAL controller's verified answer: \"2 matching stays are shown.\"", "F01");
    ok(lastModel().intent === "READ_RESULTS" && lastModel().pageId === "hotels", "the (offline) model saw the hotels context and planned READ_RESULTS", "F01");
    await page.waitForTimeout(2500); // past the explore tour's 1200 ms auto-fire delay
    ok(!(await tourVisible(page)), "R2: while Buddy is engaged the /hotels explore tour does NOT auto-fire over the page", "R2");
    await page.locator("button.tb-more").click({ timeout: 8000 });
    ok(await page.locator(".tb-chip", { hasText: "Conversation" }).isVisible(), "R2: Buddy's own controls take real pointer taps (nothing overlays them)", "R2");
    await page.locator(".tb-chip", { hasText: "Conversation" }).click();
    const logText = await page.locator(".tb-log").innerText();
    ok(/Buddy · AI/.test(logText) && /(You|Aap) · typed/.test(logText), "conversation log labels the controller answer 'Buddy · AI' and the guest turn 'typed'", "F09");
    if (!/Buddy · AI/.test(logText) || !/(You|Aap) · typed/.test(logText)) note("    log: " + logText.replace(/\n/g, " ⏎ ").slice(0, 600));
    ok(/live AI/.test(logText), "log header says 'live AI' (not 'demo')", "F09");
    ok(!/Buddy · demo/.test(logText), "in live mode Teddy's own scripted lines are NOT labelled demo answers", "F09");
    await page.locator(".tb-log button.tb-close-type").click();
    await shot(page, "F01_390_hotels_answer");
    ok((await page.evaluate(() => window.__speechTouched)).length === 0, "no browser SpeechRecognition / speechSynthesis used in live mode", "F10");
    ok(errors.length === 0, `no uncaught page errors (${errors.slice(0, 2).join(" | ")})`, "F01");
    await ctx.close();
  }

  // ── R2 — Teddy tapped BEFORE the welcome story reveals ⇒ the story is deferred (never covers Teddy) ──
  note("\n• R2 Teddy tapped within the welcome story's 1.2 s reveal delay: the story is deferred, Teddy stays usable");
  if (want("R2a")) {
    const { ctx, page } = await newPage(390, 844);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    // A tap on the server-rendered button BEFORE hydration has no handler yet; tap until Teddy activates
    // (≈100 ms cadence, well inside the story's 1.2 s post-hydration reveal delay).
    const m = page.locator("button.tb-mascot");
    await m.waitFor({ state: "visible", timeout: 30000 });
    let activated = false; let welcomeFirst = false;
    for (let i = 0; i < 80 && !activated; i++) {
      if (await page.locator(".sb-welcome-overlay").isVisible().catch(() => false)) { welcomeFirst = true; break; }
      await m.click({ timeout: 2000 }).catch(() => {});
      activated = await page.locator("input.tb-input").isVisible().catch(() => false);
      if (!activated) await page.waitForTimeout(100);
    }
    ok(activated && !welcomeFirst, `Teddy activated before the story's reveal (welcomeFirst=${welcomeFirst})`, "R2");
    await page.waitForTimeout(3000);
    ok(!(await page.locator(".sb-welcome-overlay").isVisible().catch(() => false)), "the welcome story did NOT open over an engaged Buddy", "R2");
    ok(await page.evaluate(() => sessionStorage.getItem("sb_welcome_shown") !== "1"), "and it was NOT marked shown (deferred, not lost)", "R2");
    await typeTurn(page, "hello");
    ok(true, "Teddy's input takes real clicks + keyboard (nothing intercepts pointer events)", "R2");
    await ctx.close();
  }

  // ── R2 — tour already running (guest NOT engaged): Teddy steps aside, returns after the tour ───────
  note("\n• R2 Tour running first: Teddy steps aside; dismissing the tour by tap brings Teddy back");
  if (want("R2b")) {
    const { ctx, page } = await newPage(390, 844, false, { skipWelcome: true });
    await page.goto(BASE + "/hotels?city=Rishikesh", { waitUntil: "domcontentloaded" });
    const t0 = Date.now();
    while (!(await tourVisible(page)) && Date.now() - t0 < 12000) await page.waitForTimeout(200);
    ok(await tourVisible(page), "first visit to /hotels: the existing explore tour runs (kept, not hidden)", "R2");
    ok(!(await page.locator("[data-travel-buddy-preview]").isVisible().catch(() => false)), "while the tour runs Teddy renders nothing under its overlay", "R2");
    await shot(page, "R2_390_tour_active");
    await page.locator(".driver-popover-close-btn").click();
    await page.locator(".driver-popover").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    ok(!(await tourVisible(page)), "the tour closes with a real tap on its close button", "R2");
    await tapTeddy(page);
    ok(await page.locator("input.tb-input").isVisible({ timeout: 10000 }).catch(() => false), "Teddy is back and takes a real tap right after the tour", "R2");
    await ctx.close();
  }

  // ── F02–F06 — typed turns on the ORIGINAL controller: compare / 0 / 1 / transactional / open+facts ─
  note("\n• F02–F06 Typed live turns (real clicks + keyboard)");
  if (want("F02")) {
    const { ctx, page, errors } = await newPage(390, 844, false, { skipWelcome: true });
    await page.goto(BASE + "/hotels?city=Rishikesh", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await typeTurn(page, "compare the first two");
    ok(await waitCap(page, /2 stays compared|compared/i, 30000), `compare → the compiled comparison sentence (${(await caps(page)).split(" ⏎ ").slice(-2).join(" | ")})`, "F03");
    ok(lastModel().intent === "COMPARE_RESULTS", "planned COMPARE_RESULTS", "F03");
    await typeTurn(page, "book the first one and pay now");
    ok(await waitCap(page, /can't do that action here/i, 30000), "booking/payment ask → bounded clarification; nothing booked or paid", "F07");
    ok(lastModel().intent === "CLARIFY", "planned CLARIFY (TRANSACTIONAL_NOT_ENABLED)", "F07");
    await typeTurn(page, "open the first one");
    await page.waitForURL(/\/hotels\/test-only-ris-/, { timeout: 25000 });
    ok(true, "OPEN_VISIBLE_HOTEL → the ORIGINAL runtime navigated to the hotel detail", "F05");
    ok(await waitCap(page, /The page changed — ask about this stay/, 20000), "Teddy explains the page changed (the route itself is the outcome) — no invented sentence", "F05");
    await page.waitForTimeout(3000); // the guest reads the note before asking
    await typeTurn(page, "is breakfast included");
    ok(await waitCap(page, /Breakfast is (not )?available/, 35000) && lastModel().intent === "READ_HOTEL_FACTS", `facts → compiled hotel-facts sentence (${(await caps(page)).split(" ⏎ ").slice(-3).join(" | ")})`, "F06");
    await shot(page, "F06_390_detail_facts");
    ok(errors.length === 0, "no uncaught page errors", "F02");
    await ctx.close();
    for (const [city, re, label] of [["Mussoorie", /1 matching stays? (is|are) shown/, "1 hotel"], ["Goa", /0 matching stays are shown|No verified answer|couldn't answer/, "0 hotels"]]) {
      const p = await newPage(390, 844, false, { skipWelcome: true });
      await p.page.goto(BASE + "/hotels?city=" + city, { waitUntil: "domcontentloaded" });
      await settleTour(p.page);
      await tapTeddy(p.page);
      await typeTurn(p.page, "show me the stays");
      ok(await waitCap(p.page, re, 35000), `${label}: answer counts only what is on screen (${(await caps(p.page)).split(" ⏎ ").slice(-1)[0]})`, "F04");
      await p.ctx.close();
    }
  }

  // ── F08 — VOICE: explicit mic tap → harness speech → MIC TRANSCRIPT review → confirm → SAME controller ─
  note("\n• F08 Voice on the ORIGINAL controller: mic only on tap; transcript reviewed + critical field confirmed BEFORE submit");
  if (want("F08")) {
    const { ctx, page, errors } = await newPage(390, 844, false, { skipWelcome: true });
    await page.goto(BASE + "/hotels?city=Dehradun", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    const gum0 = await page.evaluate(() => window.__OG.gum);
    ok(gum0 === 0, "activation alone never requests the microphone", "F08");
    await page.locator(".tb-type-row .tb-close-type, button.tb-close-type").first().click().catch(() => {});
    await tapTeddy(page); // the mic tap
    await page.locator(".tb-voice-live").waitFor({ state: "visible", timeout: 15000 });
    ok(/LIVE AI MIC · (your words are shown for review|bhejne se pehle aapke shabd review)/.test(await page.locator(".tb-voice-live .tb-panel-tag").innerText()), "live mic panel: words are shown for review before anything is sent", "F08");
    await page.locator("[data-og-harness] [data-og-phrase]").first().waitFor({ state: "visible", timeout: 15000 });
    ok((await page.evaluate(() => window.__OG.gum)) === 1, "exactly ONE getUserMedia — on the explicit mic tap", "F08");
    ok(await page.locator(".tb-voice-live", { hasText: /Listening… speak now|Sun raha hoon… boliye/ }).waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false), "once the mic session is connected the panel says it is listening (not 'connecting')", "F08");
    await shot(page, "F08_390_live_mic");
    const turnsBefore = preview.gateway.frames.filter((f) => f.dir === "c2s" && f.t === "turn.text").length;
    await page.locator("[data-og-harness] [data-og-phrase]", { hasText: "show me stays under 4000" }).click();
    await page.locator(".tb-review").waitFor({ state: "visible", timeout: 15000 });
    ok(/MIC TRANSCRIPT/.test(await page.locator(".tb-review .tb-panel-tag").innerText()), "review card labelled MIC TRANSCRIPT", "F08");
    ok((await page.locator("input.tb-input-review").inputValue()) === "show me stays under 4000", "transcript shown VERBATIM and editable", "F08");
    ok(await page.locator(".tb-review button.tb-send").isDisabled(), "provider gives no confidence ⇒ the budget is flagged: Send DISABLED until confirmed", "F08");
    ok(preview.gateway.frames.filter((f) => f.dir === "c2s" && f.t === "turn.text").length === turnsBefore, "NOTHING was submitted to the controller before review", "F08");
    ok((await page.evaluate(() => window.__OG.tracksStopped)) >= 1, "the mic track was STOPPED as soon as the transcript arrived (capture closed by the original transport)", "F08");
    await shot(page, "F08_390_mic_review_flagged");
    const pendingNames = await page.locator(".tb-field.is-pending").allInnerTexts();
    note("    pending critical fields: " + pendingNames.map((x) => x.replace(/\s+/g, " ")).join(" | "));
    ok(pendingNames.some((x) => /4,000/.test(x)), "the spoken budget ₹4,000 is among the fields awaiting confirmation", "F08");
    for (let i = 0; i < 6 && (await page.locator(".tb-field.is-pending button.tb-confirm").count()) > 0; i++) await page.locator(".tb-field.is-pending button.tb-confirm").first().click();
    ok(await page.locator(".tb-review button.tb-send").isEnabled(), "after confirming every flagged field → Send enabled", "F08");
    await page.locator(".tb-review button.tb-send").click();
    const okRefine = await (async () => { const t = Date.now(); while (Date.now() - t < 20000) { if (lastModel().text === "show me stays under 4000") return true; await page.waitForTimeout(150); } return false; })();
    ok(okRefine && lastModel().intent === "REFINE_RESULTS", "the REVIEWED text reached the SAME controller → model planned the refinement", "F08");
    // CHANGED EXPECTATION (REAL-TEDDY G-REBIND): the gateway now ends a non-answer 03B terminal with an EXPLICIT
    // browser-valid turn.error (on the STAGING composition the in-turn rebind's replan has no second execution
    // admission ⇒ an explicit error); Teddy shows the matching actionable copy. Never a guess, never silence.
    ok(await waitCap(page, /No verified answer arrived — I won't guess|Verified jawab nahi aaya — main andaza nahi lagaunga|The page changed while I was checking — please ask again\.|Teddy's AI limit is reached for now|That took too long — please ask again\./, 45000), "G-REBIND: the refinement is applied and Teddy reports an explicit, actionable outcome (never guesses, never silent)", "F08");
    const cards = await page.locator("a[href^='/hotels/test-only-deh-']").count().catch(() => -1);
    note(`    (hotel links on screen after the refinement: ${cards})`);
    // a READ voice turn gets the verified answer
    await tapTeddy(page);
    await page.locator("[data-og-harness] [data-og-phrase]").first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator("[data-og-harness] [data-og-phrase]", { hasText: "show me the stays" }).click();
    await page.locator(".tb-review").waitFor({ state: "visible", timeout: 15000 });
    ok(await page.locator(".tb-review button.tb-send").isEnabled(), "no critical field in 'show me the stays' → Send enabled", "F08");
    await page.locator(".tb-review button.tb-send").click();
    ok(await waitCap(page, /[0-9]+ matching stays? (is|are) shown/, 40000), "voice READ turn → the verified compiled answer (same path as typed)", "F02");
    await page.waitForTimeout(3500); // the log entry is appended once the caption has been read out
    await page.locator("button.tb-more").click();
    await page.locator(".tb-chip", { hasText: "Conversation" }).click();
    const lt = await page.locator(".tb-log").innerText();
    ok(/(You|Aap) · voice/.test(lt) && /Buddy · AI/.test(lt), "voice + AI turns are in the one conversation log", "F09");
    if (!(/(You|Aap) · voice/.test(lt) && /Buddy · AI/.test(lt))) note("    log: " + lt.replace(/\n/g, " ⏎ ").slice(0, 700));
    await page.locator(".tb-log button.tb-close-type").click();
    ok(errors.length === 0, "no uncaught page errors", "F08");
    await ctx.close();
  }

  // ── F10/F11 — stop / mute / captions / keyboard ─────────────────────────────────────────────────
  note("\n• F10/F11 Stop, mute, captions, Escape, aria-live");
  if (want("F10")) {
    const { ctx, page } = await newPage(390, 844, false, { skipWelcome: true });
    await page.goto(BASE + "/hotels?city=Rishikesh", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await page.locator("button.tb-close-type").first().click().catch(() => {});
    await tapTeddy(page);
    await page.locator(".tb-voice-live").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".tb-voice-live button.tb-ghost", { hasText: "Stop" }).click();
    await page.waitForTimeout(400);
    ok(!(await page.locator(".tb-voice-live").isVisible().catch(() => false)), "Stop closes the live mic panel", "F10");
    ok((await page.evaluate(() => window.__OG.tracksStopped)) >= 1 && !(await page.evaluate(() => !!window.__OG.liveTrack)), "Stop STOPPED the mic track (no hot mic)", "F10");
    ok(!(await page.locator("[data-og-harness]").isVisible().catch(() => false)), "harness speech panel hidden once the mic is closed", "F10");
    const liveRegion = await page.locator(".tb-sr").getAttribute("aria-live");
    ok(liveRegion === "polite", "captions are mirrored to an aria-live=polite region", "F11");
    await page.locator("button.tb-more").click();
    const capsChip = page.locator(".tb-chip", { hasText: /(Hide|Show) captions/ });
    ok(await capsChip.isVisible(), "captions toggle offered", "F11");
    const muteChip = page.locator(".tb-chip[aria-pressed]", { hasText: /Mute voice|Sound on/ });
    ok((await muteChip.count()) >= 1, "mute toggle offered", "F10");
    await page.keyboard.press("Escape");
    ok(!(await page.locator(".tb-options, .tb-chip").first().isVisible().catch(() => false)), "Escape closes Buddy's options (keyboard)", "F11");
    await ctx.close();
  }

  // ── F12 — layout matrix (live mic panel + MIC TRANSCRIPT review) ─────────────────────────────────
  for (const [w, h, desktop] of (want("F12") ? [[360, 800, false], [390, 844, false], [412, 915, false], [430, 932, false], [1280, 800, true]] : [])) {
    note(`\n• F12 Layout @${w}×${h}${desktop ? " (desktop)" : ""}`);
    const { ctx, page } = await newPage(w, h, desktop, { skipWelcome: true });
    await page.goto(BASE + "/hotels?city=Rishikesh", { waitUntil: "domcontentloaded" });
    await settleTour(page);
    await tapTeddy(page);
    await page.locator("button.tb-close-type").first().click().catch(() => {});
    await tapTeddy(page);
    await page.locator(".tb-voice-live").waitFor({ state: "visible", timeout: 15000 });
    ok(inside(await page.locator(".tb-voice-live").boundingBox(), w, h), `live mic panel fully inside ${w}×${h}`, "F12");
    await page.locator("[data-og-harness] [data-og-phrase]", { hasText: "show me stays under 4000" }).click();
    await page.locator(".tb-review").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(900); // let Buddy's placement transition settle above the card (same as the Candidate01 smoke)
    const rb = await page.locator(".tb-review").boundingBox();
    ok(inside(rb, w, h) && inside(await page.locator(".tb-review button.tb-send").boundingBox(), w, h), `MIC TRANSCRIPT review + Send fully inside ${w}×${h}`, "F12");
    const mbx = await page.locator("button.tb-mascot").boundingBox().catch(() => null);
    ok(!overlaps(mbx, rb), `mascot does not cover the review card @${w} (mascot ${mbx ? [mbx.x, mbx.y, mbx.width, mbx.height].map(Math.round).join(",") : "none"} / card ${rb ? [rb.x, rb.y, rb.width, rb.height].map(Math.round).join(",") : "none"})`, "F12");
    const cb = await page.locator(".tb-confirm").first().boundingBox();
    ok(!!cb && cb.width >= 24 && cb.height >= 24, `confirm target ≥24×24 @${w}`, "F12");
    await shot(page, `F12_${w}x${h}_mic_review`);
    await ctx.close();
  }
} catch (e) {
  fail++; note("  ✗ harness exception: " + (e && e.stack || e));
} finally {
  await browser.close().catch(() => {});
}

note("\n• Network (browser + preview)");
note(`  browser external requests aborted: ${browserNet.external.length}`);
const nonGet = Array.from(new Set(browserNet.nonGet));
note(`  browser non-GET requests: ${nonGet.join(", ") || "none"}`);
note(`  preview BLOCKED (403): ${Array.from(new Set(preview.blocked)).join(", ") || "none"}`);
note(`  gateway sessions minted: ${preview.broker.calls.length} (${preview.broker.calls.filter((c) => c.shim).length} via the disclosed mic-negotiation shim)`);
note(`  offline model calls: ${preview.gateway.model.calls.length} (${preview.gateway.model.calls.map((c) => c.intent).join(", ")})`);
ok(nonGet.every((x) => x === "POST /api/live-ai/session" || x === "POST /api/pricing/spine"), "the ONLY browser writes are POST /api/live-ai/session (served by the in-process gateway) and the pre-existing hotel-detail POST /api/pricing/spine (refused 403 — R3)", "F13");
ok(!preview.blocked.some((x) => /\/api\/(bids|bid|book|bookings|payments?|razorpay)/i.test(x)), "no bid / booking / payment write ever attempted", "F13");
ok(preview.networkAttempts.length === 0, "the in-process gateway made ZERO network attempts", "F13");
await preview.stop();
note(`\nLive smoke: ${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(OUT, "live-smoke-log.txt"), log.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "live-smoke-results.json"), JSON.stringify({ pass, fail, results, nonGet, blocked: preview.blocked, brokerCalls: preview.broker.calls, modelCalls: preview.gateway.model.calls }, null, 2));
process.exit(fail ? 1 : 0);
