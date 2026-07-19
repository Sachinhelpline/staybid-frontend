"use client";

// v361 — Model 3 admin oversight: travel-agent approvals, auction config, lots
// (+ force-clear), awards, and EMD-refund marking. Dark-luxury, mirrors
// /admin/circle-inventory. All calls carry x-admin-token.

import { useCallback, useEffect, useState } from "react";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
function hdr() {
  const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
  return { "x-admin-token": t, "Content-Type": "application/json" };
}
const monthLabel = (mk: string) => {
  try { const [y, m] = String(mk).split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }); }
  catch { return mk; }
};

const AGENT_STYLE: Record<string, string> = { pending: "#F0B429", approved: "#2ECC71", rejected: "#FF4757", suspended: "#8A8FA8" };
const LOT_STYLE: Record<string, string> = { draft: "#8A8FA8", open: "#2ECC71", closed: "#A855F7", awarded: "#3D9CF5", cancelled: "#FF4757" };

export default function AdminAuctionPage() {
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, cf] = await Promise.all([
        fetch("/api/admin/auction", { headers: hdr(), cache: "no-store" }),
        fetch("/api/admin/auction-config", { headers: hdr(), cache: "no-store" }),
      ]);
      const od = await ov.json(); const cd = await cf.json();
      if (ov.ok) setData(od);
      if (cf.ok) setCfg(cd.config);
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 2500); };

  const agentAction = async (agentId: string, action: string) => {
    setBusy(agentId);
    try { const r = await fetch("/api/admin/trade-agents", { method: "POST", headers: hdr(), body: JSON.stringify({ agentId, action }) }); if (r.ok) { say(`Agent ${action}d`); load(); } else say((await r.json()).error || "Failed"); }
    finally { setBusy(""); }
  };
  const forceClear = async (lotId: string) => {
    setBusy(lotId);
    try { const r = await fetch("/api/admin/auction/clear", { method: "POST", headers: hdr(), body: JSON.stringify({ lotId }) }); const d = await r.json(); if (r.ok) { say(`Cleared: ${d.awards} won, ${d.losers} lost`); load(); } else say(d.error || "Failed"); }
    finally { setBusy(""); }
  };
  const refundBid = async (bidId: string) => {
    setBusy(bidId);
    try { const r = await fetch("/api/admin/auction", { method: "POST", headers: hdr(), body: JSON.stringify({ action: "refund_bid", bidId }) }); if (r.ok) { say("Refund marked"); load(); } else say((await r.json()).error || "Failed"); }
    finally { setBusy(""); }
  };
  const saveCfg = async () => {
    setBusy("cfg");
    try { const r = await fetch("/api/admin/auction-config", { method: "POST", headers: hdr(), body: JSON.stringify(cfg) }); const d = await r.json(); if (r.ok) { setCfg(d.config); say("Config saved"); } else say(d.error || "Failed"); }
    finally { setBusy(""); }
  };

  const card: React.CSSProperties = { background: "#161A2B", border: "1px solid #2A3050", borderRadius: 14, padding: 16, marginBottom: 16 };
  const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase" };
  const td: React.CSSProperties = { padding: "6px 8px", fontSize: 13, borderTop: "1px solid #232842" };
  const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: 0, borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" });

  return (
    <div style={{ minHeight: "100vh", background: "#0E1120", color: "#E6E8F0", padding: "20px 16px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#F0B429" }}>🏷️ Model 3 — Travel-Agent Auction</h1>
        <p style={{ color: "#8A8FA8", fontSize: 13, marginTop: 2 }}>Agent approvals · auction config · lots · awards · EMD refunds</p>
        {flash && <div style={{ marginTop: 10, background: "#12351f", color: "#5EE29B", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>{flash}</div>}

        {loading || !data ? <div style={{ padding: 40, textAlign: "center", color: "#8A8FA8" }}>Loading…</div> : (
          <>
            {/* Config */}
            {cfg && (
              <div style={card}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>⚙️ Auction config</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
                  {[["buyerPremiumPct", "Buyer premium %"], ["sellerFeePct", "Seller fee %"], ["depositPct", "EMD deposit %"], ["windowOpenDay", "Window open day"], ["payWindowHours", "Pay window hrs"], ["circleFloorMultiplier", "Circle floor ×"]].map(([k, label]) => (
                    <label key={k} style={{ fontSize: 12, color: "#8A8FA8" }}>{label}
                      <input type="number" value={cfg[k as string] ?? 0} onChange={(e) => setCfg({ ...cfg, [k as string]: Number(e.target.value) })}
                        style={{ width: "100%", marginTop: 4, background: "#0E1120", border: "1px solid #2A3050", borderRadius: 8, color: "#fff", padding: "6px 8px", fontSize: 13 }} />
                    </label>
                  ))}
                </div>
                <button onClick={saveCfg} disabled={busy === "cfg"} style={{ ...btn("#F0B429"), color: "#161A2B", marginTop: 10 }}>Save config</button>
              </div>
            )}

            {/* Agents */}
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>🧳 Travel agents ({data.agents.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                  <thead><tr><th style={th}>Agency</th><th style={th}>Email</th><th style={th}>City</th><th style={th}>Status</th><th style={th}>Actions</th></tr></thead>
                  <tbody>
                    {data.agents.map((a: any) => (
                      <tr key={a.id}>
                        <td style={td}>{a.agency_name || "—"}<div style={{ color: "#8A8FA8", fontSize: 11 }}>{a.name}</div></td>
                        <td style={td}>{a.email || "—"}</td>
                        <td style={td}>{a.city || "—"}</td>
                        <td style={td}><span style={{ color: AGENT_STYLE[a.status] || "#8A8FA8", fontWeight: 700 }}>{a.status}</span></td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {a.status !== "approved" && <button onClick={() => agentAction(a.id, "approve")} disabled={busy === a.id} style={btn("#2ECC71")}>Approve</button>}
                            {a.status !== "rejected" && <button onClick={() => agentAction(a.id, "reject")} disabled={busy === a.id} style={btn("#FF4757")}>Reject</button>}
                            {a.status === "approved" && <button onClick={() => agentAction(a.id, "suspend")} disabled={busy === a.id} style={btn("#8A8FA8")}>Suspend</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Lots */}
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>📦 Lots ({data.lots.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                  <thead><tr><th style={th}>Room · City</th><th style={th}>Month</th><th style={th}>Rooms</th><th style={th}>Min bid</th><th style={th}>Status</th><th style={th}>Action</th></tr></thead>
                  <tbody>
                    {data.lots.map((l: any) => (
                      <tr key={l.id}>
                        <td style={td}>{l.category || l.room_id}<div style={{ color: "#8A8FA8", fontSize: 11 }}>{l.city}</div></td>
                        <td style={td}>{monthLabel(l.month_key)}</td>
                        <td style={td}>{l.num_rooms}</td>
                        <td style={td}>{inr(l.min_bid_per_room_night)}</td>
                        <td style={td}><span style={{ color: LOT_STYLE[l.status] || "#8A8FA8", fontWeight: 700 }}>{l.status}</span></td>
                        <td style={td}>{l.status === "open" && <button onClick={() => forceClear(l.id)} disabled={busy === l.id} style={btn("#3D9CF5")}>Force clear</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Awards */}
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>🏆 Awards ({data.awards.length})</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                  <thead><tr><th style={th}>Room · City</th><th style={th}>Month</th><th style={th}>Rooms</th><th style={th}>Due</th><th style={th}>Status</th><th style={th}>Voucher</th></tr></thead>
                  <tbody>
                    {data.awards.map((a: any) => (
                      <tr key={a.id}>
                        <td style={td}>{a.room_id}<div style={{ color: "#8A8FA8", fontSize: 11 }}>{a.city}</div></td>
                        <td style={td}>{monthLabel(a.month_key)}</td>
                        <td style={td}>{a.rooms_awarded}</td>
                        <td style={td}>{inr(a.amount_due)}</td>
                        <td style={td}>{a.status}</td>
                        <td style={td}>{a.voucher_code || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Refunds owed */}
            <div style={card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>💸 EMD refunds owed ({data.refundsOwed.length})</div>
              {data.refundsOwed.length === 0 ? <div style={{ color: "#8A8FA8", fontSize: 13 }}>No refunds pending.</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead><tr><th style={th}>Bid</th><th style={th}>Segment</th><th style={th}>EMD</th><th style={th}>Action</th></tr></thead>
                    <tbody>
                      {data.refundsOwed.map((b: any) => (
                        <tr key={b.id}>
                          <td style={td}>{b.id.slice(-8)}</td>
                          <td style={td}>{b.segment_label}</td>
                          <td style={td}>{inr(b.deposit_amount)}</td>
                          <td style={td}><button onClick={() => refundBid(b.id)} disabled={busy === b.id} style={btn("#A855F7")}>Mark refunded</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
