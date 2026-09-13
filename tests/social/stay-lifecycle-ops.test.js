#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// STAY-LIFECYCLE-OPS-01 — consolidated stay-lifecycle operations regression.
//   Run: node tests/social/stay-lifecycle-ops.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL hardened routes
// (partner check-in, check-out, room-unit assign) + their real deps with the
// lockfile tsc, then drives the real handlers against an in-memory PostgREST
// fake (simple filter grammar, every write captured per table). Also drives the
// pure shared libs (stay-dates, unit-assignments validators, booking-detail
// status, guest-contact, booking-payment-summary) and scans the UI / migration
// sources for the wiring contracts.
//
// Required coverage (owner list):
//   temporal: premature rejected · same-day accepted · late accepted · window
//   closed · dates unavailable fail-closed
//   units: missing units rejected · wrong-hotel / wrong-category / inactive /
//   conflicting rejected · N-room needs N distinct · legacy fallback
//   authority: forged / decode-only / id-only rejected · exact-hotel partner ok
//   checkout: only from CHECKED_IN+evidence · early checkout explicit+audited ·
//   valid checkout creates feedback/video/notification idempotently · invalid
//   creates ZERO downstream rows · notification insert contract (id present)
//   history: completed stay ordinary reassignment blocked · in-house transfer
//   explicit · unassign rules
//   display: CHECKED_OUT never "Upcoming" · email never tel: · unpaid value never
//   revenue
//   existing SEC-00B evidence contract preserved (run alongside the sec00b chain)
// Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path"),
  fs = require("fs"),
  os = require("os"),
  cp = require("child_process"),
  Module = require("module");
