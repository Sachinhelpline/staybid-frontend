"use client";

import { useState } from "react";
import Link from "next/link";
import {
  HOST_MODULES, HOW_IT_WORKS, PROPERTY_TYPES, HOST_CITIES,
  HOST_STATS, HOST_BENEFITS, HOST_TRUST, HOST_BUDGET_TIERS,
  TRADITIONAL_CHALLENGES, STAYBID_HANDLES, HOST_OPERATIONS,
  HOST_INVENTORY, HOST_TEAM, type HostModuleKey,
} from "@/lib/host/modules";

export default function HostHome() {
  const [lead, setLead] = useState<{ interest: string; tier?: string } | null>(null);

  return (
    <div className="hostos-home">
      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-10 grid lg:grid-cols-2 gap-10 items-center">
          <div className="sb-fade-in">
            <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-4"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              🏨 Managed Hospitality Portfolio Platform
            </span>
            <h1 className="font-display leading-[1.05]" style={{ fontSize: "clamp(2.2rem,6vw,3.6rem)", color: "var(--text-base)" }}>
              Invest from ₹20K.<br />
              <span style={{ color: "var(--accent)" }}>We build & run it. You earn.</span>
            </h1>
            <p className="mt-4 text-base sm:text-lg max-w-xl" style={{ color: "var(--text-soft)" }}>
              Pick a budget tier. StayBid finds the property, designs it, lists it on every OTA
              and runs the entire operation across 15+ cities — while you earn returns,
              completely hands-free.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#budget" className="sb-card-lift px-6 py-3 rounded-full text-white font-semibold shadow"
                style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
                Start your journey →
              </a>
              <button onClick={() => setLead({ interest: "general" })}
                className="sb-card-lift px-6 py-3 rounded-full font-semibold"
                style={{ border: "1px solid var(--border-strong)", color: "var(--text-base)" }}>
                Talk to an expert
              </button>
              <Link href="/host/me"
                className="sb-card-lift px-6 py-3 rounded-full font-semibold"
                style={{ border: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                My activity
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <span>📈 8–20% p.a. returns</span>
              <span>🛡️ Verified properties</span>
              <span>😌 Fully managed</span>
              <span>📜 Transparent payouts</span>
            </div>
          </div>

          {/* Inventory scale card */}
          <div className="sb-fade-in" style={{ animationDelay: "0.1s" }}>
            <div className="rounded-3xl p-6 sm:p-8"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow-card)" }}>
              <div className="text-xs uppercase tracking-[0.18em] font-semibold mb-4" style={{ color: "var(--accent)" }}>
                Our growing network
              </div>
              <div className="grid grid-cols-2 gap-5">
                {HOST_INVENTORY.map((s) => (
                  <div key={s.label}>
                    <div className="font-display text-3xl sm:text-4xl" style={{ color: "var(--accent)" }}>{s.value}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 text-sm font-medium" style={{ borderTop: "1px solid var(--border-soft)", color: "var(--text-soft)" }}>
                Your money builds a real, managed hospitality portfolio.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Traditional vs StayBid ───────── */}
      <Section title="The old way vs the StayBid way" sub="Why partners switch">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-3xl p-5 sm:p-6" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
            <div className="font-semibold mb-3 flex items-center gap-2" style={{ color: "#a85b4e" }}>😓 Doing it alone</div>
            <div className="space-y-2.5 sb-stagger">
              {TRADITIONAL_CHALLENGES.map((c) => (
                <div key={c.title} className="flex items-start gap-3 text-sm">
                  <span className="text-lg leading-none">{c.icon}</span>
                  <span><b style={{ color: "var(--text-base)" }}>{c.title}</b>
                    <span style={{ color: "var(--text-muted)" }}> — {c.sub}</span></span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl p-5 sm:p-6" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
            <div className="font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--accent)" }}>✨ With StayBid</div>
            <div className="space-y-2.5 sb-stagger">
              {STAYBID_HANDLES.map((c) => (
                <div key={c.title} className="flex items-start gap-3 text-sm">
                  <span className="text-lg leading-none">{c.icon}</span>
                  <span><b style={{ color: "var(--text-base)" }}>{c.title}</b>
                    <span style={{ color: "var(--text-soft)" }}> — {c.sub}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ───────── We handle everything (operations) ───────── */}
      <Section title="We run the entire operation" sub="Fully managed">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sb-stagger">
          {HOST_OPERATIONS.map((o) => (
            <div key={o.title} className="sb-card-lift rounded-2xl p-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="text-2xl">{o.icon}</div>
              <div className="font-semibold mt-2" style={{ color: "var(--text-base)" }}>{o.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{o.sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────── 6-step journey ───────── */}
      <Section title="How it works" sub="6 simple steps">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sb-stagger">
          {HOW_IT_WORKS.map((s) => (
            <div key={s.n} className="sb-card-lift rounded-2xl p-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold mb-3"
                style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>{s.n}</div>
              <div className="font-semibold" style={{ color: "var(--text-base)" }}>{s.title}</div>
              <p className="text-sm mt-1.5" style={{ color: "var(--text-muted)" }}>{s.desc}</p>
              <div className="text-xs mt-3 font-medium px-2.5 py-1 rounded-full inline-block"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>⏱ {s.time}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────── Budget tiers ───────── */}
      <section id="budget" className="max-w-7xl mx-auto px-4 sm:px-6 py-9 scroll-mt-20">
        <div className="text-center mb-6 sb-fade-in">
          <div className="text-xs uppercase tracking-[0.2em] font-semibold" style={{ color: "var(--accent)" }}>Choose your investment</div>
          <h2 className="font-display mt-1" style={{ fontSize: "clamp(1.6rem,4vw,2.3rem)", color: "var(--text-base)" }}>
            Pick a budget tier
          </h2>
          <p className="text-sm mt-2 max-w-xl mx-auto" style={{ color: "var(--text-muted)" }}>
            Start small or go big — every tier is fully managed. Reinvest your returns to grow.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sb-stagger">
          {HOST_BUDGET_TIERS.map((t) => (
            <div key={t.key} className="sb-card-lift relative h-full rounded-3xl p-5 flex flex-col"
              style={{
                background: "var(--bg-card)",
                border: t.popular ? `2px solid ${t.accent}` : "1px solid var(--border-soft)",
                boxShadow: t.popular ? "var(--shadow-card)" : undefined,
              }}>
              {t.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wide px-3 py-1 rounded-full text-white"
                  style={{ background: t.accent }}>Most popular</span>
              )}
              <div className="font-semibold text-lg" style={{ color: "var(--text-base)" }}>{t.name}</div>
              <div className="mt-1 font-display text-3xl" style={{ color: t.accent }}>{t.invest}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{t.investNote}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="text-[11px] font-medium px-2 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🛏 {t.rooms}</span>
                <span className="text-[11px] font-medium px-2 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>📍 {t.cities}</span>
              </div>
              <div className="mt-3 text-sm font-semibold" style={{ color: "var(--text-base)" }}>
                📈 {t.expectedReturn} <span className="font-normal text-xs" style={{ color: "var(--text-muted)" }}>expected return</span>
              </div>
              <ul className="mt-3 space-y-1.5 flex-1">
                {t.perks.map((p) => (
                  <li key={p} className="text-xs flex items-start gap-1.5" style={{ color: "var(--text-soft)" }}>
                    <span style={{ color: t.accent }}>✓</span><span>{p}</span>
                  </li>
                ))}
              </ul>
              <Link href={`/host/build?tier=${t.key}`}
                className="mt-4 w-full block text-center px-4 py-2.5 rounded-full font-semibold text-white text-sm"
                style={{ background: `linear-gradient(135deg,${t.accent},${t.accent}cc)` }}>
                Build with {t.name} →
              </Link>
            </div>
          ))}
        </div>
        <p className="text-center text-xs mt-4" style={{ color: "var(--text-muted)" }}>
          Returns are indicative and depend on city, season & occupancy. StayBid charges a 5–15% platform fee on revenue.
        </p>
      </section>

      {/* ───────── Modules ───────── */}
      <Section title="Powered by the StayBid toolkit" sub="One platform · every aspect">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sb-stagger">
          {HOST_MODULES.map((m) => {
            const Card = (
              <div className="sb-card-lift h-full rounded-2xl p-5 flex flex-col"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="flex items-center justify-between">
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl"
                    style={{ background: `${m.accent}1a` }}>{m.icon}</span>
                  {!m.live && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Coming soon</span>
                  )}
                </div>
                <div className="font-semibold mt-3" style={{ color: "var(--text-base)" }}>{m.title}</div>
                <div className="text-xs font-medium" style={{ color: m.accent }}>{m.tagline}</div>
                <p className="text-sm mt-2 flex-1" style={{ color: "var(--text-muted)" }}>{m.desc}</p>
                <div className="mt-4 text-sm font-semibold inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                  {m.live ? m.cta : "Notify me"} →
                </div>
              </div>
            );
            return m.live
              ? <Link key={m.key} href={m.href} className="block h-full">{Card}</Link>
              : <button key={m.key} onClick={() => setLead({ interest: m.key })} className="block h-full text-left w-full">{Card}</button>;
          })}
        </div>
      </Section>

      {/* ───────── Technology + team ───────── */}
      <Section title="A real team runs your portfolio" sub="Technology + people">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sb-stagger">
          {HOST_TEAM.map((t) => (
            <div key={t.title} className="sb-card-lift rounded-2xl p-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="text-2xl">{t.icon}</div>
              <div className="font-semibold mt-2" style={{ color: "var(--text-base)" }}>{t.title}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{t.sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────── Property types ───────── */}
      <Section title="Across every property type" sub="Whatever the asset, we run it">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sb-stagger">
          {PROPERTY_TYPES.map((p) => (
            <div key={p.name} className="sb-card-lift rounded-2xl p-4 text-center"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="text-3xl">{p.icon}</div>
              <div className="font-semibold text-sm mt-2" style={{ color: "var(--text-base)" }}>{p.name}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{p.sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────── Cities ───────── */}
      <Section title="15+ metro cities & growing" sub="Pan-India footprint">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sb-stagger">
          {HOST_CITIES.map((c) => (
            <div key={c.name} className="sb-card-lift rounded-2xl p-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="font-semibold" style={{ color: "var(--text-base)" }}>📍 {c.name}</div>
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {HOST_TRUST.map((t) => (
            <span key={t} className="text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>✓ {t}</span>
          ))}
        </div>
      </Section>

      {/* ───────── Benefits ───────── */}
      <Section title="Why partners trust StayBid" sub="Partner benefits">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sb-stagger">
          {HOST_BENEFITS.map((b) => (
            <div key={b.title} className="sb-card-lift rounded-2xl p-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="text-2xl">{b.icon}</div>
              <div className="font-semibold mt-2" style={{ color: "var(--text-base)" }}>{b.title}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{b.sub}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───────── Stats band + Final CTA ───────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
        <div className="rounded-3xl p-8 sm:p-12 text-center"
          style={{ background: "linear-gradient(135deg,#1f1a0f,#2b2415)", color: "#f4f6f8" }}>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mb-8">
            {HOST_STATS.map((s) => (
              <div key={s.label}>
                <div className="font-display text-2xl sm:text-3xl" style={{ color: "#c6d0da" }}>{s.value}</div>
                <div className="text-[11px] mt-0.5" style={{ color: "#b4c1cf" }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div className="text-xs uppercase tracking-[0.2em]" style={{ color: "#b4c1cf" }}>Your money, fully managed</div>
          <h2 className="font-display mt-2" style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)" }}>
            Build a hospitality portfolio without the headache
          </h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="#budget" className="sb-card-lift px-7 py-3 rounded-full font-semibold text-[#1f1a0f]"
              style={{ background: "linear-gradient(135deg,#c6d0da,#5f7c98)" }}>Choose your budget</a>
            <button onClick={() => setLead({ interest: "general" })} className="sb-card-lift px-7 py-3 rounded-full font-semibold"
              style={{ border: "1px solid rgba(255,255,255,0.25)", color: "#f4f6f8" }}>Request a callback</button>
          </div>
        </div>
      </section>

      {lead && <LeadModal interest={lead.interest} tier={lead.tier} onClose={() => setLead(null)} />}
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-9">
      <div className="text-center mb-6 sb-fade-in">
        <div className="text-xs uppercase tracking-[0.2em] font-semibold" style={{ color: "var(--accent)" }}>{sub}</div>
        <h2 className="font-display mt-1" style={{ fontSize: "clamp(1.6rem,4vw,2.3rem)", color: "var(--text-base)" }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function LeadModal({ interest, tier, onClose }: { interest: string; tier?: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [msg, setMsg] = useState(tier ? `Interested in the ${tier} tier.` : "");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit() {
    if (!name.trim() || phone.trim().length < 8) { setState("error"); return; }
    setState("sending");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name, phone, city, message: msg, interest, tier }),
      });
      setState(r.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-6"
        style={{ background: "var(--bg-card)", color: "var(--text-base)", boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}>
        {state === "done" ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-display text-2xl">Thank you!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              Our hospitality team will reach out shortly to set up your portfolio.
            </p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="font-display text-2xl">{tier ? `Invest in ${tier}` : "Let's grow your portfolio"}</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
              Share your details — we'll guide you through every step.
            </p>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel"
                className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (optional)"
                className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What can we help with? (optional)"
                rows={2} className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>
            {state === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>Please enter a valid name & phone.</div>}
            <button onClick={submit} disabled={state === "sending"}
              className="w-full mt-4 px-6 py-3 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
              {state === "sending" ? "Sending…" : "Request callback"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
