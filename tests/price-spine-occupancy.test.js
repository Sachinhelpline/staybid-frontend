/**
 * Price Spine Occupancy Calculation Tests
 *
 * Tests the pure occupancy helper function from lib/pricing/occupancy.
 * This is a hermetic Node test suite with no Supabase/database dependencies.
 * Tests the actual production code, not a duplicate implementation.
 */

const { calculateOccupancyForDate } = require("../lib/pricing/occupancy");
const fs = require("fs");
const path = require("path");

// Test helpers
function testCase(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${e.message}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function assertStringIncludes(text, substring, message) {
  assert(text.includes(substring), `${message} (not found: "${substring}")`);
}

// Test suite
console.log("Running occupancy calculation tests...\n");

// ════════════════════════════════════════════════════════════════
// OCCUPANCY CALCULATION TESTS (functional correctness)
// ════════════════════════════════════════════════════════════════

// Test 1: Empty windows
testCase("Empty windows returns 0 occupied", () => {
  const dateMs = 1000;
  const occupied = calculateOccupancyForDate([], dateMs);
  assertEquals(occupied, 0, "Empty windows should give 0 occupied");
});

// Test 2: Single room, date outside window
testCase("Single room outside window returns 0", () => {
  const dateMs = 1000;
  const windows = [{ ci: 2000, co: 3000, numRooms: 1 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 0, "Date before window should give 0 occupied");
});

// Test 3: Single room, date at window start (inclusive)
testCase("Single room at window start (ci) is included", () => {
  const dateMs = 1000;
  const windows = [{ ci: 1000, co: 2000, numRooms: 1 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 1, "Date at ci should be included");
});

// Test 4: Single room, date at window end (exclusive)
testCase("Single room at window end (co) is excluded", () => {
  const dateMs = 2000;
  const windows = [{ ci: 1000, co: 2000, numRooms: 1 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 0, "Date at co should be excluded");
});

// Test 5: Single room, date in middle of window
testCase("Single room in middle of window is included", () => {
  const dateMs = 1500;
  const windows = [{ ci: 1000, co: 2000, numRooms: 1 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 1, "Date in middle should be included");
});

// Test 6: Multi-room bid (1-room + 3-room)
testCase("Multi-room bid counts all rooms (1+3)", () => {
  const dateMs = 1500;
  const windows = [
    { ci: 1000, co: 2000, numRooms: 1 },
    { ci: 1200, co: 1800, numRooms: 3 }
  ];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 4, "Multi-room bid should sum (1+3=4)");
});

// Test 7: Multiple non-overlapping windows
testCase("Multiple non-overlapping windows count correctly", () => {
  const dateMs = 1500;
  const windows = [
    { ci: 500, co: 1000, numRooms: 2 },
    { ci: 1500, co: 2000, numRooms: 3 }
  ];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 3, "Only overlapping window should count");
});

// Test 8: Multiple overlapping windows
testCase("Multiple overlapping windows sum correctly", () => {
  const dateMs = 1500;
  const windows = [
    { ci: 1000, co: 2000, numRooms: 2 },
    { ci: 1200, co: 1800, numRooms: 3 }
  ];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 5, "Overlapping windows should sum (2+3)");
});

// Test 9: Three-way overlap
testCase("Three-way overlap sums correctly", () => {
  const dateMs = 1500;
  const windows = [
    { ci: 1000, co: 2000, numRooms: 1 },
    { ci: 1200, co: 1800, numRooms: 2 },
    { ci: 1300, co: 1700, numRooms: 3 }
  ];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 6, "Three-way overlap should sum (1+2+3)");
});

// Test 10: Touching windows (one's co = next's ci) — checkout exclusive boundary
testCase("Adjacent but non-overlapping windows (checkout exclusive)", () => {
  const dateMs = 1500;
  const windows = [
    { ci: 1000, co: 1500, numRooms: 2 },
    { ci: 1500, co: 2000, numRooms: 3 }
  ];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 3, "Date at boundary (co) should only match next window");
});

