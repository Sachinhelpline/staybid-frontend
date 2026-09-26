#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live-AI — OWNER-PREVIEW deterministic first-slice test suite.
//   Run:  node tests/live-ai/live-ai-owner-preview.test.js
//
// Compiles the PURE lib/live-ai/*.ts with the lockfile-installed local tsc and drives the REAL runtime + the
// NEW pure owner-preview interpreter (lib/live-ai/owner-preview.ts). Proves §16: the fail-closed gate, exactly-
// one-controller, deterministic Hindi/Hinglish/English parsing, ordinal-only OPEN (no arbitrary id), tri-state
// detail facts, section actions, route/stale invalidation, refinement-verified-only-after-reconcile, unsupported
// → bounded help (no mutation), CONFIRMED_WRITE unavailable, and NO network/provider/mic construction.
// NO network, NO provider, NO gateway, NO microphone, NO DB.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "owner-preview");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "live-ai"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
fs.copyFileSync(path.join(REPO, "lib/cities.ts"), path.join(SRC, "cities.ts"));   // owner-preview imports the canonical city registry (../cities)
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
      lib: ["es2020", "dom"], noEmitOnError: true, strict: true,
    },
    include: ["live-ai/**/*.ts"],
  }),
);
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
if (!fs.existsSync(path.join(OUT, "live-ai/owner-preview.js"))) { console.error("COMPILE GATE FAILED — no JS emitted"); process.exit(2); }
console.log("• Local tsc compile (strict): exit 0");

