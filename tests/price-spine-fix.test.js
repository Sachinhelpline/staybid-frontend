// Price Spine Correctness Fix — Unit & Integration Tests
// Tests the corrected price-spine occupancy calculation with FK-joined bid_requests.

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const FALLBACK_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const KEY = process.env.SUPABASE_JWT_ANON || FALLBACK_ANON;

const headers = () => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
});

function dayStr(d) {
  return d.toISOString().slice(0, 10);
}

// Pure occupancy calculation (matches the fixed code)
function computeOccupancyFromBids(hotelBids, dateMs) {
  let occupied = 0;
  for (const w of hotelBids) {
    if (w.ci <= dateMs && dateMs < w.co) {
      occupied += w.numRooms; // Multi-room support
    }
  }
  return occupied;
}

async function testOccupancyCalculation() {
  console.log("\n=== TEST 1: Occupancy Calculation with Multi-Room Bids ===");

  // Simulate bid windows with multi-room support
  const hotelBids = [
    {
      ci: Date.parse("2026-08-15"),
      co: Date.parse("2026-08-17"),
      numRooms: 2, // Multi-room bid
    },
    {
      ci: Date.parse("2026-08-16"),
      co: Date.parse("2026-08-18"),
      numRooms: 1, // Single-room (default)
    },
  ];

  // Test dates and expected occupancy
  const tests = [
    { date: "2026-08-14", expected: 0, desc: "Before any bids" },
    { date: "2026-08-15", expected: 2, desc: "First date: only 2-room bid overlaps" },
    { date: "2026-08-16", expected: 3, desc: "Both bids overlap: 2+1=3 rooms" },
    { date: "2026-08-17", expected: 1, desc: "Only 1-room bid overlaps" },
    { date: "2026-08-18", expected: 0, desc: "After all bids" },
  ];

  let passed = 0;
  for (const test of tests) {
    const dateMs = Date.parse(test.date);
    const occupied = computeOccupancyFromBids(hotelBids, dateMs);
    const ok = occupied === test.expected;
    const status = ok ? "✓" : "✗";
    console.log(
      `${status} ${test.date}: expected=${test.expected}, got=${occupied} (${test.desc})`
    );
    if (ok) passed++;
  }

  console.log(`Result: ${passed}/${tests.length} passed`);
  return passed === tests.length;
}

async function testHotelLevelAggregation() {
  console.log("\n=== TEST 2: Hotel-Level Units Aggregation ===");

  // Simulate hotel units across multiple rooms
  const rooms = [
    { hotelId: "h1", quantity: 3 },
    { hotelId: "h1", quantity: 2 },
    { hotelId: "h1", quantity: 1 }, // Total: 6 units at h1
    { hotelId: "h2", quantity: 4 }, // Total: 4 units at h2
  ];

  const unitsOf = {};
  for (const r of rooms) {
    unitsOf[r.hotelId] = (unitsOf[r.hotelId] || 0) + (Number(r.quantity) || 1);
  }

  const tests = [
    { hotelId: "h1", expected: 6 },
    { hotelId: "h2", expected: 4 },
  ];

  let passed = 0;
  for (const test of tests) {
    const total = unitsOf[test.hotelId];
    const ok = total === test.expected;
    const status = ok ? "✓" : "✗";
    console.log(`${status} ${test.hotelId}: expected=${test.expected}, got=${total}`);
    if (ok) passed++;
  }

  console.log(`Result: ${passed}/${tests.length} passed`);
  return passed === tests.length;
}

