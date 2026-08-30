#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-01A — R2 remediation test suite.
//
//   Run:  node tests/live-ai/live-ai.test.js
//
// Compiles the PURE lib/live-ai/*.ts with the LOCKFILE-INSTALLED local tsc (no
// npx) and drives the REAL production modules — the runtime, transport, AND the
// pure snapshot builders buildHotelsSnapshot / buildHotelDetailSnapshot that the
// bridges themselves call (REV-12). Each mock "page" registration's getSnapshot
// is the PRODUCTION builder; only the thin setter-applier is a fixture (it
// mirrors the bridge). Covers LIVE-AI-01A-REV-01..15 + the acceptance contract.
// Orb / feature-off render proofs use the installed react-dom/server. Source
// scans are supplementary only. NO network, NO provider, NO DB.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "live-ai"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
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
if (!fs.existsSync(path.join(OUT, "live-ai/runtime.js"))) { console.error("COMPILE GATE FAILED — no JS emitted"); process.exit(2); }
console.log("• Local tsc compile: exit 0, clean (strict)");

const C = require(path.join(OUT, "live-ai/contracts.js"));
const R = require(path.join(OUT, "live-ai/runtime.js"));
const T = require(path.join(OUT, "live-ai/transport.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
const titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());

// ── mock /hotels page — getSnapshot IS the production builder (REV-12) ───────
function makeHotelsPage(init) {
  init = init || {};
  const s = {
    base: (init.displayHotels || []).slice(),
    displayHotels: (init.displayHotels || []).slice(),
    city: init.city || "", query: init.query || "",
    checkIn: init.checkIn || "", checkOut: init.checkOut || "",
    guests: init.guests == null ? 2 : init.guests,
    maxPrice: init.maxPrice == null ? null : init.maxPrice,
    sort: init.sort || "default", stars: init.stars ? init.stars.slice() : [],
    appliedAmenities: init.appliedAmenities ? init.appliedAmenities.slice() : [],
    amenityOpts: init.amenityOpts || ["WiFi", "Parking", "Breakfast", "Pool", "AC"],
    loading: !!init.loading, error: init.error || "",
    resolvedCity: init.resolvedCity !== undefined ? init.resolvedCity : (init.city || ""),
    resolvedQuery: init.resolvedQuery !== undefined ? init.resolvedQuery : (init.query || ""),
    resolvedStatus: init.resolvedStatus || "ready",
    opened: null, openCalls: 0,
  };
  // simulate the host page's existing client-side filter (NOT Live-AI logic)
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
      displayHotels: s.displayHotels, city: s.city, query: s.query,
      checkIn: s.checkIn, checkOut: s.checkOut, guests: s.guests, maxPrice: s.maxPrice,
      sort: s.sort, stars: s.stars, appliedAmenities: s.appliedAmenities, amenityOpts: s.amenityOpts,
      loading: s.loading, error: s.error, resolvedCity: s.resolvedCity, resolvedQuery: s.resolvedQuery,
      resolvedStatus: s.resolvedStatus, role: "anonymous",
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
        s.opened = { hotelId: cmd.hotelId, url: `/hotels/${cmd.hotelId}`, position: cmd.position };
        s.openCalls += 1;
      }
    },
  };
  return {
    s, reg,
    startLoading: () => { s.loading = true; },
    resolveTo: (city, query, status) => { s.resolvedCity = city; s.resolvedQuery = query == null ? "" : query; s.resolvedStatus = status || "ready"; s.loading = false; },
    setBase: (list) => { s.base = list.slice(); recompute(); },
  };
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

function bootHotels(init) {
  const rt = R.createLiveAiRuntime("anonymous");
  rt.activate();
  const page = makeHotelsPage(init);
  rt.invalidateRoute("/hotels");
  rt.registerPage(page.reg);
  return { rt, page };
}
function run(rt, op) { const env = rt.makeEnvelope(op); if (!env) return { ok: false, status: "no_envelope" }; return rt.execute(env); }

