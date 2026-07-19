"use client";

// v357 — Circle Model 2 · Step 4 REVIEW & BUY. A full page (not a popup),
// mirroring Model 1's /circle/build: a clear "YOUR BUNDLE" recap grouped by
// city + a "COST & VALUE" panel (what you pay, total market value, your resale
// upside) + one payment. Reads the bundle from localStorage (written by the
// property tour). Tamper-safe: the server re-prices every picked room-night.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import { basketList, removeItem, clearBasket, onBasketChange, type M2Item } from "@/lib/circle/model2-basket";

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const norm = (c: any) => String(c || "").trim().toLowerCase();
const cap = (s: string) => String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());
const inr = (n: number) => fmtINR(Math.round(n || 0));

export default function Model2ReviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [items, setItems] = useState<M2Item[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [accessPrice, setAccessPrice] = useState(999);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ settled: number } | null>(null);

  useEffect(() => {
    const refresh = () => setItems(basketList());
    refresh(); return onBasketChange(refresh);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/review" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); if (d?.price) setAccessPrice(Number(d.price) || 999); }).catch(() => {});
  }, [user, authLoading, router]);

  const byCity = useMemo(() => {
    const m: Record<string, M2Item[]> = {};
    items.forEach((it) => { (m[norm(it.city)] ||= []).push(it); });
    return m;
  }, [items]);

  const isUnlocked = (c: string) => unlocked.includes(norm(c));
  const invTotal = items.reduce((s, x) => s + (x.buyerPays || 0), 0);
  const marketTotal = items.reduce((s, x) => s + (x.marketAdr || 0) * (x.nights || 0), 0);
  const upside = Math.max(0, marketTotal - invTotal);
  const cities = Object.keys(byCity);
  const newCities = cities.filter((c) => !isUnlocked(c));
  const cityFees = newCities.length * accessPrice;
  const grandTotal = invTotal + cityFees;

  const pay = useCallback(async () => {
    if (!items.length) { setMsg("Your bundle is empty."); return; }
    setBusy(true); setMsg("");
    try {
      const cr = await fetch("/api/b2b/basket/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ items: items.map((b) => ({ listingId: b.listingId, from: b.from, to: b.to })) }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { setMsg(cd?.error || "Couldn't start payment"); return; }
      let p: any;
      try {
        p = await openRazorpayForOrder({ keyId: cd.keyId, orderId: cd.order.id, amountPaise: cd.order.amount, description: `Model 2 bundle · ${items.length} room-night set${items.length === 1 ? "" : "s"}` });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setMsg("Payment cancelled"); return; }
        setMsg(e instanceof Error ? e.message : "Payment failed"); return;
      }
      const vr = await fetch("/api/b2b/basket/verify", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ razorpay_order_id: cd.order.id, razorpay_payment_id: p?.razorpay_payment_id, razorpay_signature: p?.razorpay_signature }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { setMsg(vd?.error || "Verify failed — contact support"); return; }
      clearBasket();
      setDone({ settled: vd.settled || items.length });
    } catch { setMsg("Something went wrong"); }
    finally { setBusy(false); }
  }, [items]);

  if (done) {
    return (
      <div className="sbc-home"><div className="sbc-ms-wrap sbc2r">
        <div className="sbc2r-done">
          <div className="sbc2r-done-badge">✓</div>
          <h1 className="sbc2r-done-h">Bundle bought</h1>
          <p className="sbc2r-done-p">{done.settled} room-night set{done.settled === 1 ? "" : "s"} are now in your selling inventory. Manage &amp; resell them from your dashboard.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/circle/me" className="sbc-btn-gold">My selling inventory →</Link>
            <Link href="/circle/model2/browse" className="sbc-btn-ghost">Buy more</Link>
          </div>
        </div>
      </div></div>
    );
  }

  return (
    <div className="sbc-home"><div className="sbc-ms-wrap sbc2r">
      <Link href="/circle/model2/browse" className="sbc2p-back" style={{ display: "inline-block", marginBottom: 12, fontWeight: 700, color: "var(--sbc-gold-deep)" }}>← Back to browse</Link>
      <div className="sbc2r-headrow">
        <span className="sbc2r-steppill">STEP 4 · Review &amp; Buy</span>
        <h1 className="sbc2r-title">Confirm &amp; Buy</h1>
      </div>
      <p className="sbc2r-sub">{items.length} room-night set{items.length === 1 ? "" : "s"} across {cities.length || 0} cit{cities.length === 1 ? "y" : "ies"} — review karo aur ek payment me buy karo.</p>

      {items.length === 0 ? (
        <div className="sbc-panel" style={{ padding: 26, textAlign: "center", color: "rgba(74,56,32,.6)" }}>
          Your bundle is empty. <Link href="/circle/model2/browse" style={{ color: "var(--sbc-gold-deep)", fontWeight: 700 }}>Browse inventory →</Link>
        </div>
      ) : (<>
        <div className="sbc2r-sech"><span>YOUR BUNDLE</span><Link href="/circle/model2/browse" className="sbc2r-edit">✏️ Add more</Link></div>

        {Object.entries(byCity).map(([c, its]) => (
          <div key={c} className="sbc2r-city">
            <div className="sbc2r-cityhead">📍 {cap(c)}{newCities.includes(c) ? <span className="sbc2r-newcity">+ ₹{accessPrice} city access</span> : <span className="sbc2r-unlocked">✓ unlocked</span>}</div>
            {its.map((it) => (
              <div key={it.key} className="sbc2r-item">
                {it.image ? <img src={it.image} alt={it.room} /> : <div className="sbc2r-noimg">🛏</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sbc2r-itile">{it.title}</div>
                  <div className="sbc2r-isub">{it.room} · {it.from} → {it.to} · {it.nights}n</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <b style={{ color: "var(--sbc-coffee)" }}>{inr(it.buyerPays)}</b>
                  <button className="sbc2r-rm" onClick={() => removeItem(it.key)}>remove</button>
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* COST & VALUE panel */}
        <div className="sbc2r-panel">
          <div className="sbc2r-panel-h">COST &amp; VALUE</div>
          <div className="sbc2r-prow"><span>Inventory ({items.length} set{items.length === 1 ? "" : "s"})</span><b>{inr(invTotal)}</b></div>
          {cityFees > 0 && <div className="sbc2r-prow"><span>City access ({newCities.map(cap).join(", ")})</span><b>{inr(cityFees)}</b></div>}
          <div className="sbc2r-prow total"><span>You pay</span><b>{inr(grandTotal)}</b></div>
          {marketTotal > 0 && (
            <div className="sbc2r-value">
              <div className="sbc2r-vrow"><span>Total market value (ADR)</span><b>{inr(marketTotal)}</b></div>
              {upside > 0 && <div className="sbc2r-vrow up"><span>📈 Your resale upside</span><b>{inr(upside)}</b></div>}
            </div>
          )}
        </div>

        {msg && <div style={{ fontSize: ".84rem", margin: "10px 0", color: "#c0392b", fontWeight: 600 }}>{msg}</div>}
        <button disabled={busy} className="sbc-btn-gold" style={{ width: "100%", padding: 14, fontSize: "1rem" }} onClick={pay}>{busy ? "Processing…" : `Pay ${inr(grandTotal)}`}</button>
        <p className="sbc2r-note">{CIRCLE_B2B_RESALE_NOTE}</p>
      </>)}

      <style jsx global>{`
        .sbc2r { padding-bottom: 90px; }
        .sbc2r-headrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .sbc2r-steppill { font-size: .68rem; font-weight: 800; letter-spacing: .04em; color: #fff; background: var(--sbc-coffee, #3a2c17); border-radius: 999px; padding: 6px 12px; }
        .sbc2r-title { font-size: 1.7rem; font-weight: 800; color: var(--sbc-coffee); margin: 0; font-family: var(--font-syne, inherit); }
        .sbc2r-sub { font-size: .86rem; color: rgba(74,56,32,.68); margin: 8px 0 16px; line-height: 1.5; }
        .sbc2r-sech { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 8px; }
        .sbc2r-sech span { font-size: .68rem; font-weight: 800; letter-spacing: .08em; color: rgba(74,56,32,.5); }
        .sbc2r-edit { font-size: .78rem; font-weight: 700; color: var(--sbc-gold-deep); }
        .sbc2r-city { background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 15px; padding: 12px 14px; margin-bottom: 12px; }
        .sbc2r-cityhead { font-size: .84rem; font-weight: 800; color: var(--sbc-coffee); display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .sbc2r-newcity { font-size: .62rem; font-weight: 700; color: #8a6914; background: rgba(139,105,20,.1); border-radius: 999px; padding: 2px 8px; }
        .sbc2r-unlocked { font-size: .62rem; font-weight: 700; color: #6b8f4e; }
        .sbc2r-item { display: flex; align-items: center; gap: 11px; padding: 9px 0; border-top: 1px solid rgba(139,105,20,.1); }
        .sbc2r-item img { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; flex: none; }
        .sbc2r-noimg { width: 50px; height: 50px; border-radius: 10px; display: grid; place-items: center; background: #efe6d4; font-size: 1.2rem; flex: none; }
        .sbc2r-itile { font-weight: 700; color: var(--sbc-coffee); font-size: .84rem; }
        .sbc2r-isub { font-size: .68rem; color: rgba(74,56,32,.6); }
        .sbc2r-rm { display: block; font-size: .6rem; color: #c96f4a; background: none; border: 0; cursor: pointer; margin-top: 2px; margin-left: auto; }
        .sbc2r-panel { background: linear-gradient(135deg, #fffaf0, #f7eeda); border: 1px solid rgba(139,105,20,.2); border-radius: 16px; padding: 15px 16px; margin: 6px 0 14px; }
        .sbc2r-panel-h { font-size: .68rem; font-weight: 800; letter-spacing: .08em; color: rgba(74,56,32,.5); margin-bottom: 8px; }
        .sbc2r-prow { display: flex; justify-content: space-between; align-items: center; font-size: .84rem; color: rgba(74,56,32,.72); padding: 4px 0; }
        .sbc2r-prow b { color: var(--sbc-coffee); }
        .sbc2r-prow.total { border-top: 1px dashed rgba(139,105,20,.3); margin-top: 4px; padding-top: 10px; font-size: 1rem; }
        .sbc2r-prow.total b { font-size: 1.2rem; font-weight: 800; }
        .sbc2r-value { border-top: 1px solid rgba(139,105,20,.15); margin-top: 8px; padding-top: 8px; }
        .sbc2r-vrow { display: flex; justify-content: space-between; font-size: .78rem; color: rgba(74,56,32,.62); padding: 2px 0; }
        .sbc2r-vrow b { color: var(--sbc-coffee); }
        .sbc2r-vrow.up { color: #4e7a2e; } .sbc2r-vrow.up b { color: #4e7a2e; font-weight: 800; }
        .sbc2r-note { font-size: .66rem; color: rgba(74,56,32,.5); margin-top: 12px; line-height: 1.5; }
        .sbc2r-done { text-align: center; padding: 40px 10px; }
        .sbc2r-done-badge { width: 66px; height: 66px; border-radius: 50%; background: #6b8f4e; color: #fff; font-size: 2rem; display: grid; place-items: center; margin: 0 auto 16px; }
        .sbc2r-done-h { font-size: 1.6rem; font-weight: 800; color: var(--sbc-coffee); margin: 0 0 8px; }
        .sbc2r-done-p { font-size: .86rem; color: rgba(74,56,32,.7); margin: 0 auto 20px; max-width: 420px; line-height: 1.55; }
      `}</style>
    </div></div>
  );
}
