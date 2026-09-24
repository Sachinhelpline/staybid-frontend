// INDEPENDENT caller process for the cross-process private-network test (OFFLINE, synthetic only).
// Deliberately does NOT import the transport module: it re-implements the documented caller contract
// (`reader-obs-transport-v1`) from node:net + node:crypto alone, proving the contract is sufficient for a
// separate service. Inputs via env (synthetic): LAI_HOST, LAI_PORT, LAI_SECRET, LAI_NOW, LAI_SCENARIO.
// Prints one JSON line of results. Connects only to the address it is given (a local test listener).
import net from "node:net";
import process from "node:process";
import { createHmac, randomBytes } from "node:crypto";

const HOST = process.env.LAI_HOST, PORT = Number(process.env.LAI_PORT), SECRET = process.env.LAI_SECRET;
const NOW = Number(process.env.LAI_NOW), SCENARIO = process.env.LAI_SCENARIO || "full";
const V = "reader-obs-transport-v1";

function mac(op, args, nonce, ts) { return createHmac("sha256", SECRET).update([V, op, JSON.stringify(args), nonce, String(ts)].join("\n")).digest("hex"); }
function send(line) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: HOST, port: PORT }, () => s.write(line));
    let buf = ""; s.setEncoding("utf8");
    const t = setTimeout(() => { s.destroy(); resolve({ transportError: "client_timeout" }); }, 8000);
    s.on("data", (d) => { buf += d; });
    s.on("end", () => { clearTimeout(t); try { resolve(JSON.parse(buf.trim() || "{}")); } catch { resolve({ transportError: "bad_response" }); } });
    s.on("error", (e) => { clearTimeout(t); resolve({ transportError: e && e.code ? e.code : "error" }); });
  });
}
function req(op, args, o = {}) {
  const nonce = o.nonce || randomBytes(12).toString("hex"); const ts = o.ts !== undefined ? o.ts : NOW;
  const m = o.omitMac ? undefined : (o.badMac ? "0".repeat(64) : mac(op, args, nonce, ts));
  const body = { v: V, op, args, nonce, ts }; if (m !== undefined) body.mac = m;
  return send(JSON.stringify(body) + "\n");
}

const out = { pid: process.pid };
if (SCENARIO === "full") {
  out.good = await req("observe", { observation: "dormant" });
  out.badMac = await req("observe", { observation: "dormant" }, { badMac: true });
  out.noMac = await req("observe", { observation: "dormant" }, { omitMac: true });
  out.unknownOp = await req("query", { observation: "dormant" });
  out.stale = await req("observe", { observation: "dormant" }, { ts: NOW - 60000 });
  out.replay1 = await req("observe", { observation: "armed" }, { nonce: "xproc-replay-nonce-01" });
  out.replay2 = await req("observe", { observation: "armed" }, { nonce: "xproc-replay-nonce-01" });
} else {
  out.single = await req("observe", { observation: "ceilings" });
}
process.stdout.write(JSON.stringify(out) + "\n");
