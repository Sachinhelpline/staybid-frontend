/**
 * PRICE-CONSISTENCY-01 — hotel-detail pricing/demand single-authority tests.
 *
 * Hermetic source-scan suite (fs + string/regex, no network, no DB), matching
 * the structural-validation style of tests/price-spine-occupancy.test.js.
 *
 * CONTRACT under test — for a specific hotel / room / date, every customer-facing
 * hotel-detail pricing display derives from ONE canonical authority: the pricing
 * spine (resolveSpinePrices / room_date_price livePrice + demandScore). The
 * inline/modal calendar and the room cards can no longer disagree, the demand
 * chrome follows the SAME canonical demandScore through ONE shared mapping, the
 * batched read is one request per month (no N-per-day storm), a spine outage
 * shows neutral (never a fabricated price / second formula), and the demand-only
 * calendars (/bid, StaySearchSheet) are untouched. The pricing FORMULA is not
 * changed — the score→level thresholds are merely extracted verbatim.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL " + name); }
}
function inc(hay, needle, name) { ok(hay.includes(needle), name + `  (missing: ${needle})`); }
function nin(hay, needle, name) { ok(!hay.includes(needle), name + `  (unexpected: ${needle})`); }

// Load the REAL pure scope helpers (lib/pricing/calendar-scope.ts) by transpiling
// them in-memory with the project's own TypeScript — an executable regression of
// the runtime invariant, not just a source-string presence check.
function loadScopeHelpers() {
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib/pricing/calendar-scope.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
  const mod = { exports: {} };
  new Function("exports", "require", "module", js)(mod.exports, require, mod);
  return mod.exports;
}

// ── files under test ──────────────────────────────────────────────────────────
const LC        = read("components/LuxuryCalendar.tsx");
const HOTEL     = read("app/hotels/[id]/page.tsx");
const SPINE_RD  = read("lib/pricing/read-spine.ts");
const SPINE_RT  = read("app/api/pricing/spine/route.ts");
const AI        = read("lib/ai-pricing.ts");
const BID       = read("app/bid/page.tsx");
const SEARCH    = read("components/hotel/StaySearchSheet.tsx");

// Slice of the LuxuryCalendar hotel-mode spine fetch effect (used by 2 tests).
const fetchStart = LC.indexOf('const res = await fetch("/api/pricing/spine"');
const fetchEnd   = LC.indexOf("}, [pricingMode, roomIds, scopeKey, cursor, todayDate]);");
const fetchBlock = fetchStart >= 0 && fetchEnd > fetchStart ? LC.slice(fetchStart, fetchEnd) : "";

// ── 1. Hotel-mode calendar price is NOT computed from calculateDynamicPrice ────
ok(/if\s*\(pricingMode === "hotel"\)\s*return readScopedDayPrices\(spineByScope, scopeKey\);/.test(LC),
  "1a. LuxuryCalendar priceMap returns the scope-bound canonical spine map for hotel mode");
{
  const idxHotel = LC.indexOf('if (pricingMode === "hotel") return readScopedDayPrices(spineByScope, scopeKey);');
  const idxCalc  = LC.indexOf("calculateDynamicPrice(anchor");
  ok(idxHotel > 0 && idxCalc > idxHotel,
    "1b. calculateDynamicPrice(anchor) is only reached AFTER the hotel-mode early return (never for hotel mode)");
}

// ── 2. Calendar consumes the canonical spine (batched, dates[]) ────────────────
inc(LC, 'body: JSON.stringify({ roomIds, dates })',
  "2a. LuxuryCalendar posts the batched { roomIds, dates } shape to /api/pricing/spine");
inc(LC, "const byDate: Record<string, Record<string, any>> = res.pricesByDate;",
  "2b. LuxuryCalendar reads the batched pricesByDate response (after batch validation)");

// ── 3. Hotel-level cell = LOWEST valid livePrice across rooms ("starting from") ─
inc(LC, "const lp = Number(p?.livePrice) || 0;",
  "3a. calendar reads each room's spine livePrice");
inc(LC, "if (lp > 0 && (minLive === 0 || lp < minLive)) {",
  "3b. calendar picks the MINIMUM valid livePrice across rooms (starting-from)");

// ── 4. Calendar vs room-card CANNOT diverge — both read spine livePrice ────────
inc(HOTEL, "patch.price = Number(p.livePrice);",
  "4a. hotel room card price is overridden from the spine livePrice");
inc(LC, "patch[iso] = { price: minLive, tier: demandTierFromScore(scoreAtMin), score: scoreAtMin };",
  "4b. calendar cell price is the spine-derived minLive (same authority as the card)");
inc(HOTEL, "rooms={hotel.rooms || []}",
  "4c. inline desktop calendar receives hotel.rooms (carrying room ids)");
inc(HOTEL, "rooms={calCfg.rooms ?? hotel?.rooms ?? []}",
  "4d. mobile modal calendar receives hotel.rooms (carrying room ids)");

// ── 5. Demand display follows the CANONICAL spine demandScore (ONE mapping) ────
inc(HOTEL, "patch.demandScore = Math.round(Number(p.demandScore));",
  "5a. room card demandScore is overridden from the canonical spine demandScore");
inc(HOTEL, "patch.demandLevel = demandLevelFromScore(patch.demandScore);",
  "5b. room card demandLevel comes from the SHARED demandLevelFromScore mapping");
inc(LC, "scoreAtMin = Number(p?.demandScore) || 0;",
  "5c. calendar demand tier is fed by the canonical spine demandScore");
inc(LC, "tier: demandTierFromScore(scoreAtMin)",
  "5d. calendar demand tier uses the SHARED demandTierFromScore mapping");
inc(AI, "const demandLevel: DemandLevel = demandLevelFromScore(demandScore);",
  "5e. the pricing engine itself labels demand via the SAME shared mapping");

// ── 6. Missing spine → neutral, never a fabricated price / second formula ──────
inc(LC, "if (!forDate) continue;",
  "6a. a date with no spine data is skipped (no fabricated entry)");
inc(LC, "if (minLive > 0) {",
  "6b. a cell is only priced when a real spine livePrice resolved");
inc(LC, '!past && !pData && pricingMode === "hotel"',
  "6c. hotel-mode renders a neutral dot when no spine price resolved");
ok(fetchBlock.length > 0 && !fetchBlock.includes("calculateDynamicPrice"),
  "6d. the hotel-mode spine fetch NEVER falls back to calculateDynamicPrice (no 2nd authority)");

// ── 7. Demand-only calendars are UNCHANGED (no regression) ─────────────────────
inc(LC, 'calculateDynamicPrice(anchor, iso, city || "Mussoorie")',
  "7a. demand mode still computes the local demand tier (no hotel selected)");
ok(/pricingMode="demand"[\s\S]{0,400}rooms=\{\[\]\}|rooms=\{\[\]\}[\s\S]{0,400}pricingMode="demand"/.test(BID),
  "7b. /bid still uses pricingMode=demand with rooms=[] (no spine path)");
ok(/pricingMode="demand"[\s\S]{0,400}rooms=\{\[\]\}|rooms=\{\[\]\}[\s\S]{0,400}pricingMode="demand"/.test(SEARCH),
  "7c. StaySearchSheet still uses pricingMode=demand with rooms=[] (no spine path)");

// ── 8. Batched read — ONE query per window, ONE fetch per month (no N-storm) ───
inc(SPINE_RD, "export async function resolveSpinePricesRange(",
  "8a. read-spine exposes the batched date-range reader");
inc(SPINE_RD, "date=in.(${idList(days)})",
  "8b. the range reader reads the whole window in ONE date=in.(...) query (not per-date)");
inc(SPINE_RD, "computeRoomDatePrice({",
  "8c. the range reader REUSES computeRoomDatePrice (no second pricing formula)");
inc(SPINE_RT, "Array.isArray(body?.dates)",
  "8d. /api/pricing/spine accepts a batched dates[] payload");
inc(SPINE_RT, "resolveSpinePricesRange(roomIds, dates)",
  "8e. /api/pricing/spine serves the batch via the range reader");
inc(LC, "if (fetchedMonthsRef.current.has(monthKey)) return;",
  "8f. the calendar fetches at most once per month+rooms (no re-storm on nav)");

// ── 8b. Single-date spine path is PRESERVED (backward compatible) ──────────────
inc(SPINE_RT, "resolveSpinePrices(roomIds, date)",
  "8g. the single-date /api/pricing/spine path is unchanged");
inc(HOTEL, "body: JSON.stringify({ roomIds, date: checkInForCalc })",
  "8h. the room-card recalc still uses the single-date spine call");

// ── 9. Date selection / range / flash-deal calendar behaviour intact ───────────
inc(LC, "Array<{ id?: string; floorPrice?: number | null }>",
  "9a. rooms prop shape extended with id (price authority) without dropping floorPrice");
inc(LC, "function handleDayTap(", "9b. day-tap selection preserved");
inc(LC, "const minCheckInDate", "9c. minCheckIn lock preserved (flash-deal check-in lock)");
inc(LC, "const canPrev =", "9d. month navigation preserved");
inc(LC, "Apply (+1 night)", "9e. single-night default (range apply) preserved");
inc(LC, "onApply({ checkIn: draftIn, checkOut: draftOut });", "9f. range apply preserved");

// ── 10. Extraction is byte-identical — shared mapping keeps the exact thresholds ─
inc(AI, "export function demandLevelFromScore(score: number): DemandLevel {",
  "10a. demandLevelFromScore is exported");
ok(/>= 88 \? "Surge"[\s\S]*?>= 72 \? "Very High"[\s\S]*?>= 52 \? "High"[\s\S]*?>= 32 \? "Moderate"[\s\S]*?: "Low"/.test(AI),
  "10b. demandLevelFromScore keeps the exact 88/72/52/32 thresholds (formula unchanged)");
inc(AI, 'export function demandTierFromScore(score: number): "green" | "orange" | "red"',
  "10c. demandTierFromScore is exported");
inc(AI, "const lvl = demandLevelFromScore(score);",
  "10d. demandTierFromScore derives its 3-tier colour from the SAME level mapping");

// ── 11. CROSS-ROOM-SCOPE stale-price-leak invariant (Owner-Controller finding) ─
// The SAME <LuxuryCalendar> instance is reused for different room scopes (all
// hotel rooms vs a single flash room). A price resolved for room-set A must NEVER
// render for room-set B — not even for one render while B's request is pending.
// These are EXECUTABLE assertions against the real lib/pricing/calendar-scope.ts.
{
  const { roomScopeKey, readScopedDayPrices, isValidSpineBatch } = loadScopeHelpers();

  // F. order-independent, de-duped scope fingerprint (equivalent sets → one key).
  ok(roomScopeKey(["r2", "r1"]) === roomScopeKey(["r1", "r2", "r1"]),
    "11.F room-id ORDER + duplicates produce the SAME deterministic scope key");
  ok(roomScopeKey(["r1", "r2"]) === "r1,r2" && roomScopeKey([]) === "",
    "11.F scope key is the sorted-unique join; empty set → empty key");

  const keyA = roomScopeKey(["r1", "r2"]);          // all rooms
  const keyB = roomScopeKey(["r9"]);                // a single (different) flash room
  ok(keyA !== keyB, "11.pre scope A and scope B have distinct keys");

  // Scope A resolved a canonical price for a date; scope B has NOT resolved yet.
  const byScope = { [keyA]: { "2026-09-18": { price: 3500, tier: "green", score: 10 } } };

  // A. scope A reads its own canonical data.
  ok(readScopedDayPrices(byScope, keyA)["2026-09-18"] &&
     readScopedDayPrices(byScope, keyA)["2026-09-18"].price === 3500,
    "11.A scope A reads its own canonical date price (₹3,500)");

  // B + C. active scope changes to B before B resolves → NO scope-A leak.
  const renderedForB = readScopedDayPrices(byScope, keyB);
  ok(Object.keys(renderedForB).length === 0,
    "11.C scope B reads EMPTY while pending — scope A's price does not leak in");
  ok(renderedForB["2026-09-18"] === undefined,
    "11.C the specific scope-A date is absent under scope B (no cross-scope render)");
  ok(renderedForB !== byScope[keyA],
    "11.B scope B never returns scope A's map object");

  // D. a failed/invalid B response leaves B neutral (never A's price).
  ok(isValidSpineBatch({ prices: {}, error: "spine error" }) === false,
    "11.D an error batch response is INVALID (retryable, not cached)");
  // ...so byScope still has no keyB; B stays neutral.
  ok(Object.keys(readScopedDayPrices(byScope, keyB)).length === 0,
    "11.D after a failed B request, scope B remains neutral (not scope A's ₹3,500)");

  // E. switching back to A safely reuses ONLY A's own cached data.
  ok(readScopedDayPrices(byScope, keyA)["2026-09-18"].price === 3500,
    "11.E returning to scope A reuses A's own cached price");

  // G. only a real pricesByDate contract is treated as a successful fetch.
  ok(isValidSpineBatch({ pricesByDate: {} }) === true,
    "11.G a valid (even empty) pricesByDate response is accepted");
  ok(isValidSpineBatch({ pricesByDate: { "2026-09-18": { r1: { livePrice: 3500 } } } }) === true,
    "11.G a populated pricesByDate response is accepted");
  ok(isValidSpineBatch({}) === false && isValidSpineBatch(null) === false &&
     isValidSpineBatch({ prices: {} }) === false,
    "11.G missing/!object/no-pricesByDate bodies are INVALID (stay retryable)");
}

// ── 11b. LuxuryCalendar is WIRED to the scope-safe helpers ─────────────────────
inc(LC, 'from "@/lib/pricing/calendar-scope"',
  "11b.1 LuxuryCalendar imports the scope helpers");
inc(LC, "const scopeKey = useMemo(() => roomScopeKey(roomIds), [roomIds]);",
  "11b.2 scopeKey is the deterministic room-scope fingerprint");
ok(/\.filter\(Boolean\)\)\)\.sort\(\)/.test(LC),
  "11b.3 roomIds is de-duped AND sorted (order-independent identity)");
inc(LC, "const [spineByScope, setSpineByScope] = useState",
  "11b.4 canonical prices are stored per ROOM-SCOPE (spineByScope), not date-only");
ok(/const monthKey = `\$\{y\}-\$\{m\}\|\$\{scopeKey\}`;/.test(LC),
  "11b.5 the month fetch key is scope-aware (per-scope dedup, never cross-scope reuse)");
inc(LC, "if (!isValidSpineBatch(res)) return;",
  "11b.6 only a valid batch response is accepted (failure stays retryable)");
inc(LC, "[scopeKey]: { ...(prev[scopeKey] || {}), ...patch },",
  "11b.7 the fetched patch is merged UNDER the current scope key only");
inc(LC, 'if (pricingMode === "hotel") return readScopedDayPrices(spineByScope, scopeKey);',
  "11b.8 hotel-mode rendering reads ONLY the current scope's map");
ok(!/return spineMap;/.test(LC),
  "11b.9 the old date-only spineMap render path is gone (no cross-scope leak surface)");

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nprice-consistency: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
