"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Admin → Service Access
// ═══════════════════════════════════════════════════════════════════════════
// Two views:
//   • Requests — hotels' access requests; approve (free / trial / paid plan)
//                or reject. Granted entitlements list with revoke.
//   • Pricing  — per-service monthly/quarterly/yearly price + bundle plans.
// Auth: x-admin-token / x-admin-id headers.
import { useCallback, useEffect, useState } from "react";
import { SERVICE_LABEL, SUBSCRIPTION_SERVICES } from "@/lib/partner/services";

const C = {
  bg: "#07080C", surface: "#0F1117", card: "#151820",
  border: "rgba(255,255,255,0.07)", text: "#E8EAF0", textSoft: "#8A8FA8",
  textMuted: "#5A6175", gold: "#D4AF37", green: "#2ECC71", red: "#FF4757", amber: "#F0B429",
};

function adminHeaders(): Record<string, string> {
  const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
  let id = "";
  try { id = JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch {}
  return {
    "Content-Type": "application/json",
    ...(tok ? { "x-admin-token": tok } : {}),
    ...(id ? { "x-admin-id": id } : {}),
  };
}
const svcName = (k: string) => SERVICE_LABEL[k] || k;
function fmtT(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const inp: React.CSSProperties = {
  background: "#0F1117", color: "#E8EAF0", border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 8, padding: "6px 8px", fontSize: 12, width: "100%",
};

export default function AdminServicesPage() {
  const [view, setView] = useState<"requests" | "pricing" | "payments">("requests");
  const wrap: React.CSSProperties = { background: C.bg, minHeight: "100%", color: C.text, padding: "20px 18px" };

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, margin: 0 }}>Service Access</h1>
      <p style={{ color: C.textSoft, fontSize: 12.5, marginTop: 2 }}>
        Subscription services ke access requests + pricing manage karein.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        {(["requests", "pricing", "payments"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            style={{
              background: view === v ? C.gold : "transparent",
              color: view === v ? "#1a1407" : C.textSoft,
              border: `1px solid ${view === v ? C.gold : C.border}`,
              borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              textTransform: "capitalize",
            }}>
            {v}
          </button>
        ))}
      </div>
      {view === "requests" ? <RequestsView /> : view === "pricing" ? <PricingView /> : <PaymentsView />}
    </div>
  );
}

