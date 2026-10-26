#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — SCREEN-FIRST UX PREVIEW — deterministic test suite.
//
//   Run:  node tests/live-ai/travel-buddy.test.js
//
// Compiles the PURE lib/live-ai/*.ts + lib/travel-buddy/*.ts + lib/launch/
// curation.ts with the LOCKFILE-INSTALLED local tsc (strict) and drives:
//   • the gate (V/P/flag matrix) and surface mapping;
//   • the Hindi/Hinglish/English parser and the turn planner;
//   • EVERY planned operation through the REAL closed validator + the REAL
//     runtime envelope path against a page registration whose getSnapshot is
//     the PRODUCTION buildHotelsSnapshot / buildHotelDetailSnapshot;
//   • no-write guarantees (booking/bid/payment never produce a write op);
//   • navigation allow-list (no free-form URL);
//   • server-render proofs: feature OFF ⇒ nothing; preview ON ⇒ one activator,
//     no dialog/popup/scrim, and the legacy orb is suppressed (single owner).
// NO network, NO provider, NO DB, NO browser.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "travel-buddy");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
for (const d of ["live-ai", "travel-buddy", "launch", "tutorial"]) fs.mkdirSync(path.join(SRC, d), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
fs.copyFileSync(path.join(REPO, "lib/travel-buddy/conversation.ts"), path.join(SRC, "travel-buddy", "conversation.ts"));
fs.copyFileSync(path.join(REPO, "lib/travel-buddy/mascots.ts"), path.join(SRC, "travel-buddy", "mascots.ts"));
// Integrated TEXT + VOICE candidate: the voice I/O adapter seam + shared session model.
fs.copyFileSync(path.join(REPO, "lib/travel-buddy/voice-io.ts"), path.join(SRC, "travel-buddy", "voice-io.ts"));
fs.copyFileSync(path.join(REPO, "lib/travel-buddy/session.ts"), path.join(SRC, "travel-buddy", "session.ts"));
fs.copyFileSync(path.join(REPO, "lib/launch/curation.ts"), path.join(SRC, "launch", "curation.ts"));
// Live-controller candidate: the transcript-review bridge + the tutorial coordination seam.
fs.copyFileSync(path.join(REPO, "lib/travel-buddy/live-bridge.ts"), path.join(SRC, "travel-buddy", "live-bridge.ts"));
fs.copyFileSync(path.join(REPO, "lib/tutorial/buddy-coordination.ts"), path.join(SRC, "tutorial", "buddy-coordination.ts"));
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
    moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
    typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
    lib: ["es2020", "dom"], noEmitOnError: true, strict: true,
  },
  include: ["live-ai/**/*.ts", "travel-buddy/**/*.ts", "launch/**/*.ts", "tutorial/**/*.ts"],
}));
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (strict): exit 0");

process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const C = require(path.join(OUT, "live-ai/contracts.js"));
const R = require(path.join(OUT, "live-ai/runtime.js"));
const TB = require(path.join(OUT, "travel-buddy/conversation.js"));
const MAS = require(path.join(OUT, "travel-buddy/mascots.js"));
const CUR = require(path.join(OUT, "launch/curation.js"));
const CITIES = Array.from(new Set(CUR.LAUNCH_ZONES.reduce((a, z) => a.concat(z.cities), [])));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const P = (t, lang) => TB.parseUtterance(t, CITIES, lang);
const homeCtx = { surface: "home", listDestination: null, listMaxPrice: null, listParking: false, listReady: false, visibleCount: 0, detailValidated: false };
const listCtx = (o) => Object.assign({ surface: "hotels", listDestination: null, listMaxPrice: null, listParking: false, listReady: true, visibleCount: 3, detailValidated: false }, o || {});
const detailCtx = { surface: "hotel-detail", listDestination: null, listMaxPrice: null, listParking: false, listReady: false, visibleCount: 0, detailValidated: true };
const plan = (t, ctx, slots) => TB.planTurn(P(t), ctx, slots || TB.emptySlots(), CITIES);
const ops = (pl) => pl.steps.filter((s) => s.kind === "op").map((s) => s.op);
const WRITE_WORDS = /book|bid|pay|reserve|confirm|message|account|delete|update_user|checkout/i;

section("Gate — preview presentation only; never provider enablement");
{
  eq(TB.resolveTravelBuddyGate(true, false, "1"), true, "V=1,P=0,flag=1 → ON");
  eq(TB.resolveTravelBuddyGate(false, false, "1"), false, "V=0 → OFF");
  eq(TB.resolveTravelBuddyGate(true, true, "1"), false, "P=1 → OFF (provider path keeps the orb)");
  eq(TB.resolveTravelBuddyGate(true, false, undefined), false, "flag unset → OFF");
  eq(TB.resolveTravelBuddyGate(true, false, "true"), false, "flag 'true' (not exactly '1') → OFF");
  eq(TB.resolveTravelBuddyGate(true, false, " 1"), false, "flag ' 1' → OFF");
  delete process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW;
  eq(TB.resolveTravelBuddyGate(true, false), false, "default param reads env; unset → OFF");
}

section("Surfaces — only Stage home, /hotels, /hotels/[id]");
{
  eq(TB.surfaceForPath("/"), "home", "/ → home");
  eq(TB.surfaceForPath("/hotels"), "hotels", "/hotels → hotels");
  eq(TB.surfaceForPath("/hotels/hco-seed-mus"), "hotel-detail", "/hotels/:id → detail");
  for (const p of ["/bid", "/discover", "/reels", "/voice-demo", "/admin", "/hotels/a/b", "/my-bids", "/partner/dashboard"]) eq(TB.surfaceForPath(p), "other", `${p} → other (Buddy absent)`);
}

section("Parser — Hindi / Hinglish / English");
{
  const a = P("Family ke saath Mussoorie jana hai");
  eq([a.city, a.family, a.lang], ["mussoorie", true, "hinglish"], "Hinglish destination + family");
  const b = P("15 October, 2 nights, budget 5000");
  eq([b.maxPrice, b.nights, !!b.dates], [5000, 2, true], "dates + nights + budget");
  eq(P("5000 ke andar parking wala").maxPrice, 5000, "'5000 ke andar' budget");
  eq(P("budget 4.5k").maxPrice, 4500, "'4.5k' budget");
  eq(P("under ₹6,500 please").maxPrice, 6500, "'₹6,500' budget");
  eq(P("paanch hazaar tak").maxPrice, 5000, "word number 'paanch hazaar tak'");
  eq(P("मसूरी में पांच हजार तक होटल दिखाओ").city, "mussoorie", "Devanagari city");
  eq(P("मसूरी में पांच हजार तक होटल दिखाओ").maxPrice, 5000, "Devanagari number words budget");
  eq(P("Hotels in Goa under 6000").lang, "en", "English detected");
  eq(P("Mussoorie 2 stars").maxPrice, null, "no budget cue → no budget (never guesses)");
  eq(P("Paris mein hotel").city, null, "non-allow-listed city → null");
  eq(P("Doosra option dikhao").open, 2, "ordinal 2");
  eq(P("show the third option").open, 3, "English ordinal 3");
  eq(P("Breakfast hai?").factTopic, "breakfast", "breakfast fact");
  eq(P("Parking aur valley view hona chahiye").unsupported, ["view"], "valley view = unsupported filter");
  ok(P("Parking aur valley view hona chahiye").parking, "parking requirement detected");
  ok(P("Booking kar do").booking && P("bid laga do").booking && P("payment kar do").booking, "booking/bid/payment detected");
  ok(P("ruko").stop && P("stop").stop, "stop detected");
  eq(P("Pahad jana hai").inspiration, "mountains", "inspiration: mountains");
}

section("Planner — home: one allow-listed navigation, deferred dims, no write");
{
  const pl = plan("Family ke saath Mussoorie jana hai, budget 5000, parking chahiye", homeCtx);
  const nav = pl.steps.filter((s) => s.kind === "navigate_hotels");
  eq(nav.length, 1, "exactly one navigation");
  eq(nav[0].city, "mussoorie", "navigation city is the allow-listed canonical city");
  eq(pl.deferred, { maxPrice: 5000, parking: true }, "budget + parking deferred until /hotels is ready");
  eq(ops(pl).length, 0, "home never executes a page operation directly");
  eq(TB.hotelsHrefFor("mussoorie", CITIES), "/hotels?city=Mussoorie", "href is the fixed /hotels route template");
  for (const bad of ["paris", "mussoorie/../admin", "javascript:alert(1)", "https://evil.example", "", "a".repeat(60)]) {
    eq(TB.hotelsHrefFor(bad, CITIES), null, `href refused for '${bad.slice(0, 24)}'`);
  }
  const noCity = plan("budget 5000", homeCtx);
  eq(noCity.steps.filter((s) => s.kind === "navigate_hotels").length, 0, "budget without city → no navigation");
  ok(/kahan|where/i.test(noCity.steps.map((s) => s.text || "").join(" ")), "asks for destination");
  const greet = TB.greetingFor("home");
  ok(/Namaste/.test(greet) && greet.length < 140, "home greeting is short Hinglish");
}

section("Planner — /hotels: typed refinement / open / compare");
{
  const pl = plan("Mussoorie mein 5000 tak parking wala hotel", listCtx());
  const o = ops(pl);
  eq(o.length, 1, "one refinement op");
  eq(o[0], { op: "APPLY_HOTEL_REFINEMENT", destination: "mussoorie", maxPrice: 5000, parking: true }, "canonical combined refinement");
  ok(C.validateOperation(o[0]) !== null, "refinement passes the closed validator");
  const same = plan("Mussoorie", listCtx({ listDestination: "mussoorie" }));
  eq(ops(same).length, 0, "unchanged destination → no redundant op");
  eq(ops(plan("Doosra option dikhao", listCtx())), [{ op: "OPEN_VISIBLE_HOTEL", position: 2 }], "open second visible hotel");
  eq(ops(plan("Top do compare karo", listCtx())), [{ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] }], "compare top two");
  const vv = plan("Parking aur valley view hona chahiye", listCtx());
  ok(/view/.test(vv.steps.map((s) => s.text || "").join(" ")) && /nahi|no /i.test(vv.steps.map((s) => s.text || "").join(" ")), "valley view honestly reported as not applied");
  eq(ops(vv), [{ op: "APPLY_HOTEL_REFINEMENT", parking: true }], "only the SUPPORTED parking dim is applied");
  const dt = plan("15 October, 2 nights, budget 5000", listCtx({ listDestination: "mussoorie" }));
  ok(/availability/i.test(dt.steps.map((s) => s.text || "").join(" ")), "dates noted with an honest availability limitation");
  eq(ops(dt), [{ op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000 }], "dates are NOT applied; budget is");
}

