// TEST HARNESS ONLY — SIMULATED independent attester behind the approved `reader-attestation-channel-v1`
// channel. It stands in for the future Owner-controlled attester: it authenticates the channel request
// (its own independent HMAC implementation, freshness, single-use nonce), INDEPENDENTLY observes the
// synthetic database (session table + privilege state), and signs an AiStagingReaderAttestationV1 with a
// fixture Ed25519 key generated in memory. Its signatures are SIMULATED, not genuine live attestations.
import net from "node:net";
import { createHmac, timingSafeEqual, generateKeyPairSync, sign, createHash } from "node:crypto";
import { FIXED, canonicalize, publicKeyFingerprintFromDerB64 } from "../../../trusted-activation-boundary-01/pricing-approval-contract.mjs";
import { ATTESTATION_CONTRACT, ATTESTATION_DOMAIN } from "../../reader-attestation.mjs";
import { connectionTokenFor } from "../../reader-session.mjs";

const V = "reader-attestation-channel-v1";
export async function startSimulatedAttester({ db, channelSecret, issuer = "offline-simulated-attester", lifetimeMs = 300000, host = "127.0.0.1" } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDerB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const fingerprint = publicKeyFingerprintFromDerB64(publicKeyDerB64);
  const other = generateKeyPairSync("ed25519").privateKey;
  const ctl = { mode: "ok", lifetimeMs, requests: 0, authenticated: 0, rejectedAuth: 0, issued: 0 };
  const seen = new Set();
  const sig = (p, k = privateKey) => sign(null, Buffer.from(canonicalize(p), "utf8"), k).toString("base64");
  const macOk = (req) => {
    const m = createHmac("sha256", channelSecret).update([req.v, req.op, JSON.stringify(req.args), req.nonce, String(req.ts)].join("\n")).digest();
    try { return typeof req.mac === "string" && req.mac.length === 64 && timingSafeEqual(m, Buffer.from(req.mac, "hex")); } catch { return false; }
  };
  function answer(line) {
    let req; try { req = JSON.parse(line); } catch { return { ok: false, code: "bad_request" }; }
    if (!req || req.v !== V) return { ok: false, code: "unsupported_version" };
    if (req.op !== "attest") return { ok: false, code: "unknown_op" };
    if (typeof req.ts !== "number" || Math.abs(Date.now() - req.ts) > 30000) return { ok: false, code: "stale" };
    if (!macOk(req)) { ctl.rejectedAuth++; return { ok: false, code: "unauthenticated" }; }
    if (seen.has(req.nonce)) return { ok: false, code: "replayed" };
    seen.add(req.nonce); ctl.authenticated++;
    const a = req.args || {};
    if (Object.keys(a).sort().join(",") !== "connectionToken,contract,requestNonce,role" || a.contract !== ATTESTATION_CONTRACT) return { ok: false, code: "bad_request" };
    if (ctl.mode === "unavailable") return { ok: false, code: "unavailable" };
    // independent observation — never the requester's claims
    const s = db.observeSessions().find((x) => connectionTokenFor(x) === a.connectionToken);
    if (!s) return { ok: false, code: "no_such_session" };
    const t = Date.now();
    let payload = {
      contract: ATTESTATION_CONTRACT, domain: ATTESTATION_DOMAIN, issuer, keyId: fingerprint,
      issuedAtMs: t, expiresAtMs: t + ctl.lifetimeMs, requestNonce: a.requestNonce,
      target: { projectId: db.target.projectId, environmentId: db.target.environmentId, pgServiceId: db.target.pgServiceId },
      connection: { token: connectionTokenFor(s), role: s.usename }, privileges: db.observePrivileges(s),
    };
    if (ctl.mode === "wrongIssuer") payload = { ...payload, issuer: "someone-else" };
    if (ctl.mode === "wrongTarget") payload = { ...payload, target: { ...payload.target, environmentId: "00000000-0000-0000-0000-000000000000" } };
    if (ctl.mode === "wrongToken") payload = { ...payload, connection: { ...payload.connection, token: createHash("sha256").update("other").digest("hex") } };
    if (ctl.mode === "expired") payload = { ...payload, issuedAtMs: t - 10000, expiresAtMs: t - 1 };
    if (ctl.mode === "future") payload = { ...payload, issuedAtMs: t + 60000, expiresAtMs: t + 120000 };
    ctl.issued++;
    const signatureB64 = ctl.mode === "unsigned" ? "not-a-signature-0000" : ctl.mode === "forged" ? sig(payload, other) : sig(payload);
    return { ok: true, envelope: { payload, signatureB64 } };
  }
  const sockets = new Set();
  const srv = net.createServer((s) => {
    sockets.add(s); s.on("close", () => sockets.delete(s)); s.on("error", () => {});
    ctl.requests++;
    let b = ""; s.setEncoding("utf8");
    s.on("data", (d) => {
      b += d; const i = b.indexOf("\n"); if (i < 0) return;
      if (ctl.mode === "silent") return;
      if (ctl.mode === "garbage") return s.end("<html>not json</html>\n");
      if (ctl.mode === "oversize") return s.end("x".repeat(20000));
      if (ctl.mode === "unexpected") return s.end(JSON.stringify({ ok: true, envelope: { payload: {}, signatureB64: "x" }, publicKeyDerB64: "AAAA" }) + "\n");
      s.end(JSON.stringify(answer(b.slice(0, i))) + "\n");
    });
  });
  await new Promise((r) => srv.listen(0, host, r));
  return {
    port: srv.address().port, ctl,
    trustRootConfig: { issuer, publicKeyDerB64, fingerprint },
    async close() { for (const s of sockets) { try { s.destroy(); } catch {} } await new Promise((r) => srv.close(() => r())); },
  };
}
