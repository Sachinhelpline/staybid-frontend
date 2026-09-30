// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 V2 EXECUTOR ATTESTATION ISSUER — least-privilege OBSERVER session + BOUNDED, LIFECYCLE-AWARE
// work coordinator. OFFLINE candidate. Node built-ins at load; `pg` is imported lazily only when a connection opens.
//
// ADAPTED (not imported) from the accepted reader attester's observer-connection.mjs, because that module is bound to
// the READER registry and the READER evaluator. The containment properties are kept 1:1:
//   • ONE physical observer connection; statement_timeout + default_transaction_read_only SET and READ BACK;
//   • only the fixed EXECUTOR registry can be issued (isPermittedExecutorSql); parameters are bounded strings;
//   • every statement has an independent client-side wall-clock deadline; a stalled/errored statement marks the
//     connection dead and destroys it (never reused);
//   • the request context (the ACCEPTED makeRequestContext, imported unchanged) is threaded through queue → open →
//     evidence; an expired/cancelled request never acquires the observer, never opens, never evaluates;
//   • at most ONE outstanding open; a connection returned after abandonment is destroyed, never admitted;
//   • bounded queue (1 active + 3 queued), bounded shutdown.
// The observer credential is read from its env NAME at open() and never returned, logged or placed in an error.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
import { makeRequestContext, parsePgDurationMs } from "../../private-reader-attester-offline-01/observer-connection.mjs";
import { isPermittedExecutorSql } from "./executor-evidence-queries.mjs";
import { observeExecutorEvidence } from "./executor-evidence-evaluator.mjs";

export { makeRequestContext };
export const OBSERVER_STATEMENT_TIMEOUT_MS = 1500;
export const OBSERVER_CONNECT_TIMEOUT_MS = 5000;
export const OBSERVER_QUERY_DEADLINE_MS = 1500;
export const OBSERVER_OBSERVATION_DEADLINE_MS = 2000;
export const OBSERVER_OPEN_DEADLINE_MS = 1500;
export const OBSERVER_CLEANUP_DEADLINE_MS = 1000;
export const OBSERVER_MAX_ACTIVE = 1;
export const OBSERVER_MAX_QUEUED = 3;
export const DEFAULT_REQUEST_BUDGET_MS = 1900;
export const OBSERVER_APPLICATION_NAME = "lai03b-executor-attester-observer";

const SETUP = Object.freeze({
  setTimeout: "SELECT set_config('statement_timeout', $1, false) AS v",
  readTimeout: "SELECT current_setting('statement_timeout') AS v",
  setReadOnly: "SELECT set_config('default_transaction_read_only', 'on', false) AS v",
  readReadOnly: "SELECT current_setting('default_transaction_read_only') AS v",
});
const fail = (reason) => ({ ok: false, reason });
function withDeadline(p, ms, reason = "evidence_query_deadline") {
  let t; const d = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(reason)), Math.max(1, ms)); });
  return Promise.race([Promise.resolve().then(() => p), d]).finally(() => clearTimeout(t));
}
const clampRemaining = (ctx, cap) => Math.max(1, ctx ? Math.min(cap, ctx.remainingMs()) : cap);

/** Open + verify an observer session over a freshly opened physical connection. */
export async function establishExecutorObserverSession(physical, { statementTimeoutMs = OBSERVER_STATEMENT_TIMEOUT_MS, queryDeadlineMs = OBSERVER_QUERY_DEADLINE_MS } = {}) {
  if (!physical || typeof physical.query !== "function") return fail("observer_session_invalid");
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1 || statementTimeoutMs > 5000) return fail("observer_timeout_config_invalid");
  const setupQuery = (sql, params) => withDeadline(physical.query(sql, params), queryDeadlineMs, "observer_setup_deadline");
  try {
    await setupQuery(SETUP.setTimeout, [String(statementTimeoutMs) + "ms"]);
    const st = await setupQuery(SETUP.readTimeout, []);
    const eff = st && st.rows && st.rows[0] ? parsePgDurationMs(st.rows[0].v) : NaN;
    if (!Number.isInteger(eff) || eff <= 0 || eff > statementTimeoutMs) return fail("observer_statement_timeout_unverified");
    await setupQuery(SETUP.setReadOnly, []);
    const ro = await setupQuery(SETUP.readReadOnly, []);
    if (!ro || !ro.rows || !ro.rows[0] || ro.rows[0].v !== "on") return fail("observer_read_only_unverified");
  } catch { return fail("observer_session_setup_failed"); }

  let closed = false;
  const invalidatePhysical = async () => {
    try { await withDeadline(typeof physical.destroy === "function" ? physical.destroy() : physical.close(), OBSERVER_CLEANUP_DEADLINE_MS, "observer_cleanup_deadline"); } catch {}
  };
  return { ok: true, observer: Object.freeze({
    effectiveStatementTimeoutMs: statementTimeoutMs,
    isDead() { return closed || (typeof physical.isDead === "function" && physical.isDead()); },
    async evidence(sql, params = []) {
      if (closed) throw new Error("observer_closed");
      if (!isPermittedExecutorSql(sql)) throw new Error("evidence_sql_not_permitted");   // never caller-chosen
      if (!Array.isArray(params) || params.length > 3) throw new Error("evidence_params_invalid");
      for (const p of params) {
        const okp = (typeof p === "string" && p.length <= 128) || (Array.isArray(p) && p.length <= 32 && p.every((x) => typeof x === "string" && x.length <= 64));
        if (!okp) throw new Error("evidence_params_invalid");
      }
      let r;
      try { r = await withDeadline(physical.query(sql, params), queryDeadlineMs); }
      catch (e) { closed = true; void invalidatePhysical(); throw e; }
      return r && Array.isArray(r.rows) ? r.rows : [];
    },
    async close() { closed = true; await invalidatePhysical(); },
  }) };
}

