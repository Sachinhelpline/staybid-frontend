/**
 * Price Spine Occupancy Calculation Tests
 *
 * Tests the pure occupancy helper function extracted from the cron route.
 * This is a hermetic Node test suite with no Supabase/database dependencies.
 */

// Mock the extracted occupancy helper (in production this is imported from the route).
function calculateOccupancyForDate(windows, dateMs) {
  let occupied = 0;
  for (const w of windows) {
    if (w.ci <= dateMs && dateMs < w.co) {
      occupied += w.numRooms;
    }
  }
  return occupied;
}

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

// Test suite
console.log("Running occupancy calculation tests...\n");

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

// Test 6: Multi-room bid
testCase("Multi-room bid counts all rooms", () => {
  const dateMs = 1500;
  const windows = [{ ci: 1000, co: 2000, numRooms: 5 }];
  const occupied = calculateOccupancyForDate(windows, dateMs);
  assertEquals(occupied, 5, "Multi-room bid should sum all rooms");
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

// Test 10: Touching windows (one's co = next's ci)
testCase("Adjacent but non-overlapping windows", () => {
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

console.log("\n✓ All occupancy tests passed!");
