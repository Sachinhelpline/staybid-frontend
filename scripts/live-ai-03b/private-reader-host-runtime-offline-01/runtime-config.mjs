// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — PRIVATE trusted-reader SERVING runtime config contract (OFFLINE). Node built-ins only.
//
// Non-secret operational configuration + the provisioning-input NAMES the serving runtime consults.
// Reads NO secret values inline (no hardcoded secret / DB URL / credential). The reader credential and
// the caller-auth transport secret are supplied out-of-band by the deployment's secret store; absent
// (as offline) the runtime fails closed. Carries AI-STAGING identity references for a pure self-check.
// ─────────────────────────────────────────────────────────────────────────
import process from "node:process";
import os from "node:os";
import path from "node:path";
import { FIXED } from "../trusted-activation-boundary-01/pricing-approval-contract.mjs";

export const RUNTIME_ID = "live-ai-03b-private-reader-host-runtime";

// env NAMES the deployment sets out-of-band (values never inlined here):
export const ENV_TRANSPORT_SECRET = "LIVE_AI_03B_READER_TRANSPORT_SECRET"; // caller-auth HMAC secret (NOT a DB credential)
export const ENV_SOCKET_PATH = "LIVE_AI_03B_READER_SOCKET";               // loopback Unix-socket path override
// listen-mode selection (non-secret). Unset mode ⇒ "unix" (the conservative intra-container default).
export const ENV_LISTEN_MODE = "LIVE_AI_03B_READER_LISTEN_MODE";           // unix | loopback-tcp | private-network
export const ENV_BIND_HOST = "LIVE_AI_03B_READER_BIND_HOST";               // literal IP (or ::/0.0.0.0 only with the ack below)
export const ENV_PORT = "LIVE_AI_03B_READER_PORT";                         // decimal port (NOT Railway's public PORT)
export const ENV_ALLOWED_PEER_CIDRS = "LIVE_AI_03B_READER_ALLOWED_PEER_CIDRS"; // comma-separated private CIDRs
export const ENV_ALLOW_WILDCARD_BIND = "LIVE_AI_03B_READER_ALLOW_WILDCARD_BIND"; // exactly "true" to acknowledge a wildcard bind

export const RUNTIME_CONFIG_CONTRACT = Object.freeze({
  service_id: "88c74a23-6b01-4ec8-8600-90e23628ff72",
  project_id: FIXED.ai_staging_project,
  environment_id: FIXED.ai_staging_environment,
  pg_service_id: FIXED.ai_staging_postgres,
  core_excluded_pg: FIXED.core_excluded_postgres,
  serves_public_domain: false,
  transport: "authenticated transport, explicitly selected mode: private Unix-domain socket (default) | loopback-only TCP (127.0.0.1/::1) | private-network TCP (literal private bind or acknowledged wildcard + mandatory private peer-CIDR allowlist; HMAC still required). No public domain / HTTP / TCP proxy / public bind.",
  authority_source: "versioned reader-only authority (no executorDbClient); UNPROVISIONED offline",
  provisioning_inputs: {
    transport_secret_env: ENV_TRANSPORT_SECRET, socket_path_env: ENV_SOCKET_PATH, listen_mode_env: ENV_LISTEN_MODE,
    bind_host_env: ENV_BIND_HOST, port_env: ENV_PORT, allowed_peer_cidrs_env: ENV_ALLOWED_PEER_CIDRS, allow_wildcard_bind_env: ENV_ALLOW_WILDCARD_BIND,
  },
});

// Pure identity self-check (NO network, NO secret): AI-STAGING, never CORE-PROD.
export function targetSelfCheck() {
  const c = RUNTIME_CONFIG_CONTRACT;
  const ok = c.pg_service_id === FIXED.ai_staging_postgres
    && c.pg_service_id !== FIXED.core_excluded_postgres
    && c.project_id === FIXED.ai_staging_project
    && c.project_id !== FIXED.core_excluded_project;
  return ok ? { ok: true } : { ok: false, code: "target_identity_mismatch" };
}

// Default private loopback socket path (a filesystem path ⇒ Unix domain socket, not a TCP port).
export function defaultSocketPath(env = process.env) {
  const override = env[ENV_SOCKET_PATH];
  if (typeof override === "string" && override.length > 0) return override;
  return path.join(os.tmpdir(), "live-ai-03b-private-reader.sock");
}

// Caller-auth transport secret from the deployment's secret store (env NAME only). Returns undefined
// when unset (offline) ⇒ the runtime fails closed. NEVER a hardcoded/default secret. The value (if any)
// is returned to the caller and never logged here.
export async function acquireTransportSecretFromEnv() {
  const v = process.env[ENV_TRANSPORT_SECRET];
  return (typeof v === "string" && v.length > 0) ? v : undefined;
}

// Resolve the (non-secret) listen configuration from env NAMES. Performs only parsing — the transport's
// validateListenConfig() is the single authority that accepts/refuses it (fail closed). Never infers a
// wildcard bind, never falls back to a public/any-address listener, never reads Railway's public PORT.
export function resolveListenConfigFromEnv(env = process.env) {
  const mode = env[ENV_LISTEN_MODE];
  if (mode === undefined || mode === "" || mode === "unix") return { mode: "unix", socketPath: defaultSocketPath(env) };
  const portStr = env[ENV_PORT];
  const port = typeof portStr === "string" && /^[0-9]{1,5}$/.test(portStr) ? Number(portStr) : NaN;
  if (mode === "loopback-tcp") return { mode, host: env[ENV_BIND_HOST], port };
  if (mode === "private-network") {
    const cidrs = typeof env[ENV_ALLOWED_PEER_CIDRS] === "string" ? env[ENV_ALLOWED_PEER_CIDRS].split(",").map((x) => x.trim()).filter((x) => x.length > 0) : [];
    return { mode, bindHost: env[ENV_BIND_HOST], port, allowedPeerCidrs: cidrs, allowWildcardBind: env[ENV_ALLOW_WILDCARD_BIND] === "true" };
  }
  return { mode }; // unknown mode ⇒ refused by validateListenConfig (transport_listen_mode_invalid)
}