section("Planner — detail: grounded facts + sections only");
{
  eq(ops(plan("Breakfast hai?", detailCtx)), [{ op: "READ_CURRENT_HOTEL_FACTS" }], "breakfast question → facts read");
  eq(ops(plan("breakfast milega", detailCtx)), [{ op: "READ_CURRENT_HOTEL_FACTS" }], "voice-style breakfast (no '?') → facts read");
  // Track P: "rooms" now ALSO reads the validated detail snapshot so Buddy can name the listed room types.
  eq(ops(plan("Rooms dikhao", detailCtx)), [{ op: "SHOW_HOTEL_SECTION", section: "rooms" }, { op: "READ_CURRENT_HOTEL_FACTS" }], "rooms → show section + read validated room facts");
}

section("NO WRITES — booking / bid / payment are guidance only (every surface)");
{
  for (const ctx of [homeCtx, listCtx(), detailCtx]) {
    for (const t of ["Booking kar do", "bid laga do 3000 ka", "payment kar do", "book the second hotel", "confirm my reservation", "isko book karo"]) {
      const pl = plan(t, ctx);
      const o = ops(pl);
      ok(o.every((x) => x.op === "SHOW_HOTEL_SECTION"), `[${ctx.surface}] '${t}' → no op except a UI-local section focus`);
      ok(pl.steps.every((s) => s.kind !== "navigate_hotels"), `[${ctx.surface}] '${t}' → no navigation`);
      ok(pl.steps.some((s) => s.kind === "say" && /khud|yourself/.test(s.text)), `[${ctx.surface}] '${t}' → explicit manual-guidance caption`);
    }
  }
  // Every op the planner can EVER produce is READ / UI_LOCAL only.
  const corpus = ["Mussoorie 5000 parking", "doosra option", "compare", "kitne hotels", "rooms dikhao", "about dikhao", "breakfast hai", "parking hai kya", "Goa under 6000", "teesra kholo", "book", "bid", "pay"];
  let all = [];
  for (const ctx of [homeCtx, listCtx(), detailCtx]) for (const t of corpus) all = all.concat(ops(plan(t, ctx)));
  ok(all.length > 5, "corpus produced operations");
  ok(all.every((o) => ["READ", "UI_LOCAL"].includes(C.OPERATION_AUTHORITY[o.op])), "every planned op is READ or UI_LOCAL authority");
  ok(all.every((o) => C.validateOperation(o) !== null), "every planned op passes validateOperation");
  ok(C.CONFIRMED_WRITE_ENABLED === false && C.DRAFT_LOCAL_ENABLED === false, "contracts still disable DRAFT_LOCAL/CONFIRMED_WRITE");
}

section("One question at a time — never repeated");
{
  let slots = TB.emptySlots();
  const p1 = TB.planTurn(P("Mussoorie"), listCtx(), slots, CITIES); slots = p1.slots;
  ok(p1.followUp && /budget/i.test(p1.followUp), "after destination → asks budget");
  const p2 = TB.planTurn(P("Mussoorie"), listCtx({ listDestination: "mussoorie" }), slots, CITIES); slots = p2.slots;
  ok(!p2.followUp || !/budget/i.test(p2.followUp), "budget question not repeated");
  const p3 = TB.planTurn(P("budget 5000"), listCtx({ listDestination: "mussoorie" }), slots, CITIES);
  ok(!p3.followUp || !/budget/i.test(p3.followUp), "no budget question once given");
  const f1 = TB.silenceFollowUp("home", TB.emptySlots(), "hinglish");
  ok(f1.length > 0 && f1.length < 120, "silence follow-up is one short line");
}

section("Captions — Netflix-style ≤2 short lines; grounded outcomes");
{
  const long = "Main booking, bid ya payment khud submit nahi karta. Hotel page par Check availability ya Bid aap khud tap karke steps follow kar sakte hain.";
  const ch = TB.captionChunks(long);
  ok(ch.length >= 2 && ch.every((c) => c.length <= 84), "long text split into ≤84-char chunks");
  const rows = [
    { position: 1, id: "h1", name: "Ridge Retreat", city: "Mussoorie", minPrice: 4200, rating: 4.6, parking: "present" },
    { position: 2, id: "h2", name: "Cloud Stay", city: "Mussoorie", minPrice: null, rating: 4.1, parking: "unknown" },
  ];
  const r = TB.formatResults("hinglish", rows, "mussoorie");
  ok(/2 stays/.test(r) && /₹4,200/.test(r), "results caption uses only real visible data (count + min known price)");
  ok(/koi stay/.test(TB.formatResults("hinglish", [], "goa")), "zero results → honest none-found caption");
  ok(/sasta: Ridge Retreat/.test(TB.formatCompare("hinglish", rows, 1, 1)), "compare caption grounded in comparison rows");
  ok(/pakki jaankari nahi/.test(TB.formatFact("hinglish", "breakfast", "unknown", "Cloud Stay")), "unknown fact never asserted");
  ok(/listing mein breakfast hai/.test(TB.formatFact("hinglish", "breakfast", "present", "Ridge Retreat")), "present fact stated from data");
}

// ── REAL runtime integration (production builders + envelope path) ─────────
section("Runtime integration — typed envelope path, stale-route refusal, no write handler");
{
  const hotels = [
    { id: "h-1", name: "Ridge Retreat", city: "Mussoorie", avgRating: 4.6, amenities: ["Parking", "Breakfast"], rooms: [{ floorPrice: 4200 }] },
    { id: "h-2", name: "Cloud Stay", city: "Mussoorie", avgRating: 4.1, amenities: ["WiFi"], rooms: [{ floorPrice: 5100 }] },
    { id: "h-3", name: "Pine Nest", city: "Mussoorie", avgRating: 4.3, amenities: ["Parking"], rooms: [{ floorPrice: 3900 }] },
  ];
  const page = { city: "Mussoorie", maxPrice: null, amenities: [], calls: [] };
  const snap = () => C.buildHotelsSnapshot({
    displayHotels: hotels, city: page.city, query: "", checkIn: "", checkOut: "", guests: 2,
    maxPrice: page.maxPrice, sort: "default", stars: [], appliedAmenities: page.amenities,
    amenityOpts: ["WiFi", "Parking", "Breakfast"], loading: false, error: "",
    resolvedCity: page.city, resolvedQuery: "", resolvedStatus: "ready", role: "anonymous",
  });
  const rt = R.createLiveAiRuntime("anonymous");
  rt.invalidateRoute("/hotels");
  rt.registerPage({ pageId: "hotels", routeKey: "/hotels", getSnapshot: snap, execute: (cmd) => { page.calls.push(cmd); if (cmd.kind === "apply_refinement") { if ("maxPrice" in cmd) page.maxPrice = cmd.maxPrice; if (cmd.parking) page.amenities = [cmd.parkingAmenity]; } } });
  rt.activate();
  const run = (t) => { rt.beginTurn(t); const pl = TB.planTurn(P(t), listCtx({ listDestination: "mussoorie" }), TB.emptySlots(), CITIES); return ops(pl).map((o) => rt.execute(rt.makeEnvelope(o))); };
  const r1 = run("Doosra option dikhao");
  ok(r1[0].ok && r1[0].resolvedHotelId === "h-2", "OPEN position 2 resolves the TRUE second visible hotel");
  eq(page.calls[0], { kind: "open_hotel", hotelId: "h-2", position: 2 }, "bridge receives the typed open_hotel command");
  const r2 = run("budget 4500, parking chahiye");
  ok(r2[0].ok && r2[0].pendingReconcile, "refinement applied via setters (acted, not verified)");
  eq(page.calls[1], { kind: "apply_refinement", maxPrice: 4500, parking: true, parkingAmenity: "Parking" }, "bridge receives maxPrice + exact parking amenity");
  const pub = rt.publishedContext();
  eq([pub.refinement.maxPrice, pub.refinement.parking], [4500, true], "page snapshot reflects the applied state (verification source)");
  const r3 = run("kitne hotels hain");
  ok(r3[0].ok && Array.isArray(r3[0].results), "READ_CURRENT_RESULTS returns grounded rows");
  // stale route: an envelope prepared before a navigation is refused.
  rt.beginTurn("doosra");
  const env = rt.makeEnvelope({ op: "OPEN_VISIBLE_HOTEL", position: 2 });
  rt.invalidateRoute("/hotels"); // keeps registration but bumps epoch
  const stale = rt.execute(env);
  ok(stale.ok === false && ["stale_turn", "stale_route"].includes(stale.status), `pre-navigation envelope refused after route change (${stale.status})`);
  ok(page.calls.length === 2, "the refused stale envelope produced NO bridge command");
  // no handler can ever receive a write command
  ok(page.calls.every((c) => !WRITE_WORDS.test(c.kind)), "no write-like command ever reached the bridge");
}