// Test 11: Large numRooms value
testCase("Large numRooms value", () => {
  const dateMs = 1500;
  const windows = [{ ci: 1000, co: 2000, numRooms: 1000 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 1000, "Large room counts should work");
});

// Test 12: Zero numRooms (edge case, shouldn't happen in production)
testCase("Zero numRooms is counted", () => {
  const dateMs = 1500;
  const windows = [{ ci: 1000, co: 2000, numRooms: 0 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 0, "Zero rooms should contribute 0 to sum");
});

// ════════════════════════════════════════════════════════════════
// STRUCTURAL VALIDATION TESTS (production code guards)
// ════════════════════════════════════════════════════════════════

console.log("\n--- Structural Validation Tests ---\n");

// Validate that only ONE canonical occupancy implementation exists
testCase("Canonical implementation: occupancy.js exists, occupancy.ts does NOT exist", () => {
  const jsPath = path.join(__dirname, "../lib/pricing/occupancy.js");
  const tsPath = path.join(__dirname, "../lib/pricing/occupancy.ts");

  assert(
    fs.existsSync(jsPath),
    "occupancy.js (canonical implementation) must exist"
  );
  assert(
    !fs.existsSync(tsPath),
    "occupancy.ts must NOT exist (only one canonical implementation allowed)"
  );
});

// Validate that production route DOES NOT have .catch(() => []) on occupancy query
testCase("Production route: no .catch(() => []) on occupancy pagination query", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");

  // Find the pagination loop section
  const paginationSection = routeContent.substring(
    routeContent.indexOf("while (hasMore)"),
    routeContent.indexOf("if (bidsWithRequests.length === 0)")
  );

  assert(
    !paginationSection.includes(".catch(() => [])"),
    "Pagination query must NOT have .catch(() => []) — errors must propagate"
  );
});

// Validate that production route uses !inner join syntax
testCase("Production route: uses bid_requests!inner(...) for INNER join", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "bid_requests!inner(",
    "Route must use !inner syntax for INNER join semantics"
  );
});

// Validate that production route filters by checkOut >= today at database level
testCase("Production route: filters bid_requests.checkOut at database level", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "&bid_requests.checkOut=gte.",
    "Route must filter bid_requests.checkOut >= today at database level"
  );
});

// Validate that production route has deterministic pagination without hardcoded 5000 limit
testCase("Production route: uses OCCUPANCY_PAGE_SIZE constant (no hardcoded 5000)", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "const OCCUPANCY_PAGE_SIZE = 500;",
    "Route must define OCCUPANCY_PAGE_SIZE constant"
  );
  assert(
    !routeContent.includes("limit=5000"),
    "Route must NOT have hardcoded limit=5000"
  );
  assertStringIncludes(
    routeContent,
    "pageOffset += OCCUPANCY_PAGE_SIZE",
    "Route must implement pagination loop with offset"
  );
});

// Validate that production route has null requestId preflight check
testCase("Production route: has fail-closed preflight null requestId check", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "requestId=is.null",
    "Route must have preflight check for null requestId"
  );
  assertStringIncludes(
    routeContent,
    "Occupancy integrity violation",
    "Route must throw on integrity violation"
  );
});

// Validate that production route imports the actual occupancy helper
testCase("Production route: imports calculateOccupancyForDate from occupancy module", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    'import { calculateOccupancyForDate }',
    "Route must import calculateOccupancyForDate from occupancy module"
  );
});

// Validate that production route uses the imported helper, not inline logic
testCase("Production route: uses imported calculateOccupancyForDate helper", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "calculateOccupancyForDate(hotelBids, dt.ms)",
    "Route must call the imported calculateOccupancyForDate helper"
  );
});

// Validate that numRooms normalization uses Math.max to prevent non-positive values
testCase("Production route: normalizes numRooms with Math.max(1, ...)", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "Math.max(1, Number(b.numRooms)",
    "Route must use Math.max(1, ...) for numRooms normalization"
  );
});

// Validate that ratio semantics remain hotel-level (not per-room)
testCase("Production route: applies vacancy ratio at hotel level", () => {
  const routePath = path.join(__dirname, "../app/api/cron/price-spine/route.ts");
  const routeContent = fs.readFileSync(routePath, "utf8");
  assertStringIncludes(
    routeContent,
    "occupied / totalUnits",
    "Route must calculate vacancy ratio at hotel level (occupied / totalUnits)"
  );
});

// ════════════════════════════════════════════════════════════════

console.log("\n✓ All occupancy tests passed!");
console.log("✓ All structural validations passed!");