// ── Subscription payments / revenue ─────────────────────────────────────────
const PLAN_LBL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
function inr(n: any) { return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN"); }

function PaymentsView() {
  const [payments, setPayments] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({ paidCount: 0, revenue: 0, revenue30d: 0, activeSubs: 0 });
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"paid" | "all">("paid");
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/service-payments", { headers: adminHeaders(), cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setPayments(d.payments || []);
      setTotals(d.totals || { paidCount: 0, revenue: 0, revenue30d: 0, activeSubs: 0 });
      setProvisioned(d.provisioned !== false);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = filter === "paid" ? payments.filter((p) => p.status === "paid") : payments;
  const kpi = (label: string, val: string, color = C.gold): React.ReactNode => (
    <div style={{ ...card, padding: 12, flex: "1 1 130px" }}>
      <p style={{ fontSize: 10.5, color: C.textSoft, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 800, color, marginTop: 3 }}>{val}</p>
    </div>
  );

  if (loading) return <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Loading…</div>;

  return (
    <>
      {!provisioned && (
        <div style={{ ...card, marginBottom: 14, borderColor: "rgba(240,180,41,0.4)", background: "rgba(240,180,41,0.08)" }}>
          <p style={{ fontSize: 12.5, color: C.amber, fontWeight: 700 }}>⚠ migrations/2026-05-21-service-payments.sql apply karein.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {kpi("Total revenue", inr(totals.revenue), C.green)}
        {kpi("Last 30 days", inr(totals.revenue30d), C.gold)}
        {kpi("Paid payments", String(totals.paidCount), C.text)}
        {kpi("Active subs", String(totals.activeSubs), C.amber)}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["paid", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              background: filter === f ? C.gold : "transparent",
              color: filter === f ? "#1a1407" : C.textSoft,
              border: `1px solid ${filter === f ? C.gold : C.border}`,
              borderRadius: 8, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              textTransform: "capitalize",
            }}>
            {f === "paid" ? "Paid" : "All"}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Koi payment nahi.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((p) => {
            const paid = p.status === "paid";
            const svcKeys = Array.isArray(p.service_keys) ? p.service_keys : [];
            return (
              <div key={p.id} style={{ ...card, padding: 11, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {p.bundle_id ? "Bundle" : svcName(p.service_key)}
                    <span style={{ color: C.textMuted, fontWeight: 500 }}> · {PLAN_LBL[p.plan] || p.plan}</span>
                  </p>
                  <p style={{ fontSize: 11, color: C.textSoft }}>
                    🏨 {p.hotel_name || p.hotel_id} · {svcKeys.map(svcName).join(", ")}
                  </p>
                  <p style={{ fontSize: 10.5, color: C.textMuted }}>
                    {fmtT(p.paid_at || p.created_at)}{p.expires_at ? ` · expires ${fmtT(p.expires_at)}` : ""}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 14, fontWeight: 800, color: C.gold }}>{inr(p.amount)}</p>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700,
                    color: paid ? C.green : p.status === "failed" ? C.red : C.amber,
                  }}>
                    {String(p.status || "").toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Requests + entitlements ─────────────────────────────────────────────────
const APPROVE_OPTS = [
  { v: "free:0",  label: "Permanent (free)" },
  { v: "free:7",  label: "7-day trial" },
  { v: "free:14", label: "14-day trial" },
  { v: "free:30", label: "30 days free" },
  { v: "free:90", label: "90 days free" },
  { v: "paid:monthly",   label: "Paid · Monthly" },
  { v: "paid:quarterly", label: "Paid · Quarterly" },
  { v: "paid:yearly",    label: "Paid · Yearly" },
];

function RequestsView() {
  const [requests, setRequests] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/service-requests", { headers: adminHeaders(), cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setRequests(d.requests || []);
      setEntitlements(d.entitlements || []);
      setProvisioned(d.provisioned !== false);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: any, key: string) {
    setBusy(key);
    try {
      const r = await fetch("/api/admin/service-requests", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Action failed");
      await load();
    } catch (e: any) { alert("❌ " + (e?.message || "Failed")); }
    finally { setBusy(""); }
  }
  function approve(rq: any) {
    const sel = pick[rq.id] || "free:0";
    const [mode, val] = sel.split(":");
    act({ action: "approve", id: rq.id, ...(mode === "paid" ? { plan: val } : { days: Number(val) }) }, rq.id);
  }

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <>
      {!provisioned && (
        <div style={{ ...card, marginBottom: 14, borderColor: "rgba(240,180,41,0.4)", background: "rgba(240,180,41,0.08)" }}>
          <p style={{ fontSize: 12.5, color: C.amber, fontWeight: 700 }}>⚠ migrations/2026-05-21-hotel-services.sql apply karein.</p>
        </div>
      )}

      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Pending requests {pending.length > 0 && <span style={{ color: C.amber }}>· {pending.length}</span>}
      </p>
      {loading ? (
        <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Loading…</div>
      ) : pending.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Koi pending request nahi.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pending.map((rq) => (
            <div key={rq.id} style={card}>
              <p style={{ fontSize: 13.5, fontWeight: 700 }}>
                {svcName(rq.service_key)}
                <span style={{ color: C.textMuted, fontWeight: 500 }}> · {rq.kind === "free_trial" ? "free trial maanga" : "activate"}</span>
              </p>
              <p style={{ fontSize: 11.5, color: C.textSoft }}>🏨 {rq.hotel_name || rq.hotel_id} · {fmtT(rq.created_at)}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select value={pick[rq.id] || "free:0"} onChange={(e) => setPick((p) => ({ ...p, [rq.id]: e.target.value }))}
                  style={{ ...inp, width: "auto" }}>
                  {APPROVE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                <button onClick={() => approve(rq)} disabled={busy === rq.id}
                  style={{ background: C.green, color: "#06210f", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ✓ Approve
                </button>
                <button onClick={() => act({ action: "reject", id: rq.id }, rq.id)} disabled={busy === rq.id}
                  style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 8px" }}>
        Granted access {entitlements.length > 0 && <span style={{ color: C.textMuted }}>· {entitlements.length}</span>}
      </p>
      {entitlements.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Abhi koi service grant nahi ki.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entitlements.map((e) => {
            const expired = e.expires_at && new Date(e.expires_at).getTime() < Date.now();
            return (
              <div key={e.id} style={{ ...card, padding: 11, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {svcName(e.service_key)}
                    <span style={{ color: expired ? C.red : C.green, fontWeight: 600 }}>
                      {" · "}{expired ? "expired" : e.access_type}{e.plan ? ` (${e.plan})` : ""}
                    </span>
                  </p>
                  <p style={{ fontSize: 11, color: C.textSoft }}>
                    🏨 {e.hotel_id} · {e.expires_at ? `expires ${fmtT(e.expires_at)}` : "no expiry"}
                  </p>
                </div>
                <button onClick={() => act({ action: "revoke", hotelId: e.hotel_id, serviceKey: e.service_key }, e.id)} disabled={busy === e.id}
                  style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Pricing + bundles ───────────────────────────────────────────────────────
function PricingView() {
  const [pricing, setPricing] = useState<Record<string, any>>({});
  const [bundles, setBundles] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [draft, setDraft] = useState<Record<string, { monthly: string; quarterly: string; yearly: string }>>({});
  const [bd, setBd] = useState({ name: "", keys: [] as string[], monthly: "", quarterly: "", yearly: "" });
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 };

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/service-pricing", { headers: adminHeaders(), cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setProvisioned(d.provisioned !== false);
      const map: Record<string, any> = {};
      (d.pricing || []).forEach((p: any) => { map[p.service_key] = p; });
      setPricing(map);
      setBundles(d.bundles || []);
      const dr: Record<string, any> = {};
      SUBSCRIPTION_SERVICES.forEach((k) => {
        const p = map[k];
        dr[k] = {
          monthly: p?.monthly != null ? String(p.monthly) : "",
          quarterly: p?.quarterly != null ? String(p.quarterly) : "",
          yearly: p?.yearly != null ? String(p.yearly) : "",
        };
      });
      setDraft(dr);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(body: any, key: string) {
    setBusy(key);
    try {
      const r = await fetch("/api/admin/service-pricing", { method: "POST", headers: adminHeaders(), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Failed");
      await load();
    } catch (e: any) { alert("❌ " + (e?.message || "Failed")); }
    finally { setBusy(""); }
  }
  const setD = (k: string, f: string, v: string) =>
    setDraft((p) => ({ ...p, [k]: { ...p[k], [f]: v } }));

  if (loading) return <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Loading…</div>;

  return (
    <>
      {!provisioned && (
        <div style={{ ...card, marginBottom: 14, borderColor: "rgba(240,180,41,0.4)", background: "rgba(240,180,41,0.08)" }}>
          <p style={{ fontSize: 12.5, color: C.amber, fontWeight: 700 }}>⚠ migrations/2026-05-21-service-pricing.sql apply karein.</p>
        </div>
      )}

      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Per-service pricing (₹)</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {SUBSCRIPTION_SERVICES.map((k) => {
          const d = draft[k] || { monthly: "", quarterly: "", yearly: "" };
          return (
            <div key={k} style={{ ...card, padding: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, minWidth: 130, flex: "1 1 130px" }}>{svcName(k)}</span>
              {(["monthly", "quarterly", "yearly"] as const).map((f) => (
                <input key={f} value={(d as any)[f]} onChange={(e) => setD(k, f, e.target.value)}
                  type="number" placeholder={f} style={{ ...inp, width: 84 }} />
              ))}
              <button onClick={() => post({ action: "price", serviceKey: k, monthly: d.monthly, quarterly: d.quarterly, yearly: d.yearly }, k)}
                disabled={busy === k}
                style={{ background: C.gold, color: "#1a1407", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                Save
              </button>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 8px" }}>Bundle plans</p>
      {bundles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {bundles.map((b) => (
            <div key={b.id} style={{ ...card, padding: 11, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 700 }}>{b.name}</p>
                <p style={{ fontSize: 11, color: C.textSoft }}>
                  {(Array.isArray(b.service_keys) ? b.service_keys : []).map(svcName).join(" · ")}
                </p>
                <p style={{ fontSize: 11, color: C.gold }}>
                  ₹{b.monthly || "—"}/mo · ₹{b.quarterly || "—"}/qtr · ₹{b.yearly || "—"}/yr
                </p>
              </div>
              <button onClick={() => post({ action: "delete_bundle", id: b.id }, b.id)} disabled={busy === b.id}
                style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={card}>
        <p style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>New bundle</p>
        <input value={bd.name} onChange={(e) => setBd((p) => ({ ...p, name: e.target.value }))}
          placeholder="Bundle name (e.g. Restaurant Pack)" style={{ ...inp, marginBottom: 8 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {SUBSCRIPTION_SERVICES.map((k) => {
            const on = bd.keys.includes(k);
            return (
              <button key={k} onClick={() => setBd((p) => ({ ...p, keys: on ? p.keys.filter((x) => x !== k) : [...p.keys, k] }))}
                style={{
                  background: on ? C.gold : "transparent", color: on ? "#1a1407" : C.textSoft,
                  border: `1px solid ${on ? C.gold : C.border}`, borderRadius: 999, padding: "4px 9px",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                {on ? "✓ " : ""}{svcName(k)}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["monthly", "quarterly", "yearly"] as const).map((f) => (
            <input key={f} value={(bd as any)[f]} onChange={(e) => setBd((p) => ({ ...p, [f]: e.target.value }))}
              type="number" placeholder={`₹ ${f}`} style={{ ...inp, width: 100 }} />
          ))}
          <button onClick={() => post({ action: "bundle", name: bd.name, serviceKeys: bd.keys, monthly: bd.monthly, quarterly: bd.quarterly, yearly: bd.yearly }, "new-bundle")}
            disabled={busy === "new-bundle"}
            style={{ background: C.gold, color: "#1a1407", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Create bundle
          </button>
        </div>
      </div>
    </>
  );
}
