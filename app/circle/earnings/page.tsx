"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — Earnings & payouts  (v294.19, Phase 5)
//
// Circle's OWN income screen — COMPLETELY SEPARATE from the hotel-partner
// panel and creator commission earnings. Reads /api/circle/me, which returns
// KPIs + the circle_payouts ledger for THIS investor only. The dashboard row
// "Earnings & payouts" used to jump into /circle/me (the portfolio view); it
// now lands here on a clean payouts-first screen.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fmtINR } from "@/lib/circle/engine";

type Payout = {
  id: string;
  month_label?: string | null;
  amount?: number | null;
  note?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type Kpis = {
  activeBundles?: number;
  investedMonthly?: number;
  expectedMonthlyIncome?: number;
  totalPaidOut?: number;
  lockedProperties?: number;
};

const acctInput: CSSProperties = {
  width: "100%", border: "1px solid rgba(139,105,20,.28)", borderRadius: 10,
  padding: "9px 11px", fontSize: ".85rem", background: "#fffdfa", color: "#3a2c17", fontFamily: "inherit",
};

export default function CircleEarningsPage() {
  const { user } = useAuth();

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [projected, setProjected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // v390 — payout account (where the owner gets paid).
  const [acct, setAcct] = useState<any>(null);
  const [acctForm, setAcctForm] = useState({ method: "bank", accountHolder: "", accountNumber: "", ifsc: "", upiId: "" });
  const [acctEditing, setAcctEditing] = useState(false);
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const token = localStorage.getItem("sb_token");
    if (!token) { setLoading(false); return; }
    fetch("/api/circle/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setKpis(d?.kpis || null);
        setPayouts(Array.isArray(d?.payouts) ? d.payouts : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Read-only projection from real confirmed bookings (S1 — never a money write).
    fetch("/api/circle/projected-earnings", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d && !d.error) setProjected(d); })
      .catch(() => {});
    // v390 — the owner's saved payout account.
    fetch("/api/circle/payout-account", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (d && d.account) { setAcct(d.account); setAcctForm((f) => ({ ...f, method: d.account.method || "bank", accountHolder: d.account.accountHolder || "", ifsc: d.account.ifsc || "", upiId: d.account.upiId || "" })); } })
      .catch(() => {});
  }, [user]);

  const saveAcct = async () => {
    setAcctBusy(true); setAcctMsg(null);
    try {
      const token = localStorage.getItem("sb_token") || "";
      const r = await fetch("/api/circle/payout-account", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(acctForm),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) { setAcctMsg({ ok: false, text: d?.error || "Couldn't save." }); return; }
      setAcct(d.account); setAcctEditing(false);
      setAcctForm((f) => ({ ...f, accountNumber: "" }));
      setAcctMsg({ ok: true, text: "Payout account saved ✓" });
    } catch { setAcctMsg({ ok: false, text: "Network error." }); }
    finally { setAcctBusy(false); }
  };

  const totalPaid = Number(kpis?.totalPaidOut || 0);
  const pendingTotal = payouts
    .filter((p) => (p.status || "").toLowerCase() !== "paid")
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="sbc-dash">
      <header className="sbc-dash-head">
        <Link href="/circle/dashboard" className="sbc-dash-back" aria-label="Back">←</Link>
        <span className="sbc-dash-title">Earnings &amp; payouts</span>
        <span style={{ width: 34 }} />
      </header>

      {!user ? (
        <section className="sbc-dash-profile" style={{ justifyContent: "space-between" }}>
          <div className="sbc-dash-who"><b>Sign in to see earnings</b><span>Track your monthly StayCircle income.</span></div>
          <Link href="/auth" className="sbc-dash-edit gold">Sign in</Link>
        </section>
      ) : (
        <>
          {/* total paid out — the headline */}
          <section className="sbc-earn-hero">
            <span className="sbc-earn-hero-k">Total paid out</span>
            <b className="sbc-earn-hero-v">{loading ? "…" : fmtINR(totalPaid)}</b>
            <span className="sbc-earn-hero-sub">Your lifetime StayCircle payouts, credited to your account.</span>
          </section>

          {/* KPI strip */}
          <div className="sbc-earn-kpis">
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Est. / month</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : fmtINR(Number(kpis?.expectedMonthlyIncome || 0))}</b>
            </div>
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Invested / mo</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : fmtINR(Number(kpis?.investedMonthly || 0))}</b>
            </div>
            <div className="sbc-earn-kpi">
              <span className="sbc-earn-kpi-k">Properties</span>
              <b className="sbc-earn-kpi-v">{loading ? "…" : Number(kpis?.lockedProperties || 0)}</b>
            </div>
          </div>

          {pendingTotal > 0 && (
            <div className="sbc-earn-note">
              <span style={{ fontSize: "1rem" }}>⏳</span>
              <span><b>{fmtINR(pendingTotal)}</b> pending — will be credited on the next payout cycle.</span>
            </div>
          )}

          {/* Projected from live bookings — READ-ONLY preview (S1). No money recorded. */}
          {projected && Number(projected.bookingCount) > 0 && (
            <section style={{ marginTop: 14, border: "1px solid rgba(139,105,20,.22)", borderRadius: 16, overflow: "hidden", background: "linear-gradient(160deg,#fdfdfd,#f3f5f7)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "13px 15px 0" }}>
                <div style={{ fontWeight: 800, color: "var(--sbc-coffee)", fontSize: ".95rem" }}>📈 Projected from your live bookings</div>
                <span style={{ fontSize: ".62rem", fontWeight: 800, color: "#65819c", background: "rgba(201,166,107,.16)", padding: "3px 9px", borderRadius: 999 }}>PREVIEW</span>
              </div>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "8px 15px 4px" }}>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>PROJECTED NET</div><b style={{ fontSize: "1.35rem", color: "#047857", fontVariantNumeric: "tabular-nums" }}>{fmtINR(Number(projected.projectedNetOwed) || 0)}</b></div>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>GROSS</div><b style={{ fontSize: "1.35rem", color: "var(--sbc-coffee)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(Number(projected.projectedGross) || 0)}</b></div>
                <div><div style={{ fontSize: ".6rem", fontWeight: 800, letterSpacing: ".05em", color: "rgba(74,56,32,.55)" }}>BOOKINGS · NIGHTS</div><b style={{ fontSize: "1.35rem", color: "var(--sbc-coffee)", fontVariantNumeric: "tabular-nums" }}>{Number(projected.bookingCount) || 0} · {Number(projected.nightsCount) || 0}</b></div>
              </div>
              <div style={{ display: "grid", gap: 6, padding: "6px 15px 4px" }}>
                {(projected.items || []).slice(0, 6).map((it: any) => (
                  <div key={it.bookingId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: ".78rem", color: "rgba(74,56,32,.85)" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.hotelName} · {it.checkIn} → {it.checkOut} · {it.nights}n</span>
                    <b style={{ color: "#047857", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtINR(Number(it.net) || 0)}</b>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: ".64rem", lineHeight: 1.5, color: "rgba(74,56,32,.6)", margin: 0, padding: "8px 15px 13px" }}>
                Illustrative at a {Number(projected.feePct) || 12}% platform fee — the committed fee and actual payout are set in the settlement phase. <b>Nothing has been recorded or paid yet.</b>
              </p>
            </section>
          )}

          {/* v390 — Payout account (where the owner gets paid). Foundation for money-out. */}
          <section style={{ marginTop: 14, border: "1px solid rgba(139,105,20,.22)", borderRadius: 16, background: "#fff", padding: "14px 15px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, color: "var(--sbc-coffee)", fontSize: ".95rem" }}>🏦 Payout account <span style={{ fontSize: ".7rem", fontWeight: 500, color: "rgba(74,56,32,.55)" }}>· where you get paid</span></div>
              {acct && !acctEditing && (
                <span style={{ fontSize: ".62rem", fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: acct.status === "verified" ? "#ecfdf5" : "rgba(201,166,107,.16)", color: acct.status === "verified" ? "#047857" : "#65819c" }}>{String(acct.status || "pending").toUpperCase()}</span>
              )}
            </div>

            {acct && !acctEditing ? (
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: ".82rem", color: "rgba(74,56,32,.85)" }}>
                  {acct.method === "upi"
                    ? <>UPI · <b>{acct.upiId}</b></>
                    : <>{acct.accountHolder} · <b>{acct.accountNumberMasked}</b> · {acct.ifsc}</>}
                </div>
                <button onClick={() => { setAcctEditing(true); setAcctMsg(null); }} style={{ fontSize: ".75rem", fontWeight: 700, padding: "6px 13px", borderRadius: 999, border: "1px solid rgba(139,105,20,.3)", background: "#fff", color: "var(--sbc-ink)", cursor: "pointer" }}>Edit</button>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["bank", "upi"] as const).map((m) => (
                    <button key={m} onClick={() => setAcctForm((f) => ({ ...f, method: m }))}
                      style={{ flex: 1, fontSize: ".78rem", fontWeight: 800, padding: "8px 0", borderRadius: 10, cursor: "pointer",
                        border: acctForm.method === m ? "2px solid #8198ae" : "1px solid rgba(139,105,20,.25)", background: acctForm.method === m ? "#fafbfc" : "#fff", color: "var(--sbc-coffee)" }}>
                      {m === "bank" ? "Bank account" : "UPI"}
                    </button>
                  ))}
                </div>
                {acctForm.method === "bank" ? (<>
                  <input value={acctForm.accountHolder} onChange={(e) => setAcctForm((f) => ({ ...f, accountHolder: e.target.value }))} placeholder="Account holder name" style={acctInput} />
                  <input value={acctForm.accountNumber} onChange={(e) => setAcctForm((f) => ({ ...f, accountNumber: e.target.value }))} placeholder={acct ? "New account number" : "Account number"} inputMode="numeric" style={acctInput} />
                  <input value={acctForm.ifsc} onChange={(e) => setAcctForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} placeholder="IFSC code" style={acctInput} />
                </>) : (
                  <input value={acctForm.upiId} onChange={(e) => setAcctForm((f) => ({ ...f, upiId: e.target.value }))} placeholder="yourname@bank" style={acctInput} />
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveAcct} disabled={acctBusy} style={{ flex: 1, background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", color: "#ffffff", border: 0, borderRadius: 10, padding: "10px 0", fontWeight: 800, fontSize: ".85rem", cursor: "pointer" }}>{acctBusy ? "Saving…" : "Save payout account"}</button>
                  {acct && <button onClick={() => { setAcctEditing(false); setAcctMsg(null); }} style={{ fontSize: ".8rem", fontWeight: 700, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(139,105,20,.3)", background: "#fff", color: "var(--sbc-ink)", cursor: "pointer" }}>Cancel</button>}
                </div>
              </div>
            )}
            {acctMsg && <div style={{ marginTop: 8, fontSize: ".78rem", fontWeight: 600, color: acctMsg.ok ? "#047857" : "#c0392b" }}>{acctMsg.text}</div>}
            <p style={{ fontSize: ".64rem", lineHeight: 1.5, color: "rgba(74,56,32,.55)", margin: "9px 0 0" }}>
              Your earnings are paid here once payouts run. Details are stored securely and used only to send your money.
            </p>
          </section>

          <p className="sbc-earn-note" style={{ marginTop: 12 }}>
            <span style={{ fontSize: "1rem" }}>🔒</span>
            <span>This is your <b>StayCircle investment income</b>. It is completely separate from any hotel-partner or creator earnings.</span>
          </p>

          {/* payout ledger */}
          <section className="sbc-dash-sec">
            <div className="sbc-dash-sec-h">Payout history</div>
            {loading ? (
              <div className="sbc-earn-empty"><span className="sbc-earn-empty-ic">⌛</span><b>Loading…</b></div>
            ) : payouts.length === 0 ? (
              <div className="sbc-earn-empty">
                <span className="sbc-earn-empty-ic">🌱</span>
                <b>No payouts yet</b>
                <span>Once your locked properties start earning, monthly payouts appear here.</span>
              </div>
            ) : (
              <div className="sbc-earn-list">
                {payouts.map((p) => {
                  const isPaid = (p.status || "").toLowerCase() === "paid";
                  return (
                    <div key={p.id} className="sbc-earn-row">
                      <span className="sbc-earn-row-ic">{isPaid ? "💰" : "⏳"}</span>
                      <div className="sbc-earn-row-main">
                        <b>{p.month_label || "Payout"}</b>
                        {p.note ? <span>{p.note}</span> : null}
                      </div>
                      <div className="sbc-earn-row-amt">
                        <b>{fmtINR(Number(p.amount) || 0)}</b>
                        <span className={`sbc-earn-status ${isPaid ? "paid" : "pending"}`}>{isPaid ? "Paid" : "Pending"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
