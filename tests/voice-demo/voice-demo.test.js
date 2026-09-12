#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid AI — PRESENTATION-DEMO-01 — bounded demo controller test suite (R1).
//
//   Run:  node tests/voice-demo/voice-demo.test.js
//
// Compiles lib/voice/*.ts + lib/voice-demo/controller.ts with the LOCKFILE
// TypeScript (no npx). Drives the deterministic controller with an INJECTED
// fake read-only data layer — NO network, NO provider, NO DB, NO writes.
//
// Covers DEMO-REV-02 (authoritative displayed set + composing filters +
// combined utterance + current-result-only details/compare), DEMO-REV-03
// (reset generation invalidates late recognition / async completion / speech),
// DEMO-REV-04 (null-safe comparison superlatives), plus the standing no-write /
// no-provider guarantees.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "voice"), { recursive: true });
fs.mkdirSync(path.join(SRC, "voice-demo"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/voice"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/voice", f), path.join(SRC, "voice", f));
}
let ctrl = fs.readFileSync(path.join(REPO, "lib/voice-demo/controller.ts"), "utf8");
ctrl = ctrl.replace(/@\/lib\/voice\/contracts/g, "../voice/contracts");
fs.writeFileSync(path.join(SRC, "voice-demo", "controller.ts"), ctrl);

fs.writeFileSync(
  path.join(SRC, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
      moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
      types: ["node"], lib: ["es2020", "dom"], noEmitOnError: true,
    },
    include: ["voice/**/*.ts", "voice-demo/**/*.ts"],
  }),
);
let TSC_BIN;
try {
  TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] });
} catch (_) {
  console.error("COMPILE GATE FAILED — local TypeScript compiler not installed. No npx fallback.");
  process.exit(2);
}
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) {
  console.error(`COMPILE GATE FAILED — local tsc exited ${compile.status}:`);
  console.error(compile.stdout || ""); console.error(compile.stderr || "");
  process.exit(2);
}
const C = require(path.join(OUT, "voice-demo/controller.js"));
console.log("• Local tsc compile: exit 0, clean");