/**
 * Bounded, lifecycle-aware coordinator over ONE physical observer (see header). The evaluator is FIXED to
 * observeExecutorEvidence — a caller cannot inject a different evaluation.
 * @param opts.provider async () → { ok:true, observer } | { ok:false, reason }
 */
export function createExecutorObserverCoordinator(opts = {}) {
  const { provider, nowProvider = Date.now, clock = Date.now, defaultBudgetMs = DEFAULT_REQUEST_BUDGET_MS,
    observationDeadlineMs = OBSERVER_OBSERVATION_DEADLINE_MS, openDeadlineMs = OBSERVER_OPEN_DEADLINE_MS,
    cleanupDeadlineMs = OBSERVER_CLEANUP_DEADLINE_MS, maxActive = OBSERVER_MAX_ACTIVE, maxQueued = OBSERVER_MAX_QUEUED } = opts;
  if (typeof provider !== "function") throw new Error("observer_coordinator_provider_required");
  let current = null, active = 0, terminating = 0, generation = 0, pendingOpen = null, openInFlight = 0, reopenFailures = 0, providerCalls = 0, shutting = false;
  const waiters = [];
  const stats = () => Object.freeze({ activeEvidence: active, queuedEvidence: waiters.length, terminating, generation, reopenFailures, providerCalls, openInFlight, pendingOpen: pendingOpen !== null, maxActive, maxQueued });
  function acquire(ctx) {
    if (active < maxActive) { active++; return Promise.resolve(true); }
    if (waiters.length >= maxQueued) return Promise.resolve(false);
    return new Promise((res) => waiters.push({ ctx, res }));
  }
  function release() {
    while (waiters.length) {
      const w = waiters.shift();
      if (w.ctx && !w.ctx.live()) { try { w.res(false); } catch {} continue; }
      try { w.res(true); } catch {}
      return;
    }
    active = Math.max(0, active - 1);
  }
  async function invalidate(observer) {
    if (!observer) return;
    terminating++;
    try { await withDeadline(observer.close(), cleanupDeadlineMs, "observer_cleanup_deadline"); } catch {}
    finally { terminating = Math.max(0, terminating - 1); if (current === observer) current = null; }
  }
  function disposeLate(r) { const obs = r && r.ok === true && r.observer ? r.observer : null; if (obs) void invalidate(obs); }
  async function acquireObserver(ctx) {
    if (current && !current.isDead()) return { ok: true, observer: current };
    if (pendingOpen) return { ok: false, reason: "observer_open_in_flight" };
    providerCalls++; openInFlight++;
    const op = Promise.resolve().then(() => provider());
    pendingOpen = op;
    let abandoned = false;
    op.then((r) => { if (pendingOpen === op) pendingOpen = null; if (abandoned) disposeLate(r); }, () => { if (pendingOpen === op) pendingOpen = null; })
      .finally(() => { openInFlight = Math.max(0, openInFlight - 1); });
    const cancelSignal = new Promise((_, rej) => { ctx.onCancel(() => rej(new Error("open_cancelled"))); });
    let r;
    try { r = await Promise.race([withDeadline(op, clampRemaining(ctx, openDeadlineMs), "observer_open_deadline"), cancelSignal]); }
    catch { abandoned = true; reopenFailures++; return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "observer_open_deadline" }; }
    if (!ctx.live()) { abandoned = true; disposeLate(r); return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "request_expired" }; }
    if (r && r.ok === true && r.observer && typeof r.observer.isDead === "function" && !r.observer.isDead()) { current = r.observer; return { ok: true, observer: current }; }
    reopenFailures++;
    return { ok: false, reason: (r && r.reason) || "observer_unavailable" };
  }
  async function observe(connectionToken, { nowProvider: nP = nowProvider, context, budgetMs = defaultBudgetMs } = {}) {
    const ctx = context || makeRequestContext(budgetMs, clock);
    if (!ctx.live()) return { ok: false, reason: "request_expired" };
    if (shutting) return { ok: false, reason: "observer_unavailable" };
    const got = await acquire(ctx);
    if (!got) return { ok: false, reason: ctx.live() ? "observer_busy" : "request_expired" };
    try {
      if (!ctx.live()) return { ok: false, reason: "request_expired" };
      const acq = await acquireObserver(ctx);
      if (!acq.ok) return { ok: false, reason: acq.reason };
      if (!ctx.live()) return { ok: false, reason: "request_expired" };
      const observer = acq.observer;
      const gen = ++generation;
      let timedOut = false, timer;
      const deadline = new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error("observation_deadline")); }, clampRemaining(ctx, observationDeadlineMs)); });
      const cancelled = new Promise((_, rej) => { ctx.onCancel(() => rej(new Error("request_cancelled"))); });
      let ev;
      try { ev = await Promise.race([observeExecutorEvidence(observer, connectionToken, { nowProvider: nP }), deadline, cancelled]); }
      catch {
        await invalidate(observer);
        return { ok: false, reason: timedOut ? "observation_deadline" : (ctx.isCancelled() ? "request_cancelled" : (!ctx.live() ? "request_expired" : "observer_unavailable")) };
      } finally { clearTimeout(timer); }
      if (!ctx.live()) { await invalidate(observer); return { ok: false, reason: ctx.isCancelled() ? "request_cancelled" : "request_expired" }; }
      if (observer.isDead() || gen !== generation) { await invalidate(observer); return { ok: false, reason: "observer_unavailable" }; }
      if (!ev || ev.ok !== true) { if (observer.isDead()) await invalidate(observer); return { ok: false, reason: (ev && ev.reason) || "evidence_unavailable" }; }
      return { ok: true, evidence: ev.evidence, context: ctx };
    } finally { release(); }
  }
  async function shutdown({ deadlineMs = cleanupDeadlineMs } = {}) {
    shutting = true;
    while (waiters.length) { const w = waiters.shift(); if (w.ctx) { try { w.ctx.cancel("shutdown"); } catch {} } try { w.res(false); } catch {} }
    const t0 = clock();
    while ((active > 0 || terminating > 0 || openInFlight > 0) && (clock() - t0) < deadlineMs) { await new Promise((r) => setTimeout(r, 20)); }
    if (current) { const c = current; current = null; await invalidate(c); }
    return true;
  }
  return Object.freeze({ observe, stats, shutdown, isShutting: () => shutting });
}

