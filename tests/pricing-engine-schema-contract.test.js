/**
 * Pricing Engine Schema Contract Test
 *
 * Hermetic static-contract test for pricing engine schema correctness.
 * No database dependency; validates query string shapes in lib/pricing/engine.ts only.
 * Run: node tests/pricing-engine-schema-contract.test.js
 */

const fs = require("fs");
const path = require("path");

const SOURCE_FILE = path.join(__dirname, "../lib/pricing/engine.ts");

function testCase(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, substring, message) {
  assert(text.includes(substring), `${message} (not found: "${substring}")`);
}

function assertNotIncludes(text, substring, message) {
  assert(!text.includes(substring), `${message} (found: "${substring}")`);
}

const source = fs.readFileSync(SOURCE_FILE, "utf8");
const demandStart = source.indexOf("export async function getDemandScore");
const demandEnd = source.indexOf("export async function getVacancyRate");
const vacancyStart = demandEnd;
const vacancyEnd = source.indexOf("export async function ensurePricingConfig");

assert(demandStart >= 0 && demandEnd > demandStart, "demand function boundaries must exist");
assert(vacancyStart >= 0 && vacancyEnd > vacancyStart, "vacancy function boundaries must exist");

const demandSection = source.slice(demandStart, demandEnd);
const vacancySection = source.slice(vacancyStart, vacancyEnd);

console.log("Running pricing engine schema contract tests...\n");

testCase("demand: contains top-level roomId parameter", () => {
  assertIncludes(demandSection, "roomId=eq.${roomId}", "demand section must use roomId=eq");
});

testCase("demand: contains createdAt filter (not created_at)", () => {
  assertIncludes(demandSection, "createdAt=gte.${since2h}", "demand section must use createdAt=gte");
});

testCase("demand: does not contain stale meta->>roomId", () => {
  assertNotIncludes(demandSection, "meta->>roomId", "stale meta->>roomId must be removed");
});

testCase("demand: does not contain stale created_at", () => {
  assertNotIncludes(demandSection, "created_at", "stale created_at must be removed");
});

testCase("demand: contains complete query string", () => {
  assertIncludes(
    demandSection,
    "app_events?roomId=eq.${roomId}&createdAt=gte.${since2h}&select=count",
    "demand query must be complete and correct"
  );
});

testCase("vacancy: uses bid_requests!inner join in select", () => {
  assertIncludes(
    vacancySection,
    "select=id,bid_requests!inner(id,checkIn)",
    "vacancy query must use bid_requests!inner join inside select"
  );
});

testCase("vacancy: filters by bid_requests.checkIn (prefixed)", () => {
  assertIncludes(
    vacancySection,
    "bid_requests.checkIn=gte.${today}",
    "vacancy query must use prefixed bid_requests.checkIn filter"
  );
});

testCase("vacancy: does not contain bare checkIn filter", () => {
  assertNotIncludes(
    vacancySection,
    "\"checkIn\"=gte.${today}",
    "vacancy query must not use bare checkIn without bid_requests prefix"
  );
});

testCase("vacancy: does not contain bare &bid_requests!inner", () => {
  assertNotIncludes(
    vacancySection,
    "&bid_requests!inner(",
    "vacancy query must not have bare &bid_requests!inner outside select"
  );
});

testCase("vacancy: preserves status=eq.ACCEPTED", () => {
  assertIncludes(vacancySection, "status=eq.ACCEPTED", "vacancy query must preserve status filter");
});

testCase("vacancy: preserves &limit=500", () => {
  assertIncludes(vacancySection, "&limit=500", "vacancy query must preserve limit clause");
});

testCase("vacancy: preserves hotelId filter", () => {
  assertIncludes(
    vacancySection,
    "\"hotelId\"=eq.${hotelId}",
    "vacancy query must preserve hotelId filter"
  );
});

testCase("vacancy: contains complete expected query string", () => {
  assertIncludes(
    vacancySection,
    "select=id,bid_requests!inner(id,checkIn)&\"hotelId\"=eq.${hotelId}&status=eq.ACCEPTED&bid_requests.checkIn=gte.${today}&limit=500",
    "vacancy query must preserve the complete FK join and filter shape"
  );
});

testCase("schema: no meta->> JSON operator syntax remains anywhere", () => {
  assertNotIncludes(source, "meta->>", "all meta->> syntax must be removed");
});

testCase("schema: app_events uses field-based schema (not JSON metadata)", () => {
  assertIncludes(demandSection, "app_events?roomId=eq", "app_events query must use field-based parameters");
});

console.log("\n✓ All pricing engine schema contract tests passed!");
