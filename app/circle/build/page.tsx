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
  DEFAULT_CIRCLE_REVENUE, HOLD_FRACTION,
  type BundleItem, type PaymentPlanKey, type CircleRevenueConfig,
} from "@/lib/circle/engine";
import { CIRCLE_INCOME_DISCLOSURE } from "@/lib/circle/disclosure";

type PayOption = "full" | "hold" | "emi";

// Indicative EMI tenures (months). The ACTUAL tenure + interest is chosen on
// the secure Razorpay screen with the customer's bank — this is a preview only.
const EMI_TENURES = [3, 6, 9, 12];

type RoomType = {
  id: string; name: string; monthlyRate: number;
  totalUnits: number; lockedUnits: number; availableUnits: number;
};
type CircleProperty = {
  id: string; title: string; city: string; images: string[];
  monthlyRate: number; roiMin: number; roiMax: number;
  roomsLabel?: string; occupancyLabel?: string; status: string;
  availableFrom?: string | null; // v297.3 — pre-known rent-start date (YYYY-MM-DD)
  roomTypes: RoomType[];
};

// v297.3 — local YYYY-MM-DD (no UTC shift) + friendly display.
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

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
  const [payOption, setPayOption] = useState<PayOption>("full");
  const [emiTenure, setEmiTenure] = useState<number>(6);
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [startDate, setStartDate] = useState<string>(""); // v297.3 preferred rent-start
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

  // Pay-option + plan-period derivations — all recompute live when the plan or
  // pay option changes (Sachin's "sab auto change" requirement).
  // v297.1 — monthly single-property lock removed: every plan works for
  // multi-property bundles now.
  const holdNow = Math.round(bundle.payNow * HOLD_FRACTION);
  const holdBalance = Math.max(0, bundle.payNow - holdNow);
  const chargeNow = payOption === "hold" ? holdNow : bundle.payNow;
  const periodLabel = bundle.periodMonths === 1 ? "/mo" : `over ${bundle.periodMonths} mo`;

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

  // v297.3 — the whole bundle can only start once EVERY picked property is free,
  // so the earliest allowed rent-start = max(available_from) across the bundle
  // (never before today). Pre-known + shown upfront so the customer decides easily.
  const bundledAvail = useMemo(() => {
    const today = todayISO();
    const dates = grouped
      .map((g) => props.find((p) => p.id === g.id)?.availableFrom)
      .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
    const earliest = dates.reduce((mx, d) => (d > mx ? d : mx), today);
    const perProp = grouped.map((g) => {
      const af = props.find((p) => p.id === g.id)?.availableFrom || null;
      return { title: g.title, availableFrom: af && af > today ? af : null };
    });
    return { earliest, perProp, anyFuture: dates.some((d) => d > today) };
  }, [grouped, props]);

  // Keep the picked date valid: never before the earliest-available date.
  useEffect(() => {
    setStartDate((cur) => (!cur || cur < bundledAvail.earliest ? bundledAvail.earliest : cur));
  }, [bundledAvail.earliest]);

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
          payOption,
          contact,
          startDate, // v297.3 — server re-validates/clamps against available_from
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new RazorpayError(data?.error || "Checkout start nahi hua.");

      const result = await openRazorpayForOrder({
        orderId: data.razorpayOrderId,
        amountPaise: Math.round(data.amount * 100),
        keyId: data.keyId,
        description:
          payOption === "hold"
            ? `StayCircle · 10% Visit-Access Hold · ${bundle.roomCount} room(s)`
            : `StayCircle bundle · ${bundle.roomCount} room(s) · ${bundle.propertyCount} property(ies)`,
        userName: contact.name, userPhone: contact.phone, userEmail: contact.email,
        // EMI/BNPL: ask Razorpay Checkout to surface every financing method the
        // merchant has enabled (EMI, Pay-Later — Home Credit / Snapmint / Bajaj
        // Finserv / Mobikwik appear inside these when active on the account).
        ...(payOption === "emi"
          ? { method: { emi: true, paylater: true, card: true, upi: true, netbanking: true, wallet: true } }
          : {}),
      });

      const vr = await fetch("/api/circle/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: data.bundleId, ...result }),
      });
      const vj = await vr.json().catch(() => ({}));
      if (!vj?.ok) throw new RazorpayError(vj?.error || "Payment verification failed.");
      setDoneBundle({
        ...data.breakdown,
        _payOption: data.payOption,
        _charged: data.amount,
        _balanceDue: data.balanceDue || 0,
      });
      setPay("done");
      setSelection({});
      try { localStorage.removeItem(ROOM_SEL_KEY); } catch { /* noop */ }
    } catch (e: any) {
      setPayError(String(e?.message || e).slice(0, 200));
      setPay("idle");
    }
  }, [bundle, user, contact, items, plan, payOption, startDate, router]);

  // ------- success screen -------
  if (pay === "done") {
    return (
      <section className="sbc-section" style={{ maxWidth: 640 }}>
        <div className="sbc-panel-walnut" style={{ textAlign: "center", padding: 36 }}>
          <div style={{ fontSize: 56 }}>{doneBundle?._payOption === "hold" ? "🔒" : "🎉"}</div>
          <h1 className="sbc-h2" style={{ color: "var(--sbc-c-ink)" }}>
            {doneBundle?._payOption === "hold" ? "Property Held for Your Visit!" : "Welcome to the Circle!"}
          </h1>
          <p style={{ color: "var(--sbc-c-ink-soft)" }}>
            {doneBundle?._payOption === "hold"
              ? "Aapka 10% Visit-Access Hold confirm ho gaya. Hamari team property visit coordinate karegi — visit + agreement sign ke baad balance pay karke bundle active ho jayega."
              : "Aapka investment bundle active ho gaya. Monthly statements + returns aapke partner dashboard par live milenge."}
          </p>
          {doneBundle?._payOption === "hold" && (doneBundle?._balanceDue || 0) > 0 && (
            <div style={{ marginTop: 14, display: "inline-block", padding: "10px 16px", borderRadius: 12, background: "rgba(106,133,160,.14)", border: "1px solid rgba(106,133,160,.35)", color: "var(--sbc-c-ink)", fontWeight: 700 }}>
              Balance due after visit: {fmtINR(doneBundle._balanceDue)}
            </div>
          )}
          <div className="sbc-kpi-row" style={{ marginTop: 20 }}>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?._charged ?? doneBundle?.payNow ?? 0)}</b><span>Paid Now</span></div>
            {doneBundle?._payOption === "hold"
              ? <div className="sbc-kpi"><b>{fmtINR(doneBundle?._balanceDue || 0)}</b><span>Balance Due</span></div>
              : <div className="sbc-kpi"><b>{fmtINR(doneBundle?.monthlyTotal || 0)}</b><span>Monthly Plan</span></div>}
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
            ? `${bundle.roomCount} room${bundle.roomCount > 1 ? "s" : ""} across ${bundle.propertyCount} ${bundle.propertyCount > 1 ? "properties" : "property"} — review, choose a payment plan, and invest.`
            : "Your bundle is empty — choose rooms from Discover and review them here."}
        </p>
      </section>

      <section className="sbc-section" style={{ paddingTop: 0, display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>
        <style>{`
          @media (min-width: 1024px) { .sbc-build-grid { grid-template-columns: 1.15fr 1fr !important; } }
          /* v297.3 — booking-revenue "reflective" shine + card shimmer sweep */
          .sbc-rev-shine {
            background: linear-gradient(100deg, #7FA968 18%, #EAF6DE 46%, #B7D0A0 54%, #7FA968 82%);
            background-size: 220% 100%;
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent; color: transparent;
            animation: sbcRevShine 3.2s linear infinite;
          }
          @keyframes sbcRevShine { 0% { background-position: 180% 0; } 100% { background-position: -80% 0; } }
          .sbc-rev-card::after {
            content: ""; position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(115deg, transparent 32%, rgba(255,255,255,.30) 49%, transparent 66%);
            transform: translateX(-120%); animation: sbcRevSweep 3.6s ease-in-out infinite;
          }
          @keyframes sbcRevSweep { 0%,52% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
          @media (prefers-reduced-motion: reduce) {
            .sbc-rev-shine { animation: none; -webkit-text-fill-color: #7FA968; color: #7FA968; }
            .sbc-rev-card::after { display: none; }
          }
        `}</style>
        <div className="sbc-build-grid" style={{ display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>

          {/* ------- LEFT: read-only bundle recap ------- */}
          <div style={{ display: "grid", gap: 14 }}>
            {loading ? (
              <div className="sbc-panel" style={{ padding: 40, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading your bundle…</div>
            ) : grouped.length === 0 ? (
              <div className="sbc-panel" style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 34 }}>🏔️</div>
                <p style={{ marginTop: 8, color: "rgba(74,56,32,.7)" }}>
                  Your bundle is empty. Go to Discover and choose a property + rooms.
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
                          background: "rgba(106,133,160,.1)", border: "1px solid rgba(139,105,20,.15)",
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

            {/* what you invest — EFFECTIVE per-month rate AFTER the plan discount
                (this number CHANGES per plan). Base rate struck through when a
                discount is live, so the saving is visibly real (Sachin #1 + #2). */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-c-ink-soft)" }}>You invest</span>
                <span style={{ textAlign: "right" }}>
                  {bundle.discountPct > 0 && (
                    <span style={{ display: "block", fontSize: ".74rem", color: "var(--sbc-c-ink-faint)", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>
                      {fmtINR(bundle.monthlyTotal)}/mo
                    </span>
                  )}
                  <b key={`inv-${bundle.effectiveMonthlyInvestment}`} style={{ fontSize: "1.7rem", color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                    {fmtINR(bundle.effectiveMonthlyInvestment)}<span style={{ fontSize: ".8rem", color: "var(--sbc-c-ink-faint)", fontWeight: 500 }}> /mo</span>
                  </b>
                  {bundle.ok && (
                    <span style={{ display: "block", marginTop: 2, fontSize: ".72rem", color: "var(--sbc-c-ink-faint)", fontVariantNumeric: "tabular-nums" }}>
                      {fmtINR(bundle.advanceAmount)} total · {bundle.planMonths} mo
                    </span>
                  )}
                </span>
              </div>
              {bundle.discountPct > 0 && (
                <div style={{ marginTop: 4, fontSize: ".72rem", color: "var(--sbc-c-sage-deep)", textAlign: "right" }}>
                  {Math.round(bundle.discountPct * 100)}% off applied · you save {fmtINR(bundle.discountAmount)} on the {bundle.planMonths}-mo advance
                </div>
              )}
            </div>

            {/* booking revenue — proof the asset earns MORE than you invest.
                Bold + highlighted + reflective shine (Sachin #3). Shows BOTH the
                total over the plan period AND the per-month turnover; both scale
                to the selected plan so they auto-change with the mode. */}
            <div className="sbc-rev-card" style={{ marginTop: 14, padding: "13px 15px", borderRadius: 16, position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(157,173,143,.22), rgba(183,208,160,.10))", border: "1px solid rgba(157,173,143,.44)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, position: "relative", zIndex: 1 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-c-sage-deep)", fontWeight: 700 }}>Booking revenue <span style={{ opacity: .75, fontWeight: 600 }}>(gross)</span></span>
                <b key={`gr-${bundle.grossPeriod}`} style={{ fontSize: "1.9rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                  <CountUp key={bundle.grossPeriod} className="sbc-rev-shine" value={bundle.grossPeriod} prefix="₹" />
                  <span style={{ fontSize: ".78rem", fontWeight: 600, color: "rgba(92,107,69,.7)" }}> {periodLabel}</span>
                </b>
              </div>
              {bundle.ok && (
                <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, position: "relative", zIndex: 1 }}>
                  <span style={{ fontSize: ".72rem", color: "var(--sbc-c-sage-deep)" }}>
                    {bundle.revenueUpliftPct}% of your investment
                  </span>
                  <b style={{ fontSize: ".92rem", color: "#7FA968", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {fmtINR(bundle.grossBookingRevenue)}<span style={{ fontSize: ".68rem", color: "rgba(92,107,69,.7)", fontWeight: 500 }}> /mo</span>
                  </b>
                </div>
              )}
            </div>

            {/* transparent deductions — platform fee + management, BOTH plan-tuned.
                Longer plans lower the fee % and discount management → net rises.
                One-time onboarding is NOT here — it is a separate upfront cost
                that is never deducted from the returns (Sachin #4/#5/#6). */}
            {bundle.ok && (
              <div style={{ marginTop: 12, padding: "11px 14px", borderRadius: 14, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)", display: "grid", gap: 9 }}>
                {/* platform fee — shows how much a longer plan SAVES vs Monthly (Sachin #A) */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem" }}>
                    <span style={{ color: "var(--sbc-c-ink-soft)" }}>StayBid platform fee <span style={{ opacity: .7 }}>({bundle.revenueCommissionPct}%)</span></span>
                    <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>− {fmtINR(bundle.commissionPeriod)} {periodLabel}</b>
                  </div>
                  {bundle.commissionSaved > 0 && (
                    <div style={{ marginTop: 2, textAlign: "right", fontSize: ".68rem", fontWeight: 700, color: "var(--sbc-c-sage-deep)" }}>
                      ↓ you save {fmtINR(bundle.commissionSaved)} vs Monthly ({Math.round(CIRCLE_PLANS.monthly.commissionPct * 100)}%)
                    </div>
                  )}
                </div>
                {/* management — shows how much the per-plan discount SAVES (Sachin #B) */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".8rem" }}>
                    <span style={{ color: "var(--sbc-c-ink-soft)", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      Management · channel manager
                      {bundle.mgmtDiscountPct > 0 && (
                        <span style={{ fontSize: ".58rem", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--sbc-c-sage-deep)", background: "rgba(157,173,143,.24)", padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>{Math.round(bundle.mgmtDiscountPct * 100)}% off</span>
                      )}
                    </span>
                    <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>− {fmtINR(bundle.managementPeriod)} {periodLabel}</b>
                  </div>
                  {bundle.managementSaved > 0 && (
                    <div style={{ marginTop: 2, textAlign: "right", fontSize: ".68rem", fontWeight: 700, color: "var(--sbc-c-sage-deep)" }}>
                      ↓ you save {fmtINR(bundle.managementSaved)} on management
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* what you earn — realistic ROI-based net take-home, plan-period scaled */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-gold-deep)", fontWeight: 700 }}>Your net income <span style={{ opacity: .7, fontWeight: 500 }}>(expected)</span></span>
                <b style={{ fontSize: "1.7rem", color: "var(--sbc-gold-deep)", fontVariantNumeric: "tabular-nums" }}>
                  <CountUp key={bundle.netPeriod} value={bundle.netPeriod} prefix="₹" /><span style={{ fontSize: ".78rem", color: "var(--sbc-c-ink-faint)", fontWeight: 500 }}> {periodLabel}</span>
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

            {/* one-time onboarding — a SEPARATE upfront cost, kept out of the
                returns math on purpose (Sachin #6). Never added to investment,
                never subtracted from the net income above. */}
            {bundle.ok && bundle.oneTimeTotal > 0 && (
              <div style={{ marginTop: 12, padding: "10px 13px", borderRadius: 12, background: "var(--sbc-c-surface)", border: "1px dashed var(--sbc-c-line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: ".8rem" }}>
                  <span style={{ color: "var(--sbc-c-ink-soft)" }}>One-time onboarding <span style={{ opacity: .7, fontSize: ".7rem" }}>(paid once)</span></span>
                  <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtINR(bundle.oneTimeTotal)}</b>
                </div>
                <div style={{ marginTop: 3, fontSize: ".68rem", color: "var(--sbc-c-ink-faint)", lineHeight: 1.45 }}>
                  Setup {fmtINR(bundle.setupOneTime)} · City {fmtINR(bundle.cityOneTime)} — a one-time cost, <b>not deducted</b> from the returns shown above.
                </div>
              </div>
            )}

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

            {/* pay row — security + advance breakdown */}
            <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 16, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem", color: "var(--sbc-c-ink-soft)" }}>
                <span>{CIRCLE_PLANS[plan].name}</span>
                {bundle.discountAmount > 0 && <span style={{ color: "var(--sbc-c-sage-deep)" }}>− {fmtINR(bundle.discountAmount)} saved</span>}
              </div>
              {bundle.ok && (
                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {/* Advance rent — the ACTUAL investment your returns are based on */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: ".78rem", color: "var(--sbc-c-ink-soft)" }}>
                    <span>Advance rent <span style={{ opacity: .7 }}>({bundle.planMonths} mo{bundle.discountPct > 0 ? ` − ${Math.round(bundle.discountPct * 100)}%` : ""})</span></span>
                    <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtINR(bundle.advanceAmount)}</b>
                  </div>
                  {/* Security deposit — kept visibly separate + flagged refundable so it
                      never reads as part of the investment (v297.1 — Sachin's ask). */}
                  <div style={{ padding: "9px 11px", borderRadius: 11, background: "rgba(157,173,143,.13)", border: "1px dashed rgba(157,173,143,.5)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: ".78rem" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--sbc-c-ink-soft)", flexWrap: "wrap" }}>
                        Security deposit
                        <span style={{ fontSize: ".58rem", fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--sbc-c-sage-deep)", background: "rgba(157,173,143,.24)", padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap" }}>↩ Refundable</span>
                      </span>
                      <b style={{ color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", fontWeight: 600, flexShrink: 0 }}>{fmtINR(bundle.securityAmount)}</b>
                    </div>
                    <div style={{ marginTop: 4, fontSize: ".68rem", color: "var(--sbc-c-sage-deep)", lineHeight: 1.45 }}>
                      {bundle.securityMonths} mo deposit — fully returned to you at the end. It is <b>not an investment</b>, so your returns above are calculated on the advance rent only, never on this deposit.
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--sbc-c-line)" }}>
                <span style={{ fontSize: ".82rem", color: "var(--sbc-c-ink)", fontWeight: 700 }}>{payOption === "hold" ? "Hold now (10%)" : "Pay now"}</span>
                <b key={`pn-${chargeNow}`} style={{ fontSize: "1.5rem", color: "var(--sbc-c-ink)", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                  {fmtINR(chargeNow)}
                </b>
              </div>
              {payOption === "hold" && bundle.ok && (
                <div style={{ marginTop: 4, fontSize: ".72rem", color: "var(--sbc-c-ink-faint)", textAlign: "right" }}>
                  Balance {fmtINR(holdBalance)} — after property visit + agreement
                </div>
              )}
            </div>

            {/* ---- v297.3 · preferred property-from (rent-start) date ----
                The pre-known availability is shown UPFRONT so the customer picks a
                date they KNOW works — rent starts here, NOT on the day they pay.
                The server re-validates + clamps to the earliest free date. */}
            {bundle.ok && (
              <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 16, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: ".76rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sbc-c-ink-faint)", fontWeight: 700 }}>Property from date</span>
                  <input
                    type="date"
                    min={bundledAvail.earliest}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{
                      padding: "11px 14px", borderRadius: 12, fontSize: ".9rem",
                      background: "var(--sbc-c-surface)", border: "1px solid var(--sbc-c-line)",
                      color: "var(--sbc-c-ink)", outline: "none", colorScheme: "dark",
                    }}
                  />
                </label>
                <div style={{ marginTop: 8, fontSize: ".72rem", color: "var(--sbc-c-ink-soft)", lineHeight: 1.5 }}>
                  {bundledAvail.anyFuture
                    ? <>Earliest available: <b style={{ color: "var(--sbc-c-sage-deep)" }}>{fmtDate(bundledAvail.earliest)}</b> — rent starts on your chosen date, not on the day you pay.</>
                    : <>✓ Available now — rent starts on your chosen date, not on the day you pay.</>}
                </div>
                {bundledAvail.perProp.some((p) => p.availableFrom) && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {bundledAvail.perProp.filter((p) => p.availableFrom).map((p) => (
                      <span key={p.title} style={{ fontSize: ".68rem", fontWeight: 600, color: "var(--sbc-c-ink-soft)", background: "var(--sbc-c-surface)", border: "1px solid var(--sbc-c-line)", borderRadius: 8, padding: "3px 8px" }}>
                        {p.title}: {fmtDate(p.availableFrom!)}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: ".68rem", color: "var(--sbc-c-ink-faint)", lineHeight: 1.45 }}>
                  Our team confirms this date against live availability. If it's taken, we'll set the nearest available date and let you know before your stay begins.
                </div>
              </div>
            )}

            {/* ---- pay option: Full · 10% Hold · EMI/BNPL ---- */}
            <div style={{ marginTop: 16, fontSize: ".76rem", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--sbc-c-ink-faint)" }}>How do you want to pay?</div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {([
                { key: "full", icon: "⚡", title: "Proceed & Pay", sub: "Full payment now — invest instantly", amt: bundle.payNow },
                { key: "hold", icon: "🔒", title: "10% Visit-Access Hold", sub: "Reserve for a property visit · balance after visit + agreement", amt: holdNow },
                { key: "emi", icon: "💳", title: "EMI / Pay Later", sub: "Razorpay EMI + BNPL (Home Credit · Snapmint · Bajaj Finserv · Mobikwik)", amt: bundle.payNow },
              ] as { key: PayOption; icon: string; title: string; sub: string; amt: number }[]).map((o) => (
                <button
                  key={o.key}
                  onClick={() => setPayOption(o.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer",
                    padding: "12px 14px", borderRadius: 14, width: "100%",
                    background: payOption === o.key ? "rgba(106,133,160,.16)" : "var(--sbc-c-surface)",
                    border: payOption === o.key ? "1.5px solid var(--sbc-gold-deep)" : "1px solid var(--sbc-c-line)",
                    transition: "all .15s ease",
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{o.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: ".9rem", color: "var(--sbc-c-ink)" }}>{o.title}</span>
                    <span style={{ display: "block", fontSize: ".72rem", color: "var(--sbc-c-ink-soft)", marginTop: 1 }}>{o.sub}</span>
                  </span>
                  <span style={{ fontSize: ".9rem", fontWeight: 800, color: payOption === o.key ? "var(--sbc-gold-deep)" : "var(--sbc-c-ink-soft)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {bundle.ok ? fmtINR(o.amt) : "—"}
                  </span>
                </button>
              ))}
            </div>

            {/* EMI tenure preview — indicative split shown when EMI is chosen.
                The real tenure + bank + interest are set on the secure Razorpay
                screen; this is an honest preview, not a fixed plan (Sachin #7). */}
            {payOption === "emi" && bundle.ok && (
              <div style={{ marginTop: 12, padding: "13px 15px", borderRadius: 14, background: "var(--sbc-c-surface-2)", border: "1px solid var(--sbc-c-line)" }}>
                <div style={{ fontSize: ".74rem", fontWeight: 700, color: "var(--sbc-c-ink-soft)", letterSpacing: ".02em" }}>Preview your EMI tenure</div>
                <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7 }}>
                  {EMI_TENURES.map((m) => {
                    const per = Math.round(chargeNow / m);
                    return (
                      <button
                        key={m}
                        onClick={() => setEmiTenure(m)}
                        style={{
                          display: "grid", gap: 2, textAlign: "center", cursor: "pointer",
                          padding: "9px 4px", borderRadius: 11,
                          background: emiTenure === m ? "rgba(106,133,160,.18)" : "var(--sbc-c-surface)",
                          border: emiTenure === m ? "1.5px solid var(--sbc-gold-deep)" : "1px solid var(--sbc-c-line)",
                        }}
                      >
                        <b style={{ fontSize: ".84rem", color: emiTenure === m ? "var(--sbc-gold-deep)" : "var(--sbc-c-ink)" }}>{m} mo</b>
                        <span style={{ fontSize: ".64rem", color: "var(--sbc-c-ink-faint)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(per)}/mo</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 9, display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: ".8rem", color: "var(--sbc-c-ink-soft)" }}>
                  <span>≈ {emiTenure} monthly payments of</span>
                  <b style={{ fontSize: "1.05rem", color: "var(--sbc-gold-deep)", fontVariantNumeric: "tabular-nums" }}>{fmtINR(Math.round(chargeNow / emiTenure))}/mo</b>
                </div>
                <div style={{ marginTop: 6, fontSize: ".68rem", color: "var(--sbc-c-ink-faint)", lineHeight: 1.5 }}>
                  Indicative split of {fmtINR(chargeNow)}. The final tenure, bank &amp; interest are confirmed on the secure Razorpay screen with your debit/credit card — no-cost EMI applies where your bank offers it.
                </div>
              </div>
            )}

            {/* contact — labelled so each column is clear */}
            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              {([
                { f: "name" as const, label: "Full name", ph: "Aapka poora naam", type: "text", req: true },
                { f: "phone" as const, label: "Mobile number", ph: "10-digit mobile number", type: "tel", req: true },
                { f: "email" as const, label: "Email (optional)", ph: "you@email.com", type: "email", req: false },
              ]).map(({ f, label, ph, type, req }) => (
                <label key={f} style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--sbc-c-ink-soft)", letterSpacing: ".02em" }}>
                    {label}{req && <span style={{ color: "var(--sbc-gold-deep)" }}> *</span>}
                  </span>
                  <input
                    type={type}
                    inputMode={f === "phone" ? "numeric" : undefined}
                    placeholder={ph}
                    value={contact[f]}
                    onChange={(e) => setContact((c) => ({ ...c, [f]: e.target.value }))}
                    style={{
                      padding: "11px 14px", borderRadius: 12, fontSize: ".88rem",
                      background: "var(--sbc-c-surface)", border: "1px solid var(--sbc-c-line)",
                      color: "var(--sbc-c-ink)", outline: "none",
                    }}
                  />
                </label>
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
              {pay === "paying"
                ? "Processing payment…"
                : payOption === "hold"
                  ? `🔒 Hold for Visit · ${bundle.ok ? fmtINR(chargeNow) : ""}`
                  : payOption === "emi"
                    ? `💳 Pay via EMI · ${bundle.ok ? fmtINR(chargeNow) : ""}`
                    : `⚡ Proceed & Pay ${bundle.ok ? fmtINR(chargeNow) : ""}`}
            </button>
            <p style={{ marginTop: 10, fontSize: ".68rem", color: "var(--sbc-c-ink-faint)", textAlign: "center" }}>
              Secure Razorpay payment · {CIRCLE_INCOME_DISCLOSURE}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
