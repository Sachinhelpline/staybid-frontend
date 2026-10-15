#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — Track P demo-inventory guest journey: OFFLINE browser smoke.
//
// Drives the REAL built app (next start, local only) in headless Chromium with the
// typed-only preview flags, against SYNTHETIC "TEST ONLY" hotel fixtures served by
// request interception for /api/hotels and /api/hotels/<id> ONLY. It proves the
// typed journey's UI behaviour (activation, typing, city → list → refine → 0/1/2+
// handling → open → rooms → booking guidance → dates/availability honesty) and
// logs/blocks every non-GET request. It proves NOTHING about real inventory,
// prices, availability, category membership or production behaviour.
//
// SAFETY — this script REFUSES to run unless external egress is unreachable:
//   run it inside a network namespace with ONLY loopback up, e.g. (as root)
//     unshare -n sh -c 'python3 <bring-lo-up>.py && node tests/live-ai/travel-buddy-journey-smoke.mjs <outDir>'
//   after an OFFLINE `next build` with NEXT_PUBLIC_VOICE_AI_BETA=1,
//   NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA=0, NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW=1,
//   NEXT_PUBLIC_TRAVEL_BUDDY_PREVIEW_TEXT_ONLY=1.
// Every non-GET request is ABORTED and recorded; every non-localhost request is
// ABORTED and recorded. No credentials, no env files, no real backend.
// ─────────────────────────────────────────────────────────────────────────
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.resolve(process.argv[2] || path.join(REPO, "tests/live-ai/.build/journey-smoke"));
const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROMIUM = process.env.TB_SMOKE_CHROMIUM || "/opt/pw-browsers/chromium";
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const log = [];
const note = (s) => { log.push(s); console.log(s); };
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; note("  ✓ " + l); } else { fail++; note("  ✗ " + l); } };

// ---- 0. offline guard ------------------------------------------------------------
const reach = (h, p) => new Promise((r) => {
  const s = net.connect({ host: h, port: p, timeout: 1500 });
  s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); });
});
for (const [h, p] of [["1.1.1.1", 443], ["8.8.8.8", 53]]) {
  if (await reach(h, p)) { console.error(`REFUSING: external egress to ${h}:${p} is reachable — run inside an offline namespace.`); process.exit(3); }
}
note("• offline guard: external egress unreachable (1.1.1.1:443, 8.8.8.8:53)");

// ---- 1. TEST ONLY fixtures (synthetic) ----------------------------------------------
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

// ---- 2. start the built app (local only) ------------------------------------------
const nextBin = path.join(REPO, "node_modules/next/dist/bin/next");
const srv = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: REPO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let srvOut = ""; srv.stdout.on("data", (d) => { srvOut += d; }); srv.stderr.on("data", (d) => { srvOut += d; });
const t0 = Date.now();
while (!(await reach("127.0.0.1", PORT))) { if (Date.now() - t0 > 60000) { console.error("server did not start:\n" + srvOut); srv.kill("SIGKILL"); process.exit(2); } await new Promise((r) => setTimeout(r, 300)); }
note(`• local server up at ${BASE}`);

const net_log = { nonGetBlocked: [], externalBlocked: [], fixtureServed: [], passedThrough: 0 };
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