async function testFkQueryIntegrity() {
  console.log("\n=== TEST 3: FK Query Integrity (Real Supabase) ===");

  try {
    // Query actual production data to verify FK relationship works
    const OCCUPIED_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
    const query = `select=id,hotelId,requestId,status,numRooms,bid_requests(id,checkIn,checkOut)&status=in.(${OCCUPIED_STATUSES.join(
      ","
    )})&limit=10`;
    const url = `${SUPABASE_URL}/rest/v1/bids?${query}`;

    console.log("Loading bids with FK-joined bid_requests...");
    const res = await fetch(url, { headers: headers() });

    if (!res.ok) {
      console.log(`✗ FK query failed: ${res.status}`);
      const text = await res.text();
      console.log("Error:", text.substring(0, 200));
      return false;
    }

    const bidsWithRequests = await res.json();
    console.log(`✓ FK query succeeded, loaded ${bidsWithRequests.length} bids`);

    // Verify all returned bids have valid requestIds and bid_requests
    let validCount = 0;
    let invalidCount = 0;

    for (const b of bidsWithRequests) {
      if (!b.requestId) {
        console.log(`✗ Bid ${b.id} has null requestId`);
        invalidCount++;
        continue;
      }

      if (!b.bid_requests) {
        console.log(`✗ Bid ${b.id} has no linked bid_requests`);
        invalidCount++;
        continue;
      }

      const req = b.bid_requests;
      if (!req.checkIn || !req.checkOut) {
        console.log(
          `✗ Bid ${b.id} bid_requests has invalid dates: ${req.checkIn}/${req.checkOut}`
        );
        invalidCount++;
        continue;
      }

      const ci = Date.parse(req.checkIn);
      const co = Date.parse(req.checkOut);
      if (!Number.isFinite(ci) || !Number.isFinite(co)) {
        console.log(`✗ Bid ${b.id} date parse failed`);
        invalidCount++;
        continue;
      }

      validCount++;
    }

    console.log(
      `✓ Integrity check: ${validCount} valid, ${invalidCount} invalid (expected: 0 invalid)`
    );
    return invalidCount === 0;
  } catch (e) {
    console.error(`✗ Test error: ${e.message}`);
    return false;
  }
}

async function testFailClosedBehavior() {
  console.log("\n=== TEST 4: Fail-Closed Behavior (Expected Errors) ===");

  // Test 1: Old query (nonexistent columns) should return 400
  console.log("Test 4.1: Verifying old query fails with 400...");
  const oldQuery = `select=hotelId,checkIn,checkOut,status&limit=1`;
  const oldUrl = `${SUPABASE_URL}/rest/v1/bids?${oldQuery}`;
  const res1 = await fetch(oldUrl, { headers: headers() });

  const test1Pass = res1.status === 400;
  const status1 = test1Pass ? "✓" : "✗";
  console.log(`${status1} Old query status=${res1.status} (expected 400)`);

  // Test 2: New query with future filter should succeed
  console.log("Test 4.2: Verifying new FK query succeeds...");
  const OCCUPIED_STATUSES = ["ACCEPTED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
  const newQuery = `select=id,hotelId,requestId,status,numRooms,bid_requests(id,checkIn,checkOut)&status=in.(${OCCUPIED_STATUSES.join(
    ","
  )})&limit=5`;
  const newUrl = `${SUPABASE_URL}/rest/v1/bids?${newQuery}`;
  const res2 = await fetch(newUrl, { headers: headers() });

  const test2Pass = res2.status === 200;
  const status2 = test2Pass ? "✓" : "✗";
  console.log(`${status2} New FK query status=${res2.status} (expected 200)`);

  console.log(
    `Result: ${(test1Pass && test2Pass ? 2 : 0)}/2 passed (old fails, new succeeds)`
  );
  return test1Pass && test2Pass;
}

async function runAllTests() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     PRICE SPINE v735 CORRECTNESS FIX — TEST SUITE         ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  const results = [];

  results.push(await testOccupancyCalculation());
  results.push(await testHotelLevelAggregation());
  results.push(await testFkQueryIntegrity());
  results.push(await testFailClosedBehavior());

  const passed = results.filter((r) => r).length;
  const total = results.length;

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log(`║ FINAL RESULT: ${passed}/${total} test suites passed`.padEnd(61) + "║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  return passed === total;
}

runAllTests().then((ok) => {
  process.exit(ok ? 0 : 1);
});
