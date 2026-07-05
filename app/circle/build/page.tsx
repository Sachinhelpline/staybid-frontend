"use client";

// StayCircle™ — Review & Invest (Step 3)
// Read-only recap of the rooms picked on the Discover rooms sheet →
// a SIMPLE "you invest / you earn" summary → payment plan → Razorpay.
// Every ₹ shown here comes from lib/circle/engine.computeBundle — the SAME
// function the server checkout re-runs with the circle-property DB rates, so
// preview == charge. The numbers are the 8-city StayCircle properties' OWN
// pricing/ROI (circle_properties.roi_*, circle_room_types.monthly_rate) — NOT
// the hotel-night AI demand engine.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import {
  CIRCLE_PLANS, PLAN_ORDER, computeBundle, fmtINR,
  DEFAULT_CIRCLE_REVENUE,
  type BundleItem, type PaymentPlanKey, type CircleRevenueConfig,
} from "@/lib/circle/engine";

type RoomType = {
  id: string; name: string; monthlyRate: number;
  totalUnits: number; lockedUnits: number; availableUnits: number;
};
type CircleProperty = {
  id: string; title: string; city: string; images: string[];
  monthlyRate: number; roiMin: number; roiMax: number;
  roomsLabel?: string; occupancyLabel?: string; status: string;
  roomTypes: RoomType[];
};

const LOCKS_KEY = "sb_circle_locks_v1";
// Shared with the Step-2 room-selection sheet on /circle/discover — the rooms
// you pick THERE are the single source of truth; this page only reviews them.
const ROOM_SEL_KEY = "sb_circle_room_sel_v1";
function readRoomSel(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ROOM_SEL_KEY);
    const o = raw ? JSON.parse(raw) : {};
    if (o && typeof o === "object") {
      const out: Record<string, number> = {};
      Object.entries(o).forEach(([k, v]) => {
        const n = Math.floor(Number(v));
        if (n > 0) out[k] = Math.min(10, n);
      });
      return out;
    }
  } catch { /* noop */ }
  return {};
}

