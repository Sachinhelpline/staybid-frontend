#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — deterministic foundation + remediation
// test suite. Covers the original findings (REV-01/04/05/06/07) AND the
// second-round findings (REREV-01 stale/reset/cancel, REREV-02 compare trust,
// REREV-03 data-domain bounds, REREV-04 coverage).
//
//   Run:  node tests/voice/voice-ai.test.js
//
// Compiles the PURE lib/voice/*.ts with the LOCKFILE-INSTALLED local tsc (NO
// npx). Missing compiler OR non-zero compile FAILS the suite (REV-06). The
// disabled-mode /hotels render proof uses the installed react-dom/server. NO
// network (fetch injected), NO provider, NO DB.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

// ---- 1. compile lib/voice/*.ts with the LOCAL compiler (REV-06) -------------
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "voice"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/voice"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/voice", f), path.join(SRC, "voice", f));
}
fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      types: ["node"], lib: ["es2020", "dom"], noEmitOnError: true,
    },
    include: ["voice/**/*.ts"],
  }),
);
let TSC_BIN;
try {
  TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
} catch (_) {
  console.error("COMPILE GATE FAILED — local TypeScript compiler not installed. No npx fallback.");
  process.exit(2);
}
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], {
  cwd: REPO, encoding: "utf8",
});
if (compile.status !== 0) {
  console.error(`COMPILE GATE FAILED — local tsc exited ${compile.status} (diagnostics NOT ignored):`);
  console.error(compile.stdout || "");
  console.error(compile.stderr || "");
  process.exit(2);
}
if (!fs.existsSync(path.join(OUT, "voice/index.js"))) {
  console.error("COMPILE GATE FAILED — voice JS not emitted despite exit 0");
  process.exit(2);
}
console.log("• Local tsc compile: exit 0, clean (REV-06)");
const V = require(path.join(OUT, "voice/index.js"));

// ---- tiny assert framework --------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass += 1;
  else { fail += 1; failures.push(label); console.error("  ✗ " + label); }
}
function section(name) { console.log("\n• " + name); }

