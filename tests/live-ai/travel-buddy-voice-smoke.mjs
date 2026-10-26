#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — INTEGRATED TEXT + VOICE offline candidate: browser smoke.
//
// Drives the REAL built app (next start, loopback only) in headless Chromium with the
// SIMULATED demo-voice flags, against SYNTHETIC "TEST ONLY" hotel fixtures served by
// request interception for /api/hotels and /api/hotels/<id> ONLY. Proves UI behaviour:
// simulated-mic consent (allow / deny), sample phrase → simulated transcript → review /
// edit / confirm → the SAME shared turn as typing, typed ≡ voice captions, the shared
// conversation log, error / cancel / stop, demo labelling, and layout at 360×800, 390×844,
// 412×915, 430×932 and 1280×800. It proves NOTHING about real speech recognition, real AI,
// real inventory, prices, availability or production behaviour.
//
// SAFETY — REFUSES to run unless external egress is unreachable (run inside a network
// namespace with ONLY loopback up). Build first, OFFLINE, with:
//   NEXT_PUBLIC_VOICE_AI_BETA=1 NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA=0
//   NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW=1 NEXT_PUBLIC_TRAVEL_BUDDY_DEMO_VOICE=1
//   (NEXT_PUBLIC_TRAVEL_BUDDY_PREVIEW_TEXT_ONLY / _BROWSER_STT / _DEVICE_TTS unset)
// Every non-GET and every non-loopback request is ABORTED and recorded.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(REPO, "tests/live-ai/.build/voice-smoke"));
const PORT = 3919;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = process.env.TB_SMOKE_CHROMIUM || "/opt/pw-browsers/chromium";
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const log = [];
const note = (s) => { log.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; note("  ✓ " + l); } else { fail++; note("  ✗ " + l); } };

const reach = (h, p) => new Promise((r) => {
  const s = net.connect({ host: h, port: p, timeout: 1500 });
  s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); });
});
for (const [h, p] of [["1.1.1.1", 443], ["8.8.8.8", 53]]) {
  if (await reach(h, p)) { console.error(`REFUSING: external egress to ${h}:${p} is reachable — run inside an offline namespace.`); process.exit(3); }
}
note("• offline guard: external egress unreachable (1.1.1.1:443, 8.8.8.8:53)");

// ---- TEST ONLY fixtures (synthetic; same shapes as the accepted Track P smoke) ----
const room = (hid, n, name, price, cap) => ({ id: `${hid}-r${n}`, hotelId: hid, type: "STANDARD", name, capacity: cap, floorPrice: price, mrp: price + 1000, flashFloorPrice: null, images: [], amenities: [] });
const hotel = (id, name, city, price, extra) => ({
  id, name, city, state: "TEST", lat: null, lng: null, starRating: 4, avgRating: 4.4, totalReviews: 0, images: [],
  amenities: ["Parking", "Breakfast"], trustBadge: null, createdAt: "2026-01-01T00:00:00Z", ownerId: "owner_test_only",
  property_type: "resort", meal_plans: [], addon_services: [], rooms: [room(id, 1, "TEST Deluxe", price, 2), room(id, 2, "TEST Family Suite", price + 1800, 4)],
  ...(extra || {}),
});
const FIX = {
  mussoorie: [hotel("test-only-mus-1", "TEST ONLY Ridge Stay", "Mussoorie", 4500, { ownerId: "hco_test_only", owner_type: "host_circle" })],
  rishikesh: [
    hotel("test-only-ris-1", "TEST ONLY River Stay", "Rishikesh", 3900, { avgRating: 4.2, amenities: ["Parking"] }),
    hotel("test-only-ris-2", "TEST ONLY Ganga View", "Rishikesh", 5200, { avgRating: 4.8, amenities: ["WiFi"], account_type: "staybid_operated" }),
  ],
  goa: [],
};
const byId = Object.fromEntries(Object.values(FIX).flat().map((h) => [h.id, h]));