// ── server-render proofs (react-dom/server) ─────────────────────────────────
section("Render — feature OFF unchanged; preview ON = one activator, no popup; orb suppressed");
{
  let React, ReactServer, ts;
  try { React = require(require.resolve("react", { paths: [REPO] })); ReactServer = require(require.resolve("react-dom/server", { paths: [REPO] })); ts = require(require.resolve("typescript", { paths: [REPO] })); } catch (e) { React = null; }
  if (!React) { fail += 1; failures.push("render proof unavailable"); }
  else {
    const compDir = path.join(OUT, "components"); fs.mkdirSync(compDir, { recursive: true });
    const navStub = path.join(compDir, "next_navigation.js");
    fs.writeFileSync(navStub, "let P='/';module.exports={__set:function(p){P=p;},usePathname:function(){return P;},useRouter:function(){return {push:function(){throw new Error('no navigation in render proof');}};}};");
    const outC = path.join(OUT, "live-ai");
    const transpile = (rel, dest, rw) => {
      let js = ts.transpileModule(fs.readFileSync(path.join(REPO, rel), "utf8"), { compilerOptions: { module: "commonjs", target: "es2020", jsx: "react-jsx", esModuleInterop: true } }).outputText;
      for (const [a, b] of rw) js = js.split(a).join(b);
      const p = path.join(compDir, dest); fs.writeFileSync(p, js); return p;
    };
    const providerPath = transpile("components/live-ai/LiveAiProvider.tsx", "LiveAiProvider.js", [
      ['"next/navigation"', JSON.stringify(navStub)],
      ['"@/lib/live-ai/contracts"', JSON.stringify(path.join(outC, "contracts.js"))],
      ['"@/lib/live-ai/runtime"', JSON.stringify(path.join(outC, "runtime.js"))],
      ['"@/lib/live-ai/transport"', JSON.stringify(path.join(outC, "transport.js"))],
      ['"@/lib/live-ai/gateway-client"', JSON.stringify(path.join(outC, "gateway-client.js"))],
      ['"@/lib/live-ai/conversation"', JSON.stringify(path.join(outC, "conversation.js"))],
      ['"@/lib/live-ai/audio-playback"', JSON.stringify(path.join(outC, "audio-playback.js"))],
    ]);
    const shellPath = transpile("components/live-ai/LiveAiShell.tsx", "LiveAiShell.js", [['"./LiveAiProvider"', JSON.stringify(providerPath)]]);
    // PRODUCT-02 — the founder-only TEXT hook (inert with the founder flag unset, as here).
    const founderHookPath = transpile("components/live-ai/useFounderText.ts", "useFounderText.js", [
      ['"@/lib/live-ai/founder-text"', JSON.stringify(path.join(outC, "founder-text.js"))],
    ]);
    const tbPath = transpile("components/live-ai/TravelBuddy.tsx", "TravelBuddy.js", [
      ['"./LiveAiProvider"', JSON.stringify(providerPath)],
      ['"./useFounderText"', JSON.stringify(founderHookPath)],
      ['"next/navigation"', JSON.stringify(navStub)],
      ['"@/lib/launch/curation"', JSON.stringify(path.join(OUT, "launch/curation.js"))],
      ['"@/lib/travel-buddy/conversation"', JSON.stringify(path.join(OUT, "travel-buddy/conversation.js"))],
      ['"@/lib/travel-buddy/mascots"', JSON.stringify(path.join(OUT, "travel-buddy/mascots.js"))],
      ['"@/lib/travel-buddy/voice-io"', JSON.stringify(path.join(OUT, "travel-buddy/voice-io.js"))],
      ['"@/lib/travel-buddy/session"', JSON.stringify(path.join(OUT, "travel-buddy/session.js"))],
      ['"@/lib/travel-buddy/live-bridge"', JSON.stringify(path.join(OUT, "travel-buddy/live-bridge.js"))],
      ['"@/lib/tutorial/buddy-coordination"', JSON.stringify(path.join(OUT, "tutorial/buddy-coordination.js"))],
    ]);
    const Provider = require(providerPath);
    const Shell = require(shellPath).default;
    const Buddy = require(tbPath).default;
    const nav = require(navStub);
    const ctx = { enabled: true, providerEnabled: false, runtime: null, transport: null, conversation: null, registeredPageId: "hotels", activated: false, orbState: "sleep", activate() {}, deactivate() {}, toggle() {}, startProvider() {}, submitText() {}, bargeIn() {}, resumeAudio() {}, audioNeedsResume: false, notifyContext() {}, registerPage: () => () => {} };
    const render = (el, value) => { const e = console.error; console.error = () => {}; try { return ReactServer.renderToStaticMarkup(value ? React.createElement(Provider.LiveAiContext.Provider, { value }, el) : el); } finally { console.error = e; } };

    delete process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW;
    eq(render(React.createElement(Buddy)), "", "V=0 (default context): Travel Buddy renders NOTHING");
    eq(render(React.createElement(Buddy), ctx), "", "V=1 but preview flag unset: Travel Buddy renders NOTHING");
    ok(/data-live-ai-orb/.test(render(React.createElement(Shell), ctx)), "V=1, flag unset: the existing orb is unchanged");
    process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW = "1";
    eq(render(React.createElement(Buddy), { ...ctx, providerEnabled: true }), "", "P=1: Travel Buddy refuses (provider path untouched)");
    ok(/data-live-ai-orb/.test(render(React.createElement(Shell), { ...ctx, providerEnabled: true })), "P=1: orb still renders (no change to provider UX)");
    eq(render(React.createElement(Shell), ctx), "", "preview ON: the legacy orb is suppressed (single voice owner)");
    for (const p of ["/", "/hotels", "/hotels/h-1"]) {
      nav.__set(p);
      const m = render(React.createElement(Buddy), ctx);
      ok(/data-travel-buddy-preview/.test(m) && (m.match(/<button/g) || []).length === 1 && /Talk to StayBid/.test(m), `preview ON @${p}: exactly ONE activator button`);
      ok(!/role="dialog"|<dialog|aria-modal|class="[^"]*(modal|drawer|sheet|scrim|overlay|chat)/i.test(m), `preview ON @${p}: no dialog/modal/sheet/scrim/chat surface`);
      ok(!/Buddy:/.test(m), `preview ON @${p}: no caption/greeting before the tap`);
    }
    for (const p of ["/bid", "/discover", "/voice-demo"]) { nav.__set(p); eq(render(React.createElement(Buddy), ctx), "", `preview ON @${p}: Buddy absent`); }
    // Mascot proof — idle = the tiny mascot ONLY (no toolbar, no caption, no options).
    for (const p of ["/", "/hotels", "/hotels/h-1"]) {
      nav.__set(p);
      const m = render(React.createElement(Buddy), ctx);
      ok(/class="[^"]*tb-mascot/.test(m) && /\/travel-buddy\/mascots\/mountain-bear\.webp/.test(m) && /mountain-bear@2x\.webp 2x/.test(m) && /width="48"/.test(m), `MASCOT idle @${p}: tiny 48px default Mountain Bear FINAL sprite (1x/2x srcSet) is the activator`);
      ok(!/temporary placeholder art|placeholders\/|TEMP/.test(m), `MASCOT idle @${p}: no placeholder art / TEMP label in final-asset mode`);
      ok(!/tb-capsule|class="tb-options"|tb-caption"/.test(m), `MASCOT idle @${p}: no capsule, options or caption`);
    }
    // Mascot proof — activated = mascot + one small options badge; End/Type/Mute only inside options.
    for (const p of ["/", "/hotels", "/hotels/h-1"]) {
      nav.__set(p);
      const m = render(React.createElement(Buddy), { ...ctx, activated: true });
      eq((m.match(/<button/g) || []).length, 2, `MASCOT activated @${p}: exactly 2 controls (mascot, options badge)`);
      ok(/aria-expanded="false"/.test(m) && !/id="tb-options"/.test(m), `MASCOT activated @${p}: options closed by default (minimal mode)`);
      ok(!/>Speak<|>Mute voice<|>Type instead<|>End</.test(m), `MASCOT activated @${p}: no persistent Speak/Type/Mute/End controls`);
      ok(!/role="dialog"|aria-modal/.test(m), `MASCOT activated @${p}: no dialog`);
    }
    delete process.env.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW;
  }
}