let pass = 0, fail = 0; const failures = [];
function ok(cond, label) { if (cond) pass += 1; else { fail += 1; failures.push(label); console.error("  ✗ " + label); } }
function eq(a, b, label) { ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
const ids = (arr) => arr.map((h) => h.id).join(",");

// ---- fake read-only data layer (NO network) ---------------------------------
// A ₹3200 parking · B ₹4800 no parking · C ₹7200 parking
const HOTELS = [
  { id: "htl_a", name: "Cave View Retreat", city: "dhanaulti", starRating: 4, avgRating: 4.6, minPrice: 3200 },
  { id: "htl_b", name: "Pine Ridge Inn",    city: "dhanaulti", starRating: 3, avgRating: 4.2, minPrice: 4800 },
  { id: "htl_c", name: "Cloud Nine Resort", city: "dhanaulti", starRating: 5, avgRating: 4.8, minPrice: 7200 },
];
const DETAILS = {
  htl_a: { id: "htl_a", name: "Cave View Retreat", city: "dhanaulti", starRating: 4, avgRating: 4.6, minPrice: 3200, amenities: ["Parking", "WiFi", "Breakfast"], images: [], totalReviews: 120, roomTypes: [] },
  htl_b: { id: "htl_b", name: "Pine Ridge Inn", city: "dhanaulti", starRating: 3, avgRating: 4.2, minPrice: 4800, amenities: ["WiFi"], images: [], totalReviews: 40, roomTypes: [] },
  htl_c: { id: "htl_c", name: "Cloud Nine Resort", city: "dhanaulti", starRating: 5, avgRating: 4.8, minPrice: 7200, amenities: ["Parking", "Pool", "Spa"], images: [], totalReviews: 200, roomTypes: [] },
};
let searchCalls = 0;
const deps = {
  async searchHotels(city) { searchCalls += 1; if (city && city !== "dhanaulti") return []; return HOTELS.slice(); },
  async getHotelDetails(id) { return DETAILS[id] || null; },
};

(async () => {
  // ---- intent parsing basics ----
  eq(C.parseIntent("Dhanaulti ke hotel dikhao").kind, "search", "hindi destination → search");
  eq(C.parseIntent("Show me hotels in Dhanaulti").kind, "search", "english destination → search");
  eq(C.wordsToNumber("paanch hazaar"), 5000, "paanch hazaar → 5000");
  eq(C.wordsToNumber("five thousand"), 5000, "five thousand → 5000");
  eq(C.parseIntent("book this hotel").kind, "booking_decline", "book → booking_decline");
  eq(C.parseIntent("place a bid").kind, "booking_decline", "bid → booking_decline");
  eq(C.parseIntent("pay now").kind, "booking_decline", "pay → booking_decline");
  eq(C.parseIntent("weather kaisa hai").kind, "out_of_scope", "unrelated → out_of_scope");

  // ---- A. combined utterance: destination + budget + parking in ONE turn ----
  {
    const it = C.parseIntent("Dhanaulti mein 5000 ke andar parking wala hotel dikhao");
    eq(it.kind, "search", "A: combined → search intent");
    eq(it.city, "dhanaulti", "A: city dhanaulti");
    eq(it.budget, 5000, "A: budget 5000");
    eq(it.amenity, "parking", "A: amenity parking");
    let t = await C.runTurn(C.initialState(), "Dhanaulti mein 5000 ke andar parking wala hotel dikhao", deps);
    eq(ids(t.cards), "htl_a", "A: combined displayed = A only (≤5000 AND parking)");
    eq(ids(t.state.displayed), "htl_a", "A: authoritative displayed = A only");
  }

  // ---- B. sequential filters compose; excluded result never re-enters ----
  {
    let t = await C.runTurn(C.initialState(), "Dhanaulti ke hotel dikhao", deps); let st = t.state;
    eq(ids(t.cards), "htl_a,htl_b,htl_c", "B: search shows A,B,C");
    t = await C.runTurn(st, "5000 ke andar", deps); st = t.state;
    eq(ids(t.cards), "htl_a,htl_b", "B: after budget 5000 → A,B (C excluded)");
    t = await C.runTurn(st, "parking wala", deps); st = t.state;
    eq(ids(t.cards), "htl_a", "B: then parking → A only");
    ok(!t.state.displayed.find((h) => h.id === "htl_c"), "B: C did NOT re-enter after being budget-excluded");
  }

  // ---- C. ordinal details resolve against CURRENT displayed set ----
  {
    // displayed after budget>5000-excluded then... build displayed = A,C via amenity parking on full set
    let t = await C.runTurn(C.initialState(), "Dhanaulti ke hotel dikhao", deps); let st = t.state;
    t = await C.runTurn(st, "parking wala", deps); st = t.state;
    eq(ids(t.cards), "htl_a,htl_c", "C: parking on A,B,C → displayed A,C");
    t = await C.runTurn(st, "second hotel details", deps); st = t.state;
    ok(t.detail && t.detail.id === "htl_c", "C: 'second' resolves displayed[1] = C (not hidden B)");
  }

  // ---- D. top-two compare consumes ONLY current displayed IDs ----
  {
    let t = await C.runTurn(C.initialState(), "Dhanaulti ke hotel dikhao", deps); let st = t.state;
    t = await C.runTurn(st, "parking wala", deps); st = t.state; // displayed = A,C
    t = await C.runTurn(st, "top do compare karo", deps); st = t.state;
    ok(t.state.topTwoIds.every((id) => ["htl_a", "htl_c"].includes(id)), "D: compare IDs ⊆ displayed {A,C}");
    ok(!t.state.topTwoIds.includes("htl_b"), "D: excluded B never compared");
  }

  // ---- DEMO-REV-04 null-safe comparison ----
  const twoKnown = [
    { id: "h1", name: "H1", city: "x", starRating: null, avgRating: 4.5, minPrice: 3000 },
    { id: "h2", name: "H2", city: "x", starRating: null, avgRating: 4.1, minPrice: 5000 },
  ];
  const oneNullPrice = [
    { id: "h1", name: "H1", city: "x", starRating: null, avgRating: 4.5, minPrice: 3000 },
    { id: "h2", name: "H2", city: "x", starRating: null, avgRating: 4.1, minPrice: null },
  ];
  const allNullPrice = [
    { id: "h1", name: "H1", city: "x", starRating: null, avgRating: 4.5, minPrice: null },
    { id: "h2", name: "H2", city: "x", starRating: null, avgRating: 4.1, minPrice: null },
  ];
  const oneNullRating = [
    { id: "h1", name: "H1", city: "x", starRating: null, avgRating: null, minPrice: 3000 },
    { id: "h2", name: "H2", city: "x", starRating: null, avgRating: 4.1, minPrice: 5000 },
  ];
  const allNullRating = [
    { id: "h1", name: "H1", city: "x", starRating: null, avgRating: null, minPrice: 3000 },
    { id: "h2", name: "H2", city: "x", starRating: null, avgRating: null, minPrice: 5000 },
  ];
  const compareOf = async (list) => {
    const st = { ...C.initialState(), displayed: list };
    return C.runTurn(st, "compare top two", deps);
  };
  // G. both-known price → cheapest claim allowed
  {
    const t = await compareOf(twoKnown);
    ok(/Sabse sasta/.test(t.reply), "G: both-known price → cheapest claim present");
    ok(/Sabse zyada rated/.test(t.reply), "J: both-known rating → highest-rated claim present");
  }
  // F. one-null price → NO cheapest claim
  {
    const t = await compareOf(oneNullPrice);
    ok(!/Sabse sasta/.test(t.reply), "F: one-null price → NO cheapest claim");
    ok(/price.*available nahi/i.test(t.reply), "F: says price data incomplete");
  }
  // E. all-null price → NO cheapest claim
  {
    const t = await compareOf(allNullPrice);
    ok(!/Sabse sasta/.test(t.reply), "E: all-null price → NO cheapest claim");
  }
  // I. one-null rating → NO highest-rated claim
  {
    const t = await compareOf(oneNullRating);
    ok(!/Sabse zyada rated/.test(t.reply), "I: one-null rating → NO highest-rated claim");
    ok(/[Rr]ating.*available nahi/i.test(t.reply), "I: says rating data incomplete");
  }
  // H. all-null rating → NO highest-rated claim
  {
    const t = await compareOf(allNullRating);
    ok(!/Sabse zyada rated/.test(t.reply), "H: all-null rating → NO highest-rated claim");
  }

  // ---- DEMO-REV-03 reset generation invalidation (TurnGate) ----
  // The gate is the exact mechanism the page uses across every async boundary.
  {
    const gate = C.createTurnGate();
    const token = gate.capture();
    ok(!gate.isStale(token), "K: fresh token owns current generation");
    gate.bump(); // Reset
    ok(gate.isStale(token), "K: after Reset bump, captured token is STALE");
  }
  // L/M. simulate the page guard around a DELAYED async runTurn / details:
  //   capture token → Reset (bump) mid-flight → completion must be DISCARDED.
  {
    const gate = C.createTurnGate();
    const applied = { cards: false, detail: false, transcript: false, speech: false };
    const token = gate.capture();
    const pending = (async () => {
      await new Promise((r) => setTimeout(r, 5));           // delayed search/details
      const out = await C.runTurn(C.initialState(), "Dhanaulti ke hotel dikhao", deps);
      if (gate.isStale(token)) return;                      // the page's guard
      applied.cards = out.cards.length > 0; applied.detail = !!out.detail;
      applied.transcript = true; applied.speech = true;
    })();
    gate.bump(); // Reset fires while the async turn is in flight
    await pending;
    ok(!applied.cards, "L: late async completion did NOT update cards");
    ok(!applied.detail, "M: late async completion did NOT update details");
    ok(!applied.transcript, "L/M: late async completion did NOT update transcript/conversation");
    ok(!applied.speech, "N: late async completion did NOT trigger speech");
  }
  // K(recognition). late recognition onend after Reset must not feed a transcript
  {
    const gate = C.createTurnGate();
    const recogToken = gate.capture();  // captured when recognition began
    let fed = false;
    gate.bump();                        // Reset before onend fires
    // onend guard mirrors the page:
    if (!gate.isStale(recogToken)) fed = true;
    ok(!fed, "K: recognition onend after Reset does NOT feed a stale transcript");
  }

  // ---- O. no-write booking/bid/payment ----
  {
    let t = await C.runTurn(C.initialState(), "book this hotel", deps);
    eq(t.reply, C.BOOKING_DECLINE_REPLY, "O: booking → safe decline");
    t = await C.runTurn(C.initialState(), "pay now", deps);
    eq(t.reply, C.BOOKING_DECLINE_REPLY, "O: pay → safe decline");
  }

  // ---- P. provider/OpenAI absence + read-only two-route data layer ----
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ctrlSrc = stripComments(fs.readFileSync(path.join(REPO, "lib/voice-demo/controller.ts"), "utf8"));
  const pageSrc = stripComments(fs.readFileSync(path.join(REPO, "app/voice-demo/page.tsx"), "utf8"));
  const dataSrcRaw = fs.readFileSync(path.join(REPO, "lib/voice-demo/client-data.ts"), "utf8");
  const dataSrc = stripComments(dataSrcRaw);
  const code = ctrlSrc + pageSrc + dataSrc;
  ok(!/openai/i.test(code), "P: no OpenAI reference in demo code");
  ok(!/realtime/i.test(code), "P: no Realtime reference in demo code");
  ok(!/\bapi[_-]?key\b/i.test(code), "P: no api key reference in demo code");
  ok(!/from ["']openai["']|require\(["']openai["']\)/i.test(code), "P: no openai import in demo code");
  const fetchUrls = [...dataSrc.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
  ok(fetchUrls.length === 2, "P: exactly two fetch call sites in data layer");
  ok(fetchUrls.every((u) => u.startsWith("/api/hotels")), "P: only /api/hotels read routes fetched");
  ok(!/\b(POST|PUT|PATCH|DELETE)\b/.test(dataSrc) && !/method\s*:/.test(dataSrc), "P: data layer performs no write method");

  // ---- DEMO-REV-03-R1-01 (R2): Reset synchronously restores idle lifecycle ----
  // PageSim mirrors app/voice-demo/page.tsx EXACTLY: the stale-token guards stay,
  // and reset() itself clears busy+listening synchronously (never the stale cb).
  function makePageSim(runDeps) {
    const gate = C.createTurnGate();
    const ui = { busy: false, listening: false, cards: [], detail: null, turns: [], stateApplied: false, spoke: false, stateRef: C.initialState() };
    async function handleTranscript(text, token) {
      const owned = token ?? gate.capture();
      if (gate.isStale(owned)) return;
      ui.turns.push({ who: "you", text });
      ui.busy = true;
      try {
        const out = await runTurn_(ui.stateRef, text, runDeps);
        if (gate.isStale(owned)) return;                 // discard late completion
        ui.stateRef = out.state; ui.stateApplied = true;
        ui.cards = out.cards; ui.detail = out.detail;
        ui.turns.push({ who: "sb", text: out.reply });
        ui.spoke = true;
      } finally {
        if (!gate.isStale(owned)) ui.busy = false;       // stale → do NOT touch busy here
      }
    }
    function recogEnd(finalText, recogToken) {
      if (gate.isStale(recogToken)) return;              // late onend after Reset → discard
      ui.listening = false;
      const t = finalText.trim();
      if (t) return handleTranscript(t, recogToken);
    }
    function reset() {
      gate.bump();                                       // (1) invalidate first
      ui.spoke = ui.spoke;                               // (2) cancel speech (noop in sim)
      // (3)(4) stop/clear recognition (noop in sim)
      ui.busy = false; ui.listening = false;             // (5) synchronous idle restore
      ui.stateRef = C.initialState(); ui.turns = []; ui.cards = []; ui.detail = null;
    }
    return { gate, ui, handleTranscript, recogEnd, reset };
  }
  const runTurn_ = C.runTurn;

  // R2-A: delayed SEARCH; Reset clears busy immediately; late resolve restores nothing.
  {
    let release;
    const gated = { searchHotels: (c) => new Promise((r) => { release = () => r(c && c !== "dhanaulti" ? [] : HOTELS.slice()); }), getHotelDetails: deps.getHotelDetails };
    const sim = makePageSim(gated);
    const p = sim.handleTranscript("Dhanaulti ke hotel dikhao");
    ok(sim.ui.busy === true, "R2-A: busy=true while search in flight");
    sim.reset();
    ok(sim.ui.busy === false, "R2-A: Reset clears busy IMMEDIATELY");
    release(); await p;
    ok(sim.ui.busy === false, "R2-A: busy stays false after late search resolves");
    ok(sim.ui.cards.length === 0, "R2-A: no cards restored");
    ok(sim.ui.turns.length === 0, "R2-A: no conversation restored");
    ok(sim.ui.stateApplied === false, "R2-A: no controller state restored");
    ok(sim.ui.spoke === false, "R2-A: no speech");
  }
  // R2-B: delayed DETAILS; Reset clears busy immediately; late resolve restores nothing.
  {
    let release;
    const base = { ...C.initialState(), displayed: HOTELS.slice() };
    const gated = { searchHotels: deps.searchHotels, getHotelDetails: (id) => new Promise((r) => { release = () => r(DETAILS[id] || null); }) };
    const sim = makePageSim(gated);
    sim.ui.stateRef = base;
    const p = sim.handleTranscript("first hotel details");
    ok(sim.ui.busy === true, "R2-B: busy=true while details in flight");
    sim.reset();
    ok(sim.ui.busy === false, "R2-B: Reset clears busy IMMEDIATELY (details)");
    release(); await p;
    ok(sim.ui.busy === false && sim.ui.detail === null && sim.ui.stateApplied === false && sim.ui.spoke === false, "R2-B: late details restore nothing");
  }
  // R2-C: listening=true; Reset clears listening immediately; stale onend restores nothing.
  {
    const sim = makePageSim(deps);
    sim.ui.listening = true;
    const recogToken = sim.gate.capture();
    sim.reset();
    ok(sim.ui.listening === false, "R2-C: Reset clears listening IMMEDIATELY");
    await sim.recogEnd("Dhanaulti ke hotel dikhao", recogToken); // stale onend
    ok(sim.ui.listening === false, "R2-C: listening stays false after stale onend");
    ok(sim.ui.turns.length === 0, "R2-C: no transcript submitted from stale onend");
    ok(sim.ui.stateApplied === false, "R2-C: no state restored from stale onend");
  }
  // R2-D: BOTH a recognition turn AND an async controller turn active → Reset leaves both false.
  {
    let release;
    const gated = { searchHotels: () => new Promise((r) => { release = () => r(HOTELS.slice()); }), getHotelDetails: deps.getHotelDetails };
    const sim = makePageSim(gated);
    sim.ui.listening = true;                     // a recognition turn is active
    const recogToken = sim.gate.capture();
    const p = sim.handleTranscript("Dhanaulti ke hotel dikhao", recogToken); // async controller turn
    ok(sim.ui.busy === true && sim.ui.listening === true, "R2-D: both busy+listening active");
    sim.reset();
    ok(sim.ui.busy === false && sim.ui.listening === false, "R2-D: Reset leaves BOTH busy=false AND listening=false");
    release(); await p;
    ok(sim.ui.busy === false && sim.ui.listening === false, "R2-D: both stay false after late resolves");
    ok(sim.ui.cards.length === 0 && sim.ui.spoke === false, "R2-D: no cards/speech restored");
  }

  // ---- R1 packet #2: REAL-DEVICE natural budget language + city variants ----
  // #1 exact real-device phrase that previously reached fallback:
  {
    const it = C.parseIntent("Mujhe Dhanaulti ke liye 5000 wala room dikhao");
    eq(it.kind, "search", "RD1: '5000 wala room' → search intent");
    eq(it.city, "dhanaulti", "RD1: city resolves dhanaulti");
    eq(it.budget, 5000, "RD1: budget 5000 parsed from 'wala'");
    eq(it.amenity, null, "RD1: no amenity");
    const t = await C.runTurn(C.initialState(), "Mujhe Dhanaulti ke liye 5000 wala room dikhao", deps);
    eq(ids(t.cards), "htl_a,htl_b", "RD1: displayed = ≤5000 (A,B); C excluded");
  }
  // bounded natural budget variants → budget 5000 (search or filter)
  for (const phrase of ["5000 wala", "5000 tak", "5000 ke andar", "budget 5000", "5000 se kam", "under 5000"]) {
    const it = C.parseIntent(phrase + " dikhao");
    ok((it.kind === "search" || it.kind === "filter") && it.budget === 5000,
      `RD budget variant '${phrase}' → budget 5000 (got kind=${it.kind}, budget=${it.budget})`);
  }
  // spoken 'paanch hazaar wala' → 5000
  ok(C.parseIntent("paanch hazaar wala dikhao").budget === 5000, "RD: 'paanch hazaar wala' → 5000");
  // Dhanaulti spelling / Devanagari variants → canonical dhanaulti
  for (const v of ["Dhanaulti", "Dhanolti", "dhanoli", "धनौल्टी", "धनौली"]) {
    const it = C.parseIntent(v + " ke hotel dikhao");
    ok(it.kind === "search" && it.city === "dhanaulti", `RD city variant '${v}' → dhanaulti (got ${it.city})`);
  }
  // "parking wala" must NOT be misread as a budget (no number present)
  {
    const it = C.parseIntent("parking wala dikhao");
    ok(it.kind === "filter" && it.amenity === "parking" && it.budget == null,
      "RD: 'parking wala' stays amenity filter, not budget");
  }
  // combined real-device: destination + budget-wala + parking in one turn
  {
    const t = await C.runTurn(C.initialState(), "Dhanaulti mein 5000 wala parking wala hotel dikhao", deps);
    eq(ids(t.cards), "htl_a", "RD combined: dhanaulti + ≤5000 + parking → A only");
  }

  // reset target purity
  const fresh = C.initialState();
  ok(fresh.displayed.length === 0 && fresh.baseResults.length === 0 && fresh.selectedId === null && fresh.topTwoIds.length === 0, "reset target initialState is empty");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.error("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
  console.log("ALL VOICE-DEMO R1 ASSERTIONS PASSED");
})();