/** Production observer physical-connection factory over the real `pg` driver. Construction performs no I/O. */
export function makeExecutorObserverPgFactory({ env, connectionStringEnvName }) {
  return Object.freeze({
    kind: "pg-executor-observer",
    async open() {
      const cs = env ? env[connectionStringEnvName] : undefined;
      if (typeof cs !== "string" || cs.length === 0) throw new Error("observer_db_url_absent");
      const mod = await import("pg");
      const Client = (mod.default && mod.default.Client) || mod.Client;
      const client = new Client({ connectionString: cs, application_name: OBSERVER_APPLICATION_NAME, connectionTimeoutMillis: OBSERVER_CONNECT_TIMEOUT_MS, keepAlive: true });
      let dead = false; const markDead = () => { dead = true; };
      client.on("error", markDead); client.on("end", markDead);
      try { await client.connect(); } catch { markDead(); try { await client.end(); } catch {} throw new Error("observer_db_connect_failed"); }
      const destroy = async () => {
        markDead();
        try { const s = client.connection && client.connection.stream; if (s && typeof s.destroy === "function") s.destroy(); } catch {}
        try { await client.end(); } catch {}
      };
      return Object.freeze({
        async query(sql, params) { const r = await client.query(sql, params); return { rows: r.rows }; },
        isDead() { return dead; }, async close() { await destroy(); }, async destroy() { await destroy(); },
      });
    },
  });
}