section("MASCOT — registry, local preference, placement geometry");
{
  eq(MAS.MASCOTS.length, 6, "exactly six choices");
  eq(MAS.MASCOTS.map((m) => m.name).join("|"), "Mountain Bear|Cozy Cottage|Sleepy Cloud|Travel Backpack|Mountain Cabin|Cozy Mug", "names + order exactly as the product contract");
  eq(MAS.DEFAULT_MASCOT, "mountain-bear", "default is Mountain Bear");
  eq(MAS.allFinalAssetsPresent(), true, "asset gate: all six FINAL assets present");
  // Final-asset identities (Owner handoff 06_SIX_ASSET_IDENTITIES.json): exact bytes for BOTH sizes.
  const FINAL_IDS = {
    "mountain-bear": ["dc5e3f4345c9db0ad8547be7a8dac71fa4805ac53c8ac5d0a5eaf54ac327951c", 4786, "b2966f9f53918697c671fccbf593fee35c9e00ffe876f71e939aa9f880db3517", 12618],
    "cozy-cottage": ["f38c4d672e4d81374570370e060e32a4bffef7fab9b93cc33618d58882e0480d", 4800, "b9a621fba5eb1bcccca22aa41a332e0ee659000b4aad731c5a8399d1cf3f0455", 12478],
    "sleepy-cloud": ["62001dfcc71312093a587909fad6a3128617fa59e306c5ea280a3da9bbf0c0fa", 5082, "a22b325e9f8e09d819cc0106ff46645abcae7120e1fe61d5eff3cd4f48da4bce", 12528],
    "travel-backpack": ["12355fca2256a30d7dcaefccba847a9caccb7a64f6f83d1b4c1c4f40d7897a4c", 5022, "f0a3be369f3fdbd045aee9b9a00c3ce991733a46996e9612ff336f35704d0b91", 13340],
    "mountain-cabin": ["dbe7c0b5082850f50e4b42345d94077d73b3f563384bb95311e4c3f5f87fea27", 5436, "fc6cbe48a53bbf6b8ea11781c056938a1b9b428bc63836c6e54628b36b44b189", 13468],
    "cozy-mug": ["75bb51057858dadb18004fa034086cb0b1e28c086fa00b871e9d92ba212e51e9", 4592, "020c5d1fbe76e24aad1c5fc4b3cd1f4781cfc859eba65dfe55db84ffe2e217a9", 12022],
  };
  const crypto = require("crypto");
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  // Minimal WebP container parse: RIFF/WEBP, VP8X canvas + alpha flag, ALPH chunk, not animated.
  const webp = (b) => {
    if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP" || b.readUInt32LE(4) + 8 !== b.length) return null;
    let pos = 12; const out = { chunks: [] };
    while (pos + 8 <= b.length) {
      const cc = b.toString("latin1", pos, pos + 4), sz = b.readUInt32LE(pos + 4), d = b.subarray(pos + 8, pos + 8 + sz);
      out.chunks.push(cc);
      if (cc === "VP8X") { out.alphaFlag = !!(d[0] & 0x10); out.anim = !!(d[0] & 0x02); out.w = 1 + d.readUIntLE(4, 3); out.h = 1 + d.readUIntLE(7, 3); }
      pos += 8 + sz + (sz & 1);
    }
    return out;
  };
  for (const m of MAS.MASCOTS) {
    const f = m.final, want = FINAL_IDS[m.id];
    ok(!!f && f.src === `/travel-buddy/mascots/${m.id}.webp` && f.src2x === `/travel-buddy/mascots/${m.id}@2x.webp` && f.width === 96 && f.height === 96, `${m.id}: final registry entry at the contract paths (96 px canvas)`);
    const b1 = fs.readFileSync(path.join(REPO, "public", f.src)), b2 = fs.readFileSync(path.join(REPO, "public", f.src2x));
    ok(sha(b1) === want[0] && b1.length === want[1] && sha(b2) === want[2] && b2.length === want[3], `${m.id}: 1x + 2x files byte-exact to the Owner identities`);
    ok(f.sha256 === want[0] && f.bytes === want[1], `${m.id}: registry sha256/bytes describe the real 1x file`);
    const h1 = webp(b1), h2 = webp(b2);
    ok(!!h1 && !!h2 && h1.w === 96 && h1.h === 96 && h2.w === 192 && h2.h === 192, `${m.id}: WebP canvases 96×96 and 192×192`);
    ok(h1.alphaFlag && h2.alphaFlag && h1.chunks.includes("ALPH") && h2.chunks.includes("ALPH") && !h1.anim && !h2.anim, `${m.id}: real alpha channel (VP8X flag + ALPH), not animated`);
    ok(b1.length <= 25600 && b2.length <= 61440, `${m.id}: size budget (1x ≤25 KB, 2x ≤60 KB)`);
  }
  ok(MAS.MASCOTS.every((m) => /^\/travel-buddy\/placeholders\/[a-z-]+\.svg$/.test(m.placeholder)), "historical TEMP placeholders remain only as an unused fallback field");
  ok(MAS.MASCOTS.every((m) => fs.existsSync(path.join(REPO, "public", m.placeholder))), "every placeholder file exists locally");
  ok(MAS.MASCOTS.every((m) => /TEMP/.test(fs.readFileSync(path.join(REPO, "public", m.placeholder), "utf8"))), "every placeholder visibly says TEMP");
  eq(MAS.mascotById("nope").id, "mountain-bear", "unknown id → default");
  const s1 = MAS.sanitizePrefs({ buddyId: "cozy-mug", nx: 0.3, ny: 2, hidden: true, captions: false, transcript: "secret", phone: "x" });
  ok(s1.buddyId === "cozy-mug" && s1.nx === 0.3 && s1.ny === 1 && s1.hidden === true && s1.captions === false && !("transcript" in s1) && !("phone" in s1), "sanitizePrefs: whitelists 5 fields, clamps, drops everything else");
  const s2 = MAS.sanitizePrefs({ buddyId: "evil", nx: "1", ny: null });
  ok(s2.buddyId === "mountain-bear" && s2.nx === null && s2.ny === null && s2.captions === true && s2.hidden === false, "sanitizePrefs: garbage → defaults (position only when BOTH axes valid)");
  eq(JSON.stringify(MAS.sanitizePrefs("not-json-object")), JSON.stringify(MAS.DEFAULT_PREFS), "sanitizePrefs: non-object → defaults");
  ok(MAS.MASCOT_HIT >= 44 && MAS.MASCOT_VISUAL >= 42 && MAS.MASCOT_VISUAL <= 52 && MAS.DRAG_THRESHOLD >= 7 && MAS.DRAG_THRESHOLD <= 10, "sizes: hit ≥44, visual 42–52, drag threshold 7–10 px");
  const ins = { top: 20, right: 0, bottom: 34, left: 0 };
  const b = MAS.safeBox(390, 844, ins, 64);
  ok(b.minX === 8 && b.minY === 28 && b.maxX === 390 - 52 - 8 && b.maxY === 844 - 52 - 8 - 34 - 64, "safeBox: margins + safe-area + reserved dock band");
  const c = MAS.clampToBox(-50, 5000, b);
  ok(c.x === b.minX && c.y === b.maxY && c.clamped, "clampToBox: off-screen drag is pulled back inside (and flagged)");
  ok(!MAS.clampToBox(100, 300, b).clamped, "clampToBox: in-bounds position untouched");
  const n = MAS.normalize(b.maxX, b.minY, b);
  ok(n.nx === 1 && n.ny === 0, "normalize: top-right corner → (1,0)");
  const b2 = MAS.safeBox(360, 800, ins, 128); // smaller screen + hotel-detail CTA band
  const d2 = MAS.denormalize(n.nx, n.ny, b2);
  ok(d2.x === b2.maxX && d2.y === b2.minY, "denormalize: the same normalized spot maps into the new box (resize / rotate / route)");
  const d3 = MAS.denormalize(0.5, 1, b2);
  ok(d3.y + MAS.MASCOT_HIT <= 800 - 34 - 128, "denormalize: bottom-most position stays above the sticky CTA band on hotel detail");
  const def = MAS.denormalize(null, null, b);
  ok(def.x === b.maxX && def.y === b.maxY, "default spot: bottom-right of the safe box");
  const land = MAS.safeBox(844, 390, ins, 64);
  ok(land.maxY >= land.minY && MAS.clampToBox(9999, 9999, land).y <= 390 - 52, "landscape box stays valid");
}

