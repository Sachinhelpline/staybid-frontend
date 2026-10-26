#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — LOCAL preview of the LIVE-CONTROLLER offline integration candidate.
//
//   node tests/live-ai/travel-buddy-live-preview.mjs              → open http://127.0.0.1:3931/
//   node tests/live-ai/travel-buddy-live-preview.mjs --route=public  (mirror the real public broker)
//   node tests/live-ai/travel-buddy-live-preview.mjs --route=customer (REAL-TEDDY: the G-PUBLIC signed-in customer
//        route on the PUBLIC composition — build with NEXT_PUBLIC_LIVE_AI_PUBLIC_ADMISSION=1 too)
//   node tests/live-ai/travel-buddy-live-preview.mjs --strict-rate   (one subject: the real 5-starts/15-min limit)
//
// Teddy talks to the ORIGINAL Live-AI controller (LiveAiProvider → conversation → gateway-client),
// which talks to the ORIGINAL gateway source running IN THIS PROCESS (see offline-gateway/offline-gateway.js:
// buildGateway + the staging composition; only the model HTTP call and the budget store are fakes).
//   • GET /api/hotels and /api/hotels/<id> → SYNTHETIC "TEST ONLY" fixtures (no real inventory);
//   • POST /api/live-ai/session → the in-process gateway, through the REAL broker shaping
//     (lib/live-ai/broker.ts shapeBrokerResponse + buildControlUrl), route "staging" by default
//     (an authenticated allowlisted subject — the ONLY route that reaches the verified 03B path);
//   • every OTHER non-GET request → 403 and logged (bid / booking / payment / pricing POSTs never run);
//   • HTML pages get the browser harness (offline-gateway/browser-harness.js) injected: fake mic +
//     fake provider data channel + the control-socket bridge (ws://…/__og/ws/<id>);
//   • every other GET → the local app (`next start`, loopback only).
// No network beyond loopback is used by this script. Ctrl-C stops everything.
// Build first (offline flags):
//   NEXT_PUBLIC_VOICE_AI_BETA=1 NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA=1 NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW=1 \
//   NEXT_PUBLIC_TRAVEL_BUDDY_LIVE_CONTROLLER=1 npm run build
// ─────────────────────────────────────────────────────────────────────────
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OG = require("./offline-gateway/offline-gateway.js");
const { WebSocketServer } = require(require.resolve("ws", { paths: [REPO] }));

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const APP_PORT = Number(arg("app-port", "3930")), PROXY_PORT = Number(arg("port", "3931")), HOST = "127.0.0.1";
const ROUTE = ["public", "customer"].includes(arg("route", "staging")) ? arg("route", "staging") : "staging";
const NO_APP = process.argv.includes("--no-app"); // tests start their own app
// G-RATE (disclosed): the REAL gateway allows 5 session starts / 15 min per signed-in subject and every reviewed
// voice turn costs 2 starts. By default the preview gives each new session the next allowlisted test subject so an
// owner can keep trying; --strict-rate keeps ONE subject and shows the real 429 after the 5th start.
const STRICT_RATE = process.argv.includes("--strict-rate");

// ── TEST ONLY fixtures (same shapes as tests/live-ai/travel-buddy-offline-preview.mjs) ───────
const room = (hid, n, name, price, cap) => ({ id: `${hid}-r${n}`, hotelId: hid, type: "STANDARD", name, capacity: cap, floorPrice: price, mrp: price + 1000, flashFloorPrice: null, images: [], amenities: [] });
const hotel = (id, name, city, price, extra) => ({
  id, name, city, state: "TEST", lat: null, lng: null, starRating: 4, avgRating: 4.4, totalReviews: 0, images: [],
  amenities: ["Parking", "Breakfast"], trustBadge: null, createdAt: "2026-01-01T00:00:00Z", ownerId: "owner_test_only",
  property_type: "resort", meal_plans: [], addon_services: [], rooms: [room(id, 1, "TEST Deluxe", price, 2), room(id, 2, "TEST Family Suite", price + 1800, 4)],
  ...(extra || {}),
});
const FIX = {
  mussoorie: [hotel("test-only-mus-1", "TEST ONLY Ridge Stay", "Mussoorie", 4500, { ownerId: "hco_test_only", owner_type: "host_circle" })],
  rishikesh: [
    hotel("test-only-ris-1", "TEST ONLY River Stay", "Rishikesh", 3900, { avgRating: 4.2, amenities: ["Parking"] }),
    hotel("test-only-ris-2", "TEST ONLY Ganga View", "Rishikesh", 5200, { avgRating: 4.8, amenities: ["WiFi"], account_type: "staybid_operated" }),
  ],
  dehradun: [
    hotel("test-only-deh-1", "TEST ONLY Valley Inn", "Dehradun", 3100, { avgRating: 4.1, amenities: ["Breakfast"] }),
    hotel("test-only-deh-2", "TEST ONLY Doon Retreat", "Dehradun", 3800, { avgRating: 4.6 }),
    hotel("test-only-deh-3", "TEST ONLY Hill Court", "Dehradun", 6200, { avgRating: 4.9, amenities: ["Parking", "WiFi"] }),
  ],
};
const byId = Object.fromEntries(Object.values(FIX).flat().map((h) => [h.id, h]));
const HARNESS_JS = fs.readFileSync(path.join(HERE, "offline-gateway", "browser-harness.js"), "utf8");

