"use client";
// v280 — Admin → Host Wizard Pricing. Every number the Portfolio Configurator
// (/host/build) charges is editable here and takes effect immediately (the
// server resolver caches 60s). Dark-luxury inline styles (matches /admin/host).
// The key SET (tiers / designs / addons / modes) is fixed; only numbers change.
// Auth via x-admin-token.

import { useEffect, useState } from "react";
import Link from "next/link";

type AnyConfig = any;

const BG = "#07080C", SURF = "#0F1117", CARD = "#151820", BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D4AF37", TXT = "#E8EAF0", MUT = "#8A8FA8", GREEN = "#2ECC71";

export default function HostPricingPage() {
  const [cfg, setCfg] = useState<AnyConfig | null>(null);
  const [defaults, setDefaults] = useState<AnyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  function authHeaders(json = false) {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    const id = typeof window !== "undefined" ? (() => { try { return JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch { return ""; } })() : "";
    return { ...(json ? { "Content-Type": "application/json" } : {}), "x-admin-token": tok, "x-admin-id": id };
  }

  useEffect(() => {
    fetch("/api/admin/host/pricing", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) { setCfg(structuredClone(d.config)); setDefaults(d.defaults); }
        else setMsg({ t: "err", m: d?.error || "Failed to load" });
      })
      .catch(() => setMsg({ t: "err", m: "Failed to load" }))
      .finally(() => setLoading(false));
  }, []);

  // Set a nested numeric value immutably: path is a list of keys/indices.
  function setNum(path: (string | number)[], raw: string) {
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v)) return;
    setCfg((prev: AnyConfig) => {
      const next = structuredClone(prev);
      let node: any = next;
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
      node[path[path.length - 1]] = v;
      return next;
    });
  }

  async function save() {
    if (!cfg) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/host/pricing", {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({ config: cfg }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.ok) { setCfg(structuredClone(d.config)); setMsg({ t: "ok", m: "Saved · live on the wizard within 60s" }); }
      else setMsg({ t: "err", m: d?.error || "Save failed" });
    } catch { setMsg({ t: "err", m: "Save failed" }); }
    finally { setSaving(false); }
  }

  function resetToDefaults() {
    if (defaults) { setCfg(structuredClone(defaults)); setMsg({ t: "ok", m: "Loaded defaults — press Save to apply" }); }
  }

  if (loading) return <Shell><p style={{ color: MUT }}>Loading…</p></Shell>;
  if (!cfg) return <Shell><p style={{ color: "#FF4757" }}>{msg?.m || "Could not load config."}</p></Shell>;

  const tierKeys = Object.keys(cfg.tiers || {});
  const modeKeys = Object.keys(cfg.paymentModes || {});

  return (
    <Shell>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <Link href="/admin/host" style={{ color: MUT, fontSize: 13, textDecoration: "none" }}>← StayBid for Hosts</Link>
          <h1 style={{ color: TXT, fontSize: 24, fontWeight: 700, margin: "6px 0 2px" }}>Host Wizard Pricing</h1>
          <p style={{ color: MUT, fontSize: 13, margin: 0 }}>Edit every number the Portfolio Configurator charges. Changes go live within ~60s. Item names/keys are fixed — only the numbers.</p>
        </div>
        <button onClick={resetToDefaults} style={btn(false)}>Reset to defaults</button>
      </div>

      {/* ── Tiers ── */}
      <Section title="Budget tiers" sub="Room/city limits, per-room setup + monthly management, platform commission %.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
          {tierKeys.map((k) => {
            const t = cfg.tiers[k];
            return (
              <div key={k} style={cardStyle}>
                <div style={{ color: t.accent || GOLD, fontWeight: 700, marginBottom: 8 }}>{t.name} <span style={{ color: MUT, fontWeight: 400, fontSize: 12 }}>({k})</span></div>
                <NumRow label="Min rooms" value={t.minRooms} onChange={(v) => setNum(["tiers", k, "minRooms"], v)} />
                <NumRow label="Max rooms" value={t.maxRooms} onChange={(v) => setNum(["tiers", k, "maxRooms"], v)} hint="999 = unlimited" />
                <NumRow label="Max cities" value={t.maxCities} onChange={(v) => setNum(["tiers", k, "maxCities"], v)} hint="999 = unlimited" />
                <NumRow label="Setup / room (₹)" value={t.setupPerRoom} onChange={(v) => setNum(["tiers", k, "setupPerRoom"], v)} />
                <NumRow label="Mgmt / room / mo (₹)" value={t.mgmtPerRoomMonthly} onChange={(v) => setNum(["tiers", k, "mgmtPerRoomMonthly"], v)} />
                <NumRow label="Commission (%)" value={t.commissionPct} onChange={(v) => setNum(["tiers", k, "commissionPct"], v)} />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── City activation ── */}
      <Section title="City activation fee" sub="One-time per-city sourcing + local ops setup.">
        <div style={{ ...cardStyle, maxWidth: 300 }}>
          <NumRow label="₹ per city" value={cfg.cityActivationFee} onChange={(v) => setNum(["cityActivationFee"], v)} />
        </div>
      </Section>

      {/* ── Design packages ── */}
      <Section title="Design packages" sub="One-time design cost per room for each finish level.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {(cfg.designPackages || []).map((d: any, i: number) => (
            <div key={d.key} style={cardStyle}>
              <div style={{ color: TXT, fontWeight: 600, marginBottom: 8 }}>{d.icon} {d.name} <span style={{ color: MUT, fontWeight: 400, fontSize: 12 }}>({d.key})</span></div>
              <NumRow label="₹ / room" value={d.perRoom} onChange={(v) => setNum(["designPackages", i, "perRoom"], v)} hint="0 = included" />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Add-ons ── */}
      <Section title="Add-on services" sub="Rental = monthly · EMI = principal + tenure/down · One-off = charged once.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
          {(cfg.addons || []).map((a: any, i: number) => (
            <div key={a.key} style={cardStyle}>
              <div style={{ color: TXT, fontWeight: 600, marginBottom: 2 }}>{a.icon} {a.name}</div>
              <div style={{ color: MUT, fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>{a.billing}</div>
              <NumRow label={a.billing === "rental" ? "₹ / month" : a.billing === "emi" ? "Principal (₹)" : "₹ one-time"} value={a.amount} onChange={(v) => setNum(["addons", i, "amount"], v)} />
              {a.billing === "emi" && (
                <>
                  <NumRow label="EMI tenure (months)" value={a.emiTenureMonths ?? 6} onChange={(v) => setNum(["addons", i, "emiTenureMonths"], v)} />
                  <NumRow label="Down payment (₹)" value={a.emiDownPayment ?? 0} onChange={(v) => setNum(["addons", i, "emiDownPayment"], v)} />
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ── Payment modes ── */}
      <Section title="Payment modes" sub="Period length, recurring discount, and refundable-security multiplier per cycle.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {modeKeys.map((k) => {
            const m = cfg.paymentModes[k];
            return (
              <div key={k} style={cardStyle}>
                <div style={{ color: TXT, fontWeight: 600, marginBottom: 8 }}>{m.name} <span style={{ color: MUT, fontWeight: 400, fontSize: 12 }}>({k})</span></div>
                <NumRow label="Period (months)" value={m.periodMonths} onChange={(v) => setNum(["paymentModes", k, "periodMonths"], v)} />
                <NumRow label="Recurring discount (0–0.9)" value={m.recurringDiscount} step="0.01" onChange={(v) => setNum(["paymentModes", k, "recurringDiscount"], v)} hint={`${Math.round((m.recurringDiscount || 0) * 100)}% off`} />
                <NumRow label="Security (× monthly)" value={m.securityMonths} step="0.5" onChange={(v) => setNum(["paymentModes", k, "securityMonths"], v)} />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Sticky save bar ── */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 24, padding: "14px 0", background: `linear-gradient(to top, ${BG}, ${BG}ee 70%, transparent)`, display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={save} disabled={saving} style={btn(true)}>{saving ? "Saving…" : "Save pricing"}</button>
        {msg && <span style={{ color: msg.t === "ok" ? GREEN : "#FF4757", fontSize: 13 }}>{msg.m}</span>}
      </div>
    </Shell>
  );
}

/* ── bits ── */
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: "100vh", padding: "24px 20px 60px" }}><div style={{ maxWidth: 1100, margin: "0 auto" }}>{children}</div></div>;
}
function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ color: TXT, fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ color: MUT, fontSize: 12, margin: "2px 0 14px" }}>{sub}</div>
      {children}
    </div>
  );
}
function NumRow({ label, value, onChange, hint, step }: { label: string; value: number; onChange: (v: string) => void; hint?: string; step?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "flex", justifyContent: "space-between", color: MUT, fontSize: 11, marginBottom: 3 }}>
        <span>{label}</span>{hint && <span style={{ color: "rgba(212,175,55,0.7)" }}>{hint}</span>}
      </span>
      <input type="number" value={value} step={step || "1"} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, color: TXT, padding: "8px 10px", fontSize: 14, outline: "none" }} />
    </label>
  );
}
const cardStyle: React.CSSProperties = { background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 14 };
function btn(primary: boolean): React.CSSProperties {
  return {
    padding: "10px 20px", borderRadius: 999, fontWeight: 700, fontSize: 14, cursor: "pointer",
    border: primary ? "none" : `1px solid ${BORDER}`,
    background: primary ? GOLD : "transparent", color: primary ? "#1a1400" : TXT,
  };
}
