"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Admin → Service Access
// ═══════════════════════════════════════════════════════════════════════════
// Hotels request access to subscription services; admin approves (free, with
// a duration) or rejects. Granted entitlements can be revoked.
// Auth: x-admin-token / x-admin-id headers.
import { useCallback, useEffect, useState } from "react";
import { SERVICE_LABEL } from "@/lib/partner/services";

const C = {
  bg: "#07080C", surface: "#0F1117", card: "#151820",
  border: "rgba(255,255,255,0.07)", text: "#E8EAF0", textSoft: "#8A8FA8",
  textMuted: "#5A6175", gold: "#D4AF37", green: "#2ECC71", red: "#FF4757", amber: "#F0B429",
};

const DURATIONS = [
  { d: 0,  label: "Permanent (free)" },
  { d: 7,  label: "7-day trial" },
  { d: 14, label: "14-day trial" },
  { d: 30, label: "30 days" },
  { d: 90, label: "90 days" },
];

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

export default function AdminServicesPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/service-requests", { headers: adminHeaders(), cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setRequests(d.requests || []);
      setEntitlements(d.entitlements || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body: any, key: string) {
    setBusy(key);
    try {
      const r = await fetch("/api/admin/service-requests", {
        method: "POST", headers: adminHeaders(), body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Action failed");
      await load();
    } catch (e: any) { alert("❌ " + (e?.message || "Failed")); }
    finally { setBusy(""); }
  }

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 40);

  const wrap: React.CSSProperties = { background: C.bg, minHeight: "100%", color: C.text, padding: "20px 18px" };
  const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 };

  return (
    <div style={wrap}>
      <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, margin: 0 }}>Service Access</h1>
      <p style={{ color: C.textSoft, fontSize: 12.5, marginTop: 2 }}>
        Hotels ki subscription-service requests — approve (free / trial) ya reject. Granted access revoke bhi kar sakte ho.
      </p>

      {!provisioned && (
        <div style={{ ...card, marginTop: 14, borderColor: "rgba(240,180,41,0.4)", background: "rgba(240,180,41,0.08)" }}>
          <p style={{ fontSize: 12.5, color: C.amber, fontWeight: 700 }}>⚠ Service tables not provisioned</p>
          <p style={{ fontSize: 11.5, color: C.textSoft }}>migrations/2026-05-21-hotel-services.sql apply karein.</p>
        </div>
      )}

      {/* pending requests */}
      <div style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          Pending requests {pending.length > 0 && <span style={{ color: C.amber }}>· {pending.length}</span>}
        </p>
        {loading ? (
          <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Loading…</div>
        ) : pending.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: C.textSoft, fontSize: 12.5 }}>Koi pending request nahi.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map((rq) => {
              const dsel = days[rq.id] ?? 0;
              return (
                <div key={rq.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <p style={{ fontSize: 13.5, fontWeight: 700 }}>
                        {svcName(rq.service_key)}
                        <span style={{ color: C.textMuted, fontWeight: 500 }}> · {rq.kind === "free_trial" ? "free trial maanga" : "activate"}</span>
                      </p>
                      <p style={{ fontSize: 11.5, color: C.textSoft }}>
                        🏨 {rq.hotel_name || rq.hotel_id} · {fmtT(rq.created_at)}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={dsel} onChange={(e) => setDays((p) => ({ ...p, [rq.id]: Number(e.target.value) }))}
                      style={{ background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                      {DURATIONS.map((x) => <option key={x.d} value={x.d}>{x.label}</option>)}
                    </select>
                    <button onClick={() => act({ action: "approve", id: rq.id, days: dsel }, rq.id)}
                      disabled={busy === rq.id}
                      style={{ background: C.green, color: "#06210f", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      ✓ Approve free
                    </button>
                    <button onClick={() => act({ action: "reject", id: rq.id }, rq.id)}
                      disabled={busy === rq.id}
                      style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* granted entitlements */}
      <div style={{ marginTop: 18 }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
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
                      <span style={{ color: expired ? C.red : C.green, fontWeight: 600 }}> · {expired ? "expired" : e.access_type}</span>
                    </p>
                    <p style={{ fontSize: 11, color: C.textSoft }}>
                      🏨 {e.hotel_id} · {e.expires_at ? `expires ${fmtT(e.expires_at)}` : "no expiry"}
                    </p>
                  </div>
                  <button onClick={() => act({ action: "revoke", hotelId: e.hotel_id, serviceKey: e.service_key }, e.id)}
                    disabled={busy === e.id}
                    style={{ background: "transparent", color: C.red, border: `1px solid ${C.red}`, borderRadius: 8, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
