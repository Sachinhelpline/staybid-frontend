// ═════════════════════════════════════════════════════════════════════════
// v734 — throwaway Postgres cluster for the classic-reservation concurrency
// suite. Mirrors the staybid-live pg-harness shape:
//   • `initdb` a fresh cluster inside tests/concurrency/.pg/data/
//   • `pg_ctl start` on a private Unix socket inside tests/concurrency/.pg/
//   • Only that socket is reachable — no TCP, no listen_addresses.
//   • On teardown (or process exit), `pg_ctl stop -m immediate` + rm -rf.
//
// If the postgres binaries are unavailable, we exit NON-ZERO with an unproven
// signal (release-gate FAIL — a SKIP would silently pass a suite that never
// ran). This matches the staybid-live release rule.
// ═════════════════════════════════════════════════════════════════════════
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, ".pg");
const DATA = path.join(ROOT, "data");
const SOCKET_DIR = ROOT;
const LOG = path.join(ROOT, "pg.log");
const DB_NAME = "sbtest";
const DB_USER = os.userInfo().username === "root" ? "postgres" : os.userInfo().username;

function which(cmd) {
  const paths = (process.env.PATH || "").split(":");
  const commonPgPaths = [
    "/usr/lib/postgresql/16/bin",
    "/usr/lib/postgresql/15/bin",
    "/usr/lib/postgresql/14/bin",
    "/usr/local/pgsql/bin",
  ];
  for (const p of paths.concat(commonPgPaths)) {
    const abs = path.join(p, cmd);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function requireBinaries() {
  const bins = ["initdb", "pg_ctl", "psql"].map((b) => [b, which(b)]);
  const missing = bins.filter(([, p]) => !p).map(([b]) => b);
  if (missing.length) {
    console.error(
      "[pg-harness] postgres binaries not found: " +
        missing.join(", ") +
        "\n[pg-harness] install postgresql-16 (or 15/14) and re-run.\n" +
        "[pg-harness] RELEASE GATE: exiting non-zero (unproven).",
    );
    process.exit(2);
  }
  return Object.fromEntries(bins);
}

function run(cmd, args, opts) {
  const r = cp.spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...(opts || {}),
  });
  if (r.status !== 0) {
    const detail = ((r.stdout || "") + (r.stderr || "")).trim();
    throw new Error(cmd + " " + args.join(" ") + " → exit " + r.status + "\n" + detail);
  }
  return r;
}

function runAs(user, cmd, args, opts) {
  // When the suite runs as root (CI), we drop to `postgres` for the DB commands
  // — Postgres refuses to run as root. On a non-root workstation, this is a
  // no-op sudo bypass.
  if (process.getuid && process.getuid() === 0) {
    // On some sandboxes `sudo` may not be present; try `su - <user> -c '...'`
    if (which("sudo")) return run("sudo", ["-u", user, cmd, ...args], opts);
    if (which("runuser")) return run("runuser", ["-u", user, "--", cmd, ...args], opts);
    if (which("su")) {
      const quoted = [cmd, ...args].map((a) => "'" + String(a).replace(/'/g, "'\\''") + "'").join(" ");
      return run("su", ["-", user, "-c", quoted], opts);
    }
    throw new Error("Cannot drop privileges from root: sudo/runuser/su not found");
  }
  return run(cmd, args, opts);
}

function ensureRoot() {
  if (fs.existsSync(ROOT)) fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  if (process.getuid && process.getuid() === 0) {
    // The postgres OS user owns the data dir when we run as root.
    run("chown", ["-R", DB_USER + ":" + DB_USER, ROOT]);
    // Loosen perms so `chdir` inside `su - postgres` works.
    run("chmod", ["755", ROOT]);
  }
}

let started = false;

function socketDsn() {
  return "postgres://" + encodeURIComponent(DB_USER) + "@localhost/" + DB_NAME + "?host=" + encodeURIComponent(SOCKET_DIR);
}

async function start() {
  const bins = requireBinaries();
  ensureRoot();

  // initdb with trust auth over the local socket (no password needed for the
  // throwaway cluster — the socket is only accessible on this host, and the
  // dsn-guard refuses anything else).
  runAs(DB_USER, bins.initdb, [
    "--pgdata=" + DATA,
    "--username=" + DB_USER,
    "--auth=trust",
    "--no-instructions",
    "--encoding=UTF8",
  ]);

  // Force socket-only, disable TCP entirely.
  const conf = path.join(DATA, "postgresql.conf");
  fs.appendFileSync(
    conf,
    [
      "",
      "# v734 concurrency harness — socket-only, TCP disabled.",
      "listen_addresses = ''",
      "unix_socket_directories = '" + SOCKET_DIR + "'",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
      "max_connections = 100",
      "",
    ].join("\n"),
  );

  runAs(DB_USER, bins.pg_ctl, [
    "-D", DATA,
    "-l", LOG,
    "-o", "-c listen_addresses='' -k " + SOCKET_DIR,
    "-w",
    "start",
  ]);
  started = true;

  runAs(DB_USER, bins.psql, [
    "-h", SOCKET_DIR,
    "-U", DB_USER,
    "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
    "-c", "CREATE DATABASE " + DB_NAME + ";",
  ]);

  const dsn = socketDsn();
  process.on("exit", stopSync);
  process.on("SIGINT", () => { stopSync(); process.exit(130); });
  process.on("SIGTERM", () => { stopSync(); process.exit(143); });
  return dsn;
}

function stopSync() {
  if (!started) return;
  started = false;
  const pg_ctl = which("pg_ctl");
  if (!pg_ctl) return;
  try {
    runAs(DB_USER, pg_ctl, ["-D", DATA, "-m", "immediate", "stop"]);
  } catch { /* best-effort */ }
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
}

module.exports = { start, stop: stopSync, DB_USER, SOCKET_DIR, DB_NAME };
