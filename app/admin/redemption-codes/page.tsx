"use client";
// /admin/redemption-codes — full audit feed of every issued code. Filter by
// status/kind/rule, revoke abusive ones, extend expiry for support cases.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Code = {
  id: string;
  code: string;
  barcode_value: string;
  user_id: string;
  rule_slug: string | null;
  kind: string;
  title: string | null;
  value_inr: number;
  points_spent: number;
  status: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  used_on_bid_id: string | null;
  used_by_hotel_id: string | null;
  user?: { id: string; name?: string; phone?: string; email?: string } | null;
};

const KIND_LABEL: Record<string, string> = {
  coupon: "🎟️ Coupon",
  wallet_credit: "💰 Wallet",
  amenity: "🏨 Amenity",
  voucher: "🎁 Voucher",
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  active:  { bg: "rgba(46,204,113,0.15)", text: "#2ECC71" },
  used:    { bg: "rgba(138,143,168,0.15)", text: "#8A8FA8" },
  expired: { bg: "rgba(255,71,87,0.15)", text: "#FF4757" },
  revoked: { bg: "rgba(140, 160, 182,0.15)", text: "#c6d0da" },
};

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—";

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

export default function AdminRedemptionCodesPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [kpis, setKpis] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Code | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const load = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (kind) params.kind = kind;
    api.adminGetRedemptionCodes(params).then((d: any) => {
      setCodes(d?.codes || []);
      setKpis(d?.kpis || {});
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, kind]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return codes;
    return codes.filter((c) =>
      c.code.toLowerCase().includes(s) ||
      c.barcode_value.includes(s) ||
      (c.title || "").toLowerCase().includes(s) ||
      (c.user?.name || "").toLowerCase().includes(s) ||
      (c.user?.phone || "").includes(s) ||
      (c.user?.email || "").toLowerCase().includes(s),
    );
  }, [codes, search]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  async function revoke(c: Code) {
    if (!confirm(`Revoke code ${c.code}? Customer will lose this benefit.`)) return;
    setBusy(true);
    const r = await api.adminRedemptionCodeAction(c.id, "revoke");
    if (r?.ok) {
      showToast("Revoked");
      setDetail(null);
      await load();
    } else {
      alert(r?.error || "Failed");
    }
    setBusy(false);
  }

  async function extend(c: Code) {
    const daysStr = prompt(`Extend expiry by how many days?`, "30");
    if (!daysStr) return;
    const days = parseInt(daysStr, 10);
    if (!days || days < 1) return;
    setBusy(true);
    const r = await api.adminRedemptionCodeAction(c.id, "extend", days);
    if (r?.ok) {
      showToast(`Extended by ${days} days`);
      setDetail(null);
      await load();
    } else {
      alert(r?.error || "Failed");
    }
    setBusy(false);
  }

  return (
    <div style={{ padding: 0, fontFamily: "DM Sans, sans-serif" }}>
      <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 22, color: "#E8EAF0", margin: 0, marginBottom: 16 }}>
        🎟️ Issued Codes
      </h1>

      <div className="admin-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Total", kpis.totalIssued || 0, "#9fb1c2"],
          ["Active", kpis.activeCount || 0, "#2ECC71"],
          ["Used", kpis.usedCount || 0, "#3D9CF5"],
          ["Expired", kpis.expiredCount || 0, "#8A8FA8"],
          ["Revoked", kpis.revokedCount || 0, "#FF4757"],
          ["Points Spent", fmt(kpis.totalPointsSpent || 0), "#c6d0da"],
          ["₹ Cost (used)", `₹${fmt(kpis.usedRupeeCost || 0)}`, "#A855F7"],
        ].map(([label, val, color]) => (
          <div key={String(label)} className="admin-card" style={{ background: "#151820", padding: 14, borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: 11, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{label}</p>
            <p style={{ fontSize: 22, color: color as string, fontWeight: 700, marginTop: 4, marginBottom: 0, fontFamily: "Syne, sans-serif" }}>{val}</p>
          </div>
        ))}
      </div>

      <div className="admin-filters" style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          style={inputStyle}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="used">Used</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          style={inputStyle}>
          <option value="">All kinds</option>
          <option value="coupon">Coupon</option>
          <option value="wallet_credit">Wallet Credit</option>
          <option value="amenity">Amenity</option>
          <option value="voucher">Voucher</option>
        </select>
        <input type="text" placeholder="Search code / user / phone / email"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
      </div>

      {loading ? (
        <p style={{ color: "#8A8FA8" }}>Loading…</p>
      ) : (
        <div className="admin-data-table-wrap" style={{ background: "#151820", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", textAlign: "left" }}>
                {["Code", "Customer", "Kind", "Reward", "Value", "Points", "Issued", "Expires", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontSize: 11, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <p style={{ fontFamily: "monospace", color: "#E8EAF0", fontWeight: 700, margin: 0, fontSize: 12 }}>{c.code}</p>
                    <p style={{ fontFamily: "monospace", color: "#5C627A", fontSize: 10, margin: 0, marginTop: 2 }}>{c.barcode_value}</p>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <p style={{ color: "#E8EAF0", fontSize: 12, margin: 0, fontWeight: 600 }}>{c.user?.name || "—"}</p>
                    <p style={{ color: "#8A8FA8", fontSize: 11, margin: 0, marginTop: 2 }}>{c.user?.phone || c.user?.email || "—"}</p>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#E8EAF0" }}>{KIND_LABEL[c.kind] || c.kind}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#E8EAF0" }}>{c.title || c.rule_slug || "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#9fb1c2", fontWeight: 600 }}>
                    {Number(c.value_inr) > 0 ? `₹${fmt(Number(c.value_inr))}` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#c6d0da", fontWeight: 600 }}>{fmt(c.points_spent)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "#8A8FA8" }}>{fmtDate(c.issued_at)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "#8A8FA8" }}>{fmtDate(c.expires_at)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                      background: (STATUS_COLOR[c.status] || STATUS_COLOR.expired).bg,
                      color: (STATUS_COLOR[c.status] || STATUS_COLOR.expired).text,
                      letterSpacing: "0.1em",
                    }}>{(c.status || "").toUpperCase()}</span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => setDetail(c)}
                      style={{ background: "transparent", color: "#9fb1c2", border: "1px solid rgba(140, 160, 182,0.3)", padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p style={{ textAlign: "center", padding: 30, color: "#8A8FA8" }}>No codes match.</p>}
        </div>
      )}

      {detail && (
        <div onClick={() => setDetail(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#0F1117", borderRadius: 16, width: "100%", maxWidth: 500, padding: 22,
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <h2 style={{ fontFamily: "Syne, sans-serif", color: "#9fb1c2", marginTop: 0, fontSize: 18 }}>Code Details</h2>
            <div style={{ background: "#07080C", padding: 16, borderRadius: 12, border: "1px dashed rgba(140, 160, 182,0.4)", textAlign: "center", marginBottom: 14 }}>
              <p style={{ fontFamily: "monospace", color: "#E8EAF0", fontSize: 22, letterSpacing: "0.15em", fontWeight: 700, margin: 0 }}>{detail.code}</p>
              <p style={{ fontFamily: "monospace", color: "#8A8FA8", fontSize: 12, marginTop: 6, marginBottom: 0 }}>{detail.barcode_value}</p>
            </div>
            {[
              ["Customer", detail.user?.name || detail.user_id],
              ["Phone", detail.user?.phone || "—"],
              ["Email", detail.user?.email || "—"],
              ["Kind", KIND_LABEL[detail.kind] || detail.kind],
              ["Reward", detail.title || "—"],
              ["Value", Number(detail.value_inr) > 0 ? `₹${fmt(Number(detail.value_inr))}` : "—"],
              ["Points spent", fmt(detail.points_spent)],
              ["Status", detail.status],
              ["Issued", fmtDate(detail.issued_at)],
              ["Expires", fmtDate(detail.expires_at)],
              ["Used at", fmtDate(detail.used_at)],
              ["Used on bid", detail.used_on_bid_id || "—"],
              ["Used at hotel", detail.used_by_hotel_id || "—"],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ color: "#8A8FA8", fontSize: 12 }}>{k}</span>
                <span style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600, textAlign: "right" }}>{v as any}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {detail.status === "active" && (
                <button onClick={() => revoke(detail)} disabled={busy}
                  style={{ flex: 1, minWidth: 120, background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)", padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ⛔ Revoke
                </button>
              )}
              {(detail.status === "active" || detail.status === "expired") && (
                <button onClick={() => extend(detail)} disabled={busy}
                  style={{ flex: 1, minWidth: 120, background: "rgba(140, 160, 182,0.1)", color: "#9fb1c2", border: "1px solid rgba(140, 160, 182,0.3)", padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ⏰ Extend
                </button>
              )}
              <button onClick={() => setDetail(null)}
                style={{ flex: 1, minWidth: 120, background: "transparent", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.12)", padding: "9px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: "#0F1117", color: "#9fb1c2", padding: "10px 18px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, border: "1px solid rgba(140, 160, 182,0.3)",
          zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>{toast}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#07080C",
  color: "#E8EAF0",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12,
  fontFamily: "inherit",
};
