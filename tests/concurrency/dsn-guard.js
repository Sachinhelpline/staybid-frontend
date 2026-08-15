// ═════════════════════════════════════════════════════════════════════════
// v734 — hard guard: refuse to run against anything but a throwaway cluster.
//
// The concurrency suite MUST NEVER touch a live Supabase project, a staging
// DB, or a developer's local main Postgres. It only ever talks to a Postgres
// spawned by .pg-harness.js on a private Unix socket inside
// tests/concurrency/.pg/. If anything else is passed, we abort the process.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");

const HARNESS_DIR = path.join(__dirname, ".pg");

/**
 * Refuse any DSN that doesn't route to the throwaway cluster's Unix socket.
 * The socket path is inside tests/concurrency/.pg/. We require:
 *   • DSN is a postgres:// or postgresql:// scheme
 *   • The `host` parameter (URL-encoded) points inside HARNESS_DIR
 * Anything else — a hostname, a public IP, a real project URL, an env var
 * that was left set — terminates the process before opening a connection.
 */
function assertTestDsn(dsn) {
  if (typeof dsn !== "string" || !dsn.length) {
    console.error("[dsn-guard] no DSN provided; refusing to run");
    process.exit(2);
  }
  let url;
  try {
    url = new URL(dsn);
  } catch (e) {
    console.error("[dsn-guard] invalid DSN URL: " + e.message);
    process.exit(2);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    console.error("[dsn-guard] DSN must be postgres://; got " + url.protocol);
    process.exit(2);
  }
  // libpq-style socket DSN passes the socket directory as `host` (URL-decoded).
  const host = url.searchParams.get("host") || decodeURIComponent(url.hostname || "");
  if (!host || !path.isAbsolute(host)) {
    console.error("[dsn-guard] DSN must connect via absolute-path Unix socket; got host=" + host);
    process.exit(2);
  }
  const normalized = path.resolve(host);
  if (!normalized.startsWith(path.resolve(HARNESS_DIR))) {
    console.error(
      "[dsn-guard] refusing DSN — socket " +
        normalized +
        " is not inside " +
        HARNESS_DIR +
        "; this suite only ever talks to the throwaway cluster.",
    );
    process.exit(2);
  }
}

module.exports = { assertTestDsn, HARNESS_DIR };
