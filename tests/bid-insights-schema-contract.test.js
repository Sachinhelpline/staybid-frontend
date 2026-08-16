// Hermetic static schema contract test for bid-insights and flash-near routes
// Plain Node.js, no external dependencies, no database access
// Verifies: no dead schema columns, correct bid_status_log usage, no fallback probes

const fs = require("fs");
const path = require("path");

function testCase(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    process.exitCode = 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(str, substring, message) {
  if (!str.includes(substring)) {
    throw new Error(message || `Expected string to include: ${substring}`);
  }
}

function assertNotIncludes(str, substring, message) {
  if (str.includes(substring)) {
    throw new Error(message || `Expected string NOT to include: ${substring}`);
  }
}

// Read source files
const insightsPath = path.join(__dirname, "..", "app", "api", "bids", "insights", "route.ts");
const flashPath = path.join(__dirname, "..", "app", "api", "flash", "near", "route.ts");

const insightsSrc = fs.readFileSync(insightsPath, "utf-8");
const flashSrc = fs.readFileSync(flashPath, "utf-8");

console.log("=== BID-INSIGHTS SCHEMA CONTRACT TESTS ===\n");

// Bid Insights Tests
testCase("bid-insights: route has NO bids.updatedAt references", () => {
  assertNotIncludes(
    insightsSrc,
    "bids.updatedAt",
    "Route must not query bids.updatedAt (column does not exist)"
  );
});

testCase("bid-insights: route uses bid_status_log for acceptance timing", () => {
  assertIncludes(
    insightsSrc,
    "bid_status_log",
    "Route must use bid_status_log to find accepted bids"
  );
  assertIncludes(
    insightsSrc,
    "changed_at",
    "Route must use changed_at from bid_status_log for timing"
  );
});

testCase("bid-insights: route does NOT use bid_status_log!inner (no FK join)", () => {
  assertNotIncludes(
    insightsSrc,
    "bid_status_log!inner",
    "Route must NOT use embedded !inner join (no FK relationship)"
  );
});

testCase("bid-insights: queries bid_status_log with new_status=eq.ACCEPTED", () => {
  assertIncludes(
    insightsSrc,
    'new_status=eq.ACCEPTED',
    "Route must filter bid_status_log for accepted status only"
  );
});

testCase("bid-insights: fetches bid details separately (bounded batch)", () => {
  assertIncludes(
    insightsSrc,
    "bids?id=in.",
    "Route must fetch bid details via separate bounded query"
  );
});

testCase("bid-insights: acceptedToday does NOT append hotelFilter to bid_status_log", () => {
  // acceptedToday must fetch logs first, then bids separately with city filtering post-lookup
  const acceptedTodaySection = insightsSrc.substring(insightsSrc.indexOf("acceptedToday"));
  const acceptedTodayEnd = acceptedTodaySection.indexOf("// Hot streak");
  const acceptedTodayCode = acceptedTodaySection.substring(0, acceptedTodayEnd);
  assertNotIncludes(
    acceptedTodayCode,
    "hotelFilter",
    "acceptedToday must not append hotelFilter to bid_status_log URL"
  );
  assertIncludes(
    acceptedTodayCode,
    "bid_status_log?new_status=eq.ACCEPTED",
    "acceptedToday must query bid_status_log with new_status filter"
  );
});

testCase("bid-insights: cityHotStreak does NOT append hotelFilter to bid_status_log", () => {
  // cityHotStreak must fetch logs first, then bids separately with city filtering post-lookup
  const streakSection = insightsSrc.substring(insightsSrc.indexOf("cityHotStreak"));
  const streakEnd = streakSection.indexOf("// Recent wins");
  const streakCode = streakSection.substring(0, streakEnd);
  assertNotIncludes(
    streakCode,
    "hotelFilter",
    "cityHotStreak must not append hotelFilter to bid_status_log URL"
  );
  assertIncludes(
    streakCode,
    "bid_status_log?new_status=eq.ACCEPTED",
    "cityHotStreak must query bid_status_log with new_status filter"
  );
});

testCase("bid-insights: recentWins retains status=eq.ACCEPTED on bid lookup", () => {
  assertIncludes(
    insightsSrc,
    "bids?id=in.",
    "recentWins must fetch bid details"
  );
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  assertIncludes(
    winsCode,
    "status=eq.ACCEPTED",
    "recentWins must retain status=eq.ACCEPTED filter on bid lookup"
  );
});

testCase("bid-insights: avgAcceptMins retains status=eq.ACCEPTED on bid lookup", () => {
  const speedSection = insightsSrc.substring(insightsSrc.indexOf("Avg accept"));
  const speedEnd = speedSection.indexOf("return {");
  const speedCode = speedSection.substring(0, speedEnd);
  assertIncludes(
    speedCode,
    "status=eq.ACCEPTED",
    "avgAcceptMins must retain status=eq.ACCEPTED filter on bid lookup"
  );
});

testCase("bid-insights: explicit isCityScoped branching exists", () => {
  assertIncludes(
    insightsSrc,
    "isCityScoped",
    "Route must use explicit isCityScoped variable for city/no-city distinction"
  );
});

testCase("bid-insights: acceptedToday guards against empty bid ID list", () => {
  const atSection = insightsSrc.substring(insightsSrc.indexOf("acceptedToday"));
  const atEnd = atSection.indexOf("// Hot streak");
  const atCode = atSection.substring(0, atEnd);
  assertIncludes(
    atCode,
    "if (atBidIds.length > 0)",
    "acceptedToday must guard before id=in.(...) query"
  );
});

testCase("bid-insights: cityHotStreak guards against empty bid ID list", () => {
  const streakSection = insightsSrc.substring(insightsSrc.indexOf("cityHotStreak"));
  const streakEnd = streakSection.indexOf("// Recent wins");
  const streakCode = streakSection.substring(0, streakEnd);
  assertIncludes(
    streakCode,
    "if (streakBidIds.length > 0)",
    "cityHotStreak must guard before id=in.(...) query"
  );
});

testCase("bid-insights: recentWins guards against empty bid ID list", () => {
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  assertIncludes(
    winsCode,
    "if (newBidIds.length > 0)",
    "recentWins must guard before id=in.(...) query"
  );
});

testCase("bid-insights: avgAcceptMins guards against empty bid ID list", () => {
  const speedSection = insightsSrc.substring(insightsSrc.indexOf("Avg accept"));
  const speedEnd = speedSection.indexOf("return {");
  const speedCode = speedSection.substring(0, speedEnd);
  assertIncludes(
    speedCode,
    "if (newSpeedBidIds.length > 0)",
    "avgAcceptMins must guard before id=in.(...) query"
  );
});

testCase("bid-insights: acceptedToday uses pagination (offset/limit)", () => {
  const atSection = insightsSrc.substring(insightsSrc.indexOf("acceptedToday"));
  const atEnd = atSection.indexOf("// Hot streak");
  const atCode = atSection.substring(0, atEnd);
  assertIncludes(
    atCode,
    "offset=",
    "acceptedToday must paginate with offset parameter"
  );
  assertIncludes(
    atCode,
    "limit=",
    "acceptedToday must use limit parameter for page size"
  );
});

testCase("bid-insights: cityHotStreak uses pagination (offset/limit)", () => {
  const streakSection = insightsSrc.substring(insightsSrc.indexOf("Hot streak"));
  const streakEnd = streakSection.indexOf("// Recent wins");
  const streakCode = streakSection.substring(0, streakEnd);
  assertIncludes(
    streakCode,
    "offset=",
    "cityHotStreak must paginate with offset parameter"
  );
  assertIncludes(
    streakCode,
    "limit=",
    "cityHotStreak must use limit parameter for page size"
  );
});

testCase("bid-insights: recentWins uses pagination with stop condition", () => {
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  assertIncludes(
    winsCode,
    "offset=",
    "recentWins must paginate with offset parameter"
  );
  assertIncludes(
    winsCode,
    "winsTarget",
    "recentWins must have a stop condition target"
  );
});

testCase("bid-insights: avgAcceptMins uses pagination with stop condition", () => {
  const speedSection = insightsSrc.substring(insightsSrc.indexOf("Avg accept"));
  const speedEnd = speedSection.indexOf("return {");
  const speedCode = speedSection.substring(0, speedEnd);
  assertIncludes(
    speedCode,
    "offset=",
    "avgAcceptMins must paginate with offset parameter"
  );
  assertIncludes(
    speedCode,
    "speedTarget",
    "avgAcceptMins must have a stop condition target"
  );
});

testCase("bid-insights: uses deduplication by bid_id", () => {
  assertIncludes(
    insightsSrc,
    "deduplicateLogsByBidId",
    "Route must deduplicate bid IDs by retaining newest event"
  );
});

testCase("bid-insights: chunks bid-ID lookups into safe batches", () => {
  assertIncludes(
    insightsSrc,
    "chunk",
    "Route must chunk bid-ID requests into bounded batches"
  );
  assertIncludes(
    insightsSrc,
    "BID_CHUNK_SIZE",
    "Route must define BID_CHUNK_SIZE constant for URL safety"
  );
});

testCase("bid-insights: recentWins stops on eligible wins collected (eligibility-driven)", () => {
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  // Verify the loop condition tracks eligibleWinCandidates.length, not raw log count
  assertIncludes(
    winsCode,
    "eligibleWinCandidates.length < winsTarget",
    "recentWins must continue fetching pages until eligible candidates collected inside loop"
  );
  // Verify it does NOT use raw log count: allWinsLogs.length < winsTarget * 2
  assertNotIncludes(
    winsCode,
    "allWinsLogs.length",
    "recentWins must not use raw log count as loop stop condition"
  );
});

testCase("bid-insights: avgAcceptMins stops on valid samples collected (eligibility-driven)", () => {
  const speedSection = insightsSrc.substring(insightsSrc.indexOf("Avg accept"));
  const speedEnd = speedSection.indexOf("return {");
  const speedCode = speedSection.substring(0, speedEnd);
  // Verify the loop condition tracks speeds.length, not raw log count
  assertIncludes(
    speedCode,
    "speeds.length < speedTarget",
    "avgAcceptMins must continue fetching pages until valid speeds.length >= speedTarget"
  );
  // Verify it does NOT use raw log count: allSpeedLogs.length < speedTarget * 2
  assertNotIncludes(
    speedCode,
    "allSpeedLogs.length",
    "avgAcceptMins must not use raw log count as loop stop condition"
  );
});

testCase("bid-insights: recentWins uses Set for deduplication across pages", () => {
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  assertIncludes(
    winsCode,
    "seenWinsBidIds",
    "recentWins must track seen bid IDs across pages in a Set"
  );
});

testCase("bid-insights: avgAcceptMins uses Set for deduplication across pages", () => {
  const speedSection = insightsSrc.substring(insightsSrc.indexOf("Avg accept"));
  const speedEnd = speedSection.indexOf("return {");
  const speedCode = speedSection.substring(0, speedEnd);
  assertIncludes(
    speedCode,
    "seenSpeedBidIds",
    "avgAcceptMins must track seen bid IDs across pages in a Set"
  );
});

testCase("bid-insights: no one-shot limit=50 correctness cap in metric pagination", () => {
  // limit=50 is no longer used in recentWins or avgAcceptMins metrics
  assertNotIncludes(
    insightsSrc,
    "limit=50",
    "Metric pagination must not use fixed limit=50 as a correctness cap"
  );
});

testCase("bid-insights: no one-shot limit=100 correctness cap in metric pagination", () => {
  // limit=100 as a correctness cap is removed; LOG_PAGE_SIZE=100 is for pagination batching only
  // Verify that pagination uses LOG_PAGE_SIZE constant and no hardcoded limit=100
  const acceptLoopsSection = insightsSrc.substring(insightsSrc.indexOf("acceptedToday"));
  const acceptLoopsEnd = acceptLoopsSection.indexOf("// Hot streak");
  const acceptLoopsCode = acceptLoopsSection.substring(0, acceptLoopsEnd);
  assertIncludes(
    acceptLoopsCode,
    `limit=\${LOG_PAGE_SIZE}`,
    "acceptedToday must use limit=${LOG_PAGE_SIZE} for pagination"
  );
  // Check for literal &limit=100 (not substring of &limit=1000)
  // This would appear as &limit=100& or &limit=100` in a hardcoded query
  assertNotIncludes(
    acceptLoopsCode,
    "&limit=100&",
    "acceptedToday must not use literal &limit=100 correctness cap"
  );
});

testCase("bid-insights: has LOG_PAGE_SIZE constant for pagination", () => {
  assertIncludes(
    insightsSrc,
    "LOG_PAGE_SIZE",
    "Route must define LOG_PAGE_SIZE constant for consistent pagination"
  );
});

testCase("bid-insights: zero-curated-city fast path returns empty metrics", () => {
  assertIncludes(
    insightsSrc,
    "isCityScoped && hotelIdsInCity.length === 0",
    "Route must have fast path for zero-curated-city that returns early"
  );
  // Verify tonightAuctions is calculated BEFORE the fast path check
  const beforeFastPath = insightsSrc.substring(0, insightsSrc.indexOf("if (isCityScoped && hotelIdsInCity.length === 0)"));
  assertIncludes(
    beforeFastPath,
    "const tonightAuctions =",
    "tonightAuctions must be calculated before fast path check"
  );
  // Verify the fast path returns the real tonightAuctions variable (not literal 0)
  const fastPathStart = insightsSrc.indexOf("if (isCityScoped && hotelIdsInCity.length === 0)");
  const fastPathEnd = insightsSrc.indexOf("};", fastPathStart) + 2;
  const fastPathCode = insightsSrc.substring(fastPathStart, fastPathEnd);
  assertIncludes(
    fastPathCode,
    "tonightAuctions,",
    "Fast path must return real tonightAuctions variable (not literal 0)"
  );
  assertNotIncludes(
    fastPathCode,
    "tonightAuctions: 0",
    "Fast path must not return literal tonightAuctions: 0"
  );
  // Verify the fast path returns empty arrays and zero values for other metrics
  assertIncludes(
    fastPathCode,
    "acceptedToday: 0,",
    "Fast path must return acceptedToday: 0 for zero-curated-city"
  );
  assertIncludes(
    fastPathCode,
    "cityHotStreak: 0,",
    "Fast path must return cityHotStreak: 0 for zero-curated-city"
  );
  assertIncludes(
    fastPathCode,
    "avgAcceptMins: 0,",
    "Fast path must return avgAcceptMins: 0 for zero-curated-city"
  );
  assertIncludes(
    fastPathCode,
    "recentWins: [],",
    "Fast path must return recentWins: [] for zero-curated-city"
  );
  // Verify the fast path does NOT fetch bid_status_log or bids
  assertNotIncludes(
    fastPathCode,
    "bid_status_log",
    "Fast path must not fetch bid_status_log"
  );
  assertNotIncludes(
    fastPathCode,
    "/rest/v1/bids?",
    "Fast path must not fetch bids"
  );
});

testCase("bid-insights: recentWins uses batch hotel/user lookup (no per-winner id=eq)", () => {
  const winsSection = insightsSrc.substring(insightsSrc.indexOf("Recent wins"));
  const winsEnd = winsSection.indexOf("// Avg accept");
  const winsCode = winsSection.substring(0, winsEnd);
  // Verify batch lookup with id=in.(...) exists
  assertIncludes(
    winsCode,
    "id=in.(",
    "recentWins must use batch hotel/user lookup with id=in.(...)"
  );
  // Verify NO per-winner id=eq lookups
  assertNotIncludes(
    winsCode,
    "id=eq.${b.hotelId}",
    "recentWins must not use per-winner id=eq hotel lookup"
  );
  assertNotIncludes(
    winsCode,
    "id=eq.${b.customerId}",
    "recentWins must not use per-winner id=eq customer lookup"
  );
});

console.log("\n=== FLASH-NEAR SCHEMA CONTRACT TESTS ===\n");

// Flash Route Tests
testCase("flash-near: uses canonical isActive=eq.true", () => {
  assertIncludes(
    flashSrc,
    "isActive=eq.true",
    "Route must use canonical isActive=eq.true filter"
  );
});

testCase("flash-near: does NOT query is_active=eq.true", () => {
  assertNotIncludes(
    flashSrc,
    "is_active=eq.true",
    "Route must not probe for is_active column (fallback removed)"
  );
});

testCase("flash-near: does NOT query active=eq.true", () => {
  assertNotIncludes(
    flashSrc,
    "active=eq.true",
    "Route must not probe for active column (fallback removed)"
  );
});

testCase("flash-near: no fallback filter for multiple column names", () => {
  // Check that the old pattern of checking d?.isActive ?? d?.is_active ?? d?.active is gone
  assertNotIncludes(
    flashSrc,
    "d?.is_active",
    "Route must not have fallback filter for is_active"
  );
  assertNotIncludes(
    flashSrc,
    "d?.active",
    "Route must not have fallback filter for active"
  );
});

testCase("flash-near: empty canonical query result remains empty (no broad fallback)", () => {
  // Verify that the code doesn't fall back to querying without isActive filter
  const flashTries = flashSrc.substring(flashSrc.indexOf("const baseSelect"));
  const flashTries2 = flashTries.substring(0, flashTries.indexOf("const [hotels"));
  assertNotIncludes(
    flashTries2,
    "const tries",
    "Route must not have tries array with multiple fallback queries"
  );
});

if (process.exitCode === undefined) {
  console.log("\n✅ All schema contract tests passed");
}