(function main() {
  // ── REV-01 — exact fail-closed operation body ─────────────────────────────
  section("REV-01 — exact-key fail-closed operation body");
  {
    ok(C.validateOperation({ op: "READ_CURRENT_RESULTS", extra: 1 }) === null, "REV-01: one extra key rejects (READ)");
    ok(C.validateOperation({ op: "READ_CURRENT_RESULTS", a: 1, b: 2 }) === null, "REV-01: multiple extra keys reject");
    ok(C.validateOperation({ op: "OPEN_VISIBLE_HOTEL", position: 2, hotelId: "x" }) === null, "REV-01: OPEN + smuggled hotelId rejects (not stripped)");
    ok(C.validateOperation({ op: "OPEN_VISIBLE_HOTEL", position: 2, path: "/x" }) === null, "REV-01: OPEN + smuggled path rejects");
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: "Manali", url: "javascript:1", selector: "#x", html: "<i>", js: "1", method: "DELETE" }) === null,
      "REV-01: refinement + url/selector/html/js/method rejects the whole op");
    ok(C.validateOperation({ op: "SHOW_HOTEL_SECTION", section: "rooms", href: "/y" }) === null, "REV-01: SHOW_HOTEL_SECTION + extra key rejects");
    ok(C.validateOperation({ op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2], cmd: "rm" }) === null, "REV-01: COMPARE + extra key rejects");
    ok(C.validateOperation(null) === null && C.validateOperation("x") === null && C.validateOperation([{ op: "READ_CURRENT_RESULTS" }]) === null,
      "REV-01: non-object / string / array fail closed");
    const proto = Object.create({ op: "READ_CURRENT_RESULTS" }); // op only on prototype
    ok(C.validateOperation(proto) === null, "REV-01: inherited-only 'op' (no own key) fails closed");
    // a VALID op with EXACTLY its allowed keys still passes
    ok(C.validateOperation({ op: "APPLY_HOTEL_REFINEMENT", destination: "Manali", maxPrice: 5000, parking: true }) !== null, "REV-01: exact allowed keys pass");

    // ── R3 Fix 1A adversarial (STRICT — corrects the earlier permissive R2
    //    assertions the independent review flagged as wrong). A NON-plain
    //    prototype (custom prototype / class instance / inherited-authority chain)
    //    REJECTS the whole operation OUTRIGHT, even when every own key is an
    //    allowed data property. Inherited authority must never be reachable.
    // (A) inherited url on a custom prototype, own `op` present → REJECT
    //     (was permissively "|| !('url' in ...)" — now strict === null).
    const inhUrl = Object.create({ url: "javascript:1" }); inhUrl.op = "READ_CURRENT_RESULTS";
    ok(C.validateOperation(inhUrl) === null, "R3 Fix 1A(A): custom-prototype op (inherited url) rejected outright");
    // (B) inherited hotelId on a custom prototype, own op+position only → REJECT
    //     (was WRONGLY asserted accepted as long as the inherited field vanished).
    const inhHotel = Object.create({ hotelId: "htl_evil" }); inhHotel.op = "OPEN_VISIBLE_HOTEL"; inhHotel.position = 2;
    ok(C.validateOperation(inhHotel) === null, "R3 Fix 1A(B): custom-prototype op (inherited hotelId) rejected — never accepted");
    // (C) valid-LOOKING op whose OWN keys are EXACTLY the allowed set, inherited
    //     authority hidden on the custom prototype → REJECT on the prototype rule.
    const EvilOp = function () {};
    EvilOp.prototype.tainted = "authority";
    const coProto = new EvilOp(); coProto.op = "OPEN_VISIBLE_HOTEL"; coProto.position = 2;
    ok(C.validateOperation(coProto) === null, "R3 Fix 1A(C): valid-looking op with a custom prototype (only allowed own keys) rejected");
    // (D) class instance — custom prototype, single allowed own key → REJECT
    const ReadOp = class { constructor() { this.op = "READ_CURRENT_RESULTS"; } };
    ok(C.validateOperation(new ReadOp()) === null, "R3 Fix 1A(D): class-instance op rejected (custom prototype)");
    // POSITIVE guard-scope proof: the prototype rule allows Object.prototype OR
    // null — a null-prototype record with EXACTLY the allowed own keys still passes.
    const npOp = Object.assign(Object.create(null), { op: "OPEN_VISIBLE_HOTEL", position: 3 });
    { const npv = C.validateOperation(npOp); ok(npv && npv.op === "OPEN_VISIBLE_HOTEL" && npv.position === 3, "R3 Fix 1A: null-prototype op with allowed keys still passes (no over-reject)"); }
    // NON-ENUMERABLE extra key
    const nonEnum = { op: "READ_CURRENT_RESULTS" };
    Object.defineProperty(nonEnum, "url", { value: "https://evil.example", enumerable: false });
    ok(C.validateOperation(nonEnum) === null, "REV-01: non-enumerable extra key rejects");
    // SYMBOL extra key
    const symObj = { op: "READ_CURRENT_RESULTS" }; symObj[Symbol("x")] = "y";
    ok(C.validateOperation(symObj) === null, "REV-01: symbol extra key rejects");
    // ACCESSOR-backed authority property
    const accObj = { op: "OPEN_VISIBLE_HOTEL" };
    Object.defineProperty(accObj, "position", { get() { return 2; }, enumerable: true });
    ok(C.validateOperation(accObj) === null, "REV-01: accessor (getter) property rejects");
    // ACCESSOR op itself
    const accOp = {}; Object.defineProperty(accOp, "op", { get() { return "READ_CURRENT_RESULTS"; }, enumerable: true });
    ok(C.validateOperation(accOp) === null, "REV-01: accessor 'op' rejects");
    // IMMUTABLE canonical copy — frozen + mutation of the original does not leak
    const src = { op: "APPLY_HOTEL_REFINEMENT", destination: "Manali" };
    const v = C.validateOperation(src);
    ok(v && Object.isFrozen(v), "REV-01: validated operation is frozen (immutable canonical copy)");
    src.destination = "HACKED"; src.op = "HACKED";
    ok(v && v.op === "APPLY_HOTEL_REFINEMENT" && v.destination === "manali", "REV-01: mutating the original after validation does not affect the copy");
  }

  // ── REV-02 — request/response-bound catalogue (no cross-verify) ───────────
  section("REV-02 — catalogue request/response race");
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    rt.beginTurn("manali dikhao");
    const res = run(rt, { op: "APPLY_HOTEL_REFINEMENT", destination: "Manali" });
    eq(res.status, "ok", "REV-02: apply Manali ok");
    ok(res.pendingReconcile === true, "REV-02: explanation deferred");
    page.startLoading();
    ok(rt.reconcile() === null, "REV-02: while loading Manali, not explained");
    // a LATE Dhanaulti (A) resolution arrives while target is Manali (B)
    page.resolveTo("dhanaulti", "", "ready");
    ok(rt.reconcile() === null, "REV-02: late Dhanaulti resolution cannot verify the Manali ask (no cross-verify)");
    // the real Manali resolution
    page.resolveTo("manali", "", "ready");
    const done = rt.reconcile();
    ok(done && done.phase === "verified", "REV-02: verified only once the receipt actually resolves to Manali");
  }

  // ── REV-02B — partial refinement composition ─────────────────────────────
  section("REV-02B — destination-only / query-only composition");
  {
    // query-only change retains the current destination
    const a = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    a.rt.beginTurn("parking wale");
    a.rt && run(a.rt, { op: "APPLY_HOTEL_REFINEMENT", query: "parking" });
    a.page.startLoading();
    a.rt.reconcile();
    a.page.resolveTo("dhanaulti", "parking", "ready"); // destination retained, query applied
    const r1 = a.rt.reconcile();
    ok(r1 && r1.phase === "verified", "REV-02B: query-only change reconciles with destination RETAINED (not null)");
    // destination-only change retains the current query
    const b = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", query: "sea", resolvedCity: "Dhanaulti", resolvedQuery: "sea" });
    b.rt.beginTurn("manali");
    run(b.rt, { op: "APPLY_HOTEL_REFINEMENT", destination: "Manali" });
    b.page.startLoading(); b.rt.reconcile();
    b.page.resolveTo("manali", "sea", "ready"); // query retained
    const r2 = b.rt.reconcile();
    ok(r2 && r2.phase === "verified", "REV-02B: destination-only change reconciles with query RETAINED");
    // sequential converge
    const c = bootHotels({ displayHotels: HOTELS, city: "", resolvedCity: "" });
    c.rt.beginTurn("t1"); run(c.rt, { op: "APPLY_HOTEL_REFINEMENT", destination: "Dhanaulti" });
    c.page.startLoading(); c.rt.reconcile(); c.page.resolveTo("dhanaulti", "", "ready");
    ok(c.rt.reconcile()?.phase === "verified", "REV-02B: sequential refinement 1 converges");
    c.rt.beginTurn("t2"); run(c.rt, { op: "APPLY_HOTEL_REFINEMENT", query: "spa" });
    c.page.startLoading(); c.rt.reconcile(); c.page.resolveTo("dhanaulti", "spa", "ready");
    ok(c.rt.reconcile()?.phase === "verified", "REV-02B: sequential refinement 2 converges (no permanent unreconciled state)");
  }

  // ── REV-03 — local filter acceptance is not verification ─────────────────
  section("REV-03 — verify only after applied state");
  {
    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    const before = page.s.displayHotels.length; // 3
    const res = run(rt, { op: "APPLY_HOTEL_REFINEMENT", maxPrice: 3000 });
    eq(res.status, "ok", "REV-03: maxPrice apply ok");
    ok(res.companion && res.companion.phase === "acted" && res.companion.accepted === true, "REV-03: setter call returns ACTED, never verified");
    ok(res.pendingReconcile === true, "REV-03: verification deferred");
    // the fixture applied the filter → fewer results now
    const after = page.s.displayHotels.length; // htl_charlie 2600 only
    ok(after < before && after === 1, "REV-03: results actually recomputed by the host page");
    const v = rt.reconcile();
    ok(v && v.phase === "verified", "REV-03: verified only after a subsequent revision reflects the applied state");
    ok(/\b1\b/.test(v.speech), "REV-03: verified count is the RECOMPUTED count, not the pre-setter count");
  }

  // ── REV-04 — registration ownership token + dynamic route ────────────────
  section("REV-04 — registration ownership + dynamic route");
  {
    const rt = R.createLiveAiRuntime(); rt.activate();
    const p1 = makeHotelsPage({ displayHotels: HOTELS });
    const t1 = rt.registerPage(p1.reg);
    const p2 = makeHotelsPage({ displayHotels: HOTELS });
    const t2 = rt.registerPage(p2.reg); // same pageId — replaces
    ok(t1 !== t2, "REV-04: each registration gets a distinct ownership token");
    rt.unregisterPage(t1); // stale cleanup from the OLDER bridge
    eq(rt.getRegisteredPageId(), "hotels", "REV-04: stale (older-token) cleanup cannot remove the newer registration");
    eq(rt.getRegistrationToken(), t2, "REV-04: newer registration still owns");
    rt.unregisterPage(t2);
    eq(rt.getRegisteredPageId(), null, "REV-04: matching-token unregister clears");

    // dynamic /hotels/id1 → /hotels/id2 re-registration
    const rt2 = R.createLiveAiRuntime(); rt2.activate();
    const d1 = makeDetailPage({ routeId: "htl_id1", hotel: { id: "htl_id1", name: "One", amenities: ["Breakfast"], rooms: [] } });
    const dt1 = rt2.registerPage(d1.reg); rt2.invalidateRoute("/hotels/htl_id1");
    eq(rt2.getRegisteredPageId(), "hotel-detail", "REV-04: detail id1 registered");
    // navigate to id2: bridge re-runs (cleanup old token, register new), provider invalidates keeping new route
    rt2.unregisterPage(dt1);
    const d2 = makeDetailPage({ routeId: "htl_id2", hotel: { id: "htl_id2", name: "Two", amenities: ["Parking"], rooms: [] } });
    const dt2 = rt2.registerPage(d2.reg); rt2.invalidateRoute("/hotels/htl_id2");
    eq(rt2.getRegisteredPageId(), "hotel-detail", "REV-04: id1→id2 re-establishes detail authority");
    eq(rt2.getRegistrationToken(), dt2, "REV-04: id2 owns the registration");
    const facts = run(rt2, { op: "READ_CURRENT_HOTEL_FACTS" });
    eq(facts.facts && facts.facts.hotelId, "htl_id2", "REV-04: detail authority binds to the NEW hotel");
  }

  // ── REV-05 — synchronous complete context revision ───────────────────────
  section("REV-05 — synchronous complete-state fingerprint");
  {
    // fingerprint changes for EACH authority-relevant fact, with no effect tick.
    const base = { displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", amenityOpts: ["WiFi", "Parking"] };
    const fp = (mut) => {
      const p = makeHotelsPage(JSON.parse(JSON.stringify(base)));
      mut(p.s);
      return p.reg.getSnapshot().contextRevision;
    };
    const ref = fp(() => {});
    ok(fp((s) => { s.displayHotels = s.displayHotels.slice(0, 2); }) !== ref, "REV-05: visible-set change → new revision");
    ok(fp((s) => { s.displayHotels[0]._minPrice = 999; }) !== ref, "REV-05: price change → new revision");
    ok(fp((s) => { s.displayHotels[0].avgRating = 1.0; }) !== ref, "REV-05: rating change → new revision");
    ok(fp((s) => { s.displayHotels[0].amenities = ["WiFi"]; }) !== ref, "REV-05: parking-fact change → new revision");
    ok(fp((s) => { s.city = "Manali"; }) !== ref, "REV-05: destination change → new revision");
    ok(fp((s) => { s.maxPrice = 5000; }) !== ref, "REV-05: filter change → new revision");
    ok(fp((s) => { s.sort = "rating"; }) !== ref, "REV-05: sort change → new revision");
    ok(fp((s) => { s.loading = true; }) !== ref, "REV-05: load/receipt change → new revision");
    // the post-render/pre-effect class: an envelope prepared against old facts
    // fails BEFORE executing against new facts (no effect window).
    const { rt, page } = bootHotels(base);
    const env = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
    page.s.displayHotels[0].avgRating = 2.0; // an authority-relevant fact changes underneath
    eq(rt.execute(env).status, "stale_context", "REV-05: stale envelope rejected before executing against new facts");
  }

  // ── REV-06 — no old result authority while unresolved ────────────────────
  section("REV-06 — loading/error gives no stale list authority");
  {
    // requested != resolved ⇒ status loading ⇒ no read/compare/open authority
    const a = bootHotels({ displayHotels: HOTELS, city: "Manali", resolvedCity: "Dhanaulti" });
    eq(run(a.rt, { op: "READ_CURRENT_RESULTS" }).status, "not_ready", "REV-06: read fails while unreconciled/loading");
    eq(run(a.rt, { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2] }).status, "not_ready", "REV-06: compare fails while loading");
    eq(run(a.rt, { op: "OPEN_VISIBLE_HOTEL", position: 1 }).status, "not_ready", "REV-06: open fails while loading");
    ok(a.page.s.opened === null, "REV-06: no navigation over stale results");
    // error status
    const b = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", resolvedStatus: "error" });
    eq(run(b.rt, { op: "READ_CURRENT_RESULTS" }).status, "not_ready", "REV-06: read fails on error state");
    // ready
    const c = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    eq(run(c.rt, { op: "READ_CURRENT_RESULTS" }).status, "ok", "REV-06: read ok when request-bound receipt is READY");
  }

  // ── REV-07 — ordinals match actual visual positions ──────────────────────
  section("REV-07 — invalid-id row does not shift ordinals");
  {
    const mixed = [
      { id: "htl_one", name: "One", city: "X", _minPrice: 1000, avgRating: 4, amenities: [] },
      { id: "bad id/../etc", name: "Two-BAD", city: "X", _minPrice: 2000, avgRating: 4, amenities: [] }, // invalid id
      { id: "htl_three", name: "Three", city: "X", _minPrice: 3000, avgRating: 4, amenities: [] },
    ];
    const { rt, page } = bootHotels({ displayHotels: mixed, city: "", resolvedCity: "" });
    const snap = page.reg.getSnapshot();
    eq(snap.visibleHotels.map((h) => h.position).join(","), "1,3", "REV-07: positions preserved (gap at invalid row 2)");
    const o1 = run(rt, { op: "OPEN_VISIBLE_HOTEL", position: 1 });
    eq(o1.resolvedHotelId, "htl_one", "REV-07: position 1 = first displayed card");
    const o3 = run(rt, { op: "OPEN_VISIBLE_HOTEL", position: 3 });
    eq(o3.resolvedHotelId, "htl_three", "REV-07: position 3 = third displayed card (never renumbered to 2)");
    const o2 = run(rt, { op: "OPEN_VISIBLE_HOTEL", position: 2 });
    eq(o2.status, "missing_ordinal", "REV-07: the invalid card's ordinal fails closed (no silent shift)");
    eq(run(rt, { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2] }).status, "missing_ordinal", "REV-07: compare over the gap fails closed");
  }

  // ── REV-08 — parking uses an EXACT positive option from amenityOpts ──────
  section("REV-08 — parking option authority (exact positive allowlist)");
  {
    const bootP = (opts) => bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", amenityOpts: opts });
    // recognized positive option
    const a = bootP(["WiFi", "Parking", "Pool"]);
    eq(run(a.rt, { op: "APPLY_HOTEL_REFINEMENT", parking: true }).status, "ok", "REV-08: exact positive 'Parking' maps");
    ok(a.page.s.appliedAmenities.includes("Parking"), "REV-08: the verbatim vocabulary option is applied");
    // absent from amenityOpts (even though hotels' amenities contain Parking)
    const b = bootP(["WiFi", "Pool", "AC"]);
    eq(run(b.rt, { op: "APPLY_HOTEL_REFINEMENT", parking: true }).status, "unsupported_filter", "REV-08: absent from amenityOpts → unsupported_filter (reads vocabulary, not hotel amenities)");
    ok(b.page.s.appliedAmenities.length === 0, "REV-08: no mutation on unsupported_filter");
    // NEGATIVE / unavailable labels containing 'parking' MUST NOT match
    for (const neg of ["No Parking", "Parking unavailable", "Paid parking unavailable", "Parking not available"]) {
      const r = bootP([neg, "Pool"]);
      eq(run(r.rt, { op: "APPLY_HOTEL_REFINEMENT", parking: true }).status, "unsupported_filter", `REV-08: negative '${neg}' is NOT a valid parking filter`);
      ok(r.page.s.appliedAmenities.length === 0, `REV-08: no mutation for '${neg}'`);
    }
    // AMBIGUOUS label containing 'parking'
    const amb = bootP(["Parking nearby", "Pool"]);
    eq(run(amb.rt, { op: "APPLY_HOTEL_REFINEMENT", parking: true }).status, "unsupported_filter", "REV-08: ambiguous 'Parking nearby' is not a valid parking filter");
    // POSITIVE canonical variants recognized (exact-normalized)
    for (const pos of ["Free Parking", "Valet Parking", "Private Parking", "On-site Parking"]) {
      const r = bootP([pos, "Pool"]);
      eq(run(r.rt, { op: "APPLY_HOTEL_REFINEMENT", parking: true }).status, "ok", `REV-08: positive '${pos}' recognized`);
      ok(r.page.s.appliedAmenities.includes(pos), `REV-08: verbatim '${pos}' applied unchanged`);
    }
    // direct primitive checks
    eq(C.resolveParkingAmenity(["No Parking"]), null, "REV-08: resolveParkingAmenity('No Parking') → null");
    eq(C.resolveParkingAmenity(["Parking unavailable"]), null, "REV-08: 'Parking unavailable' → null");
    eq(C.resolveParkingAmenity(["Free Parking"]), "Free Parking", "REV-08: 'Free Parking' → exact original");

    // ── R3 Fix 3A — buildHotelsSnapshot APPLIED-parking flag uses the SAME exact
    //    positive allowlist (never substring). appliedAmenities = ["No Parking"]
    //    can NEVER flip snapshot.parking = true (the old substring bug).
    const appliedParking = (applied) => C.buildHotelsSnapshot({
      displayHotels: [], city: "", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null,
      sort: "default", stars: [], appliedAmenities: applied, amenityOpts: [],
      loading: false, error: "", resolvedCity: "", resolvedQuery: "", resolvedStatus: "ready",
    }).parking;
    for (const pos of [["Parking"], ["Private Parking"], ["Free Parking"], ["Valet Parking"]]) {
      eq(appliedParking(pos), true, `R3 Fix 3A: applied ${JSON.stringify(pos)} → parking active (exact positive)`);
    }
    for (const neg of [["No Parking"], ["Parking unavailable"], ["Paid parking unavailable"], ["Parking nearby"], ["WiFi"], []]) {
      eq(appliedParking(neg), false, `R3 Fix 3A: applied ${JSON.stringify(neg)} → parking NOT active (no substring authority)`);
    }
  }

  // ── REV-11 — never truncate an authority (filter) value; omit instead ────
  section("REV-11 — no semantic truncation of authority values");
  {
    const long = "Parking " + "x".repeat(200); // > MAX_AMENITY_LABEL_LEN, contains 'parking'
    eq(C.resolveParkingAmenity([long]), null, "REV-11: over-bound parking option is OMITTED (not truncated → null)");
    // buildHotelsSnapshot drops the over-bound option from the vocabulary entirely
    const snap = C.buildHotelsSnapshot({
      displayHotels: [], city: "", query: "", checkIn: "", checkOut: "", guests: 2, maxPrice: null,
      sort: "default", stars: [], appliedAmenities: [], amenityOpts: [long, "Parking"],
      loading: false, error: "", resolvedCity: "", resolvedQuery: "", resolvedStatus: "ready",
    });
    ok(!snap.availableAmenities.includes(long), "REV-11: over-bound option not present in the vocabulary");
    ok(!snap.availableAmenities.some((o) => o.length > C.MAX_AMENITY_LABEL_LEN), "REV-11: no truncated (over-bound) authority value produced");
    ok(snap.availableAmenities.includes("Parking"), "REV-11: a valid in-bound option stays byte-identical");
    eq(C.resolveParkingAmenity(snap.availableAmenities), "Parking", "REV-11: the in-bound option is returned unchanged");
  }

  // ── REV-09 (kept) + R1-REV-NEW-02 — facility positive/negative/ambiguous ──
  section("REV-09 + NEW-02 — facility tri-state with negative/ambiguous recognition");
  {
    // REV-09 malformed → unknown (must stay closed)
    eq(C.facilityFact(undefined, "parking"), "unknown", "REV-09: missing → unknown");
    eq(C.facilityFact("Parking", "parking"), "unknown", "REV-09: non-array → unknown");
    eq(C.facilityFact([{}], "parking"), "unknown", "REV-09: [{}] → unknown");
    eq(C.facilityFact([null], "parking"), "unknown", "REV-09: [null] → unknown");
    eq(C.facilityFact(["Parking", {}], "parking"), "unknown", "REV-09: ['Parking', {}] → unknown (malformed member)");
    eq(C.facilityFact([1, 2], "parking"), "unknown", "REV-09: numeric members → unknown");
    // NEW-02 positive
    eq(C.facilityFact(["WiFi", "Parking"], "parking"), "present", "NEW-02: 'Parking' → present");
    eq(C.facilityFact(["Free Parking"], "parking"), "present", "NEW-02: 'Free Parking' → present");
    eq(C.facilityFact(["Private Parking"], "parking"), "present", "NEW-02: 'Private Parking' → present");
    eq(C.facilityFact(["Breakfast included"], "breakfast"), "present", "NEW-02: 'Breakfast included' → present");
    eq(C.facilityFact(["Complimentary Breakfast"], "breakfast"), "present", "NEW-02: 'Complimentary Breakfast' → present");
    // NEW-02 negative — MUST NOT be present
    eq(C.facilityFact(["No Parking"], "parking"), "absent", "NEW-02: 'No Parking' → absent (never present)");
    eq(C.facilityFact(["Parking unavailable"], "parking"), "absent", "NEW-02: 'Parking unavailable' → absent (never present)");
    eq(C.facilityFact(["No Breakfast"], "breakfast"), "absent", "NEW-02: 'No Breakfast' → absent");
    eq(C.facilityFact(["Breakfast not included"], "breakfast"), "absent", "NEW-02: 'Breakfast not included' → absent");
    // NEW-02 not-mentioned (clean complete array) → absent
    eq(C.facilityFact(["WiFi", "AC"], "parking"), "absent", "NEW-02: facility not mentioned → absent");
    eq(C.facilityFact(["WiFi", "Breakfast"], "parking"), "absent", "NEW-02: parking not mentioned → absent");
    // NEW-02 ambiguous → unknown
    eq(C.facilityFact(["Parking nearby"], "parking"), "unknown", "NEW-02: ambiguous 'Parking nearby' → unknown");
    eq(C.facilityFact(["Breakfast on request"], "breakfast"), "unknown", "NEW-02: ambiguous 'Breakfast on request' → unknown");
    // NEW-02 conflict → unknown
    eq(C.facilityFact(["Free Parking", "No Parking"], "parking"), "unknown", "NEW-02: positive + negative conflict → unknown");
    eq(C.facilityFact(["Breakfast included", "No Breakfast"], "breakfast"), "unknown", "NEW-02: breakfast conflict → unknown");
  }

  // ── REV-10 — detail authority only after validation ──────────────────────
  section("REV-10 — detail authority gated on ready + id match");
  {
    // loading
    const a = R.createLiveAiRuntime(); a.activate();
    a.registerPage(makeDetailPage({ routeId: "htl_x", hotel: null, loading: true }).reg);
    eq(run(a, { op: "READ_CURRENT_HOTEL_FACTS" }).status, "not_ready", "REV-10: facts rejected while loading");
    eq(run(a, { op: "SHOW_HOTEL_SECTION", section: "about" }).status, "not_ready", "REV-10: SHOW_HOTEL_SECTION rejected while loading");
    // route mismatch (stale previous hotel)
    const b = R.createLiveAiRuntime(); b.activate();
    const bp = makeDetailPage({ routeId: "htl_new", hotel: { id: "htl_old", name: "Old", amenities: ["Breakfast"], rooms: [] } });
    b.registerPage(bp.reg);
    eq(run(b, { op: "READ_CURRENT_HOTEL_FACTS" }).status, "hotel_id_mismatch", "REV-10: facts rejected on route/id mismatch (stale hotel)");
    eq(run(b, { op: "SHOW_HOTEL_SECTION", section: "about" }).status, "not_ready", "REV-10: SHOW_HOTEL_SECTION rejected on mismatch");
    eq(bp.reg.getSnapshot().hotel, null, "REV-10: no stale hotel projection until validated");
    eq(bp.reg.getSnapshot().breakfast, "unknown", "REV-10: no stale facts until validated");
    // validated ready match
    const c = R.createLiveAiRuntime(); c.activate();
    const cp = makeDetailPage({ routeId: "htl_ok", hotel: { id: "htl_ok", name: "OK", city: "Y", amenities: ["Breakfast", "Free Parking"], rooms: [{ name: "Deluxe", floorPrice: 2000 }] } });
    c.registerPage(cp.reg);
    const f = run(c, { op: "READ_CURRENT_HOTEL_FACTS" });
    eq(f.status, "ok", "REV-10: facts ok when validated");
    eq(run(c, { op: "SHOW_HOTEL_SECTION", section: "about" }).status, "ok", "REV-10: SHOW_HOTEL_SECTION ok when validated");
    eq(cp.s.tab, "about", "REV-10: existing tab operated");
  }

  // ── REV-11 — bounded context contract ────────────────────────────────────
  section("REV-11 — bounded context (dates/amenities/prices/text)");
  {
    const bigName = "N".repeat(400);
    const longAmenity = "A".repeat(200);
    const snap = C.buildHotelsSnapshot({
      displayHotels: [{ id: "htl_b", name: bigName, city: "Dhanaulti", _minPrice: Number.MAX_SAFE_INTEGER, avgRating: 4, amenities: ["Parking"] }],
      city: "Dhanaulti", query: "", checkIn: "not-a-date", checkOut: "2026-13-40", guests: 999, maxPrice: Number.MAX_SAFE_INTEGER,
      sort: "default", stars: [], appliedAmenities: [],
      amenityOpts: Array.from({ length: 40 }, (_, i) => (i === 0 ? longAmenity : "Opt" + i)),
      loading: false, error: "", resolvedCity: "Dhanaulti", resolvedQuery: "", resolvedStatus: "ready",
    });
    eq(snap.checkIn, null, "REV-11: invalid ISO date → null");
    eq(snap.checkOut, null, "REV-11: out-of-range date → null");
    eq(snap.guests, null, "REV-11: guests over MAX_GUESTS → null");
    eq(snap.maxPrice, null, "REV-11: maxPrice over MAX_PRICE → null (no MAX_SAFE_INTEGER)");
    eq(snap.visibleHotels[0].minPrice, null, "REV-11: hotel minPrice over MAX_PRICE → null");
    eq(snap.visibleHotels[0].name.length, C.MAX_NAME_LEN, "REV-11: hotel name bounded to MAX_NAME_LEN");
    ok(snap.availableAmenities.length <= C.MAX_AMENITIES, "REV-11: amenity vocabulary honors MAX_AMENITIES (not 40)");
    ok(snap.availableAmenities.every((a) => a.length <= C.MAX_AMENITY_LABEL_LEN), "REV-11: each amenity label length-bounded");
    eq(C.isoDate("2026-08-15"), "2026-08-15", "REV-11: a valid ISO date passes");
    const gd = C.buildHotelsSnapshot({ displayHotels: [], city: "", query: "", checkIn: "2026-08-15", checkOut: "2026-08-18", guests: 3, maxPrice: 5000, sort: "default", stars: [], appliedAmenities: [], amenityOpts: [], loading: false, error: "", resolvedCity: "", resolvedQuery: "", resolvedStatus: "ready" });
    eq(gd.checkIn, "2026-08-15", "REV-11: valid dates retained");
    eq(gd.guests, 3, "REV-11: in-range guests retained");
    eq(gd.maxPrice, 5000, "REV-11: in-range maxPrice retained");
  }

  // ── REV-13 — bounded action-id dedup ─────────────────────────────────────
  section("REV-13 — bounded dedup structure");
  {
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    let lastEnv = null;
    for (let i = 0; i < C.MAX_DEDUP_ENTRIES + 80; i++) {
      const env = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
      rt.execute(env);
      lastEnv = env;
    }
    ok(rt.dedupSize() <= C.MAX_DEDUP_ENTRIES, `REV-13: dedup size bounded (<= ${C.MAX_DEDUP_ENTRIES}, got ${rt.dedupSize()})`);
    eq(rt.execute(lastEnv).status, "deduped", "REV-13: an immediate duplicate of the most-recent action still deduped (no immediate replay)");
  }

  // ── REV-14 — orb accessibility state accuracy ────────────────────────────
  section("REV-14 — orb state language (no false 'listening')");
  {
    const shell = fs.readFileSync(path.join(REPO, "components/live-ai/LiveAiShell.tsx"), "utf8");
    ok(/idle:\s*"StayBid AI ready"/.test(shell), "REV-14: idle announces 'ready', not 'listening'");
    ok(!/idle:\s*"StayBid AI is listening"/.test(shell), "REV-14: the old 'idle→listening' claim is gone");
  }

  // ── acceptance conversation via deterministic no-network transport ────────
  section("Acceptance — deterministic transport companion (items 11–20/35)");
  {
    const script = [
      { match: "parking", pageId: "hotels", operation: { op: "APPLY_HOTEL_REFINEMENT", destination: "Dhanaulti", maxPrice: 5000, parking: true } },
      { match: "compare", pageId: "hotels", operation: { op: "COMPARE_VISIBLE_HOTELS", positions: [1, 2] } },
      { match: "kholo", pageId: "hotels", operation: { op: "OPEN_VISIBLE_HOTEL", position: 2 } },
      { match: "breakfast", pageId: "hotel-detail", operation: { op: "READ_CURRENT_HOTEL_FACTS" } },
    ];
    const transport = T.createDeterministicTransport(script);
    ok(transport.isConnected() === false, "Acceptance: deterministic transport NOT connected (no provider/network)");
    ok(T.createNullTransport().propose({ text: "x", pageId: "hotels" }) === null, "Acceptance: production NULL transport proposes nothing");

    const { rt, page } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti", amenityOpts: ["WiFi", "Parking", "Breakfast"] });
    rt.beginTurn("Dhanaulti mein 5000 ke andar parking wale hotel dikhao");
    let prop = transport.propose({ text: "Dhanaulti mein 5000 ke andar parking wale hotel dikhao", pageId: "hotels" });
    const r1 = run(rt, prop.operation);
    eq(r1.status, "ok", "Acceptance: turn 1 refinement applied");
    eq(page.s.maxPrice, 5000, "Acceptance: existing /hotels state updated (budget)");
    ok(page.s.appliedAmenities.includes("Parking"), "Acceptance: parking applied via existing filter vocabulary");
    ok(r1.companion.phase === "acted", "Acceptance: turn 1 signals ACTED (explanation deferred until reconciliation)");

    rt.beginTurn("top two compare karo");
    prop = transport.propose({ text: "top two compare karo", pageId: "hotels" });
    const cmp = run(rt, prop.operation);
    eq(cmp.status, "ok", "Acceptance: compare current visible 1 & 2");
    eq(cmp.comparison.rows.map((r) => r.id).join(","), "htl_alpha,htl_bravo", "Acceptance: compare uses current visible ids only");

    rt.beginTurn("second wala kholo");
    prop = transport.propose({ text: "second wala kholo", pageId: "hotels" });
    const opened = run(rt, prop.operation);
    eq(opened.resolvedHotelId, "htl_bravo", "Acceptance: 'second wala' → visible position 2");
    eq(page.s.opened.url, "/hotels/htl_bravo", "Acceptance: real /hotels/<id> route from validated id");

    const memBefore = rt.getMemory().length;
    rt.invalidateRoute("/hotels/htl_bravo");
    eq(rt.getRegisteredPageId(), null, "Acceptance: old list authority invalidated on navigation");
    ok(rt.getMemory().length >= memBefore, "Acceptance: conversation memory survives the route change");
    const detail = makeDetailPage({ routeId: "htl_bravo", hotel: { id: "htl_bravo", name: "Bravo Retreat", city: "Dhanaulti", amenities: ["WiFi", "Breakfast"], rooms: [{ name: "Suite", floorPrice: 4100 }] } });
    rt.registerPage(detail.reg);
    rt.beginTurn("isme breakfast aur parking hai?");
    prop = transport.propose({ text: "isme breakfast aur parking hai?", pageId: "hotel-detail" });
    const facts = run(rt, prop.operation);
    eq(facts.status, "ok", "Acceptance: detail 'isme' facts ok");
    eq(facts.facts.breakfast, "present", "Acceptance: breakfast present from verified detail");
    eq(facts.facts.parking, "absent", "Acceptance: parking absent from the real amenities array (no invented fact)");
  }

  // ── envelope / role / secrets / page-binding integrity ───────────────────
  section("Integrity — envelope, role, secrets, page binding");
  {
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    // envelope with an extra authority field → invalid_envelope
    const good = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
    const withUrl = { ...good, url: "https://evil.example" };
    eq(rt.execute(withUrl).status, "invalid_envelope", "Integrity: extra envelope authority field fails closed");
    eq(rt.execute({ ...good, schema: "v0" }).status, "schema_mismatch", "Integrity: wrong schema fails closed");
    eq(rt.execute({ ...good, sessionId: "x" }).status, "session_mismatch", "Integrity: wrong session fails closed");
    eq(rt.execute({ ...good, routeEpoch: 999 }).status, "stale_route", "Integrity: wrong epoch fails closed");
    // role boundary
    ok(C.isLiveAiRole("anonymous") && C.isLiveAiRole("customer") && !C.isLiveAiRole("admin") && !C.isLiveAiRole("partner"), "Integrity: only anonymous/customer are Live-AI roles");
    const rr = R.createLiveAiRuntime("customer"); rr.setRole("admin"); eq(rr.getRole(), "customer", "Integrity: a privileged role never elevates the session");
    // no write/booking/bid operation exists
    eq(C.OPERATION_NAMES.slice().sort().join(","), ["APPLY_HOTEL_REFINEMENT", "COMPARE_VISIBLE_HOTELS", "OPEN_VISIBLE_HOTEL", "READ_CURRENT_HOTEL_FACTS", "READ_CURRENT_RESULTS", "SHOW_HOTEL_SECTION"].sort().join(","), "Integrity: only read + ui-local ops (no write/booking/bid)");
    ok(C.validateOperation({ op: "PREPARE_BID_DRAFT", hotelId: "htl_alpha" }) === null, "Integrity: no local bid draft op");
    ok(C.CONFIRMED_WRITE_ENABLED === false && C.DRAFT_LOCAL_ENABLED === false, "Integrity: CONFIRMED_WRITE + DRAFT_LOCAL disabled");
    // no secret/owner field in surfaced context
    const res = run(rt, { op: "READ_CURRENT_RESULTS" });
    ok(!/token|authorization|bearer|ownerId|owner_user_id|password|secret|cookie/i.test(JSON.stringify(res.results)), "Integrity: no token/owner/secret in surfaced summaries");
    eq(Object.keys(res.results[0]).sort().join(","), ["city", "id", "minPrice", "name", "parking", "position", "rating"].join(","), "Integrity: only approved safe summary fields");
    // page binding
    const badPage = { ...good, expectedPage: "hotel-detail", operation: { op: "SHOW_HOTEL_SECTION", section: "rooms" } };
    eq(rt.execute(badPage).status, "wrong_page", "Integrity: a detail op cannot run on the hotels registration");
    // reset/end invalidates
    const e2 = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
    rt.deactivate();
    eq(rt.execute(e2).status, "not_activated", "Integrity: reset/end invalidates pending work");
  }

  // ── R1-REV-NEW-01 — strict + immutable action envelope ───────────────────
  section("NEW-01 — strict immutable action envelope");
  {
    const { rt } = bootHotels({ displayHotels: HOTELS, city: "Dhanaulti", resolvedCity: "Dhanaulti" });
    const good = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
    // NON-ENUMERABLE extra field on the envelope
    const ne = { ...good };
    Object.defineProperty(ne, "url", { value: "https://evil.example", enumerable: false });
    eq(rt.execute(ne).status, "invalid_envelope", "NEW-01: non-enumerable envelope field rejects");
    // SYMBOL extra key on the envelope
    const se = { ...good }; se[Symbol("x")] = "y";
    eq(rt.execute(se).status, "invalid_envelope", "NEW-01: symbol envelope key rejects");
    // ACCESSOR actionId
    const aa = { ...good }; delete aa.actionId;
    Object.defineProperty(aa, "actionId", { get() { return "act_evil"; }, enumerable: true });
    eq(rt.execute(aa).status, "invalid_envelope", "NEW-01: accessor actionId rejects");
    // ACCESSOR operation
    const ao = { ...good }; delete ao.operation;
    Object.defineProperty(ao, "operation", { get() { return { op: "READ_CURRENT_RESULTS" }; }, enumerable: true });
    eq(rt.execute(ao).status, "invalid_envelope", "NEW-01: accessor operation rejects");
    // PROTOTYPE-supplied field (inherited) — own-data-only means it's not read;
    // with `contextRevision` only on the prototype the own set is incomplete → reject
    const proto = { contextRevision: good.contextRevision };
    const inh = Object.create(proto);
    for (const k of ["schema", "actionId", "sessionId", "turnId", "expectedPage", "routeEpoch", "operation"]) inh[k] = good[k];
    eq(rt.execute(inh).status, "invalid_envelope", "NEW-01: prototype-supplied envelope field rejects (own data only)");
    // ── R3 Fix 2A — a COMPLETE executable envelope carrying custom/inherited
    //    prototype authority must NEVER execute, even when EVERY required field is
    //    an own data property (validateEnvelope applies the same prototype rule).
    // (custom prototype) all required fields copied as OWN props, non-plain prototype
    const EvilEnv = function () {};
    EvilEnv.prototype.injected = "authority";
    const ce = Object.assign(new EvilEnv(), good);
    eq(rt.execute(ce).status, "invalid_envelope", "R3 Fix 2A: custom-prototype envelope (all fields own) rejected");
    // (class instance) all required fields own on a class-prototype object
    const EnvClass = class { constructor(src) { Object.assign(this, src); } };
    eq(rt.execute(new EnvClass(good)).status, "invalid_envelope", "R3 Fix 2A: class-instance envelope rejected (custom prototype)");
    // POSITIVE guard-scope proof: a NULL-PROTOTYPE envelope with exactly the
    // required own fields STILL executes (the rule allows Object.prototype OR null).
    // Fresh envelope → distinct actionId (never deduped against `good`).
    const freshGood = rt.makeEnvelope({ op: "READ_CURRENT_RESULTS" });
    const npEnv = Object.assign(Object.create(null), freshGood);
    eq(rt.execute(npEnv).status, "ok", "R3 Fix 2A: null-prototype envelope (all required own fields) still executes (no over-reject)");
    // a fully valid own-data (Object.prototype) envelope still executes
    eq(rt.execute({ ...good }).status, "ok", "NEW-01: a valid own-data envelope executes");
    // MUTATION-after-validation cannot change what dispatched: freeze the raw op
    // in an envelope, then mutating the raw op object mid-flight can't matter
    // because the runtime re-validates into its own frozen copy.
    const mutEnv = rt.makeEnvelope({ op: "OPEN_VISIBLE_HOTEL", position: 1 });
    const before = HOTELS[0].id;
    eq(rt.execute(mutEnv).resolvedHotelId, before, "NEW-01: dispatch uses the validated copy (position 1 → visible 1)");
  }

  // ── REV-12 — behavioral catalogue request-coordinator (production primitive)
  section("REV-12 — request coordinator behavior (A/B late-response race)");
  {
    // The SAME production functions app/hotels/page.tsx uses.
    ok(typeof C.nextRequestId === "function" && typeof C.catalogueResponseUpdate === "function",
      "REV-12: production coordinator primitives are exported");
    // A = Dhanaulti starts; B = Manali starts; B becomes current.
    let current = 0;
    const idA = C.nextRequestId(current); current = idA; // A claims id 1
    const idB = C.nextRequestId(current); current = idB; // B claims id 2 (current)
    ok(idA === 1 && idB === 2, "REV-12: monotonic request ids");
    // A resolves LATE while B is current → A may publish NOTHING.
    const aLate = C.catalogueResponseUpdate(idA, current, "success");
    ok(!aLate.publishResults && !aLate.publishReceipt && !aLate.setError && !aLate.clearLoading,
      "REV-12: late A cannot publish results / receipt / error / clear B's loading");
    // B resolves → B is authoritative.
    const bDone = C.catalogueResponseUpdate(idB, current, "success");
    ok(bDone.publishResults && bDone.publishReceipt && !bDone.setError && bDone.clearLoading,
      "REV-12: only B (current) becomes authoritative");
    // A errors late → cannot set error either.
    const aErrLate = C.catalogueResponseUpdate(idA, current, "error");
    ok(!aErrLate.setError && !aErrLate.clearLoading, "REV-12: late A error cannot set error or clear loading");
    // Inverse completion order: B completes first (still current), then A late.
    let cur2 = 0; const a2 = C.nextRequestId(cur2); cur2 = a2; const b2 = C.nextRequestId(cur2); cur2 = b2;
    ok(C.catalogueResponseUpdate(b2, cur2, "success").publishResults === true, "REV-12: B publishes when current (inverse order)");
    ok(C.catalogueResponseUpdate(a2, cur2, "success").publishResults === false, "REV-12: the stale A still cannot publish after B");
    // A rejected/stale error while B current → nothing.
    const rej = C.catalogueResponseUpdate(a2, cur2, "error");
    ok(!rej.publishResults && !rej.publishReceipt && !rej.setError && !rej.clearLoading, "REV-12: rejected stale request publishes nothing");
    // the current winner error path publishes an error (and clears loading).
    const bErr = C.catalogueResponseUpdate(b2, cur2, "error");
    ok(bErr.setError && bErr.clearLoading && !bErr.publishResults, "REV-12: the current request's error is authoritative");
  }

  // ── feature-off + orb render proofs (react-dom/server) ───────────────────
  section("Render — feature-off + orb-only shell (react-dom/server)");
  {
    let okEnv = true, missing = "", ReactServer, React, ts;
    try {
      ts = require(require.resolve("typescript", { paths: [REPO] }));
      React = require(require.resolve("react", { paths: [REPO] }));
      ReactServer = require(require.resolve("react-dom/server", { paths: [REPO] }));
    } catch (e) { okEnv = false; missing = String(e && e.message); }
    if (!okEnv) { fail += 1; failures.push("render proof unavailable (HOLD): " + missing); console.error("  ✗ render proof unavailable: " + missing); }
    else {
      const outC = path.join(OUT, "live-ai");
      const compDir = path.join(OUT, "components");
      fs.mkdirSync(compDir, { recursive: true });
      const navStub = path.join(compDir, "next_navigation.js");
      fs.writeFileSync(navStub, "module.exports={usePathname:function(){return '/hotels';}};");
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
      ]);
      const shellPath = transpile("components/live-ai/LiveAiShell.tsx", "LiveAiShell.js", [['"./LiveAiProvider"', JSON.stringify(providerPath)]]);
      const Provider = require(providerPath);
      const Shell = require(shellPath).default || require(shellPath).LiveAiShell;
      const _err = console.error; console.error = () => {};
      const empty = ReactServer.renderToStaticMarkup(React.createElement(Shell));
      console.error = _err;
      eq(empty, "", "Render: shell renders NOTHING with no registration (disabled default)");
      const ctx = { enabled: true, runtime: null, transport: null, registeredPageId: "hotels", activated: true, orbState: "idle", activate() {}, deactivate() {}, toggle() {}, registerPage: () => () => {} };
      console.error = () => {};
      const orb = ReactServer.renderToStaticMarkup(React.createElement(Provider.LiveAiContext.Provider, { value: ctx }, React.createElement(Shell)));
      console.error = _err;
      ok(/data-live-ai-orb/.test(orb) && /<button/.test(orb), "Render: registered → a single floating orb button");
      ok(!/role="dialog"/.test(orb) && !/class="[^"]*(modal|drawer|sheet|panel)/.test(orb) && !/transcript/i.test(orb), "Render: orb opens NO modal/drawer/sheet/panel/transcript");
      // REV-14: check the ANNOUNCED text (aria-label), not the CSS class names
      // that appear in the inlined <style> block (a .sb-liveai-listening class
      // exists for the unused state and is not an accessibility announcement).
      ok(/aria-label="StayBid AI ready"/.test(orb) && !/aria-label="[^"]*listening/i.test(orb),
        "Render(REV-14): active orb announces 'ready', never 'listening'");
      console.error = () => {};
      delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
      const off = ReactServer.renderToStaticMarkup(React.createElement(Provider.LiveAiProvider, null, React.createElement("div", { id: "APP" }, "APP")));
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const on = ReactServer.renderToStaticMarkup(React.createElement(Provider.LiveAiProvider, null, React.createElement("div", { id: "APP" }, "APP")));
      console.error = _err;
      ok(/id="APP"/.test(off), "Render: existing app preserved when the feature is OFF");
      ok(/id="APP"/.test(on), "Render: existing app preserved when the feature is ON");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
    }
  }

  // ── source scans (supplementary — REV-12) ────────────────────────────────
  section("SRC — production wiring integrity (supplementary scans)");
  {
    const read = (r) => fs.readFileSync(path.join(REPO, r), "utf8");
    const hotels = read("app/hotels/page.tsx");
    ok(!/import\s+VoiceSearchControl|<VoiceSearchControl\b/.test(hotels), "SRC: no VoiceSearchControl import/mount on /hotels");
    ok(/<HotelsPageBridge\b/.test(hotels), "SRC: /hotels registers HotelsPageBridge");
    ok(/nextRequestId\s*\(/.test(hotels) && /catalogueResponseUpdate\s*\(/.test(hotels),
      "SRC(REV-12): /hotels fetch uses the SHARED production coordinator primitive");
    ok(/from\s+["']@\/lib\/live-ai\/contracts["']/.test(hotels), "SRC(REV-12): coordinator imported from the production module");
    ok(/setResolvedCity|resolvedStatus/.test(hotels), "SRC(REV-02): /hotels tracks a request-bound resolved receipt");
    ok(/HotelDetailPageBridge/.test(read("app/hotels/[id]/page.tsx")), "SRC: /hotels/[id] registers HotelDetailPageBridge");
    const layout = read("app/layout.tsx");
    ok(/LiveAiProvider/.test(layout) && /LiveAiShell/.test(layout), "SRC: layout mounts the provider + orb");
    const liveAiFiles = ["components/live-ai/LiveAiProvider.tsx", "components/live-ai/LiveAiShell.tsx", "components/live-ai/HotelsPageBridge.tsx", "components/live-ai/HotelDetailPageBridge.tsx", "lib/live-ai/contracts.ts", "lib/live-ai/runtime.ts", "lib/live-ai/transport.ts"];
    const IMPORT_VOICE = /(?:from|require\()\s*["'][^"']*(?:components\/voice|@\/lib\/voice|voice-demo)["']|import\s+VoicePanel|<VoicePanel\b/;
    let noVoice = true, noWrite = true;
    for (const f of liveAiFiles) {
      const src = read(f);
      if (IMPORT_VOICE.test(src)) noVoice = false;
      if (/\bfetch\s*\(|["'`]\/api\//.test(src) || /openRazorpay|placeBid|razorpay|new WebSocket|RTCPeerConnection/.test(src)) noWrite = false;
    }
    ok(noVoice, "SRC: no VoicePanel/voice-module/voice-demo import in the Live-AI path");
    ok(noWrite, "SRC: no network/booking/bid/payment/WebRTC surface in the Live-AI path");
    const shell = read("components/live-ai/LiveAiShell.tsx");
    ok(!/role="dialog"|<dialog|getUserMedia|MediaRecorder/.test(shell), "SRC: shell has no dialog/mic-capture surface");
    ok(/aria-live/.test(shell) && /aria-label/.test(shell), "SRC: shell provides non-visible accessibility");
    // REV-04 / REV-05 markers in production source
    ok(/token/.test(read("lib/live-ai/runtime.ts")) && /unregisterPage\(token\)/.test(read("components/live-ai/LiveAiProvider.tsx")), "SRC(REV-04): token-gated unregister in runtime + provider");
    ok(/routeKey/.test(read("components/live-ai/LiveAiProvider.tsx")), "SRC(REV-04): registration hook keys on routeKey");
    ok(/fingerprint/.test(read("lib/live-ai/contracts.ts")), "SRC(REV-05): synchronous fingerprint revision in the builder");
    // .gitignore (REV-15)
    ok(/tests\/live-ai\/\.build\//.test(read(".gitignore")), "SRC(REV-15): tests/live-ai/.build/ is gitignored");
  }

  console.log(`\n${"─".repeat(54)}`);
  console.log(`Live AI LIVE-AI-01A R2: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL LIVE-AI-01A R2 CHECKS PASSED");
  process.exit(0);
})();