export async function startLivePreview(opts = {}) {
  const appPort = opts.appPort || APP_PORT, port = opts.port || PROXY_PORT, route = opts.route || ROUTE;
  const log = opts.log || ((m) => console.log(m));
  const blocked = [];
  const net0 = OG.assertNoNetwork();
  const compiled = OG.compileSources(path.join(HERE, ".build", "live-preview-og"));
  // REAL-TEDDY "customer" route: the PUBLIC composition (G-PUBLIC) with counted FAKE TTS + realtime-transcription
  // seams (TEST-ONLY synthetic rates + owner TTS rule). NOT real-provider proof.
  const isCustomer = route === "customer";
  const voice = { tts: [], stt: [] };
  const gateway = isCustomer
    ? await OG.createOfflineGateway({
      compiled, origin: `http://${HOST}:${port}`, composition: "public", store: OG.memoryBudgetStore({ strict: true }),
      tts: { available: true, model: "tts-1", async synthesize(input) { voice.tts.push(input.text); return { ok: true, chunks: [{ seq: 0, bytes: Buffer.alloc(960).toString("base64") }], usage: input.text.length }; } },
      transcription: { available: true, model: "gpt-live-transcribe", async transcribe() { return { ok: false, reason: "unused" }; }, async negotiate(offer) { voice.stt.push(offer.length); return { ok: true, answerSdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=offline-realtime\r\n" }; } },
      voiceRates: { transcription: true, tts: true }, ttsRule: { dimension: "tts_input_character", units: 4096n },   // CHANGED FIXTURE (TEMPORARY tts-1 FALLBACK): tts-1 char rule
    })
    : await OG.createOfflineGateway({ compiled, origin: `http://${HOST}:${port}` });
  const BROKER = require(path.join(compiled.LIB, "broker.js"));
  let subjN = 0;
  const strict = opts.strictRate === undefined ? STRICT_RATE : !!opts.strictRate;
  // customer route: the subject is the opaque pub1.<sha256> the REAL route derives for a VERIFIED customer (here:
  // derived from the presented bearer; the strict JWT verification itself is covered by tests/security).
  let currentSubject = null;
  const broker = isCustomer
    ? OG.makeBrokerFetch(gateway, BROKER, { route: "customer", subject: () => currentSubject, ip: "127.0.0.1" })
    : OG.makeBrokerFetch(gateway, BROKER, { route, subject: strict ? OG.SUBJECTS[0] : () => OG.SUBJECTS[(subjN++) % OG.SUBJECTS.length], micShim: true });
  const admissions = [];

  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => { if (b.length < 64 * 1024) b += c; }); req.on("end", () => r(b)); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || "/", `http://${HOST}`);
    if (u.pathname === "/__og/harness.js") { res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" }); return res.end(HARNESS_JS); }
    if (u.pathname === "/__og/state") return json(res, 200, { route, blocked, brokerCalls: broker.calls, modelCalls: gateway.model.calls, frames: gateway.frames.slice(-200), networkAttempts: net0.attempts.length, admissions, voice });
    if (req.method === "POST" && u.pathname === "/api/live-ai/session") {
      const body = await readBody(req);
      if (isCustomer) {
        // mirrors app/api/live-ai/session/route.ts under LIVE_AI_PUBLIC_ADMISSION_ENABLED=1: no bearer ⇒ 401 sign_in_required
        const m0 = /^Bearer ([A-Za-z0-9._~+/-]{16,4096}={0,2})$/.exec(String(req.headers.authorization || ""));
        admissions.push(m0 ? "bearer" : "none");
        if (!m0) return json(res, 401, { error: "sign_in_required" });
        currentSubject = "pub1." + require("node:crypto").createHash("sha256").update("preview-customer\u001f" + m0[1]).digest("hex");
      }
      const r = await broker.fetchImpl("/api/live-ai/session", { method: "POST", body });
      return json(res, r.status, await r.json());
    }
    if (req.method !== "GET" && req.method !== "HEAD") { blocked.push(`${req.method} ${u.pathname}`); log(`[preview] BLOCKED ${req.method} ${u.pathname}`); return json(res, 403, { error: "blocked_in_offline_preview" }); }
    if (u.pathname === "/api/hotels") { const list = FIX[(u.searchParams.get("city") || "").toLowerCase()] || []; return json(res, 200, { hotels: list, total: list.length }); }
    const m = u.pathname.match(/^\/api\/hotels\/([^/]+)$/);
    if (m && byId[decodeURIComponent(m[1])]) return json(res, 200, { hotel: { ...byId[decodeURIComponent(m[1])], reviews: [], individualRooms: false, roomListings: [] } });
    const up = http.request({ host: HOST, port: appPort, method: req.method, path: req.url, headers: { ...req.headers, host: `${HOST}:${appPort}`, "accept-encoding": "identity" } }, (r) => {
      const type = String(r.headers["content-type"] || "");
      if (!type.includes("text/html")) { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); return; }
      let html = "";
      r.setEncoding("utf8");
      r.on("data", (c) => { html += c; });
      r.on("end", () => {
        const out = html.replace(/<head([^>]*)>/i, (h) => `${h}<script src="/__og/harness.js"></script>`);
        const headers = { ...r.headers }; delete headers["content-length"]; delete headers["content-encoding"];
        res.writeHead(r.statusCode || 200, headers); res.end(out);
      });
    });
    up.on("error", () => json(res, 502, { error: "app_unavailable" }));
    req.pipe(up);
  });

  // control-socket bridge: browser ws://…/__og/ws/<gatewaySessionId> ⇄ the REAL gateway control route (injectWS)
  const wss = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has("live-ai.control.v1") ? "live-ai.control.v1" : false) });
  server.on("upgrade", (req, socket, head) => {
    const m = /^\/__og\/ws\/([^/?]+)/.exec(req.url || "");
    if (!m) { socket.destroy(); return; }
    const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    wss.handleUpgrade(req, socket, head, (client) => {
      let conn = null; const pending = []; let closed = false;
      gateway.openControl(decodeURIComponent(m[1]), protocols, (text) => { try { client.send(text); } catch { /* no-op */ } }, () => { if (!closed) { closed = true; try { client.close(); } catch { /* no-op */ } } })
        .then((c) => { if (closed) { c.close(); return; } conn = c; while (pending.length) conn.send(pending.shift()); })
        .catch(() => { closed = true; try { client.close(); } catch { /* no-op */ } });
      client.on("message", (d) => { const t = d.toString("utf8"); if (conn) conn.send(t); else pending.push(t); });
      client.on("close", () => { if (closed) return; closed = true; if (conn) conn.close(); });
    });
  });

  let app = null;
  if (!opts.noApp) {
    const reach = (p) => new Promise((r) => { const s = net.connect({ host: HOST, port: p, timeout: 800 }); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); }); });
    app = spawn(process.execPath, [path.join(REPO, "node_modules/next/dist/bin/next"), "start", "-p", String(appPort), "-H", HOST], { cwd: opts.appDir || REPO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "inherit", "inherit"] });
    const t0 = Date.now();
    while (!(await reach(appPort))) { if (Date.now() - t0 > 90000) { app.kill("SIGKILL"); throw new Error("app did not start"); } await new Promise((r) => setTimeout(r, 300)); }
  }
  await new Promise((r) => server.listen(port, HOST, r));
  return {
    url: `http://${HOST}:${port}/`, gateway, broker, blocked, networkAttempts: net0.attempts, admissions, voice,
    async stop() { try { wss.close(); } catch { /* no-op */ } await new Promise((r) => server.close(() => r())); await gateway.close(); if (app) app.kill("SIGTERM"); net0.restore(); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = await startLivePreview({ noApp: NO_APP });
  console.log(`\nTravel Buddy LIVE-controller OFFLINE preview — route "${ROUTE}" — TEST ONLY fixtures; offline keyword model stands in for the AI: ${p.url}\n` +
    `Open /hotels?city=Rishikesh (2 stays), ?city=Mussoorie (1), ?city=Dehradun (3), or tap Teddy on the home page.\n`);
  const stop = async () => { await p.stop(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