async function newPage(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-IN" });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem("sb_welcome_shown", "1"); } catch {}
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
// Captions arrive as ≤2-line chunks; join them (speaker labels removed) so a sentence split across chunks still matches.
const caps = (page) => page.evaluate(() => window.__caps.map((c) => c.replace(/^(Buddy|Note|Aap|You): /, "")).join(" "));
const rawCaps = (page) => page.evaluate(() => window.__caps.join("\n"));
async function waitCap(page, re, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const c = await caps(page); if (re.test(c)) return true; await page.waitForTimeout(150); }
  return false;
}
async function activate(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const m = page.locator("button.tb-mascot:not(.is-default)");
  await m.waitFor({ state: "visible", timeout: 30000 });
  await m.click();
}
async function typeTurn(page, text) {
  const input = page.locator("input.tb-input");
  // Existing C01 behaviour: after ~22 s of quiet Buddy rests (standby) and the typing row closes;
  // ONE tap on the mascot brings it back (typed-only preview → typing row).
  if (!(await input.isVisible().catch(() => false))) {
    // Accepted C01 F1: on a crowded page Buddy may be parked as an edge tab — one tap restores it.
    const tab = page.locator("button.tb-edge-tab");
    if (!(await page.locator("button.tb-mascot").isVisible().catch(() => false)) && (await tab.isVisible().catch(() => false))) await tab.click();
    await page.locator("button.tb-mascot").click({ timeout: 15000 });
    if (!(await input.isVisible().catch(() => false))) {
      await page.waitForTimeout(400);
      if (!(await input.isVisible().catch(() => false))) await page.locator("button.tb-mascot").click();
    }
  }
  await input.waitFor({ state: "visible", timeout: 15000 });
  await input.fill(text);
  await input.press("Enter");
}
const dumpCaps = async (page, label) => { note(`    [captions @ ${label}] ` + (await rawCaps(page)).split("\n").slice(-10).join(" ⏎ ")); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png") });

try {
  // ---- 3. main journey @ 390 × 844 -------------------------------------------------
  note("\n• Journey @390×844 (typed-only preview, TEST ONLY fixtures)");
  {
    const { ctx, page, errors } = await newPage(390, 844);
    await activate(page);
    ok(await page.locator("input.tb-input").isVisible().catch(() => false), "activation tap opens the typed input directly (no mic)");
    ok(await waitCap(page, /typed preview/), "typed-preview note shown (no 'browser has no voice' message)");
    ok(!/Voice input isn't available|Mic on/.test(await caps(page)), "no microphone/voice hint in typed-only mode");
    await shot(page, "01_390_activated_home");
    await typeTurn(page, "Mussoorie mein 5000 tak parking wala hotel");
    await page.waitForURL(/\/hotels\?city=Mussoorie/, { timeout: 20000 });
    ok(true, "city typed on home → native /hotels?city=Mussoorie");
    ok(await waitCap(page, /1 stay screen par hai: TEST ONLY Ridge Stay/, 40000), "1-result caption names the single (TEST ONLY) stay after budget+parking apply");
    ok(await waitCap(page, /demo listings/), "small demo-inventory note shown");
    ok(!/Note: Note:/.test(await rawCaps(page)), "demo note label not doubled ('Note: Note:')");
    await shot(page, "02_390_mussoorie_one_result");
    await typeTurn(page, "top do compare karo");
    ok(await waitCap(page, /sirf ek stay hai/), "compare on a one-stay list → honest 'only one', no fabricated second hotel");
    await typeTurn(page, "isko kholo");
    await page.waitForURL(/\/hotels\/test-only-mus-1/, { timeout: 20000 });
    ok(true, "'isko kholo' opens the native hotel detail page");
    await typeTurn(page, "rooms dikhao");
    const roomsOk = await waitCap(page, /2 room type listed: TEST Deluxe, TEST Family Suite/, 40000);
    ok(roomsOk, "rooms guidance names the loaded room types (no rate claim)");
    if (!roomsOk) { await dumpCaps(page, "rooms"); await shot(page, "03x_390_detail_rooms_FAILED"); }
    await shot(page, "03_390_detail_rooms");
    await typeTurn(page, "is hotel par bid lagao");
    ok(await waitCap(page, /submit nahi karta/) && await waitCap(page, /demo inventory/), "bid request → guidance only + demo caveat");
    await typeTurn(page, "18 October, 2 log, room available hai?");
    ok(await waitCap(page, /availability ya room capacity confirm nahi/i), "dates/guests noted only; availability + capacity unconfirmed");
    await shot(page, "04_390_detail_guidance");
    ok(errors.length === 0, `no uncaught page errors (${errors.length})`);
    if (errors.length) note("    page errors: " + errors.slice(0, 3).join(" | "));
    ok(((await rawCaps(page)).match(/demo listings/g) || []).length === 1, "demo note shown exactly ONCE across the whole session (list + detail)");
    await dumpCaps(page, "end of main journey");
    await ctx.close();
  }
  note("\n• 2-result and 0-result cities + unknown place @390×844");
  {
    const { ctx, page } = await newPage(390, 844);
    await activate(page);
    await typeTurn(page, "Rishikesh ke hotels dikhao");
    await page.waitForURL(/\/hotels\?city=Rishikesh/, { timeout: 20000 });
    ok(await waitCap(page, /2 stays screen par hain/, 40000), "2-result caption (count + compare hint)");
    await typeTurn(page, "top do compare karo");
    ok(await waitCap(page, /Top do mein — sasta: TEST ONLY River Stay; behtar rating: TEST ONLY Ganga View/), "2+ results: grounded compare of the visible top two");
    await shot(page, "05_390_rishikesh_compare");
    await typeTurn(page, "Goa");
    const goaOk = await waitCap(page, /(Goa mein abhi koi StayBid stay listed nahi hai|No StayBid stays are listed in Goa right now)/, 40000);
    ok(goaOk, "0-result (no filter) → honest 'none listed' + another destination (EN or Hinglish)");
    await page.waitForTimeout(2500);
    ok(!/(To open an option, just say its number|Kisi option ko kholna ho)/.test((await caps(page)).split(/Goa/).pop()), "no 'open an option' follow-up after a 0-result list");
    if (!goaOk) {
      await dumpCaps(page, "goa");
      note("    [dom] " + await page.evaluate(() => { const r = document.querySelector(".tb-root"); return (r ? Array.from(r.querySelectorAll("button,input")).map((e) => e.className + (e.offsetParent ? "" : "(hidden)")).join(", ") : "no .tb-root") + " | url=" + location.pathname + location.search; }));
      await shot(page, "06x_390_goa_FAILED");
    }
    await shot(page, "06_390_goa_zero");
    const urlBeforeUnknown = page.url();
    await typeTurn(page, "Delhi ke hotels dikhao");
    ok(await waitCap(page, /"Delhi" abhi StayBid ki destination list mein nahi hai/), "unknown destination → honest, no navigation");
    ok(page.url() === urlBeforeUnknown, "unknown destination did not navigate (URL unchanged)");
    await typeTurn(page, "StayBid Circle wale hotel dikhao");
    ok(await waitCap(page, /category ka filter Buddy mein nahi hai/), "category request → honest 'no category filter'");
    await dumpCaps(page, "end of 0/2/unknown journey");
    await ctx.close();
  }
  // ---- 4. layout spot checks @360 / @412 / @430 ------------------------------------------------
  for (const [w, h] of [[360, 780], [412, 915], [430, 932]]) {
    note(`\n• Layout @${w}×${h}`);
    const { ctx, page } = await newPage(w, h);
    await activate(page);
    const ib = await page.locator("input.tb-input").boundingBox();
    ok(!!ib && ib.x >= 0 && ib.x + ib.width <= w && ib.y >= 0 && ib.y + ib.height <= h, `typed input fully inside the ${w}px viewport`);
    const mb = await page.locator("button.tb-mascot").boundingBox();
    const overlap = !!ib && !!mb && !(mb.x + mb.width <= ib.x || ib.x + ib.width <= mb.x || mb.y + mb.height <= ib.y || ib.y + ib.height <= mb.y);
    ok(!overlap, `mascot does not cover the typed input @${w}`);
    await typeTurn(page, "Mussoorie");
    await page.waitForURL(/\/hotels\?city=Mussoorie/, { timeout: 20000 });
    ok(await waitCap(page, /(1 stay screen par hai|1 stay on screen in Mussoorie): TEST ONLY Ridge Stay/, 40000), `journey caption @${w} (EN or Hinglish)`);
    await shot(page, `07_${w}_mussoorie`);
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
ok(!net_log.nonGetBlocked.some((x) => /\/api\/(bids|bid|book|payments?|razorpay|live-ai)/i.test(x)), "no Buddy-originated bid/booking/payment/live-ai write attempted");
note(`\nJourney smoke: ${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(OUT, "journey-smoke-log.txt"), log.join("\n") + "\n\nSERVER LOG (tail):\n" + srvOut.slice(-4000));
process.exit(fail ? 1 : 0);
