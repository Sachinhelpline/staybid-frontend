#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// STAY-LIFECYCLE-OPS-01 M7 — OTA batch conflict ISOLATION (real syncFeed control flow).
//   Run: node tests/social/ota-conflict-isolation.test.js
// Compiles the REAL lib/channels/sync.ts + its deps with the lockfile tsc and drives
// syncFeed() against a stubbed global.fetch that emulates the room_blocks guard trigger
// (migration v753): a multi-row batch INSERT that includes a conflicting PINNED event is
// refused whole (unit_conflict); per-event inserts succeed for the valid events and refuse
// only the conflicting one. Proves: a bad OTA event does NOT block unrelated valid ones,
// the conflict is recorded (base.conflicts) + counted in skipped, reconciliation still runs
// (no early abort), a retry is idempotent (no duplicate), and an UNPINNED feed is unaffected.
// The DB-level premise (batch rolls back whole; per-event isolates) is proven separately
// against REAL PostgreSQL in tests/concurrency/stay-unit-assignment.pg.test.js (test R).
// ZERO live network. Exit code AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process"), Module = require("module");
const REPO = path.resolve(__dirname, "..", ".."), REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null;
const failures = [];
const ok = (c, l) => { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } };
const eqv = (a, b, l) => ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const FILES = {
  "sync.ts": "lib/channels/sync.ts",
  "availability.ts": "lib/availability.ts",
  "notify-server.ts": "lib/notify-server.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "sb.ts": "lib/sb.ts",
};
const ALIAS = {
  "@/lib/sb-server": "sb-server",
  "@/lib/availability": "availability",
  "@/lib/notify-server": "notify-server",
  "@/lib/sb": "sb",
};

