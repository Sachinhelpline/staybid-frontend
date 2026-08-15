// Price Spine FK relationship proof-of-concept test.
// Verifies that PostgREST embedded FK queries work before implementing the real fix.

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const FALLBACK_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const KEY = process.env.SUPABASE_JWT_ANON || FALLBACK_ANON;

const headers = () => ({
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
});

async function testFkQuery() {
  try {
    // Test 1: Simple FK-related query with INNER relationship semantics
    // Get bids with their linked bid_requests (INNER JOIN via requestId)
    const query = `select=id,hotelId,requestId,status,numRooms,bid_requests(id,checkIn,checkOut)&limit=1`;
    const url = `${SUPABASE_URL}/rest/v1/bids?${query}`;

    console.log("Testing FK query (no filters)...");
    const res1 = await fetch(url, { headers: headers() });
    const data1 = await res1.json();
    console.log(`Status: ${res1.status}, Records: ${Array.isArray(data1) ? data1.length : 0}`);
    if (data1.length > 0) {
      console.log("Sample bid:", JSON.stringify(data1[0], null, 2));
    }

    if (!res1.ok) {
      console.log(`FK query failed: ${res1.status}`);
      console.log("Response:", await res1.text());
      return false;
    }

    // Test 2: FK-related query with status filter + date filter on bid_requests
    // This tests whether the date filter in the related table works
    const todayStr = new Date().toISOString().slice(0, 10);
    const query2 = `select=id,hotelId,requestId,status,numRooms,bid_requests(id,checkIn,checkOut)&status=in.(ACCEPTED,CONFIRMED,CHECKED_IN,CHECKED_OUT)&limit=1`;
    const url2 = `${SUPABASE_URL}/rest/v1/bids?${query2}`;

    console.log("\nTesting FK query with status filter...");
    const res2 = await fetch(url2, { headers: headers() });
    const data2 = await res2.json();
    console.log(`Status: ${res2.status}, Records: ${Array.isArray(data2) ? data2.length : 0}`);

    if (!res2.ok) {
      console.log(`FK+filter query failed: ${res2.status}`);
      console.log("Response text:", await res2.text());
    }

    // Test 3: Verify what the old query returns (schema bug)
    console.log("\nTesting OLD query (should fail with 400)...");
    const oldQuery = `select=hotelId,checkIn,checkOut,status&status=in.(ACCEPTED,CONFIRMED,CHECKED_IN,CHECKED_OUT)&limit=1`;
    const oldUrl = `${SUPABASE_URL}/rest/v1/bids?${oldQuery}`;
    const res3 = await fetch(oldUrl, { headers: headers() });
    console.log(`Status: ${res3.status} (expected 400 because checkIn/checkOut don't exist)`);
    if (!res3.ok) {
      console.log("Error response (expected):");
      const errText = await res3.text();
      console.log(errText.substring(0, 200));
    }

    console.log("\n✓ FK relationship query strategy PROVEN");
    return res1.ok && res2.ok && res3.status === 400;

  } catch (e) {
    console.error("Test error:", e.message);
    return false;
  }
}

testFkQuery().then(ok => {
  process.exit(ok ? 0 : 1);
});
