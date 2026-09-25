// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B BOOTSTRAP §29 — PRIVATE-DNS → EXACT-PEER resolver matrix (OFFLINE). Node built-ins only.
// The resolver is driven by an INJECTED resolver stub (no real DNS). Every non-private / loopback / public /
// malformed / unspecified / oversized / bad-name input fails closed. Refresh validates fully before an atomic
// swap and keeps the last-good set (never widens) on failure. Defence-in-depth ONLY: the exact peer range never
// replaces HMAC authentication (asserted against the v2 frame verifier + the server-build exact-host guard).
// ─────────────────────────────────────────────────────────────────────────
import { resolvePeerAllowlist, createPeerAllowlistResolver, createPeerSupervisor, RAILWAY_INTERNAL_RE } from "../private-peer-resolver.mjs";
import { verifyV2RequestFrame, buildV2Request, startV2AttestationServer } from "../attestation-channel-v2.mjs";

let pass = 0, fail = 0; const fails = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fails.push(n); console.log("  FAIL:", n); } };
const NAME = "reader-attester.railway.internal";
const stub = (recs) => async () => recs;
const R = (deps) => resolvePeerAllowlist({ serviceName: NAME, ...deps });

async function run() {
  // ── A. valid resolutions ──
  {
    const r = await R({ resolver: stub([{ address: "10.1.2.3", family: 4 }]) });
    ok("A1. single private IPv4 → /32", r.ok === true && r.cidrs.length === 1 && r.cidrs[0] === "10.1.2.3/32");
  }
  {
    const r = await R({ resolver: stub([{ address: "fd12::7", family: 6 }]) });
    ok("A2. single private IPv6 → /128", r.ok === true && r.cidrs[0] === "fd12::7/128");
  }
  {
    const r = await R({ resolver: stub([{ address: "10.1.2.3", family: 4 }, { address: "fd12::7", family: 6 }]) });
    ok("A3. dual-stack → both exact-host cidrs", r.ok === true && r.cidrs.length === 2 && r.cidrs.includes("10.1.2.3/32") && r.cidrs.includes("fd12::7/128"));
  }
  {
    const r = await R({ resolver: stub([{ address: "10.1.2.3", family: 4 }, { address: "10.1.2.3", family: 4 }]) });
    ok("A4. duplicate records deduped", r.ok === true && r.cidrs.length === 1);
  }
  {
    const r = await R({ resolver: stub([{ address: "::ffff:10.0.0.9", family: 6 }]) });
    ok("A5. IPv4-mapped IPv6 normalized to IPv4 /32", r.ok === true && r.cidrs[0] === "10.0.0.9/32");
  }
  {
    const r = await R({ resolver: stub([{ address: "172.16.5.5", family: 4 }]) });
    ok("A6. 172.16/12 private accepted", r.ok === true && r.cidrs[0] === "172.16.5.5/32");
  }

  // ── B. fail-closed inputs ──
  const failReason = async (recs, reason) => (await R({ resolver: stub(recs) })).reason === reason;
  ok("B1. loopback IPv4 fails closed", await failReason([{ address: "127.0.0.1", family: 4 }], "dns_loopback_address"));
  ok("B2. loopback IPv6 fails closed", await failReason([{ address: "::1", family: 6 }], "dns_loopback_address"));
  ok("B3. public IPv4 fails closed", await failReason([{ address: "8.8.8.8", family: 4 }], "dns_public_address"));
  ok("B4. public IPv6 fails closed", await failReason([{ address: "2001:4860:4860::8888", family: 6 }], "dns_public_address"));
  ok("B5. unspecified 0.0.0.0 fails closed", await failReason([{ address: "0.0.0.0", family: 4 }], "dns_unspecified_address"));
  ok("B6. unspecified :: fails closed", await failReason([{ address: "::", family: 6 }], "dns_unspecified_address"));
  ok("B7. malformed address fails closed", await failReason([{ address: "not.an.ip", family: 4 }], "dns_malformed_address"));
  ok("B8. any bad record among good ones fails whole set", await failReason([{ address: "10.0.0.1", family: 4 }, { address: "8.8.8.8", family: 4 }], "dns_public_address"));
  ok("B9. empty resolution fails closed", (await R({ resolver: stub([]) })).reason === "dns_empty");
  {
    const many = [1, 2, 3, 4, 5].map((i) => ({ address: "10.0.0." + i, family: 4 }));
    ok("B10. more than one replica (> max) fails closed", (await R({ resolver: stub(many), maxAddresses: 4 })).reason === "dns_too_many_addresses");
  }
  ok("B11. non-railway.internal service name refused", (await resolvePeerAllowlist({ serviceName: "reader.example.com", resolver: stub([{ address: "10.0.0.1", family: 4 }]) })).reason === "service_name_not_railway_internal");
  ok("B12. resolver throwing fails closed", (await R({ resolver: async () => { throw new Error("boom"); } })).reason === "dns_resolution_failed");
  ok("B13. resolver deadline fails closed", (await R({ resolver: () => new Promise((res) => setTimeout(() => res([{ address: "10.0.0.1", family: 4 }]), 50)), deadlineMs: 5 })).reason === "dns_resolution_failed");
  ok("B14. RAILWAY_INTERNAL_RE accepts a valid name, rejects a public one", RAILWAY_INTERNAL_RE.test(NAME) && !RAILWAY_INTERNAL_RE.test("evil.com"));

  // ── C. every emitted cidr is EXACT-host only (never broad) ──
  {
    const r = await R({ resolver: stub([{ address: "10.9.9.9", family: 4 }, { address: "fd00::9", family: 6 }]) });
    const allExact = r.cidrs.every((c) => /\/32$/.test(c) || /\/128$/.test(c));
    ok("C1. resolver never emits a broad prefix", r.ok === true && allExact);
  }

  // ── D. stateful resolver: fail-closed before first resolve; validate-before-swap; keep last-good ──
  {
    let recs = [{ address: "10.0.0.1", family: 4 }];
    const res = createPeerAllowlistResolver({ serviceName: NAME, resolver: async () => recs });
    ok("D1. current() is null before first resolution (admit nobody)", res.current() === null && res.healthy() === false);
    const r1 = await res.refresh();
    ok("D2. first successful refresh → healthy + cidrs", r1.ok === true && res.healthy() === true && res.current()[0] === "10.0.0.1/32");
    // a failing refresh keeps the last-good set and flips healthy false (never widens)
    recs = [{ address: "8.8.8.8", family: 4 }];
    const r2 = await res.refresh();
    ok("D3. failed refresh keeps last-good, never widens, unhealthy", r2.ok === false && res.healthy() === false && res.current().length === 1 && res.current()[0] === "10.0.0.1/32");
    // a subsequent good refresh recovers + swaps atomically
    recs = [{ address: "10.0.0.2", family: 4 }];
    const r3 = await res.refresh();
    ok("D4. recovery refresh swaps to the new validated set", r3.ok === true && res.healthy() === true && res.current()[0] === "10.0.0.2/32" && r3.changed === true);
  }

  // ── E. defence-in-depth: the exact peer range NEVER replaces HMAC ──
  {
    // a well-formed v2 frame whose MAC is wrong is unauthenticated regardless of peer allowlisting
    const secret = "s".repeat(48);
    const line = buildV2Request({ channelSecret: secret, connectionToken: "a".repeat(64), requestNonce: "b".repeat(32), readerClock: { L: 0, U: 1000, generation: "c".repeat(32) }, nonce: "d".repeat(16), ts: Date.now() });
    const tampered = line.replace(/"mac":"[0-9a-f]{64}"/, '"mac":"' + "0".repeat(64) + '"');
    const v = verifyV2RequestFrame(tampered, { channelSecret: secret, nowMs: Date.now(), seenNonces: new Map() });
    ok("E1. tampered MAC → unauthenticated (peer range cannot rescue it)", v.ok === false && v.code === "unauthenticated");
    const vgood = verifyV2RequestFrame(line, { channelSecret: secret, nowMs: Date.now(), seenNonces: new Map() });
    ok("E2. correct MAC verifies", vgood.ok === true);
  }
  {
    // the v2 server build REFUSES a broad peer CIDR (only /32 or /128 admitted)
    const deps = {
      channelSecret: "s".repeat(48), listen: { bindHost: "127.0.0.1", port: 0 },
      observerProvider: async () => ({ ok: true }), signer: { issue: () => ({ ok: false }) },
      anchor: { any: true }, attesterClockInterval: () => ({ L: 0, U: 0 }), signingEnabled: () => true,
      peerCidrs: ["10.0.0.0/8"], nowMs: Date.now, offlineTestBoundary: true,
    };
    let threw = null; try { await startV2AttestationServer(deps); } catch (e) { threw = e && e.message; }
    ok("E3. server refuses a broad peer CIDR (exact-host only)", threw === "v2_peer_allowlist_invalid");
    let threw2 = null; try { await startV2AttestationServer({ ...deps, peerCidrs: [] }); } catch (e) { threw2 = e && e.message; }
    ok("E4. empty peer allowlist admits nobody (fail closed on build)", threw2 === "v2_peer_allowlist_invalid");
  }

  // ── F. peer supervisor (§21/§22): refresh, keep-last-good on unsafe, invalidate-on-change, never widen ──
  {
    let recs = [{ address: "10.0.0.1", family: 4 }];
    let unsafe = []; let changes = [];
    const sup = createPeerSupervisor({ serviceName: NAME, resolver: async () => recs, onUnsafe: (r) => unsafe.push(r), onChange: (n, o) => changes.push([n, o]) });
    const r1 = await sup.refreshOnce();
    ok("F1. supervisor first refresh sets the exact-host set (no change event on first establishment)", r1.ok === true && sup.current()[0] === "10.0.0.1/32" && changes.length === 0);
    // an unsafe refresh keeps last-good, never widens, and signals onUnsafe
    recs = [{ address: "8.8.8.8", family: 4 }];
    const r2 = await sup.refreshOnce();
    ok("F2. unsafe refresh keeps last-good (never widens) + onUnsafe fired", r2.ok === false && unsafe.length === 1 && sup.current().length === 1 && sup.current()[0] === "10.0.0.1/32" && sup.healthy() === false);
    // a validated peer-identity CHANGE fires onChange (operator performs the controlled recreation)
    recs = [{ address: "10.0.0.2", family: 4 }];
    const r3 = await sup.refreshOnce();
    ok("F3. validated peer-identity change fires onChange", r3.ok === true && r3.changed === true && changes.length === 1 && changes[0][0][0] === "10.0.0.2/32" && changes[0][1][0] === "10.0.0.1/32");
    // an unchanged validated refresh does NOT fire onChange
    const r4 = await sup.refreshOnce();
    ok("F4. unchanged refresh does not fire onChange", r4.ok === true && r4.changed === false && changes.length === 1);
    sup.stop();
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`RESULT: ${pass} passed, ${fail} failed  (executed assertions: ${pass + fail})`);
  if (fail > 0) { console.log("FAILURES:", fails.join(" | ")); process.exitCode = 1; return; }
  console.log("OFFLINE PRIVATE-PEER RESOLVER MATRIX (§29 + §21/§22 supervisor): PASS");
  process.exitCode = 0;
}
run().catch((e) => { console.log("HARNESS ERROR:", e && e.stack); process.exitCode = 1; });
