"use client";
// ============================================================================
// StayBid for Hosts — 5-PHASE INVESTMENT JOURNEY (v284)
// ----------------------------------------------------------------------------
//   Phase 1 · Choose Your Investment   — slabs, return engine, payment modes,
//                                        badges, rules & compliance
//   Phase 2 · Choose Your City         — nearby/tourist, live city intelligence,
//                                        seasonality, comparison, smart picks
//   Phase 3 · Choose Property Type     — categories, sourcing, rooms, scorecard,
//                                        featured live properties
//   Phase 4 · Choose Design & Setup    — packages, themes, add-ons, estimator
//   Phase 5 · Operations & Go Live     — operating mode, go-live, pricing
//                                        preview, review & pay (Razorpay)
//
// PRICING CONTRACT (unchanged from v279/v280): every rupee flows through
// lib/host/wizard-rules computeBundle over the admin-resolved WizardConfig.
// The server checkout re-computes the SAME bundle — the client never sets an
// amount. New phase selections (return profile, property types, sourcing,
// theme, operating mode, add-on wishlist) are NON-PRICED preferences,
// whitelisted by sanitizeJourneyPreferences and stored on the config row.
// ============================================================================

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CountUp } from "@/components/CountUp";
import { HOST_CHANNELS } from "@/lib/host/modules";
import {
  DEFAULT_WIZARD_CONFIG, HOST_UNLIMITED,
  computeBundle, clampConfig, roomsLabel, maxCitiesLabel, inr,
  type HostTierKey, type PaymentModeKey, type PortfolioConfig, type WizardConfig,
} from "@/lib/host/wizard-rules";
import {
  HOST_PHASES, TIER_INTEL, RETURN_PROFILES, INVEST_BADGES, PAYMENT_METHODS,
  TIER_BUDGETS, BUDGET_SLIDER, tierForAmount,
  COMPLIANCE_RULES, IMPORTANT_NOTES, CITY_INTEL, revpar, KEY_CITY_FACTORS,
  DISTANCE_BANDS, recommendCities, PROPERTY_CATEGORIES, SOURCING_OPTIONS,
  SOURCING_ASSISTANCE, POPULAR_COMBINATIONS, SCORECARD_DIMENSIONS,
  DESIGN_THEMES, POPULAR_ADDONS, ADDON_BENEFITS, DESIGN_PROCESS,
  WHY_DESIGN_MATTERS, OPERATING_MODES, WORKFORCE_CATEGORIES, PRICING_FACTORS,
  PRICING_STRATEGIES, PRICING_PREVIEW, GO_LIVE_CHECKLIST,
  sanitizeJourneyPreferences, prefLabels, type JourneyPreferences, type CityIntel,
} from "@/lib/host/journey-data";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const SESSION_KEY = "sb_host_journey_v1";
const SESSION_TTL = 24 * 60 * 60 * 1000;

export default function HostBuildPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center" style={{ color: "var(--text-muted)" }}>Loading your journey…</div>}>
      <Journey />
    </Suspense>
  );
}

// ── Session persistence (survives the studio/store/properties round-trip) ──
interface JourneySnap { phase: number; cfg: PortfolioConfig; prefs: JourneyPreferences; amt?: number; ts: number }
function readSnap(): JourneySnap | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as JourneySnap;
    if (!s?.ts || Date.now() - s.ts > SESSION_TTL) return null;
    return s;
  } catch { return null; }
}
function clearSnap() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ } }

