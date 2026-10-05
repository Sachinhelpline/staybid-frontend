// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — Authority private peer-identity reporter (future phase P7, read-only). OFFLINE candidate.
//
// Executed inside the deployed Authority container (`railway ssh … -- node <this file>`). It resolves the
// Authority's OWN Railway-provided private service name (RAILWAY_PRIVATE_DOMAIN, which must equal the pinned
// `live-ai-03b-v2-authority.railway.internal`) with the ACCEPTED private-peer resolver — the same function the
// accepted reader attester uses for its peer — and prints the EXACT host CIDRs (/32 or /128). Loopback, public,
// unspecified, malformed or >4-address results are refused by the accepted resolver. No DB, no attester call,
// no secret, no Railway API. Its output is the only input the controller accepts for the executor-attester
// literal peer allowlist (no guessed or broad CIDR is ever possible).
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePeerAllowlist, RAILWAY_INTERNAL_RE } from "../../private-reader-bootstrap-clock-peer-offline-01/private-peer-resolver.mjs";
import { SERVICES } from "./constants.mjs";

export const PEER_IDENTITY_VERSION = "m7-step67-authority-peer-identity-v1";
export const EXPECTED_AUTHORITY_PRIVATE_DOMAIN = SERVICES.authority.name + ".railway.internal";

export async function reportAuthorityPeerIdentity({ env, resolver } = {}) {
  const name = env && env.RAILWAY_PRIVATE_DOMAIN;
  if (typeof name !== "string" || !RAILWAY_INTERNAL_RE.test(name)) return { ok: false, reason: "private_domain_absent_or_not_railway_internal" };
  if (name !== EXPECTED_AUTHORITY_PRIVATE_DOMAIN) return { ok: false, reason: "private_domain_not_authority" };
  const r = await resolvePeerAllowlist({ serviceName: name, ...(resolver ? { resolver } : {}) });
  if (!r.ok) return { ok: false, reason: "peer_" + r.reason };
  return { ok: true, serviceName: name, cidrs: r.cidrs };
}
async function main() {
  const r = await reportAuthorityPeerIdentity({ env: process.env });
  process.stdout.write("STEP67_AUTHORITY_PEER_IDENTITY " + JSON.stringify({ version: PEER_IDENTITY_VERSION, ...r }) + "\n");
  process.exitCode = r.ok ? 0 : 3;
}
const isMain = (() => { try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1])); } catch { return false; } })();
if (isMain) main();