const REPO = path.resolve(__dirname, "..", "..");
const REPO_NM = path.join(REPO, "node_modules");
let pass = 0, fail = 0, fatal = null;
const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eqv(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const FILES = {
  "checkin-route.ts": "app/api/partner/checkin/[bidId]/route.ts",
  "checkout-route.ts": "app/api/partner/checkout/[bidId]/route.ts",
  "assign-route.ts": "app/api/partner/room-units/assign/route.ts",
  "supabase-admin.ts": "lib/onboard/supabase-admin.ts",
  "verified-partner-authority.ts": "lib/auth/verified-partner-authority.ts",
  "verified-partner-authority-factory.ts": "lib/auth/verified-partner-authority-factory.ts",
  "verified-partner-hotel-scope.ts": "lib/auth/verified-partner-hotel-scope.ts",
  "verified-stay-evidence.ts": "lib/stay/verified-stay-evidence.ts",
  "sb-server.ts": "lib/sb-server.ts",
  "stay-dates.ts": "lib/stay/stay-dates.ts",
  "unit-assignments.ts": "lib/stay/unit-assignments.ts",
  "booking-detail-status.ts": "lib/stay/booking-detail-status.ts",
  "guest-contact.ts": "lib/stay/guest-contact.ts",
  "booking-payment-summary.ts": "lib/stay/booking-payment-summary.ts",
};
const ALIAS = {
  "next/server": "next-server",
  "@/lib/onboard/supabase-admin": "supabase-admin",
  "@/lib/auth/verified-partner-authority": "verified-partner-authority",
  "@/lib/auth/verified-partner-authority-factory": "verified-partner-authority-factory",
  "@/lib/auth/verified-partner-hotel-scope": "verified-partner-hotel-scope",
  "@/lib/stay/verified-stay-evidence": "verified-stay-evidence",
  "@/lib/sb-server": "sb-server",
  "@/lib/stay/stay-dates": "stay-dates",
  "@/lib/stay/unit-assignments": "unit-assignments",
  "@/lib/stay/booking-detail-status": "booking-detail-status",
  "@/lib/stay/guest-contact": "guest-contact",
  "@/lib/stay/booking-payment-summary": "booking-payment-summary",
};
const NEXT_SERVER_STUB = `export type NextRequest = any;
export const NextResponse = {
  json(data: any, init?: { status?: number }) {
    return { status: (init && init.status) || 200, body: data } as any;
  },
};
`;

const PARTNER_SECRET = "slo_partner_access_secret_value";
const SVC_KEY = "slo_test_service_role_key";
const SUBJECT = "cmnr4b8ol0001whjy8jc1xxxh";
const HOTEL = "202601";
const OTHER_HOTEL = "999999";
const ROOM = "202601-r1";
const OTHER_ROOM = "202601-r2";
const CUSTOMER = "fb_l3fo3x6WvSfKdifEcSNr6BcwgOL2";

// ── tiny PostgREST filter grammar for the in-memory fake ─────────────────────
function applyFilters(rows, qs) {
  let out = rows.slice();
  const params = new URLSearchParams(qs);
  params.forEach((v, k) => {
    if (["select", "order", "limit", "on_conflict"].includes(k)) return;
    const m = /^(eq|neq|in|gt|gte|lt|lte)\.(.*)$/s.exec(v);
    if (!m) return;
    const op = m[1], val = m[2];
    out = out.filter((r) => {
      const cell = r[k] == null ? "" : String(r[k]);
      if (op === "eq") return cell === val;
      if (op === "neq") return cell !== val;
      if (op === "in") {
        const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => decodeURIComponent(x));
        return list.includes(cell);
      }
      const a = String(cell).slice(0, 10), b = String(val).slice(0, 10);
      if (op === "gt") return a > b; if (op === "gte") return a >= b; if (op === "lt") return a < b; return a <= b;
    });
  });
  return out;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-stay-ops-"));
  try {
    const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
    fs.mkdirSync(SRC, { recursive: true });
    for (const [dst, src] of Object.entries(FILES)) fs.copyFileSync(path.join(REPO, src), path.join(SRC, dst));
    fs.writeFileSync(path.join(SRC, "next-server.ts"), NEXT_SERVER_STUB);
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
    console.log("• Local tsc compile: exit 0, clean (strict) — checkin + checkout + assign routes + stay libs");

    process.env.JWT_ACCESS_SECRET = PARTNER_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SVC_KEY;
    process.env.NODE_PATH = REPO_NM;
    Module._initPaths();
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (Object.prototype.hasOwnProperty.call(ALIAS, request)) return path.join(OUT, ALIAS[request] + ".js");
      return origResolve.call(this, request, ...rest);
    };
    const CHECKIN = require(path.join(OUT, "checkin-route.js"));
    const CHECKOUT = require(path.join(OUT, "checkout-route.js"));
    const ASSIGN = require(path.join(OUT, "assign-route.js"));
    const SD = require(path.join(OUT, "stay-dates.js"));
    const UA = require(path.join(OUT, "unit-assignments.js"));
    const BDS = require(path.join(OUT, "booking-detail-status.js"));
    const GC = require(path.join(OUT, "guest-contact.js"));
    const BPS = require(path.join(OUT, "booking-payment-summary.js"));
    const jwt = require(path.join(REPO_NM, "jsonwebtoken"));

    const TODAY = SD.istDateISO();
    const D = (n) => SD.addDaysISO(TODAY, n);

    // ── in-memory DB + write capture ──────────────────────────────────────────
    const DB = {};
    const WRITES = {};
    let LINES_MISSING = false;     // simulate the lines table not applied yet
    let LINES_READ_FAIL = false;   // simulate a lines-table read failure (500)
    let LINES_EXCLUDE = false;     // simulate the DB EXCLUDE constraint refusing an insert (23P01 → 409)
    let REQUESTS_READ_FAIL = false;
    let NOTIF_INSERT_FAIL = false;
    const reset = () => {
      for (const k of Object.keys(DB)) delete DB[k];
      for (const k of Object.keys(WRITES)) delete WRITES[k];
      Object.assign(DB, {
        bids: [], bid_requests: [], hotel_room_units: [], bid_unit_assignment_lines: [], bid_unit_assignments: [],
        room_blocks: [], verified_partner_hotel_scope: [{ partner_subject: SUBJECT, hotel_id: HOTEL, status: "active" }],
        verified_stay_evidence: [], checkin_checkout_logs: [], notifications: [], feedback_tracking: [], video_lifecycle: [], vp_requests: [],
      });
      LINES_MISSING = false; LINES_READ_FAIL = false; LINES_EXCLUDE = false; REQUESTS_READ_FAIL = false; NOTIF_INSERT_FAIL = false;
    };
    const jsonRes = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });
    const savedFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || "GET";
      const m = /\/rest\/v1\/([a-z_]+)(\?(.*))?$/.exec(u);
      if (!m) return jsonRes([]);
      const table = m[1], qs = m[3] || "";
      const rows = DB[table] || [];
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch {}
      (WRITES[table] ||= []);
      if (table === "bid_unit_assignment_lines" && LINES_MISSING) return jsonRes({ code: "PGRST205", message: "Could not find the table 'public.bid_unit_assignment_lines' in the schema cache" }, 404);
      if (table === "bid_unit_assignment_lines" && LINES_READ_FAIL && method === "GET") return jsonRes({ message: "boom" }, 500);
      if (table === "bid_requests" && REQUESTS_READ_FAIL) return jsonRes({ message: "boom" }, 500);
      if (table === "verified_partner_hotel_scope") {
        const sm = /partner_subject=(?:eq\.|in\.\()([^&)]+)/.exec(u);
        const subj = sm ? decodeURIComponent(sm[1]) : "";
        return jsonRes(rows.filter((r) => r.partner_subject === subj && r.status === "active").map((r) => ({ hotel_id: r.hotel_id })));
      }
      if (method === "GET") return jsonRes(applyFilters(rows, qs));
      if (method === "POST") {
        if (table === "notifications" && NOTIF_INSERT_FAIL) return jsonRes({ message: "insert failed" }, 500);
        if (table === "bid_unit_assignment_lines" && LINES_EXCLUDE) return jsonRes({ code: "23P01", message: "conflicting key value violates exclusion constraint \"excl_bual_unit_night_overlap\"" }, 409);
        const arr = Array.isArray(body) ? body : [body];
        WRITES[table].push({ method, url: u, body });
        // Honour PostgREST `?on_conflict=<col>` + merge-duplicates: an upsert MERGES
        // onto the existing row (this is exactly how the evidence store's check-out
        // merges checked_out onto the checked_in row), otherwise append.
        const oc = /on_conflict=([A-Za-z_]+)/.exec(qs);
        arr.forEach((r) => {
          const existing = oc ? rows.find((x) => String(x[oc[1]]) === String(r[oc[1]])) : null;
          if (existing) Object.assign(existing, r); else rows.push({ ...r });
        });
        return jsonRes(arr, 201);
      }
      if (method === "PATCH") {
        WRITES[table].push({ method, url: u, body });
        applyFilters(rows, qs).forEach((r) => Object.assign(r, body));
        return jsonRes([]);
      }
      if (method === "DELETE") {
        WRITES[table].push({ method, url: u });
        const gone = applyFilters(rows, qs);
        DB[table] = rows.filter((r) => !gone.includes(r));
        return jsonRes([]);
      }
      return jsonRes([]);
    };

    const signP = (claims, opts = {}) => jwt.sign(claims, PARTNER_SECRET, { algorithm: "HS256", ...opts });
    const authToken = () => "Bearer " + signP({ sub: SUBJECT, id: SUBJECT });
    const mkReq = (auth, body, url = "https://x.test/api") => ({
      url,
      headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? auth : null) },
      json: async () => body ?? {},
    });
    const wcount = (t, method) => (WRITES[t] || []).filter((w) => !method || w.method === method).length;
    const snapshotWrites = () => Object.fromEntries(Object.keys(WRITES).map((t) => [t, (WRITES[t] || []).length]));

    // seeding helpers
    const seedUnit = (id, extra = {}) => { DB.hotel_room_units.push({ id, hotelId: HOTEL, roomId: ROOM, roomNumber: id.replace("u", "10"), status: "active", ...extra }); };
    const seedBid = (id, status, { ci = TODAY, co = D(1), numRooms = 1, hotelId = HOTEL, roomId = ROOM, requestId = "req_" + id, assignedUnitId = null } = {}) => {
      DB.bids.push({ id, hotelId, roomId, customerId: CUSTOMER, status, numRooms, requestId, assignedUnitId });
      if (requestId) DB.bid_requests.push({ id: requestId, checkIn: ci + "T00:00:00", checkOut: co + "T00:00:00" });
    };
    const seedLine = (bidId, unitId, slot = 1, extra = {}) => {
      const u = DB.hotel_room_units.find((x) => x.id === unitId) || { roomNumber: "?" };
      DB.bid_unit_assignment_lines.push({ id: `bual_${bidId}_${unitId}_t`, bid_id: bidId, hotel_id: HOTEL, room_id: ROOM, unit_id: unitId, unit_number: u.roomNumber, slot, status: "active", ...extra });
    };
    const seedEvidence = (bidId, proof, extra = {}) => {
      DB.verified_stay_evidence.push({ id: `vse_bid_${bidId}`, customer_id: CUSTOMER, hotel_id: HOTEL, source_type: "bid", source_id: bidId, proof_state: proof, verifier_type: "partner", verifier_id: SUBJECT, verified_at: "2026-09-12T00:00:00Z", check_in_at: "2026-09-12T00:00:00Z", check_out_at: proof === "checked_out" ? "2026-09-13T00:00:00Z" : null, ...extra });
    };
    const checkin = async (bidId, auth = authToken()) => { const r = await CHECKIN.POST(mkReq(auth), { params: Promise.resolve({ bidId }) }); return { status: r.status, body: r.body }; };
    const checkout = async (bidId, body, auth = authToken()) => { const r = await CHECKOUT.POST(mkReq(auth, body), { params: Promise.resolve({ bidId }) }); return { status: r.status, body: r.body }; };
    const assign = async (body, auth = authToken()) => { const r = await ASSIGN.POST(mkReq(auth, body)); return { status: r.status, body: r.body }; };
    const unassign = async (qs, auth = authToken()) => { const r = await ASSIGN.DELETE(mkReq(auth, null, "https://x.test/api/partner/room-units/assign?" + qs)); return { status: r.status, body: r.body }; };
    const evWrites = () => wcount("verified_stay_evidence", "POST");

    // ═══════════ A. pure temporal rules ═══════════
    section("A. stay-dates — IST today + reservation date extraction + windows");
    eqv(SD.istDateISO(Date.UTC(2026, 8, 17, 20, 0, 0)), "2026-09-18", "A.1 20:00 UTC is already the NEXT IST day (+5:30)");
    eqv(SD.istDateISO(Date.UTC(2026, 8, 17, 18, 0, 0)), "2026-09-17", "A.2 18:00 UTC is still the same IST day");
    eqv(SD.reservationDateISO("2026-09-18T00:00:00"), "2026-09-18", "A.3 naive PostgREST timestamp → date portion");
    eqv(SD.reservationDateISO("2026-09-18 00:00:00"), "2026-09-18", "A.4 naive SQL timestamp → date portion");
    eqv(SD.reservationDateISO("2026-09-18"), "2026-09-18", "A.5 plain date");
    eqv(SD.reservationDateISO(""), null, "A.6 empty → null");
    eqv(SD.reservationDateISO("garbage"), null, "A.7 garbage → null");
    eqv(SD.evaluateCheckInWindow({ checkIn: "2026-09-18T00:00:00", checkOut: "2026-09-19T00:00:00", todayISO: "2026-09-13" }).reason, "checkin_premature", "A.8 future reservation → premature");
    ok(SD.evaluateCheckInWindow({ checkIn: "2026-09-18", checkOut: "2026-09-19", todayISO: "2026-09-18" }).ok === true, "A.9 same-day → ok");
    { const r = SD.evaluateCheckInWindow({ checkIn: "2026-09-16", checkOut: "2026-09-19", todayISO: "2026-09-18" }); ok(r.ok === true && r.late === true, "A.10 late arrival on a later night → ok + late"); }
    eqv(SD.evaluateCheckInWindow({ checkIn: "2026-09-16", checkOut: "2026-09-18", todayISO: "2026-09-18" }).reason, "checkin_window_closed", "A.11 on the check-out day → window closed");
    eqv(SD.evaluateCheckInWindow({ checkIn: null, checkOut: null, todayISO: "2026-09-18" }).reason, "checkin_date_unavailable", "A.12 no dates → fail closed");
    ok(SD.evaluateCheckOutTiming({ checkOut: "2026-09-19", todayISO: "2026-09-13" }).early === true, "A.13 leaving before scheduled check-out → early");
    ok(SD.evaluateCheckOutTiming({ checkOut: "2026-09-19", todayISO: "2026-09-19" }).early === false, "A.14 on the scheduled day → not early");
    ok(SD.evaluateCheckOutTiming({ checkOut: null, todayISO: "2026-09-19" }).early === false, "A.15 unknown scheduled date → not flagged (never blocks)");

    // ═══════════ B. check-in temporal gate (route) ═══════════
    section("B. check-in route — temporal authority (no configured units → unit gate skipped)");
    reset(); seedBid("b_future", "ACCEPTED", { ci: D(5), co: D(6) });
    { const r = await checkin("b_future"); eqv(r.status, 409, "B.1 future reservation → 409"); eqv(r.body.error, "checkin_premature", "B.1e checkin_premature"); eqv(evWrites(), 0, "B.1w ZERO evidence write"); }
    reset(); seedBid("b_today", "ACCEPTED", { ci: TODAY, co: D(1) });
    { const r = await checkin("b_today"); eqv(r.status, 200, "B.2 same-day → 200"); eqv(evWrites(), 1, "B.2w exactly one evidence write"); ok(r.body.lateCheckIn === false, "B.2l not late"); ok(r.body.unitsRequired === 1 && r.body.unitsAssigned === 0, "B.2u unit gate skipped (no configured units)"); }
    reset(); seedBid("b_late", "ACCEPTED", { ci: D(-2), co: D(2) });
    { const r = await checkin("b_late"); eqv(r.status, 200, "B.3 late check-in on a later night → 200"); ok(r.body.lateCheckIn === true, "B.3l flagged late"); eqv(evWrites(), 1, "B.3w one evidence write"); }
    reset(); seedBid("b_closed", "ACCEPTED", { ci: D(-3), co: TODAY });
    { const r = await checkin("b_closed"); eqv(r.status, 409, "B.4 check-in on the check-out day → 409"); eqv(r.body.error, "checkin_window_closed", "B.4e checkin_window_closed"); eqv(evWrites(), 0, "B.4w ZERO write"); }
    reset(); seedBid("b_nodates", "ACCEPTED", { requestId: null });
    { const r = await checkin("b_nodates"); eqv(r.status, 409, "B.5 no reservation dates → 409 (fail closed)"); eqv(r.body.error, "checkin_date_unavailable", "B.5e"); eqv(evWrites(), 0, "B.5w ZERO write"); }
    reset(); seedBid("b_rfail", "ACCEPTED"); REQUESTS_READ_FAIL = true;
    { const r = await checkin("b_rfail"); eqv(r.status, 503, "B.6 stay-dates read FAILURE → 503 (never 'no dates')"); eqv(evWrites(), 0, "B.6w ZERO write"); }
    // idempotent replay is untouched by the temporal gate
    reset(); seedBid("b_replay", "CHECKED_IN", { ci: D(5), co: D(6) }); seedEvidence("b_replay", "checked_in");
    { const r = await checkin("b_replay"); eqv(r.status, 200, "B.7 already-checked-in replay stays idempotent even with future dates"); ok(r.body.alreadyCheckedIn === true, "B.7a"); eqv(evWrites(), 0, "B.7w ZERO rewrite"); }

    // ═══════════ C. check-in physical-unit gate ═══════════
    section("C. check-in route — physical unit assignment gate (category has 2 active units)");
    const seedCategory = () => { seedUnit("u1"); seedUnit("u2"); seedUnit("u3", { status: "inactive" }); DB.hotel_room_units.push({ id: "ux_other", hotelId: OTHER_HOTEL, roomId: ROOM, roomNumber: "901", status: "active" }); DB.hotel_room_units.push({ id: "ux_cat", hotelId: HOTEL, roomId: OTHER_ROOM, roomNumber: "201", status: "active" }); };
    reset(); seedCategory(); seedBid("c_none", "ACCEPTED");
    { const r = await checkin("c_none"); eqv(r.status, 409, "C.1 1-room booking with NO unit → 409"); eqv(r.body.error, "units_not_assigned", "C.1e units_not_assigned"); eqv(r.body.required, 1, "C.1r required 1"); eqv(r.body.assigned, 0, "C.1a assigned 0"); eqv(evWrites(), 0, "C.1w ZERO evidence write"); }
    reset(); seedCategory(); seedBid("c_one", "ACCEPTED"); seedLine("c_one", "u1");
    { const r = await checkin("c_one"); eqv(r.status, 200, "C.2 1-room booking with 1 valid unit → 200"); ok(r.body.unitsAssigned === 1 && r.body.unitsRequired === 1, "C.2u 1/1"); eqv(evWrites(), 1, "C.2w one evidence write"); }
    reset(); seedCategory(); seedBid("c_two1", "ACCEPTED", { numRooms: 2 }); seedLine("c_two1", "u1");
    { const r = await checkin("c_two1"); eqv(r.status, 409, "C.3 2-room booking with only 1 unit → 409"); eqv(r.body.error, "units_not_assigned", "C.3e"); eqv(r.body.required, 2, "C.3r required 2"); eqv(r.body.assigned, 1, "C.3a assigned 1"); eqv(evWrites(), 0, "C.3w ZERO write"); }
    reset(); seedCategory(); seedBid("c_two2", "ACCEPTED", { numRooms: 2 }); seedLine("c_two2", "u1", 1); seedLine("c_two2", "u2", 2);
    { const r = await checkin("c_two2"); eqv(r.status, 200, "C.4 2-room booking with 2 DISTINCT valid units → 200"); eqv(r.body.unitsAssigned, 2, "C.4u 2 assigned"); eqv(evWrites(), 1, "C.4w one evidence write"); }
    reset(); seedCategory(); seedBid("c_dup", "ACCEPTED", { numRooms: 2 }); seedLine("c_dup", "u1", 1); seedLine("c_dup", "u1", 2);
    { const r = await checkin("c_dup"); eqv(r.status, 409, "C.5 2-room booking with the SAME unit twice → 409 (distinctness)"); eqv(evWrites(), 0, "C.5w ZERO write"); }
    reset(); seedCategory(); seedBid("c_wh", "ACCEPTED"); seedLine("c_wh", "ux_other");
    { const r = await checkin("c_wh"); eqv(r.status, 409, "C.6 assigned unit belongs to ANOTHER hotel → 409"); eqv(r.body.error, "assigned_unit_invalid", "C.6e assigned_unit_invalid"); eqv(evWrites(), 0, "C.6w ZERO write"); }
    reset(); seedCategory(); seedBid("c_wc", "ACCEPTED"); seedLine("c_wc", "ux_cat");
    { const r = await checkin("c_wc"); eqv(r.status, 409, "C.7 assigned unit is ANOTHER room category → 409"); eqv(r.body.error, "assigned_unit_invalid", "C.7e"); eqv(evWrites(), 0, "C.7w ZERO write"); }
    reset(); seedCategory(); seedBid("c_in", "ACCEPTED"); seedLine("c_in", "u3");
    { const r = await checkin("c_in"); eqv(r.status, 409, "C.8 assigned unit is INACTIVE → 409"); eqv(r.body.error, "assigned_unit_invalid", "C.8e"); eqv(evWrites(), 0, "C.8w ZERO write"); }
    reset(); seedCategory(); seedBid("c_legacy", "ACCEPTED"); LINES_MISSING = true; DB.bid_unit_assignments.push({ bidId: "c_legacy", unitId: "u2", unitNumber: "102" });
    { const r = await checkin("c_legacy"); eqv(r.status, 200, "C.9 lines table missing → legacy single-unit row satisfies the gate"); eqv(evWrites(), 1, "C.9w one evidence write"); }
    reset(); seedCategory(); seedBid("c_legacy2", "ACCEPTED", { numRooms: 2 }); LINES_MISSING = true; DB.bid_unit_assignments.push({ bidId: "c_legacy2", unitId: "u2", unitNumber: "102" });
    { const r = await checkin("c_legacy2"); eqv(r.status, 409, "C.10 lines missing + 2-room booking → legacy can only prove 1 → 409"); eqv(evWrites(), 0, "C.10w ZERO write"); }
    reset(); seedCategory(); seedBid("c_lfail", "ACCEPTED"); seedLine("c_lfail", "u1"); LINES_READ_FAIL = true;
    { const r = await checkin("c_lfail"); eqv(r.status, 503, "C.11 assignment read FAILURE → 503 (never 'nothing assigned')"); eqv(r.body.error, "unit_assignment_unavailable", "C.11e"); eqv(evWrites(), 0, "C.11w ZERO write"); }
    // lines mode with ZERO lines but bids.assignedUnitId stamped (Circle / unit-booking flows)
    reset(); seedCategory(); seedBid("c_stamp", "ACCEPTED", { assignedUnitId: "u2" });
    { const r = await checkin("c_stamp"); eqv(r.status, 200, "C.11b lines mode + bids.assignedUnitId stamped (no line) → still counts as assigned → 200"); eqv(evWrites(), 1, "C.11bw one evidence write"); }
    reset(); seedCategory(); seedBid("c_stamp_bad", "ACCEPTED", { assignedUnitId: "ux_cat" });
    { const r = await checkin("c_stamp_bad"); eqv(r.status, 409, "C.11c stamped unit of the wrong category is still rejected"); eqv(r.body.error, "assigned_unit_invalid", "C.11ce"); }
    // pure gate helpers
    ok(UA.requiredUnitCount({ numRooms: 3 }) === 3 && UA.requiredUnitCount({ numRooms: 0 }) === 1 && UA.requiredUnitCount({}) === 1, "C.12 requiredUnitCount = max(1, numRooms)");
    ok(UA.evaluateCheckInAssignment({ bid: { id: "x", hotelId: HOTEL, roomId: ROOM, numRooms: 1 }, configuredActiveUnits: 0, assignedUnitIds: [], units: [] }).skipped === true, "C.13 no configured units → skipped");

    // ═══════════ D. assign route — authority + integrity + cardinality + history ═══════════
    section("D. room-unit assign route — verified authority + server-side integrity");
    reset(); seedCategory(); seedBid("d_ok", "ACCEPTED");
    { const wrong = "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" });
      const r1 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, wrong); eqv(r1.status, 401, "D.1 wrong-secret forged token → 401");
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const none = `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUBJECT })}.`;
      const r2 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, none); eqv(r2.status, 401, "D.2 alg:none / decode-only token → 401");
      const r3 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, "Bearer " + signP({ id: SUBJECT })); eqv(r3.status, 401, "D.3 id-only token (no sub) → 401");
      const r4 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, ""); eqv(r4.status, 401, "D.4 missing token → 401");
      ok(wcount("bid_unit_assignment_lines") === 0 && wcount("bid_unit_assignments") === 0 && wcount("bids") === 0, "D.1-4w ZERO assignment writes on every rejected token"); }
    { const r = await assign({ bidId: "d_ok", unitIds: ["u1"] }); eqv(r.status, 200, "D.5 valid partner + exact hotel + ACCEPTED bid + valid unit → 200");
      eqv(wcount("bid_unit_assignment_lines", "POST"), 1, "D.5l one line inserted");
      const line = (WRITES.bid_unit_assignment_lines[0].body || [])[0] || {};
      ok(line.bid_id === "d_ok" && line.unit_id === "u1" && line.hotel_id === HOTEL && line.room_id === ROOM && line.slot === 1 && line.status === "active" && line.assigned_by === SUBJECT, "D.5f line carries bid/unit/hotel/category/slot/status/verified subject");
      ok(wcount("bid_unit_assignments", "POST") === 1, "D.5m legacy slot-1 mirror upserted");
      ok((WRITES.bids || []).some((w) => w.method === "PATCH" && w.body && w.body.assignedUnitId === "u1"), "D.5b bids.assignedUnitId mirrored to slot 1");
      eqv(r.body.mode, "lines", "D.5mode lines mode"); }
    reset(); seedCategory(); DB.bids.push({ id: "d_other", hotelId: OTHER_HOTEL, roomId: ROOM, customerId: CUSTOMER, status: "ACCEPTED", numRooms: 1, requestId: "req_d_other" }); DB.bid_requests.push({ id: "req_d_other", checkIn: TODAY + "T00:00:00", checkOut: D(1) + "T00:00:00" });
    { const r = await assign({ bidId: "d_other", unitIds: ["ux_other"] }); eqv(r.status, 403, "D.6 partner not bound to the bid's hotel → 403"); ok(wcount("bid_unit_assignment_lines") === 0, "D.6w ZERO writes"); }
    reset(); seedCategory(); seedBid("d_wh", "ACCEPTED");
    { const r = await assign({ bidId: "d_wh", unitIds: ["ux_other"] }); eqv(r.status, 409, "D.7 unit of ANOTHER hotel → 409"); eqv(r.body.error, "unit_wrong_hotel", "D.7e unit_wrong_hotel"); ok(wcount("bid_unit_assignment_lines") === 0, "D.7w ZERO writes"); }
    reset(); seedCategory(); seedBid("d_wc", "ACCEPTED");
    { const r = await assign({ bidId: "d_wc", unitIds: ["ux_cat"] }); eqv(r.status, 409, "D.8 unit of ANOTHER category → 409"); eqv(r.body.error, "unit_wrong_category", "D.8e"); }
    reset(); seedCategory(); seedBid("d_in", "ACCEPTED");
    { const r = await assign({ bidId: "d_in", unitIds: ["u3"] }); eqv(r.status, 409, "D.9 INACTIVE unit → 409"); eqv(r.body.error, "unit_inactive", "D.9e"); }
    reset(); seedCategory(); seedBid("d_nf", "ACCEPTED");
    { const r = await assign({ bidId: "d_nf", unitIds: ["u_ghost"] }); eqv(r.status, 409, "D.10 unknown unit id → 409"); eqv(r.body.error, "unit_not_found", "D.10e"); }
    reset(); seedCategory(); seedBid("d_dup", "ACCEPTED", { numRooms: 2 });
    { const r = await assign({ bidId: "d_dup", unitIds: ["u1", "u1"] }); eqv(r.status, 409, "D.11 duplicate unit ids → 409"); eqv(r.body.error, "duplicate_unit", "D.11e"); }
    reset(); seedCategory(); seedBid("d_many", "ACCEPTED");
    { const r = await assign({ bidId: "d_many", unitIds: ["u1", "u2"] }); eqv(r.status, 409, "D.12 2 units for a 1-room booking → 409"); eqv(r.body.error, "too_many_units", "D.12e"); }
    // conflicts: another occupying bid overlapping / not overlapping / checked out; a walk-in block
    reset(); seedCategory(); seedBid("d_c1", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_hold", "ACCEPTED", { ci: D(1), co: D(3) }); seedLine("d_hold", "u1");
    { const r = await assign({ bidId: "d_c1", unitIds: ["u1"] }); eqv(r.status, 409, "D.13 unit held by ANOTHER live bid on overlapping nights → 409"); eqv(r.body.error, "unit_conflict", "D.13e unit_conflict");
      const r2 = await assign({ bidId: "d_c1", unitIds: ["u2"] }); eqv(r2.status, 200, "D.13b a free unit in the same category is accepted"); }
    reset(); seedCategory(); seedBid("d_c2", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_far", "ACCEPTED", { ci: D(5), co: D(7) }); seedLine("d_far", "u1");
    { const r = await assign({ bidId: "d_c2", unitIds: ["u1"] }); eqv(r.status, 200, "D.14 unit held on NON-overlapping nights → accepted"); }
    reset(); seedCategory(); seedBid("d_c3", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_done", "CHECKED_OUT", { ci: TODAY, co: D(2) }); seedLine("d_done", "u1");
    { const r = await assign({ bidId: "d_c3", unitIds: ["u1"] }); eqv(r.status, 200, "D.15 unit whose previous stay is CHECKED_OUT does not conflict"); }
    reset(); seedCategory(); seedBid("d_c4", "ACCEPTED", { ci: TODAY, co: D(2) }); DB.room_blocks.push({ id: "blk1", hotelId: HOTEL, roomId: ROOM, assignedUnitId: "u1", fromDate: D(1), toDate: D(3) });
    { const r = await assign({ bidId: "d_c4", unitIds: ["u1"] }); eqv(r.status, 409, "D.16 unit pinned to an overlapping walk-in block → 409"); eqv(r.body.error, "unit_conflict", "D.16e"); }
    // N-room
    reset(); seedCategory(); seedBid("d_n", "ACCEPTED", { numRooms: 2 });
    { const r = await assign({ bidId: "d_n", unitIds: ["u1", "u2"] }); eqv(r.status, 200, "D.17 2-room booking → 2 distinct units accepted");
      const rows = (WRITES.bid_unit_assignment_lines[0].body || []); eqv(rows.length, 2, "D.17l two lines inserted"); ok(rows[0].slot === 1 && rows[1].slot === 2, "D.17s slots 1 and 2"); eqv(r.body.required, 2, "D.17r required 2"); }
    // lifecycle / history
    reset(); seedCategory(); seedBid("d_out", "CHECKED_OUT"); seedLine("d_out", "u1");
    { const r = await assign({ bidId: "d_out", unitIds: ["u2"] }); eqv(r.status, 409, "D.18 COMPLETED stay → ordinary reassignment BLOCKED"); eqv(r.body.error, "stay_completed", "D.18e stay_completed"); ok(wcount("bid_unit_assignment_lines") === 0 && wcount("bid_unit_assignments") === 0 && wcount("bids") === 0, "D.18w ZERO writes — history frozen");
      const r2 = await assign({ bidId: "d_out", unitIds: ["u2"], action: "transfer", reason: "x" }); eqv(r2.status, 409, "D.18t even an explicit transfer is refused on a completed stay"); }
    reset(); seedCategory(); seedBid("d_house", "CHECKED_IN"); seedLine("d_house", "u1");
    { const r = await assign({ bidId: "d_house", unitIds: ["u2"] }); eqv(r.status, 409, "D.19 in-house guest: ordinary assign refused"); eqv(r.body.error, "transfer_confirmation_required", "D.19e");
      const r2 = await assign({ bidId: "d_house", unitIds: ["u2"], action: "transfer" }); eqv(r2.status, 400, "D.19r transfer without a reason refused"); eqv(r2.body.error, "transfer_reason_required", "D.19re");
      const r3 = await assign({ bidId: "d_house", unitIds: ["u2"], action: "transfer", reason: "AC failure in 101" }); eqv(r3.status, 200, "D.19t explicit transfer with reason → 200");
      const sup = (WRITES.bid_unit_assignment_lines || []).find((w) => w.method === "PATCH"); ok(!!sup && sup.body.status === "superseded" && /transfer: AC failure/.test(sup.body.reason) && sup.body.released_by === SUBJECT, "D.19h old line SUPERSEDED with the audited reason (not deleted)");
      const ins = (WRITES.bid_unit_assignment_lines || []).find((w) => w.method === "POST"); ok(!!ins && ins.body[0].unit_id === "u2" && /transfer:/.test(ins.body[0].reason), "D.19n new line inserted for the new room, reason recorded");
      ok(wcount("bid_unit_assignment_lines", "DELETE") === 0, "D.19d nothing deleted"); }
    reset(); seedCategory(); seedBid("d_pend", "PENDING");
    { const r = await assign({ bidId: "d_pend", unitIds: ["u1"] }); eqv(r.status, 409, "D.20 PENDING bid holds no reservation → 409"); eqv(r.body.error, "bid_not_reservable", "D.20e"); }
    reset(); seedCategory(); seedBid("d_leg1", "ACCEPTED"); LINES_MISSING = true;
    { const r = await assign({ bidId: "d_leg1", unitIds: ["u1"] }); eqv(r.status, 200, "D.21 lines table missing → single unit written via legacy mirror"); eqv(r.body.mode, "legacy", "D.21m legacy mode"); ok(wcount("bid_unit_assignments", "POST") === 1, "D.21w legacy upsert"); }
    reset(); seedCategory(); seedBid("d_leg2", "ACCEPTED", { numRooms: 2 }); LINES_MISSING = true;
    { const r = await assign({ bidId: "d_leg2", unitIds: ["u1", "u2"] }); eqv(r.status, 503, "D.22 lines table missing + multi-unit → fail closed 503"); eqv(r.body.error, "unit_assignment_lines_unavailable", "D.22e"); ok(wcount("bid_unit_assignments") === 0, "D.22w ZERO legacy write"); }
    // DELETE rules
    reset(); seedCategory(); seedBid("d_del_out", "CHECKED_OUT"); seedLine("d_del_out", "u1");
    { const r = await unassign("bidId=d_del_out"); eqv(r.status, 409, "D.23 unassign on a completed stay → 409 stay_completed"); eqv(r.body.error, "stay_completed", "D.23e"); }
    reset(); seedCategory(); seedBid("d_del_in", "CHECKED_IN"); seedLine("d_del_in", "u1");
    { const r = await unassign("bidId=d_del_in"); eqv(r.status, 409, "D.24 unassign on an in-house guest → 409 (transfer instead)"); }
    reset(); seedCategory(); seedBid("d_del_ok", "ACCEPTED"); seedLine("d_del_ok", "u1");
    { const r = await unassign("bidId=d_del_ok"); eqv(r.status, 200, "D.25 unassign before check-in → 200");
      const rel = (WRITES.bid_unit_assignment_lines || []).find((w) => w.method === "PATCH"); ok(!!rel && rel.body.status === "released", "D.25h line RELEASED (audited), not deleted");
      ok(wcount("bid_unit_assignments", "DELETE") === 1, "D.25m legacy mirror cleared"); ok((WRITES.bids || []).some((w) => w.body && w.body.assignedUnitId === null), "D.25b bids.assignedUnitId cleared"); }
    { const wrong = "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" }); const r = await unassign("bidId=d_del_ok", wrong); eqv(r.status, 401, "D.26 DELETE with forged token → 401"); }
    // DB EXCLUDE constraint (lost race) → 409 unit_conflict, nothing mirrored
    reset(); seedCategory(); seedBid("d_race", "ACCEPTED"); LINES_EXCLUDE = true;
    { const r = await assign({ bidId: "d_race", unitIds: ["u1"] }); eqv(r.status, 409, "D.26b DB exclusion violation (concurrent claim) → 409"); eqv(r.body.error, "unit_conflict", "D.26be unit_conflict"); eqv(r.body.detail, "db_exclusion", "D.26bd detail db_exclusion"); ok(wcount("bid_unit_assignments") === 0 && wcount("bids") === 0, "D.26bw legacy mirror NOT written after a refused insert"); }
    // inserted lines carry the stay range for the DB EXCLUDE constraint
    reset(); seedCategory(); seedBid("d_range", "ACCEPTED", { ci: TODAY, co: D(2) });
    { await assign({ bidId: "d_range", unitIds: ["u1"] }); const row = ((WRITES.bid_unit_assignment_lines || [])[0] || {}).body?.[0] || {}; ok(row.stay_from === TODAY && row.stay_to === D(2), "D.26c inserted line carries stay_from / stay_to"); }
    // pure lifecycle gate
    eqv(UA.assignmentLifecycleGate("CHECKED_OUT", "assign", "").error, "stay_completed", "D.26d gate: completed stay frozen");
    eqv(UA.assignmentLifecycleGate("CHECKED_IN", "assign", "").error, "transfer_confirmation_required", "D.26e gate: in-house needs explicit transfer");
    ok(UA.assignmentLifecycleGate("CHECKED_IN", "transfer", "leak").ok === true, "D.26f gate: explicit transfer with reason ok");
    eqv(UA.assignmentLifecycleGate("ACCEPTED", "transfer", "x").error, "transfer_only_while_checked_in", "D.26g gate: transfer refused before check-in");
    // pure validator
    { const v = UA.validateAssignmentSet({ bid: { id: "x", hotelId: HOTEL, roomId: ROOM, numRooms: 1 }, unitIds: [], units: [] }); eqv(v.error, "no_units", "D.27 empty set → no_units"); }
    ok(UA.staysOverlap("2026-09-13", "2026-09-15", "2026-09-15", "2026-09-17") === false, "D.28 checkout-exclusive ranges touching do not overlap");
    ok(UA.staysOverlap("2026-09-13", "2026-09-16", "2026-09-15", "2026-09-17") === true, "D.29 overlapping ranges overlap");

    // ═══════════ E. checkout — lifecycle authority + explicit early + downstream idempotency + notification ═══════════
    section("E. checkout route — downstream lifecycle only after a legitimate checkout; notification contract");
    const downstream = () => ({ fb: wcount("feedback_tracking", "POST"), vl: wcount("video_lifecycle", "POST"), nt: wcount("notifications", "POST"), log: wcount("checkin_checkout_logs") });
    reset(); seedBid("e_acc", "ACCEPTED", { ci: D(-1), co: TODAY });
    { const r = await checkout("e_acc", {}); eqv(r.status, 409, "E.1 checkout from ACCEPTED (not checked in) → 409"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0 && d.log === 0 && evWrites() === 0, "E.1w ZERO downstream lifecycle rows, ZERO evidence"); }
    reset(); seedBid("e_noev", "CHECKED_IN", { ci: D(-1), co: TODAY });
    { const r = await checkout("e_noev", {}); eqv(r.status, 409, "E.2 CHECKED_IN without protected checked_in evidence → 409"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0, "E.2w ZERO downstream rows"); }
    reset(); seedBid("e_ok", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_ok", "checked_in");
    { const r = await checkout("e_ok", {}); eqv(r.status, 200, "E.3 valid on-time checkout → 200"); ok(r.body.earlyCheckout === false, "E.3e not early"); eqv(evWrites(), 1, "E.3ev one checked_out evidence write");
      const d = downstream(); eqv(d.fb, 1, "E.3f feedback_tracking created"); eqv(d.vl, 1, "E.3v video_lifecycle created"); eqv(d.nt, 1, "E.3n notification queued");
      const n = (WRITES.notifications[0] || {}).body || {}; eqv(n.id, "ntf_fbwin_e_ok", "E.3id notification carries the DETERMINISTIC id (schema: id NOT NULL, no default)"); eqv(n.userId, CUSTOMER, "E.3u userId = the guest"); eqv(n.type, "feedback_window_opened", "E.3t type"); ok(n.meta && n.meta.bookingId === "e_ok" && typeof n.meta.expiry === "string", "E.3m meta.bookingId + expiry"); ok(typeof n.title === "string" && typeof n.body === "string", "E.3tb title/body present"); ok(r.body.notificationQueued === true, "E.3q response reports notificationQueued:true");
      // replay: already checked out → idempotent, ZERO new downstream rows
      const r2 = await checkout("e_ok", {}); eqv(r2.status, 200, "E.4 replay → 200"); ok(r2.body.alreadyCheckedOut === true, "E.4a alreadyCheckedOut"); const d2 = downstream(); ok(d2.fb === 1 && d2.vl === 1 && d2.nt === 1, "E.4w replay creates ZERO additional feedback/video/notification rows"); eqv(evWrites(), 1, "E.4ev ZERO evidence rewrite"); }
    // pre-existing downstream rows → no duplicates on the FIRST valid checkout either
    reset(); seedBid("e_pre", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_pre", "checked_in"); DB.feedback_tracking.push({ booking_id: "e_pre" }); DB.video_lifecycle.push({ booking_id: "e_pre" }); DB.notifications.push({ id: "ntf_fbwin_e_pre" });
    { const r = await checkout("e_pre", {}); eqv(r.status, 200, "E.5 checkout with pre-existing downstream rows → 200"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0, "E.5w no duplicate feedback/video/notification rows"); ok(r.body.notificationQueued === true, "E.5q existing notification counts as queued"); }
    // early checkout — explicit + audited
    reset(); seedBid("e_early", "CHECKED_IN", { ci: D(-1), co: D(3) }); seedEvidence("e_early", "checked_in");
    { const r = await checkout("e_early", {}); eqv(r.status, 409, "E.6 early departure without confirmation → 409"); eqv(r.body.error, "early_checkout_confirmation_required", "E.6e"); eqv(r.body.scheduledCheckOut, D(3), "E.6s scheduled date returned"); eqv(evWrites(), 0, "E.6w ZERO evidence write"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0, "E.6d ZERO downstream rows");
      const r2 = await checkout("e_early", { confirmEarly: true, reason: "family emergency" }); eqv(r2.status, 200, "E.7 confirmed early checkout → 200"); ok(r2.body.earlyCheckout === true, "E.7e earlyCheckout:true"); eqv(evWrites(), 1, "E.7ev evidence written");
      const log = (WRITES.checkin_checkout_logs || []).find((w) => w.method === "POST"); ok(!!log && /early checkout: scheduled/.test(String(log.body.notes)) && /family emergency/.test(String(log.body.notes)), "E.7a early checkout recorded in the lifecycle log notes with the reason"); }
    // notification insert failure is honest and never blocks the verified checkout
    reset(); seedBid("e_nf", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_nf", "checked_in"); NOTIF_INSERT_FAIL = true;
    { const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(" ")); const r = await checkout("e_nf", {}); console.warn = ow;
      eqv(r.status, 200, "E.8 notification insert failure never blocks the verified checkout"); ok(r.body.notificationQueued === false, "E.8q response honestly reports notificationQueued:false"); ok(warns.some((w) => /notification NOT queued/.test(w)), "E.8l failure is LOGGED with a reason (not silently swallowed)"); }
    // forged token / wrong hotel keep authority
    reset(); seedBid("e_auth", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_auth", "checked_in");
    { const r = await checkout("e_auth", {}, "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG", { algorithm: "HS256" })); eqv(r.status, 401, "E.9 forged token → 401"); const d = downstream(); ok(d.fb === 0 && d.nt === 0, "E.9w ZERO downstream"); }
    // CHECKED_OUT → CHECKED_IN downgrade impossible via check-in
    reset(); seedBid("e_down", "CHECKED_OUT", { ci: D(-1), co: D(1) }); seedEvidence("e_down", "checked_out");
    { const r = await checkin("e_down"); eqv(r.status, 409, "E.10 CHECKED_OUT → check-in never downgrades"); eqv(r.body.error, "already_checked_out", "E.10e"); eqv(evWrites(), 0, "E.10w ZERO write"); }

    // ═══════════ F. pure display truth ═══════════
    section("F. display truth — lifecycle label, contact classification, payment summary");
    { const s = BDS.bookingDetailStatus({ status: "CHECKED_OUT", checkIn: "2026-09-18T00:00:00", checkOut: "2026-09-19T00:00:00", todayISO: "2026-09-13" }); ok(s.label === "Checked Out" && s.source === "lifecycle", "F.1 CHECKED_OUT with FUTURE dates → 'Checked Out' (lifecycle wins)"); ok(!/upcoming/i.test(s.label), "F.1u never 'Upcoming'"); }
    { const s = BDS.bookingDetailStatus({ status: "CHECKED_IN", checkIn: "2026-09-18", checkOut: "2026-09-19", todayISO: "2026-09-13" }); ok(/In-house/.test(s.label) && /Checked In/.test(s.label) && s.source === "lifecycle", "F.2 CHECKED_IN → in-house / checked-in semantics"); }
    eqv(BDS.bookingDetailStatus({ status: "ACCEPTED", checkIn: "2026-09-18", checkOut: "2026-09-19", todayISO: "2026-09-13" }).label, "Upcoming", "F.3 ACCEPTED future → Upcoming (date-derived only where lifecycle does not supersede)");
    eqv(BDS.bookingDetailStatus({ status: "ACCEPTED", checkIn: "2026-09-13", checkOut: "2026-09-15", todayISO: "2026-09-13" }).label, "Arriving Today", "F.4 arriving today");
    ok(/Departing Today/.test(BDS.bookingDetailStatus({ status: "ACCEPTED", checkIn: "2026-09-11", checkOut: "2026-09-13", todayISO: "2026-09-13" }).label), "F.5 departing today (not checked in)");
    ok(/No Check-out Recorded/.test(BDS.bookingDetailStatus({ status: "ACCEPTED", checkIn: "2026-09-01", checkOut: "2026-09-03", todayISO: "2026-09-13" }).label), "F.6 past dates without a lifecycle checkout are NOT labelled 'Checked Out'");
    eqv(BDS.bookingDetailStatus({ status: "CANCELLED", checkIn: "2026-09-18", checkOut: "2026-09-19", todayISO: "2026-09-13" }).label, "Cancelled", "F.7 terminal state wins over dates");
    { const c = GC.normalizeGuestContact({ phone: "guest@example.test", email: null }); ok(c.phone === null && c.email === "guest@example.test", "F.8 email stored in the phone column → EMAIL slot, phone null"); }
    { const c = GC.normalizeGuestContact({ phone: "+91 98765 43210", email: "" }); ok(c.phone === "+91 98765 43210" && c.email === null, "F.9 real phone stays a phone"); }
    { const c = GC.normalizeGuestContact({ phone: "unknown_abc123", email: "x@y.test" }); ok(c.phone === null && c.email === "x@y.test", "F.10 placeholder phone dropped, nothing invented"); }
    eqv(GC.whatsappDigits("guest@example.test"), null, "F.11 no WhatsApp link for an email");
    eqv(GC.whatsappDigits("+91 98765-43210"), "919876543210", "F.12 WhatsApp digits from a real phone");
    { const p = BPS.bookingPaymentSummary({ ratePerNight: 3300, nights: 1, rooms: 1, paidTotal: null, razorpayPaymentId: null, message: null }); eqv(p.bookingValue, 3300, "F.13 booking value 3300"); eqv(p.paidRecorded, null, "F.13p unpaid → paidRecorded null"); eqv(p.paymentState, "not_recorded", "F.13s not_recorded"); ok(!/revenue/i.test(p.paymentLabel), "F.13l label never says revenue"); }
    { const p = BPS.bookingPaymentSummary({ ratePerNight: 3300, nights: 2, rooms: 2, paidTotal: 13200, razorpayPaymentId: "pay_x", message: null }); eqv(p.bookingValue, 13200, "F.14 value = rate×nights×rooms"); eqv(p.paidRecorded, 13200, "F.14p recorded paid"); eqv(p.paymentState, "recorded_online", "F.14s"); }
    { const p = BPS.bookingPaymentSummary({ ratePerNight: 3300, nights: 1, rooms: 1, paidTotal: null, message: "Razorpay: pay_x" }); eqv(p.paidRecorded, null, "F.15 marker without amount → amount not fabricated"); eqv(p.paymentState, "recorded_online", "F.15s marker still counts as recorded"); }

    global.fetch = savedFetch;
    Module._resolveFilename = origResolve;

    // ═══════════ G. source / migration wiring scans ═══════════
    section("G. wiring — assign route authority, dashboard truth, migration + privilege contract, customer read");
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
    const assignSrc = strip(read("app/api/partner/room-units/assign/route.ts"));
    ok(!/decodeJwt/.test(assignSrc), "G.1 assign route no longer uses decode-only JWT authority");
    ok(/resolveVerifiedPartnerScope/.test(assignSrc) && /scope\.hotelIds\.includes/.test(assignSrc), "G.2 assign route uses the cryptographic partner authority + exact-hotel scope");
    ok(/validateAssignmentSet/.test(assignSrc) && /findUnitConflicts/.test(assignSrc) && /readUnits/.test(assignSrc), "G.3 assign route re-reads units + conflicts server-side and validates the set");
    ok(/assignmentLifecycleGate\(/.test(assignSrc) && /stay_completed/.test(assignSrc) && /unassign_not_allowed_in_house/.test(assignSrc), "G.4 assign route applies the lifecycle gate; completed-stay freeze + in-house unassign refusal present");
    ok(!/^export (async )?function (?!POST|DELETE|GET|PATCH|PUT)/m.test(read("app/api/partner/room-units/assign/route.ts")) && !/^export function feedbackWindowNotificationId/m.test(read("app/api/partner/checkout/[bidId]/route.ts")), "G.4b route files export only Next.js handlers (no stray named exports)");
    const dash = read("app/partner/dashboard/page.tsx");
    ok(!/Total Revenue/.test(dash), "G.5 dashboard no longer labels booking value 'Total Revenue'");
    ok(/bookingPaymentSummary\(/.test(dash) && /Booking value/.test(dash) && /Paid online \(recorded\)/.test(dash), "G.6 dashboard shows booking value vs recorded payment");
    ok(/bookingDetailStatus\(/.test(dash), "G.7 dashboard status label comes from the lifecycle-precedence helper");
    ok(!/tel:\$\{b\.guestPhone/.test(dash) && /tel:\$\{contact\.phone\}/.test(dash) && /normalizeGuestContact\(/.test(dash), "G.8 tel: links only from a classified phone (never raw guestPhone)");
    ok(/early_checkout_confirmation_required/.test(dash) && /confirmEarly: true/.test(dash), "G.9 dashboard handles the explicit early-checkout confirmation");
    ok(/evaluateCheckInWindow\(/.test(dash) && /disabled=\{!win\.ok\}/.test(dash), "G.10 Mark Check-in mirrors the temporal window (server stays authoritative)");
    ok(/action: "transfer"|"transfer", reason/.test(dash) && /room history is frozen/i.test(dash), "G.11 modal: in-house transfer is explicit; completed stay frozen");
    const mig = read("migrations/2026-09-13-v753-stay-lifecycle-ops-unit-assignment-lines.sql");
    ok(/NOT APPLIED TO PRODUCTION/.test(mig), "G.12 migration is explicitly marked NOT APPLIED");
    ok(/create table if not exists public\.bid_unit_assignment_lines/.test(mig), "G.13 migration creates the lines table");
    ok(/uniq_bual_active_bid_unit/.test(mig) && /uniq_bual_active_bid_slot/.test(mig), "G.14 partial unique (bid,unit) + (bid,slot) on active lines");
    ok(/alter table public\.bid_unit_assignment_lines enable row level security/.test(mig) && /force\s+row level security/.test(mig), "G.15 lines table RLS enabled + forced");
    ok(/drop policy if exists all_anon_all on public\.bid_unit_assignments/.test(mig) && /revoke all on public\.bid_unit_assignments from anon, authenticated/.test(mig), "G.16 legacy table: permissive policy dropped + client grants revoked");
    ok(/grant\s+all on public\.bid_unit_assignments to\s+service_role/.test(mig) && /grant\s+all on public\.bid_unit_assignment_lines to\s+service_role/.test(mig), "G.17 service_role path preserved on both tables");
    ok(/insert into public\.bid_unit_assignment_lines/.test(mig) && /on conflict \(id\) do nothing/.test(mig), "G.18 idempotent backfill of legacy rows");
    ok(/excl_bual_unit_night_overlap/.test(mig) && /exclude using gist/.test(mig) && /daterange\(stay_from, stay_to, '\[\)'\)/.test(mig) && /btree_gist/.test(mig), "G.18b DB EXCLUDE constraint: same unit never on overlapping nights (active, dated lines)");
    ok(/b\."assignedUnitId" is not null/.test(mig) && /b\.status in \('ACCEPTED','CONFIRMED','CHECKED_IN'\)/.test(mig), "G.18c backfill also covers live stays stamped only on bids.assignedUnitId");
    const mine = read("app/api/my/unit-assignments/route.ts");
    ok(/bid_unit_assignment_lines/.test(mine) && /bid_unit_assignments\?bidId=in/.test(mine) && /customerId=in\./.test(mine), "G.19 customer allocated-room read: lines first, legacy fallback, scoped to own bids");
    const checkinSrc = strip(read("app/api/partner/checkin/[bidId]/route.ts"));
    ok(/status\s*!==\s*["']ACCEPTED["']/.test(checkinSrc) && /evaluateCheckInWindow/.test(checkinSrc) && /evaluateCheckInAssignment/.test(checkinSrc), "G.20 check-in keeps the ACCEPTED pre-state and adds temporal + unit gates");
    ok(!/bid_paid_amounts/.test(checkinSrc) && !/\bbid\s*\??\.\s*message\b/.test(checkinSrc), "G.21 check-in still never reads forgeable payment markers (no invented pay-before-check-in policy)");
    const checkoutSrc = strip(read("app/api/partner/checkout/[bidId]/route.ts"));
    ok(/status\s*!==\s*["']CHECKED_IN["']/.test(checkoutSrc) && /!==\s*["']checked_in["']/.test(checkoutSrc), "G.22 checkout keeps the CHECKED_IN + checked_in-evidence precondition");
    ok(/feedbackWindowNotificationId/.test(checkoutSrc) && /id: nid/.test(checkoutSrc), "G.23 checkout notification insert carries an explicit id");
  } catch (err) {
    fatal = err;
    console.error("\n• FATAL: " + (err && err.message ? err.message : String(err)));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")");
  }
  section("RESULT");
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
  if (fatal) process.exitCode = 2;
  else if (fail > 0) process.exitCode = 1;
  else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