section("SRC — no new network / write surface (supplementary scans)");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const comp = strip(fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8"));
  const lib = strip(fs.readFileSync(path.join(REPO, "lib/travel-buddy/conversation.ts"), "utf8"));
  const masSrc = strip(fs.readFileSync(path.join(REPO, "lib/travel-buddy/mascots.ts"), "utf8"));
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|querySelector|getElementById|innerHTML|sessionStorage|indexedDB|document\.cookie/.test(masSrc), "mascots.ts: no network / DOM / other storage");
  ok((masSrc.match(/localStorage\./g) || []).length === 2 && /localStorage\.getItem\(PREFS_KEY\)/.test(masSrc) && /localStorage\.setItem\(PREFS_KEY,/.test(masSrc), "mascots.ts: localStorage touched ONLY via one get + one set of PREFS_KEY");
  ok(/JSON\.stringify\(\{ buddyId: clean\.buddyId, nx: clean\.nx, ny: clean\.ny, hidden: clean\.hidden, captions: clean\.captions \}\)/.test(masSrc), "mascots.ts: persisted object is the explicit 5-field whitelist (no speech/transcript/caption text)");
  for (const [name, src] of [["TravelBuddy.tsx", comp], ["conversation.ts", lib]]) {
    ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.mediaDevices|getUserMedia/.test(src), `${name}: no fetch/XHR/WebSocket/getUserMedia`);
    ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src), `${name}: no direct storage/cookie access (only via mascots.ts prefs)`);
    ok(!/querySelector|getElementById|getElementsBy|innerHTML|dangerouslySetInnerHTML/.test(src), `${name}: no DOM scraping / HTML injection`);
    ok(!/api\.(create|place|accept|pay|book|update|delete)|createBidRequest|razorpay|\/api\/bids|\/api\/payments|\/api\/live-ai/i.test(src), `${name}: no bid/booking/payment/live-ai API reference`);
  }
  ok(/router\.push\(href\)/.test(comp) && /hotelsHrefFor\(/.test(comp), "TravelBuddy navigates ONLY via the allow-listed hotelsHrefFor href");
  ok((comp.match(/router\.push\(/g) || []).length === 1, "exactly one router.push call site");
  // Candidate 02 — consent / microphone discipline (source-level proofs).
  const body = (name) => { const i = comp.indexOf(`const ${name} = useCallback(`); if (i < 0) return ""; const j = comp.indexOf("\n  }, [", i); return comp.slice(i, j); };
  const start = body("startSession");
  ok(start.includes('startRecognition(gen, "gesture")') && start.indexOf('startRecognition(gen, "gesture")') < (start.indexOf("await") < 0 ? Infinity : start.indexOf("await")), "C02: activation starts recognition SYNCHRONOUSLY inside the tap (before any await)");
  const prim = body("onPrimary");
  ok(prim.includes('startRecognition(gen, "gesture")') && prim.indexOf('startRecognition(gen, "gesture")') < (prim.indexOf("await") < 0 ? Infinity : prim.indexOf("await")), "C02: primary control starts recognition synchronously inside the tap");
  ok(/speakingRef\.current \|\| Date\.now\(\) < ignoreUntilRef\.current\) continue/.test(comp), "C02: self-capture guard — results while Buddy speaks are ignored");
  ok(!/startRecognition\(/.test(body("armSilence")), "C02: the single silence follow-up never opens the microphone");
  ok(/stopListening\(\)/.test(body("enterStandby")), "C02: standby always switches the microphone off");
  ok(/if \(mode === "auto" && micBlockedRef\.current\) return false/.test(comp), "C02: no automatic re-open after a denial");
  ok(/if \(fromVoice\) continueListening\(gen, "turn"\)/.test(comp), "C02: auto re-open only after a VOICE turn");
  ok(/document\.visibilityState === "hidden"\) return/.test(body("continueListening")), "C02: never re-opens listening in a hidden tab");
  ok(!/navigator\.mediaDevices|getUserMedia|MediaRecorder|AudioContext/.test(comp), "C02: no raw audio capture / recording APIs");
  // Mascot proof — a drag can never start the microphone.
  const clickFn = comp.slice(comp.indexOf("const onMascotClick = () => {"), comp.indexOf("const onMascotKeyDown"));
  ok(/if \(suppressClickRef\.current\) \{ suppressClickRef\.current = false; return; \}/.test(clickFn) && clickFn.indexOf("suppressClickRef") < clickFn.indexOf("startSession()"), "MASCOT: the click after a drag/long-press is swallowed BEFORE any activation");
  const moveFn = comp.slice(comp.indexOf("const onMascotPointerMove"), comp.indexOf("const endPointer"));
  const upFn = comp.slice(comp.indexOf("const endPointer"), comp.indexOf("const onMascotClick"));
  const downFn = comp.slice(comp.indexOf("const onMascotPointerDown"), comp.indexOf("const onMascotPointerMove"));
  ok(![downFn, moveFn, upFn].some((f) => /startRecognition|startSession|onPrimary|activate\(/.test(f)), "MASCOT: pointer down/move/up handlers never touch recognition or activation");
  ok(/if \(d\.moved\) \{\s*suppressClickRef\.current = true;/.test(upFn), "MASCOT: a moved press marks its click as suppressed");
  ok(/if \(activeRef\.current\) endSession\(\)/.test(body("hideBuddy")), "MASCOT: hiding Buddy ends any session (no hidden listener)");
  ok(/touch-action: none/.test(comp) && !/body[^{]*\{[^}]*touch-action/.test(comp), "MASCOT: touch-action:none is scoped to the mascot (page scroll unaffected)");
  const shell = strip(fs.readFileSync(path.join(REPO, "components/live-ai/LiveAiShell.tsx"), "utf8"));
  ok(/!providerEnabled && process\.env\.NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW === "1"/.test(shell), "shell suppresses the orb under the SAME gate predicate");
  const layout = fs.readFileSync(path.join(REPO, "app/layout.tsx"), "utf8");
  ok(/<LiveAiShell \/>\s*<TravelBuddy \/>\s*<\/LiveAiProvider>/.test(layout), "layout mounts <TravelBuddy/> inside the single LiveAiProvider, beside the shell");
  ok(!/NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW\s*=\s*1/.test(fs.existsSync(path.join(REPO, ".env")) ? fs.readFileSync(path.join(REPO, ".env"), "utf8") : ""), "no committed env file enables the preview");
}

section("UX FINISHING F1 — essential-target collision planner (pure)");
{
  const R = (x, y, w, h) => ({ x, y, w, h });
  const T = (full, visible) => ({ full, visible: visible || full });
  const seeAll = T(R(298, 729, 80, 36));                   // small (2 880 px² ≤ 3 × 52²)
  ok(MAS.SMALL_TARGET_AREA === 3 * 52 * 52, "small-target threshold = 3 × mascot hit area (8 112 px²)");
  ok(MAS.obstructs(R(330, 720, 52, 52), seeAll) === true, "small target (SEE ALL): ANY overlap obstructs");
  ok(MAS.obstructs(R(330, 600, 52, 52), seeAll) === false, "small target: no overlap ⇒ clear");
  ok(MAS.obstructs(R(378, 729, 52, 36), seeAll) === false, "touching edges (zero-area overlap) ⇒ clear");
  const card = T(R(16, 300, 300, 260));                     // large (78 000 px²)
  ok(MAS.obstructs(R(290, 300, 52, 52), card) === false, "large card: a corner overlap with the centre clear and < 20 % ⇒ clear");
  ok(MAS.obstructs(R(140, 404, 52, 52), card) === true, "large card: centre covered ⇒ obstructed");
  const thin = T(R(0, 0, 400, 30));
  ok(MAS.obstructs(R(0, 0, 52, 30), T(R(0, 0, 300, 100))) === false && MAS.obstructs(R(0, 0, 90, 100), T(R(0, 0, 300, 100))) === true, "large (tall) target: ≥ 20 % of its visible area covered ⇒ obstructed; a small corner overlap ⇒ clear");
  ok(MAS.obstructs(R(330, 600, 52, 52), T(R(379, 586, 300, 258), R(379, 586, 11, 258))) === false, "card scrolled mostly off-screen is still a LARGE target (full box decides), sliver corner overlap ⇒ clear");
  ok(MAS.THIN_TARGET_SIDE === 64 && MAS.obstructs(R(0, 0, 52, 30), thin) === true, "a THIN control (400×30 bar — short side ≤ 64 px) is obstructed by any overlap: the mascot would hide a full-height slice of it (e.g. a ribbon's 'CHANGE' label)");
  ok(MAS.obstructs(R(320, 600, 52, 52), T(R(28, 572, 330, 56))) === true, "the home season ribbon (330×56 button) is protected end to end — including its 'CHANGE ▾' label at the right end");
  ok(MAS.obstructs(R(300, 380, 52, 52), T(R(0, 380, 391, 120))) === false && MAS.obstructs(R(300, 380, 52, 52), Object.assign(T(R(0, 380, 391, 120)), { moving: true })) === true, "a MOVING control (auto-scrolling ticker link) is obstructed by any overlap — its centre would slide under a resting Buddy");
  ok(MAS.footprintClear([R(1220, 400, 52, 52)], [], [R(1266, 0, 14, 800)]) === false, "a native layer drawn ABOVE Buddy (e.g. a 14 px page scroll rail, z 900) rejects any overlapping spot");
  ok(MAS.footprintClear([R(1196, 400, 52, 52)], [], [R(1266, 0, 14, 800)]) === true, "… and the spot just inward of it is clear");
  const b = MAS.safeBox(390, 844, { top: 0, right: 0, bottom: 0, left: 0 }, 64);
  const want = MAS.denormalize(null, null, b);
  const cands = MAS.spotCandidates(want, b);
  ok(cands[0].x === want.x && cands[0].y === want.y, "candidates start at the desired (remembered / default) spot");
  ok(cands[1].x === want.x && cands[1].y === want.y - MAS.SPOT_STEP, "then the same column, moving UP first (away from dock / CTA)");
  ok(cands.every((c) => c.x >= b.minX && c.x <= b.maxX && c.y >= b.minY && c.y <= b.maxY), "every candidate stays inside the safe box (dock band never used)");
  ok(cands.some((c) => c.x === want.x - 12) && cands.some((c) => c.x === want.x - 24) && cands.some((c) => c.x === b.minX), "candidates include 12 / 24 px inward nudges, then the other edge");
  ok(JSON.stringify(MAS.spotCandidates(want, b)) === JSON.stringify(cands), "candidate order is deterministic");
  const clearOf = (targets, covers) => (rects) => MAS.footprintClear(rects, targets, covers || []);
  const p0 = MAS.planPlacement(want, b, 390, false, clearOf([]));
  ok(p0.kind === "mascot" && p0.x === want.x && p0.y === want.y, "empty page ⇒ the remembered / default spot is kept exactly");
  const sa = T(R(want.x - 30, want.y + 10, 80, 36));
  const p1 = MAS.planPlacement(want, b, 390, false, clearOf([sa]));
  ok(p1.kind === "mascot" && p1.x === want.x && p1.y < want.y && !MAS.obstructs(MAS.mascotRectAt(p1), sa), "SEE ALL under the default ⇒ nearest clear spot in the same column, above it", p1);
  ok(p1.y === want.y - MAS.SPOT_STEP * Math.ceil((want.y - (sa.full.y - 52)) / MAS.SPOT_STEP), "… exactly the first clear 12 px step (minimal move)", p1);
  const p2 = MAS.planPlacement(want, b, 390, false, clearOf([], [R(376, 0, 14, 844)]));
  ok(p2.kind === "mascot" && p2.x === want.x - 12, "a thin native edge layer over the column ⇒ 12 px inward, same side", p2);
  const everything = [T(R(0, 0, 60, 60))].concat(Array.from({ length: 40 }, (_, i) => T(R(0, i * 22, 390, 20))));
  const p3 = MAS.planPlacement(want, b, 390, false, clearOf(everything));
  ok(p3.kind === "suppressed", "no clear mascot spot AND no clear edge-tab spot ⇒ suppressed (fail closed: native actions win)", p3);
  const midOnly = Array.from({ length: 40 }, (_, i) => T(R(44, i * 22, 302, 20)));
  const p4 = MAS.planPlacement(want, b, 390, false, clearOf(midOnly));
  ok(p4.kind === "parked" && p4.side === "right", "no clear mascot spot but a clear edge ⇒ parked slim edge tab (recoverable)", p4);
  const badgeSpot = MAS.badgeHitRectAt(want, 390);
  ok(badgeSpot.w === 44 && badgeSpot.h === 44 && badgeSpot.x === want.x - 34 - 9, "options badge hit box = 44×44 at the rendered badge position");
  const p5 = MAS.planPlacement(want, b, 390, true, clearOf([T(R(badgeSpot.x + 10, badgeSpot.y + 10, 20, 20))]));
  ok(p5.kind === "mascot" && (p5.x !== want.x || p5.y !== want.y), "while the options badge shows, its hit box must be clear too", p5);
  ok(MAS.edgeTabHitRect("right", 100, 390).x === 346 && MAS.edgeTabHitRect("left", 100, 390).x === 0, "edge tab hit box (44 × 52) at the chosen edge");
  const t1 = MAS.planTab(400, false, b, 390, clearOf([], [R(376, 0, 14, 844)]));
  ok(t1 && t1.side === "left", "right edge covered by a native layer ⇒ the edge tab uses the left edge", t1);
  ok(MAS.planTab(400, false, b, 390, clearOf([])).side === "right" && MAS.planTab(400, false, b, 390, clearOf([])).y === 400, "edge tab keeps its side and height when clear");
}

section("UX FINISHING F1/F2 — source proofs (picker DPR, geometry-only probe, prefs untouched)");
{
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const comp = strip(fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8"));
  ok(/srcSet=\{m\.final \? `\$\{m\.final\.src\} \$\{m\.final\.width\}w, \$\{m\.final\.src2x\} \$\{m\.final\.width \* 2\}w` : undefined\}/.test(comp) && /sizes=\{m\.final \? "40px" : undefined\}/.test(comp), "F2: picker <img> declares 96w/192w srcSet + sizes=40px (DPR3 ⇒ 192 px file)");
  ok(/<img src=\{m\.final \? m\.final\.src : m\.placeholder\}/.test(comp), "F2: picker keeps the placeholder src fallback when an entry has no final art");
  ok(MAS.MASCOTS.every((m) => m.final && m.final.width === 96 && m.final.height === 96 && m.final.src2x === m.final.src.replace(/\.webp$/, "@2x.webp")), "F2: all six finals are 96 px with a @2x (192 px) sibling — srcSet widths are truthful");
  const probeSrc = comp.slice(comp.indexOf("function makePageProbe("), comp.indexOf("const getRecognition"));
  ok(probeSrc.length > 200 && /document\.elementsFromPoint\(/.test(probeSrc) && /\.closest\(INTERACTIVE_SEL\)/.test(probeSrc) && /getBoundingClientRect\(\)/.test(probeSrc), "F1 probe: browser hit-testing + nearest interactive ancestor + bounding box");
  ok(!/textContent|innerText|innerHTML|outerHTML|\.value\b|getAttribute|dataset|\.href\b|\.click\(|dispatchEvent|\.focus\(|setAttribute|appendChild|removeChild|\.style\./.test(probeSrc), "F1 probe: reads geometry ONLY — no text, values, attributes, URLs; never clicks, focuses or mutates the page");
  ok((probeSrc.match(/getComputedStyle\(/g) || []).length === 1 && /cs\.position === "fixed" \|\| cs\.position === "sticky"\) && parseInt\(cs\.zIndex, 10\) > BUDDY_Z/.test(probeSrc) && (probeSrc.match(/cs\.[a-zA-Z]+/g) || []).every((k) => ["cs.position", "cs.zIndex", "cs.animationName", "cs.animationPlayState"].includes(k)), "F1 probe: computed style read ONLY for position / z-index (layer above Buddy?) and animation name / play-state (moving control?)");
  ok(/r\.x - PROBE_GRID/.test(probeSrc) && !/document\.body\b|document\.all|getElementsBy|querySelector/.test(probeSrc), "F1 probe: samples only around the candidate rectangle (+10 px), never a document-wide scan");
  const place = comp.slice(comp.indexOf("const placeNow = useCallback("), comp.indexOf("const placeRef = useRef(placeNow)"));
  ok(place.length > 200 && !/updatePrefs|writePrefs|savePosition/.test(place), "F1: runtime displacement never rewrites the saved position (remembered spot returns where clear)");
  ok(/if \(\(reason === "scroll" \|\| reason === "observe"\) && optionsOpenRef\.current\) return;/.test(place), "F1: an open options menu stays anchored during scroll / layout re-checks");
  const outside = comp.slice(comp.indexOf('window.addEventListener("pointerdown", onDown, true)') - 420, comp.indexOf('window.addEventListener("pointerdown", onDown, true)'));
  ok(/setOptionsOpen\(false\)/.test(outside) && !/preventDefault|stopPropagation|stopImmediatePropagation/.test(outside), "F1: outside press closes options WITHOUT preventDefault — the same tap reaches the native control");
  ok(/\.tb-root \{ position: fixed; inset: auto 0 0 0; z-index: 61; pointer-events: none; \}/.test(comp), "F1: Buddy's layer stays at z-index 61 (never raised above app modals / navbars)");
  ok(/\.tb-mascot\.is-default \{[^}]*visibility: hidden;/.test(comp) && /pos && revealed \? "" : " is-default"/.test(comp), "F1: the mascot stays invisible until its first collision-checked placement (no first-frame overlap)");
  const up = comp.slice(comp.indexOf("const endPointer"), comp.indexOf("const onMascotClick"));
  ok(/clearSpot\(\{ x: c\.x, y: c\.y \}, b\) \|\| \{ x: c\.x, y: c\.y \}/.test(up) && !/startRecognition|startSession|onPrimary/.test(up), "F1: a drop on a native control is nudged to the nearest clear spot (drag still free; never starts the mic)");
  const kd = comp.slice(comp.indexOf("const onMascotKeyDown"), comp.indexOf("const hideBuddy"));
  ok(/for \(let i = 0; probe && i < 12 && !probe\.isClear\(rectsAt\(c\)\); i\+\+\)/.test(kd), "F1: arrow keys skip over spots that would cover a native control");
  ok((comp.match(/makePageProbe\(/g) || []).length === 4, "F1: the probe is created only by its definition + clearSpot / placeNow / keyboard (3 call sites)");
}

// ═════════════════════════════════════════════════════════════════════════
// TRACK P — DEMO-INVENTORY GUEST JOURNEY (offline candidate 01).
// All hotel fixtures below are SYNTHETIC and labelled TEST ONLY: they prove
// branching / grounding logic only, never production inventory, counts or
// category membership.
// ═════════════════════════════════════════════════════════════════════════
const says = (pl) => pl.steps.filter((s) => s.kind === "say").map((s) => s.text).join(" ");

section("TP-01 Parser — unknown place, category, deictic open, availability");
{
  eq(P("Paris mein hotel").place, "paris", "non-allow-listed 'Paris mein hotel' → place noted (never a destination)");
  eq(P("Hotels in Delhi under 5000").place, "delhi", "'Hotels in Delhi under 5000' → place 'delhi' (filler word dropped)");
  eq(P("Delhi ke hotels dikhao").place, "delhi", "Hinglish '<X> ke hotels' → place");
  eq(P("Mussoorie ke hotels dikhao").place, null, "allow-listed city never reported as unknown place");
  eq(P("best hotels in the hills").place, null, "filler words are never a place");
  eq(P("StayBid Circle hotels dikhao").category, "circle", "category: StayBid Circle");
  eq(P("staybid operated stays").category, "operated", "category: StayBid Operated");
  eq(P("traditional hotel chahiye").category, "traditional", "category: Traditional");
  eq(P("Mussoorie 5000").category, null, "no category word → null");
  ok(P("isko kholo").openThis && P("open it").openThis && P("yeh wala dikhao").openThis, "deictic open (isko kholo / open it / yeh wala dikhao)");
  ok(!P("Mussoorie ke hotels dikhao").openThis && !P("doosra kholo").openThis, "no deictic open for a list request or a numbered open");
  ok(P("kya room available hai").availability && P("is it available on 18 oct").availability, "availability question detected");
}

section("TP-02 Zero / one / many results — grounded, never a pretend comparison");
{
  const one = plan("Top do compare karo", listCtx({ listDestination: "mussoorie", visibleCount: 1 }));
  eq(ops(one).length, 0, "1 visible stay: NO compare op is issued");
  ok(/sirf ek stay/.test(says(one)) && /kholo/.test(says(one)), "1 visible stay: says only one + offers to open it");
  const oneEn = plan("compare the top two", listCtx({ listDestination: "mussoorie", visibleCount: 1 }));
  ok(/Only one stay/.test(says(oneEn)) && /open it/.test(says(oneEn)), "1 visible stay (English) caption");
  const zero = plan("Top do compare karo", listCtx({ listDestination: "goa", visibleCount: 0 }));
  ok(ops(zero).length === 0 && /koi stay nahi/.test(says(zero)), "0 visible stays: no op, honest none");
  eq(ops(plan("Top do compare karo", listCtx({ visibleCount: 2 }))), [{ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] }], "2+ visible stays: bounded compare of the top two");
  eq(ops(plan("Top do compare karo", listCtx({ listReady: false, visibleCount: 0 }))).length, 1, "list still loading: count unknown → op goes to the runtime (which refuses not_ready), never assumed");
  eq(ops(plan("isko kholo", listCtx({ visibleCount: 1 }))), [{ op: "OPEN_VISIBLE_HOTEL", position: 1 }], "1 visible stay + 'isko kholo' → opens that stay");
  const many = plan("isko kholo", listCtx({ visibleCount: 3 }));
  ok(ops(many).length === 0 && /number/.test(says(many)), "3 visible + 'isko kholo' → asks which number (no guess)");
  const none = plan("open it", listCtx({ visibleCount: 0 }));
  ok(ops(none).length === 0 && /no stays/i.test(says(none)), "0 visible + 'open it' → honest none");
  const home = plan("isko kholo", homeCtx);
  ok(ops(home).length === 0 && /destination/.test(says(home)), "home + 'isko kholo' → asks for a destination first");
  // A refinement in the same turn means the current count is stale → no count-based shortcut.
  const refine = plan("budget 4000 aur isko kholo", listCtx({ listDestination: "mussoorie", visibleCount: 1 }));
  ok(ops(refine).length === 1 && ops(refine)[0].op === "APPLY_HOTEL_REFINEMENT", "refine + deictic open in one turn → only the refinement (count not trusted mid-change)");
}

section("TP-03 Results / compare / rooms captions — page data only");
{
  const r1 = [{ position: 1, id: "test-only-1", name: "TEST ONLY Ridge", city: "Mussoorie", minPrice: 4200, rating: 4.6, parking: "present" }];
  const c1 = TB.formatResults("hinglish", r1, "mussoorie");
  ok(/1 stay screen par hai: TEST ONLY Ridge/.test(c1) && /₹4,200 se listed/.test(c1) && /kholo/.test(c1), "1 result: names the stay + its listed price + how to open");
  ok(/1 stay on screen in Mussoorie: TEST ONLY Ridge — listed from ₹4,200\. Say "open it"/.test(TB.formatResults("en", r1, "mussoorie")), "1 result (English)");
  const r1np = [{ ...r1[0], minPrice: null }];
  ok(!/₹/.test(TB.formatResults("en", r1np, "mussoorie")), "no price in data → no price stated");
  const r2 = r1.concat([{ position: 2, id: "test-only-2", name: "TEST ONLY Cloud", city: "Mussoorie", minPrice: 5100, rating: 4.1, parking: "absent" }]);
  ok(/2 stays/.test(TB.formatResults("en", r2, "mussoorie")) && /compare the top two/.test(TB.formatResults("en", r2, "mussoorie")), "2+ results: count + how to compare");
  ok(/listed nahi/.test(TB.formatResults("hinglish", [], "kasol", { filtered: false })) && /destination/.test(TB.formatResults("hinglish", [], "kasol", { filtered: false })), "0 results, no filter applied → 'none listed', suggests another destination (not a budget change)");
  ok(/Budget badha/.test(TB.formatResults("hinglish", [], "goa", { filtered: true })), "0 results with a filter applied → suggests relaxing the budget");
  ok(/parking listed: TEST ONLY Ridge/.test(TB.formatCompare("en", r2, 1, 1)), "compare: parking stated only from present/absent listing data");
  const r2u = [r2[0], { ...r2[1], parking: "unknown" }];
  ok(!/parking/.test(TB.formatCompare("en", r2u, 1, 1)), "compare: an UNKNOWN parking fact is never asserted");
  const rooms = TB.formatRooms("en", [{ name: "Deluxe", floorPrice: 4200 }, { name: "Suite", floorPrice: 6100 }], "TEST ONLY Ridge");
  ok(/TEST ONLY Ridge lists 2 room types: Deluxe, Suite/.test(rooms) && /availability isn't confirmed/.test(rooms) && !/₹|4200|6100/.test(rooms), "rooms: names only from the validated snapshot; no rate / availability claim");
  ok(/aur 2 aur/.test(TB.formatRooms("hinglish", [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }], null)), "rooms: long list bounded to 3 names + count");
  ok(/data mein nahi/.test(TB.formatRooms("hinglish", [], "X")) && /isn't in the current data/.test(TB.formatRooms("en", null, null)), "rooms: none loaded → honest 'not in data'");
}

section("TP-04 Dates / guests / availability — noted only, never a vacancy or capacity claim");
{
  const pl = plan("18 se 20 October, 2 adults, 5000 ke andar, parking", listCtx({ listDestination: "dhanaulti" }));
  eq(ops(pl), [{ op: "APPLY_HOTEL_REFINEMENT", maxPrice: 5000, parking: true }], "only budget + parking applied; dates/guests are NOT operations");
  ok(/availability ya room capacity confirm nahi/.test(says(pl)), "Hinglish: availability AND capacity explicitly unconfirmed");
  eq([pl.slots.guests, !!pl.slots.dates], [2, true], "dates + guests kept as ephemeral noted slots");
  const av = plan("kya room available hai", detailCtx);
  ok(/Availability ya room capacity main check nahi karta/.test(says(av)) && says(av).indexOf("Availability") >= 0, "availability question on a hotel → honest 'not checked' caption FIRST");
  ok(ops(av).every((o) => o.op === "SHOW_HOTEL_SECTION" || o.op === "READ_CURRENT_HOTEL_FACTS"), "… plus at most the UI-local rooms view + room-name read (no availability op exists)");
  const avNoRoom = plan("kya yeh available hai", detailCtx);
  ok(ops(avNoRoom).length === 0 && /check nahi karta/.test(says(avNoRoom)), "availability question without 'room' → caption only, no op");
  const avEn = plan("is this available next weekend", listCtx());
  ok(/availability and room capacity are not confirmed/.test(says(avEn)) && ops(avEn).length === 0, "English dates + availability → noted only");
}

section("TP-05 Unknown destination + inventory categories — honest, no invented mapping");
{
  const d = plan("Delhi ke hotels dikhao", homeCtx);
  ok(d.steps.every((s) => s.kind !== "navigate_hotels") && ops(d).length === 0, "unknown destination: no navigation, no op");
  ok(/"Delhi" abhi StayBid ki destination list mein nahi hai/.test(says(d)) && /Mussoorie/.test(says(d)), "unknown destination: says so + offers allow-listed destinations");
  ok(!/Maaf kijiye/.test(says(d)), "unknown destination is NOT a 'didn't understand' fallback");
  const c = plan("StayBid Circle hotels in Mussoorie", homeCtx);
  ok(c.steps.some((s) => s.kind === "navigate_hotels" && s.city === "mussoorie"), "category + city: the city journey proceeds");
  ok(/no "StayBid Circle" category filter/.test(says(c)), "category (English): honestly says there is no category filter");
  ok(/"StayBid Circle" category ka filter Buddy mein nahi hai/.test(says(plan("Mussoorie mein StayBid Circle wale hotel dikhao", homeCtx))), "category (Hinglish): honestly says there is no category filter");
  eq(c.deferred, null, "category is never turned into a hidden filter");
  for (const t of ["traditional hotels dikhao", "staybid operated stays", "circle wale hotel"]) {
    const pl = plan(t, listCtx({ listDestination: "mussoorie" }));
    ok(ops(pl).every((o) => o.op !== "APPLY_HOTEL_REFINEMENT"), `[hotels] '${t}' → no refinement invented for a category`);
  }
}

section("TP-06 Booking / bid / payment — guidance + demo caveat, still no write");
{
  for (const ctx of [homeCtx, listCtx(), detailCtx]) {
    const pl = plan("is hotel par bid lagao", ctx);
    ok(/demo inventory/.test(says(pl)) && /khud/.test(says(pl)), `[${ctx.surface}] booking guidance names DEMO inventory + manual-only`);
    ok(!/tap "Bid"|Bid" aap khud tap/.test(says(pl)), `[${ctx.surface}] guidance no longer nudges the guest into a bid on demo stock`);
  }
  const corpus = ["isko kholo", "open it", "Top do compare karo", "Delhi ke hotels", "StayBid Circle hotels", "kya room available hai", "18 October 2 adults", "rooms dikhao", "traditional hotel"];
  let all = [];
  for (const ctx of [homeCtx, listCtx({ visibleCount: 1 }), listCtx({ visibleCount: 3 }), detailCtx]) for (const t of corpus) all = all.concat(ops(plan(t, ctx)));
  ok(all.length > 3 && all.every((o) => ["READ", "UI_LOCAL"].includes(C.OPERATION_AUTHORITY[o.op]) && C.validateOperation(o) !== null), "every new-intent op is READ / UI_LOCAL and passes the closed validator");
}

section("TP-07 THREE demo categories (TEST ONLY synthetic) — identical handling through the REAL runtime");
{
  // TEST ONLY: shapes mimic the three Owner-declared categories using the admin discriminator fields
  // (owner_type / account_type / ownerId prefix). The PUBLIC card projection does not carry them; the
  // journey must therefore be category-independent. NOT production data or counts.
  const hotels = [
    { id: "test-only-circle-1", name: "TEST ONLY Circle Stay", city: "Mussoorie", ownerId: "hco_test_only_1", owner_type: "host_circle", avgRating: 4.4, amenities: ["Parking"], rooms: [{ name: "TEST Deluxe", floorPrice: 4000 }] },
    { id: "test-only-operated-1", name: "TEST ONLY Operated Stay", city: "Mussoorie", ownerId: "owner_test_only_2", owner_type: "circle", account_type: "staybid_operated", avgRating: 4.7, amenities: ["WiFi"], rooms: [{ name: "TEST Suite", floorPrice: 6500 }] },
    { id: "test-only-traditional-1", name: "TEST ONLY Traditional Stay", city: "Mussoorie", ownerId: "owner_test_only_3", avgRating: 4.1, amenities: ["Parking", "Breakfast"], rooms: [{ name: "TEST Standard", floorPrice: 3100 }] },
  ];
  const page = { list: hotels, calls: [] };
  const snap = () => C.buildHotelsSnapshot({
    displayHotels: page.list, city: "Mussoorie", query: "", checkIn: "", checkOut: "", guests: 2,
    maxPrice: null, sort: "default", stars: [], appliedAmenities: [], amenityOpts: ["WiFi", "Parking", "Breakfast"],
    loading: false, error: "", resolvedCity: "Mussoorie", resolvedQuery: "", resolvedStatus: "ready", role: "anonymous",
  });
  const s = snap();
  eq(s.visibleHotels.map((h) => h.id), hotels.map((h) => h.id), "all three categories become visible rows in their true positions");
  ok(s.visibleHotels.every((h) => JSON.stringify(Object.keys(h)) === JSON.stringify(["position", "id", "name", "city", "minPrice", "rating", "parking"])), "visible rows carry NO category/owner field (no category leakage or invention)");
  ok(!/host_circle|staybid_operated|owner_test_only|hco_test/.test(JSON.stringify(s)), "snapshot (incl. contextRevision) contains no owner/category discriminator");
  const rt = R.createLiveAiRuntime("anonymous");
  rt.invalidateRoute("/hotels");
  rt.registerPage({ pageId: "hotels", routeKey: "/hotels", getSnapshot: snap, execute: (cmd) => page.calls.push(cmd) });
  rt.activate();
  for (let pos = 1; pos <= 3; pos++) {
    rt.beginTurn("open " + pos);
    const res = rt.execute(rt.makeEnvelope({ op: "OPEN_VISIBLE_HOTEL", position: pos }));
    ok(res.ok && res.resolvedHotelId === hotels[pos - 1].id, `open position ${pos} → ${hotels[pos - 1].id} (same path for every category)`);
  }
  rt.beginTurn("compare");
  const cmp = rt.execute(rt.makeEnvelope({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating"] }));
  ok(cmp.ok && cmp.comparison.cheapestPosition === 1 && cmp.comparison.topRatedPosition === 2, "compare across categories uses only price/rating data");
  ok(/sasta: TEST ONLY Circle Stay/.test(TB.formatCompare("hinglish", cmp.comparison.rows, cmp.comparison.cheapestPosition, cmp.comparison.topRatedPosition)), "compare caption grounded in the rows");
  for (const h of hotels) {
    const d = C.buildHotelDetailSnapshot({ routeId: h.id, hotel: h, loading: false, loadErr: false, tab: "rooms", role: "anonymous" });
    ok(d.validated && d.roomTypes.length === 1 && !/host_circle|staybid_operated/.test(JSON.stringify(d)), `detail snapshot validated identically for ${h.id}; no category leak`);
  }
  ok(page.calls.every((c) => c.kind === "open_hotel"), "only typed UI_LOCAL open commands reached the page");
}

section("TP-08 ONE-stay city end-to-end (TEST ONLY) — planner context derived from the REAL published snapshot");
{
  const one = [{ id: "test-only-single", name: "TEST ONLY Single Retreat", city: "Mussoorie", avgRating: 4.5, amenities: ["Parking"], rooms: [{ name: "TEST Deluxe", floorPrice: 4500 }, { name: "TEST Family", floorPrice: 6200 }] }];
  const page = { calls: [] };
  const snap = () => C.buildHotelsSnapshot({
    displayHotels: one, city: "Mussoorie", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null, sort: "default",
    stars: [], appliedAmenities: [], amenityOpts: ["Parking"], loading: false, error: "", resolvedCity: "Mussoorie",
    resolvedQuery: "", resolvedStatus: "ready", role: "anonymous",
  });
  const rt = R.createLiveAiRuntime("anonymous");
  rt.invalidateRoute("/hotels");
  rt.registerPage({ pageId: "hotels", routeKey: "/hotels", getSnapshot: snap, execute: (cmd) => page.calls.push(cmd) });
  rt.activate();
  // Same derivation as TravelBuddy.plannerContext().
  const pub = rt.publishedContext();
  const ctx = { surface: "hotels", listDestination: pub.destination, listMaxPrice: pub.refinement ? pub.refinement.maxPrice ?? null : null, listParking: !!(pub.refinement && pub.refinement.parking), listReady: pub.loadState === "ready", visibleCount: pub.visibleHotels.length, detailValidated: false };
  eq([ctx.listReady, ctx.visibleCount], [true, 1], "published context: ready, exactly one visible stay");
  const results = rt.execute(rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" }));
  ok(/1 stay screen par hai: TEST ONLY Single Retreat/.test(TB.formatResults("hinglish", results.results, ctx.listDestination)), "announcement names the single stay");
  const cmp = TB.planTurn(P("dono compare karo"), ctx, TB.emptySlots(), CITIES);
  ok(ops(cmp).length === 0, "compare on a one-stay city → no runtime op (no fabricated second hotel)");
  const open = TB.planTurn(P("isko kholo"), ctx, TB.emptySlots(), CITIES);
  rt.beginTurn("isko kholo");
  const res = rt.execute(rt.makeEnvelope(ops(open)[0]));
  ok(res.ok && res.resolvedHotelId === "test-only-single" && page.calls[0].kind === "open_hotel", "'isko kholo' opens the single stay via the typed envelope");
  const d = C.buildHotelDetailSnapshot({ routeId: "test-only-single", hotel: one[0], loading: false, loadErr: false, tab: "about", role: "anonymous" });
  ok(/2 room types: TEST Deluxe, TEST Family/.test(TB.formatRooms("en", d.roomTypes, d.hotel.name)), "detail rooms guidance names the snapshot's room types");
  const stale = C.buildHotelDetailSnapshot({ routeId: "test-only-single", hotel: { ...one[0], id: "other-id" }, loading: false, loadErr: false, tab: "rooms", role: "anonymous" });
  ok(!stale.validated && stale.roomTypes.length === 0, "a stale / other hotel never yields room guidance");
}

section("TP-09 Typed-only preview + demo disclosure — source proofs");
{
  eq([TB.isTextOnlyPreview("1"), TB.isTextOnlyPreview(undefined), TB.isTextOnlyPreview("true"), TB.isTextOnlyPreview(" 1")], [true, false, false, false], "typed-only flag: exactly '1' only");
  ok(/demo/.test(TB.DEMO_NOTE.hinglish) && /confirm nahi/.test(TB.DEMO_NOTE.hinglish) && /demo listings/.test(TB.DEMO_NOTE.en) && /not confirmed/.test(TB.DEMO_NOTE.en), "DEMO note (both languages) says demo + not confirmed");
  ok(TB.DEMO_NOTE.en.length <= 90 && TB.DEMO_NOTE.hinglish.length <= 90, "DEMO note is small (≤ 90 chars)");
  ok(!/^Note:/i.test(TB.DEMO_NOTE.en) && !/^Note:/i.test(TB.DEMO_NOTE.hinglish), "DEMO note carries no own 'Note:' prefix (the caption label supplies it — no 'Note: Note:')");
  ok(/typed preview/.test(TB.TYPED_PREVIEW_NOTE.hinglish) && /typed preview/.test(TB.TYPED_PREVIEW_NOTE.en), "typed-preview note");
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const comp = strip(fs.readFileSync(path.join(REPO, "components/live-ai/TravelBuddy.tsx"), "utf8"));
  const body = (name) => { const i = comp.indexOf(`const ${name} = useCallback(`); if (i < 0) return ""; const j = comp.indexOf("\n  }, [", i); return comp.slice(i, j); };
  ok(/isTextOnlyPreview\(\) \? null :/.test(comp), "typed-only: SpeechRecognition is never resolved");
  ok(/!isTextOnlyPreview\(\) && typeof window !== "undefined" && "speechSynthesis" in window\) window\.speechSynthesis\.cancel\(\)/.test(body("cancelSpeech")), "typed-only: speechSynthesis.cancel() is never called");
  ok(/mutedRef\.current \|\| isTextOnlyPreview\(\)/.test(comp), "typed-only: speechSynthesis.speak() is never reached");
  const ss = body("startSession");
  ok(/if \(typedOnlyPreview\) \{ focusInputRef\.current = true; setTyping\(true\); \}/.test(ss) && ss.indexOf("setTyping(true)") < ss.indexOf("await"), "typed-only: the keyboard opens SYNCHRONOUSLY in the activation tap");
  ok(/TYPED_PREVIEW_NOTE\[langRef\.current\]/.test(ss) && /demoNoteShownRef\.current = false/.test(ss), "typed-only note replaces the 'browser has no voice' hint; demo note re-armed per session");
  ok(/\{!textOnlyPreview && \(\s*<button type="button" className="tb-chip" aria-pressed=\{muted\}/.test(comp), "typed-only: no 'Mute voice' control (nothing to mute)");
  ok((comp.match(/Listings are StayBid demo inventory: prices and availability are not confirmed\./g) || []).length === 2, "options disclosure names DEMO inventory (typed + voice variants)");
  ok((comp.match(/await noteDemoOnce\(gen\)/g) || []).length === 5, "demo note follows results (×2 paths), compare, facts and rooms captions");
  ok(/demoNoteShownRef\.current \|\| gen !== genRef\.current\) return;\s*demoNoteShownRef\.current = true;/.test(body("noteDemoOnce")), "demo note shown at most once per session");
  ok(/step\.purpose === "rooms" && res\.facts/.test(comp) && /formatRooms\(langRef\.current, res\.facts\.roomTypes/.test(comp), "rooms guidance reads ONLY the runtime facts result (validated detail snapshot)");
  ok(/filtered: listFiltered\(\)/.test(comp) && /pub\.refinement\?\.maxPrice != null \|\| !!pub\.refinement\?\.parking/.test(body("listFiltered")), "0-result advice keyed to the page's OWN applied filters");
  // Follow-ups stay coherent with what the list actually shows.
  ok(/announcedCountRef\.current = null;/.test(comp) && (comp.match(/announcedCountRef\.current = res\.results\.length;/g) || []).length === 2, "per-turn announced result count is reset and recorded on both result paths");
  ok(/const fewAnnounced = announcedCountRef\.current != null && announcedCountRef\.current <= 1;\s*if \(plan\.followUp && !fewAnnounced\)/.test(comp), "no 'open an option / budget' follow-up after a 0- or 1-stay announcement");
  ok(/silenceFollowUp\(surfaceRef\.current, slotsRef\.current, langRef\.current, visibleNow\)/.test(body("armSilence")) && /pub\.loadState === "ready" \? pub\.visibleHotels\.length : null/.test(body("armSilence")), "silence nudge reads the CURRENT ready list count");
}

section("TP-10 Silence nudge — grounded in the current list count");
{
  ok(/destination ya budget/.test(TB.silenceFollowUp("hotels", { ...TB.emptySlots(), city: "goa" }, "hinglish", 0)), "0 stays → suggests another destination / budget (never 'open an option')");
  ok(/open it/.test(TB.silenceFollowUp("hotels", { ...TB.emptySlots(), city: "mussoorie", maxPrice: 5000 }, "en", 1)), "1 stay → 'open it' (never 'say its number')");
  ok(/second option/.test(TB.silenceFollowUp("hotels", { ...TB.emptySlots(), city: "rishikesh", maxPrice: 5000 }, "en", 2)), "2+ stays → unchanged 'open the second option' hint");
  ok(/budget/.test(TB.silenceFollowUp("hotels", { ...TB.emptySlots(), city: "rishikesh" }, "en", null)), "count unknown (loading) → unchanged behaviour");
  ok(/rooms/.test(TB.silenceFollowUp("hotel-detail", TB.emptySlots(), "en", 0)), "detail page nudge unchanged");
}

console.log(`\n${"─".repeat(54)}`);
console.log(`Travel Buddy preview: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
console.log("ALL TRAVEL BUDDY PREVIEW CHECKS PASSED");
process.exit(0);
