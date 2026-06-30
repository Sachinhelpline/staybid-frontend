"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { HOST_CITIES } from "@/lib/host/modules";
import {
  TIER_RULES, DESIGN_PACKAGES, ADDON_SERVICES, PAYMENT_MODES, HOST_UNLIMITED,
  computeBundle, clampConfig, roomsLabel, maxCitiesLabel, inr,
  type HostTierKey, type PaymentModeKey, type PortfolioConfig,
} from "@/lib/host/wizard-rules";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

const STEPS = ["Budget", "Cities", "Rooms", "Design", "Add-ons", "Review & Pay"];

export default function HostBuildPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>}>
      <Wizard />
    </Suspense>
  );
}

function Wizard() {
  const sp = useSearchParams();
  const router = useRouter();
  const startTierRaw = String(sp.get("tier") || "").toLowerCase();
  const startTier = (TIER_RULES[startTierRaw as HostTierKey] ? startTierRaw : "") as HostTierKey | "";

  const [step, setStep] = useState(startTier ? 1 : 0);
  const [cfg, setCfg] = useState<PortfolioConfig>(() => {
    const t = startTier || "explorer";
    return { tier: t as HostTierKey, cities: [], rooms: TIER_RULES[t as HostTierKey].minRooms, design: "essential", addons: [], paymentMode: "monthly" };
  });
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [consent, setConsent] = useState(false);
  const [pay, setPay] = useState<"idle" | "working" | "done" | "error">("idle");
  const [payErr, setPayErr] = useState("");

  const tier = TIER_RULES[cfg.tier];
  const bundle = useMemo(() => computeBundle(cfg), [cfg]);
  const maxRooms = tier.maxRooms >= HOST_UNLIMITED ? 50 : tier.maxRooms;
  const maxCities = tier.maxCities >= HOST_UNLIMITED ? 50 : tier.maxCities;

  function setTier(t: HostTierKey) {
    setCfg((c) => clampConfig({ ...c, tier: t, rooms: Math.max(TIER_RULES[t].minRooms, c.rooms) }));
  }
  function toggleCity(name: string) {
    setCfg((c) => {
      const has = c.cities.includes(name);
      let cities = has ? c.cities.filter((x) => x !== name) : [...c.cities, name];
      if (!has && cities.length > maxCities) cities = cities.slice(-maxCities); // keep newest within limit
      return { ...c, cities };
    });
  }
  function setRooms(n: number) {
    setCfg((c) => ({ ...c, rooms: Math.max(tier.minRooms, Math.min(maxRooms, n)) }));
  }
  function toggleAddon(key: string) {
    setCfg((c) => ({ ...c, addons: c.addons.includes(key) ? c.addons.filter((x) => x !== key) : [...c.addons, key] }));
  }

  const canNext =
    step === 0 ? true :
    step === 1 ? cfg.cities.length >= 1 :
    step === 2 ? cfg.rooms >= tier.minRooms :
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
        body: JSON.stringify({ config: cfg, contact }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new RazorpayError(data?.error || "Could not start payment.");

      const result = await openRazorpayForOrder({
        orderId: data.razorpayOrderId,
        amountPaise: Math.round(data.amount * 100),
        keyId: data.keyId,
        description: `${tier.name} portfolio · ${cfg.rooms} room(s)`,
        userName: contact.name, userPhone: contact.phone, userEmail: contact.email,
      });

      const vr = await fetch("/api/host/portfolio/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configId: data.configId, ...result }),
      });
      const vj = await vr.json().catch(() => ({}));
      if (!vj?.ok) throw new RazorpayError(vj?.error || "Payment verification failed.");
      setPay("done");
    } catch (e: any) {
      if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setPay("idle"); return; }
      setPayErr(e?.message || "Something went wrong. Try again."); setPay("error");
    }
  }

  if (pay === "done") return <SuccessScreen tier={tier.name} payNow={bundle.payNow} />;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-28">
      {/* header */}
      <div className="flex items-center justify-between mb-4">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← Back to StayBid for Hosts</Link>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          Build your portfolio
        </span>
      </div>

      {/* stepper */}
      <div className="flex items-center gap-1.5 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex-1">
            <div className="h-1.5 rounded-full transition-all" style={{ background: i <= step ? "var(--accent)" : "var(--border-soft)" }} />
            <div className="text-[10px] mt-1 text-center truncate" style={{ color: i === step ? "var(--accent)" : "var(--text-muted)", fontWeight: i === step ? 700 : 500 }}>{s}</div>
          </div>
        ))}
      </div>

      {/* ── Step 0 — Budget tier ── */}
      {step === 0 && (
        <Panel title="Choose your budget" sub="This sets your investment & limits — no payment yet. You'll confirm everything at the end.">
          <div className="grid sm:grid-cols-2 gap-3">
            {Object.values(TIER_RULES).map((t) => {
              const on = cfg.tier === t.key;
              return (
                <button key={t.key} onClick={() => setTier(t.key)}
                  className="text-left rounded-2xl p-4 transition-all"
                  style={{ background: "var(--bg-card)", border: on ? `2px solid ${t.accent}` : "1px solid var(--border-soft)", boxShadow: on ? "var(--shadow-card)" : undefined }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: "var(--text-base)" }}>{t.name}</span>
                    {on && <span style={{ color: t.accent }}>✓</span>}
                  </div>
                  <div className="text-xs mt-1.5 flex flex-wrap gap-1.5">
                    <Chip>🛏 {roomsLabel(t)}</Chip>
                    <Chip>📍 {maxCitiesLabel(t)}</Chip>
                  </div>
                  <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                    Setup {inr(t.setupPerRoom)}/room · {inr(t.mgmtPerRoomMonthly)}/room/mo management · {t.commissionPct}% platform fee
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ── Step 1 — Cities ── */}
      {step === 1 && (
        <Panel title="Pick your cities" sub={`${tier.name} lets you operate in ${maxCitiesLabel(tier).toLowerCase()}. Selected ${cfg.cities.length}/${tier.maxCities >= HOST_UNLIMITED ? "∞" : tier.maxCities}.`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {HOST_CITIES.map((c) => {
              const on = cfg.cities.includes(c.name);
              const full = !on && cfg.cities.length >= maxCities;
              return (
                <button key={c.name} disabled={full} onClick={() => toggleCity(c.name)}
                  className="text-left rounded-2xl p-3 transition-all disabled:opacity-40"
                  style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                  <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>{on ? "✓ " : "📍 "}{c.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.sub}</div>
                </button>
              );
            })}
          </div>
          {tier.maxCities < HOST_UNLIMITED && cfg.cities.length >= maxCities && (
            <p className="text-xs mt-3" style={{ color: "var(--accent)" }}>You've hit the {tier.name} city limit. Upgrade tier for more cities.</p>
          )}
        </Panel>
      )}

      {/* ── Step 2 — Rooms ── */}
      {step === 2 && (
        <Panel title="How many managed rooms?" sub={`${tier.name} supports ${roomsLabel(tier)}. We set up, list & run every room for you.`}>
          <div className="rounded-2xl p-6 flex items-center justify-center gap-6" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
            <Stepper onClick={() => setRooms(cfg.rooms - 1)} disabled={cfg.rooms <= tier.minRooms}>−</Stepper>
            <div className="text-center">
              <div className="font-display text-5xl" style={{ color: tier.accent }}>{cfg.rooms}</div>
              <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{cfg.rooms === 1 ? "room" : "rooms"}</div>
            </div>
            <Stepper onClick={() => setRooms(cfg.rooms + 1)} disabled={cfg.rooms >= maxRooms}>+</Stepper>
          </div>
          <div className="mt-3 text-sm text-center" style={{ color: "var(--text-soft)" }}>
            Setup {inr(bundle.setup)} · Management {inr(bundle.mgmtMonthly)}/mo
          </div>
        </Panel>
      )}

      {/* ── Step 3 — Design ── */}
      {step === 3 && (
        <Panel title="Choose the design" sub="Our AI Design Studio + StayBid Store set up every room. Pick a finish level.">
          <div className="grid sm:grid-cols-3 gap-3">
            {DESIGN_PACKAGES.map((d) => {
              const on = cfg.design === d.key;
              return (
                <button key={d.key} onClick={() => setCfg((c) => ({ ...c, design: d.key }))}
                  className="text-left rounded-2xl p-4 transition-all"
                  style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                  <div className="text-2xl">{d.icon}</div>
                  <div className="font-semibold mt-1.5 flex items-center gap-1.5" style={{ color: "var(--text-base)" }}>{d.name}{on && <span style={{ color: tier.accent }}>✓</span>}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{d.blurb}</div>
                  <div className="text-sm font-semibold mt-2" style={{ color: tier.accent }}>{d.perRoom === 0 ? "Included" : `${inr(d.perRoom)}/room`}</div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ── Step 4 — Add-ons ── */}
      {step === 4 && (
        <Panel title="Add-on services" sub="Optional. Rental add-ons bill with your management cycle; EMI add-ons split over months; one-offs are charged once.">
          <div className="space-y-2.5">
            {ADDON_SERVICES.map((a) => {
              const on = cfg.addons.includes(a.key);
              const priceLabel =
                a.billing === "rental" ? `${inr(a.amount)}/mo` :
                a.billing === "emi" ? `${inr(a.amount)} · EMI ${a.emiTenureMonths}mo` :
                `${inr(a.amount)} one-time`;
              return (
                <button key={a.key} onClick={() => toggleAddon(a.key)}
                  className="w-full text-left rounded-2xl p-3.5 flex items-start gap-3 transition-all"
                  style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                  <span className="text-2xl leading-none">{a.icon}</span>
                  <span className="flex-1">
                    <span className="font-semibold flex items-center gap-2" style={{ color: "var(--text-base)" }}>
                      {a.name}
                      <BillingTag billing={a.billing} />
                    </span>
                    <span className="block text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{a.desc}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-semibold" style={{ color: tier.accent }}>{priceLabel}</span>
                    <span className="text-xs" style={{ color: on ? tier.accent : "var(--text-muted)" }}>{on ? "✓ Added" : "Add"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ── Step 5 — Review & Pay ── */}
      {step === 5 && (
        <Panel title="Your bundle" sub="Review everything, choose how you'd like to pay, then confirm.">
          {/* config recap */}
          <div className="rounded-2xl p-4 mb-4 text-sm" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
            <Recap k="Tier" v={tier.name} />
            <Recap k="Cities" v={cfg.cities.join(", ") || "—"} />
            <Recap k="Rooms" v={String(cfg.rooms)} />
            <Recap k="Design" v={DESIGN_PACKAGES.find((d) => d.key === cfg.design)?.name || "Essential"} />
            <Recap k="Add-ons" v={cfg.addons.length ? cfg.addons.map((k) => ADDON_SERVICES.find((a) => a.key === k)?.name).join(", ") : "None"} last />
          </div>

          {/* payment mode */}
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>Payment cycle</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {Object.values(PAYMENT_MODES).map((m) => {
              const on = cfg.paymentMode === m.key;
              return (
                <button key={m.key} onClick={() => setCfg((c) => ({ ...c, paymentMode: m.key as PaymentModeKey }))}
                  className="rounded-2xl p-3 text-center transition-all"
                  style={{ background: "var(--bg-card)", border: on ? `2px solid ${tier.accent}` : "1px solid var(--border-soft)" }}>
                  <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>{m.name}</div>
                  {m.recurringDiscount > 0 && <div className="text-[11px] font-semibold" style={{ color: "#15803d" }}>{Math.round(m.recurringDiscount * 100)}% off</div>}
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Security {m.securityMonths}× mo</div>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] -mt-2 mb-4" style={{ color: "var(--text-muted)" }}>{PAYMENT_MODES[cfg.paymentMode].blurb}</p>

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
              <span className="font-display text-2xl" style={{ color: tier.accent }}>{inr(bundle.payNow)}</span>
            </div>
            <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              Then {inr(bundle.recurringAfter)} / {PAYMENT_MODES[cfg.paymentMode].name.toLowerCase()}
              {bundle.security > 0 && ` · incl. ${inr(bundle.security)} refundable security`}
              {bundle.recurringSavings > 0 && ` · you save ${inr(bundle.recurringSavings)}`}
            </div>
          </div>

          {/* EMI schedule, if any */}
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
            <span>I agree to set up my {tier.name} portfolio as configured above and authorise the <b>{inr(bundle.payNow)}</b> charge now. Returns are indicative; StayBid charges a {tier.commissionPct}% platform fee on revenue. Security is refundable per the agreement.</span>
          </label>
          {pay === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{payErr}</div>}
          <button onClick={doPay} disabled={pay === "working"}
            className="w-full mt-4 px-6 py-3.5 rounded-full text-white font-semibold disabled:opacity-60"
            style={{ background: `linear-gradient(135deg,${tier.accent},${tier.accent}cc)` }}>
            {pay === "working" ? "Opening payment…" : `Confirm & pay ${inr(bundle.payNow)}`}
          </button>
        </Panel>
      )}

      {/* footer nav */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 py-3" style={{ background: "var(--bg-page)", borderTop: "1px solid var(--border-soft)" }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <button onClick={() => (step === 0 ? router.push("/host") : setStep(step - 1))}
            className="px-5 py-2.5 rounded-full font-semibold text-sm" style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>Step {step + 1} of {STEPS.length}</div>
          {step < 5 ? (
            <button onClick={() => canNext && setStep(step + 1)} disabled={!canNext}
              className="px-6 py-2.5 rounded-full font-semibold text-white text-sm disabled:opacity-40"
              style={{ background: `linear-gradient(135deg,${tier.accent},${tier.accent}cc)` }}>
              Continue →
            </button>
          ) : <div style={{ width: 92 }} />}
        </div>
      </div>
    </div>
  );
}

/* ── small components ── */
function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="sb-fade-in">
      <h1 className="font-display" style={{ fontSize: "clamp(1.5rem,4vw,2rem)", color: "var(--text-base)" }}>{title}</h1>
      <p className="text-sm mt-1 mb-5" style={{ color: "var(--text-muted)" }}>{sub}</p>
      {children}
    </div>
  );
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{children}</span>;
}
function Stepper({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-12 h-12 rounded-full text-2xl font-bold flex items-center justify-center disabled:opacity-30"
      style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>{children}</button>
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
function SuccessScreen({ tier, payNow }: { tier: string; payNow: number }) {
  return (
    <div className="max-w-md mx-auto px-6 py-20 text-center sb-fade-in">
      <div className="text-5xl mb-3">🎉</div>
      <h1 className="font-display text-3xl" style={{ color: "var(--text-base)" }}>You're in!</h1>
      <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
        Your {tier} portfolio is confirmed and we've received {inr(payNow)}. Your City Manager will reach out within 24 hours to kick off sourcing & setup.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Link href="/host/me" className="px-6 py-3 rounded-full text-white font-semibold" style={{ background: "linear-gradient(135deg,#c9911a,#a9790f)" }}>Track my portfolio</Link>
        <Link href="/host" className="px-6 py-3 rounded-full font-semibold" style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>Back to StayBid for Hosts</Link>
      </div>
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
