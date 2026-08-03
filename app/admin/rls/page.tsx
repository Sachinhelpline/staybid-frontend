"use client";
// v99 — Admin Row-Level Security manager.
//
// Lists every public table with its RLS state, policy count, and the
// individual policies. Inline toggle to enable / disable RLS per table.
// "Add permissive policy" button on tables that have zero policies (the
// safe path before enabling — without ANY policy, RLS = lockout).
//
// Sensitivity hints (otp_codes, kyc_submissions, bank_details, etc.) are
// surfaced as amber warnings so operators know to harden those tables
// with restrictive policies once the app has service-role replacements.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, ShieldAlert, ShieldX, RotateCw, Table2, LockOpen, Lock,
  TriangleAlert, Check, X, User,
} from "lucide-react";
import KpiCard from "@/components/admin/kpi-card";
import { adminColors as C, btnGhost, btnGold, h1Style, inputStyle, pageStyle, pill, selectStyle } from "@/lib/admin/styles";

type Policy = {
  name: string;
  cmd: string;
  permissive: string;
  roles: string;
  using?: string;
  check?: string;
};
type Row = {
  table: string;
  rls_enabled: boolean;
  policy_count: number;
  policies: Policy[];
};

// Tables that hold sensitive data — flag for restrictive policies later
const SENSITIVE = new Set([
  "otp_codes", "kyc_submissions", "bank_details", "host_agreements",
  "users", "onboarding_users", "wallets", "wallet_transactions",
  "bid_holds", "bid_paid_amounts", "bid_acceptance_windows",
  "booking_messages", "complaints", "vp_complaints", "vp_videos",
  "admin_action_logs",
]);

