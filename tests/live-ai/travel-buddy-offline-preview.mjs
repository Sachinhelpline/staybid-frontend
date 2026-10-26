#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — bounded LOCAL preview of the integrated TEXT + VOICE offline candidate.
//
//   node tests/live-ai/travel-buddy-offline-preview.mjs        → open http://127.0.0.1:3921/
//
// Starts the already-built app (`next start`, loopback only) and a loopback proxy in front of it:
//   • GET /api/hotels and /api/hotels/<id> → SYNTHETIC "TEST ONLY" fixtures (no real inventory);
//   • every NON-GET request → 403 and logged (this also isolates the pre-existing hotel-detail
//     POST /api/pricing/spine and any bid / booking / payment endpoint);
//   • every other GET → the local app.
// It never contacts StayBid backends through the proxy. Your browser may still try public CDNs for
// images / fonts; for a strictly offline look, disconnect the network first. Ctrl-C stops both.
// Build first with: NEXT_PUBLIC_VOICE_AI_BETA=1 NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA=0
//   NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW=1 NEXT_PUBLIC_TRAVEL_BUDDY_DEMO_VOICE=1 npm run build
// ─────────────────────────────────────────────────────────────────────────
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_PORT = 3920, PROXY_PORT = 3921, HOST = "127.0.0.1";

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
};
const byId = Object.fromEntries(Object.values(FIX).flat().map((h) => [h.id, h]));

const reach = (p) => new Promise((r) => { const s = net.connect({ host: HOST, port: p, timeout: 800 }); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); s.on("timeout", () => { s.destroy(); r(false); }); });
const app = spawn(process.execPath, [path.join(REPO, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", HOST],
  { cwd: REPO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "inherit", "inherit"] });
const t0 = Date.now();
while (!(await reach(APP_PORT))) { if (Date.now() - t0 > 60000) { console.error("app did not start"); app.kill("SIGKILL"); process.exit(2); } await new Promise((r) => setTimeout(r, 300)); }

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const proxy = http.createServer((req, res) => {
  const u = new URL(req.url || "/", `http://${HOST}`);
  if (req.method !== "GET" && req.method !== "HEAD") { console.log(`[preview] BLOCKED ${req.method} ${u.pathname}`); return json(res, 403, { error: "blocked_in_offline_preview" }); }
  if (u.pathname === "/api/hotels") { const list = FIX[(u.searchParams.get("city") || "").toLowerCase()] || []; return json(res, 200, { hotels: list, total: list.length }); }
  const m = u.pathname.match(/^\/api\/hotels\/([^/]+)$/);
  if (m && byId[decodeURIComponent(m[1])]) return json(res, 200, { hotel: { ...byId[decodeURIComponent(m[1])], reviews: [], individualRooms: false, roomListings: [] } });
  const up = http.request({ host: HOST, port: APP_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `${HOST}:${APP_PORT}` } }, (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
  up.on("error", () => json(res, 502, { error: "app_unavailable" }));
  req.pipe(up);
});
proxy.listen(PROXY_PORT, HOST, () => console.log(`\nTravel Buddy OFFLINE preview (TEST ONLY fixtures; simulated voice; NOT real AI): http://${HOST}:${PROXY_PORT}/\n`));
const stop = () => { proxy.close(); app.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