function Journey() {
  const sp = useSearchParams();
  const router = useRouter();
  const startTierRaw = String(sp.get("tier") || "").toLowerCase();
  const startTier = (DEFAULT_WIZARD_CONFIG.tiers[startTierRaw as HostTierKey] ? startTierRaw : "") as HostTierKey | "";

  // Live pricing config (admin-editable) — defaults first paint, resolved on mount.
  const [wc, setWc] = useState<WizardConfig>(DEFAULT_WIZARD_CONFIG);

  const [phase, setPhase] = useState(() => readSnap()?.phase || 1);
  const [cfg, setCfg] = useState<PortfolioConfig>(() => {
    const snap = readSnap();
    if (snap?.cfg?.tier) return clampConfig(snap.cfg, DEFAULT_WIZARD_CONFIG);
    const t = startTier || "explorer";
    return {
      tier: t as HostTierKey, cities: [],
      rooms: DEFAULT_WIZARD_CONFIG.tiers[t as HostTierKey].minRooms,
      design: "essential", addons: [], paymentMode: "monthly",
    };
  });
  const [prefs, setPrefs] = useState<JourneyPreferences>(() => {
    const snap = readSnap();
    return snap?.prefs || { returnProfile: "balanced", cityMode: "tourist", operatingMode: "fully_managed", sourcing: "lease" };
  });

  // v285 — amount-first slider. Display-only: dragging it auto-matches the
  // priced tier key (cfg.tier stays the single priced source of truth).
  const [amt, setAmt] = useState<number>(() => {
    const snap = readSnap();
    if (typeof snap?.amt === "number") return snap.amt;
    const t = (snap?.cfg?.tier || startTier || "explorer") as HostTierKey;
    return (TIER_BUDGETS[t] || TIER_BUDGETS.explorer).def;
  });
  // v285 — which investor badge is expanded on the journey rail.
  const [badgeOpen, setBadgeOpen] = useState<string>(INVEST_BADGES[0].key);

  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [consent, setConsent] = useState(false);
  const [pay, setPay] = useState<"idle" | "working" | "done" | "error">("idle");
  const [payErr, setPayErr] = useState("");

  // Phase-2 UI state
  const [distBand, setDistBand] = useState(DISTANCE_BANDS[1].km);
  const [focusCity, setFocusCity] = useState<string>("");

  // Phase-3 live featured properties (Smart Property Discovery interlink).
  const [featured, setFeatured] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/host/portfolio/config")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.ok && d.config) {
          setWc(d.config as WizardConfig);
          setCfg((c) => clampConfig(c, d.config));
        }
      })
      .catch(() => {});
    fetch("/api/host/properties")
      .then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d?.properties)) setFeatured(d.properties.slice(0, 12)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Persist the journey so a store/studio round-trip never loses progress.
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ phase, cfg, prefs, amt, ts: Date.now() } satisfies JourneySnap)); }
    catch { /* quota */ }
  }, [phase, cfg, prefs, amt]);

  const tier = wc.tiers[cfg.tier];
  const intel = TIER_INTEL[cfg.tier];
  const bundle = useMemo(() => computeBundle(cfg, wc), [cfg, wc]);
  const maxRooms = tier.maxRooms >= HOST_UNLIMITED ? 50 : tier.maxRooms;
  const maxCities = tier.maxCities >= HOST_UNLIMITED ? 50 : tier.maxCities;

  const returnProfile = RETURN_PROFILES.find((r) => r.key === prefs.returnProfile) || RETURN_PROFILES[1];
  const selectedCities = useMemo(
    () => cfg.cities.map((n) => CITY_INTEL.find((c) => c.name === n)).filter(Boolean) as CityIntel[],
    [cfg.cities],
  );
  const focus = CITY_INTEL.find((c) => c.name === (focusCity || cfg.cities[cfg.cities.length - 1])) || null;
  const recos = useMemo(() => recommendCities(returnProfile.key, cfg.cities), [returnProfile.key, cfg.cities]);

  // Deterministic AI scorecard — responds to the live selection.
  const aiScore = useMemo(() => {
    let s = 68;
    s += Math.min(8, selectedCities.length * 3);
    s += Math.min(6, (prefs.propertyTypes?.length || 0) * 2);
    s += prefs.sourcing ? 4 : 0;
    s += returnProfile.key === "balanced" ? 4 : 2;
    s += selectedCities.some((c) => c.demand === "High Demand") ? 4 : 0;
    return Math.min(94, s);
  }, [selectedCities, prefs.propertyTypes, prefs.sourcing, returnProfile.key]);

  const featuredForCity = useMemo(() => {
    const cityNames = cfg.cities.map((c) => c.toLowerCase());
    const match = featured.filter((p) => cityNames.includes(String(p.city || "").toLowerCase()));
    return (match.length ? match : featured).slice(0, 3);
  }, [featured, cfg.cities]);

  const openBadge = INVEST_BADGES.find((x) => x.key === badgeOpen) || INVEST_BADGES[0];

  // v285 — live earnings projection (indicative, display-only — never priced).
  const annualInvest = amt * 12;
  const estMin = Math.round((annualInvest * returnProfile.roiMin) / 100);
  const estMax = Math.round((annualInvest * returnProfile.roiMax) / 100);
  const roiMid = (returnProfile.roiMin + returnProfile.roiMax) / 2;

  // v285 — per-payment-mode live totals so each card can say "you save ₹X".
  // 4 extra computeBundle calls over the SAME admin-resolved config — cheap,
  // and it keeps every displayed rupee flowing through wizard-rules.
  const modeBundles = useMemo(() => {
    const out: Record<string, { payNow: number; save: number }> = {};
    Object.values(wc.paymentModes).forEach((m) => {
      const b = computeBundle({ ...cfg, paymentMode: m.key as PaymentModeKey }, wc);
      out[m.key] = { payNow: b.payNow, save: b.recurringSavings };
    });
    return out;
  }, [cfg, wc]);

  // ── mutations ──
  function setTier(t: HostTierKey) {
    setCfg((c) => clampConfig({ ...c, tier: t, rooms: Math.max(wc.tiers[t].minRooms, c.rooms) }, wc));
  }
  function onAmount(v: number) {
    setAmt(v);
    const t = tierForAmount(v);
    if (t !== cfg.tier) setTier(t);
  }
  function pickPlan(t: HostTierKey) {
    setAmt(TIER_BUDGETS[t].def);
    setTier(t);
  }
  function toggleCity(name: string) {
    setFocusCity(name);
    setCfg((c) => {
      const has = c.cities.includes(name);
      let cities = has ? c.cities.filter((x) => x !== name) : [...c.cities, name];
      if (!has && cities.length > maxCities) cities = cities.slice(-maxCities);
      return { ...c, cities };
    });
  }
  function setRooms(n: number) {
    setCfg((c) => ({ ...c, rooms: Math.max(tier.minRooms, Math.min(maxRooms, n)) }));
  }
  function toggleAddon(key: string) {
    setCfg((c) => ({ ...c, addons: c.addons.includes(key) ? c.addons.filter((x) => x !== key) : [...c.addons, key] }));
  }
  function togglePropertyType(key: string) {
    setPrefs((p) => {
      const cur = p.propertyTypes || [];
      const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key].slice(-6);
      return { ...p, propertyTypes: next };
    });
  }
  function toggleWishAddon(key: string) {
    setPrefs((p) => {
      const cur = p.popularAddons || [];
      return { ...p, popularAddons: cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key] };
    });
  }

  const canNext =
    phase === 2 ? cfg.cities.length >= 1 :
    true;

  async function doPay() {
    if (!consent) { setPayErr("Please confirm you agree to proceed."); setPay("error"); return; }
    if (!contact.name.trim() || contact.phone.replace(/\D/g, "").length < 8) {
      setPayErr("Enter your name and a valid phone number."); setPay("error"); return;
    }
    setPay("working"); setPayErr("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const res = await fetch("/api/host/portfolio/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ config: cfg, contact, preferences: sanitizeJourneyPreferences(prefs) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new RazorpayError(data?.error || "Could not start payment.");

      const result = await openRazorpayForOrder({
        orderId: data.razorpayOrderId,
        amountPaise: Math.round(data.amount * 100),
        keyId: data.keyId,
        description: `${tier.name} portfolio · ${cfg.rooms} room(s) · ${cfg.cities.length} city(ies)`,
        userName: contact.name, userPhone: contact.phone, userEmail: contact.email,
      });

      const vr = await fetch("/api/host/portfolio/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId: data.configId, ...result }),
      });
      const vj = await vr.json().catch(() => ({}));
      if (!vj?.ok) throw new RazorpayError(vj?.error || "Payment verification failed.");
      clearSnap();
      setPay("done");
    } catch (e: any) {
      if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setPay("idle"); return; }
      setPayErr(e?.message || "Something went wrong. Try again."); setPay("error");
    }
  }

  if (pay === "done") return <SuccessScreen tier={tier.name} payNow={bundle.payNow} cities={cfg.cities} rooms={cfg.rooms} />;

  const currentPhase = HOST_PHASES[phase - 1];

  return (
    <div className="ho-aurora min-h-screen">
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-40">
        {/* ── header ── */}
        <div className="flex items-center justify-between mb-4">
          <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
          <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full ho-glass" style={{ color: "var(--accent)" }}>
            <span className="ho-pulse is-gold" /> Portfolio Configurator · Live pricing
          </span>
        </div>

        {/* ── 5-phase stepper ── */}
        <div className="grid grid-cols-5 gap-1.5 mb-2">
          {HOST_PHASES.map((p) => {
            const state = p.n < phase ? "is-done" : p.n === phase ? "is-active" : "";
            return (
              <button key={p.n} onClick={() => p.n < phase && setPhase(p.n)}
                className={`ho-step ${state} text-left`} disabled={p.n > phase}
                aria-label={`Phase ${p.n} — ${p.title}`}>
                <div className="ho-step-track"><span /></div>
                <div className="mt-1.5 flex items-center gap-1.5 justify-center sm:justify-start">
                  <span className="ho-step-dot w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-all"
                    style={{
                      background: p.n <= phase ? "linear-gradient(135deg,#c9911a,#a9790f)" : "var(--border-soft)",
                      color: p.n <= phase ? "#fff" : "var(--text-muted)",
                    }}>
                    {p.n < phase ? "✓" : p.n}
                  </span>
                  <span className="hidden sm:block text-[10px] font-semibold truncate"
                    style={{ color: p.n === phase ? "var(--accent)" : "var(--text-muted)" }}>
                    {p.short}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mb-6 text-center sm:text-left">
          <div className="text-[11px] uppercase tracking-[0.2em] font-bold" style={{ color: "var(--accent)" }}>
            Phase {phase} of 5 · ⏱ {currentPhase.time}
          </div>
          <h1 className="font-display mt-0.5" style={{ fontSize: "clamp(1.5rem,4.5vw,2.2rem)", color: "var(--text-base)" }}>
            {currentPhase.title}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{currentPhase.desc}</p>
        </div>

        {/* ════════ PHASE 1 — CHOOSE YOUR INVESTMENT ════════ */}
        {phase === 1 && (
          <div className="ho-enter space-y-7">
            {/* 1 · Amount-first — one question, the plan matches itself (v285) */}
            <div>
              <SectionLabel n="1" title="How much do you want to invest monthly?" sub="Just drag the slider — we instantly match the right plan for you. Nothing is charged yet." />
              <div className="rounded-2xl p-5 sm:p-6 ho-glass">
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: "var(--text-muted)" }}>Your monthly investment</div>
                  <div className="font-display ho-num leading-tight" style={{ fontSize: "clamp(2.2rem,8vw,3rem)", color: tier.accent }}>
                    {inr(amt)}
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>≈ {inr(annualInvest)} invested over a year</div>
                </div>
                <input
                  type="range" aria-label="Monthly investment amount"
                  min={BUDGET_SLIDER.min} max={BUDGET_SLIDER.max} step={BUDGET_SLIDER.step}
                  value={amt} onChange={(e) => onAmount(Number(e.target.value))}
                  className="ho-slider mt-5"
                  style={{
                    ["--ho-fill" as any]: `${((amt - BUDGET_SLIDER.min) / (BUDGET_SLIDER.max - BUDGET_SLIDER.min)) * 100}%`,
                    ["--ho-tone" as any]: tier.accent,
                  }}
                />
                <div className="flex justify-between text-[10px] mt-1.5 font-semibold" style={{ color: "var(--text-muted)" }}>
                  <span>₹20K</span><span>₹50K</span><span>₹1L</span><span>₹2L</span><span>₹3L+</span>
                </div>

                {/* plan rail — tap a plan to jump the slider there */}
                <div className="grid grid-cols-4 gap-1.5 mt-4">
                  {(Object.keys(wc.tiers) as HostTierKey[]).map((k) => {
                    const t = wc.tiers[k];
                    const on = cfg.tier === k;
                    return (
                      <button key={k} onClick={() => pickPlan(k)}
                        className="ho-tile rounded-xl px-1 py-2 text-center"
                        style={{
                          background: on ? `${t.accent}14` : "var(--bg-card)",
                          border: on ? `2px solid ${t.accent}` : "1px solid var(--border-soft)",
                        }}>
                        <div className="text-[11px] font-bold uppercase tracking-wide truncate" style={{ color: on ? t.accent : "var(--text-soft)" }}>{t.name}</div>
                        <div className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>{TIER_INTEL[k].monthlyBudget.replace(/\s/g, "")}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* matched plan — 3 big friendly facts, fine print behind one tap */}
              <div key={cfg.tier} className="ho-enter rounded-2xl p-4 sm:p-5 mt-3"
                style={{ background: "var(--bg-card)", border: `2px solid ${tier.accent}` }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: tier.accent }}>✓ Your matched plan</div>
                    <div className="font-display text-2xl" style={{ color: "var(--text-base)" }}>{tier.name}</div>
                  </div>
                  <span className="text-[11px] font-semibold px-3 py-1.5 rounded-full" style={{ background: `${tier.accent}14`, color: tier.accent }}>
                    🎯 {intel.idealFor}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5 mt-3.5">
                  <BigFact icon="🛏" value={intel.roomsAccess} label="managed rooms" />
                  <BigFact icon="📍" value={intel.citiesAccess} label="cities you can pick" />
                  <BigFact icon="📈" value={intel.returnBand} label="expected return p.a.*" tone="#15803d" />
                </div>
                <details className="ho-details mt-3.5 rounded-xl px-3.5 py-3" style={{ background: "var(--bg-input, rgba(0,0,0,0.02))", border: "1px solid var(--border-soft)" }}>
                  <summary className="text-xs font-bold flex items-center gap-2" style={{ color: "var(--text-soft)" }}>
                    <span className="ho-caret">▸</span> See full plan details — fees, payback & risk, explained simply
                  </summary>
                  <div className="mt-3 space-y-2.5">
                    <Def k="Setup cost" v={`${inr(tier.setupPerRoom)} / room`} d="One-time — furnishing, photography & getting each room guest-ready." />
                    <Def k="Management fee" v={`${inr(tier.mgmtPerRoomMonthly)} / room / month`} d="We run everything — cleaning, guests, pricing & listings." />
                    <Def k="Platform fee" v={`${tier.commissionPct}% of revenue`} d="Charged only on the money your rooms actually earn." />
                    <Def k="Typical occupancy" v={intel.occupancyBand} d="How full rooms on this plan usually stay through the year." />
                    <Def k="Risk level" v={intel.riskScore} d="Based on city mix, demand stability & asset type." />
                    <Def k="Payback period" v={intel.payback} d="Estimated time to recover your setup investment." />
                  </div>
                </details>
                <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>*Returns are indicative & based on average occupancy + market conditions.</p>
              </div>
            </div>

            {/* 2 · What could you earn? — live projector, not abstract % (v285) */}
            <div>
              <SectionLabel n="2" title="What could you earn?" sub="Pick your investing style — your projection updates live below. Indicative, not guaranteed." />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {RETURN_PROFILES.map((r) => {
                  const on = prefs.returnProfile === r.key;
                  return (
                    <button key={r.key} onClick={() => setPrefs((p) => ({ ...p, returnProfile: r.key }))}
                      className={`ho-tile rounded-2xl p-3.5 text-center ${on ? "ho-glow" : ""}`}
                      style={{ background: on ? `${r.tone}0d` : "var(--bg-card)", border: on ? `2px solid ${r.tone}` : "1px solid var(--border-soft)" }}>
                      <div className="text-xs font-bold uppercase tracking-wide" style={{ color: r.tone }}>{on ? "✓ " : ""}{r.name}</div>
                      <div className="flex items-center justify-center gap-1 mt-1.5" aria-label={`Risk level ${r.riskDots} of 4`}>
                        {[1, 2, 3, 4].map((i) => (
                          <span key={i} className="w-2 h-2 rounded-full" style={{ background: i <= r.riskDots ? r.tone : "var(--border-soft)" }} />
                        ))}
                      </div>
                      <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: "var(--text-muted)" }}>risk</div>
                      <div className="text-[10px] mt-1.5 leading-snug" style={{ color: "var(--text-soft)" }}>{r.plain}</div>
                    </button>
                  );
                })}
              </div>

              {/* live projection card */}
              <div key={`${returnProfile.key}-${cfg.tier}`} className="ho-enter rounded-2xl p-4 sm:p-5 mt-3 ho-glass">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: returnProfile.tone }}>
                    Live projection · {returnProfile.name} ({returnProfile.band})
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(21,128,61,0.12)", color: "#15803d" }}>
                    <span className="ho-pulse" /> Updates as you drag
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 items-center">
                  <div className="text-center sm:text-left">
                    <div className="text-xs" style={{ color: "var(--text-soft)" }}>Investing <b style={{ color: "var(--text-base)" }}>{inr(amt)}/month</b>, you could earn</div>
                    <div className="font-display ho-num leading-tight mt-1" style={{ fontSize: "clamp(1.6rem,6vw,2.2rem)", color: returnProfile.tone }}>
                      <CountUp key={`min-${estMin}`} value={estMin} prefix="₹" duration={700} /> – <CountUp key={`max-${estMax}`} value={estMax} prefix="₹" duration={800} />
                    </div>
                    <div className="text-xs font-semibold" style={{ color: "var(--text-soft)" }}>per year · ≈ {inr(Math.round(estMin / 12))} – {inr(Math.round(estMax / 12))} every month</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold mb-1.5" style={{ color: "var(--text-soft)" }}>5-year outlook (cumulative returns)</div>
                    <div className="ho-bars" style={{ height: 72 }}>
                      {[1, 2, 3, 4, 5].map((yr) => (
                        <div key={yr} className="ho-bar" title={`Year ${yr}: ~${inr(Math.round((annualInvest * roiMid * yr) / 100))}`}
                          style={{ height: `${(yr / 5) * 100}%`, animationDelay: `${yr * 0.08}s`, background: `linear-gradient(180deg,${returnProfile.tone}cc,${returnProfile.tone})` }} />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>
                      {[1, 2, 3, 4, 5].map((yr) => <span key={yr}>Y{yr}</span>)}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] mt-2.5" style={{ color: "var(--text-muted)" }}>
                  Indicative projection on ~{inr(annualInvest)} deployed per year at {returnProfile.band} p.a. — actual returns depend on occupancy & market conditions.
                </p>
              </div>
            </div>

            {/* 3 · How do you want to pay? — real ₹ savings per cycle (v285) */}
            <div>
              <SectionLabel n="3" title="How do you want to pay?" sub="Pick a payment cycle — longer cycles cost less & need lower security. Switchable till you pay." />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {Object.values(wc.paymentModes).map((m) => {
                  const on = cfg.paymentMode === m.key;
                  const mb = modeBundles[m.key];
                  const best = m.key === "yearly";
                  return (
                    <button key={m.key} onClick={() => setCfg((c) => ({ ...c, paymentMode: m.key as PaymentModeKey }))}
                      className={`ho-tile relative rounded-2xl p-3 pt-3.5 text-center ${on ? "ho-glow" : ""}`}
                      style={{ background: on ? `${tier.accent}0d` : "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      {best && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white whitespace-nowrap" style={{ background: "#15803d" }}>
                          Best value
                        </span>
                      )}
                      <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>{on ? "✓ " : ""}{m.name}</div>
                      {m.recurringDiscount > 0 && mb?.save > 0
                        ? <div className="text-[11px] font-bold mt-0.5" style={{ color: "#15803d" }}>Save {inr(mb.save)}</div>
                        : m.recurringDiscount > 0
                          ? <div className="text-[11px] font-bold mt-0.5" style={{ color: "#15803d" }}>{Math.round(m.recurringDiscount * 100)}% off</div>
                          : <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>standard rate</div>}
                      <div className="text-[10px] mt-1 leading-snug" style={{ color: "var(--text-muted)" }}>{m.blurb}</div>
                    </button>
                  );
                })}
              </div>
              <div className="ho-marquee mt-3 rounded-full py-2 ho-glass">
                <div>
                  {[...PAYMENT_METHODS, ...PAYMENT_METHODS].map((pm, i) => (
                    <span key={i} className="text-[11px] font-medium px-3 py-1 rounded-full whitespace-nowrap"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{pm.icon} {pm.name}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* 4 · Investor badge journey — a path, not a wall of cards (v285) */}
            <div>
              <SectionLabel n="4" title="Your investor badge journey" sub="You start at Bronze with your first portfolio — tap a badge to see what it unlocks." />
              <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="ho-rail">
                  {INVEST_BADGES.map((b, i) => {
                    const on = badgeOpen === b.key;
                    const isStart = i === 0;
                    return (
                      <button key={b.key} onClick={() => setBadgeOpen(b.key)}
                        className="ho-rail-stop flex flex-col items-center gap-1 py-1"
                        aria-pressed={on} aria-label={`${b.name} badge — ${b.unlockedAt}`}>
                        <span className="w-11 h-11 rounded-full flex items-center justify-center text-xl transition-all"
                          style={{
                            background: "var(--bg-card)",
                            border: on ? `3px solid ${b.tone}` : "2px solid var(--border-soft)",
                            boxShadow: on ? `0 0 0 4px ${b.tone}22` : "none",
                          }}>
                          {b.icon}
                        </span>
                        <span className="text-[11px] font-bold" style={{ color: on ? b.tone : "var(--text-soft)" }}>{b.name}</span>
                        {isStart && (
                          <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                            You start here
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div key={openBadge.key} className="ho-enter mt-3 rounded-xl p-3.5" style={{ background: `${openBadge.tone}0d`, border: `1px solid ${openBadge.tone}44` }}>
                  <div className="text-xs font-bold" style={{ color: openBadge.tone }}>{openBadge.icon} {openBadge.name} · unlocked at {openBadge.unlockedAt.toLowerCase()}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {openBadge.benefits.map((x) => (
                      <span key={x} className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>✓ {x}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Rules & risk — tucked into tap-to-expand accordions (v285) */}
            <div className="space-y-2.5">
              <details className="ho-details rounded-2xl px-4 py-3.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <summary className="font-semibold text-sm flex items-center gap-2" style={{ color: "var(--text-base)" }}>
                  <span className="ho-caret">▸</span> 🛡️ Rules & compliance
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Strict SOPs</span>
                </summary>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
                  {COMPLIANCE_RULES.map((r) => (
                    <div key={r.title} className="flex items-start gap-1.5 text-[11px]">
                      <span>{r.icon}</span>
                      <span><b style={{ color: "var(--text-base)" }}>{r.title}</b><span className="block" style={{ color: "var(--text-muted)" }}>{r.sub}</span></span>
                    </div>
                  ))}
                </div>
              </details>
              <details className="ho-details rounded-2xl px-4 py-3.5" style={{ background: "linear-gradient(135deg,#1f1a0f,#2b2415)", color: "#faf5eb" }}>
                <summary className="font-semibold text-sm flex items-center gap-2">
                  <span className="ho-caret">▸</span> ⚠️ Important note — read before you invest
                </summary>
                <ul className="space-y-1.5 mt-3">
                  {IMPORTANT_NOTES.map((n) => (
                    <li key={n} className="text-[11px] flex items-start gap-1.5" style={{ color: "#d9be82" }}>
                      <span style={{ color: "#2ecc71" }}>✓</span>{n}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 pt-3 text-xs font-semibold" style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                  💎 Small start. Big future. Start with any plan — upgrade anytime.
                </div>
              </details>
            </div>
          </div>
        )}

        {/* ════════ PHASE 2 — CHOOSE YOUR CITY ════════ */}
        {phase === 2 && (
          <div className="ho-enter space-y-7">
            {/* Option A / B toggle */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                {([["nearby", "Option A · Nearby you"], ["tourist", "Option B · Tourist destinations"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setPrefs((p) => ({ ...p, cityMode: k }))}
                    className="px-4 py-2 rounded-full text-xs font-bold transition-all"
                    style={prefs.cityMode === k
                      ? { background: "linear-gradient(135deg,#c9911a,#a9790f)", color: "#fff" }
                      : { border: "1px solid var(--border-strong)", color: "var(--text-soft)" }}>
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-xs font-semibold" style={{ color: "var(--accent)" }}>
                  {cfg.cities.length}/{tier.maxCities >= HOST_UNLIMITED ? "∞" : tier.maxCities} selected
                </span>
              </div>

              {prefs.cityMode === "nearby" && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {DISTANCE_BANDS.map((d) => (
                    <button key={d.km} onClick={() => setDistBand(d.km)}
                      className="px-3 py-1.5 rounded-full text-[11px] font-semibold"
                      style={distBand === d.km
                        ? { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" }
                        : { border: "1px solid var(--border-soft)", color: "var(--text-muted)" }}>
                      {d.label}
                    </button>
                  ))}
                  <span className="text-[10px] self-center" style={{ color: "var(--text-muted)" }}>· road distance from Delhi NCR</span>
                </div>
              )}

              {/* City cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {CITY_INTEL
                  .filter((c) => prefs.cityMode === "nearby" ? c.distanceKm <= distBand : c.kind === "tourist")
                  .sort((a, b) => prefs.cityMode === "nearby" ? a.distanceKm - b.distanceKm : b.roiMax - a.roiMax)
                  .map((c) => {
                    const on = cfg.cities.includes(c.name);
                    const full = !on && cfg.cities.length >= maxCities;
                    return (
                      <button key={c.key} disabled={full} onClick={() => toggleCity(c.name)}
                        className={`ho-tile text-left rounded-2xl p-3 disabled:opacity-40 ${on ? "ho-glow" : ""}`}
                        style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-sm truncate" style={{ color: "var(--text-base)" }}>{on ? "✓ " : "📍 "}{c.name}</span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                            style={c.demand === "High Demand"
                              ? { background: "rgba(21,128,61,0.12)", color: "#15803d" }
                              : { background: "rgba(180,83,9,0.12)", color: "#b45309" }}>
                            {c.demand === "High Demand" ? "HIGH" : "MED"}
                          </span>
                        </div>
                        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{c.state}{prefs.cityMode === "nearby" ? ` · ${c.distanceKm} km` : ""}</div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px]">
                          <span style={{ color: "var(--text-soft)" }}><b style={{ color: "var(--accent)" }}>{c.occupancy}%</b> occ</span>
                          <span style={{ color: "var(--text-soft)" }}><b style={{ color: "var(--accent)" }}>{inr(c.adr)}</b> ADR</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
              {cfg.cities.length >= maxCities && tier.maxCities < HOST_UNLIMITED && (
                <p className="text-xs mt-2" style={{ color: "var(--accent)" }}>You've hit the {tier.name} city limit ({tier.maxCities}). Upgrade your slab in Phase 1 for more cities.</p>
              )}
            </div>

            {/* City intelligence dashboard */}
            {focus && (
              <div className="rounded-2xl p-4 sm:p-5 ho-glass ho-enter" key={focus.key}>
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--accent)" }}>City intelligence dashboard</div>
                    <div className="font-display text-xl" style={{ color: "var(--text-base)" }}>{focus.name}, {focus.state}</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(21,128,61,0.12)", color: "#15803d" }}>
                    <span className="ho-pulse" /> {focus.demand === "High Demand" ? "High potential city" : "Steady market"}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <Kpi label="Annual footfall" value={`${focus.footfallLakh} Lakh+`} />
                  <Kpi label="Avg occupancy" value={`${focus.occupancy}%`} />
                  <Kpi label="ADR" value={inr(focus.adr)} />
                  <Kpi label="RevPAR" value={inr(revpar(focus))} />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] font-bold mb-1.5" style={{ color: "var(--text-soft)" }}>Seasonality pattern (demand index)</div>
                    <div className="ho-bars" key={`bars-${focus.key}`}>
                      {focus.seasonality.map((v, i) => (
                        <div key={i} className="ho-bar" style={{
                          height: `${Math.max(8, v)}%`,
                          animationDelay: `${i * 0.05}s`,
                          background: v >= 85 ? "linear-gradient(180deg,#f0d060,#c9911a)" : v >= 60 ? "linear-gradient(180deg,#d9be82,#b89a5a)" : "var(--border-strong)",
                        }} title={`${v}/100`} />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>
                      {MONTHS.map((m, i) => <span key={i}>{m}</span>)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold mb-1.5" style={{ color: "var(--text-soft)" }}>Expected ROI range (annual)</div>
                    <div className="rounded-2xl p-4 text-center" style={{ background: "var(--accent-soft)" }}>
                      <div className="font-display text-3xl ho-num" style={{ color: "var(--accent)" }}>
                        <CountUp value={focus.roiMin} duration={800} />%–<CountUp value={focus.roiMax} duration={900} />%
                      </div>
                      <div className="text-[11px] mt-1" style={{ color: "var(--text-soft)" }}>Risk: {focus.risk} · Best for: {focus.bestFor}</div>
                      <div className="mt-2 flex flex-wrap justify-center gap-1">
                        {focus.tags.map((t) => (
                          <span key={t} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-card)", color: "var(--text-soft)" }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Comparison table */}
            {selectedCities.length >= 2 && (
              <div className="rounded-2xl p-4 overflow-x-auto" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold mb-2 text-sm" style={{ color: "var(--text-base)" }}>📊 City comparison — your picks</div>
                <table className="w-full text-[12px]" style={{ color: "var(--text-soft)" }}>
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                      <th className="py-1.5 pr-3">City</th><th className="py-1.5 pr-3">Occupancy</th>
                      <th className="py-1.5 pr-3">ADR</th><th className="py-1.5 pr-3">RevPAR</th>
                      <th className="py-1.5 pr-3">ROI</th><th className="py-1.5">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCities.map((c) => (
                      <tr key={c.key} style={{ borderTop: "1px dashed var(--border-soft)" }}>
                        <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-base)" }}>{c.name}</td>
                        <td className="py-2 pr-3">{c.occupancy}%</td>
                        <td className="py-2 pr-3">{inr(c.adr)}</td>
                        <td className="py-2 pr-3">{inr(revpar(c))}</td>
                        <td className="py-2 pr-3 font-semibold" style={{ color: "#15803d" }}>{c.roiMin}–{c.roiMax}%</td>
                        <td className="py-2">{c.risk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Smart recommendations */}
            {recos.length > 0 && cfg.cities.length < maxCities && (
              <div>
                <SectionLabel n="✨" title="Smart recommendations" sub={`AI-matched to your ${returnProfile.name.toLowerCase()} return profile.`} />
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {recos.map((c) => (
                    <button key={c.key} onClick={() => toggleCity(c.name)}
                      className="ho-tile ho-shine text-left rounded-2xl p-3"
                      style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
                      <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>+ {c.name}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-soft)" }}>{c.roiMin}–{c.roiMax}% ROI · {c.occupancy}% occ · {c.risk} risk</div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{c.bestFor}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Key factors */}
            <div className="flex flex-wrap gap-2">
              {KEY_CITY_FACTORS.map((f) => (
                <span key={f.title} className="text-[11px] font-medium px-3 py-1.5 rounded-full"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                  {f.icon} {f.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ════════ PHASE 3 — CHOOSE PROPERTY TYPE ════════ */}
        {phase === 3 && (
          <div className="ho-enter space-y-7">
            {/* Rooms */}
            <div>
              <SectionLabel n="1" title="How many managed rooms?" sub={`${tier.name} supports ${roomsLabel(tier)} across ${maxCitiesLabel(tier).toLowerCase()}. We set up, list & run every room.`} />
              <div className="rounded-2xl p-6 ho-glass flex items-center justify-center gap-7">
                <Stepper onClick={() => setRooms(cfg.rooms - 1)} disabled={cfg.rooms <= tier.minRooms}>−</Stepper>
                <div className="text-center">
                  <div className="font-display text-5xl ho-num" style={{ color: tier.accent }}><CountUp key={cfg.rooms} value={cfg.rooms} duration={300} /></div>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{cfg.rooms === 1 ? "room" : "rooms"} · setup {inr(bundle.setup)} · mgmt {inr(bundle.mgmtMonthly)}/mo</div>
                </div>
                <Stepper onClick={() => setRooms(cfg.rooms + 1)} disabled={cfg.rooms >= maxRooms}>+</Stepper>
              </div>
            </div>

            {/* Property type categories */}
            <div>
              <SectionLabel n="2" title="Property type categories" sub="Pick up to 6 categories you want in your portfolio — we source to match." />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {PROPERTY_CATEGORIES.map((c) => {
                  const on = (prefs.propertyTypes || []).includes(c.key);
                  return (
                    <button key={c.key} onClick={() => togglePropertyType(c.key)}
                      className={`ho-tile text-left rounded-2xl p-3 ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <div className="text-xl">{c.icon}</div>
                      <div className="font-semibold text-[13px] mt-1" style={{ color: "var(--text-base)" }}>{on ? "✓ " : ""}{c.name}</div>
                      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{c.sub}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {POPULAR_COMBINATIONS.map((c) => (
                  <span key={c} className="text-[10px] px-2.5 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{c}</span>
                ))}
              </div>
            </div>

            {/* Sourcing options */}
            <div>
              <SectionLabel n="3" title="Property sourcing options" sub="Multiple ways to acquire or partner — pick the structure that fits." />
              <div className="grid sm:grid-cols-2 gap-2.5">
                {SOURCING_OPTIONS.map((s) => {
                  const on = prefs.sourcing === s.key;
                  return (
                    <button key={s.key} onClick={() => setPrefs((p) => ({ ...p, sourcing: s.key }))}
                      className={`ho-tile text-left rounded-2xl p-3.5 flex items-start gap-3 ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <span className="text-xl leading-none mt-0.5">{s.icon}</span>
                      <span className="flex-1">
                        <span className="font-semibold text-sm flex items-center gap-2" style={{ color: "var(--text-base)" }}>{s.name}{on && <span style={{ color: tier.accent }}>✓</span>}</span>
                        <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{s.desc}</span>
                        <span className="mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Best for: {s.bestFor}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {SOURCING_ASSISTANCE.map((s) => (
                  <span key={s} className="text-[10px] px-2.5 py-1 rounded-full" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>✓ {s}</span>
                ))}
              </div>
            </div>

            {/* AI property scorecard */}
            <div className="rounded-2xl p-4 sm:p-5 ho-glass">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold mb-3" style={{ color: "var(--accent)" }}>AI property scorecard — live for your selection</div>
              <div className="grid sm:grid-cols-[auto_1fr] gap-5 items-center">
                <div className="flex flex-col items-center gap-1.5 mx-auto">
                  <div className="ho-ring" style={{ ["--ho-ring-pct" as any]: aiScore, ["--ho-ring-tone" as any]: aiScore >= 80 ? "#c9911a" : "#2563eb" }}>
                    <div className="text-center">
                      <div className="font-display text-3xl ho-num" style={{ color: "var(--text-base)" }}><CountUp key={aiScore} value={aiScore} duration={700} /></div>
                      <div className="text-[9px] -mt-0.5" style={{ color: "var(--text-muted)" }}>/100</div>
                    </div>
                  </div>
                  <div className="text-[11px] font-bold" style={{ color: aiScore >= 80 ? "#15803d" : "#2563eb" }}>
                    {aiScore >= 80 ? "Excellent match" : "Good match"} {"★".repeat(Math.max(3, Math.round(aiScore / 20)))}
                  </div>
                </div>
                <div className="space-y-2">
                  {SCORECARD_DIMENSIONS.map((d, i) => {
                    const v = Math.round((aiScore / 100) * d.of * (0.9 + ((i * 7) % 3) * 0.05));
                    return (
                      <div key={d.label}>
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span style={{ color: "var(--text-soft)" }}>{d.label}</span>
                          <span className="font-semibold ho-num" style={{ color: "var(--text-base)" }}>{Math.min(v, d.of)}/{d.of}</span>
                        </div>
                        <div className="ho-meter"><span style={{ width: `${Math.min(100, (v / d.of) * 100)}%`, animationDelay: `${i * 0.08}s` }} /></div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] pt-1" style={{ color: "var(--text-muted)" }}>
                    Overall insight: this configuration has {aiScore >= 80 ? "excellent" : "solid"} potential for high returns with good occupancy & strong location advantage.
                  </p>
                </div>
              </div>
            </div>

            {/* Featured live properties (Smart Property Discovery interlink) */}
            {featuredForCity.length > 0 && (
              <div>
                <SectionLabel n="4" title="Featured properties — live inventory" sub="Handpicked opportunities from Smart Property Discovery, matched to your cities." />
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {featuredForCity.map((p: any) => (
                    <div key={p.id} className="ho-tile rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                      {Array.isArray(p.images) && p.images[0] && (
                        <img src={p.images[0]} alt={p.title} loading="lazy" className="w-full h-24 object-cover" />
                      )}
                      <div className="p-3">
                        <div className="font-semibold text-[13px] truncate" style={{ color: "var(--text-base)" }}>{p.title}</div>
                        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>📍 {p.city}{p.bhk ? ` · ${p.bhk} BHK` : ""}{p.area_sqft ? ` · ${p.area_sqft} sq.ft` : ""}</div>
                        {p.rent_monthly ? (
                          <div className="text-xs font-bold mt-1" style={{ color: "var(--accent)" }}>{inr(p.rent_monthly)}/mo</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <Link href="/host/properties" className="inline-block mt-2.5 text-xs font-bold" style={{ color: "var(--accent)" }}>
                  Browse all properties in Smart Discovery →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ════════ PHASE 4 — CHOOSE DESIGN & SETUP ════════ */}
        {phase === 4 && (
          <div className="ho-enter space-y-7">
            {/* Design packages */}
            <div>
              <SectionLabel n="1" title="Premium design packages" sub="Professionally curated by the AI Design Studio — priced per room so it scales with your portfolio." />
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {wc.designPackages.map((d) => {
                  const on = cfg.design === d.key;
                  return (
                    <button key={d.key} onClick={() => setCfg((c) => ({ ...c, design: d.key }))}
                      className={`ho-tile text-left rounded-2xl p-3.5 ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <div className="text-2xl">{d.icon}</div>
                      <div className="font-semibold text-sm mt-1 flex items-center gap-1.5" style={{ color: "var(--text-base)" }}>{d.name}{on && <span style={{ color: tier.accent }}>✓</span>}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{d.blurb}</div>
                      <div className="text-sm font-bold mt-2 ho-num" style={{ color: tier.accent }}>
                        {d.perRoom === 0 ? "Included" : `${inr(d.perRoom)}/room`}
                      </div>
                      {d.perRoom > 0 && (
                        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>= {inr(d.perRoom * cfg.rooms)} for {cfg.rooms} room{cfg.rooms > 1 ? "s" : ""}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Design themes */}
            <div>
              <SectionLabel n="2" title="Choose your design theme" sub="Match your location, target audience & brand positioning." />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {DESIGN_THEMES.map((t) => {
                  const on = prefs.designTheme === t.key;
                  return (
                    <button key={t.key} onClick={() => setPrefs((p) => ({ ...p, designTheme: on ? undefined : t.key }))}
                      className={`ho-tile rounded-2xl p-3 text-center ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${t.tone}` : "1px solid var(--border-soft)" }}>
                      <div className="text-xl">{t.icon}</div>
                      <div className="font-semibold text-[13px] mt-0.5" style={{ color: on ? t.tone : "var(--text-base)" }}>{t.name}</div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>{t.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priced add-on services (billed via bundle) */}
            <div>
              <SectionLabel n="3" title="Service add-ons" sub="Rental add-ons bill with your management cycle · EMI add-ons split over months · one-offs charge once." />
              <div className="space-y-2.5">
                {wc.addons.map((a) => {
                  const on = cfg.addons.includes(a.key);
                  const priceLabel =
                    a.billing === "rental" ? `${inr(a.amount)}/mo` :
                    a.billing === "emi" ? `${inr(a.amount)} · EMI ${a.emiTenureMonths}mo` :
                    `${inr(a.amount)} one-time`;
                  return (
                    <button key={a.key} onClick={() => toggleAddon(a.key)}
                      className={`ho-tile w-full text-left rounded-2xl p-3.5 flex items-start gap-3 ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <span className="text-2xl leading-none">{a.icon}</span>
                      <span className="flex-1">
                        <span className="font-semibold flex items-center gap-2 text-sm" style={{ color: "var(--text-base)" }}>
                          {a.name}<BillingTag billing={a.billing} />
                        </span>
                        <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{a.desc}</span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-sm font-bold ho-num" style={{ color: tier.accent }}>{priceLabel}</span>
                        <span className="text-[11px]" style={{ color: on ? tier.accent : "var(--text-muted)" }}>{on ? "✓ Added" : "Add"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Popular experience add-ons (wishlist — quoted at setup) */}
            <div>
              <SectionLabel n="4" title="Popular experience add-ons" sub="Enhance guest experience & property value — shortlist now, get an exact quote during setup (not charged today)." />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {POPULAR_ADDONS.map((a) => {
                  const on = (prefs.popularAddons || []).includes(a.key);
                  return (
                    <button key={a.key} onClick={() => toggleWishAddon(a.key)}
                      className={`ho-tile rounded-2xl p-3 text-center ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <div className="text-xl">{a.icon}</div>
                      <div className="font-semibold text-[12px] mt-0.5" style={{ color: "var(--text-base)" }}>{on ? "✓ " : ""}{a.name}</div>
                      <div className="text-[10px] ho-num" style={{ color: "var(--accent)" }}>{a.from}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {ADDON_BENEFITS.map((b) => (
                  <span key={b} className="text-[10px] px-2.5 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>✦ {b}</span>
                ))}
              </div>
            </div>

            {/* Toolkit interlinks + process */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold text-sm mb-2" style={{ color: "var(--text-base)" }}>🧰 Your design toolkit</div>
                <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
                  Your journey is saved — explore the toolkit and come right back to this phase.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href="/host/studio" className="ho-tile text-xs font-bold px-3.5 py-2 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🎨 AI Design Studio →</Link>
                  <Link href="/host/store" className="ho-tile text-xs font-bold px-3.5 py-2 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🛋️ StayBid Store (Buy · Rent · EMI) →</Link>
                </div>
                <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px dashed var(--border-soft)" }}>
                  {WHY_DESIGN_MATTERS.slice(0, 4).map((w) => (
                    <div key={w} className="text-[11px]" style={{ color: "var(--text-soft)" }}>✓ {w}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold text-sm mb-2.5" style={{ color: "var(--text-base)" }}>⚙️ From concept to completion — hassle free</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {DESIGN_PROCESS.map((s) => (
                    <div key={s.n} className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-soft)" }}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>{s.n}</span>
                      {s.title}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════ PHASE 5 — OPERATIONS, GO LIVE & GROWTH ════════ */}
        {phase === 5 && (
          <div className="ho-enter space-y-7">
            {/* Operating mode */}
            <div>
              <SectionLabel n="1" title="Operating mode selection" sub="Choose how you want to run your portfolio — switchable later from your dashboard." />
              <div className="grid sm:grid-cols-3 gap-2.5">
                {OPERATING_MODES.map((m) => {
                  const on = prefs.operatingMode === m.key;
                  return (
                    <button key={m.key} onClick={() => setPrefs((p) => ({ ...p, operatingMode: m.key }))}
                      className={`ho-tile relative text-left rounded-2xl p-4 ${on ? "ho-glow" : ""}`}
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${m.tone}` : "1px solid var(--border-soft)" }}>
                      {m.recommended && (
                        <span className="absolute -top-2 right-3 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full text-white" style={{ background: m.tone }}>Recommended</span>
                      )}
                      <div className="text-2xl">{m.icon}</div>
                      <div className="font-semibold mt-1 flex items-center gap-1.5" style={{ color: "var(--text-base)" }}>{m.name}{on && <span style={{ color: m.tone }}>✓</span>}</div>
                      <div className="text-[11px] font-medium" style={{ color: m.tone }}>{m.blurb}</div>
                      <ul className="mt-2 space-y-0.5">
                        {m.points.map((pt) => (
                          <li key={pt} className="text-[10px]" style={{ color: "var(--text-muted)" }}>· {pt}</li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Go live checklist + platforms */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold text-sm mb-2.5" style={{ color: "var(--text-base)" }}>🚀 Go live — we launch your property</div>
                <div className="space-y-1.5">
                  {GO_LIVE_CHECKLIST.map((g) => (
                    <div key={g.title} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-soft)" }}>
                      <span>{g.icon}</span>{g.title}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold text-sm mb-2.5" style={{ color: "var(--text-base)" }}>🌐 Platforms we onboard you to</div>
                <div className="grid grid-cols-2 gap-2">
                  {HOST_CHANNELS.filter((c) => c.key !== "other").map((c) => (
                    <div key={c.key} className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12px]"
                      style={{ background: "var(--bg-input, rgba(0,0,0,0.02))", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                      <span>{c.icon}</span><span className="font-medium truncate" style={{ color: "var(--text-base)" }}>{c.name}</span>
                    </div>
                  ))}
                </div>
                <Link href="/host/channels" className="inline-block mt-2.5 text-xs font-bold" style={{ color: "var(--accent)" }}>Open Channel Manager →</Link>
              </div>
            </div>

            {/* Dynamic pricing preview */}
            <div className="rounded-2xl p-4 sm:p-5 ho-glass">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "var(--accent)" }}>Dynamic pricing & revenue management</div>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(21,128,61,0.12)", color: "#15803d" }}>
                  <span className="ho-pulse" /> Smart pricing · 24×7
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] font-bold mb-1.5" style={{ color: "var(--text-soft)" }}>Smart price vs market average (sample week)</div>
                  <div className="ho-bars" style={{ height: 96 }}>
                    {PRICING_PREVIEW.map((d, i) => (
                      <div key={d.day} className="flex-1 flex items-end gap-[3px] min-w-0">
                        <div className="ho-bar flex-1" style={{ height: `${(d.smart / 7000) * 100}%`, animationDelay: `${i * 0.06}s`, background: "linear-gradient(180deg,#f0d060,#c9911a)" }} title={`Smart ${inr(d.smart)}`} />
                        <div className="ho-bar flex-1" style={{ height: `${(d.market / 7000) * 100}%`, animationDelay: `${i * 0.06 + 0.03}s`, background: "var(--border-strong)" }} title={`Market ${inr(d.market)}`} />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[9px] mt-1" style={{ color: "var(--text-muted)" }}>
                    {PRICING_PREVIEW.map((d) => <span key={d.day}>{d.day}</span>)}
                  </div>
                  <div className="flex gap-3 mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: "#c9911a" }} />Our smart price</span>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1" style={{ background: "var(--border-strong)" }} />Market average</span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <div className="text-[11px] font-bold mb-1" style={{ color: "var(--text-soft)" }}>Pricing factors</div>
                    <div className="flex flex-wrap gap-1">
                      {PRICING_FACTORS.map((f) => (
                        <span key={f.name} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{f.icon} {f.name}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold mb-1" style={{ color: "var(--text-soft)" }}>Pricing strategies</div>
                    <div className="flex flex-wrap gap-1">
                      {PRICING_STRATEGIES.map((s) => (
                        <span key={s.name} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>{s.icon} {s.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Workforce interlink */}
            <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>🧑‍🔧 Workforce & services on demand</div>
                <Link href="/host/workforce" className="text-xs font-bold" style={{ color: "var(--accent)" }}>Hire from the network →</Link>
              </div>
              <div className="ho-marquee rounded-full py-1.5">
                <div>
                  {[...WORKFORCE_CATEGORIES, ...WORKFORCE_CATEGORIES].map((w, i) => (
                    <span key={i} className="text-[11px] font-medium px-3 py-1 rounded-full whitespace-nowrap"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{w.icon} {w.name}</span>
                  ))}
                </div>
              </div>
              <div className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>✓ Verified & trained · ✓ SOP driven · ✓ Pay per job · ✓ Available across cities · ✓ 24/7 support</div>
            </div>

            {/* ── Review & Pay ── */}
            <div className="rounded-2xl p-4 sm:p-5 ho-glass" id="review">
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold mb-3" style={{ color: "var(--accent)" }}>Review your portfolio & confirm</div>

              <div className="rounded-2xl p-4 mb-4 text-sm" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <Recap k="Investment slab" v={`${tier.name} · ${intel.monthlyBudget}/mo · ${intel.returnBand} p.a.*`} />
                <Recap k="Cities" v={cfg.cities.join(", ") || "—"} />
                <Recap k="Rooms" v={String(cfg.rooms)} />
                <Recap k="Design" v={`${wc.designPackages.find((d) => d.key === cfg.design)?.name || "Basic"}${prefs.designTheme ? ` · ${DESIGN_THEMES.find((t) => t.key === prefs.designTheme)?.name} theme` : ""}`} />
                <Recap k="Add-ons" v={cfg.addons.length ? cfg.addons.map((k) => wc.addons.find((a) => a.key === k)?.name).join(", ") : "None"} />
                {prefLabels(prefs).filter((l) => !["Design theme"].includes(l.k)).map((l, i, arr) => (
                  <Recap key={l.k} k={l.k} v={l.v} last={i === arr.length - 1} />
                ))}
              </div>

              {/* payment cycle (still switchable) */}
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>Payment cycle</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {Object.values(wc.paymentModes).map((m) => {
                  const on = cfg.paymentMode === m.key;
                  return (
                    <button key={m.key} onClick={() => setCfg((c) => ({ ...c, paymentMode: m.key as PaymentModeKey }))}
                      className="ho-tile rounded-2xl p-3 text-center"
                      style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                      <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>{m.name}</div>
                      {m.recurringDiscount > 0 && <div className="text-[11px] font-semibold" style={{ color: "#15803d" }}>{Math.round(m.recurringDiscount * 100)}% off</div>}
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Security {m.securityMonths}× mo</div>
                    </button>
                  );
                })}
              </div>

              {/* breakdown */}
              <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                {bundle.lines.map((l, i) => (
                  <div key={i} className="flex items-baseline justify-between py-1.5 text-sm" style={i ? { borderTop: "1px dashed var(--border-soft)" } : undefined}>
                    <span style={{ color: "var(--text-soft)" }}>
                      {l.label}
                      {l.note && <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{l.note}</span>}
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color: l.kind === "security" ? "var(--text-muted)" : "var(--text-base)" }}>{inr(l.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid var(--border-strong)" }}>
                  <span className="font-semibold" style={{ color: "var(--text-base)" }}>Pay now</span>
                  <span className="font-display text-2xl ho-num" style={{ color: tier.accent }}>{inr(bundle.payNow)}</span>
                </div>
                <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  Then {inr(bundle.recurringAfter)} / {wc.paymentModes[cfg.paymentMode].name.toLowerCase()}
                  {bundle.security > 0 && ` · incl. ${inr(bundle.security)} refundable security`}
                  {bundle.recurringSavings > 0 && ` · you save ${inr(bundle.recurringSavings)}`}
                </div>
              </div>

              {bundle.emiPlans.length > 0 && (
                <div className="rounded-2xl p-4 mt-3" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--accent)" }}>EMI schedule</div>
                  {bundle.emiPlans.map((e) => (
                    <div key={e.key} className="text-xs flex justify-between py-0.5" style={{ color: "var(--text-soft)" }}>
                      <span>{e.name}{e.downPayment > 0 ? ` (incl. ${inr(e.downPayment)} down)` : ""}</span>
                      <span>{inr(e.monthlyInstallment)}/mo × {e.tenureMonths} · {e.remainingMonths} after today</span>
                    </div>
                  ))}
                </div>
              )}

              {/* contact + consent */}
              <div className="mt-4 space-y-2.5">
                <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inpStyle} />
                <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inpStyle} />
                <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="Email (optional)" className="w-full rounded-xl px-4 py-3 text-sm" style={inpStyle} />
              </div>
              <label className="flex items-start gap-2.5 mt-3 text-xs cursor-pointer" style={{ color: "var(--text-soft)" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>
                  I agree to set up my {tier.name} portfolio as configured above and authorise the <b>{inr(bundle.payNow)}</b> charge now.
                  Returns are indicative & performance-based; StayBid charges a {tier.commissionPct}% platform fee on revenue.
                  Security is refundable per the agreement. KYC, SOP acceptance & compliance agreement apply.
                </span>
              </label>
              {pay === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{payErr}</div>}
              <button onClick={doPay} disabled={pay === "working"}
                className="ho-shine w-full mt-4 px-6 py-3.5 rounded-full text-white font-semibold disabled:opacity-60"
                style={{ background: `linear-gradient(135deg,${tier.accent},${tier.accent}cc)` }}>
                {pay === "working" ? "Opening secure payment…" : `Confirm & pay ${inr(bundle.payNow)} securely →`}
              </button>
              <p className="text-center text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>🔒 Razorpay secure checkout · server-verified amount · instant receipt</p>
            </div>
          </div>
        )}
      </div>

      {/* ── sticky journey dock ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 ho-dock px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <button onClick={() => (phase === 1 ? router.push("/host") : setPhase(phase - 1))}
            className="px-5 py-2.5 rounded-full font-semibold text-sm" style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>
            {phase === 1 ? "Cancel" : "← Back"}
          </button>
          <div className="text-center min-w-0">
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Live estimate · pay now</div>
            <div className="font-display text-lg leading-tight ho-num" style={{ color: "var(--accent)" }}>{inr(bundle.payNow)}</div>
            <div className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>then {inr(bundle.recurringAfter)}/{wc.paymentModes[cfg.paymentMode].name.toLowerCase()} · {intel.returnBand} p.a.*</div>
          </div>
          {phase < 5 ? (
            <button onClick={() => canNext && setPhase(phase + 1)} disabled={!canNext}
              className="ho-shine px-6 py-2.5 rounded-full font-semibold text-white text-sm disabled:opacity-40"
              style={{ background: `linear-gradient(135deg,${tier.accent},${tier.accent}cc)` }}>
              {phase === 2 && !canNext ? "Pick a city" : `Phase ${phase + 1} →`}
            </button>
          ) : (
            <a href="#review" className="px-6 py-2.5 rounded-full font-semibold text-white text-sm"
              style={{ background: `linear-gradient(135deg,${tier.accent},${tier.accent}cc)` }}>
              Review ↓
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── small components ── */
function SectionLabel({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#1f1a0f,#2b2415)" }}>{n}</span>
        <h2 className="font-semibold text-base" style={{ color: "var(--text-base)" }}>{title}</h2>
      </div>
      <p className="text-xs mt-1 ml-8" style={{ color: "var(--text-muted)" }}>{sub}</p>
    </div>
  );
}
// v285 — big friendly plan fact (matched-plan hero, Phase 1)
function BigFact({ icon, value, label, tone }: { icon: string; value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: "var(--bg-input, rgba(0,0,0,0.02))", border: "1px solid var(--border-soft)" }}>
      <div className="text-lg leading-none">{icon}</div>
      <div className="font-display text-base sm:text-lg mt-1 ho-num leading-tight" style={{ color: tone || "var(--text-base)" }}>{value}</div>
      <div className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}
// v285 — plain-language definition row (fees/payback accordion, Phase 1)
function Def({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[12px]">
      <span className="min-w-0">
        <b style={{ color: "var(--text-base)" }}>{k}</b>
        <span className="block text-[10px] leading-snug" style={{ color: "var(--text-muted)" }}>{d}</span>
      </span>
      <span className="font-semibold ho-num text-right shrink-0" style={{ color: "var(--text-soft)" }}>{v}</span>
    </div>
  );
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-2.5 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="font-display text-lg ho-num" style={{ color: "var(--accent)" }}>{value}</div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}
function Stepper({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="ho-tile w-12 h-12 rounded-full text-2xl font-bold flex items-center justify-center disabled:opacity-30"
      style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)", background: "var(--bg-card)" }}>{children}</button>
  );
}
function BillingTag({ billing }: { billing: "rental" | "emi" | "oneoff" }) {
  const map = { rental: { t: "Rental", c: "#0d9488" }, emi: { t: "EMI", c: "#7c3aed" }, oneoff: { t: "One-time", c: "#b45309" } };
  const m = map[billing];
  return <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: `${m.c}1a`, color: m.c }}>{m.t}</span>;
}
function Recap({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5" style={last ? undefined : { borderBottom: "1px dashed var(--border-soft)" }}>
      <span style={{ color: "var(--text-muted)" }}>{k}</span>
      <span className="text-right font-medium" style={{ color: "var(--text-base)" }}>{v}</span>
    </div>
  );
}

function SuccessScreen({ tier, payNow, cities, rooms }: { tier: string; payNow: number; cities: string[]; rooms: number }) {
  return (
    <div className="ho-aurora min-h-screen">
      <div className="relative max-w-md mx-auto px-6 py-20 text-center ho-enter">
        <div className="text-5xl mb-3 ho-float">🎉</div>
        <h1 className="font-display text-3xl" style={{ color: "var(--text-base)" }}>Welcome to the portfolio club!</h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
          Your <b>{tier}</b> portfolio ({rooms} room{rooms > 1 ? "s" : ""} · {cities.join(", ")}) is confirmed —
          we've received <b>{inr(payNow)}</b>.
        </p>
        <div className="rounded-2xl p-4 mt-5 text-left ho-glass">
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold mb-2" style={{ color: "var(--accent)" }}>What happens next</div>
          {[
            "Your City Manager calls within 24 hours",
            "Property sourcing & shortlist in your cities (2–3 days)",
            "Design & setup via AI Studio + StayBid Store (3–5 days)",
            "Listed on every OTA · operations go live (1–2 days)",
            "Track earnings live on your investor dashboard",
          ].map((s, i) => (
            <div key={s} className="flex items-start gap-2 text-xs py-1" style={{ color: "var(--text-soft)" }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>{i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/host/me" className="ho-shine px-6 py-3 rounded-full text-white font-semibold" style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>
            Open my investor dashboard →
          </Link>
          <Link href="/host" className="px-6 py-3 rounded-full font-semibold" style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>
            Back to StayBid for Hosts
          </Link>
        </div>
      </div>
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