export default function AdminRLS() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "rls_on" | "rls_off" | "no_policy" | "sensitive">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  // v100 — service-role availability decides whether lockdown actions are enabled
  const [serviceRole, setServiceRole] = useState<boolean>(false);

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  }

  const adminHeaders = useCallback((): Record<string, string> => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const t = localStorage.getItem("sb_admin_token");
    // The Bearer token (the verified Gmail/Railway session) is the ONLY thing
    // the server authorizes on. These x-admin-* identity headers are legacy and
    // NOT trusted for authorization — the server derives the audit identity from
    // the verified token, never from a header.
    let user: any = null;
    try { user = JSON.parse(localStorage.getItem("sb_admin_user") || "null"); } catch {}
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (t) h["Authorization"] = `Bearer ${t}`;
    if (user?.id)    h["x-admin-id"]    = String(user.id);
    if (user?.phone) h["x-admin-phone"] = String(user.phone);
    if (user?.name)  h["x-admin-name"]  = String(user.name);
    return h;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", { headers: adminHeaders() });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(d.error || "Failed to load"); return; }
      setRows(d.tables || []);
      setServiceRole(!!d.serviceRole);
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [adminHeaders]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const total = rows.length;
    const on    = rows.filter((r) => r.rls_enabled).length;
    const off   = rows.filter((r) => !r.rls_enabled).length;
    const noPol = rows.filter((r) => r.policy_count === 0).length;
    const sens  = rows.filter((r) => SENSITIVE.has(r.table)).length;
    return { total, on, off, noPol, sens };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "rls_on")    list = list.filter((r) => r.rls_enabled);
    if (filter === "rls_off")   list = list.filter((r) => !r.rls_enabled);
    if (filter === "no_policy") list = list.filter((r) => r.policy_count === 0);
    if (filter === "sensitive") list = list.filter((r) => SENSITIVE.has(r.table));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.table.toLowerCase().includes(q));
    }
    return list;
  }, [rows, filter, search]);

  async function toggle(table: string, enable: boolean, hasPolicy: boolean) {
    if (enable && !hasPolicy) {
      const proceed = confirm(
        `⚠ Enabling RLS on "${table}" without ANY policy will BLOCK ALL ACCESS.\n\n` +
        `Click "Add permissive policy" first if you want to keep the table accessible to the app.\n\n` +
        `Proceed anyway?`
      );
      if (!proceed) return;
    }
    if (!enable) {
      const proceed = confirm(
        `Disable RLS on "${table}"?\n\n` +
        `The table will become fully readable + writable by anyone holding the Supabase anon key.\n` +
        `${SENSITIVE.has(table) ? "\n⚠ This is a SENSITIVE table.\n" : ""}` +
        `Proceed?`
      );
      if (!proceed) return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ action: "toggle", table, enable }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Toggle failed");
      showToast("ok", `RLS ${enable ? "enabled" : "disabled"} on ${table}`);
      load();
      if (selected?.table === table) setSelected({ ...selected, rls_enabled: enable });
    } catch (e: any) {
      showToast("err", e?.message || "Failed");
    } finally { setBusy(false); }
  }

  async function addPolicy(table: string) {
    if (!confirm(`Add a permissive "all_anon_all" policy on "${table}"?\n\nThis grants the app full read+write access to the table — matches the default policy used across the rest of the schema. You can drop it later or replace it with a restrictive one.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ action: "add_policy", table }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Add policy failed");
      showToast("ok", `Policy added on ${table}`);
      load();
    } catch (e: any) {
      showToast("err", e?.message || "Failed");
    } finally { setBusy(false); }
  }

  async function lockdown(table: string) {
    if (!serviceRole) {
      showToast("err", "Set SUPABASE_SERVICE_ROLE_KEY env var on Vercel first — without it, locking down breaks the route layer too.");
      return;
    }
    if (!confirm(
      `🔒 LOCK DOWN "${table}"?\n\n` +
      `This drops every permissive anon/authenticated policy.\n` +
      `After this, ONLY service-role (server-side env-keyed requests) can read or write the table.\n\n` +
      `If any client-side code or anon-keyed route still touches "${table}", it will start failing immediately.\n\n` +
      `Proceed?`
    )) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ action: "lockdown", table }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Lockdown failed");
      showToast("ok", `${table} locked down — service-role only (${d.remaining_policies ?? 0} policies remain)`);
      load();
    } catch (e: any) {
      showToast("err", e?.message || "Lockdown failed");
    } finally { setBusy(false); }
  }

  // v103 — apply a pre-baked restrictive policy template
  async function applyTemplate(table: string, template: "deny_anon" | "service_role_only" | "owner_only", col?: string) {
    const labels: Record<string, string> = {
      deny_anon:          "Deny anon — adds a RESTRICTIVE policy that blocks anon callers entirely",
      service_role_only:  "Service-role only — drops all permissive policies (lockdown)",
      owner_only:         `Owner-only — restricts row access to where ${col} = current request's JWT sub claim. REQUIRES a Supabase-Auth-style JWT in the request; will NOT work with Railway-issued tokens until you wire that.`,
    };
    if (!confirm(`Apply template "${template}" on "${table}"?\n\n${labels[template]}\n\nProceed?`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ action: "apply_template", table, template, col }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Template apply failed");
      showToast("ok", `Template ${template} applied to ${table}`);
      load();
      if (selected?.table === table) {
        const fresh = (await (await fetch("/api/admin/rls", { headers: adminHeaders() })).json()).tables.find((x: Row) => x.table === table);
        if (fresh) setSelected(fresh);
      }
    } catch (e: any) {
      showToast("err", e?.message || "Failed");
    } finally { setBusy(false); }
  }

  async function dropPolicy(table: string, policy: string) {
    if (!confirm(`Drop policy "${policy}" on "${table}"?\n\nIf this was the last permissive policy and RLS is enabled, the app will lose access to this table.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/rls", {
        method: "POST", headers: adminHeaders(),
        body: JSON.stringify({ action: "drop_policy", table, policy }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Drop failed");
      showToast("ok", `Policy ${policy} dropped`);
      load();
      if (selected?.table === table) {
        const fresh = (await (await fetch("/api/admin/rls", { headers: adminHeaders() })).json()).tables.find((x: Row) => x.table === table);
        if (fresh) setSelected(fresh);
      }
    } catch (e: any) {
      showToast("err", e?.message || "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ ...h1Style, margin: 0, display: "inline-flex", alignItems: "center", gap: 9 }} className="admin-h1"><ShieldCheck size={24} strokeWidth={2} aria-hidden />Row-Level Security</h1>
        <button onClick={load} style={{ ...btnGhost, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}><RotateCw size={14} strokeWidth={2.2} aria-hidden />Refresh</button>
        {/* v100 — service-role status badge */}
        <span
          title={serviceRole
            ? "SUPABASE_SERVICE_ROLE_KEY is configured. Sensitive tables can be locked down to service-role-only."
            : "SUPABASE_SERVICE_ROLE_KEY env var is NOT set. Lock-down actions are disabled — adding restrictive policies without service-role will break the route layer."}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 999,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            cursor: "help",
            background: serviceRole ? "rgba(46,204,113,0.12)" : "rgba(245,158,11,0.12)",
            color: serviceRole ? C.green : C.amber,
            border: `1px solid ${serviceRole ? C.green + "55" : C.amber + "55"}`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: serviceRole ? C.green : C.amber, boxShadow: serviceRole ? `0 0 6px ${C.green}` : "none" }} />
          SERVICE-ROLE {serviceRole ? "READY" : "NOT SET"}
        </span>
        <span style={{ marginLeft: "auto", color: C.textDim, fontSize: 12 }}>
          {stats.total} tables · {stats.on} RLS-on · {stats.off} RLS-off
        </span>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
        <KpiCard title="Tables"          value={stats.total} icon={<Table2 size={17} strokeWidth={2} aria-hidden />}       color={C.gold}   />
        <KpiCard title="RLS Enabled"     value={stats.on}    icon={<ShieldCheck size={17} strokeWidth={2} aria-hidden />}   color={C.green}  />
        <KpiCard title="RLS Disabled"    value={stats.off}   icon={<ShieldAlert size={17} strokeWidth={2} aria-hidden />}   color={C.red}    />
        <KpiCard title="No Policies"     value={stats.noPol} icon={<LockOpen size={17} strokeWidth={2} aria-hidden />}      color={C.amber}  />
        <KpiCard title="Sensitive"       value={stats.sens}  icon={<Lock size={17} strokeWidth={2} aria-hidden />}          color={C.purple} />
      </div>

      {/* Info banner */}
      <div style={{ background: "rgba(140, 160, 182,0.06)", border: `1px solid ${C.gold}33`, borderRadius: 12, padding: 14, marginBottom: 18, color: C.text, fontSize: 13, lineHeight: 1.55 }}>
        <strong style={{ color: C.gold }}>How RLS works here:</strong> Every table has a permissive
        <code style={{ color: C.amber, margin: "0 4px" }}>all_anon_all</code> policy that lets the app's
        anon key read + write. RLS being <em>enabled</em> means the policy is consulted; disabling RLS
        removes that gate. To genuinely restrict a table, ADD restrictive policies first, THEN drop
        the permissive one. Tables flagged <Lock size={12} strokeWidth={2.4} aria-hidden style={{ display: "inline", verticalAlign: "-2px", color: C.purple }} /> hold sensitive data and warrant restrictive policies before
        production scale.
      </div>

      {/* Filters */}
      <div className="admin-filters" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={selectStyle}>
          <option value="all">All tables</option>
          <option value="rls_on">RLS enabled</option>
          <option value="rls_off">RLS disabled</option>
          <option value="no_policy">No policies</option>
          <option value="sensitive">Sensitive</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search table name…"
          style={{ ...inputStyle, minWidth: 220 }}
        />
        <span style={{ marginLeft: "auto", alignSelf: "center", color: C.textDim, fontSize: 13 }}>
          {filtered.length} / {rows.length}
        </span>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>{err}</div>
      )}

      {/* Table grid */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: C.textDim, background: C.card, borderRadius: 14, border: `1px solid ${C.border}` }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filtered.map((r) => {
            const sensitive = SENSITIVE.has(r.table);
            const noPolicy  = r.policy_count === 0;
            return (
              <div
                key={r.table}
                style={{
                  background: C.card,
                  border: `1px solid ${noPolicy && r.rls_enabled ? C.red + "55" : sensitive ? C.purple + "44" : C.border}`,
                  borderRadius: 14,
                  padding: 14,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: r.rls_enabled ? `linear-gradient(90deg, ${C.green}, transparent)` : `linear-gradient(90deg, ${C.red}, transparent)` }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {sensitive && <span title="Sensitive table" style={{ display: "inline-flex", color: C.purple, flexShrink: 0 }}><Lock size={13} strokeWidth={2.4} aria-hidden /></span>}
                    <span style={{ color: C.text, fontWeight: 600, fontSize: 14, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.table}
                    </span>
                  </div>
                  <Toggle on={r.rls_enabled} disabled={busy} onChange={(v) => toggle(r.table, v, r.policy_count > 0)} />
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill(r.rls_enabled ? C.green : C.red, "")}>
                    {r.rls_enabled ? "RLS ON" : "RLS OFF"}
                  </span>
                  <span style={pill(r.policy_count === 0 ? C.red : r.policy_count >= 3 ? C.blue : C.amber, "")}>
                    {r.policy_count} policies
                  </span>
                  {sensitive && <span style={pill(C.purple, "")}>SENSITIVE</span>}
                </div>

                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  <button onClick={() => setSelected(r)} disabled={busy} style={{ ...btnGhost, flex: 1, padding: "6px 10px", fontSize: 12 }}>
                    View policies
                  </button>
                  {noPolicy && (
                    <button
                      onClick={() => addPolicy(r.table)}
                      disabled={busy}
                      style={{ ...btnGold, padding: "6px 10px", fontSize: 12, background: C.amber }}
                      title="Add permissive all_anon_all policy"
                    >
                      + Policy
                    </button>
                  )}
                  {/* v100 — lockdown action shown only on sensitive tables. Disabled
                      until service-role env var is set. */}
                  {sensitive && !noPolicy && (
                    <button
                      onClick={() => lockdown(r.table)}
                      disabled={busy || !serviceRole}
                      title={serviceRole
                        ? "Drop all permissive policies — service-role only access"
                        : "Set SUPABASE_SERVICE_ROLE_KEY env var first"}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: (busy || !serviceRole) ? "not-allowed" : "pointer",
                        background: serviceRole ? "#C62828" : "rgba(255,71,87,0.08)",
                        color: serviceRole ? "#fff" : C.red,
                        border: `1px solid ${C.red}`,
                        opacity: (busy || !serviceRole) ? 0.55 : 1,
                        display: "inline-flex", alignItems: "center", gap: 5,
                      }}
                    >
                      <Lock size={12} strokeWidth={2.4} aria-hidden />Lock
                    </button>
                  )}
                </div>

                {noPolicy && r.rls_enabled && (
                  <div style={{ marginTop: 10, padding: 8, background: "rgba(255,71,87,0.08)", border: `1px solid ${C.red}55`, borderRadius: 8, color: C.red, fontSize: 11, display: "flex", alignItems: "flex-start", gap: 5 }}>
                    <TriangleAlert size={13} strokeWidth={2.4} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />RLS enabled with no policies — app is locked OUT of this table.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 100,
          background: toast.kind === "ok" ? "rgba(46,204,113,0.95)" : "rgba(255,71,87,0.95)",
          color: "#0F1117", padding: "10px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {toast.kind === "ok" ? <Check size={14} strokeWidth={2.6} aria-hidden /> : <X size={14} strokeWidth={2.6} aria-hidden />}{toast.msg}
        </div>
      )}

      {/* Side drawer with policy details */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(7,8,12,0.7)", backdropFilter: "blur(4px)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 600, maxWidth: "96vw", background: "#0F1117", borderLeft: `1px solid ${C.border}`, height: "100vh", display: "flex", flexDirection: "column" }}
          >
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: C.textDim, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>Table</p>
                <p style={{ color: C.text, fontSize: 15, fontWeight: 600, margin: "3px 0 0", fontFamily: "monospace" }}>
                  {selected.table}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", display: "inline-flex", alignItems: "center", padding: 2 }}><X size={22} strokeWidth={2} aria-hidden /></button>
            </div>

            <div style={{ padding: 20, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Toggle on={selected.rls_enabled} disabled={busy} onChange={(v) => toggle(selected.table, v, selected.policy_count > 0)} />
              <span style={pill(selected.rls_enabled ? C.green : C.red, "")}>
                {selected.rls_enabled ? "RLS Enabled" : "RLS Disabled"}
              </span>
              <span style={pill(C.gold, "")}>{selected.policy_count} policies</span>
              {SENSITIVE.has(selected.table) && <span style={pill(C.purple, "")}>SENSITIVE</span>}
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {/* v103 — Restrictive policy templates */}
              <div style={{ background: "rgba(168,85,247,0.06)", border: `1px solid ${C.purple}33`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: C.purple, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>Policy templates</span>
                </div>
                <p style={{ color: C.textDim, fontSize: 11, lineHeight: 1.5, margin: "0 0 10px" }}>
                  Apply a pre-baked restrictive policy. The first two are safe to use today; the third
                  (owner-only) requires a Supabase-Auth-style JWT in every request — this app uses Railway
                  tokens, so apply only after wiring claim-passthrough.
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    onClick={() => applyTemplate(selected.table, "deny_anon")}
                    disabled={busy}
                    title="Adds a RESTRICTIVE policy that DENIES anon callers. Useful as defense-in-depth alongside the permissive auth policy."
                    style={{ background: "rgba(255,71,87,0.1)", color: C.red, border: `1px solid ${C.red}55`, padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <ShieldX size={12} strokeWidth={2.2} aria-hidden />Deny anon
                  </button>
                  <button
                    onClick={() => applyTemplate(selected.table, "service_role_only")}
                    disabled={busy || !serviceRole}
                    title={serviceRole ? "Drops all permissive policies → only service_role can access" : "Set SUPABASE_SERVICE_ROLE_KEY env var first"}
                    style={{ background: serviceRole ? "rgba(140, 160, 182,0.15)" : "rgba(140, 160, 182,0.05)", color: C.gold, border: `1px solid ${C.gold}55`, padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: (busy || !serviceRole) ? "not-allowed" : "pointer", opacity: (busy || !serviceRole) ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <ShieldCheck size={12} strokeWidth={2.2} aria-hidden />Service-role only
                  </button>
                  <button
                    onClick={() => {
                      const col = prompt(`Apply owner-only restrictive policy on "${selected.table}".\n\nWhich column holds the owner's user id (e.g. customerId, userId)?\n\n⚠ WARNING: requires Supabase Auth JWTs in requests. Railway-issued tokens will NOT match — apply with caution.`);
                      if (col && col.trim()) applyTemplate(selected.table, "owner_only", col.trim());
                    }}
                    disabled={busy}
                    title="Restricts row access to where {col} = JWT sub claim. Requires Supabase Auth path."
                    style={{ background: "rgba(168,85,247,0.1)", color: C.purple, border: `1px solid ${C.purple}55`, padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <User size={12} strokeWidth={2.2} aria-hidden />Owner-only
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontFamily: "Syne, sans-serif", color: C.text, fontSize: 15, margin: 0 }}>Policies</h3>
                {selected.policy_count === 0 && (
                  <button onClick={() => addPolicy(selected.table)} disabled={busy} style={{ ...btnGold, padding: "6px 12px", fontSize: 12, background: C.amber }}>
                    + Add permissive policy
                  </button>
                )}
              </div>

              {selected.policies.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: C.textDim, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: `1px dashed ${C.border}` }}>
                  No policies. App is locked OUT of this table when RLS is on.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {selected.policies.map((p) => (
                    <div key={p.name} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ color: C.text, fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{p.name}</span>
                        <button onClick={() => dropPolicy(selected.table, p.name)} disabled={busy} style={{ background: "rgba(255,71,87,0.1)", color: C.red, border: `1px solid ${C.red}55`, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          Drop
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={pill(C.blue, "")}>{p.cmd}</span>
                        <span style={pill(C.textDim, "")}>{p.permissive}</span>
                        <span style={{ ...pill(C.gold, ""), fontSize: 10, fontFamily: "monospace" }}>{p.roles}</span>
                      </div>
                      {p.using && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600 }}>USING</div>
                          <pre style={{ color: C.text, fontSize: 11, fontFamily: "monospace", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{p.using}</pre>
                        </div>
                      )}
                      {p.check && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600 }}>WITH CHECK</div>
                          <pre style={{ color: C.text, fontSize: 11, fontFamily: "monospace", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{p.check}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pill-style toggle ────────────────────────────────────────────────────
function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      title={on ? "RLS enabled — click to disable" : "RLS disabled — click to enable"}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        background: on ? "#2ECC71" : "rgba(255,71,87,0.4)",
        border: `1px solid ${on ? "#2ECC71" : "rgba(255,71,87,0.5)"}`,
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.18s",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute",
        top: 2,
        left: on ? 22 : 2,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "#0F1117",
        transition: "left 0.18s",
        boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
      }} />
    </button>
  );
}