const VCAL = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT", "UID:A", "DTSTART:20290501", "DTEND:20290503", "SUMMARY:Reservation A", "END:VEVENT",
  "BEGIN:VEVENT", "UID:B", "DTSTART:20290512", "DTEND:20290514", "SUMMARY:Reservation B", "END:VEVENT",
  "BEGIN:VEVENT", "UID:C", "DTSTART:20290520", "DTEND:20290522", "SUMMARY:Reservation C", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-ota-m7-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    const paths = { "*": [path.join(REPO, "node_modules/*")] };
    for (const [spec, base] of Object.entries(ALIAS)) paths[spec] = ["./" + base];
    fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        module: "commonjs", target: "es2020", lib: ["es2020", "dom"], moduleResolution: "node", strict: true,
        esModuleInterop: true, skipLibCheck: true, ignoreDeprecations: "6.0", baseUrl: ".",
        typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], paths, rootDir: ".", outDir: "../out", noEmitOnError: true,
      },
      include: ["*.ts"],
    }));
    const TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] });
    const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
    if (compile.status !== 0) throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
    console.log("• Local tsc compile: exit 0, clean (strict) — lib/channels/sync.ts + deps");

    process.env.SUPABASE_SERVICE_ROLE_KEY = "m7_test_service_role_key";
    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request)) return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };
    const SYNC = require(path.join(OUT, "sync.js"));

    // ── scenario-driven fetch stub (emulates the room_blocks guard trigger) ──
    let EXISTING = [];          // room_blocks rows already imported for this feed
    let PINNED = true;          // feed pins a unit (guard applies) vs category-level (no guard)
    const INSERTED = [];        // externalRefs successfully inserted
    const PATCHED = [];         // markFeed patches
    const jsonRes = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => (typeof data === "string" ? data : JSON.stringify(data)), headers: { get: () => null } });
    const savedFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url), method = (opts && opts.method) || "GET";
      let body = null; try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch {}
      if (u.startsWith("https://ics.example.com")) return jsonRes(VCAL); // the iCal feed
      const m = /\/rest\/v1\/([a-z_]+)/.exec(u); const table = m ? m[1] : "";
      if (table === "room_blocks") {
        if (method === "GET") return jsonRes(EXISTING); // existing-blocks read (feedId=eq)
        if (method === "DELETE") return jsonRes([]);     // reconcile
        if (method === "POST") {
          const rows = Array.isArray(body) ? body : [body];
          const conflictRow = (r) => PINNED && r.assignedUnitId && String(r.externalRef) === "B";
          if (rows.length > 1) {
            // batch: the guard refuses the WHOLE statement if ANY pinned row conflicts
            if (rows.some(conflictRow)) return jsonRes({ code: "P0001", message: "unit_conflict", details: "B" }, 409);
            rows.forEach((r) => INSERTED.push(String(r.externalRef)));
            return jsonRes(rows, 201);
          }
          // per-event
          const r = rows[0];
          if (conflictRow(r)) return jsonRes({ code: "P0001", message: "unit_conflict", details: "B" }, 409);
          INSERTED.push(String(r.externalRef));
          return jsonRes([r], 201);
        }
      }
      if (table === "ota_feeds" && method === "PATCH") { PATCHED.push(body); return jsonRes([]); }
      if (table === "channel_sync_logs") return jsonRes([{ id: "csl_1" }], 201);
      if (table === "notification_queue") return jsonRes([{ id: "n1" }], 201);
      // hotels / hotel_room_units / bids / anything else the overbooking + notify paths read
      return jsonRes([]);
    };

    const feed = (unitId) => ({ id: "feed_m7", icalUrl: "https://ics.example.com/f.ics", hotelId: "H1", roomId: "R1", provider: "airbnb", unitId, connectionId: null, consecutiveFailures: 0 });

    // ── run 1: pinned feed, first sync, B conflicts with an existing occupation ──
    EXISTING = []; PINNED = true; INSERTED.length = 0; PATCHED.length = 0;
    let res = await SYNC.syncFeed(feed("u_pin"), "cron");
    eqv(res.ok, true, "M7.1 run completes ok despite a conflicting event (no early abort)");
    eqv(res.status, "ok", "M7.1s status ok");
    eqv(res.imported, 2, "M7.2 exactly the two VALID events (A, C) imported");
    eqv(res.conflicts, 1, "M7.3 the one conflicting event (B) recorded in conflicts");
    eqv(res.skipped, 1, "M7.3s the conflict is accounted in skipped (totalEvents − imported)");
    ok(INSERTED.includes("A") && INSERTED.includes("C") && !INSERTED.includes("B"), "M7.4 A + C inserted, B NOT");
    ok(PATCHED.length > 0 && PATCHED[0].consecutiveFailures === 0, "M7.5 feed marked healthy (consecutiveFailures reset — a conflict is NOT a feed failure)");

    // ── run 2: retry — A + C already imported → only B re-attempted, still refused, NO duplicate ──
    EXISTING = [{ id: "rb_A", externalRef: "A", toDate: "2029-05-03", source: "ota_ical" }, { id: "rb_C", externalRef: "C", toDate: "2029-05-22", source: "ota_ical" }];
    PINNED = true; INSERTED.length = 0;
    res = await SYNC.syncFeed(feed("u_pin"), "cron");
    eqv(res.ok, true, "M7.6 retry completes ok");
    eqv(res.imported, 0, "M7.7 retry imports nothing new (A, C already present — idempotent)");
    eqv(res.conflicts, 1, "M7.8 B still recorded as a conflict on retry");
    ok(!INSERTED.includes("A") && !INSERTED.includes("C"), "M7.9 no duplicate insert of A/C on retry (externalRef dedup)");

    // ── run 3: UNPINNED (category-level) feed — the guard does not apply, all import ──
    EXISTING = []; PINNED = false; INSERTED.length = 0;
    res = await SYNC.syncFeed(feed(null), "cron");
    eqv(res.imported, 3, "M7.10 an unpinned/category feed imports all events (guard-irrelevant)");
    eqv(res.conflicts || 0, 0, "M7.11 no conflicts for an unpinned feed");
    ok(INSERTED.includes("A") && INSERTED.includes("B") && INSERTED.includes("C"), "M7.12 A + B + C all imported unpinned");

    // ── run 4: a GENUINE systemic error still fails honestly (not swallowed as a conflict) ──
    EXISTING = []; PINNED = true; INSERTED.length = 0;
    const fetch3 = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url), method = (opts && opts.method) || "GET";
      if (/\/rest\/v1\/room_blocks/.test(u) && method === "POST") return jsonRes({ message: "500 internal" }, 500); // non-integrity failure
      return fetch3(url, opts);
    };
    res = await SYNC.syncFeed(feed("u_pin"), "cron");
    global.fetch = fetch3;
    eqv(res.ok, false, "M7.13 a genuine (non-conflict) insert error fails honestly");
    eqv(res.status, "error", "M7.13s status error");

    global.fetch = savedFetch;
    Module._resolveFilename = origResolve;
  } catch (err) {
    fatal = err;
    console.error("\n• FATAL: " + (err && err.message ? err.message : String(err)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log("\n• RESULT");
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2;
  else if (fail > 0) process.exitCode = 1;
  else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
