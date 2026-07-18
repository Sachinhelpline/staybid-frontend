"use client";

// v350 — Circle Model 2: browse released inventory by city + multi-select
// basket + multi-city bundle checkout. The buyer picks unlocked cities, adds
// released listings to a basket (across cities), and buys them all in ONE
// payment (/api/b2b/basket/checkout → /verify). Cities must be unlocked first
// (/circle/me · City Access) — a locked city surfaces an unlock prompt.

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

export default function Model2BrowsePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [cities, setCities] = useState<string[]>([]);          // unlocked cities
  const [supplyCities, setSupplyCities] = useState<string[]>([]); // cities with live supply
  const [city, setCity] = useState<string>("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [basket, setBasket] = useState<Record<string, Listing>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/browse" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.cities)) { setCities(d.cities); if (!city && d.cities[0]) setCity(d.cities[0]); } })
      .catch(() => {});
    fetch("/api/circle/marketplace-summary")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.model4?.cities)) setSupplyCities(d.model4.cities.map((c: string) => String(c).toLowerCase())); })
      .catch(() => {});
  }, [user, authLoading, router, city]);

  const loadListings = useCallback((c: string) => {
    if (!c) { setListings([]); return; }
    setLoading(true);
    fetch(`/api/b2b/marketplace?city=${encodeURIComponent(c)}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setListings(Array.isArray(d?.listings) ? d.listings : []))
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (city) loadListings(city); }, [city, loadListings]);

  const cityUnlocked = (c: string) => cities.map((x) => x.toLowerCase()).includes(String(c).toLowerCase());
  const inBasket = (id: string) => !!basket[id];
  const toggle = (l: Listing) => setBasket((b) => { const n = { ...b }; if (n[l.id]) delete n[l.id]; else n[l.id] = l; return n; });

  const basketList = useMemo(() => Object.values(basket), [basket]);
  const basketTotal = useMemo(() => basketList.reduce((s, l) => s + Number(l.split?.buyerPays ?? l.ask_total ?? 0), 0), [basketList]);
  const basketCities = useMemo(() => Array.from(new Set(basketList.map((l) => String(l.hotel_city || "").toLowerCase()).filter(Boolean))), [basketList]);
  const lockedInBasket = basketCities.filter((c) => !cityUnlocked(c));

  async function buyBasket() {
    if (!basketList.length) { setMsg("Add some listings first."); return; }
    if (lockedInBasket.length) { setMsg(`Unlock ${lockedInBasket.join(", ")} first (City Access on My Circle).`); return; }
    setBusy(true); setMsg("");
    try {
      const cr = await fetch("/api/b2b/basket/checkout", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ listingIds: basketList.map((l) => l.id) }),
      });
      const cd = await cr.json().catch(() => ({}));
      if (cr.status === 403 && cd?.needCityAccess) { setMsg(`Unlock ${cd.city} first — go to My Circle · City Access.`); return; }
      if (!cr.ok || !cd?.order?.id) { setMsg(cd?.error || "Couldn't start payment"); loadListings(city); return; }

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
      setBasket({}); loadListings(city);
    } catch { setMsg("Something went wrong"); }
    finally { setBusy(false); }
  }

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap">
        <Link href="/circle" className="sbc-ms-back">← StayCircle</Link>
        <div className="sbc-ms-eyebrow"><span className="sbc-ms-model">Model 2</span><span className="sbc-ms-tag">Inventory Bundle · Browse</span></div>
        <h1 className="sbc-ms-title">Buy released inventory</h1>
        <p className="sbc-ms-sub">Pick a city, add owner-released room-nights to your basket, and buy them together at StayBid-regulated prices — then resell through your own inventory.</p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "2px 0 4px" }}>
          <Link href="/circle/model2" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>Pre-buy StayBid-operated rooms →</Link>
          <Link href="/circle/me" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)" }}>My Circle · City Access →</Link>
        </div>

        {/* city chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
          {Array.from(new Set([...cities.map((c) => c.toLowerCase()), ...supplyCities])).map((c) => {
            const unlocked = cityUnlocked(c);
            const active = c === city;
            return (
              <button key={c} onClick={() => setCity(c)}
                style={{ textTransform: "capitalize", fontSize: ".82rem", fontWeight: 700, padding: "7px 14px", borderRadius: 999, cursor: "pointer",
                  border: active ? "1px solid var(--sbc-gold-deep)" : "1px solid rgba(139,105,20,.25)",
                  background: active ? "var(--sbc-gold-deep)" : "#fff", color: active ? "#fff" : "var(--sbc-ink)" }}>
                {c}{unlocked ? "" : " 🔒"}
              </button>
            );
          })}
          {cities.length === 0 && supplyCities.length === 0 && <span style={{ fontSize: ".85rem", opacity: .6 }}>No cities with live supply yet.</span>}
        </div>

        {city && !cityUnlocked(city) && (
          <div className="sbc-panel" style={{ padding: 14, marginBottom: 12, fontSize: ".85rem" }}>
            🔒 <b style={{ textTransform: "capitalize" }}>{city}</b> is locked. Unlock it once from{" "}
            <Link href="/circle/me" style={{ color: "var(--sbc-gold-deep)", fontWeight: 700 }}>My Circle · City Access</Link> to buy here.
          </div>
        )}

        {/* listings */}
        {loading ? (
          <div className="sbc-panel" style={{ padding: 24, textAlign: "center", opacity: .7 }}>Loading…</div>
        ) : listings.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 24, opacity: .7, fontSize: ".9rem" }}>No live listings in this city yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {listings.map((l) => {
              const picked = inBasket(l.id);
              return (
                <div key={l.id} className="sbc-panel" style={{ padding: 14, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center", outline: picked ? "2px solid var(--sbc-gold-deep)" : "none" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--sbc-coffee)" }}>{l.hotel_name || "Property"}</div>
                    <div style={{ fontSize: ".74rem", color: "rgba(74,56,32,.6)" }}>📍 <span style={{ textTransform: "capitalize" }}>{l.hotel_city || "—"}</span> · {l.date_from} → {l.date_to} · {l.nights}n{l.unit_number ? ` · #${l.unit_number}` : ""}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <b style={{ color: "var(--sbc-ink)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(l.split?.buyerPays ?? l.ask_total)}</b>
                      <div style={{ fontSize: ".64rem", color: "rgba(74,56,32,.5)" }}>you pay</div>
                    </div>
                    <button disabled={!cityUnlocked(l.hotel_city)} onClick={() => toggle(l)}
                      className={picked ? "sbc-btn-ghost" : "sbc-btn-gold"} style={{ whiteSpace: "nowrap" }}>
                      {picked ? "Remove" : "Add"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* basket bar */}
        {basketList.length > 0 && (
          <div className="sbc-panel" style={{ position: "sticky", bottom: 12, marginTop: 16, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>
            <div>
              <b style={{ color: "var(--sbc-coffee)" }}>{basketList.length} in basket</b>
              <span style={{ marginLeft: 8, color: "var(--sbc-ink)", fontWeight: 700 }}>{fmtINR(basketTotal)}</span>
              {basketCities.length > 1 && <span style={{ marginLeft: 8, fontSize: ".72rem", opacity: .6 }}>· {basketCities.length} cities</span>}
            </div>
            <button disabled={busy} onClick={buyBasket} className="sbc-btn-gold">
              {busy ? "Processing…" : `Buy basket · ${fmtINR(basketTotal)}`}
            </button>
          </div>
        )}

        {msg && <div style={{ fontSize: ".82rem", marginTop: 10, color: "var(--sbc-gold-deep)" }}>{msg}</div>}
        <p className="sbc-ms-note" style={{ marginTop: 14 }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>
    </div>
  );
}
