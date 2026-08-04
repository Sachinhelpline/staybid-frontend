"use client";
// v330 — Circle Phase C4: admin oversight for Model 3 pre-buy inventory.
// v333 — Circle Phase D3: + Model 4 B2B exchange settlement payouts.
// Investor blocks + resale settlement ledger + B2B trade settlements, with
// force-expire / buyback / mark-payout-paid / mark-settlement-paid actions.
// Dark-luxury, mirrors /admin/channels.
import { useCallback, useEffect, useState } from "react";
import { ReceiptText, RotateCw, ArrowLeftRight, Banknote, Home, Package, TriangleAlert, Shield } from "lucide-react";

const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

const STATUS_COLOR: Record<string, string> = {
  draft: "#8A8FA8", quoted: "#8A8FA8", pending_payment: "#a9b9c8",
  owned: "#3D9CF5", listed: "#2ECC71", sold: "#2ECC71",
  expired: "#8A8FA8", cancelled: "#FF4757", refunded: "#D8B4FE",
};

function adminId(): string {
  if (typeof window === "undefined") return "";
  try { return JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch { return ""; }
}
function ago(ts: any): string {
  if (!ts) return "—";
  let s = String(ts); if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const t = Date.parse(s); if (!Number.isFinite(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.round(m / 60);
  if (h < 48) return `${h}h`; return `${Math.round(h / 24)}d`;
}

const FILTERS = ["all", "owned", "listed", "sold", "expired", "refunded", "draft"] as const;
const B2B_FILTERS = ["all", "listed", "sold", "expired", "cancelled", "withdrawn"] as const;

export default function AdminCircleInventory() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [b2bFilter, setB2bFilter] = useState<(typeof B2B_FILTERS)[number]>("all");
  // v347 — admin-controlled dual B2B commission (5% buyer + 5% seller default).
  const [feeCfg, setFeeCfg] = useState<{ buyerFeePct: number; sellerFeePct: number; cityAccessPrice?: number; regulatedMarkupPct?: number; resaleMultiplier?: number; resaleMultiplierMin?: number; resaleMultiplierMax?: number } | null>(null);
  const [feeDraft, setFeeDraft] = useState<{ buyer: string; seller: string; city: string; mult: string; multMin: string; multMax: string }>({ buyer: "", seller: "", city: "", mult: "", multMin: "", multMax: "" });
  const [feeBusy, setFeeBusy] = useState(false);
  // v355 — per-listing resale multiplier drafts (keyed by listing id).
  const [multDraft, setMultDraft] = useState<Record<string, string>>({});

  const headers = useCallback((): HeadersInit => ({
    "x-admin-token": typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "",
    "x-admin-id": adminId(),
  }), []);

  const load = useCallback(() => {
    setLoading(true); setErr("");
    fetch(`/api/admin/circle-inventory?status=${filter}`, { headers: headers(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setData(d); })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  }, [headers, filter]);

  useEffect(() => { load(); }, [load]);

  // v347 — load the current dual B2B commission %.
  useEffect(() => {
    fetch("/api/admin/b2b-fee", { headers: headers(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.config) {
          setFeeCfg(d.config);
          setFeeDraft({
            buyer: String(d.config.buyerFeePct),
            seller: String(d.config.sellerFeePct),
            city: String(d.config.cityAccessPrice ?? 999),
            mult: String(d.config.resaleMultiplier ?? 2),
            multMin: String(d.config.resaleMultiplierMin ?? 1.5),
            multMax: String(d.config.resaleMultiplierMax ?? 3),
          });
        }
      })
      .catch(() => {});
  }, [headers]);

  const saveFee = async () => {
    setFeeBusy(true); setFlash(""); setErr("");
    try {
      const r = await fetch("/api/admin/b2b-fee", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ buyerFeePct: Number(feeDraft.buyer), sellerFeePct: Number(feeDraft.seller), cityAccessPrice: Number(feeDraft.city), resaleMultiplier: Number(feeDraft.mult), resaleMultiplierMin: Number(feeDraft.multMin), resaleMultiplierMax: Number(feeDraft.multMax) }),
      });
      const d = await r.json();
      if (!r.ok || d?.error) throw new Error(d?.error || "Save failed");
      setFeeCfg(d.config);
      setFlash("B2B commission updated ✓ (applies to new listings)");
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setFeeBusy(false); }
  };

  const act = async (payload: any, key: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(key); setFlash(""); setErr("");
    try {
      const r = await fetch("/api/admin/circle-inventory", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok || d?.error) throw new Error(d?.error || "Action failed");
      setFlash("Done ✓");
      load();
    } catch (e: any) { setErr(e?.message || "Action failed"); }
    finally { setBusy(""); }
  };

  const k = data?.kpis || { investorOwed: 0, investorPaid: 0, platformFees: 0, gmv: 0, byStatus: {}, totalBlocks: 0, buybackOwed: 0, b2bOwed: 0, b2bPaid: 0, b2bFees: 0, b2bGmv: 0, b2bListingsByStatus: {}, b2bListingsActive: 0, b2bListedGmv: 0, b2bListingsTotal: 0 };
  const blocks: any[] = data?.blocks || [];
  const sales: any[] = data?.sales || [];
  const owedSales = sales.filter((s) => s.status === "paid" && s.payout_status === "owed");
  // v333 — D3: Model 4 B2B trade settlements owed to sellers.
  const settlements: any[] = data?.settlements || [];
  const owedSettlements = settlements.filter((s) => s.payout_status === "owed");
  // S2 — guest-booking owner settlements (owed = payable to Circle owners).
  const gbSettlements: any[] = data?.guestBookingSettlements || [];
  const gbOwedList = gbSettlements.filter((s) => s.payout_status === "owed");
  // v390 — per-owner payout batches (owed grouped per owner + payout-account status).
  const payoutBatches: any[] = data?.payoutBatches || [];
  const rxConfigured: boolean = !!data?.razorpayxConfigured; // v391 — RazorpayX money-out live?
  // v334 — D4: Model 4 B2B exchange listings oversight.
  const b2bListings: any[] = data?.b2bListings || [];
  const shownListings = b2bFilter === "all" ? b2bListings : b2bListings.filter((l) => l.status === b2bFilter);

  const th: React.CSSProperties = { textAlign: "left", color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "10px 12px" };
  const td: React.CSSProperties = { padding: "11px 12px", color: "#E8EAF0", fontSize: 12.5, borderTop: "1px solid rgba(255,255,255,0.05)" };
  const btn = (color: string): React.CSSProperties => ({ background: `${color}22`, border: `1px solid ${color}55`, color, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#E8EAF0", fontSize: 24, fontWeight: 800, margin: 0, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 9 }}><ReceiptText size={22} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />Circle Inventory</h1>
          <div style={{ color: "#8A8FA8", fontSize: 13, marginTop: 4 }}>Model 2 pre-buy blocks + resale settlement · exchange payouts</div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#E8EAF0", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {loading ? "…" : <><RotateCw size={14} strokeWidth={2.2} aria-hidden />Refresh</>}
        </button>
      </div>

      {/* v347 — dual B2B commission control (5% buyer + 5% seller default). */}
      <div style={{ background: "rgba(61,156,245,0.06)", border: "1px solid rgba(61,156,245,0.22)", borderRadius: 12, padding: "14px 16px", marginBottom: 18, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ color: "#E8EAF0", fontSize: 14, fontWeight: 700, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7 }}><ArrowLeftRight size={15} strokeWidth={2} aria-hidden />B2B exchange commission</div>
          <div style={{ color: "#8A8FA8", fontSize: 11.5, marginTop: 2 }}>Resale price = owner&apos;s own price/night × multiplier (2 = double). Buyer pays ask + buyer %; seller receives ask − seller %. NEW listings only.</div>
        </div>
        <label style={{ color: "#8A8FA8", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
          Buyer %
          <input type="number" min={0} max={100} value={feeDraft.buyer}
            onChange={(e) => setFeeDraft((s) => ({ ...s, buyer: e.target.value }))}
            style={{ width: 78, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
        </label>
        <label style={{ color: "#8A8FA8", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
          Seller %
          <input type="number" min={0} max={100} value={feeDraft.seller}
            onChange={(e) => setFeeDraft((s) => ({ ...s, seller: e.target.value }))}
            style={{ width: 78, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
        </label>
        <label style={{ color: "#8A8FA8", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}>
          City access ₹
          <input type="number" min={0} value={feeDraft.city}
            onChange={(e) => setFeeDraft((s) => ({ ...s, city: e.target.value }))}
            style={{ width: 96, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
        </label>
        <label style={{ color: "#8A8FA8", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}
          title="Resale price = owner's own price/night × this multiplier (2 = double). E.g. a room owned at ₹30k/mo = ₹1,000/day → lists at ₹2,000/day. Applies to new listings.">
          Resale ×
          <input type="number" min={1} max={20} step={0.5} value={feeDraft.mult}
            onChange={(e) => setFeeDraft((s) => ({ ...s, mult: e.target.value }))}
            style={{ width: 78, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
        </label>
        <label style={{ color: "#8A8FA8", fontSize: 12, display: "flex", flexDirection: "column", gap: 3 }}
          title="Owner-choice band: on their own B2B listing the owner may pick a resale multiplier within [min,max]. Keeps Model-2 regulated (bounded, not free). The global default above must sit inside this band.">
          Owner band ×
          <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="number" min={1} max={20} step={0.5} value={feeDraft.multMin}
              onChange={(e) => setFeeDraft((s) => ({ ...s, multMin: e.target.value }))}
              style={{ width: 56, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
            <span style={{ opacity: 0.6 }}>–</span>
            <input type="number" min={1} max={20} step={0.5} value={feeDraft.multMax}
              onChange={(e) => setFeeDraft((s) => ({ ...s, multMax: e.target.value }))}
              style={{ width: 56, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 8, padding: "6px 8px", fontFamily: "inherit" }} />
          </span>
        </label>
        <button onClick={saveFee} disabled={feeBusy}
          style={{ background: "#3D9CF522", border: "1px solid #3D9CF555", color: "#3D9CF5", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-end" }}>
          {feeBusy ? "Saving…" : "Save commission"}
        </button>
        {feeCfg && (
          <span style={{ color: "#8A8FA8", fontSize: 11.5, alignSelf: "flex-end" }}>
            live: {feeCfg.buyerFeePct}% + {feeCfg.sellerFeePct}% · city ₹{feeCfg.cityAccessPrice ?? 999} · resale {feeCfg.resaleMultiplier ?? 2}× own price · owner band {feeCfg.resaleMultiplierMin ?? 1.5}×–{feeCfg.resaleMultiplierMax ?? 3}×
          </span>
        )}
      </div>

      {err && <div style={{ background: "rgba(255,71,87,0.12)", border: "1px solid rgba(255,71,87,0.3)", color: "#FF4757", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{err}</div>}
      {flash && <div style={{ background: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.3)", color: "#2ECC71", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{flash}</div>}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { v: inr(k.investorOwed), label: "Investor payout owed", color: "#a9b9c8" },
          { v: inr(k.investorPaid), label: "Investor payout paid", color: "#2ECC71" },
          { v: inr(k.platformFees), label: "Platform fees", color: "#9fb1c2" },
          { v: inr(k.gmv), label: "Resale GMV", color: "#3D9CF5" },
          { v: String(k.totalBlocks || 0), label: "Total blocks", color: "#E8EAF0" },
          { v: String(k.buybackOwed || 0), label: "Buyback owed", color: "#D8B4FE" },
          { v: inr(k.b2bOwed), label: "Exchange seller owed", color: "#a9b9c8" },
          { v: inr(k.b2bPaid), label: "Exchange settled", color: "#2ECC71" },
          { v: String(k.b2bListingsActive || 0), label: "Exchange live listings", color: "#D8B4FE" },
          { v: inr(k.b2bListedGmv), label: "Exchange listed GMV", color: "#3D9CF5" },
        ].map((c, i) => (
          <div key={i} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ color: c.color, fontSize: 22, fontWeight: 800, fontFamily: "Syne, sans-serif" }}>{c.v}</div>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Payouts owed (settlement) */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, marginBottom: 10, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7 }}><Banknote size={16} strokeWidth={2} aria-hidden />Payouts owed to investors</div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {owedSales.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No outstanding investor payouts."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Hotel", "Investor", "Dates", "Resale", "Fee", "Investor net", "Paid", "Action"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {owedSales.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{s.hotel_name || s.hotel_id}</td>
                      <td style={td}>{s.investor_name || <span style={{ color: "#8A8FA8" }}>{String(s.investor_user_id).slice(-6)}</span>}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{s.date_from} → {s.date_to}</td>
                      <td style={td}>{inr(s.resale_total)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{inr(s.platform_fee)}</td>
                      <td style={{ ...td, color: "#a9b9c8", fontWeight: 700 }}>{inr(s.investor_net)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{ago(s.paid_at)} ago</td>
                      <td style={td}>
                        <button disabled={busy === s.id} onClick={() => act({ action: "mark_payout_paid", saleId: s.id }, s.id, `Mark ${inr(s.investor_net)} paid to investor?`)} style={btn("#2ECC71")}>
                          {busy === s.id ? "…" : "Mark paid"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* v333 — D3: Model 4 B2B exchange settlements owed to sellers */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, marginBottom: 10, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7 }}><ArrowLeftRight size={16} strokeWidth={2} aria-hidden />Exchange payouts owed to sellers <span style={{ color: "#8A8FA8", fontSize: 12, fontWeight: 500 }}>· Model 2</span></div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {owedSettlements.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No outstanding exchange payouts."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Hotel · Unit", "Seller", "Dates", "Buyer paid", "Fee", "Seller net", "When", "Action"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {owedSettlements.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{s.hotel_name || "—"}</div>
                        <div style={{ color: "#8A8FA8", fontSize: 11 }}>#{s.unit_number || "—"}{s.nights != null ? ` · ${s.nights}n` : ""}</div>
                      </td>
                      <td style={td}>{s.seller_name || <span style={{ color: "#8A8FA8" }}>{String(s.payee_user_id).slice(-6)}</span>}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{s.date_from ? `${s.date_from} → ${s.date_to}` : "—"}</td>
                      <td style={td}>{inr(s.gross_amount)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{inr(s.platform_fee)}</td>
                      <td style={{ ...td, color: "#a9b9c8", fontWeight: 700 }}>{inr(s.net_amount)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{ago(s.created_at)} ago</td>
                      <td style={td}>
                        <button disabled={busy === s.id} onClick={() => act({ action: "mark_settlement_paid", settlementId: s.id }, s.id, `Mark ${inr(s.net_amount)} paid to seller?`)} style={btn("#2ECC71")}>
                          {busy === s.id ? "…" : "Mark paid"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* v390 — per-owner payout batches (group owed guest-booking rows per owner) */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, marginBottom: 10, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><Banknote size={16} strokeWidth={2} aria-hidden />Payout batches <span style={{ color: "#8A8FA8", fontSize: 12, fontWeight: 500 }}>· owed grouped per owner</span> <span style={{ fontSize: 11, fontWeight: 700, color: rxConfigured ? "#2ECC71" : "#8A8FA8" }}>{rxConfigured ? "· RazorpayX live" : "· RazorpayX not configured (manual only)"}</span></div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {payoutBatches.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No owners with outstanding payouts."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Owner", "Bookings", "Total owed", "Payout account", "Action"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {payoutBatches.map((b) => (
                    <tr key={b.payeeId}>
                      <td style={td}>{String(b.payeeId).slice(-8)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{b.rowCount}</td>
                      <td style={{ ...td, color: "#a9b9c8", fontWeight: 700 }}>{inr(b.totalOwed)}</td>
                      <td style={td}>
                        {b.hasAccount
                          ? <span style={{ color: b.accountStatus === "verified" ? "#2ECC71" : "#a9b9c8", fontSize: 12 }}>{b.accountMethod === "upi" ? "UPI" : "Bank"} · {b.accountStatus}</span>
                          : <span style={{ color: "#E0684E", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><TriangleAlert size={12} strokeWidth={2.2} aria-hidden />not added</span>}
                      </td>
                      <td style={{ ...td, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {rxConfigured && b.hasAccount && (
                          <button disabled={busy === b.payeeId} onClick={() => act({ action: "payout_owner_batch", payeeUserId: b.payeeId }, b.payeeId, `Send ${inr(b.totalOwed)} to this owner via RazorpayX now? This moves real money.`)} style={btn("#a9b9c8")}>
                            {busy === b.payeeId ? "…" : "Pay via RazorpayX"}
                          </button>
                        )}
                        <button disabled={busy === b.payeeId} onClick={() => act({ action: "mark_owner_batch_paid", payeeUserId: b.payeeId }, b.payeeId, `Mark all ${inr(b.totalOwed)} (${b.rowCount} rows) paid to this owner (manual — no transfer)?`)} style={btn(rxConfigured ? "#2ECC71" : "#8A8FA8")}>
                          {busy === b.payeeId ? "…" : "Mark paid (manual)"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* S2 — guest-booking owner settlements owed to Circle owners */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, marginBottom: 10, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><Home size={16} strokeWidth={2} aria-hidden />Guest-booking payouts owed to owners <span style={{ color: "#8A8FA8", fontSize: 12, fontWeight: 500 }}>· {inr(k.gbOwed || 0)} owed · fee {inr(k.gbFees || 0)}</span></div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {gbOwedList.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No outstanding guest-booking payouts. (Recorded by the settlement reconciler as bookings confirm.)"}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Owner", "Booking", "Nights", "Guest paid (share)", "Fee", "Owner net", "When", "Action"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {gbOwedList.map((s) => (
                    <tr key={s.id}>
                      <td style={td}>{String(s.payee_user_id).slice(-8)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{String(s.metadata?.bookingId || "—").slice(-8)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{s.metadata?.nights ?? "—"}{s.metadata?.totalNights ? ` / ${s.metadata.totalNights}` : ""}</td>
                      <td style={td}>{inr(s.gross_amount)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{inr(s.platform_fee)}</td>
                      <td style={{ ...td, color: "#a9b9c8", fontWeight: 700 }}>{inr(s.net_amount)}</td>
                      <td style={{ ...td, color: "#8A8FA8" }}>{ago(s.created_at)} ago</td>
                      <td style={td}>
                        <button disabled={busy === s.id} onClick={() => act({ action: "mark_guest_booking_paid", settlementId: s.id }, s.id, `Mark ${inr(s.net_amount)} paid to this owner?`)} style={btn("#2ECC71")}>
                          {busy === s.id ? "…" : "Mark paid"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* v334 — D4: Model 4 B2B exchange listings oversight */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><ArrowLeftRight size={16} strokeWidth={2} aria-hidden />Exchange listings <span style={{ color: "#8A8FA8", fontSize: 12, fontWeight: 500 }}>· Model 2 · seller-to-seller</span></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            {B2B_FILTERS.map((f) => (
              <button key={f} onClick={() => setB2bFilter(f)}
                style={{ background: b2bFilter === f ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.04)", border: `1px solid ${b2bFilter === f ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.1)"}`, color: b2bFilter === f ? "#D8B4FE" : "#8A8FA8", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
                {f}{f !== "all" && k.b2bListingsByStatus?.[f] != null ? ` ${k.b2bListingsByStatus[f]}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {shownListings.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No exchange listings."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Hotel · Unit", "Seller", "Dates", "Status", "Own/n", "Resale ×", "Ask", "Cost", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shownListings.map((l) => {
                    const md = Number(l?.metadata?.markdownPct) || 0;
                    const c = STATUS_COLOR[l.status] || "#8A8FA8";
                    const editable = ["draft", "listed"].includes(l.status);
                    const nights = Math.max(1, Number(l.nights) || 1);
                    const own = Number(l.own_per_night) || Math.round(Number(l.buy_total) / nights);
                    const curMult = Number(l.price_multiplier) || (own ? Number(l.ask_per_night) / own : 0);
                    const draft = multDraft[l.id] ?? (curMult ? String(curMult) : "2");
                    return (
                      <tr key={l.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{l.hotel_name || l.hotel_id}</div>
                          <div style={{ color: "#8A8FA8", fontSize: 11 }}>#{l.unit_number || l.unit_id} · {l.nights}n</div>
                        </td>
                        <td style={td}>{l.seller_name || <span style={{ color: "#8A8FA8" }}>{String(l.seller_user_id).slice(-6)}</span>}</td>
                        <td style={{ ...td, color: "#8A8FA8" }}>{l.date_from} → {l.date_to}</td>
                        <td style={td}>
                          <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${c}22`, color: c, border: `1px solid ${c}44`, textTransform: "capitalize" }}>{String(l.status).replace(/_/g, " ")}</span>
                        </td>
                        <td style={{ ...td, color: "#8A8FA8" }}>{own ? inr(own) : "—"}</td>
                        <td style={td}>
                          {editable && own ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <input type="number" min={1} max={20} step={0.1} value={draft}
                                onChange={(e) => setMultDraft((s) => ({ ...s, [l.id]: e.target.value }))}
                                style={{ width: 52, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#E8EAF0", borderRadius: 7, padding: "4px 6px", fontFamily: "inherit", fontSize: 12 }} />
                              <button
                                disabled={busy === l.id || Number(draft) === curMult || !(Number(draft) >= 1 && Number(draft) <= 20)}
                                title="Re-price this one listing at its own multiplier (own price/night × ×)."
                                onClick={() => act({ action: "set_listing_multiplier", listingId: l.id, multiplier: Number(draft) }, l.id)}
                                style={{ ...btn("#3D9CF5"), opacity: Number(draft) === curMult ? 0.45 : 1 }}>
                                {busy === l.id ? "…" : "Apply"}
                              </button>
                            </div>
                          ) : <span style={{ color: "#8A8FA8" }}>{curMult ? `${(Math.round(curMult * 100) / 100)}×` : "—"}</span>}
                        </td>
                        <td style={td}>
                          {inr(l.ask_total)}
                          {md > 0 && <span style={{ color: "#FF4757", fontSize: 11, marginLeft: 4, fontWeight: 700 }}>−{md}%</span>}
                        </td>
                        <td style={{ ...td, color: "#8A8FA8" }}>{inr(l.buy_total)}</td>
                        <td style={td}>
                          {editable ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button disabled={busy === l.id} onClick={() => act({ action: "expire_listing", listingId: l.id }, l.id, "Retire this listing (mark expired)? The seller keeps their pre-bought block.")} style={btn("#8A8FA8")}>{busy === l.id ? "…" : "Expire"}</button>
                              <button disabled={busy === l.id} onClick={() => act({ action: "cancel_listing", listingId: l.id }, l.id, "Cancel this listing? The seller keeps their pre-bought block.")} style={btn("#FF4757")}>{busy === l.id ? "…" : "Cancel"}</button>
                            </div>
                          ) : <span style={{ color: "#8A8FA8" }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Blocks */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 700, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 7 }}><Package size={16} strokeWidth={2} aria-hidden />Inventory blocks</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ background: filter === f ? "rgba(140, 160, 182,0.16)" : "rgba(255,255,255,0.04)", border: `1px solid ${filter === f ? "rgba(140, 160, 182,0.4)" : "rgba(255,255,255,0.1)"}`, color: filter === f ? "#9fb1c2" : "#8A8FA8", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
                {f}{f !== "all" && k.byStatus?.[f] != null ? ` ${k.byStatus[f]}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
          {blocks.length === 0 ? (
            <div style={{ color: "#8A8FA8", padding: 22, textAlign: "center", fontSize: 13 }}>{loading ? "Loading…" : "No blocks."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead><tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Hotel · Unit", "Investor", "Dates", "Status", "Buy", "Resale", "Buyback", "Actions"].map((h) => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {blocks.map((b) => {
                    const md = Number(b?.metadata?.markdownPct) || 0;
                    const bbStatus = b?.metadata?.buybackPayoutStatus;
                    const c = STATUS_COLOR[b.status] || "#8A8FA8";
                    return (
                      <tr key={b.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{b.hotel_name || b.hotel_id}</div>
                          <div style={{ color: "#8A8FA8", fontSize: 11 }}>#{b.unit_number || b.unit_id} · {b.nights}n</div>
                        </td>
                        <td style={td}>{b.investor_name || <span style={{ color: "#8A8FA8" }}>{String(b.investor_user_id).slice(-6)}</span>}</td>
                        <td style={{ ...td, color: "#8A8FA8" }}>{b.date_from} → {b.date_to}</td>
                        <td style={td}>
                          <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${c}22`, color: c, border: `1px solid ${c}44`, textTransform: "capitalize" }}>{String(b.status).replace(/_/g, " ")}</span>
                        </td>
                        <td style={{ ...td, color: "#8A8FA8" }}>{inr(b.buy_total)}</td>
                        <td style={td}>
                          {b.resale_price_per_night ? (
                            <>{inr(b.resale_price_per_night)}/n{md > 0 && <span style={{ color: "#FF4757", fontSize: 11, marginLeft: 4, fontWeight: 700 }}>−{md}%</span>}</>
                          ) : <span style={{ color: "#8A8FA8" }}>—</span>}
                        </td>
                        <td style={td}>
                          {b.buyback_enabled
                            ? <span style={{ color: bbStatus === "owed" ? "#a9b9c8" : bbStatus === "paid" ? "#2ECC71" : "#D8B4FE", fontSize: 11.5, fontWeight: 700 }}>{bbStatus === "owed" ? "owed" : bbStatus === "paid" ? "paid" : <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Shield size={11} strokeWidth={2.2} aria-hidden />on</span>}</span>
                            : <span style={{ color: "#8A8FA8" }}>—</span>}
                        </td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {["owned", "listed"].includes(b.status) && (
                              <button disabled={busy === b.id} onClick={() => act({ action: "force_expire", blockId: b.id }, b.id, "Force-expire this block + release its hold?")} style={btn("#8A8FA8")}>{busy === b.id ? "…" : "Expire"}</button>
                            )}
                            {b.buyback_enabled && bbStatus !== "owed" && bbStatus !== "paid" && ["owned", "listed", "expired"].includes(b.status) && (
                              <button disabled={busy === b.id} onClick={() => act({ action: "buyback", blockId: b.id }, b.id, `Buy back ${inr(b.buy_total)} of unsold nights? StayBid takes the loss.`)} style={btn("#D8B4FE")}>{busy === b.id ? "…" : "Buyback"}</button>
                            )}
                            {b.status === "refunded" && bbStatus === "owed" && (
                              <button disabled={busy === b.id} onClick={() => act({ action: "mark_buyback_paid", blockId: b.id }, b.id, `Mark ${inr(b?.metadata?.buyback?.amount)} buyback paid to investor?`)} style={btn("#2ECC71")}>{busy === b.id ? "…" : "Mark paid"}</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