process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";   // V — required or runtime.execute() → "disabled"
const C = require(path.join(OUT, "live-ai/contracts.js"));
const R = require(path.join(OUT, "live-ai/runtime.js"));
const P = require(path.join(OUT, "live-ai/owner-preview.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const titleCase = (s) => String(s).replace(/\b\w/g, (m) => m.toUpperCase());

// ── fixture: a bounded PublishedContext for pure-interpreter tests ──
function listCtx(names) {
  return {
    pageId: "hotels", role: "anonymous", destination: null, query: null, loadState: "ready",
    visibleHotels: (names || ["Alpine Alpha", "Bravo Retreat", "Charlie Cottage"]).map((name, i) => ({
      position: i + 1, id: "htl_" + i, name, city: "Dhanaulti", minPrice: 3000 + i * 500, rating: 4 + i * 0.2, parking: "present",
    })),
    currentHotelId: null, validated: false, section: null, breakfast: null, parking: null, refinement: null,
  };
}
function detailCtx() {
  return {
    pageId: "hotel-detail", role: "anonymous", destination: null, query: null, loadState: "ready",
    visibleHotels: [], currentHotelId: "htl_x", validated: true, section: "rooms",
    breakfast: "present", parking: "present", refinement: null,
  };
}

// ── real-runtime page fixtures (mirror live-ai.test.js: getSnapshot IS the production builder) ──
function makeHotelsPage(init) {
  init = init || {};
  const s = {
    base: (init.displayHotels || []).slice(), displayHotels: (init.displayHotels || []).slice(),
    city: init.city || "", query: init.query || "", checkIn: "", checkOut: "", guests: 2,
    maxPrice: init.maxPrice == null ? null : init.maxPrice, sort: init.sort || "default",
    stars: init.stars ? init.stars.slice() : [], appliedAmenities: init.appliedAmenities ? init.appliedAmenities.slice() : [],
    amenityOpts: init.amenityOpts || ["WiFi", "Parking", "Breakfast", "Pool", "AC"],
    loading: !!init.loading, error: init.error || "",
    resolvedCity: init.resolvedCity !== undefined ? init.resolvedCity : (init.city || ""),
    resolvedQuery: init.resolvedQuery !== undefined ? init.resolvedQuery : (init.query || ""),
    resolvedStatus: init.resolvedStatus || "ready", opened: null, openCalls: 0,
  };
  const recompute = () => {
    s.displayHotels = s.base.filter((h) => {
      if (s.maxPrice != null && !(h._minPrice != null && h._minPrice <= s.maxPrice)) return false;
      if (s.stars.length && !s.stars.includes(Number(h.starRating) || 0)) return false;
      return true;
    });
  };
  const reg = {
    pageId: "hotels", routeKey: "/hotels",
    getSnapshot: () => C.buildHotelsSnapshot({
      displayHotels: s.displayHotels, city: s.city, query: s.query, checkIn: s.checkIn, checkOut: s.checkOut,
      guests: s.guests, maxPrice: s.maxPrice, sort: s.sort, stars: s.stars, appliedAmenities: s.appliedAmenities,
      amenityOpts: s.amenityOpts, loading: s.loading, error: s.error, resolvedCity: s.resolvedCity,
      resolvedQuery: s.resolvedQuery, resolvedStatus: s.resolvedStatus, role: "anonymous",
    }),
    execute: (cmd) => {
      if (cmd.kind === "apply_refinement") {
        if ("destination" in cmd) s.city = cmd.destination ? titleCase(cmd.destination) : "";
        if ("query" in cmd) s.query = cmd.query || "";
        if ("maxPrice" in cmd) s.maxPrice = cmd.maxPrice == null ? null : cmd.maxPrice;
        if ("sort" in cmd && cmd.sort) s.sort = cmd.sort;
        if ("stars" in cmd && cmd.stars) s.stars = cmd.stars.slice();
        if ("parking" in cmd && cmd.parking !== undefined) {
          s.appliedAmenities = s.appliedAmenities.filter((a) => !/parking/i.test(a));
          if (cmd.parking && cmd.parkingAmenity) s.appliedAmenities.push(cmd.parkingAmenity);
        }
        recompute();
      } else if (cmd.kind === "open_hotel") {
        s.opened = { hotelId: cmd.hotelId, position: cmd.position }; s.openCalls += 1;
      }
    },
  };
  return { s, reg, resolveTo: (city, q, st) => { s.resolvedCity = city; s.resolvedQuery = q == null ? "" : q; s.resolvedStatus = st || "ready"; s.loading = false; }, startLoading: () => { s.loading = true; } };
}
function makeDetailPage(init) {
  const s = { routeId: init.routeId, hotel: init.hotel === undefined ? null : init.hotel, loading: !!init.loading, loadErr: !!init.loadErr, tab: init.tab || "rooms", sectionCalls: 0 };
  const reg = {
    pageId: "hotel-detail", routeKey: `/hotels/${init.routeId}`,
    getSnapshot: () => C.buildHotelDetailSnapshot({ routeId: s.routeId, hotel: s.hotel, loading: s.loading, loadErr: s.loadErr, tab: s.tab, role: "anonymous" }),
    execute: (cmd) => { if (cmd.kind === "show_section") { s.tab = cmd.section; s.sectionCalls += 1; } },
  };
  return { s, reg };
}
const HOTELS = [
  { id: "htl_alpha", name: "Alpine Alpha", city: "Dhanaulti", _minPrice: 3200, avgRating: 4.7, starRating: 4, amenities: ["WiFi", "Parking", "Breakfast"] },
  { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", _minPrice: 4100, avgRating: 4.9, starRating: 5, amenities: ["WiFi", "Breakfast"] },
  { id: "htl_charlie", name: "Charlie Cottage", city: "Dhanaulti", _minPrice: 2600, avgRating: 4.2, starRating: 3, amenities: ["Parking"] },
];
function bootHotels(init) { const rt = R.createLiveAiRuntime("anonymous"); rt.activate(); const page = makeHotelsPage(init); rt.invalidateRoute("/hotels"); rt.registerPage(page.reg); return { rt, page }; }
function bootDetail(init) { const rt = R.createLiveAiRuntime("anonymous"); rt.activate(); const page = makeDetailPage(init); rt.invalidateRoute(`/hotels/${init.routeId}`); rt.registerPage(page.reg); return { rt, page }; }
// mirror of the provider preview controller's SINGLE-turn drive (interpret → envelope → execute), no React.
function drive(rt, text) {
  const ctx = rt.publishedContext();
  const outcome = P.interpretOwnerPreview(text, ctx);
  if (outcome.kind !== "operation") return { outcome };
  const turnId = rt.beginTurn(text);
  const env = rt.makeEnvelope(outcome.operation, turnId);
  if (!env) return { outcome, result: { ok: false, status: "no_envelope" } };
  const result = rt.execute(env);
  return { outcome, env, result };
}

(function main() {
  // ── §16 — the fail-closed gate + exactly-one-controller ──
  section("gate — fail-closed, provider-exclusive");
  eq(P.resolveOwnerPreviewGate(true, false, {}), false, "gate OFF when the owner-preview flag is absent");
  eq(P.resolveOwnerPreviewGate(true, false, { NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW: "1" }), true, "gate ON when V + flag + provider dormant");
  eq(P.resolveOwnerPreviewGate(false, false, { NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW: "1" }), false, "gate OFF when V (enabled) is off");
  eq(P.resolveOwnerPreviewGate(true, true, { NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW: "1" }), false, "gate OFF when the provider path is enabled (provider owns the turn)");
  ok(P.resolveOwnerPreviewGate(true, true, { NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW: "1" }) === false && P.resolveOwnerPreviewGate(true, false, { NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW: "1" }) === true, "exactly one controller: provider XOR preview");
  {
    // Default (no injected env) path reads the real process env: OFF when unset, ON when set.
    const prev = process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW;
    delete process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW;
    eq(P.resolveOwnerPreviewGate(true, false), false, "default env path: OFF when the flag is unset");
    process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW = "1";
    eq(P.resolveOwnerPreviewGate(true, false), true, "default env path: ON when V + flag set");
    eq(P.resolveOwnerPreviewGate(true, true), false, "default env path: still OFF when provider is enabled");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW; else process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW = prev;
    // Next.js inlines ONLY literal NEXT_PUBLIC_* member reads into the client bundle; a dynamic key is always
    // undefined in the browser. Pin the literal read so the preview can actually turn on client-side.
    const gateSrc = fs.readFileSync(path.join(REPO, "lib/live-ai/owner-preview.ts"), "utf8");
    ok(/process\.env\.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW\b/.test(gateSrc), "gate reads the literal process.env.NEXT_PUBLIC_LIVE_AI_OWNER_PREVIEW (client-inlinable)");
    ok(!/process\.env\[/.test(gateSrc), "gate never uses a dynamic process.env[...] key (not inlined client-side)");
  }

  // ── pure interpreter — refinement (Hindi/Hinglish/English) ──
  section("interpreter — refinement dimensions");
  {
    const o = P.interpretOwnerPreview("show hotels in Mussoorie under 5000 with parking", listCtx());
    ok(o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT", "english refinement → APPLY");
    eq(o.operation.destination, "mussoorie", "english destination canonicalized");
    eq(o.operation.maxPrice, 5000, "english maxPrice");
    eq(o.operation.parking, true, "english parking");
  }
  {
    const o = P.interpretOwnerPreview("Mussoorie me 5000 ke andar parking wale dikhao", listCtx());
    ok(o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT", "hinglish refinement → APPLY");
    eq(o.operation.destination, "mussoorie", "hinglish destination");
    eq(o.operation.maxPrice, 5000, "hinglish maxPrice (ke andar)");
    eq(o.operation.parking, true, "hinglish parking");
  }
  {
    const o = P.interpretOwnerPreview("₹5000 se kam parking", listCtx());
    ok(o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT", "₹ budget refinement → APPLY");
    eq(o.operation.maxPrice, 5000, "₹ maxPrice (se kam)");
    eq(o.operation.parking, true, "₹ parking");
    ok(!("destination" in o.operation), "no destination guessed when none present");
  }
  {
    const o = P.interpretOwnerPreview("5 star", listCtx());
    ok(o.kind === "operation" && Array.isArray(o.operation.stars) && o.operation.stars[0] === 5, "stars refinement");
  }
  {
    // a bare number with NO budget cue must NOT be treated as a price (no guessing an ambiguous dimension)
    const o = P.interpretOwnerPreview("5000", listCtx());
    ok(o.kind === "info", "bare number with no budget cue → bounded help, no operation");
  }
  {
    const o = P.interpretOwnerPreview("asdfghjkl random gibberish", listCtx());
    ok(o.kind === "info", "unsupported input → bounded help (no mutation)");
  }

  // ── pure interpreter — results / compare / open ──
  section("interpreter — results / compare / open");
  eq(P.interpretOwnerPreview("kya options hain", listCtx()).operation.op, "READ_CURRENT_RESULTS", "hinglish current results");
  eq(P.interpretOwnerPreview("what do you see", listCtx()).operation.op, "READ_CURRENT_RESULTS", "english current results");
  {
    const o = P.interpretOwnerPreview("top 2 compare karo", listCtx());
    ok(o.kind === "operation" && o.operation.op === "COMPARE_VISIBLE_HOTELS", "compare → COMPARE");
    eq(JSON.stringify(o.operation.positions), JSON.stringify([1, 2]), "compare uses first two TRUE visible positions");
    eq(JSON.stringify(o.operation.factors), JSON.stringify(["price", "rating", "parking"]), "list compare factors exclude breakfast (§7C)");
  }
  ok(P.interpretOwnerPreview("pehle do compare karo", listCtx()).operation.op === "COMPARE_VISIBLE_HOTELS", "hinglish 'pehle do compare'");
  {
    const o = P.interpretOwnerPreview("compare", listCtx(["Only One"]));
    ok(o.kind === "unavailable", "compare with <2 visible → unavailable");
  }
  {
    const o = P.interpretOwnerPreview("second wala kholo", listCtx());
    ok(o.kind === "operation" && o.operation.op === "OPEN_VISIBLE_HOTEL", "hinglish 'second wala kholo' → OPEN");
    eq(o.operation.position, 2, "open resolves the 2nd TRUE visible position");
  }
  eq(P.interpretOwnerPreview("open second", listCtx()).operation.position, 2, "english 'open second'");
  eq(P.interpretOwnerPreview("2nd hotel open karo", listCtx()).operation.position, 2, "'2nd hotel open karo'");
  {
    const o = P.interpretOwnerPreview("open htl_alpha", listCtx());
    ok(o.kind !== "operation", "OPEN never accepts an arbitrary hotel id from free text (ordinal only)");
  }
  {
    const o = P.interpretOwnerPreview("open the 9th", listCtx());
    ok(o.kind === "unavailable", "OPEN beyond the visible count → unavailable");
  }

  // ── pure interpreter — detail facts (tri-state focus) + sections ──
  section("interpreter — detail facts + sections");
  { const o = P.interpretOwnerPreview("parking hai?", detailCtx()); ok(o.kind === "operation" && o.operation.op === "READ_CURRENT_HOTEL_FACTS" && o.factsFocus === "parking", "parking question → FACTS focus parking"); }
  { const o = P.interpretOwnerPreview("breakfast included hai?", detailCtx()); ok(o.operation.op === "READ_CURRENT_HOTEL_FACTS" && o.factsFocus === "breakfast", "breakfast question → FACTS focus breakfast"); }
  { const o = P.interpretOwnerPreview("what facilities does this stay have?", detailCtx()); ok(o.operation.op === "READ_CURRENT_HOTEL_FACTS" && o.factsFocus === "all", "facilities question → FACTS focus all"); }
  { const o = P.interpretOwnerPreview("rooms dikhao", detailCtx()); ok(o.operation.op === "SHOW_HOTEL_SECTION" && o.operation.section === "rooms", "'rooms dikhao' → SHOW rooms"); }
  { const o = P.interpretOwnerPreview("show details", detailCtx()); ok(o.operation.op === "SHOW_HOTEL_SECTION" && o.operation.section === "about", "'show details' → SHOW about"); }
  {
    const okShow = { ok: true, status: "ok", operation: "SHOW_HOTEL_SECTION" };
    eq(P.formatExecutionReply(okShow, { section: "about" }), "Showing About this stay.", "SHOW reply names the About section");
    eq(P.formatExecutionReply(okShow, { section: "rooms" }), "Showing the rooms.", "SHOW reply names the rooms section");
    eq(P.formatExecutionReply(okShow), "Showing that section.", "SHOW reply without a hint stays neutral");
  }

  // ── real runtime — READ / COMPARE / OPEN ──
  section("runtime — read / compare / open");
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const r1 = drive(rt, "kya options hain");
    eq(r1.result.status, "ok", "READ_CURRENT_RESULTS executes ok");
    eq(P.formatExecutionReply(r1.result), "3 stays are on screen.", "results reply reads runtime output");
    const r2 = drive(rt, "top 2 compare");
    eq(r2.result.status, "ok", "COMPARE executes ok");
    ok(/cheaper|rated/.test(P.formatExecutionReply(r2.result)), "compare reply from runtime comparison");
    const r3 = drive(rt, "open second");
    eq(r3.result.status, "ok", "OPEN executes ok");
    ok(page.s.openCalls === 1 && page.s.opened && page.s.opened.position === 2, "OPEN routed through the bridge at the 2nd position");
    ok(!!r3.result.resolvedHotelId, "OPEN returns a resolvedHotelId (from the visible row, never free text)");
  }

  // ── real runtime — refinement verified ONLY after reconcile ──
  section("runtime — refinement reconcile (catalogue: async receipt)");
  {
    // A DESTINATION refinement needs the page's resolved-catalogue receipt — the async path the preview poller
    // waits on. Mirrors live-ai.test.js REV-02.
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    const d = drive(rt, "show hotels in manali");
    ok(d.outcome.kind === "operation" && d.outcome.operation.destination === "manali", "preview interprets the destination refinement");
    eq(d.result.status, "ok", "APPLY executes ok");
    ok(d.result.pendingReconcile === true, "APPLY is pending reconcile — the setter running is NOT success");
    ok(P.formatVerifiedReply(rt.reconcile()) === null, "no verified reply before the catalogue resolves (no faked success)");
    page.startLoading();
    ok(P.formatVerifiedReply(rt.reconcile()) === null, "still not verified while loading");
    page.resolveTo("dhanaulti", "", "ready");   // a LATE stale resolution must not cross-verify
    ok(P.formatVerifiedReply(rt.reconcile()) === null, "a stale (other-destination) resolution cannot verify");
    page.resolveTo("manali", "", "ready");
    const speech = P.formatVerifiedReply(rt.reconcile());
    ok(typeof speech === "string" && /stays now match/i.test(speech), "verified reply ONLY once reconcile confirms the receipt");
  }
  section("runtime — refinement reconcile (local filter)");
  {
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const d = drive(rt, "under 4000");
    ok(d.result.ok && d.result.pendingReconcile === true && !(d.result.companion && d.result.companion.phase === "verified"), "local APPLY returns pending — execute never claims VERIFIED success");
    const speech = P.formatVerifiedReply(rt.reconcile());
    ok(typeof speech === "string" && /stays now match/i.test(speech), "local refinement verified via reconcile (new contextRevision)");
  }

  // ── real runtime — route + stale-context invalidation ──
  section("runtime — route / stale invalidation");
  {
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const ctx = rt.publishedContext();
    const op = P.interpretOwnerPreview("open second", ctx).operation;
    const turnId = rt.beginTurn("open second");
    const env = rt.makeEnvelope(op, turnId);
    rt.invalidateRoute("/hotels/other");   // navigating AWAY drops the old page's registration entirely
    const st = rt.execute(env).status;
    ok(st !== "ok" && (st === "no_registration" || st === "stale_route"), `an old envelope cannot act after navigating away (got ${st})`);
  }
  {
    // same route re-entered (registration kept) → the epoch still advanced → precise stale_route
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const op = P.interpretOwnerPreview("open second", rt.publishedContext()).operation;
    const env = rt.makeEnvelope(op, rt.beginTurn("open second"));
    rt.invalidateRoute("/hotels");        // route epoch bump (+ turn re-mint), registration retained
    const st2 = rt.execute(env).status;
    ok(st2 === "stale_turn" || st2 === "stale_route", `a pre-epoch envelope is refused even on the same page (got ${st2})`);
  }
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const op = P.interpretOwnerPreview("open second", rt.publishedContext()).operation;
    const turnId = rt.beginTurn("open second");
    const env = rt.makeEnvelope(op, turnId);
    page.s.city = "Manali"; page.s.resolvedCity = "Manali";   // an authority-relevant fact changed → new revision
    eq(rt.execute(env).status, "stale_context", "an envelope goes stale when the context revision changes");
  }

  // ── real runtime — detail facts tri-state + sections ──
  section("runtime — detail facts tri-state + sections");
  function factsReply(amenities, focus) {
    const { rt } = bootDetail({ routeId: "htl_x", hotel: { id: "htl_x", name: "X Stay", city: "Y", amenities, rooms: [{ name: "Deluxe", floorPrice: 2000 }] }, loading: false, tab: "rooms" });
    const res = rt.execute(rt.makeEnvelope({ op: "READ_CURRENT_HOTEL_FACTS" }, rt.beginTurn("q")));
    return { res, reply: P.formatExecutionReply(res, { factsFocus: focus }) };
  }
  eq(factsReply(["Parking"], "parking").reply, "Parking is available.", "parking present → available");
  eq(factsReply(["WiFi"], "parking").reply, "Parking is not listed.", "parking not mentioned → not listed");
  eq(factsReply(["Parking nearby"], "parking").reply, "Parking information is unknown.", "ambiguous parking → unknown (tri-state preserved)");
  eq(factsReply(["Breakfast"], "breakfast").reply, "Breakfast is available.", "breakfast present → available");
  eq(factsReply(["Parking"], "breakfast").reply, "Breakfast is not listed.", "breakfast not mentioned → not listed");
  eq(factsReply(["Breakfast on request"], "breakfast").reply, "Breakfast information is unknown.", "ambiguous breakfast → unknown");
  {
    const { rt, page } = bootDetail({ routeId: "htl_x", hotel: { id: "htl_x", name: "X", city: "Y", amenities: ["Parking"], rooms: [{ name: "Deluxe", floorPrice: 2000 }] }, loading: false, tab: "rooms" });
    const r = drive(rt, "about dikhao");
    eq(r.result.status, "ok", "SHOW_HOTEL_SECTION about executes ok");
    eq(page.s.tab, "about", "section change routed through the bridge");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // BOUNDED NATIVE DEVANAGARI (Hindi) — explicit cue lists + Unicode-aware boundaries + explicit city aliases.
  // Proves exactly the claimed boundary: English + Roman-Hindi/Hinglish + bounded native Devanagari for the
  // authorized first-slice intents. NOT general Hindi understanding / translation / arbitrary destinations.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const SIX_OPS = ["APPLY_HOTEL_REFINEMENT", "READ_CURRENT_RESULTS", "COMPARE_VISIBLE_HOTELS", "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "SHOW_HOTEL_SECTION"];
  const emitted = [];   // every operation emitted by the Devanagari/mixed cases below → validated at the end
  const hi = (text, ctx) => { const o = P.interpretOwnerPreview(text, ctx); if (o.kind === "operation") emitted.push(o.operation); return o; };
  const sameKeys = (obj, keys) => JSON.stringify(Object.keys(obj).sort()) === JSON.stringify(keys.slice().sort());

  section("devanagari — the five mandatory WORK closure examples");
  {
    const o = hi("मसूरी में 5000 के अंदर पार्किंग वाला होटल दिखाओ", listCtx());
    ok(o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT", "[1] native refinement → APPLY_HOTEL_REFINEMENT");
    eq(o.operation && o.operation.destination, "mussoorie", "[1] destination = mussoorie (explicit alias)");
    eq(o.operation && o.operation.maxPrice, 5000, "[1] maxPrice = 5000 (native budget cue 'के अंदर')");
    eq(o.operation && o.operation.parking, true, "[1] parking = true");
    ok(o.operation && sameKeys(o.operation, ["op", "destination", "maxPrice", "parking"]), "[1] NO extra dimension invented (exact key set)");
  }
  {
    const ctx = listCtx(["A", "B", "C"]);
    ctx.visibleHotels = ctx.visibleHotels.map((h, i) => ({ ...h, position: [4, 7, 9][i] }));   // non-contiguous TRUE positions
    const o = hi("पहले दो होटल compare करो", ctx);
    ok(o.kind === "operation" && o.operation.op === "COMPARE_VISIBLE_HOTELS", "[2] 'पहले दो होटल compare करो' → COMPARE");
    eq(JSON.stringify(o.operation && o.operation.positions), "[4,7]", "[2] compares the first two TRUE visible positions only");
    eq(JSON.stringify(o.operation && o.operation.factors), '["price","rating","parking"]', "[2] frozen factors price/rating/parking (no list breakfast)");
  }
  {
    const ctx = listCtx(["A", "B", "C"]);
    ctx.visibleHotels = ctx.visibleHotels.map((h, i) => ({ ...h, position: [3, 6, 8][i] }));
    const o = hi("दूसरा वाला खोलो", ctx);
    ok(o.kind === "operation" && o.operation.op === "OPEN_VISIBLE_HOTEL", "[3] 'दूसरा वाला खोलो' → OPEN_VISIBLE_HOTEL");
    eq(o.operation && o.operation.position, 6, "[3] opens the position of the SECOND visible stay");
    ok(o.operation && sameKeys(o.operation, ["op", "position"]), "[3] no hotel id in the operation (ordinal only)");
  }
  {
    const o = hi("पार्किंग है?", detailCtx());
    ok(o.kind === "operation" && o.operation.op === "READ_CURRENT_HOTEL_FACTS" && o.factsFocus === "parking", "[4] 'पार्किंग है?' on detail → FACTS focus parking");
  }
  {
    const o = hi("नाश्ता शामिल है?", detailCtx());
    ok(o.kind === "operation" && o.operation.op === "READ_CURRENT_HOTEL_FACTS" && o.factsFocus === "breakfast", "[5] 'नाश्ता शामिल है?' on detail → FACTS focus breakfast");
  }

  section("devanagari — compare / results / ordinals / open");
  eq(hi("पहले दो होटल तुलना करो", listCtx()).operation.op, "COMPARE_VISIBLE_HOTELS", "fully native compare 'तुलना करो'");
  eq(hi("मुकाबला करो", listCtx()).operation.op, "COMPARE_VISIBLE_HOTELS", "native compare 'मुकाबला'");
  eq(hi("मुक़ाबला करो", listCtx()).operation.op, "COMPARE_VISIBLE_HOTELS", "nukta spelling 'मुक़ाबला' (NFC-normalized)");
  {
    // U+0958 (precomposed QA) is an NFC composition exclusion: NFC turns it into U+0915 + U+093C. Input typed with
    // the precomposed code point only matches the cue because normalize() applies NFC first.
    const precomposed = "मु\u0958ाबला करो";
    ok(precomposed !== precomposed.normalize("NFC"), "fixture really is non-NFC input (precomposed U+0958)");
    eq(hi(precomposed, listCtx()).operation.op, "COMPARE_VISIBLE_HOTELS", "non-NFC input is NFC-normalized before matching");
  }
  for (const q of ["क्या विकल्प हैं", "क्या विकल्प है", "क्या दिख रहा है", "क्या दिख रहे हैं", "अभी क्या है"]) {
    const o = hi(q, listCtx());
    ok(o.kind === "operation" && o.operation.op === "READ_CURRENT_RESULTS" && sameKeys(o.operation, ["op"]), `current results '${q}' → READ_CURRENT_RESULTS (no inferred filter)`);
  }
  for (const [q, n] of [["पहला खोलो", 1], ["पहली खोलिए", 1], ["दूसरी खोलो", 2], ["दूसरे वाला खोल दो", 2], ["तीसरा खोलो", 3], ["तीसरी खोलें", 3], ["चौथा खोलो", 4], ["चौथी खोलो", 4]]) {
    eq(hi(q, listCtx(["A", "B", "C", "D", "E"])).operation.position, n, `native ordinal '${q}' → position ${n}`);
  }
  for (const q of ["पाँचवाँ खोलो", "पांचवां खोलो", "पाँचवां खोलो", "पांचवा खोलो", "पाँचवीं खोलो", "पांचवें खोलो"]) {
    eq(hi(q, listCtx(["A", "B", "C", "D", "E"])).operation.position, 5, `native ordinal variant '${q}' → position 5`);
  }
  eq(hi("पाँचवाँ खोलो", listCtx()).kind, "unavailable", "native ordinal beyond the visible count → unavailable (same bound)");

  section("devanagari — refinement cues + bounded city aliases");
  for (const [alias, city] of Object.entries(P.DEVANAGARI_CITY_ALIASES)) {
    const o = hi(`${alias} में होटल दिखाओ`, listCtx());
    eq(o.operation && o.operation.destination, city, `alias '${alias} में' → ${city}`);
    eq(C.canonicalCity(city), city, `alias target '${city}' is already canonical (canonicalCity unchanged)`);
  }
  eq(Object.keys(P.DEVANAGARI_CITY_ALIASES).length, 5, "alias map is small + explicit (5 Garhwal launch-zone cities)");
  eq(hi("मसूरी मे होटल दिखाओ", listCtx()).operation.destination, "mussoorie", "'<city> मे' postposition variant");
  for (const [q, n] of [["5000 से कम", 5000], ["4000 से नीचे", 4000], ["3500 के नीचे", 3500], ["6000 तक", 6000], ["बजट 4500", 4500], ["₹5000 के अंदर", 5000]]) {
    const o = hi(q, listCtx());
    ok(o.kind === "operation" && o.operation.maxPrice === n && sameKeys(o.operation, ["op", "maxPrice"]), `native budget cue '${q}' → maxPrice ${n} only`);
  }
  eq(hi("मसूरी में ५००० तक", listCtx()).operation.maxPrice, 5000, "Devanagari digits ५००० read as 5000 (digit map only)");
  eq(hi("पार्किंग वाला होटल दिखाओ", listCtx()).operation.parking, true, "native positive parking → parking=true");
  eq(hi("पार्किं‍ग वाला", listCtx()).operation.parking, true, "zero-width joiner inside a native word is normalized away");
  ok(P.interpretOwnerPreview("रेटिंग", detailCtx()).kind === "info", "'रेट' inside 'रेटिंग' is not the rate cue (Unicode boundary)");

  section("devanagari — detail facts + sections");
  eq(hi("कमरे कितने के हैं", detailCtx()).factsFocus, "rooms", "native rooms question → FACTS focus rooms");
  eq(hi("कीमत क्या है", detailCtx()).factsFocus, "rooms", "native price question → FACTS focus rooms");
  eq(hi("रेट बताओ", detailCtx()).factsFocus, "rooms", "native rate question → FACTS focus rooms");
  eq(hi("सुविधाएँ क्या हैं", detailCtx()).factsFocus, "all", "native facilities (ँ) → FACTS focus all");
  eq(hi("सुविधाएं क्या हैं", detailCtx()).factsFocus, "all", "native facilities (ं) → FACTS focus all");
  eq(hi("ब्रेकफास्ट मिलेगा?", detailCtx()).factsFocus, "breakfast", "native 'ब्रेकफास्ट' → FACTS focus breakfast");
  eq(hi("पार्किंग नहीं है?", detailCtx()).operation.op, "READ_CURRENT_HOTEL_FACTS", "negated parking on DETAIL is only a READ (never a mutation)");
  for (const [q, sec] of [["कमरे दिखाओ", "rooms"], ["कमरा दिखाइए", "rooms"], ["जानकारी दिखाओ", "about"], ["विवरण दिखा दो", "about"]]) {
    const o = hi(q, detailCtx());
    ok(o.kind === "operation" && o.operation.op === "SHOW_HOTEL_SECTION" && o.operation.section === sec, `'${q}' → SHOW_HOTEL_SECTION ${sec}`);
  }
  ok(P.interpretOwnerPreview("जानकारी", detailCtx()).kind === "info", "bare 'जानकारी' (no show verb) does NOT mutate the UI");
  ok(P.interpretOwnerPreview("दिखाओ", detailCtx()).kind === "info", "bare 'दिखाओ' on detail does NOT mutate the UI");

  section("devanagari — mixed script (same six-operation boundary)");
  {
    const o = hi("मसूरी me 5000 ke andar parking dikhao", listCtx());
    ok(o.kind === "operation" && o.operation.destination === "mussoorie" && o.operation.maxPrice === 5000 && o.operation.parking === true && sameKeys(o.operation, ["op", "destination", "maxPrice", "parking"]), "'मसूरी me 5000 ke andar parking dikhao' → same refinement");
  }
  eq(hi("दूसरा hotel open karo", listCtx()).operation.position, 2, "'दूसरा hotel open karo' → OPEN position 2");
  eq(hi("parking है?", detailCtx()).factsFocus, "parking", "'parking है?' → FACTS focus parking");
  eq(hi("नाश्ता included hai?", detailCtx()).factsFocus, "breakfast", "'नाश्ता included hai?' → FACTS focus breakfast");
  eq(hi("top 2 तुलना करो", listCtx()).operation.op, "COMPARE_VISIBLE_HOTELS", "'top 2 तुलना करो' → COMPARE");
  eq(hi("rooms दिखाओ", detailCtx()).operation.section, "rooms", "'rooms दिखाओ' → SHOW rooms");

  section("devanagari — fail-closed (no mutation without adequate intent)");
  for (const [q, ctx, label] of [
    ["मुझे कुछ अच्छा बताओ", listCtx(), "vague request"],
    ["5000", listCtx(), "bare number"],
    ["५०००", listCtx(), "bare Devanagari number"],
    ["होटल", listCtx(), "bare 'होटल'"],
    ["दूसरा", listCtx(), "bare ordinal without open cue"],
    ["खोलो", listCtx(), "bare open cue without ordinal"],
    ["दिखाओ", listCtx(), "bare show verb"],
    ["मसूरी", listCtx(), "city alias without an 'in' postposition"],
    ["खोलोगे", listCtx(), "'खोलोगे' is not the cue 'खोलो' (Unicode word boundary)"],
    ["दूसरा खोलोगे?", listCtx(), "cue inside a longer word + a valid ordinal still does NOT open (boundary, not substring)"],
    ["5000 तकिया वाला", listCtx(), "'तक' inside 'तकिया' is NOT a budget cue → bare number stays non-authoritative"],
    ["पार्किंगवाला मसूरीमें", listCtx(), "cues glued inside longer tokens are not matched"],
    ["पार्किंग नहीं", listCtx(), "negated parking (नहीं)"],
    ["पार्किंग नही", listCtx(), "negated parking (नही)"],
    ["बिना पार्किंग", listCtx(), "negated parking (बिना)"],
    ["मसूरी में बिना पार्किंग 5000 तक", listCtx(), "negated parking never partially applies the rest"],
    ["parking nahi chahiye", listCtx(), "Hinglish negated parking (after the word)"],
    ["मसूरी में और देहरादून में", listCtx(), "two native destinations → ambiguous"],
    ["होटल htl_alpha खोलो", listCtx(), "arbitrary hotel id in Hindi text"],
    ["open fx_hotel_2", listCtx(), "a digit inside an id is never an ordinal"],
    ["fx-hotel-2 खोलो", listCtx(), "a hyphenated id digit is never an ordinal"],
  ]) {
    const o = P.interpretOwnerPreview(q, ctx);
    ok(o.kind === "info" || o.kind === "unavailable", `fail-closed: ${label} ('${q}') → ${o.kind}`);
  }
  {
    const o = P.interpretOwnerPreview("पार्किंग नहीं", listCtx());
    ok(!(o.operation && o.operation.parking === true), "negated parking NEVER becomes parking=true");
  }
  eq(P.interpretOwnerPreview("open 2", listCtx()).operation.position, 2, "a standalone digit ordinal still works ('open 2')");

  section("devanagari — every emitted op is one of the six + passes validateOperation");
  ok(emitted.length >= 40, `Devanagari/mixed cases emitted ${emitted.length} operations`);
  ok(emitted.every((op) => SIX_OPS.includes(op.op)), "no seventh operation");
  ok(emitted.every((op) => C.validateOperation(op) !== null), "every emitted operation passes the EXISTING validateOperation");
  ok(emitted.every((op) => ["READ", "UI_LOCAL"].includes(C.OPERATION_AUTHORITY[op.op])), "every emitted operation is READ or UI_LOCAL");

  section("devanagari — REAL runtime drive (interpret → beginTurn → makeEnvelope → execute → reconcile)");
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    const d = drive(rt, "मसूरी में 5000 के अंदर पार्किंग वाला होटल दिखाओ");
    ok(d.outcome.kind === "operation" && d.outcome.operation.destination === "mussoorie", "native refinement interpreted");
    ok(!!d.env, "the runtime minted an envelope (validateOperation accepted it)");
    eq(d.result.status, "ok", "native refinement executes ok through the runtime");
    eq(page.s.city, "Mussoorie", "the BRIDGE executor applied the destination");
    eq(page.s.maxPrice, 5000, "the BRIDGE executor applied the budget");
    ok(page.s.appliedAmenities.includes("Parking"), "the BRIDGE executor applied the page's own parking option");
    ok(d.result.pendingReconcile === true && P.formatVerifiedReply(rt.reconcile()) === null, "no verified reply before the catalogue resolves");
    page.startLoading();
    page.resolveTo("mussoorie", "", "ready");
    const speech = P.formatVerifiedReply(rt.reconcile());
    ok(typeof speech === "string" && /stays now match/i.test(speech), "verified ONLY after reconcile confirms the receipt");
  }
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const d = drive(rt, "दूसरा वाला खोलो");
    eq(d.result.status, "ok", "native ordinal OPEN executes ok through the runtime");
    ok(page.s.openCalls === 1 && page.s.opened.position === 2, "OPEN routed through the BRIDGE at the 2nd visible position");
    eq(d.result.resolvedHotelId, page.s.opened.hotelId, "the hotel id comes from the visible row the runtime resolved, never from text");
    eq(P.formatExecutionReply(d.result, { openLabel: "Bravo Retreat" }), "Opening Bravo Retreat.", "OPEN reply from the runtime result");
  }
  {
    const mk = (amenities) => bootDetail({ routeId: "htl_x", hotel: { id: "htl_x", name: "X", city: "Y", amenities, rooms: [{ name: "Deluxe", floorPrice: 2000 }] }, loading: false, tab: "rooms" });
    const a = drive(mk(["Parking"]).rt, "पार्किंग है?");
    eq(a.result.status, "ok", "native parking FACTS executes ok");
    eq(P.formatExecutionReply(a.result, { factsFocus: a.outcome.factsFocus }), "Parking is available.", "native parking → runtime tri-state 'available'");
    const b = drive(mk(["WiFi"]).rt, "नाश्ता शामिल है?");
    eq(P.formatExecutionReply(b.result, { factsFocus: b.outcome.factsFocus }), "Breakfast is not listed.", "native breakfast → runtime tri-state 'not listed'");
    const c = drive(mk(["Breakfast on request"]).rt, "नाश्ता शामिल है?");
    eq(P.formatExecutionReply(c.result, { factsFocus: c.outcome.factsFocus }), "Breakfast information is unknown.", "native breakfast → runtime tri-state 'unknown' (never synthesized)");
    const { rt, page } = mk(["Parking"]);
    const sct = drive(rt, "विवरण दिखाओ");
    eq(sct.result.status, "ok", "native SHOW about executes ok");
    eq(page.s.tab, "about", "native section change routed through the BRIDGE");
  }
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "ready" });
    const before = JSON.stringify(page.s);
    const r = drive(rt, "मसूरी में बिना पार्किंग");
    ok(!r.result && JSON.stringify(page.s) === before && page.s.openCalls === 0, "negated parking: no envelope, no execute, page state untouched");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // DESTINATION-PARSER MATRIX (Roman-English / Roman-Hinglish + mixed + native) — every mutating case asserts the
  // EXACT operation payload. A destination is only the clean span adjacent to explicit destination grammar; request
  // words never leak into it; two destinations or a known city without grammar fail closed.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const canon = (o) => JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
  const dm = [];   // emitted matrix operations → validated at the end
  function exact(text, want, label, ctx) {
    const o = P.interpretOwnerPreview(text, ctx || listCtx());
    if (o.kind === "operation") dm.push(o.operation);
    const got = o.kind === "operation" ? canon(o.operation) : o.kind + ": " + o.message;
    eq(got, canon({ op: "APPLY_HOTEL_REFINEMENT", ...want }), `${label}: '${text}'`);
  }
  function refused(text, label, ctx) {
    const o = P.interpretOwnerPreview(text, ctx || listCtx());
    ok(o.kind === "info" || o.kind === "unavailable", `${label}: '${text}' → ${o.kind === "operation" ? "OPERATION " + JSON.stringify(o.operation) : o.kind}`);
  }

  section("destination matrix — A destination-first Roman-Hinglish");
  exact("mussoorie me hotel dikhao", { destination: "mussoorie" }, "A");
  exact("mussoorie me parking wala hotel dikhao", { destination: "mussoorie", parking: true }, "A");
  exact("mussoorie me parking hotel dikhao", { destination: "mussoorie", parking: true }, "A");
  exact("mussoorie me 5000 ke andar hotel dikhao", { destination: "mussoorie", maxPrice: 5000 }, "A");
  exact("mussoorie mein 5000 se kam parking hotel dikhao", { destination: "mussoorie", maxPrice: 5000, parking: true }, "A");
  exact("mussoorie mai hotel", { destination: "mussoorie" }, "A (mai)");
  exact("Mussoorie Mein Hotel Dikhao", { destination: "mussoorie" }, "A (case-insensitive)");

  section("destination matrix — B modifier-first Roman-Hinglish (the known reproduction family)");
  exact("parking wala hotel mussoorie me", { destination: "mussoorie", parking: true }, "B KNOWN REPRODUCTION");
  exact("parking hotel mussoorie me", { destination: "mussoorie", parking: true }, "B");
  exact("budget hotel mussoorie me", { destination: "mussoorie", sort: "price-asc" }, "B (budget = existing sort cue, not destination)");
  exact("5000 ke andar hotel mussoorie me", { destination: "mussoorie", maxPrice: 5000 }, "B (budget words do not leak)");
  exact("4 star hotel mussoorie me", { destination: "mussoorie", stars: [4] }, "B (stars + destination)");
  exact("cheap hotel mussoorie me", { destination: "mussoorie" }, "B ('cheap' is not a supported sort and does not leak)");
  exact("sasta hotel mussoorie me dikhao", { destination: "mussoorie", sort: "price-asc" }, "B");
  exact("top rated hotel mussoorie mein", { destination: "mussoorie", sort: "rating" }, "B");
  exact("parking wala hotel mussoorie me 5000 ke andar dikhao", { destination: "mussoorie", parking: true, maxPrice: 5000 }, "B (§8 all independent dimensions preserved)");
  exact("parking ke saath mussoorie me hotel dikhao", { destination: "mussoorie", parking: true }, "B (parking wording does not leak)");

  section("destination matrix — C hotel noun / action / filler never leaks");
  exact("hotel mussoorie me", { destination: "mussoorie" }, "C hotel noun");
  exact("hotel mussoorie mein dikhao", { destination: "mussoorie" }, "C");
  exact("show mussoorie me parking hotel", { destination: "mussoorie", parking: true }, "C action word");
  exact("dikhao mussoorie me hotels", { destination: "mussoorie" }, "C action word");
  exact("mujhe mussoorie me hotel chahiye", { destination: "mussoorie" }, "C filler");
  exact("kya mussoorie me hotel hai", { destination: "mussoorie" }, "C question word");
  exact("cozy shimla me hotel", { destination: "shimla" }, "C listed adjective does not leak into an unknown city");

  section("destination matrix — D English 'in/at/near <city>'");
  exact("hotel in mussoorie", { destination: "mussoorie" }, "D");
  exact("hotels in mussoorie", { destination: "mussoorie" }, "D");
  exact("show hotels in mussoorie", { destination: "mussoorie" }, "D");
  exact("show parking hotels in mussoorie", { destination: "mussoorie", parking: true }, "D parking + destination");
  exact("hotels under 5000 in mussoorie", { destination: "mussoorie", maxPrice: 5000 }, "D budget + destination");
  exact("parking hotel in mussoorie under 5000", { destination: "mussoorie", parking: true, maxPrice: 5000 }, "D");
  exact("show me hotels in mussoorie with parking", { destination: "mussoorie", parking: true }, "D ('show me' pronoun is not a postposition city)");
  exact("stays in mussoorie for 2 nights", { destination: "mussoorie" }, "D");
  exact("hotels at mussoorie with pool", { destination: "mussoorie" }, "D at");
  exact("hotel near mussoorie", { destination: "mussoorie" }, "D near");
  exact("hotels in mussoorie, with parking", { destination: "mussoorie", parking: true }, "D punctuation is a boundary");
  exact("rishikesh me hotel under 3000 with parking 4 star", { destination: "rishikesh", maxPrice: 3000, parking: true, stars: [4] }, "D all dimensions");

  section("destination matrix — E multi-word canonical city + non-registry places (canonical-registry invariant)");
  // offline-04: destination authority comes ONLY from lib/cities.ts. The offline-03 cases below that accepted
  // arbitrary Latin places ("new delhi", "bir billing", "mount abu", "sawai-madhopur") are now REFUSALS — a
  // strengthening required by the Owner's frozen invariant, not a weakening.
  for (const t of ["new delhi me hotel dikhao", "parking wala hotel new delhi me", "hotels in new delhi", "bir billing me hotel",
    "hotels in bir billing under 5000", "show hotels in mount abu", "sawai-madhopur me hotel"]) {
    refused(t, "E non-registry place never becomes a destination");
  }
  exact("south goa me hotel dikhao", { destination: "south goa" }, "E multi-word registry city (longest match)");
  exact("parking wala hotel south goa me", { destination: "south goa", parking: true }, "E multi-word registry city after modifiers");
  exact("hotels in south goa", { destination: "south goa" }, "E");
  exact("hotels in south goa under 5000", { destination: "south goa", maxPrice: 5000 }, "E");
  exact("show hotels in south goa", { destination: "south goa" }, "E");
  exact("scenic south goa me", { destination: "south goa" }, "E adjective + multi-word registry city");
  exact("show hotels in manali.", { destination: "manali" }, "E trailing punctuation");

  section("destination matrix — E2 mixed script");
  exact("parking वाला hotel mussoorie me", { destination: "mussoorie", parking: true }, "E2");
  exact("पार्किंग वाला hotel mussoorie me", { destination: "mussoorie", parking: true }, "E2");
  exact("mussoorie में hotel", { destination: "mussoorie" }, "E2 Latin city + native postposition");
  exact("मसूरी me 5000 ke andar parking dikhao", { destination: "mussoorie", maxPrice: 5000, parking: true }, "E2 native city + Latin grammar");

  section("destination matrix — F two-city ambiguity (fail closed)");
  for (const t of ["mussoorie aur rishikesh me hotel dikhao", "mussoorie/rishikesh me hotel", "mussoorie ya rishikesh me hotel",
    "hotels in mussoorie or rishikesh", "mussoorie me rishikesh me hotel", "in mussoorie in rishikesh", "delhi, mussoorie me hotel",
    "new delhi me mussoorie wala hotel", "मसूरी और देहरादून में होटल", "मसूरी और rishikesh me hotel", "hotels in mussoorie और rishikesh"]) {
    refused(t, "F two destinations");
  }

  section("destination matrix — G modifier-only / action-only / grammar-only (no destination invented)");
  exact("parking wala hotel", { parking: true }, "G modifier-only keeps its one real dimension, invents no destination");
  exact("budget hotel", { sort: "price-asc" }, "G modifier-only keeps its one real dimension, invents no destination");
  for (const t of ["hotel me", "hotels near me", "show hotels in the hills", "in", "me", "hotels in 5000", "some random place me hotel", "dikhao", "show hotels"]) {
    refused(t, "G no destination span");
  }
  for (const t of ["scenic green valley me hotel", "hotels in lovely green valley", "parking wala scenic green valley me"]) {
    refused(t, "G an unknown run longer than 2 words is never truncated into a guess");
  }
  for (const t of ["mussoorie", "mussoorie hotel", "parking wala mussoorie", "hotel parking mussoorie"]) {
    const o = P.interpretOwnerPreview(t, listCtx());
    ok(o.kind === "info" && /mussoorie me/.test(o.message), `G known city without destination grammar fails closed (never silently dropped): '${t}'`);
  }

  section("destination matrix — H negation + hotel ids stay locked");
  for (const t of ["rishikesh me parking nahi", "mussoorie me bina parking", "parking nahi chahiye mussoorie me", "hotels in mussoorie without parking", "बिना पार्किंग मसूरी में", "पार्किंग नहीं"]) {
    const o = P.interpretOwnerPreview(t, listCtx());
    ok(o.kind === "unavailable" && !(o.operation && o.operation.parking === true), `H negated parking fails closed: '${t}'`);
  }
  for (const t of ["open htl_2", "open fx_hotel_2", "fx-hotel-2 खोलो", "होटल htl_alpha खोलो"]) {
    ok(P.interpretOwnerPreview(t, listCtx()).kind === "info", `H hotel id never reaches OPEN_VISIBLE_HOTEL: '${t}'`);
  }

  section("destination matrix — I native Devanagari regression lock");
  exact("मसूरी में 5000 के अंदर पार्किंग वाला होटल दिखाओ", { destination: "mussoorie", maxPrice: 5000, parking: true }, "I");
  eq(canon(P.interpretOwnerPreview("पहले दो होटल compare करो", listCtx()).operation), canon({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], factors: ["price", "rating", "parking"] }), "I compare");
  eq(canon(P.interpretOwnerPreview("दूसरा वाला खोलो", listCtx()).operation), canon({ op: "OPEN_VISIBLE_HOTEL", position: 2 }), "I open");
  { const o = P.interpretOwnerPreview("पार्किंग है?", detailCtx()); ok(canon(o.operation) === canon({ op: "READ_CURRENT_HOTEL_FACTS" }) && o.factsFocus === "parking", "I parking facts"); }
  { const o = P.interpretOwnerPreview("नाश्ता शामिल है?", detailCtx()); ok(canon(o.operation) === canon({ op: "READ_CURRENT_HOTEL_FACTS" }) && o.factsFocus === "breakfast", "I breakfast facts"); }

  section("destination matrix — every emitted op is valid + no leaked request word");
  const LEAK = /\b(parking|wala|wale|hotel|hotels|budget|cheap|under|show|dikhao|price|star|rating|me|mein|ke|andar|saath|mujhe|kya|the)\b/;
  ok(dm.length >= 50, `matrix emitted ${dm.length} operations`);
  ok(dm.every((op) => C.validateOperation(op) !== null), "every matrix operation passes the EXISTING validateOperation");
  ok(dm.every((op) => op.op === "APPLY_HOTEL_REFINEMENT"), "matrix refinements stay on the existing refinement operation");
  const leaked = dm.filter((op) => op.destination && LEAK.test(op.destination));
  ok(leaked.length === 0, "no destination contains a request modifier / hotel noun / action word (" + (leaked.map((o) => o.destination).join(", ") || "none") + ")");
  {
    // runtime drive of the known reproduction: the bridge applies ONLY the clean destination + parking.
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    const d = drive(rt, "parking wala hotel mussoorie me");
    eq(d.result && d.result.status, "ok", "known reproduction executes through the real runtime");
    eq(page.s.city, "Mussoorie", "the BRIDGE applied destination = mussoorie (not a composite phrase)");
    ok(page.s.appliedAmenities.includes("Parking"), "the BRIDGE applied parking");
    ok(d.result.pendingReconcile === true && P.formatVerifiedReply(rt.reconcile()) === null, "no verified reply before the catalogue resolves");
    page.startLoading();
    ok(P.formatVerifiedReply(rt.reconcile()) === null, "still not verified while loading");
    page.resolveTo("mussoorie", "", "ready");
    ok(/stays now match/i.test(P.formatVerifiedReply(rt.reconcile()) || ""), "verified only after reconcile confirms the mussoorie receipt");
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // CANONICAL CITY REGISTRY — destination authority comes ONLY from lib/cities.ts (ALL_CITIES). Every city list below
  // is DERIVED from the compiled registry at run time; nothing is duplicated in the test.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const CITIES = require(path.join(OUT, "cities.js"));
  const REG = Array.from(new Set(CITIES.ALL_CITIES.map((c) => c.key.toLowerCase())));
  const inRegistry = (d) => !!CITIES.cityMeta(d) && CITIES.cityMeta(d).key.toLowerCase() === d;
  const opOf = (t, ctx) => { const o = P.interpretOwnerPreview(t, ctx || listCtx()); return o.kind === "operation" ? o.operation : null; };
  const regStats = { cities: REG.length, exactCases: 0, multiWord: 0, collisions: 0 };
  const exactQuiet = (t, want) => { regStats.exactCases += 1; const op = opOf(t); return !!op && canon(op) === canon({ op: "APPLY_HOTEL_REFINEMENT", ...want }); };

  section(`registry — ${REG.length} canonical cities (derived from lib/cities.ts ALL_CITIES)`);
  eq(REG.length, CITIES.ALL_CITIES.length, "registry keys are distinct (case-insensitive)");
  ok(REG.length >= 40, `registry is the full canonical set (${REG.length} cities)`);
  ok(REG.every((c) => C.canonicalCity(c) === c), "every registry key is already in the Live-AI contract's canonical (lowercase) form");
  for (const c of REG) {
    ok(exactQuiet(`${c} me hotel dikhao`, { destination: c }), `registry '${c} me hotel dikhao' → ${c}`);
    ok(exactQuiet(`show hotels in ${c}`, { destination: c }), `registry 'show hotels in ${c}' → ${c}`);
    ok(exactQuiet(`parking wala hotel ${c} me`, { destination: c, parking: true }), `registry 'parking wala hotel ${c} me' → ${c} + parking`);
    ok(exactQuiet(`5000 ke andar hotel ${c} me`, { destination: c, maxPrice: 5000 }), `registry '5000 ke andar hotel ${c} me' → ${c} + maxPrice`);
    ok(exactQuiet(`show parking hotels in ${c}`, { destination: c, parking: true }), `registry 'show parking hotels in ${c}' → ${c} + parking`);
  }

  section("registry — multi-word cities + longest-match collisions (auto-derived)");
  const MULTI = REG.filter((c) => c.includes(" "));
  const COLL = [];
  for (const long of MULTI) for (const short of REG) if (short !== long && (" " + long + " ").includes(" " + short + " ")) COLL.push([long, short]);
  regStats.multiWord = MULTI.length; regStats.collisions = COLL.length;
  ok(MULTI.length >= 1 && COLL.length >= 1, `registry has ${MULTI.length} multi-word city(ies) and ${COLL.length} token collision(s): ${COLL.map((p) => p.join(" ⊃ ")).join(", ")}`);
  ok(COLL.some(([l, s]) => l === "south goa" && s === "goa"), "the South Goa ⊃ Goa collision is covered");
  for (const long of MULTI) {
    for (const t of [`${long} me hotel`, `hotels in ${long}`, `premium hotel ${long} me`, `hotel in ${long}`, `${long} mein 5000 tak`]) {
      const op = opOf(t);
      eq(op && op.destination, long, `longest match: '${t}' → ${long} (never a shorter registry city)`);
    }
  }
  for (const [long, short] of COLL) {
    eq(opOf(`${short} me hotel`).destination, short, `the shorter city alone still resolves: '${short} me hotel' → ${short}`);
    refused(`${long} aur ${short} me hotel`, "collision pair joined → two canonical cities → fail closed");
  }

  section("registry — adjective / modifier negative matrix (city only, never the phrase)");
  const ADJ = ["scenic", "luxury", "premium", "peaceful", "family", "romantic", "best", "cheap", "beautiful", "mountain", "cozy", "quiet", "budget hotel", "parking wala hotel", "5000 ke andar hotel", "4 star hotel", "mujhe", "show"];
  let adjCases = 0;
  for (const c of REG) {
    for (const a of ADJ) {
      adjCases += 1;
      const o = P.interpretOwnerPreview(`${a} ${c} me`, listCtx());
      const d = o.kind === "operation" ? o.operation.destination : null;
      if (!(o.kind !== "operation" || d === c)) ok(false, `adjective '${a} ${c} me' leaked a non-city destination: ${JSON.stringify(d)}`);
      if (d !== undefined && d !== null && d !== c) ok(false, `adjective '${a} ${c} me' → ${d}`);
    }
  }
  ok(true, `adjective matrix: ${adjCases} cases, every emitted destination is exactly the city`);
  for (const a of ["scenic", "luxury", "premium", "peaceful", "family", "romantic", "best", "cheap", "beautiful", "mountain"]) {
    eq(opOf(`${a} shimla me`).destination, "shimla", `'${a} shimla me' → shimla`);
  }
  eq(canon(opOf("parking wala hotel shimla me")), canon({ op: "APPLY_HOTEL_REFINEMENT", destination: "shimla", parking: true }), "'parking wala hotel shimla me' exact payload");
  eq(canon(opOf("budget hotel shimla me")), canon({ op: "APPLY_HOTEL_REFINEMENT", destination: "shimla", sort: "price-asc" }), "'budget hotel shimla me' exact payload");

  section("registry — unknown destinations with explicit grammar (NO operation, NO partial refinement)");
  const UNKNOWN = ["unknowncity", "unknownville", "imaginarytown", "foo bar", "some random place", "new random place", "new delhi", "bir billing", "haridwar", "nubra"];
  for (const u of UNKNOWN) {
    for (const t of [`${u} me`, `${u} me hotel dikhao`, `hotel in ${u}`, `hotel near ${u}`, `parking hotel in ${u}`, `under 5000 in ${u}`, `parking wala hotel ${u} me`, `4 star hotel ${u} me`, `family stay ${u} me`]) {
      ok(opOf(t) === null, `unknown destination refused, no partial apply: '${t}'`);
    }
  }

  section("registry — canonical city WITHOUT destination grammar (fail closed, never silently dropped)");
  for (const t of ["parking wala shimla", "budget hotel mussoorie", "cheap hotel manali", "rishikesh hotel", "south goa hotel"]) {
    ok(opOf(t) === null, `known city without grammar refused: '${t}'`);
  }
  for (const c of REG) {
    ok(opOf(`parking wala hotel ${c}`) === null && opOf(`${c} hotel 5000 tak`) === null, `'${c}' mentioned without grammar never lets other filters apply alone`);
  }

  section("registry — multi-city matrix (generated from the registry)");
  const PAIRS = [];
  for (let i = 0; i < REG.length; i += 1) PAIRS.push([REG[i], REG[(i + 7) % REG.length]]);
  for (const [l, s] of COLL) PAIRS.push([l, s], [s, l]);
  const MULTI_FORMS = [
    (a, b) => `${a} aur ${b} me hotel dikhao`, (a, b) => `${a} ya ${b} me hotel`, (a, b) => `hotels in ${a} or ${b}`,
    (a, b) => `${a}, ${b} me hotel`, (a, b) => `${a}/${b} me hotel`, (a, b) => `${a} me ${b} me hotel`,
    (a, b) => `in ${a} in ${b}`, (a, b) => `${a} me hotel near ${b}`, (a, b) => `parking wala hotel ${a} me, ${b} ke paas`,
    (a, b) => `${b} wala hotel ${a} me`, (a, b) => `hotels in ${a} and ${b}`,
  ];
  let multiCases = 0;
  for (const [a, b] of PAIRS) {
    if (a === b) continue;
    for (const f of MULTI_FORMS) { multiCases += 1; const t = f(a, b); if (opOf(t) !== null) ok(false, `multi-city emitted an operation: '${t}' → ${JSON.stringify(opOf(t))}`); }
  }
  ok(multiCases >= 400, `multi-city matrix: ${multiCases} generated cases, none emitted an operation`);
  for (const t of ["मसूरी और देहरादून में होटल", "मसूरी और shimla me hotel", "shimla aur मसूरी में", "hotels in goa और मसूरी में", "delhi, mussoorie me hotel", "hotels in mussoorie and delhi"]) {
    refused(t, "multi-city (native/mixed/non-registry second place)");
  }

  section("registry — Devanagari alias targets are canonical registry cities");
  for (const [alias, city] of Object.entries(P.DEVANAGARI_CITY_ALIASES)) {
    ok(inRegistry(city), `native alias '${alias}' → '${city}' is a canonical lib/cities.ts city`);
    eq(opOf(`${alias} में होटल दिखाओ`).destination, city, `native alias '${alias} में' still resolves to ${city}`);
  }

  section("registry — FILTER-ONLY requests stay valid (no destination attempt)");
  exact("₹5000 se kam parking", { maxPrice: 5000, parking: true }, "filter-only");
  exact("parking wala hotel", { parking: true }, "filter-only");
  exact("under 5000", { maxPrice: 5000 }, "filter-only");
  exact("4 star hotel", { stars: [4] }, "filter-only");
  exact("parking dikhao", { parking: true }, "filter-only");
  exact("show me parking hotels under 5000", { parking: true, maxPrice: 5000 }, "filter-only ('show me' pronoun is not a destination attempt)");

  section("registry — PROPERTY sweep: destination authority invariant");
  {
    const PREFIX = ["", "scenic", "parking wala hotel", "budget hotel", "5000 ke andar hotel", "4 star hotel", "show", "mujhe", "cheap", "top rated hotel", "show me"];
    const PLACES = REG.concat(UNKNOWN);
    const GRAMMAR = ["{p} me", "{p} mein", "{p} mai", "in {p}", "near {p}", "at {p}", "{p} में", "{p}"];
    const SUFFIX = ["", "hotel dikhao", "with parking", "under 5000", "4 star", "ke paas"];
    let total = 0, emittedWithDest = 0, nonCanonical = 0, unresolvedPartial = 0, silentDrop = 0;
    const bad = [];
    for (const pre of PREFIX) for (const place of PLACES) for (const g of GRAMMAR) for (const suf of SUFFIX) {
      const t = [pre, g.replace("{p}", place), suf].filter(Boolean).join(" ");
      total += 1;
      const o = P.interpretOwnerPreview(t, listCtx());
      const op = o.kind === "operation" ? o.operation : null;
      const known = REG.includes(place);
      const hasGrammar = g !== "{p}";
      if (op && op.destination != null) {
        emittedWithDest += 1;
        if (!inRegistry(op.destination)) { nonCanonical += 1; if (bad.length < 5) bad.push(t + " → " + op.destination); }
      }
      // An explicit destination grammar over an UNKNOWN place must never apply the remaining filters alone.
      if (!known && hasGrammar && op && op.op === "APPLY_HOTEL_REFINEMENT") { unresolvedPartial += 1; if (bad.length < 5) bad.push("partial: " + t); }
      // A KNOWN city without grammar must never be silently dropped while other filters apply.
      if (known && !hasGrammar && op && op.op === "APPLY_HOTEL_REFINEMENT" && op.destination == null) { silentDrop += 1; if (bad.length < 5) bad.push("drop: " + t); }
    }
    console.log(`  property sweep: ${total} generated inputs · ${emittedWithDest} emitted a destination`);
    ok(total >= 15000, `property sweep size ${total}`);
    ok(emittedWithDest > 1000, `property sweep exercised ${emittedWithDest} destination-bearing operations`);
    eq(nonCanonical, 0, "PROPERTY: every emitted destination satisfies cityMeta(destination) exact canonical membership " + bad.join(" | "));
    eq(unresolvedPartial, 0, "PROPERTY: explicit unresolved destination grammar never emits APPLY_HOTEL_REFINEMENT with only the remaining filters");
    eq(silentDrop, 0, "PROPERTY: a canonical city mentioned without grammar is never silently dropped");
    regStats.propertyInputs = total; regStats.propertyWithDest = emittedWithDest;
  }
  {
    // Every destination emitted anywhere in this suite's earlier matrices is canonical too.
    ok([...dm, ...emitted].every((op) => op.destination == null || inRegistry(op.destination)), "every destination emitted by the earlier matrices is a canonical registry city");
  }
  console.log("  registry stats: " + JSON.stringify(regStats));

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // NATIVE / MIXED DESTINATION INVARIANT — an EXPLICIT destination attempt in ANY script must resolve to exactly one
  // canonical city (registry or approved native alias); otherwise the WHOLE refinement turn fails closed.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  const nm = { unsupportedNative: 0, mixed: 0, knownUnknown: 0, unknownUnknown: 0 };
  const noApply = (t) => { const o = P.interpretOwnerPreview(t, listCtx()); return !(o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT"); };
  const UNSUPPORTED_NATIVE = ["दिल्ली", "मुंबई", "वाराणसी", "हरिद्वार", "जयपुर", "चंडीगढ़", "अहमदाबाद", "पहाड़ों"];   // "जयपुर": registry city, but NOT an approved native alias
  const UNSUPPORTED_MIXED = ["नई-delhi", "new-दिल्ली", "दिल्लीpur", "mumbaiनगर"];
  const NATIVE_OK = Object.entries(P.DEVANAGARI_CITY_ALIASES);   // [alias, canonical]

  section("native/mixed — the must-fix discovered cases (§18) never partially execute");
  for (const t of ["दिल्ली में parking hotel dikhao", "दिल्ली में 5000 ke andar hotel dikhao", "मुंबई में parking hotel dikhao", "hotel in वाराणसी with parking",
    "दिल्ली और मसूरी में parking", "मसूरी और दिल्ली में parking", "दिल्ली / मसूरी में parking", "मसूरी में और दिल्ली में parking", "hotels in mussoorie और दिल्ली में"]) {
    const o = P.interpretOwnerPreview(t, listCtx());
    ok(o.kind === "info" || o.kind === "unavailable", `must-fix refused (no partial filter): '${t}' → ${o.kind === "operation" ? JSON.stringify(o.operation) : o.kind}`);
  }

  section("native/mixed — unsupported native destination matrix");
  const NATIVE_VARIANTS = [(p) => `${p} में hotel dikhao`, (p) => `${p} me hotel dikhao`, (p) => `${p} में parking hotel dikhao`, (p) => `${p} में 5000 ke andar hotel dikhao`,
    (p) => `hotel in ${p}`, (p) => `hotel in ${p} with parking`, (p) => `hotel near ${p}`, (p) => `${p} में 4 star hotel`, (p) => `पार्किंग वाला होटल ${p} में`,
    (p) => `5000 के अंदर होटल ${p} में`, (p) => `${p} मे होटल दिखाओ`, (p) => `${p} में सबसे सस्ता होटल`];
  for (const place of UNSUPPORTED_NATIVE) for (const v of NATIVE_VARIANTS) { nm.unsupportedNative += 1; const t = v(place); ok(noApply(t), `unsupported native destination fails closed: '${t}'`); }

  section("native/mixed — mixed-script unknown matrix");
  const MIXED_VARIANTS = [(p) => `${p} me parking hotel dikhao`, (p) => `${p} mein 5000 ke andar hotel dikhao`, (p) => `hotel in ${p} with parking`, (p) => `show hotel near ${p}`,
    (p) => `4 star hotel ${p} me`, (p) => `parking wala hotel ${p} mai`, (p) => `hotels at ${p} under 5000`, (p) => `${p} में parking`];
  for (const place of UNSUPPORTED_NATIVE.concat(UNSUPPORTED_MIXED)) for (const v of MIXED_VARIANTS) { nm.mixed += 1; const t = v(place); ok(noApply(t), `mixed-script unknown destination fails closed: '${t}'`); }

  section("native/mixed — known + unknown multi-destination (both orders, all separators)");
  const KNOWN = REG.map((c) => c).concat(NATIVE_OK.map(([alias]) => alias));   // every canonical Latin city + every approved native alias
  const SEPS = ["और", "या", "aur", "ya", "and", "or", ",", "/"];
  const PAIR_FORMS = [
    (a, sep, b) => `${a} ${sep} ${b} में parking`, (a, sep, b) => `${a} ${sep} ${b} me hotel`, (a, sep, b) => `hotels in ${a} ${sep} ${b}`,
    (a, sep, b) => `${a} ${sep} ${b} mein 5000 ke andar hotel`,
  ];
  const REPEAT_FORMS = [(a, b) => `${a} में और ${b} में parking`, (a, b) => `${a} me hotel ${b} me`, (a, b) => `hotels in ${a} in ${b}`, (a, b) => `${a} में hotel near ${b}`];
  let kuBad = 0; const kuFails = [];
  for (const k of KNOWN) for (const u of UNSUPPORTED_NATIVE.slice(0, 4).concat(UNSUPPORTED_MIXED.slice(0, 1))) {
    for (const sep of SEPS) for (const f of PAIR_FORMS) for (const [a, b] of [[k, u], [u, k]]) {
      nm.knownUnknown += 1; const t = f(a, sep, b); if (!noApply(t)) { kuBad += 1; if (kuFails.length < 5) kuFails.push(t); }
    }
    for (const f of REPEAT_FORMS) for (const [a, b] of [[k, u], [u, k]]) { nm.knownUnknown += 1; const t = f(a, b); if (!noApply(t)) { kuBad += 1; if (kuFails.length < 5) kuFails.push(t); } }
  }
  eq(kuBad, 0, `known + unknown: ${nm.knownUnknown} generated cases, never picks the known city ${kuFails.join(" | ")}`);
  for (const t of ["दिल्ली / mussoorie me hotel", "mussoorie / दिल्ली me hotel", "दिल्ली में और mussoorie me hotel", "hotels in दिल्ली and mussoorie"]) {
    ok(noApply(t), `known + unknown named case refused: '${t}'`);
  }

  section("native/mixed — unknown + unknown multi-destination");
  let uuBad = 0;
  for (const a of UNSUPPORTED_NATIVE) for (const b of UNSUPPORTED_NATIVE) {
    if (a === b) continue;
    for (const sep of SEPS) for (const f of PAIR_FORMS) { nm.unknownUnknown += 1; if (!noApply(f(a, sep, b))) uuBad += 1; }
    for (const f of REPEAT_FORMS) { nm.unknownUnknown += 1; if (!noApply(f(a, b))) uuBad += 1; }
  }
  eq(uuBad, 0, `unknown + unknown: ${nm.unknownUnknown} generated cases, all fail closed`);
  for (const t of ["दिल्ली और मुंबई में hotel", "दिल्ली / मुंबई में parking", "hotel in दिल्ली or मुंबई"]) ok(noApply(t), `unknown + unknown named case refused: '${t}'`);

  section("native/mixed — approved native aliases still resolve; filter-only + no-grammar locks hold");
  for (const [alias, city] of NATIVE_OK) {
    eq(canon(opOf(`${alias} में parking hotel dikhao`)), canon({ op: "APPLY_HOTEL_REFINEMENT", destination: city, parking: true }), `approved alias '${alias} में' + parking → ${city}`);
    eq(canon(opOf(`hotel in ${alias} under 5000`)), canon({ op: "APPLY_HOTEL_REFINEMENT", destination: city, maxPrice: 5000 }), `approved alias after 'in' → ${city}`);
    eq(canon(opOf(`${alias} me 4 star hotel`)), canon({ op: "APPLY_HOTEL_REFINEMENT", destination: city, stars: [4] }), `approved alias + Latin 'me' → ${city}`);
  }
  exact("मसूरी में 5000 के अंदर पार्किंग वाला होटल दिखाओ", { destination: "mussoorie", maxPrice: 5000, parking: true }, "native mandatory #1 lock");
  for (const [t, want] of [["parking wala hotel", { parking: true }], ["₹5000 se kam parking", { maxPrice: 5000, parking: true }], ["4 star hotel", { stars: [4] }],
    ["parking dikhao", { parking: true }], ["पार्किंग वाला होटल", { parking: true }], ["parking wala hotel unknownville", { parking: true }], ["5000 से कम पार्किंग", { maxPrice: 5000, parking: true }]]) {
    exact(t, want, "filter-only (no destination grammar) stays valid");
  }
  for (const t of ["parking wala shimla", "budget hotel mussoorie", "south goa hotel", "पार्किंग वाला मसूरी"]) ok(noApply(t), `known city without grammar still fails closed: '${t}'`);
  ok(noApply("होटल में पार्किंग है"), "a native noun in the destination slot ('होटल में') is an unresolved attempt — consistent with Latin 'hotel me'");

  section("native/mixed — PROPERTY: explicit destination attempt ⇒ exactly one canonical destination OR zero APPLY");
  {
    const PREFIX = ["", "parking wala hotel", "5000 ke andar hotel", "4 star hotel", "पार्किंग वाला होटल", "5000 के अंदर होटल", "show"];
    const SUFFIX = ["", "parking", "hotel dikhao", "under 5000", "4 star", "होटल दिखाओ", "5000 तक"];
    const GRAM1 = ["{p} में", "{p} मे", "{p} me", "{p} mein", "{p} mai", "in {p}", "near {p}", "at {p}"];
    const PLACES = [
      ...REG.map((c) => ({ text: c, canon: c })),
      ...NATIVE_OK.map(([alias, city]) => ({ text: alias, canon: city })),
      ...UNSUPPORTED_NATIVE.map((p) => ({ text: p, canon: null })),
      ...UNSUPPORTED_MIXED.map((p) => ({ text: p, canon: null })),
      ...["unknownville", "foo bar"].map((p) => ({ text: p, canon: null })),
    ];
    let total = 0, attempts = 0, applyResolved = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0; const bad = [];
    const check = (t, expectedCanon) => {
      total += 1; attempts += 1;
      const o = P.interpretOwnerPreview(t, listCtx());
      const op = o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT" ? o.operation : null;
      if (op && op.destination != null && !inRegistry(op.destination)) { v1 += 1; if (bad.length < 6) bad.push("noncanon: " + t); }
      if (op && expectedCanon === null) { v2 += 1; if (bad.length < 6) bad.push("partial: " + t + " → " + JSON.stringify(op)); }
      if (op && expectedCanon !== null && op.destination !== expectedCanon) { v3 += 1; if (bad.length < 6) bad.push("wrongdest: " + t + " → " + JSON.stringify(op)); }
      if (op && expectedCanon !== null) applyResolved += 1;
    };
    // single-place explicit attempts
    for (const pre of PREFIX) for (const pl of PLACES) for (const g of GRAM1) for (const suf of SUFFIX) {
      check([pre, g.replace("{p}", pl.text), suf].filter(Boolean).join(" "), pl.canon);
    }
    // two-place explicit attempts (any mix of known / native / unknown), every separator + repeated markers → never APPLY
    const PAIR_POOL = [...REG.filter((_, i) => i % 6 === 0), ...NATIVE_OK.map(([a]) => a), ...UNSUPPORTED_NATIVE.slice(0, 4), UNSUPPORTED_MIXED[0], "unknownville"];
    for (const a of PAIR_POOL) for (const b of PAIR_POOL) {
      if (a === b) continue;
      for (const sep of SEPS) for (const f of PAIR_FORMS) { check(f(a, sep, b), null); }
      for (const f of REPEAT_FORMS) check(f(a, b), null);
    }
    // unresolved attempt + each filter family alone must never become a partial mutation
    for (const pl of PLACES.filter((x) => x.canon === null)) for (const g of GRAM1) for (const filt of ["parking", "5000 ke andar", "4 star", "पार्किंग", "5000 तक", "sabse sasta"]) {
      const t = `${filt} ${g.replace("{p}", pl.text)}`; total += 1;
      const o = P.interpretOwnerPreview(t, listCtx()); if (o.kind === "operation" && o.operation.op === "APPLY_HOTEL_REFINEMENT") { v4 += 1; if (bad.length < 6) bad.push("filter-partial: " + t); }
    }
    console.log(`  native/mixed property: ${total} generated inputs · ${attempts} explicit destination attempts · ${applyResolved} resolved to a canonical city`);
    ok(total >= 20000, `native/mixed property size ${total}`);
    ok(applyResolved > 3000, `resolvable attempts actually resolved (${applyResolved})`);
    eq(v1, 0, "PROPERTY: every emitted destination is a canonical lib/cities.ts city " + bad.join(" | "));
    eq(v2, 0, "PROPERTY: an unresolved / multi-place explicit destination attempt NEVER emits APPLY_HOTEL_REFINEMENT (zero partial filters)");
    eq(v3, 0, "PROPERTY: a single resolvable attempt only ever resolves to ITS canonical city");
    eq(v4, 0, "PROPERTY: unresolved attempt + parking / budget / stars / sort never becomes a partial filter mutation");
    nm.propertyInputs = total; nm.propertyResolved = applyResolved;
  }
  console.log("  native/mixed stats: " + JSON.stringify(nm));

  // ── CONFIRMED_WRITE remains unavailable; preview authority stays READ / UI_LOCAL ──
  section("authority — no write");
  eq(C.CONFIRMED_WRITE_ENABLED, false, "CONFIRMED_WRITE disabled");
  eq(C.DRAFT_LOCAL_ENABLED, false, "DRAFT_LOCAL disabled");
  ok(Object.values(C.OPERATION_AUTHORITY).every((a) => a === "READ" || a === "UI_LOCAL"), "every preview operation is READ or UI_LOCAL (never a write)");

  // ── isolation — the interpreter constructs NO network / provider / mic path ──
  section("isolation — no network/provider/mic imports");
  {
    const src = fs.readFileSync(path.join(REPO, "lib/live-ai/owner-preview.ts"), "utf8");
    const forbidden = ["gateway-client", "conversation", "transport", "broker", "audio-playback", "fetch(", "WebSocket", "getUserMedia", "navigator"];
    const hit = forbidden.find((f) => src.includes(f));
    ok(!hit, "owner-preview.ts imports/uses no gateway/conversation/transport/broker/audio/network/mic (" + (hit || "clean") + ")");
  }

  console.log(`\n${fail === 0 ? "✓" : "✗"} owner-preview: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.error("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("OWNER-PREVIEW DETERMINISTIC FIRST-SLICE: PASS");
  process.exit(0);
})();
