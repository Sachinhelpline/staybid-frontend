"use client";

// StayCircle™ — Build Your Investment Bundle (Step 2)
// Locked properties → room-type steppers → LIVE animated investment
// calculator (CountUp + Recharts projection) → payment plan → Razorpay.
// Every ₹ shown here comes from lib/circle/engine.computeBundle — the SAME
// function the server checkout re-runs with DB rates, so preview == charge.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";
import {
  CIRCLE_PLANS, PLAN_ORDER, computeBundle, fmtINR,
  type BundleItem, type PaymentPlanKey,
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

export default function CircleBuildPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [props, setProps] = useState<CircleProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  // roomTypeId → rooms count
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<PaymentPlanKey>("monthly");
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [pay, setPay] = useState<"idle" | "paying" | "done">("idle");
  const [payError, setPayError] = useState("");
  const [doneBundle, setDoneBundle] = useState<any>(null);
  const [kpiPop, setKpiPop] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCKS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setLockedIds(arr.map(String));
    } catch { /* noop */ }
    try {
      const u = JSON.parse(localStorage.getItem("sb_user") || "null");
      if (u) setContact({ name: u.name || "", phone: u.phone || "", email: u.email || "" });
    } catch { /* noop */ }
    fetch("/api/circle/properties")
      .then((r) => r.json())
      .then((d) => setProps(Array.isArray(d?.properties) ? d.properties : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Locked-first ordering; the rest are one tap away ("+ Add More Property").
  const lockedProps = useMemo(
    () => props.filter((p) => lockedIds.includes(p.id)),
    [props, lockedIds],
  );
  const otherProps = useMemo(
    () => props.filter((p) => !lockedIds.includes(p.id) && p.status === "active"),
    [props, lockedIds],
  );
  const [showMore, setShowMore] = useState(false);

  const setRooms = useCallback((rtId: string, next: number, max: number) => {
    setSelection((prev) => {
      const v = Math.max(0, Math.min(Math.min(10, max), next));
      const out = { ...prev };
      if (v <= 0) delete out[rtId]; else out[rtId] = v;
      return out;
    });
    setKpiPop((n) => n + 1);
  }, []);

  // Unlock / remove a locked property from the bundle — anytime, one tap.
  // Drops it from the lock list + localStorage, clears its room selections,
  // releases the server-side lock (best-effort), and refreshes the dock badge.
  const removeLock = useCallback((propertyId: string) => {
    setLockedIds((prev) => {
      const n = prev.filter((x) => x !== propertyId);
      try { localStorage.setItem(LOCKS_KEY, JSON.stringify(n)); } catch { /* full */ }
      try { window.dispatchEvent(new Event("sbc:locks-change")); } catch { /* noop */ }
      return n;
    });
    setSelection((prev) => {
      const prop = props.find((p) => p.id === propertyId);
      if (!prop) return prev;
      const rtIds = new Set(prop.roomTypes.map((rt) => rt.id));
      const out: Record<string, number> = {};
      Object.entries(prev).forEach(([k, v]) => { if (!rtIds.has(k)) out[k] = v; });
      return out;
    });
    try {
      const token = localStorage.getItem("sb_token") || "";
      fetch(`/api/circle/locks?propertyId=${encodeURIComponent(propertyId)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    } catch { /* noop */ }
    setKpiPop((n) => n + 1);
  }, [props]);

  // ---- live bundle (single source of truth) ----
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

  const bundle = useMemo(() => computeBundle(items, plan), [items, plan]);

  // 48-month projection for the animated chart: cumulative invested vs
  // cumulative returns at the blended avg ROI.
  const projection = useMemo(() => {
    if (!bundle.ok) return [];
    const roiAvg = (bundle.expectedRoiMin + bundle.expectedRoiMax) / 2;
    const monthlyReturn = (bundle.monthlyTotal * roiAvg) / 100 / 1; // per-month income on running monthly commitment
    const rows: { m: string; invested: number; returns: number }[] = [];
    let invested = 0, returns = 0;
    for (let m = 1; m <= 48; m++) {
      invested += bundle.monthlyTotal;
      returns += monthlyReturn * (m / 12 > 1 ? 1 : m / 12); // ramp in year 1
      if (m % 3 === 0) rows.push({ m: `M${m}`, invested: Math.round(invested), returns: Math.round(returns) });
    }
    return rows;
  }, [bundle]);

  const startPayment = useCallback(async () => {
    setPayError("");
    if (!bundle.ok || bundle.payNow <= 0) {
      setPayError("Pehle bundle me rooms add karein.");
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
          <h1 className="sbc-h2" style={{ color: "#F3E3BF" }}>Welcome to the Circle!</h1>
          <p style={{ color: "rgba(247,239,223,.75)" }}>
            Aapka investment bundle active ho gaya. Monthly statements + returns
            aapke partner dashboard par live milenge.
          </p>
          <div className="sbc-kpi-row" style={{ marginTop: 20 }}>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?.payNow || 0)}</b><span>Paid Now</span></div>
            <div className="sbc-kpi"><b>{fmtINR(doneBundle?.monthlyTotal || 0)}</b><span>Monthly Plan</span></div>
            <div className="sbc-kpi"><b>{doneBundle?.expectedRoiMin}–{doneBundle?.expectedRoiMax}%</b><span>Expected ROI</span></div>
            <div className="sbc-kpi"><b>{doneBundle?.paybackLabel}</b><span>Payback</span></div>
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
        <h1 className="sbc-h2"><span className="step-pill">STEP 2</span>Build Your Investment Bundle</h1>
        <p className="sbc-sub">From locked properties to your perfect income plan — rooms choose karo, returns live update honge.</p>
      </section>

      <section className="sbc-section" style={{ paddingTop: 0, display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>
        <style>{`@media (min-width: 1024px) { .sbc-build-grid { grid-template-columns: 1.25fr 1fr !important; } }`}</style>
        <div className="sbc-build-grid" style={{ display: "grid", gap: 22, gridTemplateColumns: "1fr", alignItems: "start" }}>

          {/* ------- LEFT: properties + room steppers ------- */}
          <div style={{ display: "grid", gap: 14 }}>
            {loading ? (
              <div className="sbc-panel" style={{ padding: 40, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading properties…</div>
            ) : lockedProps.length === 0 && !showMore ? (
              <div className="sbc-panel" style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 34 }}>🔒</div>
                <p style={{ marginTop: 8, color: "rgba(74,56,32,.7)" }}>
                  Abhi koi property locked nahi hai. Discover se lock karein ya yahin se add karein.
                </p>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                  <Link href="/circle" className="sbc-btn-gold">← Discover Properties</Link>
                  <button className="sbc-btn-ghost" style={{ color: "var(--sbc-gold-deep)", borderColor: "rgba(139,105,20,.3)" }} onClick={() => setShowMore(true)}>
                    Browse all here
                  </button>
                </div>
              </div>
            ) : (
              <>
                {lockedProps.map((p) => (
                  <BuilderPropertyCard key={p.id} p={p} selection={selection} setRooms={setRooms} locked onRemove={() => removeLock(p.id)} />
                ))}
                {showMore && otherProps.map((p) => (
                  <BuilderPropertyCard key={p.id} p={p} selection={selection} setRooms={setRooms} />
                ))}
                {!showMore && otherProps.length > 0 && (
                  <button className="sbc-panel" style={{ padding: 16, cursor: "pointer", textAlign: "center", color: "var(--sbc-gold-deep)", fontWeight: 700, border: "1.5px dashed rgba(139,105,20,.35)", background: "transparent" }} onClick={() => setShowMore(true)}>
                    + Add More Property ({otherProps.length} available)
                  </button>
                )}
              </>
            )}
          </div>

          {/* ------- RIGHT: live investment calculator ------- */}
          <div className="sbc-panel-walnut" style={{ position: "sticky", top: 76 }}>
            <div style={{ fontSize: ".7rem", letterSpacing: ".18em", textTransform: "uppercase", color: "rgba(231,207,160,.7)" }}>
              Investment &amp; Returns · Live
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8 }}>
              <b key={`t-${bundle.monthlyTotal}`} style={{ fontSize: "2rem", color: "#F3E3BF", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
                {fmtINR(bundle.monthlyTotal)}
              </b>
              <span style={{ fontSize: ".78rem", color: "rgba(247,239,223,.6)" }}>/ month · {bundle.roomCount} room(s) · {bundle.propertyCount} property(ies)</span>
            </div>

            <div className="sbc-kpi-row" style={{ marginTop: 16 }}>
              <div className="sbc-kpi pop" key={`roi-${bundle.expectedRoiMin}-${bundle.expectedRoiMax}`}>
                <b>{bundle.ok ? `${bundle.expectedRoiMin}–${bundle.expectedRoiMax}%` : "—"}</b>
                <span>Expected ROI {bundle.diversificationBonusPct > 0 ? `(+${bundle.diversificationBonusPct}% diversify)` : ""}</span>
              </div>
              <div className="sbc-kpi pop" key={`inc-${bundle.expectedMonthlyIncome}`}>
                <b><CountUp key={bundle.expectedMonthlyIncome} value={bundle.expectedMonthlyIncome} prefix="₹" /></b>
                <span>Expected Monthly Income</span>
              </div>
              <div className="sbc-kpi pop" key={`ann-${bundle.expectedAnnualIncome}`}>
                <b><CountUp key={bundle.expectedAnnualIncome} value={bundle.expectedAnnualIncome} prefix="₹" /></b>
                <span>Expected Annual Income</span>
              </div>
              <div className="sbc-kpi" key={`pb-${bundle.paybackLabel}`}>
                <b>{bundle.paybackLabel}</b>
                <span>Payback Period</span>
              </div>
            </div>

            {/* animated projection chart */}
            {bundle.ok && projection.length > 0 && (
              <div style={{ marginTop: 18, height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projection} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="sbcGold" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E7CFA0" stopOpacity={0.75} />
                        <stop offset="100%" stopColor="#C9A66B" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="sbcSage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#9DAD8F" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#7F9269" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(231,207,160,.08)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: "rgba(247,239,223,.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(247,239,223,.45)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 100000)}L`} />
                    <Tooltip
                      contentStyle={{ background: "#241B10", border: "1px solid rgba(231,207,160,.3)", borderRadius: 12, fontSize: 12 }}
                      labelStyle={{ color: "#F3E3BF" }}
                      formatter={(v: any, n: any) => [fmtINR(Number(v)), n === "invested" ? "Invested" : "Returns"]}
                    />
                    <Area type="monotone" dataKey="invested" stroke="#C9A66B" strokeWidth={2} fill="url(#sbcGold)" isAnimationActive animationDuration={800} />
                    <Area type="monotone" dataKey="returns" stroke="#9DAD8F" strokeWidth={2} fill="url(#sbcSage)" isAnimationActive animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* payment plan */}
            <div style={{ marginTop: 18, fontSize: ".76rem", letterSpacing: ".14em", textTransform: "uppercase", color: "rgba(231,207,160,.7)" }}>Payment Plan</div>
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
            <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 16, background: "rgba(243,227,191,.1)", border: "1px solid rgba(231,207,160,.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem", color: "rgba(247,239,223,.7)" }}>
                <span>{CIRCLE_PLANS[plan].name}</span>
                {bundle.discountAmount > 0 && <span style={{ color: "#9DAD8F" }}>− {fmtINR(bundle.discountAmount)} saved</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                <span style={{ fontSize: ".8rem", color: "rgba(247,239,223,.6)" }}>Pay now</span>
                <b key={`pn-${bundle.payNow}`} style={{ fontSize: "1.5rem", color: "#F3E3BF", fontVariantNumeric: "tabular-nums", animation: "sbcKpiPop .4s ease" }}>
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
                    background: "rgba(255,255,255,.06)", border: "1px solid rgba(231,207,160,.22)",
                    color: "#F7EFDF", outline: "none",
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
            <p style={{ marginTop: 10, fontSize: ".68rem", color: "rgba(247,239,223,.45)", textAlign: "center" }}>
              Secure Razorpay payment · Returns are indicative projections, not guaranteed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
function BuilderPropertyCard({
  p, selection, setRooms, locked, onRemove,
}: {
  p: CircleProperty;
  selection: Record<string, number>;
  setRooms: (rtId: string, next: number, max: number) => void;
  locked?: boolean;
  onRemove?: () => void;
}) {
  const totalSelected = p.roomTypes.reduce((s, rt) => s + (selection[rt.id] || 0), 0);
  return (
    <div className="sbc-panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 72, height: 72, borderRadius: 14, overflow: "hidden", flexShrink: 0, background: "#241B10" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.images[0]} alt={p.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--sbc-coffee)" }}>{p.title}</div>
              <div style={{ fontSize: ".74rem", color: "rgba(74,56,32,.6)" }}>📍 {p.city} · 📈 {p.roiMin}–{p.roiMax}% ROI</div>
            </div>
            {locked && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, height: "fit-content", flexShrink: 0 }}>
                <span style={{ fontSize: ".66rem", fontWeight: 700, color: "var(--sbc-gold-deep)", background: "rgba(201,166,107,.16)", border: "1px solid rgba(201,166,107,.35)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>🔒 LOCKED</span>
                {onRemove && (
                  <button
                    onClick={onRemove}
                    aria-label={`Remove ${p.title} from bundle`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: ".66rem", fontWeight: 700, whiteSpace: "nowrap", color: "#B0553F", background: "rgba(212,149,131,.14)", border: "1px solid rgba(212,149,131,.4)", borderRadius: 999, padding: "3px 9px" }}
                  >
                    ✕ Remove
                  </button>
                )}
              </div>
            )}
          </div>
          {totalSelected > 0 && (
            <div style={{ marginTop: 4, fontSize: ".74rem", color: "#3F5233", fontWeight: 600 }}>
              ✓ {totalSelected} room(s) in bundle
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {p.roomTypes.map((rt) => {
          const v = selection[rt.id] || 0;
          const max = Math.min(10, rt.availableUnits);
          const sold = rt.availableUnits <= 0;
          return (
            <div key={rt.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 13,
              background: v > 0 ? "rgba(201,166,107,.14)" : "rgba(201,166,107,.05)",
              border: `1px solid ${v > 0 ? "rgba(139,105,20,.35)" : "rgba(139,105,20,.12)"}`,
              opacity: sold ? 0.55 : 1, transition: "all .2s ease",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: ".84rem", color: "var(--sbc-coffee)" }}>{rt.name}</div>
                <div style={{ fontSize: ".7rem", color: "rgba(74,56,32,.55)" }}>
                  {fmtINR(rt.monthlyRate)} /mo · {sold ? "sold out" : `${rt.availableUnits} left`}
                </div>
              </div>
              <div className="sbc-stepper">
                <button onClick={() => setRooms(rt.id, v - 1, max)} disabled={v <= 0} aria-label="Less rooms">−</button>
                <span className="val">{v}</span>
                <button onClick={() => setRooms(rt.id, v + 1, max)} disabled={sold || v >= max} aria-label="More rooms">+</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