function fakeFetch(routes) {
  const calls = [];
  const impl = async (p, init) => {
    calls.push({ path: p, init: init || {} });
    const r = routes.find((x) => x.match(p));
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    if (typeof r.before === "function") r.before(); // simulate work during the fetch
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  impl.calls = calls;
  return impl;
}
const HOTELS = (arr) => ({ match: (p) => p.startsWith("/api/hotels?"), status: 200, body: { hotels: arr } });
const DETAIL = (h) => ({ match: (p) => p.startsWith("/api/hotels/"), status: 200, body: { hotel: h } });
const FLASH = (deals) => ({ match: (p) => p.startsWith("/api/flash/near?"), status: 200, body: { deals } });

(async () => {
  // ===== FEATURE FLAG =========================================================
  section("Feature flag — fail closed");
  delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
  ok(V.isVoiceBetaEnabled() === false, "1. disabled when flag absent");
  for (const v of ["0", "true", "yes", " 1 ", "1 ", "01", "", "TRUE"]) {
    process.env.NEXT_PUBLIC_VOICE_AI_BETA = v;
    ok(V.isVoiceBetaEnabled() === false, `2. disabled for flag='${v}'`);
  }
  process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
  ok(V.isVoiceBetaEnabled() === true, "2b. enabled ONLY for exact '1'");
  delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;

  // ===== REGISTRY + REV-04 immutability ======================================
  section("Capability registry — static allowlist + immutability (REV-04)");
  ok(
    JSON.stringify(Object.keys(V.CAPABILITY_REGISTRY).sort()) ===
      JSON.stringify(["compareHotels", "getFlashDeals", "getHotelDetails", "searchHotels"]),
    "registry holds EXACTLY the four read capabilities",
  );
  ok(V.isAllowedCapability("deleteHotel") === false, "unknown capability rejected");
  ok(Object.values(V.CAPABILITY_REGISTRY).every((d) => d.method === "GET"), "every descriptor GET");
  const sd = V.getDescriptor("searchHotels");
  ok(Object.isFrozen(sd) && Object.isFrozen(V.CAPABILITY_REGISTRY), "REV-04: descriptors + registry frozen");
  try { sd.method = "POST"; } catch (_) {}
  try { sd.build = () => ({ path: "/api/evil" }); } catch (_) {}
  ok(V.getDescriptor("searchHotels").method === "GET", "REV-04: method stays GET");
  const sg = V.getDescriptor("searchHotels").build({ city: "Manali" });
  ok(sg && sg.path === "/api/hotels?city=manali", "REV-04: build() not replaceable");
  const allPaths = JSON.stringify(V.CAPABILITY_REGISTRY) + " " + (sg ? sg.path : "");
  ok(!/\/api\/availability|\/api\/pricing\/spine/.test(allPaths), "15. availability/spine APIs absent");
  ok(!/\/api\/(bids|booking|pay|wallet|refund)|supabase|railway|rest\/v1/i.test(allPaths), "16/21. no mutation/backend paths");

  // ===== No arbitrary URL / method ===========================================
  section("No arbitrary URL / method");
  const d = V.getDescriptor("searchHotels");
  ok(d.build({ city: "http://evil.test" }) === null, "6. evil URL as city rejected");
  ok(d.build({ city: "//evil" }) === null, "6b. protocol-relative city rejected");
  ok(d.build({ q: "a".repeat(500) }) === null, "9. overlong query rejected");
  ok(!("url" in d) && !("baseUrl" in d), "7. no url/baseUrl field on descriptor");

  // ===== SEARCH (with mandatory turn) + REV-01 + trusted seeding ==============
  section("searchHotels — turn required, normalized, seeds allowlist + trusted map");
  {
    const session = V.createVoiceSession();
    const turn = session.beginTurn();
    const fetchImpl = fakeFetch([
      HOTELS([
        { id: "h1", name: "Cave View", city: "Manali", starRating: 4, avgRating: 4.6,
          ownerId: "owner-secret", phone: "+9199999", email: "o@x.test", description: "leak me",
          rooms: [{ name: "Deluxe", floorPrice: 2800 }, { name: "Suite", floorPrice: 5200 }] },
        { id: "../admin", name: "Evil", city: "Manali", rooms: [{ name: "x", floorPrice: 100 }] },
      ]),
    ]);
    const res = await V.searchHotels({ session, turn, fetchImpl }, { city: "Manali", q: "spa" });
    ok(res.ok === true, "search ok");
    ok(fetchImpl.calls[0].init.method === "GET", "8. GET issued");
    ok(fetchImpl.calls[0].init.signal === turn.signal, "REREV-01: fetch signal derived FROM the turn");
    ok(res.data.length === 1 && res.data[0].id === "h1", "REV-01: invalid-id row dropped");
    ok(!/owner-secret|o@x\.test|\+9199999|leak me/.test(JSON.stringify(res.data)), "10. owner/contact/free-text stripped");
    ok(session.hasHotelId("h1") === true, "allowlisted");
    ok(session.getTrustedHotel("h1") && session.getTrustedHotel("h1").minPrice === 2800, "REREV-02: trusted record stored");
    ok(session.getTrustedHotel("../admin") === null, "REV-01: invalid id not trusted");
  }

  // ===== MISSING TURN → fail closed (REREV-01) ================================
  section("REREV-01 — missing/invalid turn fails network adapters closed");
  {
    const session = V.createVoiceSession();
    const fetchImpl = fakeFetch([HOTELS([{ id: "h1", name: "H", city: "X", rooms: [] }])]);
    const s = await V.searchHotels({ session, fetchImpl }, { city: "X" });
    ok(s.ok === false && s.reason === "no_turn_context", "search: no turn → no_turn_context");
    ok(fetchImpl.calls.length === 0, "search: no fetch without a turn");
    const g = await V.getHotelDetails({ session, fetchImpl }, { id: "h1" });
    ok(g.ok === false && g.reason === "no_turn_context", "detail: no turn → no_turn_context");
    const fl = await V.getFlashDeals({ session, fetchImpl }, { city: "X" });
    ok(fl.ok === false && fl.reason === "no_turn_context", "flash: no turn → no_turn_context");
    const bogus = await V.searchHotels({ session, turn: { isStale: 1 }, fetchImpl }, { city: "X" });
    ok(bogus.ok === false && bogus.reason === "no_turn_context", "malformed turn → no_turn_context");
  }

  // ===== STALE / RESET / CANCEL completion (REREV-01) =========================
  section("REREV-01 — stale/reset/cancel completion rejected + no state mutation");
  {
    // (a) fetch resolves AFTER a newer turn supersedes it (fetch ignores abort).
    const s1 = V.createVoiceSession();
    const t1 = s1.beginTurn();
    const supersedeFetch = fakeFetch([{ ...HOTELS([{ id: "late1", name: "L", city: "X", rooms: [{ name: "r", floorPrice: 500 }] }]), before: () => s1.beginTurn() }]);
    const r1 = await V.searchHotels({ session: s1, turn: t1, fetchImpl: supersedeFetch }, { city: "X" });
    ok(r1.ok === false && r1.reason === "aborted", "search superseded mid-flight → aborted");
    ok(s1.hasHotelId("late1") === false && s1.getTrustedHotel("late1") === null, "superseded result did NOT mutate allowlist/trusted");

    // (b) reset() during the fetch.
    const s2 = V.createVoiceSession();
    const t2 = s2.beginTurn();
    s2.allowHotelIds(["pre"]);
    const resetFetch = fakeFetch([{ ...HOTELS([{ id: "late2", name: "L", city: "X", rooms: [] }]), before: () => s2.reset() }]);
    const r2 = await V.searchHotels({ session: s2, turn: t2, fetchImpl: resetFetch }, { city: "X" });
    ok(r2.ok === false && r2.reason === "aborted", "search after reset → aborted");
    ok(s2.hasHotelId("late2") === false, "post-reset result did NOT mutate allowlist");
    ok(s2.allowedHotelIds().length === 0, "reset cleared the allowlist");

    // (c) explicit cancel() during the fetch (fetch ignores the abort signal).
    const s3 = V.createVoiceSession();
    const t3 = s3.beginTurn();
    const cancelFetch = fakeFetch([{ ...HOTELS([{ id: "late3", name: "L", city: "X", rooms: [] }]), before: () => t3.cancel() }]);
    const r3 = await V.searchHotels({ session: s3, turn: t3, fetchImpl: cancelFetch }, { city: "X" });
    ok(r3.ok === false && r3.reason === "aborted", "search after cancel → aborted");
    ok(s3.hasHotelId("late3") === false, "cancelled result did NOT mutate allowlist");

    // (d) detail + flash stale via reset.
    const s4 = V.createVoiceSession();
    s4.allowHotelIds(["h1"]);
    const t4 = s4.beginTurn();
    const dReset = fakeFetch([{ ...DETAIL({ id: "h1", name: "H", city: "X", rooms: [] }), before: () => s4.reset() }]);
    const rd = await V.getHotelDetails({ session: s4, turn: t4, fetchImpl: dReset }, { id: "h1" });
    ok(rd.ok === false && rd.reason === "aborted", "detail after reset → aborted");
    ok(s4.getTrustedHotel("h1") === null, "detail-after-reset did NOT populate trusted map");
    const s5 = V.createVoiceSession();
    const t5 = s5.beginTurn();
    const flReset = fakeFetch([{ ...FLASH([{ id: "d1", hotelId: "h9", hotelName: "R", city: "X", aiPrice: 100, marketRate: 200 }]), before: () => s5.reset() }]);
    const rf = await V.getFlashDeals({ session: s5, turn: t5, fetchImpl: flReset }, { city: "X" });
    ok(rf.ok === false && rf.reason === "aborted", "flash after reset → aborted");
    ok(s5.hasHotelId("h9") === false, "flash-after-reset did NOT allowlist");
  }

  // ===== TURN-ID monotonicity + immediate invalidation (REREV-01) ============
  section("REREV-01 — monotonic turn ids + immediate invalidation");
  {
    const s = V.createVoiceSession();
    const a = s.beginTurn();
    const b = s.beginTurn();
    ok(b.turnId > a.turnId, "ids strictly increase");
    ok(a.isStale() === true && b.isStale() === false, "superseded turn stale");
    // reset immediately invalidates the active turn (before any new turn).
    s.reset();
    ok(b.isStale() === true, "reset immediately makes active turn stale");
    ok(b.signal.aborted === true, "reset aborts the active signal");
    const c = s.beginTurn();
    ok(c.turnId > b.turnId, "reset does NOT reuse/reset ids");
    ok(a.isStale() === true && b.isStale() === true, "pre-reset turns never become non-stale");
    // cancel immediately invalidates the active turn too.
    const dTurn = s.beginTurn();
    dTurn.cancel();
    ok(dTurn.isStale() === true && dTurn.signal.aborted === true, "cancel immediately invalidates the turn");
  }

  // ===== GET HOTEL DETAILS — allowlist + REV-01 mismatch =====================
  section("getHotelDetails — allowlist gate + response-id match (REV-01)");
  {
    const session = V.createVoiceSession();
    const detail = (id) => DETAIL({ id, name: "Cave View", city: "Manali", starRating: 4, avgRating: 4.6,
      ownerId: "SECRET", agentId: "SECRET2", phone: "+91", email: "e@x.test", description: "internal",
      amenities: ["Wifi"], images: ["https://cdn.example.com/a.jpg"], rooms: [{ name: "Deluxe", floorPrice: 2800 }] });
    let fetchImpl = fakeFetch([detail("h1")]);
    const denied = await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "h1" });
    ok(denied.ok === false && denied.reason === "hotel_id_not_allowlisted", "11. non-allowlisted id rejected pre-fetch");
    ok(fetchImpl.calls.length === 0, "11b. no fetch for non-allowlisted id");
    session.allowHotelIds(["h1"]);
    const evil = await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "../x" });
    ok(evil.ok === false && evil.reason === "hotel_id_invalid", "11c. traversal id rejected");
    const okRes = await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "h1" });
    ok(okRes.ok === true && !/SECRET|e@x\.test|internal/.test(JSON.stringify(okRes.data)), "11d. owner/agent/contact stripped");
    ok(session.getTrustedHotel("h1") !== null, "REREV-02: detail populates trusted map");
    fetchImpl = fakeFetch([detail("h999")]);
    const mism = await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "h1" });
    ok(mism.ok === false && mism.reason === "id_mismatch", "REV-01: response-id mismatch rejected");
    ok(session.getTrustedHotel("h999") === null, "REV-01: mismatch did NOT trust/allowlist a new id");
  }

  // ===== FLASH DEALS — read-only + REV-01 hotelId validation ==================
  section("getFlashDeals — read-only, derived discount, id-validated, NOT trusted");
  {
    const session = V.createVoiceSession();
    const fetchImpl = fakeFetch([FLASH([
      { id: "d1", hotelId: "h9", hotelName: "Ridge", city: "Manali", aiPrice: 2400, marketRate: 3000, discount: 48 },
      { id: "d2", hotelId: "../evil", hotelName: "X", city: "Manali", aiPrice: 1000, marketRate: 2000 },
    ])]);
    const res = await V.getFlashDeals({ session, turn: session.beginTurn(), fetchImpl }, { city: "Manali" });
    ok(res.ok === true, "12. flash read ok");
    ok(res.data[0].discountPct === 20, "12b. discount DERIVED (20), not raw 48");
    ok(session.hasHotelId("h9") === true, "valid deal hotel id allowlisted");
    ok(res.data[1].hotelId === null && session.hasHotelId("../evil") === false, "REV-01: invalid deal hotelId nulled/not-listed");
    ok(session.getTrustedHotel("h9") === null, "REREV-02: flash id NOT added to trusted map (no rating/price)");
  }

  // ===== COMPARE HOTELS — REREV-02 trusted-data authority =====================
  section("compareHotels — IDs only, trusted-map resolution (REREV-02)");
  {
    const session = V.createVoiceSession();
    const turn = session.beginTurn();
    const fetchImpl = fakeFetch([HOTELS([
      { id: "a", name: "Alpha", city: "Manali", starRating: 4, avgRating: 4.2, rooms: [{ name: "r", floorPrice: 3000 }] },
      { id: "b", name: "Bravo", city: "Manali", starRating: 5, avgRating: 4.8, rooms: [{ name: "r", floorPrice: 2500 }] },
      { id: "c", name: "Cee", city: "Manali", starRating: 3, avgRating: 4.9, rooms: [{ name: "r", floorPrice: 4000 }] },
    ])]);
    await V.searchHotels({ session, turn, fetchImpl }, { city: "Manali" });
    // Zero-fetch: compareHotels takes NO ctx/fetch, only (session, ids).
    ok(V.compareHotels.length === 2, "13. compareHotels signature is (session, ids) — no fetch ctx");
    const cmp = V.compareHotels(session, ["a", "b", "c"]);
    ok(cmp.ok === true, "compare ok for 3 trusted ids");
    ok(cmp.data.cheapestId === "b" && cmp.data.topRatedId === "c", "compare derives cheapest/top-rated from TRUSTED data");
    // Values come from the trusted map — the caller cannot pass fabricated values
    // at all (ids only). Confirm the output reflects the trusted record, not input.
    ok(cmp.data.hotels.find((h) => h.id === "a").name === "Alpha", "REREV-02: name comes from trusted record");
    ok(cmp.data.hotels.find((h) => h.id === "a").minPrice === 3000, "REREV-02: price comes from trusted record");
    ok(Object.keys(cmp.data.hotels[0]).sort().join(",") === "avgRating,city,id,minPrice,name,starRating", "REREV-02: only allowlisted fields present");
    // Unknown / untrusted id fails the WHOLE request closed.
    ok(V.compareHotels(session, ["a", "zzz"]).ok === false, "REREV-02: untrusted id fails compare closed");
    // Allowlisted-but-NOT-trusted (flash-only) id fails closed.
    session.allowHotelIds(["flashonly"]);
    const flashCmp = V.compareHotels(session, ["a", "flashonly"]);
    ok(flashCmp.ok === false && flashCmp.reason === "hotel_id_not_allowlisted", "REREV-02: allowlisted-but-untrusted id fails closed");
    // Invalid id form rejected; a fabricated object passed as an id is not a valid id.
    ok(V.compareHotels(session, ["a", "../x"]).ok === false, "REREV-02: traversal id rejected");
    ok(V.compareHotels(session, [{ id: "a", name: "FAKE", avgRating: 9 }]).ok === false, "REREV-02: object-as-id rejected (no catalogue-value injection)");
    // Max 3 + empty preserved.
    ok(V.compareHotels(session, ["a", "b", "c", "a"]).reason === "compare_too_many", "14. max 3 enforced");
    ok(V.compareHotels(session, []).reason === "compare_empty", "empty rejected");
    ok(V.compareHotels(V.createVoiceSession(), ["a"]).ok === false, "compare rejects ids from a fresh session");
  }

  // ===== REREV-03/REREV2 — data-domain bounds ================================
  section("REREV2-01/03 — strict numeric input boundary");
  {
    // Drive numerics through getHotelDetails (starRating/avgRating/totalReviews/
    // room floorPrice→minPrice) and getFlashDeals (prices).
    async function detailWith(hotel) {
      const session = V.createVoiceSession();
      session.allowHotelIds(["h1"]);
      const fetchImpl = fakeFetch([DETAIL({ id: "h1", name: "H", city: "X", rooms: [{ name: "r", floorPrice: hotel.floorPrice }], ...hotel })]);
      return (await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "h1" })).data;
    }
    async function flashWith(deal) {
      const session = V.createVoiceSession();
      const fetchImpl = fakeFetch([FLASH([{ id: "d1", hotelId: "h9", hotelName: "R", city: "X", ...deal }])]);
      return (await V.getFlashDeals({ session, turn: session.beginTurn(), fetchImpl }, { city: "X" })).data[0];
    }
    // REREV2-01: coercive malformed types must become null, NOT 0/1.
    // totalReviews has a wide domain [0..1e7] so it isolates the coercion guard
    // from the [0..5] rating domain.
    const COERCIVE = [null, undefined, "", " ", "  ", false, true, [], [1], {}, NaN, Infinity, -Infinity];
    for (const bad of COERCIVE) {
      const dd = await detailWith({ starRating: bad, avgRating: bad, totalReviews: bad, floorPrice: bad, images: [] });
      const label = Array.isArray(bad) ? `[${bad}]` : bad === "" ? '""' : String(bad);
      ok(dd.totalReviews === null, `REREV2-01: totalReviews rejects ${label} (no coercion to 0/1)`);
      ok(dd.starRating === null, `REREV2-01: starRating rejects ${label}`);
      ok(dd.avgRating === null, `REREV2-01: avgRating rejects ${label}`);
      ok(dd.minPrice === null, `REREV2-01: room floorPrice rejects ${label}`);
    }
    // The canonical bug: flash aiPrice:null must NOT become price 0 / fake 100% off.
    let fr = await flashWith({ aiPrice: null, marketRate: 3000 });
    ok(fr.price === null && fr.discountPct === null, "REREV2-01: aiPrice:null → price null, NO fake 100% discount");
    fr = await flashWith({ aiPrice: "", marketRate: 3000 });
    ok(fr.price === null && fr.discountPct === null, 'REREV2-01: aiPrice:"" → price null, no fake discount');
    fr = await flashWith({ aiPrice: false, marketRate: 3000 });
    ok(fr.price === null && fr.discountPct === null, "REREV2-01: aiPrice:false → price null, no fake discount");
    // REREV2-01: strict numeric STRINGS accepted (evidence: number|string fields).
    let dd = await detailWith({ starRating: "4", avgRating: "4.5", totalReviews: "1200", floorPrice: "2800", images: [] });
    ok(dd.starRating === 4 && dd.avgRating === 4.5 && dd.totalReviews === 1200 && dd.minPrice === 2800, "REREV2-01: strict numeric strings accepted");
    fr = await flashWith({ aiPrice: "2400", marketRate: "3000" });
    ok(fr.price === 2400 && fr.wasPrice === 3000 && fr.discountPct === 20, "REREV2-01: numeric-string flash prices accepted + discount derived");
    // REREV2-01: coercive numeric-string FORMATS rejected (wide-domain totalReviews).
    for (const bad of [" ", "12abc", "0x10", "1e5", "Infinity", "NaN", "+5", "1,200"]) {
      const d2 = await detailWith({ totalReviews: bad, floorPrice: 3000, images: [] });
      ok(d2.totalReviews === null, `REREV2-01: coercive numeric string rejected: '${bad}'`);
    }
    // Trim-first rule: a whitespace-PADDED valid number IS accepted after trim.
    ok((await detailWith({ totalReviews: "  1200  ", floorPrice: 3000, images: [] })).totalReviews === 1200, "REREV2-01: whitespace-padded numeric string accepted (trim-first)");
    // Valid ordinary + boundary values preserved.
    dd = await detailWith({ starRating: 5, avgRating: 4.0, totalReviews: 1200, floorPrice: 3500, images: [] });
    ok(dd.starRating === 5 && dd.avgRating === 4.0 && dd.totalReviews === 1200 && dd.minPrice === 3500, "REREV2-01: valid ordinary values preserved");
    ok((await detailWith({ totalReviews: 0, floorPrice: 3000, images: [] })).totalReviews === 0, "REREV2-01: valid zero review count preserved");
    ok((await flashWith({ aiPrice: 0, marketRate: 2000 })).price === 0, "REREV2-01: valid zero flash price preserved");
    // Negative + over-max.
    ok((await detailWith({ starRating: -1, avgRating: 99, totalReviews: -5, floorPrice: -100, images: [] })).starRating === null, "REREV2-01: negative rating → null");
    ok((await detailWith({ avgRating: 5.1, floorPrice: 3000, images: [] })).avgRating === null, "REREV2-01: >5 avgRating → null");
    ok((await detailWith({ totalReviews: 1e12, floorPrice: 1e12, images: [] })).totalReviews === null, "REREV2-01: extreme review count → null");
    ok((await detailWith({ totalReviews: 100, floorPrice: 1e12, images: [] })).minPrice === null, "REREV2-01: extreme price → null");
  }

  section("REREV2-02 — robust image validation");
  {
    async function imagesOf(arr) {
      const session = V.createVoiceSession();
      session.allowHotelIds(["h1"]);
      const fetchImpl = fakeFetch([DETAIL({ id: "h1", name: "H", city: "X", images: arr, rooms: [] })]);
      return (await V.getHotelDetails({ session, turn: session.beginTurn(), fetchImpl }, { id: "h1" })).data.images;
    }
    const C0 = String.fromCharCode(9); // TAB (a C0 control)
    const NUL = String.fromCharCode(0);
    const DEL = String.fromCharCode(127);
    const REJECT = [
      "https://?x", "https://#x",
      "https://user:pass@example.com/image.jpg",
      "javascript:alert(1)", "data:image/png;base64,AAAA", "blob:https://x/y", "file:///etc/passwd", "ftp://x/y.jpg",
      "//example.com/image.jpg",
      "/" + "a".repeat(600) + ".jpg", // overlong > 512
      "/../image.jpg", "/a/../image.jpg", "/./image.jpg", "/%2e%2e/image.jpg", "/%2E%2E/x.jpg",
      "/a/%2fb/image.jpg", // encoded separator smuggling
      "/bad/%zz/image.jpg", // malformed percent-encoding
      "/back\\slash.jpg", // backslash
      "/tab" + C0 + "/x.jpg", // raw C0 control
      "/nul" + NUL + "x.jpg", // raw NUL
      "/del" + DEL + "x.jpg", // raw DEL
      "not-a-url", "example.com/x.jpg", "",
    ];
    const rej = await imagesOf(REJECT);
    ok(rej.length === 0, "REREV2-02: ALL malformed/unsafe image forms rejected");
    const ACCEPT = ["https://example.com/image.jpg", "http://example.com/image.jpg", "/images/hotel.jpg", "https://cdn.example.com/a/b/c.webp?w=600", "/images/x.jpg?v=2#frag"];
    const acc = await imagesOf(ACCEPT);
    ok(acc.length === ACCEPT.length && acc.every((s, i) => s === ACCEPT[i]), "REREV2-02: representative legitimate http(s)/root-relative forms accepted verbatim");
    // Mixed list keeps only the safe ones, order preserved.
    const mixed = await imagesOf(["javascript:x", "https://example.com/ok.jpg", "/../evil.jpg", "/good/pic.jpg"]);
    ok(mixed.length === 2 && mixed[0] === "https://example.com/ok.jpg" && mixed[1] === "/good/pic.jpg", "REREV2-02: mixed list → only safe images, order preserved");
  }

  // ===== UI ACTION VALIDATION + dispatcher REV-05 ============================
  section("UI action union + dispatcher (REV-05 fail-closed comparison)");
  ok(V.validateUiAction({ type: "DROP_TABLE" }) === null, "5. unknown UI action rejected");
  ok(V.validateUiAction(null) === null, "19. null action fails closed");
  const inj = V.validateUiAction({ type: "OPEN_HOTEL", hotelId: "h1", route: "https://evil.test", url: "/admin" });
  ok(inj && inj.type === "OPEN_HOTEL" && !("route" in inj) && !("url" in inj), "20. no arbitrary route/url carried through");
  {
    const pushed = [], compares = [];
    const session = V.createVoiceSession();
    const dispatch = V.makeVoiceActionDispatcher({
      setCity: () => {}, setSearch: () => {}, setSearchOpen: () => {}, setSortBy: () => {}, setSelectedStars: () => {},
      router: { push: (p) => pushed.push(p) }, isHotelAllowlisted: (id) => session.hasHotelId(id),
      onShowComparison: (ids) => compares.push(ids),
    });
    session.allowHotelIds(["h1", "h2"]);
    ok(dispatch({ type: "OPEN_HOTEL", hotelId: "h1" }).ok === true && pushed[0] === "/hotels/h1", "20b. OPEN_HOTEL routes only to /hotels/<id>");
    ok(dispatch({ type: "OPEN_HOTEL", hotelId: "h404" }).ok === false && pushed.length === 1, "OPEN_HOTEL blocked for non-allowlisted");
    ok(dispatch({ type: "SHOW_COMPARISON", hotelIds: ["h1", "h2", "h404"] }).ok === false && compares.length === 0, "REV-05: mixed comparison rejected, callback not called");
    ok(dispatch({ type: "SHOW_COMPARISON", hotelIds: ["h1", "h2"] }).ok === true && compares.length === 1, "REV-05: all-allowlisted comparison ok");
  }

  // ===== SECRETS / PROVIDER ==================================================
  section("No secret/provider key path introduced");
  {
    const src = fs.readdirSync(path.join(REPO, "lib/voice")).filter((f) => f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(REPO, "lib/voice", f), "utf8")).join("\n");
    ok(!/OPENAI|ANTHROPIC|GEMINI|API_KEY|apiKey|secret|Bearer\s+\$/i.test(src.replace(/CRON|RAZORPAY/g, "")), "22. no provider/secret path");
    ok(!/import\s+.*from\s+["'](openai|@anthropic|ai|@google\/generative)/i.test(src), "22b. no AI provider package imported");
    ok(!/Authorization/i.test(src), "22c. no Authorization header in voice adapters");
  }

  // ===== REV-07 — disabled-mode /hotels preservation (render proof) ==========
  section("REV-07 — disabled-mode preservation (react-dom/server render)");
  {
    let okEnv = true, missing = "", ReactServer, ts;
    try {
      ts = require(require.resolve("typescript", { paths: [REPO] }));
      ReactServer = require(require.resolve("react-dom/server", { paths: [REPO] }));
    } catch (e) { okEnv = false; missing = String(e && e.message); }
    if (okEnv) {
      const compTs = fs.readFileSync(path.join(REPO, "components/voice/VoiceSearchControl.tsx"), "utf8");
      const emitted = ts.transpileModule(compTs, { compilerOptions: { module: "commonjs", target: "es2020", jsx: "react-jsx", esModuleInterop: true } }).outputText;
      const voiceIndexAbs = path.join(OUT, "voice/index.js");
      const compJsPath = path.join(OUT, "voice", "_component_under_test.js");
      fs.writeFileSync(compJsPath, emitted.replace(/["']@\/lib\/voice["']/g, JSON.stringify(voiceIndexAbs)));
      const Comp = (require(compJsPath).default) || require(compJsPath);
      const React = require(require.resolve("react", { paths: [REPO] }));
      let calls = 0;
      const inc = () => (calls += 1);
      const props = { setCity: inc, setSearch: inc, setSearchOpen: inc, setSortBy: inc, setSelectedStars: inc, setFilterOpen: inc, router: { push: inc } };
      delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
      ok(ReactServer.renderToStaticMarkup(React.createElement(Comp, props)) === "", "REV-07: disabled → empty markup (no control)");
      ok(calls === 0, "REV-07: disabled → no search-state side effect");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "0";
      ok(ReactServer.renderToStaticMarkup(React.createElement(Comp, props)) === "", "REV-07: flag '0' → still nothing");
      process.env.NEXT_PUBLIC_VOICE_AI_BETA = "1";
      const _e = console.error; console.error = () => {};
      const enabled = ReactServer.renderToStaticMarkup(React.createElement(Comp, props));
      console.error = _e;
      ok(/Voice search/.test(enabled) && calls === 0, "REV-07: enabled → control renders, still no setter side effect");
      delete process.env.NEXT_PUBLIC_VOICE_AI_BETA;
      console.log("  (disabled-mode proof via react-dom/server — installed deps only)");
    } else {
      fail += 1; failures.push("REV-07 render proof unavailable: " + missing);
      console.error("  ✗ REV-07 render proof unavailable (HOLD): " + missing);
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Voice AI SB-01: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL VOICE-AI-SB-01 CHECKS PASSED");
  process.exit(0);
})().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(3); });