export default function CircleBuildPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<PaymentPlanKey>("monthly");
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [pay, setPay] = useState<"idle" | "paying" | "done">("idle");
  const [payError, setPayError] = useState("");
  const [doneBundle, setDoneBundle] = useState<any>(null);
  // Honest-revenue levers (admin-editable) — DISPLAY-ONLY, never charged.
  const [revConfig, setRevConfig] = useState<CircleRevenueConfig>(DEFAULT_CIRCLE_REVENUE);

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem("sb_user") || "null");
      if (u) setContact({ name: u.name || "", phone: u.phone || "", email: u.email || "" });
    } catch { /* noop */ }
    // rooms picked on the Discover selection sheet — read-only here
    setSelection(readRoomSel());
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((d) => setProps(Array.isArray(d?.properties) ? d.properties : []))
      .catch(() => {})
      .finally(() => setLoading(false));
    fetch("/api/circle/revenue-config")
      .then((r) => r.json())
      .then((d) => { if (d?.config) setRevConfig(d.config as CircleRevenueConfig); })
      .catch(() => {});
  }, []);

  // ---- live bundle (single source of truth · circle-property data) ----
  const items: BundleItem[] = useMemo(() => {
    const out: BundleItem[] = [];
    props.forEach((p) => {
      p.roomTypes.forEach((rt) => {
        const rooms = selection[rt.id] || 0;
        if (rooms > 0) {
          out.push({
            propertyId: p.id, propertyTitle: p.title, city: p.city,
            roomTypeId: rt.id, roomTypeName: rt.name,
            monthlyRate: rt.monthlyRate, rooms,
            roiMin: p.roiMin, roiMax: p.roiMax,
          });
        }
      });
    });
    return out;
  }, [props, selection]);

  const bundle = useMemo(() => computeBundle(items, plan, revConfig), [items, plan, revConfig]);

  // Group the recap by property so the review reads cleanly.
  const grouped = useMemo(() => {
    const map = new Map<string, {
      id: string; title: string; city: string; image: string;
      roiMin: number; roiMax: number;
      rows: { name: string; rooms: number; monthlyRate: number }[];
      monthly: number; rooms: number;
    }>();
    items.forEach((it) => {
      const prop = props.find((p) => p.id === it.propertyId);
      let g = map.get(it.propertyId);
      if (!g) {
        g = {
          id: it.propertyId, title: it.propertyTitle, city: it.city,
          image: prop?.images?.[0] || "",
          roiMin: it.roiMin, roiMax: it.roiMax,
          rows: [], monthly: 0, rooms: 0,
        };
        map.set(it.propertyId, g);
      }
      g.rows.push({ name: it.roomTypeName, rooms: it.rooms, monthlyRate: it.monthlyRate });
      g.monthly += it.monthlyRate * it.rooms;
      g.rooms += it.rooms;
    });
    return Array.from(map.values());
  }, [items, props]);

  const startPayment = useCallback(async () => {
    setPayError("");
    if (!bundle.ok || bundle.payNow <= 0) {
      setPayError("Pehle Discover se rooms choose karein.");
      return;
    }
    if (!user) {
      redirectToSignIn(router, { route: "/circle/build", action: "circle_checkout" });
      return;
    }
    if (!contact.name.trim() || contact.phone.replace(/\D/g, "").length < 8) {
      setPayError("Name aur valid phone bharein.");
      return;
    }
    setPay("paying");
    try {
      const token = localStorage.getItem("sb_token") || "";
      const res = await fetch("/api/circle/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: items.map((it) => ({ roomTypeId: it.roomTypeId, rooms: it.rooms })),
          plan,
          contact,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new RazorpayError(data?.error || "Checkout start nahi hua.");

      const result = await openRazorpayForOrder({
        orderId: data.razorpayOrderId,
        amountPaise: Math.round(data.amount * 100),
        keyId: data.keyId,
        description: `StayCircle bundle · ${bundle.roomCount} room(s) · ${bundle.propertyCount} property(ies)`,
        userName: contact.name, userPhone: contact.phone, userEmail: contact.email,
      });

      const vr = await fetch("/api/circle/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: data.bundleId, ...result }),
      });
      const vj = await vr.json().catch(() => ({}));
      if (!vj?.ok) throw new RazorpayError(vj?.error || "Payment verification failed.");
      setDoneBundle(data.breakdown);
      setPay("done");
      setSelection({});
      try { localStorage.removeItem(ROOM_SEL_KEY); } catch { /* noop */ }
    } catch (e: any) {
      setPayError(String(e?.message || e).slice(0, 200));
      setPay("idle");
    }
  }, [bundle, user, contact, items, plan, router]);

  // ------- success screen -------
  if (pay === "done") {
    return (
      <section className="sbc-section" style={{ maxWidth: 640 }}>
        <div className="sbc-panel-walnut" style={{ textAlign: "center", padding: 36 }}>
          <div style={{ fontSize: 56 }}>🎉</div>
          <h1 className="sbc-h2" style={{ color: "var(--sbc-c-ink)" }}>Welcome to the Circle!</h1>
          <p style={{ color: "var(--sbc-c-ink-soft)" }}>
            Aapka investment bundle active ho gaya. Monthly statements + returns
            aapke partner dashboard par live milenge.
          </p>
          <div className="sbc-kpi-row" style={{ marginTop: 20 }}>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?.payNow || 0)}</b><span>Paid Now</span></div>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?.monthlyTotal || 0)}</b><span>Monthly Plan</span></div>
            <div className="sbc-kpi"><b>{doneBundle?.expectedRoiMin}–{doneBundle?.expectedRoiMax}%</b><span>Expected ROI</span></div>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?.expectedMonthlyIncome || 0)}</b><span>Est. Income /mo</span></div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
            <Link href="/circle/me" className="sbc-btn-gold">Open My Portfolio →</Link>
            <Link href="/circle" className="sbc-btn-ghost">Discover More Properties</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div>
      <section className="sbc-section" style={{ paddingBottom: 20 }}>
        <h1 className="sbc-h2">
          <span className="step-pill">STEP 3 · Review &amp; Invest</span>
          {bundle.ok ? "Confirm & Invest" : "Review Your Bundle"}
        </h1>
        <p className="sbc-sub">
          {bundle.ok
            ? `${bundle.roomCount} room${bundle.roomCount > 1 ? "s" : ""} across ${bundle.propertyCount} ${bundle.propertyCount > 1 ? "properties" : "property"} — review karo, payment plan choose karo, aur invest karo.`
            : "Abhi bundle khaali hai — Discover se rooms choose karke yahan review karein."}
        </p>
      </section>

      <section className="sbc-section" style={{ paddingTop: 0, display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>
        <style>{`@media (min-width: 1024px) { .sbc-build-grid { grid-template-columns: 1.15fr 1fr !important; } }`}</style>
        <div className="sbc-build-grid" style={{ display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>

          {/* ------- LEFT: read-only bundle recap ------- */}
          <div style={{ display: "grid", gap: 14 }}>
            {loading ? (
              <div className="sbc-panel" style={{ padding: 40, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading your bundle…</div>
            ) : grouped.length === 0 ? (
              <div className="sbc-panel" style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 34 }}>🏔️</div>
                <p style={{ marginTop: 8, color: "rgba(74,56,32,.7)" }}>
                  Bundle abhi khaali hai. Discover par jaakar property + rooms choose karein.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                  <Link href="/circle/discover" className="sbc-btn-gold">→ Choose rooms on Discover</Link>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: ".76rem", letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(74,56,32,.6)", fontWeight: 700 }}>Your Bundle</div>
                  <Link href="/circle/discover" style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)", textDecoration: "none" }}>✏️ Edit rooms</Link>
                </div>
                {grouped.map((g) => (
                  <div key={g.id} className="sbc-panel" style={{ padding: 16 }}>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ width: 64, height: 64, borderRadius: 14, overflow: "hidden", flexShrink: 0, background: "#241B10" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {g.image ? <img src={g.image} alt={g.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "var(--sbc-coffee)" }}>{g.title}</div>
                        <div style={{ fontSize: ".74rem", color: "rgba(74,56,32,.6)" }}>📍 {g.city} · 📈 {g.roiMin}–{g.roiMax}% ROI</div>
                        <div style={{ marginTop: 4, fontSize: ".74rem", color: "#3F5233", fontWeight: 600 }}>
                          ✓ {g.rooms} room{g.rooms > 1 ? "s" : ""} · {fmtINR(g.monthly)}/mo
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                      {g.rows.map((r) => (
                        <div key={r.name} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 12,
                          background: "rgba(201,166,107,.1)", border: "1px solid rgba(139,105,20,.15)",
                        }}>
                          <div style={{ fontWeight: 600, fontSize: ".84rem", color: "var(--sbc-coffee)" }}>
                            {r.name} <span style={{ color: "rgba(74,56,32,.55)", fontWeight: 500 }}>× {r.rooms}</span>
                          </div>
                          <div style={{ fontSize: ".8rem", fontWeight: 700, color: "var(--sbc-gold-deep)", fontVariantNumeric: "tabular-nums" }}>
                            {fmtINR(r.monthlyRate * r.rooms)}/mo
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* ------- RIGHT: simple invest → earn summary + pay ------- */}
          <div className="sbc-panel-walnut" style={{ position: "sticky", top: 76 }}>
            <div style={{ fontSize: ".72rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--sbc-c-ink-faint)", fontWeight: 700 }}>
              Investment &amp; Returns
            </div>

            {/* what you invest */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-c-ink-soft)" }}>You invest</span>
                <b key={`inv-${bundle.monthlyTotal}`} style={{ fontSize: "1.7rem", color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                  {fmtINR(bundle.monthlyTotal)}<span style={{ fontSize: ".8rem", color: "var(--sbc-c-ink-faint)", fontWeight: 500 }}> /mo</span>
                </b>
              </div>
            </div>

            {/* booking revenue — proof the asset earns MORE than you invest */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-c-sage-deep)", fontWeight: 600 }}>Booking revenue <span style={{ opacity: .7, fontWeight: 500 }}>(gross)</span></span>
                <b key={`gr-${bundle.grossBookingRevenue}`} style={{ fontSize: "1.7rem", color: "#B7D0A0", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                  <CountUp key={bundle.grossBookingRevenue} value={bundle.grossBookingRevenue} prefix="₹" /><span style={{ fontSize: ".8rem", color: "rgba(92,107,69,.62)", fontWeight: 500 }}> /mo</span>
                </b>
              </div>
              {bundle.ok && (
                <div style={{ marginTop: 4, fontSize: ".72rem", color: "var(--sbc-c-sage-deep)" }}>
                  {bundle.revenueUpliftPct}% of your investment — your properties earn more than you put in
                </div>
              )}
            </div>

            {/* transparent deductions — platform fee + management + one-time */}
            {bundle.ok && (
              <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 14, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)", display: "grid", gap: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem" }}>
                  <span style={{ color: "var(--sbc-c-ink-soft)" }}>StayBid platform fee <span style={{ opacity: .7 }}>({bundle.revenueCommissionPct}%)</span></span>
                  <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>− {fmtINR(bundle.stayBidCommission)}/mo</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem" }}>
                  <span style={{ color: "var(--sbc-c-ink-soft)" }}>Management · channel manager</span>
                  <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>− {fmtINR(bundle.managementFee)}/mo</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem", paddingTop: 6, borderTop: "1px dashed var(--sbc-c-line)" }}>
                  <span style={{ color: "var(--sbc-c-ink-soft)" }}>One-time onboarding<span style={{ display: "block", fontSize: ".68rem", color: "var(--sbc-c-ink-faint)" }}>Setup {fmtINR(bundle.setupOneTime)} · City {fmtINR(bundle.cityOneTime)}</span></span>
                  <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtINR(bundle.oneTimeTotal)}</b>
                </div>
              </div>
            )}

            {/* what you earn — realistic ROI-based net take-home */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-gold-deep)", fontWeight: 700 }}>Your net income <span style={{ opacity: .7, fontWeight: 500 }}>(expected)</span></span>
                <b style={{ fontSize: "1.7rem", color: "var(--sbc-gold-deep)", fontVariantNumeric: "tabular-nums" }}>
                  <CountUp key={bundle.expectedMonthlyIncome} value={bundle.expectedMonthlyIncome} prefix="₹" /><span style={{ fontSize: ".8rem", color: "var(--sbc-c-ink-faint)", fontWeight: 500 }}> /mo</span>
                </b>
              </div>
            </div>

            <div className="sbc-kpi-row" style={{ marginTop: 16 }}>
              <div className="sbc-kpi" key={`roi-${bundle.expectedRoiMin}`}>
                <b>{bundle.ok ? `${bundle.expectedRoiMin}–${bundle.expectedRoiMax}%` : "—"}</b>
                <span>Expected ROI / yr{bundle.diversificationBonusPct > 0 ? ` · +${bundle.diversificationBonusPct}% diversify` : ""}</span>
              </div>
              <div className="sbc-kpi" key={`ann-${bundle.expectedAnnualIncome}`}>
                <b><CountUp key={bundle.expectedAnnualIncome} value={bundle.expectedAnnualIncome} prefix="₹" /></b>
                <span>Expected Annual Income</span>
              </div>
            </div>

            {/* payment plan */}
            <div style={{ marginTop: 18, fontSize: ".76rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sbc-c-ink-faint)" }}>Payment Plan</div>
            <div className="sbc-plan-grid" style={{ marginTop: 10 }}>
              {PLAN_ORDER.map((k) => {
                const pl = CIRCLE_PLANS[k];
                return (
                  <button key={k} className={`sbc-plan ${plan === k ? "active" : ""}`} onClick={() => setPlan(k)}>
                    <b>{pl.name.split(" (")[0]}</b>
                    <span>{pl.discountPct > 0 ? `${Math.round(pl.discountPct * 100)}% OFF` : pl.hint}</span>
                  </button>
                );
              })}
            </div>

            {/* pay row */}
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 16, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem", color: "var(--sbc-c-ink-soft)" }}>
                <span>{CIRCLE_PLANS[plan].name}</span>
                {bundle.discountAmount > 0 && <span style={{ color: "var(--sbc-c-sage-deep)" }}>− {fmtINR(bundle.discountAmount)} saved</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                <span style={{ fontSize: ".8rem", color: "var(--sbc-c-ink-soft)" }}>Pay now</span>
                <b key={`pn-${bundle.payNow}`} style={{ fontSize: "1.5rem", color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                  {fmtINR(bundle.payNow)}
                </b>
              </div>
            </div>

            {/* contact */}
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              {(["name", "phone", "email"] as const).map((f) => (
                <input
                  key={f}
                  placeholder={f === "name" ? "Full name" : f === "phone" ? "Phone" : "Email (optional)"}
                  value={contact[f]}
                  onChange={(e) => setContact((c) => ({ ...c, [f]: e.target.value }))}
                  style={{
                    padding: "11px 14px", borderRadius: 12, fontSize: ".88rem",
                    background: "var(--sbc-c-surface)", border: "1px solid var(--sbc-c-line)",
                    color: "var(--sbc-c-ink)", outline: "none",
                  }}
                />
              ))}
            </div>

            {payError && (
              <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(212,149,131,.14)", border: "1px solid rgba(212,149,131,.4)", color: "#E8B4A4", fontSize: ".82rem" }}>
                ⚠ {payError}
              </div>
            )}

            <button
              className="sbc-btn-gold"
              style={{ width: "100%", justifyContent: "center", marginTop: 14, opacity: pay === "paying" || !bundle.ok ? 0.65 : 1 }}
              disabled={pay === "paying" || !bundle.ok}
              onClick={startPayment}
            >
              {pay === "paying" ? "Processing payment…" : `Proceed & Pay ${bundle.ok ? fmtINR(bundle.payNow) : ""}`}
            </button>
            <p style={{ marginTop: 10, fontSize: ".68rem", color: "var(--sbc-c-ink-faint)", textAlign: "center" }}>
              Secure Razorpay payment · Returns are indicative projections, not guaranteed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