const nextBin = path.join(REPO, "node_modules/next/dist/bin/next");
const srv = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: REPO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let srvOut = ""; srv.stdout.on("data", (d) => { srvOut += d; }); srv.stderr.on("data", (d) => { srvOut += d; });
const t0 = Date.now();
while (!(await reach("127.0.0.1", PORT))) { if (Date.now() - t0 > 60000) { console.error("server did not start:\n" + srvOut); srv.kill("SIGKILL"); process.exit(2); } await new Promise((r) => setTimeout(r, 300)); }
note(`• local server up at ${BASE}`);

const net_log = { nonGetBlocked: [], externalBlocked: [], fixtureServed: [], passedThrough: 0 };
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

async function newPage(w, h, desktop = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: desktop ? 1 : 2, isMobile: !desktop, hasTouch: !desktop, locale: "en-IN" });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem("sb_welcome_shown", "1"); } catch {}
    // The app's own pre-existing driver.js page tour overlays /hotels on a first visit and intercepts
    // every tap (Buddy's panels included). QA uses the app's existing opt-out key (R2 in the report).
    try { localStorage.setItem("sb_tutorial_disabled", "1"); } catch {}
    // Prove no real speech APIs are touched: trap SpeechRecognition / speechSynthesis / getUserMedia.
    window.__speechTouched = [];
    const trapCtor = (n) => function () { window.__speechTouched.push(n); throw new Error("blocked in smoke: " + n); };
    try { window.SpeechRecognition = trapCtor("SpeechRecognition"); window.webkitSpeechRecognition = trapCtor("webkitSpeechRecognition"); } catch {}
    try { if (window.speechSynthesis) { window.speechSynthesis.speak = () => window.__speechTouched.push("speechSynthesis.speak"); window.speechSynthesis.cancel = () => window.__speechTouched.push("speechSynthesis.cancel"); } } catch {}
    try { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__speechTouched.push("getUserMedia"); return Promise.reject(new Error("blocked")); }; } catch {}
    window.__caps = [];
    let last = "";
    setInterval(() => { const el = document.querySelector(".tb-sr"); const t = el ? el.textContent || "" : ""; if (t && t !== last) { last = t; window.__caps.push(t); } }, 60);
  });
  await ctx.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") { net_log.externalBlocked.push(`${m} ${u.origin}${u.pathname}`); return route.abort("blockedbyclient"); }
    if (m !== "GET" && m !== "HEAD") { net_log.nonGetBlocked.push(`${m} ${u.pathname}`); return route.abort("blockedbyclient"); }
    if (u.pathname === "/api/hotels") {
      const c = (u.searchParams.get("city") || "").toLowerCase();
      const list = FIX[c] || [];
      net_log.fixtureServed.push(`GET /api/hotels?city=${c} → ${list.length} TEST ONLY`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hotels: list, total: list.length }) });
    }
    const dm = u.pathname.match(/^\/api\/hotels\/([^/]+)$/);
    if (dm && byId[decodeURIComponent(dm[1])]) {
      const h = byId[decodeURIComponent(dm[1])];
      net_log.fixtureServed.push(`GET /api/hotels/${h.id} TEST ONLY`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hotel: { ...h, reviews: [], individualRooms: false, roomListings: [] } }) });
    }
    net_log.passedThrough++;
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return { ctx, page, errors };
}
const caps = (page) => page.evaluate(() => window.__caps.map((c) => c.replace(/^(Buddy|Note|Aap|You): /, "")).join(" "));
const rawCaps = (page) => page.evaluate(() => window.__caps.join("\n"));
async function waitCap(page, re, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const c = await caps(page); if (re.test(c)) return true; await page.waitForTimeout(150); }
  return false;
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png") });
const inside = (b, w, h) => !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
const overlaps = (a, b) => !!a && !!b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function activate(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const m = page.locator("button.tb-mascot:not(.is-default)");
  await m.waitFor({ state: "visible", timeout: 30000 });
  await m.click();
}
async function allowMic(page) {
  await page.locator(".tb-voice").waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".tb-voice button.tb-send").click();   // "Allow demo mic"
  await page.locator(".tb-phrase").first().waitFor({ state: "visible", timeout: 15000 });
}
/** Ensure the simulated-voice panel is listening (reopen by tapping Buddy if it went to standby). */
async function ensureListening(page) {
  // After a VOICE turn Buddy re-opens the (simulated) mic by itself once its captions finish.
  const phrase = page.locator(".tb-phrase").first();
  const t = Date.now();
  while (Date.now() - t < 30000) {
    if (await phrase.isVisible().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  const tab = page.locator("button.tb-edge-tab");
  if (!(await page.locator("button.tb-mascot").isVisible().catch(() => false)) && (await tab.isVisible().catch(() => false))) await tab.click();
  await page.locator("button.tb-mascot").click({ timeout: 15000 });
  await page.locator(".tb-phrase").first().waitFor({ state: "visible", timeout: 15000 });
}
async function speak(page, said) {
  await ensureListening(page);
  await page.locator(".tb-phrase", { hasText: said }).first().click();
  await page.locator(".tb-review").waitFor({ state: "visible", timeout: 15000 });
}
async function openType(page) {
  if (await page.locator("input.tb-input").isVisible().catch(() => false)) return;
  await page.locator("button.tb-more").click();
  await page.locator(".tb-chip", { hasText: "Type instead" }).click();
  await page.locator("input.tb-input").waitFor({ state: "visible", timeout: 10000 });
}

try {
  // ---- A. voice journey @390×844 -----------------------------------------------------
  note("\n• A. Simulated voice journey @390×844 (TEST ONLY fixtures)");
  {
    const { ctx, page, errors } = await newPage(390, 844);
    await activate(page);
    ok(await page.locator(".tb-voice").isVisible(), "activation tap opens the simulated-mic CONSENT card (no real mic)");
    ok(/SIMULATED VOICE · demo/.test(await page.locator(".tb-voice .tb-panel-tag").innerText()), "consent card labelled SIMULATED VOICE · demo · not real AI");
    ok(await waitCap(page, /Demo voice: mic simulated hai|Demo voice: the microphone is simulated/), "activation note: the microphone is simulated, nothing recorded or sent");
    await shot(page, "A1_390_consent");
    await allowMic(page);
    ok((await page.locator(".tb-phrase").count()) >= 5, "listening (simulated) panel offers sample phrases");
    await shot(page, "A2_390_listening");
    await speak(page, "Mussoorie mein 5000 tak parking wala hotel");
    const draft = await page.locator("input.tb-input-review").inputValue();
    ok(draft === "Mussoorie mein 5000 tak parking wala hotel", "review card shows the transcript VERBATIM and editable");
    const fields = await page.locator(".tb-field").allInnerTexts();
    ok(fields.some((f) => /Mussoorie/.test(f)) && fields.some((f) => /₹5,000/.test(f)), "critical fields shown for review (destination, ₹5,000)");
    ok(await page.locator(".tb-review button.tb-send").isEnabled(), "high-confidence transcript: Send enabled");
    ok(/SIMULATED TRANSCRIPT/.test(await page.locator(".tb-review .tb-panel-tag").innerText()), "review labelled SIMULATED TRANSCRIPT");
    await shot(page, "A3_390_review");
    await page.locator(".tb-review button.tb-send").click();
    await page.waitForURL(/\/hotels\?city=Mussoorie/, { timeout: 20000 });
    ok(true, "reviewed voice turn → native /hotels?city=Mussoorie (same shared path as typing)");
    ok(await waitCap(page, /1 stay screen par hai: TEST ONLY Ridge Stay/, 40000), "voice turn: 1-result caption names the single TEST ONLY stay");
    await waitCap(page, /1 stay screen par hai: TEST ONLY Ridge Stay[^.]*\./, 20000); // the whole sentence, not just its first chunk
    const voiceCaption = (await caps(page)).match(/[^.]*1 stay screen par hai: TEST ONLY Ridge Stay[^.]*\./);
    if (!voiceCaption) note(`    voice caps: ${(await rawCaps(page)).split("\n").slice(-8).join(" ⏎ ")}`);
    ok(await waitCap(page, /demo listings/), "demo-inventory note shown");
    await speak(page, "Isko kholo");
    await page.locator(".tb-review button.tb-send").click();
    await page.waitForURL(/\/hotels\/test-only-mus-1/, { timeout: 20000 });
    ok(true, "voice 'Isko kholo' → reviewed → native hotel detail");
    await page.waitForTimeout(6000);
    ok(!/Kisi option ko kholna ho toh bas uska number boliye/.test((await caps(page)).split("khol raha hoon").pop()), "after opening a stay Buddy asks no incoherent 'say its number' follow-up");
    await speak(page, "Rooms dikhao");
    await page.locator(".tb-review button.tb-send").click();
    ok(await waitCap(page, /2 room type listed: TEST Deluxe, TEST Family Suite/, 40000), "voice 'Rooms dikhao' → rooms guidance (names only, no rate claim)");
    await speak(page, "Is hotel par bid lagao");
    await page.locator(".tb-review button.tb-send").click();
    ok(await waitCap(page, /submit nahi karta/), "voice bid request → guidance only (never a write)");
    await shot(page, "A4_390_detail_voice");
    // Shared conversation log.
    await page.locator("button.tb-more").click();
    await page.locator(".tb-chip", { hasText: "Conversation" }).click();
    await page.locator(".tb-log").waitFor({ state: "visible", timeout: 10000 });
    const logText = await page.locator(".tb-log").innerText();
    ok(/voice \(simulated\)/.test(logText) && /Buddy · demo/.test(logText), "conversation log shows simulated-voice turns and demo Buddy replies in ONE list");
    ok((logText.match(/voice \(simulated\)/g) || []).length >= 4, "all 4 voice turns are in the shared log");
    await shot(page, "A5_390_conversation_log");
    await page.locator(".tb-log button.tb-close-type").click();
    // Typed turn joins the SAME conversation.
    await openType(page);
    await page.locator("input.tb-input").fill("breakfast hai?");
    await page.locator("input.tb-input").press("Enter");
    ok(await waitCap(page, /listing mein breakfast hai/, 30000), "typed follow-up on the same page → grounded fact from the same session");
    await page.locator("button.tb-more").click();
    await page.locator(".tb-chip", { hasText: "Conversation" }).click();
    const log2 = await page.locator(".tb-log").innerText();
    ok(/typed/.test(log2) && /voice \(simulated\)/.test(log2), "typed + voice turns interleave in ONE conversation log");
    await page.locator(".tb-log button.tb-close-type").click();
    const touched = await page.evaluate(() => window.__speechTouched);
    ok(touched.length === 0, `no real SpeechRecognition / speechSynthesis / getUserMedia touched (${touched.join(",") || "none"})`);
    ok(errors.length === 0, `no uncaught page errors (${errors.length})`);
    if (errors.length) note("    page errors: " + errors.slice(0, 3).join(" | "));
    await ctx.close();

    // Typed equivalence on a fresh session: the SAME words typed give the SAME caption.
    const t = await newPage(390, 844);
    await activate(t.page);
    await allowMic(t.page);
    await t.page.locator(".tb-voice .tb-ghost", { hasText: "Cancel" }).last().click();
    await openType(t.page);
    await t.page.locator("input.tb-input").fill("Mussoorie mein 5000 tak parking wala hotel");
    await t.page.locator("input.tb-input").press("Enter");
    await t.page.waitForURL(/\/hotels\?city=Mussoorie/, { timeout: 20000 });
    ok(await waitCap(t.page, /1 stay screen par hai: TEST ONLY Ridge Stay/, 40000), "typed: same words → same navigation");
    await waitCap(t.page, /1 stay screen par hai: TEST ONLY Ridge Stay[^.]*\./, 20000); // the whole sentence, not just its first chunk
    const typedCaption = (await caps(t.page)).match(/[^.]*1 stay screen par hai: TEST ONLY Ridge Stay[^.]*\./);
    ok(!!voiceCaption && !!typedCaption && voiceCaption[0].trim() === typedCaption[0].trim(), "typed ≡ voice: identical grounded result caption");
    if (!(voiceCaption && typedCaption && voiceCaption[0].trim() === typedCaption[0].trim())) note(`    voice: ${voiceCaption && voiceCaption[0]} | typed: ${typedCaption && typedCaption[0]} | typed caps: ${(await rawCaps(t.page)).split("\n").slice(-8).join(" ⏎ ")}`);
    await t.ctx.close();
  }

  // ---- B. low confidence / mis-hearing / confirm / edit ------------------------------
  note("\n• B. Critical-field review — mis-heard budget, low confidence, confirm @390×844");
  {
    const { ctx, page } = await newPage(390, 844);
    await activate(page);
    await allowMic(page);
    await speak(page, "Hotels in Goa under 6000");
    ok((await page.locator("input.tb-input-review").inputValue()) === "hotels in goa under 9000", "mis-heard transcript shown verbatim (9000) — not auto-corrected");
    ok(await page.locator(".tb-review button.tb-send").isDisabled(), "low confidence: Send DISABLED until confirmation");
    ok(await page.locator(".tb-warn").isVisible(), "warning asks to confirm / edit; says nothing is corrected automatically");
    ok((await page.locator(".tb-field.is-pending").count()) >= 2, "destination and budget both flagged");
    await shot(page, "B1_390_review_flagged");
    await page.locator("input.tb-input-review").fill("hotels in goa under 6000");
    const budget = await page.locator(".tb-field", { hasText: "₹6,000" }).innerText();
    ok(/heard ₹9,000|suna: ₹9,000/.test(budget) && /edited by you|aapne badla/.test(budget), "guest edit shows the new ₹6,000 AND what was heard (₹9,000)");
    ok(await page.locator(".tb-review button.tb-send").isDisabled(), "destination still pending → still disabled");
    await page.locator(".tb-field.is-pending button.tb-confirm").first().click();
    ok(await page.locator(".tb-review button.tb-send").isEnabled(), "after confirming destination → Send enabled");
    await shot(page, "B2_390_review_confirmed");
    await page.locator(".tb-review button.tb-send").click();
    await page.waitForURL(/\/hotels\?city=Goa/, { timeout: 20000 });
    ok(await waitCap(page, /(Goa mein|in Goa).*(koi|No)/, 40000), "Goa → honest 0-result caption (filtered or not listed)");
    await ctx.close();
  }

  // ---- C. deny / errors / cancel / stop ----------------------------------------------
  note("\n• C. Mic denied, simulated errors, cancel, stop @390×844");
  {
    const { ctx, page } = await newPage(390, 844);
    await activate(page);
    await page.locator(".tb-voice").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".tb-voice .tb-ghost", { hasText: /Abhi nahi|Not now/ }).click();
    ok(await page.locator("input.tb-input").isVisible(), "mic 'Not now' → typed input opens (honest fallback)");
    ok(await waitCap(page, /mic nahi|no microphone/i), "denial explained; nothing listens");
    ok(!(await page.locator(".tb-voice").isVisible().catch(() => false)), "no voice panel after denial");
    await page.locator("input.tb-input").fill("Rishikesh ke hotels dikhao");
    await page.locator("input.tb-input").press("Enter");
    await page.waitForURL(/\/hotels\?city=Rishikesh/, { timeout: 20000 });
    ok(await waitCap(page, /2 stays screen par hain/, 40000), "typed path fully works after a mic denial (2-result caption)");
    await page.locator("button.tb-more").click();
    ok(await page.locator(".tb-chip", { hasText: "Try mic again" }).isVisible(), "'Try mic again' offered after denial");
    await page.locator(".tb-chip", { hasText: "Try mic again" }).click();
    await allowMic(page);
    await page.locator(".tb-test").first().click();          // Test: no speech
    ok(await waitCap(page, /Kuch sunai nahi diya \(simulated\)|didn't hear anything \(simulated\)/), "simulated 'no speech' → honest note, no turn");
    await ensureListening(page);
    await page.locator(".tb-test").nth(1).click();           // Test: voice error
    ok(await waitCap(page, /simulated error/), "simulated engine error → honest note + typed fallback hint");
    await ensureListening(page);
    await page.locator(".tb-phrase").first().click();
    await page.locator(".tb-voice .tb-ghost", { hasText: "Cancel" }).click();  // cancel during "hearing…"
    await page.waitForTimeout(1200);
    ok(!(await page.locator(".tb-review").isVisible().catch(() => false)), "Cancel during 'hearing…' → no transcript, nothing sent");
    await openType(page);
    await page.locator("input.tb-input").fill("Mussoorie");
    await page.locator("input.tb-input").press("Enter");
    const stop = page.locator("button.tb-stop");
    await stop.waitFor({ state: "visible", timeout: 10000 });
    await stop.click();
    ok(await waitCap(page, /Ruk gaya|Stopped/), "Stop button cancels the in-flight turn (caption 'Stopped')");
    await shot(page, "C1_390_after_stop");
    await ctx.close();
  }

  // ---- D. layout matrix ----------------------------------------------------------------
  for (const [w, h, desktop] of [[360, 800, false], [390, 844, false], [412, 915, false], [430, 932, false], [1280, 800, true]]) {
    note(`\n• D. Layout @${w}×${h}${desktop ? " (desktop)" : ""}`);
    const { ctx, page } = await newPage(w, h, desktop);
    await activate(page);
    const cb = await page.locator(".tb-voice").boundingBox();
    ok(inside(cb, w, h), `consent card fully inside ${w}×${h}`);
    await allowMic(page);
    const lb = await page.locator(".tb-voice").boundingBox();
    ok(inside(lb, w, h), `listening panel fully inside ${w}×${h}`);
    await speak(page, "Rishikesh mein do log, budget teen hazaar");
    await page.waitForTimeout(500);
    const rb = await page.locator(".tb-review").boundingBox();
    const sb = await page.locator(".tb-review button.tb-send").boundingBox();
    ok(inside(rb, w, h) && inside(sb, w, h), `review card + Send fully inside ${w}×${h}`);
    const mb = await page.locator("button.tb-mascot").boundingBox().catch(() => null);
    ok(!overlaps(mb, rb), `mascot does not cover the review card @${w}`);
    const confirms = page.locator(".tb-confirm");
    const nConfirm = await confirms.count();
    ok(nConfirm >= 3, `noisy transcript: ${nConfirm} critical fields await confirmation @${w}`);
    const tb = await confirms.first().boundingBox();
    ok(!!tb && tb.height >= 24 && tb.width >= 24, `confirm targets ≥24×24 @${w}`);
    await shot(page, `D_${w}x${h}_review`);
    await ctx.close();
  }
} catch (e) {
  fail++; note("  ✗ harness exception: " + (e && e.stack || e));
} finally {
  await browser.close().catch(() => {});
  srv.kill("SIGTERM");
}

note("\n• Network log (browser side)");
note(`  fixtures served: ${net_log.fixtureServed.length} (${Array.from(new Set(net_log.fixtureServed)).join("; ")})`);
note(`  non-GET requests BLOCKED: ${net_log.nonGetBlocked.length}${net_log.nonGetBlocked.length ? " → " + Array.from(new Set(net_log.nonGetBlocked)).join(", ") : ""}`);
note(`  external requests BLOCKED: ${net_log.externalBlocked.length}${net_log.externalBlocked.length ? " → " + Array.from(new Set(net_log.externalBlocked)).slice(0, 12).join(", ") : ""}`);
note(`  same-origin GETs passed to the local (offline) server: ${net_log.passedThrough}`);
ok(!net_log.nonGetBlocked.some((x) => /\/api\/(bids|bid|book|payments?|razorpay|live-ai|voice)/i.test(x)), "no Buddy-originated bid/booking/payment/live-ai/voice write attempted");
ok(net_log.nonGetBlocked.every((x) => /^POST \/api\/pricing\/spine$/.test(x)), "the ONLY blocked writes are the pre-existing hotel-detail /api/pricing/spine POST (R1, isolated)");
note(`\nVoice smoke: ${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(OUT, "voice-smoke-log.txt"), log.join("\n") + "\n\nSERVER LOG (tail):\n" + srvOut.slice(-4000));
process.exit(fail ? 1 : 0);
