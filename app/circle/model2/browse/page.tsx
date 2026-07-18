"use client";

// v352 — Circle Model 2: browse released inventory + multi-select basket +
// multi-city bundle. NO pre-activation gate — the FULL inventory is browsable
// from the start. City-access fees are added AT CHECKOUT for whichever cities
// the basket touches that the buyer hasn't unlocked yet (one-time, lifetime).
// So: build your bundle first → pay inventory + per-new-city access together.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type Listing = {
  id: string; hotel_id: string; hotel_name: string | null; hotel_city: string;
  unit_number: string | null; unit_id: string | null; room_id: string; source?: string | null;
  date_from: string; date_to: string; nights: number; ask_per_night: number; ask_total: number;
  split?: { buyerPays?: number; askTotal: number; buyerFeePct?: number };
};

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const norm = (c: any) => String(c || "").trim().toLowerCase();

export default function Model2BrowsePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [unlocked, setUnlocked] = useState<string[]>([]);     // cities already unlocked
  const [accessPrice, setAccessPrice] = useState<number>(999);
  const [allListings, setAllListings] = useState<Listing[]>([]); // ALL live supply
  const [city, setCity] = useState<string>("");
  const [basket, setBasket] = useState<Record<string, Listing>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const loadListings = useCallback(() => {
    setLoading(true);
    // No city param → the marketplace returns ALL live listings; we derive the
    // city chips + filter client-side (the full inventory is browsable upfront).
    fetch(`/api/b2b/marketplace`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rows: Listing[] = Array.isArray(d?.listings) ? d.listings : [];
        setAllListings(rows);
        setCity((c) => c || norm(rows[0]?.hotel_city) || "");
      })
      .catch(() => setAllListings([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/browse" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); if (d?.price) setAccessPrice(Number(d.price) || 999); })
      .catch(() => {});
    loadListings();
  }, [user, authLoading, router, loadListings]);

  // listings shown for the selected city (client-side filter of the full supply).
  const listings = useMemo(() => allListings.filter((l) => norm(l.hotel_city) === norm(city)), [allListings, city]);

  const isUnlocked = (c: string) => unlocked.includes(norm(c));
  const inBasket = (id: string) => !!basket[id];
  const toggle = (l: Listing) => setBasket((b) => { const n = { ...b }; if (n[l.id]) delete n[l.id]; else n[l.id] = l; return n; });

  const basketList = useMemo(() => Object.values(basket), [basket]);
  const invTotal = useMemo(() => basketList.reduce((s, l) => s + Number(l.split?.buyerPays ?? l.ask_total ?? 0), 0), [basketList]);
  const basketCities = useMemo(() => Array.from(new Set(basketList.map((l) => norm(l.hotel_city)).filter(Boolean))), [basketList]);
  const newCities = useMemo(() => basketCities.filter((c) => !isUnlocked(c)), [basketCities, unlocked]);
  const accessFees = newCities.length * accessPrice;
  const grandTotal = invTotal + accessFees;

  async function buyBasket() {
    if (!basketList.length) { setMsg("Add some listings first."); return; }
    setBusy(true); setMsg("");
    try {
      const cr = await fetch("/api/b2b/basket/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ listingIds: basketList.map((l) => l.id) }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (!cr.ok || !cd?.order?.id) { setMsg(cd?.error || "Couldn't start payment"); loadListings(); return; }

      let pay: any;
      try {
        pay = await openRazorpayForOrder({ keyId: cd.keyId, orderId: cd.order.id, amountPaise: cd.order.amount, description: `Model 2 basket · ${basketList.length} listing${basketList.length === 1 ? "" : "s"}` });
      } catch (e) {
        if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setMsg("Payment cancelled"); return; }
        setMsg(e instanceof Error ? e.message : "Payment failed"); return;
      }

      const vr = await fetch("/api/b2b/basket/verify", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ razorpay_order_id: cd.order.id, razorpay_payment_id: pay?.razorpay_payment_id, razorpay_signature: pay?.razorpay_signature }),
      });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd?.ok) { setMsg(vd?.error || "Verify failed — contact support"); return; }
      setMsg(`Basket bought ✓ — ${vd.settled} block${vd.settled === 1 ? "" : "s"} now in your selling inventory.`);
      setBasket({});
      // refresh unlocked cities (new ones just activated) + listings.
      fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json()).then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); }).catch(() => {});
      loadListings();
    } catch { setMsg("Something went wrong"); }
    finally { setBusy(false); }
  }

  const supplyCities = useMemo(() => Array.from(new Set(allListings.map((l) => norm(l.hotel_city)).filter(Boolean))), [allListings]);
  const allCityChips = Array.from(new Set([...supplyCities, ...unlocked]));
  const coffee = "var(--sbc-coffee)";

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap">
        <Link href="/circle" className="sbc-ms-back" style={{ color: "var(--sbc-gold-deep)" }}>← StayCircle</Link>
        <div className="sbc-ms-eyebrow"><span className="sbc-ms-model">Model 2</span><span className="sbc-ms-tag" style={{ color: coffee }}>Inventory Bundle · Browse</span></div>
        <h1 className="sbc-ms-title" style={{ color: coffee }}>Buy released inventory</h1>
        <p className="sbc-ms-sub" style={{ color: "rgba(74,56,32,.72)" }}>
          Browse the full inventory, add owner-released room-nights to your basket across cities, and buy them together at StayBid-regulated prices (listed at ~2× the owner's buy cost — margin for the seller, a clear price for you). A one-time ₹{accessPrice} city-access fee is added at checkout only for the cities your basket touches (lifetime — you keep them).
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "6px 0 4px" }}>
          <Link href="/circle/model2" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>Pre-buy StayBid-operated rooms →</Link>
          <Link href="/circle/me" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>My Circle · City Access →</Link>
        </div>

        {/* city chips — the FULL supply is browsable; a 🔓 marks already-unlocked. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
          {allCityChips.map((c) => {
            const active = c === city;
            return (
              <button key={c} onClick={() => setCity(c)}
                style={{ textTransform: "capitalize", fontSize: ".82rem", fontWeight: 700, padding: "7px 14px", borderRadius: 999, cursor: "pointer",
                  border: active ? "1px solid var(--sbc-gold-deep)" : "1px solid rgba(139,105,20,.25)",
                  background: active ? "var(--sbc-gold-deep)" : "#fff", color: active ? "#fff" : "var(--sbc-ink)" }}>
                {c}{isUnlocked(c) ? " 🔓" : ""}
              </button>
            );
          })}
          {allCityChips.length === 0 && <span style={{ fontSize: ".85rem", color: "rgba(74,56,32,.6)" }}>No cities with live supply yet — released inventory will appear here.</span>}
        </div>

        {/* listings */}
        {loading ? (
          <div className="sbc-panel" style={{ padding: 24, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading…</div>
        ) : listings.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.6)", fontSize: ".9rem" }}>No live listings in this city yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {listings.map((l) => {
              const picked = inBasket(l.id);
              return (
                <div key={l.id} className="sbc-panel" style={{ padding: 14, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center", outline: picked ? "2px solid var(--sbc-gold-deep)" : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: coffee }}>{l.hotel_name || "Property"}</div>
                    <div style={{ fontSize: ".74rem", color: "rgba(74,56,32,.6)" }}>📍 <span style={{ textTransform: "capitalize" }}>{l.hotel_city || "—"}</span> · {l.date_from} → {l.date_to} · {l.nights}n{l.unit_number ? ` · #${l.unit_number}` : ""}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <b style={{ color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(l.split?.buyerPays ?? l.ask_total)}</b>
                      <div style={{ fontSize: ".64rem", color: "rgba(74,56,32,.5)" }}>you pay</div>
                    </div>
                    <button onClick={() => toggle(l)} className={picked ? "sbc-btn-ghost" : "sbc-btn-gold"} style={{ whiteSpace: "nowrap" }}>
                      {picked ? "Remove" : "Add"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* basket bar with fee breakdown */}
        {basketList.length > 0 && (
          <div className="sbc-panel" style={{ position: "sticky", bottom: 12, marginTop: 16, padding: 14, boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, fontSize: ".8rem", color: "rgba(74,56,32,.7)" }}>
              <span>{basketList.length} in basket{basketCities.length > 1 ? ` · ${basketCities.length} cities` : ""}</span>
              <span>Inventory {fmtINR(invTotal)}</span>
            </div>
            {newCities.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, fontSize: ".8rem", color: "rgba(74,56,32,.7)", marginTop: 4 }}>
                <span style={{ textTransform: "capitalize" }}>City access ({newCities.join(", ")})</span>
                <span>+{fmtINR(accessFees)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(139,105,20,.15)" }}>
              <b style={{ color: coffee }}>Total {fmtINR(grandTotal)}</b>
              <button disabled={busy} onClick={buyBasket} className="sbc-btn-gold">
                {busy ? "Processing…" : `Buy basket · ${fmtINR(grandTotal)}`}
              </button>
            </div>
          </div>
        )}

        {msg && <div style={{ fontSize: ".82rem", marginTop: 10, color: "var(--sbc-gold-deep)" }}>{msg}</div>}
        <p className="sbc-ms-note" style={{ marginTop: 14, color: "rgba(74,56,32,.55)" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>
    </div>
  );
}
