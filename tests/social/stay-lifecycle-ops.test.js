#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// STAY-LIFECYCLE-OPS-01 — consolidated stay-lifecycle operations regression.
//   Run: node tests/social/stay-lifecycle-ops.test.js
// ZERO live network / Railway / Supabase. Compiles the REAL hardened routes
// (partner check-in, check-out, room-unit assign, walk-in blocks, customer
// unit-assignment read) + their real deps with the lockfile tsc, then drives the
// real handlers against an in-memory PostgREST fake (simple filter grammar,
// every write captured per table, the four atomic stay RPCs emulated with the
// SAME refusal codes / P0001 wire shape as the migration — the REAL SQL is proven
// separately by tests/concurrency/stay-unit-assignment.pg.test.js against a real
// PostgreSQL). Also drives the pure shared libs (stay-dates, unit-assignments
// validators, booking-detail status, guest-contact, booking-payment-summary)
// and scans the UI / migration / writer-inventory sources for the contracts.
//
// Required coverage (owner list + owner-controller M1–M4):
//   temporal: premature rejected · same-day accepted · late accepted · window
//   closed · dates unavailable fail-closed
//   units: missing units rejected · wrong-hotel / wrong-category / inactive /
//   conflicting rejected · N-room needs N distinct · legacy fallback
//   authority: forged / decode-only / id-only rejected · exact-hotel partner ok
//   M1: every assignment WRITE is the atomic RPC (no multi-step JS write path);
//   RPC refusal → 409 with the previous state untouched; RPC missing → 503 and
//   ZERO writes (no non-atomic fallback)
//   M2: writer inventory — the only bids.assignedUnitId writers are the unit-
//   level booking INSERT (covered by the DB sync trigger) and the RPC
//   M3: walk-in route on the verified partner + exact-hotel scope; a client unit
//   pin never bypasses hotel/category/active/overlap; unit number server-derived;
//   DB guard refusal → 409; room_blocks unit-writer inventory covered by the guard
//   M4: customer unit-assignment read uses the cryptographic customer authority
//   (forged / alg:none / id-only / RS256-shaped / expired → 401; own bids only)
//   checkout: only from CHECKED_IN+evidence · early checkout explicit+audited ·
//   valid checkout creates feedback/video/notification idempotently · invalid
//   creates ZERO downstream rows · notification insert contract (id present)
//   history: completed stay ordinary reassignment blocked · in-house transfer
//   explicit · unassign rules
//   display: CHECKED_OUT never "Upcoming" · email never tel: · unpaid value never
//   revenue
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
  "walk-in-route.ts": "app/api/partner/walk-in/route.ts",
  "my-unit-assignments-route.ts": "app/api/my/unit-assignments/route.ts",
  "supabase-admin.ts": "lib/onboard/supabase-admin.ts",
  "verified-partner-authority.ts": "lib/auth/verified-partner-authority.ts",
  "verified-partner-authority-factory.ts": "lib/auth/verified-partner-authority-factory.ts",
  "verified-partner-hotel-scope.ts": "lib/auth/verified-partner-hotel-scope.ts",
  "verified-stay-evidence.ts": "lib/stay/verified-stay-evidence.ts",
  "customer-verify.ts": "lib/auth/customer-verify.ts",
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
  "@/lib/auth/customer-verify": "customer-verify",
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
const OTHER_CUSTOMER = "cust_someone_else_0000000001";
const OCCUPYING = ["ACCEPTED", "CONFIRMED", "CHECKED_IN"];

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
    console.log("• Local tsc compile: exit 0, clean (strict) — checkin + checkout + assign + walk-in + customer-read routes + stay libs");

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
    const WALKIN = require(path.join(OUT, "walk-in-route.js"));
    const MINE = require(path.join(OUT, "my-unit-assignments-route.js"));
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
    const READS = {};
    let LINES_MISSING = false;     // simulate the lines table not applied yet (reads fall back to legacy)
    let LINES_READ_FAIL = false;   // simulate a lines-table read failure (500)
    let RPC_MISSING = false;       // simulate the atomic RPCs not applied yet (PGRST202) → writes fail closed
    let RPC_EXCLUDE = false;       // simulate the DB EXCLUDE constraint refusing the RPC's insert (23P01)
    let RPC_FORCE_REFUSE = null;   // simulate a refusal decided UNDER the DB lock (lost race) — code
    let BLOCK_GUARD_REFUSE = null; // simulate the room_blocks guard trigger refusing a unit pin — code
    let REQUESTS_READ_FAIL = false;
    let NOTIF_INSERT_FAIL = false;
    let lineSeq = 0;
    const reset = () => {
      for (const k of Object.keys(DB)) delete DB[k];
      for (const k of Object.keys(WRITES)) delete WRITES[k];
      for (const k of Object.keys(READS)) delete READS[k];
      Object.assign(DB, {
        bids: [], bid_requests: [], hotel_room_units: [], bid_unit_assignment_lines: [], bid_unit_assignments: [], users: [],
        room_blocks: [], verified_partner_hotel_scope: [{ partner_subject: SUBJECT, hotel_id: HOTEL, status: "active" }],
        verified_stay_evidence: [], checkin_checkout_logs: [], notifications: [], feedback_tracking: [], video_lifecycle: [], vp_requests: [],
      });
      LINES_MISSING = false; LINES_READ_FAIL = false; RPC_MISSING = false; RPC_EXCLUDE = false; RPC_FORCE_REFUSE = null; BLOCK_GUARD_REFUSE = null;
      REQUESTS_READ_FAIL = false; NOTIF_INSERT_FAIL = false;
    };
    const jsonRes = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });
    const rpcErr = (code, detail = null) => jsonRes({ code: "P0001", message: code, details: detail, hint: null }, 400);

    // ── emulation of the migration's occupancy authority (same rules as the SQL) ──
    const conflictCount = (unitId, from, to, excludeBid, excludeBlock) => {
      let n = 0;
      for (const l of DB.bid_unit_assignment_lines) {
        if (l.unit_id !== unitId || l.status !== "active" || (excludeBid && l.bid_id === excludeBid)) continue;
        const b = DB.bids.find((x) => x.id === l.bid_id);
        if (!b || !OCCUPYING.includes(String(b.status || "").toUpperCase())) continue;
        const r = DB.bid_requests.find((x) => x.id === b.requestId);
        const f = l.stay_from || (r ? String(r.checkIn || "").slice(0, 10) : ""), tt = l.stay_to || (r ? String(r.checkOut || "").slice(0, 10) : "");
        if (!f || !tt || (f < to && from < tt)) n++;
      }
      for (const rb of DB.room_blocks) {
        if (String(rb.assignedUnitId || "") !== unitId || (excludeBlock && rb.id === excludeBlock)) continue;
        const f = String(rb.fromDate).slice(0, 10), tt = String(rb.toDate).slice(0, 10);
        if (f < to && from < tt) n++;
      }
      return n;
    };
    const validateUnit = (unitId, hotelId, roomId, from, to, excludeBid, excludeBlock) => {
      const u = DB.hotel_room_units.find((x) => x.id === unitId);
      if (!u) return "unit_not_found";
      if (String(u.hotelId) !== String(hotelId)) return "unit_wrong_hotel";
      if (String(u.roomId) !== String(roomId)) return "unit_wrong_category";
      if (String(u.status || "").toLowerCase() !== "active") return "unit_inactive";
      if (conflictCount(unitId, from, to, excludeBid, excludeBlock) > 0) return "unit_conflict";
      return null;
    };
    const guardBlock = (row, excludeBlockId) => {
      // BEFORE INSERT/UPDATE guard trigger emulation: validate + derive the number.
      if (!row.assignedUnitId) return null;
      if (BLOCK_GUARD_REFUSE) return BLOCK_GUARD_REFUSE;
      const code = validateUnit(String(row.assignedUnitId), row.hotelId, row.roomId, String(row.fromDate).slice(0, 10), String(row.toDate).slice(0, 10), null, excludeBlockId);
      if (code) return code;
      row.assignedUnitNumber = DB.hotel_room_units.find((x) => x.id === row.assignedUnitId).roomNumber; // never a client value
      return null;
    };
    const nextSlot = (bidId) => { let s = 1; while (DB.bid_unit_assignment_lines.some((l) => l.bid_id === bidId && l.status === "active" && l.slot === s)) s++; return s; };
    const rpc = (fn, a) => {
      (WRITES.rpc ||= []).push({ fn, args: a });
      if (RPC_MISSING) return jsonRes({ code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache`, details: null, hint: null }, 404);
      if (RPC_FORCE_REFUSE) return rpcErr(RPC_FORCE_REFUSE, Array.isArray(a.p_unit_ids) ? a.p_unit_ids[0] : a.p_unit_id || null);
      if (fn === "stay_assign_units") {
        const raw = (a.p_unit_ids || []).map((x) => String(x || "").trim()).filter(Boolean);
        const ids = raw.filter((x, i) => raw.indexOf(x) === i);
        if (!ids.length) return rpcErr("no_units");
        if (ids.length !== raw.length) return rpcErr("duplicate_unit");
        const bid = DB.bids.find((b) => b.id === a.p_bid_id); if (!bid) return rpcErr("bid_not_found");
        const st = String(bid.status || "").toUpperCase(), mode = String(a.p_mode || "assign").toLowerCase();
        if (st === "CHECKED_OUT") return rpcErr("stay_completed");
        if (st === "CHECKED_IN") { if (mode !== "transfer") return rpcErr("transfer_confirmation_required"); if (!String(a.p_reason || "").trim()) return rpcErr("transfer_reason_required"); }
        else if (!["ACCEPTED", "CONFIRMED"].includes(st)) return rpcErr("bid_not_reservable");
        else if (mode === "transfer") return rpcErr("transfer_only_while_checked_in");
        const required = Math.max(1, Number(bid.numRooms) || 1);
        if (ids.length > required) return rpcErr("too_many_units");
        const r = DB.bid_requests.find((x) => x.id === bid.requestId);
        const from = r ? String(r.checkIn || "").slice(0, 10) : "", to = r ? String(r.checkOut || "").slice(0, 10) : "";
        if (!from || !to || from >= to) return rpcErr("stay_dates_unavailable");
        for (const u of ids) { const code = validateUnit(u, bid.hotelId, bid.roomId, from, to, bid.id, null); if (code) return rpcErr(code, u); }
        if (RPC_EXCLUDE) return jsonRes({ code: "23P01", message: "conflicting key value violates exclusion constraint \"excl_bual_unit_night_overlap\"", details: null, hint: null }, 409);
        // ── apply (all-or-nothing) ──
        const reason = mode === "transfer" ? "transfer: " + String(a.p_reason).trim().slice(0, 300) : "reassigned before check-in";
        const now = new Date().toISOString();
        DB.bid_unit_assignment_lines.forEach((l) => { if (l.bid_id === bid.id && l.status === "active" && !ids.includes(l.unit_id)) Object.assign(l, { status: "superseded", released_at: now, released_by: a.p_partner_subject, reason }); });
        for (const u of ids) {
          if (DB.bid_unit_assignment_lines.some((l) => l.bid_id === bid.id && l.unit_id === u && l.status === "active")) continue;
          const unit = DB.hotel_room_units.find((x) => x.id === u);
          DB.bid_unit_assignment_lines.push({ id: `bual_${bid.id}_${u}_${++lineSeq}`, bid_id: bid.id, hotel_id: bid.hotelId, room_id: bid.roomId, unit_id: u, unit_number: unit.roomNumber, slot: nextSlot(bid.id), status: "active", assigned_by: a.p_partner_subject, assigned_at: now, reason: mode === "transfer" ? reason : null, stay_from: from, stay_to: to });
        }
        const act = DB.bid_unit_assignment_lines.filter((l) => l.bid_id === bid.id && l.status === "active").sort((x, y) => x.slot - y.slot);
        const m = DB.bid_unit_assignments.find((x) => x.bidId === bid.id);
        const mrow = { bidId: bid.id, unitId: act[0].unit_id, unitNumber: act[0].unit_number, assignedBy: a.p_partner_subject, assignedAt: now };
        if (m) Object.assign(m, mrow); else DB.bid_unit_assignments.push(mrow);
        bid.assignedUnitId = act[0].unit_id;
        return jsonRes({ ok: true, action: mode, required, assigned: act.map((l) => ({ unitId: l.unit_id, unitNumber: l.unit_number, slot: l.slot })) });
      }
      if (fn === "stay_release_units") {
        const bid = DB.bids.find((b) => b.id === a.p_bid_id); if (!bid) return rpcErr("bid_not_found");
        const st = String(bid.status || "").toUpperCase();
        if (st === "CHECKED_OUT") return rpcErr("stay_completed");
        if (st === "CHECKED_IN") return rpcErr("unassign_not_allowed_in_house");
        const released = [];
        DB.bid_unit_assignment_lines.forEach((l) => { if (l.bid_id === bid.id && l.status === "active") { released.push(l.unit_id); Object.assign(l, { status: "released", released_at: new Date().toISOString(), released_by: a.p_partner_subject, reason: a.p_reason || "unassigned" }); } });
        DB.bid_unit_assignments = DB.bid_unit_assignments.filter((x) => x.bidId !== bid.id);
        bid.assignedUnitId = null;
        return jsonRes({ ok: true, released });
      }
      if (fn === "stay_assign_block_unit") {
        const blk = DB.room_blocks.find((b) => b.id === a.p_block_id); if (!blk) return rpcErr("block_not_found");
        if (!String(a.p_unit_id || "").trim()) return rpcErr("no_units");
        const draft = { ...blk, assignedUnitId: String(a.p_unit_id) };
        const code = guardBlock(draft, blk.id); if (code) return rpcErr(code, String(a.p_unit_id));
        Object.assign(blk, draft);
        return jsonRes({ ok: true, unitId: blk.assignedUnitId, unitNumber: blk.assignedUnitNumber });
      }
      if (fn === "stay_release_block_unit") {
        const blk = DB.room_blocks.find((b) => b.id === a.p_block_id); if (!blk) return rpcErr("block_not_found");
        blk.assignedUnitId = null; blk.assignedUnitNumber = null;
        return jsonRes({ ok: true });
      }
      return jsonRes({ code: "PGRST202", message: "unknown rpc " + fn }, 404);
    };

    const savedFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || "GET";
      let body = null;
      try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch {}
      const rm = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(u);
      if (rm) return rpc(rm[1], body || {});
      const m = /\/rest\/v1\/([a-z_]+)(\?(.*))?$/.exec(u);
      if (!m) return jsonRes([]);
      const table = m[1], qs = m[3] || "";
      const rows = DB[table] || [];
      (WRITES[table] ||= []);
      if (method === "GET") READS[table] = (READS[table] || 0) + 1;
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
        const arr = Array.isArray(body) ? body : [body];
        if (table === "room_blocks") {
          // guard trigger: validate the pin + derive the number BEFORE the row lands
          for (const r of arr) { const code = guardBlock(r, null); if (code) return rpcErr(code, r.assignedUnitId); if (!r.id) r.id = "rb_" + (++lineSeq); }
        }
        WRITES[table].push({ method, url: u, body });
        const oc = /on_conflict=([A-Za-z_]+)/.exec(qs);
        arr.forEach((r) => {
          const existing = oc ? rows.find((x) => String(x[oc[1]]) === String(r[oc[1]])) : null;
          if (existing) Object.assign(existing, r); else rows.push({ ...r });
        });
        return jsonRes(arr, 201);
      }
      if (method === "PATCH") {
        const targets = applyFilters(rows, qs);
        if (table === "room_blocks") {
          for (const r of targets) {
            const draft = { ...r, ...body };
            if (draft.assignedUnitId && (body.assignedUnitId !== undefined || body.fromDate !== undefined || body.toDate !== undefined)) {
              const code = guardBlock(draft, r.id); if (code) return rpcErr(code, draft.assignedUnitId);
              body = { ...body, assignedUnitNumber: draft.assignedUnitNumber };
            }
          }
        }
        WRITES[table].push({ method, url: u, body });
        targets.forEach((r) => Object.assign(r, body));
        return jsonRes(targets.map((r) => ({ ...r })));
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
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const mkReq = (auth, body, url = "https://x.test/api") => ({
      url,
      headers: { get: (k) => (String(k).toLowerCase() === "authorization" ? auth : null) },
      json: async () => body ?? {},
    });
    const wcount = (t, method) => (WRITES[t] || []).filter((w) => !method || w.method === method).length;
    const rpcCalls = (fn) => (WRITES.rpc || []).filter((w) => !fn || w.fn === fn);
    const tableWrites = () => wcount("bid_unit_assignment_lines") + wcount("bid_unit_assignments") + wcount("bids");

    // seeding helpers
    const seedUnit = (id, extra = {}) => { DB.hotel_room_units.push({ id, hotelId: HOTEL, roomId: ROOM, roomNumber: id.replace("u", "10"), status: "active", ...extra }); };
    const seedBid = (id, status, { ci = TODAY, co = D(1), numRooms = 1, hotelId = HOTEL, roomId = ROOM, requestId = "req_" + id, assignedUnitId = null, customerId = CUSTOMER } = {}) => {
      DB.bids.push({ id, hotelId, roomId, customerId, status, numRooms, requestId, assignedUnitId });
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
    const walkinPost = async (body, auth = authToken()) => { const r = await WALKIN.POST(mkReq(auth, body)); return { status: r.status, body: r.body }; };
    const walkinPatch = async (body, auth = authToken()) => { const r = await WALKIN.PATCH(mkReq(auth, body)); return { status: r.status, body: r.body }; };
    const walkinGet = async (qs, auth = authToken()) => { const r = await WALKIN.GET(mkReq(auth, null, "https://x.test/api/partner/walk-in?" + qs)); return { status: r.status, body: r.body }; };
    const walkinDelete = async (qs, auth = authToken()) => { const r = await WALKIN.DELETE(mkReq(auth, null, "https://x.test/api/partner/walk-in?" + qs)); return { status: r.status, body: r.body }; };
    const mine = async (body, auth) => { const r = await MINE.POST(mkReq(auth, body)); return { status: r.status, body: r.body }; };
    const evWrites = () => wcount("verified_stay_evidence", "POST");
    const activeLines = (bidId) => DB.bid_unit_assignment_lines.filter((l) => l.bid_id === bidId && l.status === "active").sort((a, b) => a.slot - b.slot);
    const allLines = (bidId) => DB.bid_unit_assignment_lines.filter((l) => l.bid_id === bidId);
    const mirrorOf = (bidId) => DB.bid_unit_assignments.find((x) => x.bidId === bidId) || null;
    const bidOf = (bidId) => DB.bids.find((b) => b.id === bidId);

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
    reset(); seedCategory(); seedBid("c_stamp", "ACCEPTED", { assignedUnitId: "u2" });
    { const r = await checkin("c_stamp"); eqv(r.status, 200, "C.11b lines mode + bids.assignedUnitId stamped (no line) → still counts as assigned → 200"); eqv(evWrites(), 1, "C.11bw one evidence write"); }
    reset(); seedCategory(); seedBid("c_stamp_bad", "ACCEPTED", { assignedUnitId: "ux_cat" });
    { const r = await checkin("c_stamp_bad"); eqv(r.status, 409, "C.11c stamped unit of the wrong category is still rejected"); eqv(r.body.error, "assigned_unit_invalid", "C.11ce"); }
    ok(UA.requiredUnitCount({ numRooms: 3 }) === 3 && UA.requiredUnitCount({ numRooms: 0 }) === 1 && UA.requiredUnitCount({}) === 1, "C.12 requiredUnitCount = max(1, numRooms)");
    ok(UA.evaluateCheckInAssignment({ bid: { id: "x", hotelId: HOTEL, roomId: ROOM, numRooms: 1 }, configuredActiveUnits: 0, assignedUnitIds: [], units: [] }).skipped === true, "C.13 no configured units → skipped");

    // ═══════════ D. assign route — authority + integrity + ATOMIC RPC contract ═══════════
    section("D. room-unit assign route — verified authority + server-side integrity + atomic RPC (M1)");
    reset(); seedCategory(); seedBid("d_ok", "ACCEPTED");
    { const wrong = "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" });
      const r1 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, wrong); eqv(r1.status, 401, "D.1 wrong-secret forged token → 401");
      const none = `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUBJECT })}.`;
      const r2 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, none); eqv(r2.status, 401, "D.2 alg:none / decode-only token → 401");
      const r3 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, "Bearer " + signP({ id: SUBJECT })); eqv(r3.status, 401, "D.3 id-only token (no sub) → 401");
      const r4 = await assign({ bidId: "d_ok", unitIds: ["u1"] }, ""); eqv(r4.status, 401, "D.4 missing token → 401");
      ok(rpcCalls().length === 0 && tableWrites() === 0, "D.1-4w ZERO RPC calls + ZERO table writes on every rejected token"); }
    { const r = await assign({ bidId: "d_ok", unitIds: ["u1"] }); eqv(r.status, 200, "D.5 valid partner + exact hotel + ACCEPTED bid + valid unit → 200");
      eqv(r.body.mode, "atomic", "D.5mode response mode 'atomic'"); ok(r.body.ok === true && r.body.assigned && r.body.assigned[0].unitId === "u1" && r.body.assigned[0].slot === 1, "D.5b body carries the assigned set");
      eqv(rpcCalls("stay_assign_units").length, 1, "D.5r exactly ONE stay_assign_units RPC call");
      const a = rpcCalls("stay_assign_units")[0].args; ok(a.p_bid_id === "d_ok" && JSON.stringify(a.p_unit_ids) === JSON.stringify(["u1"]) && a.p_partner_subject === SUBJECT && a.p_mode === "assign" && a.p_reason === null, "D.5a RPC args: bid, raw unit list, VERIFIED subject, mode assign");
      ok(tableWrites() === 0, "D.5t the route performs ZERO direct table writes (no multi-step JS write path)");
      const l = activeLines("d_ok"); ok(l.length === 1 && l[0].unit_id === "u1" && l[0].hotel_id === HOTEL && l[0].room_id === ROOM && l[0].slot === 1 && l[0].assigned_by === SUBJECT, "D.5f resulting line carries bid/unit/hotel/category/slot/verified subject");
      ok(l[0].stay_from === TODAY && l[0].stay_to === D(1), "D.5s line carries stay_from / stay_to (EXCLUDE input)");
      ok(mirrorOf("d_ok") && mirrorOf("d_ok").unitId === "u1", "D.5m legacy slot-1 mirror row present"); eqv(bidOf("d_ok").assignedUnitId, "u1", "D.5c bids.assignedUnitId mirrored to slot 1"); }
    reset(); seedCategory(); DB.bids.push({ id: "d_other", hotelId: OTHER_HOTEL, roomId: ROOM, customerId: CUSTOMER, status: "ACCEPTED", numRooms: 1, requestId: "req_d_other" }); DB.bid_requests.push({ id: "req_d_other", checkIn: TODAY + "T00:00:00", checkOut: D(1) + "T00:00:00" });
    { const r = await assign({ bidId: "d_other", unitIds: ["ux_other"] }); eqv(r.status, 403, "D.6 partner not bound to the bid's hotel → 403"); ok(rpcCalls().length === 0 && tableWrites() === 0, "D.6w ZERO RPC / writes"); }
    reset(); seedCategory(); seedBid("d_wh", "ACCEPTED");
    { const r = await assign({ bidId: "d_wh", unitIds: ["ux_other"] }); eqv(r.status, 409, "D.7 unit of ANOTHER hotel → 409"); eqv(r.body.error, "unit_wrong_hotel", "D.7e unit_wrong_hotel"); ok(rpcCalls().length === 0, "D.7w ZERO RPC calls (fast-path refusal)"); }
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
    reset(); seedCategory(); seedBid("d_c1", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_hold", "ACCEPTED", { ci: D(1), co: D(3) }); seedLine("d_hold", "u1");
    { const r = await assign({ bidId: "d_c1", unitIds: ["u1"] }); eqv(r.status, 409, "D.13 unit held by ANOTHER live bid on overlapping nights → 409"); eqv(r.body.error, "unit_conflict", "D.13e unit_conflict");
      const r2 = await assign({ bidId: "d_c1", unitIds: ["u2"] }); eqv(r2.status, 200, "D.13b a free unit in the same category is accepted"); }
    reset(); seedCategory(); seedBid("d_c2", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_far", "ACCEPTED", { ci: D(5), co: D(7) }); seedLine("d_far", "u1");
    { const r = await assign({ bidId: "d_c2", unitIds: ["u1"] }); eqv(r.status, 200, "D.14 unit held on NON-overlapping nights → accepted"); }
    reset(); seedCategory(); seedBid("d_c3", "ACCEPTED", { ci: TODAY, co: D(2) }); seedBid("d_done", "CHECKED_OUT", { ci: TODAY, co: D(2) }); seedLine("d_done", "u1");
    { const r = await assign({ bidId: "d_c3", unitIds: ["u1"] }); eqv(r.status, 200, "D.15 unit whose previous stay is CHECKED_OUT does not conflict"); }
    reset(); seedCategory(); seedBid("d_c4", "ACCEPTED", { ci: TODAY, co: D(2) }); DB.room_blocks.push({ id: "blk1", hotelId: HOTEL, roomId: ROOM, assignedUnitId: "u1", fromDate: D(1), toDate: D(3) });
    { const r = await assign({ bidId: "d_c4", unitIds: ["u1"] }); eqv(r.status, 409, "D.16 unit pinned to an overlapping walk-in block → 409"); eqv(r.body.error, "unit_conflict", "D.16e"); }
    reset(); seedCategory(); seedBid("d_n", "ACCEPTED", { numRooms: 2 });
    { const r = await assign({ bidId: "d_n", unitIds: ["u1", "u2"] }); eqv(r.status, 200, "D.17 2-room booking → 2 distinct units accepted");
      const l = activeLines("d_n"); eqv(l.length, 2, "D.17l two active lines"); ok(l[0].slot === 1 && l[1].slot === 2, "D.17s slots 1 and 2"); eqv(r.body.required, 2, "D.17r required 2"); eqv(JSON.stringify(rpcCalls("stay_assign_units")[0].args.p_unit_ids), JSON.stringify(["u1", "u2"]), "D.17a both units in ONE RPC call"); }
    // lifecycle / history
    reset(); seedCategory(); seedBid("d_out", "CHECKED_OUT"); seedLine("d_out", "u1");
    { const r = await assign({ bidId: "d_out", unitIds: ["u2"] }); eqv(r.status, 409, "D.18 COMPLETED stay → ordinary reassignment BLOCKED"); eqv(r.body.error, "stay_completed", "D.18e stay_completed"); ok(rpcCalls().length === 0 && tableWrites() === 0, "D.18w ZERO RPC / writes — history frozen");
      const r2 = await assign({ bidId: "d_out", unitIds: ["u2"], action: "transfer", reason: "x" }); eqv(r2.status, 409, "D.18t even an explicit transfer is refused on a completed stay"); }
    reset(); seedCategory(); seedBid("d_house", "CHECKED_IN"); seedLine("d_house", "u1");
    { const r = await assign({ bidId: "d_house", unitIds: ["u2"] }); eqv(r.status, 409, "D.19 in-house guest: ordinary assign refused"); eqv(r.body.error, "transfer_confirmation_required", "D.19e");
      const r2 = await assign({ bidId: "d_house", unitIds: ["u2"], action: "transfer" }); eqv(r2.status, 400, "D.19r transfer without a reason refused"); eqv(r2.body.error, "transfer_reason_required", "D.19re");
      ok(rpcCalls().length === 0, "D.19w gate refusals never reach the RPC");
      const r3 = await assign({ bidId: "d_house", unitIds: ["u2"], action: "transfer", reason: "AC failure in 101" }); eqv(r3.status, 200, "D.19t explicit transfer with reason → 200");
      const a = rpcCalls("stay_assign_units")[0].args; ok(a.p_mode === "transfer" && a.p_reason === "AC failure in 101", "D.19a RPC receives mode transfer + the reason");
      const old = allLines("d_house").find((l) => l.unit_id === "u1"); ok(!!old && old.status === "superseded" && /transfer: AC failure/.test(old.reason) && old.released_by === SUBJECT, "D.19h old line SUPERSEDED with the audited reason (not deleted)");
      const nw = activeLines("d_house"); ok(nw.length === 1 && nw[0].unit_id === "u2" && /transfer:/.test(nw[0].reason), "D.19n new line active for the new room, reason recorded");
      eqv(allLines("d_house").length, 2, "D.19d nothing deleted (history = 2 rows)"); eqv(mirrorOf("d_house").unitId, "u2", "D.19m mirror follows"); eqv(bidOf("d_house").assignedUnitId, "u2", "D.19c column follows"); }
    reset(); seedCategory(); seedBid("d_pend", "PENDING");
    { const r = await assign({ bidId: "d_pend", unitIds: ["u1"] }); eqv(r.status, 409, "D.20 PENDING bid holds no reservation → 409"); eqv(r.body.error, "bid_not_reservable", "D.20e"); }
    // M1 — pre-migration (RPC missing): fail CLOSED, no non-atomic fallback write
    reset(); seedCategory(); seedBid("d_pre", "ACCEPTED"); RPC_MISSING = true;
    { const r = await assign({ bidId: "d_pre", unitIds: ["u1"] }); eqv(r.status, 503, "D.21 RPC not applied (PGRST202) → 503 fail closed"); eqv(r.body.error, "unit_assignment_rpc_unavailable", "D.21e unit_assignment_rpc_unavailable");
      ok(tableWrites() === 0 && allLines("d_pre").length === 0 && !mirrorOf("d_pre") && bidOf("d_pre").assignedUnitId === null, "D.21w ZERO writes — NO legacy / non-atomic fallback write exists"); }
    reset(); seedCategory(); seedBid("d_pre2", "ACCEPTED", { numRooms: 2 }); RPC_MISSING = true; LINES_MISSING = true;
    { const r = await assign({ bidId: "d_pre2", unitIds: ["u1", "u2"] }); eqv(r.status, 503, "D.22 fully pre-migration (lines + RPC missing), multi-unit → 503"); ok(tableWrites() === 0, "D.22w ZERO writes"); }
    reset(); seedCategory(); seedBid("d_pre3", "ACCEPTED"); seedLine("d_pre3", "u1"); RPC_MISSING = true;
    { const r = await unassign("bidId=d_pre3"); eqv(r.status, 503, "D.22b DELETE pre-migration → 503"); ok(activeLines("d_pre3").length === 1 && tableWrites() === 0, "D.22bw nothing released outside the RPC"); }
    // M1 — refusal decided UNDER the DB lock (lost race) → 409, previous state intact
    reset(); seedCategory(); seedBid("d_race", "ACCEPTED"); seedLine("d_race", "u1"); DB.bid_unit_assignments.push({ bidId: "d_race", unitId: "u1", unitNumber: "101" }); bidOf("d_race").assignedUnitId = "u1"; RPC_FORCE_REFUSE = "unit_conflict";
    { const r = await assign({ bidId: "d_race", unitIds: ["u2"] }); eqv(r.status, 409, "D.23 RPC refusal under the lock (lost race) → 409"); eqv(r.body.error, "unit_conflict", "D.23e unit_conflict"); eqv(r.body.unitId, "u2", "D.23u refused unit id from RPC DETAIL");
      const l = activeLines("d_race"); ok(l.length === 1 && l[0].unit_id === "u1" && l[0].status === "active", "D.23p previous active assignment INTACT"); ok(mirrorOf("d_race").unitId === "u1" && bidOf("d_race").assignedUnitId === "u1", "D.23m mirror + column untouched"); ok(allLines("d_race").length === 1, "D.23n no partial line for u2"); }
    reset(); seedCategory(); seedBid("d_map", "ACCEPTED");
    { RPC_FORCE_REFUSE = "stay_dates_unavailable"; let r = await assign({ bidId: "d_map", unitIds: ["u1"] }); eqv(r.status, 409, "D.24a RPC stay_dates_unavailable → 409");
      RPC_FORCE_REFUSE = "transfer_reason_required"; r = await assign({ bidId: "d_map", unitIds: ["u1"] }); eqv(r.status, 400, "D.24b RPC transfer_reason_required → 400");
      RPC_FORCE_REFUSE = "bid_not_found"; r = await assign({ bidId: "d_map", unitIds: ["u1"] }); eqv(r.status, 404, "D.24c RPC bid_not_found → 404");
      RPC_FORCE_REFUSE = "stay_completed"; r = await assign({ bidId: "d_map", unitIds: ["u1"] }); eqv(r.status, 409, "D.24d RPC stay_completed → 409"); }
    // DB EXCLUDE constraint refusing the RPC's insert (23P01) → 409 unit_conflict, rolled back
    reset(); seedCategory(); seedBid("d_excl", "ACCEPTED"); RPC_EXCLUDE = true;
    { const r = await assign({ bidId: "d_excl", unitIds: ["u1"] }); eqv(r.status, 409, "D.25 DB exclusion violation inside the RPC → 409"); eqv(r.body.error, "unit_conflict", "D.25e unit_conflict"); ok(allLines("d_excl").length === 0 && !mirrorOf("d_excl") && bidOf("d_excl").assignedUnitId === null, "D.25w nothing written (transaction rolled back)"); }
    // DELETE rules
    reset(); seedCategory(); seedBid("d_del_out", "CHECKED_OUT"); seedLine("d_del_out", "u1");
    { const r = await unassign("bidId=d_del_out"); eqv(r.status, 409, "D.26 unassign on a completed stay → 409 stay_completed"); eqv(r.body.error, "stay_completed", "D.26e"); ok(rpcCalls().length === 0, "D.26w no RPC"); }
    reset(); seedCategory(); seedBid("d_del_in", "CHECKED_IN"); seedLine("d_del_in", "u1");
    { const r = await unassign("bidId=d_del_in"); eqv(r.status, 409, "D.27 unassign on an in-house guest → 409 (transfer instead)"); eqv(r.body.error, "unassign_not_allowed_in_house", "D.27e"); }
    reset(); seedCategory(); seedBid("d_del_ok", "ACCEPTED"); seedLine("d_del_ok", "u1"); DB.bid_unit_assignments.push({ bidId: "d_del_ok", unitId: "u1", unitNumber: "101" }); bidOf("d_del_ok").assignedUnitId = "u1";
    { const r = await unassign("bidId=d_del_ok"); eqv(r.status, 200, "D.28 unassign before check-in → 200");
      eqv(rpcCalls("stay_release_units").length, 1, "D.28r ONE stay_release_units RPC"); ok(rpcCalls("stay_release_units")[0].args.p_partner_subject === SUBJECT, "D.28a verified subject passed");
      const l = allLines("d_del_ok"); ok(l.length === 1 && l[0].status === "released", "D.28h line RELEASED (audited), not deleted"); ok(!mirrorOf("d_del_ok"), "D.28m legacy mirror cleared"); eqv(bidOf("d_del_ok").assignedUnitId, null, "D.28c bids.assignedUnitId cleared"); ok(tableWrites() === 0, "D.28t ZERO direct table writes"); }
    { const wrong = "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" }); const r = await unassign("bidId=d_del_ok", wrong); eqv(r.status, 401, "D.29 DELETE with forged token → 401"); }
    // block path of the assign route
    reset(); seedCategory(); DB.room_blocks.push({ id: "blk_a", hotelId: HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" }); DB.room_blocks.push({ id: "blk_o", hotelId: OTHER_HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" });
    { let r = await assign({ blockId: "blk_o", unitIds: ["ux_other"] }); eqv(r.status, 403, "D.30 block of a hotel outside the partner scope → 403");
      r = await assign({ blockId: "blk_a", unitIds: ["u1", "u2"] }); eqv(r.status, 409, "D.30b two units on a block → 409"); eqv(r.body.error, "too_many_units", "D.30be");
      r = await assign({ blockId: "blk_a", unitIds: ["ux_cat"] }); eqv(r.status, 409, "D.30c wrong category → 409");
      r = await assign({ blockId: "blk_a", unitIds: ["u1"] }); eqv(r.status, 200, "D.30d valid pin → 200"); eqv(rpcCalls("stay_assign_block_unit").length, 1, "D.30r ONE stay_assign_block_unit RPC");
      const blk = DB.room_blocks.find((b) => b.id === "blk_a"); ok(blk.assignedUnitId === "u1" && blk.assignedUnitNumber === "101", "D.30n block pinned, number derived server-side");
      seedBid("d_blkc", "ACCEPTED", { ci: D(1), co: D(3) }); r = await assign({ bidId: "d_blkc", unitIds: ["u1"] }); eqv(r.status, 409, "D.30e the pinned block now conflicts with a bid assignment");
      r = await unassign("blockId=blk_a"); eqv(r.status, 200, "D.30f release block pin → 200"); ok(blk.assignedUnitId === null && blk.assignedUnitNumber === null, "D.30g cleared");
      RPC_MISSING = true; r = await assign({ blockId: "blk_a", unitIds: ["u1"] }); eqv(r.status, 503, "D.30h block pin pre-migration → 503"); }
    // pure lifecycle gate + validators
    eqv(UA.assignmentLifecycleGate("CHECKED_OUT", "assign", "").error, "stay_completed", "D.31 gate: completed stay frozen");
    eqv(UA.assignmentLifecycleGate("CHECKED_IN", "assign", "").error, "transfer_confirmation_required", "D.32 gate: in-house needs explicit transfer");
    ok(UA.assignmentLifecycleGate("CHECKED_IN", "transfer", "leak").ok === true, "D.33 gate: explicit transfer with reason ok");
    eqv(UA.assignmentLifecycleGate("ACCEPTED", "transfer", "x").error, "transfer_only_while_checked_in", "D.34 gate: transfer refused before check-in");
    { const v = UA.validateAssignmentSet({ bid: { id: "x", hotelId: HOTEL, roomId: ROOM, numRooms: 1 }, unitIds: [], units: [] }); eqv(v.error, "no_units", "D.35 empty set → no_units"); }
    ok(UA.staysOverlap("2026-09-13", "2026-09-15", "2026-09-15", "2026-09-17") === false, "D.36 checkout-exclusive ranges touching do not overlap");
    ok(UA.staysOverlap("2026-09-13", "2026-09-16", "2026-09-15", "2026-09-17") === true, "D.37 overlapping ranges overlap");
    ok(typeof UA.insertAssignmentLines === "undefined" && typeof UA.mirrorPrimaryAssignment === "undefined" && typeof UA.closeAssignmentLines === "undefined", "D.38 the non-atomic multi-step writers no longer exist in the store");
    ok(typeof UA.callStayRpc === "function", "D.39 callStayRpc is the only write primitive");
    { RPC_MISSING = true; const r = await UA.callStayRpc("stay_assign_units", {}); eqv(r.status, "missing", "D.40 callStayRpc maps PGRST202 → missing"); RPC_MISSING = false;
      RPC_FORCE_REFUSE = "unit_conflict"; const r2 = await UA.callStayRpc("stay_assign_units", { p_unit_ids: ["u9"] }); ok(r2.status === "refused" && r2.code === "unit_conflict" && r2.detail === "u9", "D.41 callStayRpc maps P0001 → refused{code, detail}"); RPC_FORCE_REFUSE = null; }

    // ═══════════ W. walk-in route — verified partner authority + unit-pin integrity (M3) ═══════════
    section("W. walk-in route — verified partner + exact hotel; client unit pin never bypasses hotel/category/active/overlap; number server-derived");
    const blockBody = (extra = {}) => ({ hotelId: HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), guestName: "Walk-in", ...extra });
    reset(); seedCategory();
    { const wrong = "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG_SECRET", { algorithm: "HS256" });
      let r = await walkinPost(blockBody({ assignedUnitId: "u1" }), wrong); eqv(r.status, 401, "W.1 forged partner token → 401");
      r = await walkinPost(blockBody(), `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: SUBJECT })}.`); eqv(r.status, 401, "W.2 alg:none / decode-only → 401");
      r = await walkinPost(blockBody(), "Bearer " + signP({ id: SUBJECT })); eqv(r.status, 401, "W.3 id-only (no sub) → 401");
      r = await walkinPost(blockBody(), ""); eqv(r.status, 401, "W.4 missing token → 401");
      ok(wcount("room_blocks") === 0, "W.1-4w ZERO room_blocks writes"); }
    { const r = await walkinPost(blockBody({ hotelId: OTHER_HOTEL })); eqv(r.status, 403, "W.5 hotel outside the partner's protected scope → 403"); ok(wcount("room_blocks") === 0, "W.5w ZERO writes"); }
    { const r = await walkinPost(blockBody()); eqv(r.status, 200, "W.6 valid unpinned block → 200"); ok(r.body.ok === true && r.body.block && r.body.block.createdBy === SUBJECT, "W.6c createdBy = VERIFIED subject"); eqv(DB.room_blocks.length, 1, "W.6r one row"); }
    reset(); seedCategory();
    { let r = await walkinPost(blockBody({ assignedUnitId: "ux_other" })); eqv(r.status, 409, "W.7 pin a unit of ANOTHER hotel → 409"); eqv(r.body.error, "unit_wrong_hotel", "W.7e");
      r = await walkinPost(blockBody({ assignedUnitId: "ux_cat" })); eqv(r.status, 409, "W.8 pin a unit of another CATEGORY → 409"); eqv(r.body.error, "unit_wrong_category", "W.8e");
      r = await walkinPost(blockBody({ assignedUnitId: "u3" })); eqv(r.status, 409, "W.9 pin an INACTIVE unit → 409"); eqv(r.body.error, "unit_inactive", "W.9e");
      r = await walkinPost(blockBody({ assignedUnitId: "u_ghost" })); eqv(r.status, 409, "W.10 pin an unknown unit → 409"); eqv(r.body.error, "unit_not_found", "W.10e");
      r = await walkinPost(blockBody({ assignedUnitId: "u1", roomIds: [ROOM, OTHER_ROOM] })); eqv(r.status, 400, "W.11 a pin with multiple rooms → 400");
      ok(wcount("room_blocks") === 0 && DB.room_blocks.length === 0, "W.7-11w ZERO rows written"); }
    reset(); seedCategory(); seedBid("w_hold", "ACCEPTED", { ci: D(1), co: D(3) }); seedLine("w_hold", "u1"); DB.room_blocks.push({ id: "w_blk", hotelId: HOTEL, roomId: ROOM, fromDate: D(1), toDate: D(3), source: "walk_in", assignedUnitId: "u2", assignedUnitNumber: "102" });
    { let r = await walkinPost(blockBody({ assignedUnitId: "u1" })); eqv(r.status, 409, "W.12 pin a unit held by an overlapping BID line → 409"); eqv(r.body.error, "unit_conflict", "W.12e");
      r = await walkinPost(blockBody({ assignedUnitId: "u2" })); eqv(r.status, 409, "W.13 pin a unit held by an overlapping BLOCK → 409"); eqv(r.body.error, "unit_conflict", "W.13e");
      r = await walkinPost(blockBody({ assignedUnitId: "u1", fromDate: D(3), toDate: D(5) })); eqv(r.status, 200, "W.14 same unit on NON-overlapping nights → 200");
      ok(wcount("room_blocks", "POST") === 1, "W.12-14w exactly one row written"); }
    reset(); seedCategory();
    { const r = await walkinPost(blockBody({ assignedUnitId: "u1", assignedUnitNumber: "FORGED-999" })); eqv(r.status, 200, "W.15 pinned block → 200");
      const row = DB.room_blocks[0]; ok(row.assignedUnitId === "u1" && row.assignedUnitNumber === "101", "W.15n unit NUMBER derived from the unit row — the client value is ignored");
      const sent = WRITES.room_blocks[0].body; eqv(sent.assignedUnitNumber, "101", "W.15s the write itself carries the server-derived number (never the client's)"); }
    reset(); seedCategory(); BLOCK_GUARD_REFUSE = "unit_conflict";
    { const r = await walkinPost(blockBody({ assignedUnitId: "u1" })); eqv(r.status, 409, "W.16 DB guard trigger refuses the pin (lost race under the unit lock) → 409"); eqv(r.body.error, "unit_conflict", "W.16e"); eqv(DB.room_blocks.length, 0, "W.16w no row"); }
    // PATCH
    reset(); seedCategory(); DB.room_blocks.push({ id: "p_blk", hotelId: HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" }); DB.room_blocks.push({ id: "p_other", hotelId: OTHER_HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" }); seedBid("p_hold", "ACCEPTED", { ci: D(1), co: D(4) }); seedLine("p_hold", "u1");
    { let r = await walkinPatch({ id: "p_blk", guestName: "X" }, "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG", { algorithm: "HS256" })); eqv(r.status, 401, "W.17 PATCH forged → 401");
      r = await walkinPatch({ id: "p_other", guestName: "X" }); eqv(r.status, 403, "W.18 PATCH a block of another hotel → 403");
      r = await walkinPatch({ id: "p_blk", assignedUnitId: "ux_cat" }); eqv(r.status, 409, "W.19 PATCH pin of the wrong category → 409"); eqv(r.body.error, "unit_wrong_category", "W.19e");
      r = await walkinPatch({ id: "p_blk", assignedUnitId: "u1" }); eqv(r.status, 409, "W.20 PATCH pin onto a unit held by an overlapping stay → 409"); eqv(r.body.error, "unit_conflict", "W.20e");
      r = await walkinPatch({ id: "p_blk", assignedUnitId: "u2", assignedUnitNumber: "FORGED" }); eqv(r.status, 200, "W.21 PATCH valid pin → 200");
      const row = DB.room_blocks.find((b) => b.id === "p_blk"); ok(row.assignedUnitId === "u2" && row.assignedUnitNumber === "102", "W.21n number derived server-side on PATCH too");
      r = await walkinPatch({ id: "p_blk", toDate: D(3) }); eqv(r.status, 200, "W.22 PATCH dates while pinned re-validates → still free → 200");
      DB.bid_unit_assignment_lines.push({ id: "l_u2", bid_id: "p_hold", hotel_id: HOTEL, room_id: ROOM, unit_id: "u2", unit_number: "102", slot: 2, status: "active" });
      r = await walkinPatch({ id: "p_blk", toDate: D(4) }); eqv(r.status, 409, "W.23 PATCH dates onto an overlap with the pinned unit's other occupation → 409"); eqv(r.body.error, "unit_conflict", "W.23e");
      ok(String(row.toDate).slice(0, 10) === D(3), "W.23p refused PATCH left the row unchanged");
      r = await walkinPatch({ id: "p_blk", assignedUnitId: "" }); eqv(r.status, 200, "W.24 PATCH clearing the pin → 200"); ok(row.assignedUnitId === null && row.assignedUnitNumber === null, "W.24n number cleared with the pin");
      ok(wcount("room_blocks", "PATCH") === 3, "W.24w exactly three PATCH writes reached the table"); }
    // GET / DELETE
    reset(); seedCategory(); DB.room_blocks.push({ id: "g_blk", hotelId: HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" }); DB.room_blocks.push({ id: "g_other", hotelId: OTHER_HOTEL, roomId: ROOM, fromDate: TODAY, toDate: D(2), source: "walk_in" });
    { let r = await walkinGet("hotelId=" + HOTEL, "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG", { algorithm: "HS256" })); eqv(r.status, 401, "W.25 GET forged → 401");
      r = await walkinGet("hotelId=" + OTHER_HOTEL); eqv(r.status, 403, "W.26 GET a hotel outside the scope → 403");
      r = await walkinGet("hotelId=" + HOTEL); eqv(r.status, 200, "W.27 GET own hotel → 200"); ok(Array.isArray(r.body.reservations) && r.body.reservations.length === 1 && r.body.reservations[0].id === "g_blk", "W.27r only the scoped hotel's blocks");
      r = await walkinDelete("id=g_other", authToken()); eqv(r.status, 403, "W.28 DELETE another hotel's block → 403"); eqv(DB.room_blocks.length, 2, "W.28w nothing deleted");
      r = await walkinDelete("id=g_blk", "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG", { algorithm: "HS256" })); eqv(r.status, 401, "W.29 DELETE forged → 401");
      r = await walkinDelete("id=g_blk"); eqv(r.status, 200, "W.30 DELETE own block → 200"); eqv(DB.room_blocks.length, 1, "W.30w row removed"); }

    // ═══════════ M4. customer unit-assignment read — cryptographic customer authority ═══════════
    section("M4. customer allocated-room read — verified HS256 customer only; forged / alg:none / id-only / RS256-shaped / expired → 401; own bids only");
    const seedMine = () => { reset(); seedCategory(); seedBid("m_own", "ACCEPTED", { numRooms: 2 }); seedLine("m_own", "u1", 1); seedLine("m_own", "u2", 2); seedBid("m_other", "ACCEPTED", { customerId: OTHER_CUSTOMER }); seedLine("m_other", "u2"); };
    const custToken = (claims = { sub: CUSTOMER }) => "Bearer " + jwt.sign(claims, PARTNER_SECRET, { algorithm: "HS256" });
    seedMine();
    { const reads = () => (READS.bids || 0) + (READS.bid_unit_assignment_lines || 0) + (READS.bid_unit_assignments || 0);
      let r = await mine({ bidIds: ["m_own", "m_other"] }, ""); eqv(r.status, 401, "M4.1 missing token → 401");
      r = await mine({ bidIds: ["m_own"] }, "Bearer " + jwt.sign({ sub: CUSTOMER }, "WRONG_SECRET", { algorithm: "HS256" })); eqv(r.status, 401, "M4.2 wrong-secret forged token → 401");
      r = await mine({ bidIds: ["m_own"] }, `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: CUSTOMER })}.`); eqv(r.status, 401, "M4.3 alg:none → 401");
      r = await mine({ bidIds: ["m_own"] }, `Bearer ${b64({ alg: "HS256", typ: "JWT" })}.${b64({ id: CUSTOMER })}.forgedsig`); eqv(r.status, 401, "M4.4 decode-only id-only token (unsigned) → 401");
      r = await mine({ bidIds: ["m_own"] }, `Bearer ${b64({ alg: "RS256", typ: "JWT", kid: "x" })}.${b64({ sub: CUSTOMER, iss: "https://securetoken.google.com/x" })}.garbage`); eqv(r.status, 401, "M4.5 RS256 / Firebase-shaped token → 401 (fail closed)");
      r = await mine({ bidIds: ["m_own"] }, "Bearer " + jwt.sign({ sub: CUSTOMER, exp: Math.floor(Date.now() / 1000) - 60 }, PARTNER_SECRET, { algorithm: "HS256" })); eqv(r.status, 401, "M4.6 expired token → 401");
      eqv(reads(), 0, "M4.1-6r ZERO bid / assignment reads before authentication"); }
    { const r = await mine({ bidIds: ["m_own", "m_other"] }, custToken()); eqv(r.status, 200, "M4.7 verified customer → 200");
      ok(r.body.assignments && r.body.assignments.m_own && !r.body.assignments.m_other, "M4.7o ONLY the caller's own bid is resolved — another guest's room is never returned");
      const a = r.body.assignments.m_own; ok(a.unitId === "u1" && a.unitNumber === "101" && JSON.stringify(a.unitNumbers) === JSON.stringify(["101", "102"]), "M4.7u slot-1 unit + all unit numbers"); }
    { const r = await mine({ bidIds: ["m_own"] }, custToken({ sub: OTHER_CUSTOMER })); eqv(r.status, 200, "M4.8 another verified customer → 200"); ok(!r.body.assignments.m_own, "M4.8o cannot read m_own's room"); }
    { const r = await mine({ bidIds: ["m_own"] }, custToken({ id: CUSTOMER, sub: CUSTOMER })); ok(r.status === 200 && r.body.assignments.m_own, "M4.9 verified Railway token carrying the compat id claim resolves"); }
    seedMine(); LINES_MISSING = true; DB.bid_unit_assignments.push({ bidId: "m_own", unitId: "u1", unitNumber: "101" }, { bidId: "m_other", unitId: "u2", unitNumber: "102" });
    { const r = await mine({ bidIds: ["m_own", "m_other"] }, custToken()); eqv(r.status, 200, "M4.10 lines table missing → legacy fallback"); ok(r.body.assignments.m_own && r.body.assignments.m_own.unitNumber === "101" && !r.body.assignments.m_other, "M4.10o legacy fallback still scoped to own bids"); }
    { const r = await mine({}, custToken()); ok(r.status === 200 && JSON.stringify(r.body.assignments) === "{}", "M4.11 empty request → empty map"); }

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
      const r2 = await checkout("e_ok", {}); eqv(r2.status, 200, "E.4 replay → 200"); ok(r2.body.alreadyCheckedOut === true, "E.4a alreadyCheckedOut"); const d2 = downstream(); ok(d2.fb === 1 && d2.vl === 1 && d2.nt === 1, "E.4w replay creates ZERO additional feedback/video/notification rows"); eqv(evWrites(), 1, "E.4ev ZERO evidence rewrite"); }
    reset(); seedBid("e_pre", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_pre", "checked_in"); DB.feedback_tracking.push({ booking_id: "e_pre" }); DB.video_lifecycle.push({ booking_id: "e_pre" }); DB.notifications.push({ id: "ntf_fbwin_e_pre" });
    { const r = await checkout("e_pre", {}); eqv(r.status, 200, "E.5 checkout with pre-existing downstream rows → 200"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0, "E.5w no duplicate feedback/video/notification rows"); ok(r.body.notificationQueued === true, "E.5q existing notification counts as queued"); }
    reset(); seedBid("e_early", "CHECKED_IN", { ci: D(-1), co: D(3) }); seedEvidence("e_early", "checked_in");
    { const r = await checkout("e_early", {}); eqv(r.status, 409, "E.6 early departure without confirmation → 409"); eqv(r.body.error, "early_checkout_confirmation_required", "E.6e"); eqv(r.body.scheduledCheckOut, D(3), "E.6s scheduled date returned"); eqv(evWrites(), 0, "E.6w ZERO evidence write"); const d = downstream(); ok(d.fb === 0 && d.vl === 0 && d.nt === 0, "E.6d ZERO downstream rows");
      const r2 = await checkout("e_early", { confirmEarly: true, reason: "family emergency" }); eqv(r2.status, 200, "E.7 confirmed early checkout → 200"); ok(r2.body.earlyCheckout === true, "E.7e earlyCheckout:true"); eqv(evWrites(), 1, "E.7ev evidence written");
      const log = (WRITES.checkin_checkout_logs || []).find((w) => w.method === "POST"); ok(!!log && /early checkout: scheduled/.test(String(log.body.notes)) && /family emergency/.test(String(log.body.notes)), "E.7a early checkout recorded in the lifecycle log notes with the reason"); }
    reset(); seedBid("e_nf", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_nf", "checked_in"); NOTIF_INSERT_FAIL = true;
    { const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(" ")); const r = await checkout("e_nf", {}); console.warn = ow;
      eqv(r.status, 200, "E.8 notification insert failure never blocks the verified checkout"); ok(r.body.notificationQueued === false, "E.8q response honestly reports notificationQueued:false"); ok(warns.some((w) => /notification NOT queued/.test(w)), "E.8l failure is LOGGED with a reason (not silently swallowed)"); }
    reset(); seedBid("e_auth", "CHECKED_IN", { ci: D(-1), co: TODAY }); seedEvidence("e_auth", "checked_in");
    { const r = await checkout("e_auth", {}, "Bearer " + jwt.sign({ sub: SUBJECT }, "WRONG", { algorithm: "HS256" })); eqv(r.status, 401, "E.9 forged token → 401"); const d = downstream(); ok(d.fb === 0 && d.nt === 0, "E.9w ZERO downstream"); }
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

    // ═══════════ G. source / migration wiring + WRITER INVENTORY scans ═══════════
    section("G. wiring — atomic write path, writer inventories (M2/M3), customer authority (M4), migration + privilege contract, dashboard truth");
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
    const walk = (dir, out = []) => { for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) { const p = path.posix.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
    const SRC_FILES = [...walk("app"), ...walk("lib"), ...walk("components")];
    const assignSrc = strip(read("app/api/partner/room-units/assign/route.ts"));
    ok(!/decodeJwt/.test(assignSrc), "G.1 assign route no longer uses decode-only JWT authority");
    ok(/resolveVerifiedPartnerScope/.test(assignSrc) && /scope\.hotelIds\.includes/.test(assignSrc), "G.2 assign route uses the cryptographic partner authority + exact-hotel scope");
    ok(/validateAssignmentSet/.test(assignSrc) && /findUnitConflicts/.test(assignSrc) && /readUnits/.test(assignSrc), "G.3 assign route re-reads units + conflicts server-side and validates the set");
    ok(/assignmentLifecycleGate\(/.test(assignSrc) && /stay_completed/.test(assignSrc) && /unassign_not_allowed_in_house/.test(assignSrc), "G.4 assign route applies the lifecycle gate; completed-stay freeze + in-house unassign refusal present");
    ok(!/^export (async )?function (?!POST|DELETE|GET|PATCH|PUT)/m.test(read("app/api/partner/room-units/assign/route.ts")) && !/^export function feedbackWindowNotificationId/m.test(read("app/api/partner/checkout/[bidId]/route.ts")), "G.4b route files export only Next.js handlers (no stray named exports)");
    // M1 — the ONLY write path is the atomic RPC
    ok(/callStayRpc\("stay_assign_units"/.test(assignSrc) && /callStayRpc\("stay_release_units"/.test(assignSrc) && /callStayRpc\("stay_assign_block_unit"/.test(assignSrc) && /callStayRpc\("stay_release_block_unit"/.test(assignSrc), "G.5 assign route writes ONLY through the four atomic RPCs");
    ok(!/method:\s*"(POST|PATCH|DELETE)"/.test(assignSrc) && !/sbInsert|sbPatch|sbUpsert|sbDelete/.test(assignSrc), "G.5b assign route performs NO direct table write of its own");
    ok(/unit_assignment_rpc_unavailable/.test(assignSrc), "G.5c RPC-missing (pre-migration) fails closed 503 in the route");
    const storeSrc = strip(read("lib/stay/unit-assignments.ts"));
    ok(!/insertAssignmentLines|mirrorPrimaryAssignment|closeAssignmentLines|assignmentLineId/.test(storeSrc), "G.6 the non-atomic multi-step writers are gone from the store");
    { const rpcIdx = storeSrc.indexOf("export async function callStayRpc"); const before = storeSrc.slice(0, rpcIdx), after = storeSrc.slice(rpcIdx);
      ok(rpcIdx > 0 && !/method:\s*"(POST|PATCH|DELETE|PUT)"/.test(before) && (after.match(/method:\s*"POST"/g) || []).length === 1 && /\/rest\/v1\/rpc\//.test(after), "G.6b the store's ONLY write is the single POST /rest/v1/rpc/<fn> inside callStayRpc"); }
    ok(SRC_FILES.every((f) => !/insertAssignmentLines|mirrorPrimaryAssignment|closeAssignmentLines/.test(read(f))), "G.6c no source file anywhere references the removed non-atomic writers");
    // M2 — bids.assignedUnitId writer inventory (frontend) — every remaining writer is covered by the DB sync trigger
    { const colWriters = SRC_FILES.filter((f) => { const s = strip(read(f)); return /assignedUnitId\s*:/.test(s) && /(sbInsert\(\s*"bids"|rest\/v1\/bids\b)/.test(s) && /(sbInsert\(\s*"bids"|method:\s*"(PATCH|POST)")/.test(s); });
      eqv(JSON.stringify(colWriters), JSON.stringify(["app/api/bids/place/route.ts"]), "G.7 the ONLY remaining direct bids.assignedUnitId writer is the unit-level booking INSERT (app/api/bids/place) — covered by trg_stay_sync_bid_unit_assignment");
      const tableWriters = SRC_FILES.filter((f) => f !== "lib/stay/unit-assignments.ts" && /bid_unit_assignment(s|_lines)/.test(read(f)));
      ok(tableWriters.every((f) => { const s = strip(read(f)); const lines = s.split("\n"); return lines.every((ln, i) => !/bid_unit_assignment(s|_lines)/.test(ln) || !/method:\s*"(POST|PATCH|DELETE|PUT)"/.test(lines.slice(Math.max(0, i - 3), i + 4).join("\n"))); }), "G.7b every other reference to the assignment tables is READ-ONLY (" + tableWriters.join(", ") + ")");
      eqv(JSON.stringify(tableWriters.sort()), JSON.stringify(["app/api/my/unit-assignments/route.ts", "app/api/partner/hotel/route.ts", "lib/availability.ts"].sort()), "G.7c assignment-table readers inventory is exactly: customer read, partner hotel side-load, availability engine (legacy mirror)"); }
    // M3 — room_blocks unit-pin writer inventory: every writer goes through the table guard trigger
    { const blockPinWriters = SRC_FILES.filter((f) => { const s = strip(read(f)); return /assignedUnitId\s*:/.test(s) && (/sbInsert\(\s*"room_blocks"/.test(s) || (/rest\/v1\/room_blocks/.test(s) && /method:\s*"(POST|PATCH)"/.test(s))); });
      const expected = ["app/api/b2b/basket/verify/route.ts", "app/api/b2b/listings/[id]/verify/route.ts", "app/api/circle/inventory/[id]/verify/route.ts", "app/api/circle/inventory/sell/route.ts", "app/api/circle/marketplace/verify/route.ts", "app/api/partner/walk-in/route.ts", "app/api/trade/awards/[id]/enable-selling/route.ts", "lib/channels/sync.ts"];
      eqv(JSON.stringify(blockPinWriters.sort()), JSON.stringify(expected.sort()), "G.8 room_blocks unit-pin writer inventory is exactly the known set (walk-in + OTA sync + 6 inventory-hold writers) — all covered by the table-level trg_stay_guard_room_block_unit"); }
    const walkinSrc = strip(read("app/api/partner/walk-in/route.ts"));
    ok(!/decodeJwt/.test(walkinSrc) && /resolveVerifiedPartnerScope/.test(walkinSrc) && (walkinSrc.match(/scope\.hotelIds\.includes/g) || []).length >= 4, "G.9 walk-in route: verified partner authority + exact-hotel scope on GET/POST/PATCH/DELETE (no decode-only)");
    ok(/validateBlockUnit\(/.test(walkinSrc) && /assignedUnitNumber: pinnedUnit \? pinnedUnit\.roomNumber : null/.test(walkinSrc) && /patch\.assignedUnitNumber = v\.unit\.roomNumber/.test(walkinSrc) && !/body\.assignedUnitNumber/.test(walkinSrc), "G.10 walk-in: unit pin validated server-side; unit NUMBER always derived, client value never read");
    ok(/unit_conflict\|unit_wrong_hotel\|unit_wrong_category\|unit_inactive\|unit_not_found/.test(walkinSrc), "G.11 walk-in maps the DB guard-trigger refusals to 409");
    // M4 — customer read authority
    const mineSrc = strip(read("app/api/my/unit-assignments/route.ts"));
    ok(/verifiedCustomerFromReq\(/.test(mineSrc) && !/authPayload|decodeJwt|jwt\.decode|atob\(/.test(mineSrc), "G.12 customer read uses the cryptographic customer authority; no decode-only path");
    ok(/export const runtime = "nodejs"/.test(mineSrc) && /resolveUserIds\(customer\.id/.test(mineSrc) && /customerId=in\./.test(mineSrc), "G.13 customer read: node runtime, verified id → identity twins, own-bids filter");
    ok(/bid_unit_assignment_lines/.test(mineSrc) && /bid_unit_assignments\?bidId=in/.test(mineSrc), "G.14 customer read: lines first, legacy fallback");
    const dash = read("app/partner/dashboard/page.tsx");
    ok(!/Total Revenue/.test(dash), "G.15 dashboard no longer labels booking value 'Total Revenue'");
    ok(/bookingPaymentSummary\(/.test(dash) && /Booking value/.test(dash) && /Paid online \(recorded\)/.test(dash), "G.16 dashboard shows booking value vs recorded payment");
    ok(/bookingDetailStatus\(/.test(dash), "G.17 dashboard status label comes from the lifecycle-precedence helper");
    ok(!/tel:\$\{b\.guestPhone/.test(dash) && /tel:\$\{contact\.phone\}/.test(dash) && /normalizeGuestContact\(/.test(dash), "G.18 tel: links only from a classified phone (never raw guestPhone)");
    ok(/early_checkout_confirmation_required/.test(dash) && /confirmEarly: true/.test(dash), "G.19 dashboard handles the explicit early-checkout confirmation");
    ok(/evaluateCheckInWindow\(/.test(dash) && /disabled=\{!win\.ok\}/.test(dash), "G.20 Mark Check-in mirrors the temporal window (server stays authoritative)");
    ok(/action: "transfer"|"transfer", reason/.test(dash) && /room history is frozen/i.test(dash), "G.21 modal: in-house transfer is explicit; completed stay frozen");
    // migration contract
    const mig = read("migrations/2026-09-13-v753-stay-lifecycle-ops-unit-assignment-lines.sql");
    ok(/NOT APPLIED TO PRODUCTION/.test(mig), "G.22 migration is explicitly marked NOT APPLIED");
    ok(/create table if not exists public\.bid_unit_assignment_lines/.test(mig) && /uniq_bual_active_bid_unit/.test(mig) && /uniq_bual_active_bid_slot/.test(mig), "G.23 lines table + partial uniques");
    ok(/status in \('active','superseded','released','completed'\)/.test(mig), "G.23b line status includes 'completed' (finished stay no longer occupies)");
    ok(/alter table public\.bid_unit_assignment_lines enable row level security/.test(mig) && /force\s+row level security/.test(mig) && /drop policy if exists all_anon_all on public\.bid_unit_assignments/.test(mig) && /revoke all on public\.bid_unit_assignments from anon, authenticated/.test(mig), "G.24 RLS enabled+forced; legacy permissive policy dropped; client grants revoked");
    ok(/excl_bual_unit_night_overlap/.test(mig) && /exclude using gist/.test(mig) && /btree_gist/.test(mig), "G.25 DB EXCLUDE constraint (btree_gist) on active dated lines");
    for (const fn of ["stay_assign_units", "stay_release_units", "stay_assign_block_unit", "stay_release_block_unit"]) {
      ok(new RegExp("create or replace function public\\." + fn + "\\([\\s\\S]{0,200}?\\)\\s*returns jsonb\\s*language plpgsql security invoker set search_path = public, pg_temp").test(mig), "G.26 RPC " + fn + " is SECURITY INVOKER with a pinned search_path");
      ok(new RegExp("revoke execute on function public\\." + fn + "\\([^)]*\\) from public, anon, authenticated").test(mig) && new RegExp("grant execute on function public\\." + fn + "\\([^)]*\\) to service_role").test(mig), "G.27 RPC " + fn + ": EXECUTE revoked from public/anon/authenticated, granted to service_role only");
    }
    ok(/raise exception 'unit_conflict' using errcode = 'P0001'/.test(mig) && /raise exception 'stay_completed'/.test(mig) && /raise exception 'transfer_reason_required'/.test(mig), "G.28 refusals are RAISE (transaction rollback) with the P0001 code contract");
    ok(/pg_advisory_xact_lock\(hashtext\('sb_unit:' \|\| p_unit_id\)::bigint\)/.test(mig) && (mig.match(/perform public\.stay_lock_unit\(/g) || []).length >= 4, "G.29 ONE serialization strategy: per-unit advisory xact lock taken by the RPCs AND both triggers");
    ok(/returns integer language plpgsql volatile/.test(mig) && /stay_unit_conflict_count\(/.test(mig) && /from public\.room_blocks rb/.test(mig), "G.30 conflict authority is VOLATILE and spans lines + unit-pinned room_blocks");
    ok(/create trigger trg_stay_sync_bid_unit_assignment\s+after insert or update of "assignedUnitId", status on public\.bids/.test(mig), "G.31 M2 sync trigger on bids covers INSERT + UPDATE of assignedUnitId/status");
    ok(/create trigger trg_stay_guard_room_block_unit\s+before insert or update of "assignedUnitId", "fromDate", "toDate" on public\.room_blocks/.test(mig) && /new\."assignedUnitNumber" := v_unit\."roomNumber"/.test(mig), "G.32 M3 guard trigger on room_blocks validates + derives the unit number server-side");
    ok(/stay_sync_bid_unit_assignment\(\) returns trigger\s+language plpgsql security definer set search_path = public, pg_temp/.test(mig) && /stay_guard_room_block_unit\(\) returns trigger\s+language plpgsql security definer set search_path = public, pg_temp/.test(mig), "G.33 the two trigger functions are SECURITY DEFINER with a pinned search_path");
    ok(/SECURITY DEFINER[\s\S]{0,400}pinned search_path[\s\S]{0,400}no privilege on the/i.test(mig) || /The trigger\s+function is SECURITY DEFINER with a PINNED search_path because/.test(mig), "G.33b SECURITY DEFINER use is justified in the migration header (writer roles lack privilege on the lines table)");
    ok(/revoke execute on function public\.stay_sync_bid_unit_assignment\(\) from public, anon, authenticated/.test(mig) && /revoke execute on function public\.stay_guard_room_block_unit\(\) from public, anon, authenticated/.test(mig), "G.34 trigger functions: EXECUTE revoked (cannot be called directly)");
    ok(/insert into public\.bid_unit_assignment_lines/.test(mig) && /on conflict \(id\) do nothing/.test(mig) && /b\."assignedUnitId" is not null/.test(mig) && /then 'completed' else 'released' end/.test(mig), "G.35 idempotent lifecycle-aware backfill of legacy rows + bids-only stamps");
    const checkinSrc = strip(read("app/api/partner/checkin/[bidId]/route.ts"));
    ok(/status\s*!==\s*["']ACCEPTED["']/.test(checkinSrc) && /evaluateCheckInWindow/.test(checkinSrc) && /evaluateCheckInAssignment/.test(checkinSrc), "G.36 check-in keeps the ACCEPTED pre-state and adds temporal + unit gates");
    ok(!/bid_paid_amounts/.test(checkinSrc) && !/\bbid\s*\??\.\s*message\b/.test(checkinSrc), "G.37 check-in still never reads forgeable payment markers (no invented pay-before-check-in policy)");
    const checkoutSrc = strip(read("app/api/partner/checkout/[bidId]/route.ts"));
    ok(/status\s*!==\s*["']CHECKED_IN["']/.test(checkoutSrc) && /!==\s*["']checked_in["']/.test(checkoutSrc), "G.38 checkout keeps the CHECKED_IN + checked_in-evidence precondition");
    ok(/feedbackWindowNotificationId/.test(checkoutSrc) && /id: nid/.test(checkoutSrc), "G.39 checkout notification insert carries an explicit id");
    ok(/stay-unit-assignment\.pg\.test\.js/.test(read("package.json")) && fs.existsSync(path.join(REPO, "tests/concurrency/stay-unit-assignment.pg.test.js")), "G.40 the real-PostgreSQL atomicity/race suite is wired into test:concurrency");
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
