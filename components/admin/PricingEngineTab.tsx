"use client";
// v720 — Admin "Pricing Engine" tab. Tunes the DIGITS inside the AI dynamic-
// pricing formula (the 9 demand factors, the multiplier clamp, the OTA undercut
// %, the flash discount %, and an opt-in "cap live at MRP"). The AI formula is
// unchanged — admin only adjusts the numbers it multiplies; the engine still
// runs the full model on top of them. Reads/writes /api/admin/pricing-config.
import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { adminColors as C, btnGold, btnGhost, inputStyle } from "@/lib/admin/styles";

function hdr() {
  const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
  return { "x-admin-token": t, "Content-Type": "application/json" };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OCC_LABELS = ["< 30% full", "30–50%", "50–70%", "70–85%", "> 85% full"];
const LEAD_LABELS = ["Same-day", "≤ 2 days", "≤ 7 days", "≤ 14 days", "≤ 30 days", "> 30 days"];

type Cfg = any;

export default function PricingEngineTab() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [defaults, setDefaults] = useState<Cfg | null>(null);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/admin/pricing-config", { headers: hdr(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.config) { setCfg(d.config); setDefaults(d.defaults); setEventNames(d.eventNames || []); }
        else setMsg(d?.error || "Failed to load");
      })
      .catch((e) => setMsg(e?.message || "network"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function set(key: string, val: any) { setCfg((c: Cfg) => ({ ...c, [key]: val })); }
  function setArr(key: string, i: number, val: string) {
    setCfg((c: Cfg) => {
      const arr = Array.isArray(c[key]) ? c[key].slice() : [];
      arr[i] = val === "" ? "" : Number(val);
      return { ...c, [key]: arr };
    });
  }
  function setCity(city: string, val: string) {
    setCfg((c: Cfg) => ({ ...c, cityDemand: { ...(c.cityDemand || {}), [city]: val === "" ? "" : Number(val) } }));
  }

  async function save() {
    if (!cfg) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/admin/pricing-config", { method: "POST", headers: hdr(), body: JSON.stringify(cfg) });
      const d = await r.json();
      if (r.ok) { setCfg(d.config); setMsg("✓ Saved — new prices apply on the next recalc (within ~60s)."); }
      else setMsg(`✗ ${d.error || "Save failed"}`);
    } catch (e: any) { setMsg(`✗ ${e?.message || "network"}`); }
    finally { setSaving(false); setTimeout(() => setMsg(""), 6000); }
  }

  function resetToDefaults() {
    if (!defaults) return;
    if (!confirm("Reset every pricing knob back to the built-in defaults? (Saves immediately.)")) return;
    setCfg({ ...defaults });
    // Persist right away.
    setSaving(true); setMsg("");
    fetch("/api/admin/pricing-config", { method: "POST", headers: hdr(), body: JSON.stringify(defaults) })
      .then((r) => r.json())
      .then((d) => { if (d?.config) { setCfg(d.config); setMsg("✓ Reset to defaults."); } else setMsg(`✗ ${d?.error || "Failed"}`); })
      .catch((e) => setMsg(`✗ ${e?.message || "network"}`))
      .finally(() => { setSaving(false); setTimeout(() => setMsg(""), 6000); });
  }

  if (loading) return <div style={{ color: C.textDim, padding: 24 }}><Loader2 size={16} style={{ animation: "sb-halo-spin 0.9s linear infinite", marginRight: 8, verticalAlign: "middle" }} />Loading engine config…</div>;
  if (!cfg) return <div style={{ color: C.red, padding: 24 }}>{msg || "No config"}</div>;

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ background: "rgba(140,160,182,0.08)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: 18, color: C.textDim, fontSize: 12.5, lineHeight: 1.6 }}>
        These are the <b style={{ color: C.text }}>numbers inside the AI pricing formula</b>. The engine still runs the full demand model
        (season × day × festival × lead-time × city × occupancy …) — you only tune the digits it multiplies. Changes take effect on the
        next price recalc (~60s). A blank or out-of-range value is rejected on save. Use <b style={{ color: C.text }}>Reset to defaults</b> to restore the built-in values.
      </div>

      {/* ── Global price rules ─────────────────────────────────────── */}
      <Section title="Global price rules">
        <NumField label="OTA undercut %" hint="Live price is forced this far below the cheapest competitor" value={cfg.undercutPct} on={(v) => set("undercutPct", v)} def={defaults?.undercutPct} />
        <NumField label="Flash discount %" hint="Flash-deal price = live − this %" value={cfg.flashDiscountPct} on={(v) => set("flashDiscountPct", v)} def={defaults?.flashDiscountPct} />
        <NumField label="Multiplier floor (clamp min)" hint="Lowest the combined multiplier can go" value={cfg.clampMin} on={(v) => set("clampMin", v)} def={defaults?.clampMin} step={0.01} />
        <NumField label="Multiplier ceiling (clamp max)" hint="Highest the combined multiplier can go" value={cfg.clampMax} on={(v) => set("clampMax", v)} def={defaults?.clampMax} step={0.01} />
        <NumField label="Micro-variation ± %" hint="Small hourly jitter band" value={cfg.microAmplitudePct} on={(v) => set("microAmplitudePct", v)} def={defaults?.microAmplitudePct} step={0.1} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
          <input type="checkbox" checked={!!cfg.capLiveAtMrp} onChange={(e) => set("capLiveAtMrp", e.target.checked)} id="capmrp" style={{ width: 16, height: 16 }} />
          <label htmlFor="capmrp" style={{ color: C.text, fontSize: 13, cursor: "pointer" }}>
            Cap live price at MRP <span style={{ color: C.textDim }}>— never let the dynamic price exceed the rack/MRP rate</span>
          </label>
        </div>
      </Section>

      {/* ── Customer bid floor (Gap-1) ─────────────────────────────── */}
      <Section title="Customer bid floor" hint="How low a guest can auto-WIN a room in the bid arena. 'Static' = today (the hotel's set floor, unchanged). 'Dynamic' raises the win-floor with live demand in peak season, never below the hotel's floor.">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", flexWrap: "wrap" }}>
          <span style={{ color: C.text, fontSize: 13, minWidth: 90 }}>Mode</span>
          {(["static", "dynamic"] as const).map((m) => (
            <button key={m} onClick={() => set("custFloorMode", m)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${cfg.custFloorMode === m ? C.gold : C.border}`,
              background: cfg.custFloorMode === m ? "rgba(140,160,182,0.16)" : "transparent",
              color: cfg.custFloorMode === m ? C.gold : C.textDim,
            }}>{m === "static" ? "Static (today)" : "Dynamic (season-linked)"}</button>
          ))}
        </div>
        <NumField label="Max win-discount below live %" hint="Dynamic only — win-floor = live price − this %" value={cfg.custFloorMaxWinDiscountPct} on={(v) => set("custFloorMaxWinDiscountPct", v)} def={defaults?.custFloorMaxWinDiscountPct} />
        <NumField label="Floor min fraction" hint="Dynamic only — floor never below the hotel's floorPrice × this (1.0 = never below the hotel's floor)" value={cfg.custFloorMinFraction} on={(v) => set("custFloorMinFraction", v)} def={defaults?.custFloorMinFraction} step={0.05} />
        {cfg.custFloorMode === "dynamic" && (
          <div style={{ color: C.amber, fontSize: 11.5, marginTop: 6 }}>
            ⚠ Dynamic mode changes which guest bids auto-win. Applies on the next price recalc (~60s).
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.border}`, margin: "12px 0 4px" }} />
        <NumField label="Below-floor offer ratio" hint="1.0 = OFF (guest can't bid below floor). Set below 1.0 (e.g. 0.85) to let a guest OFFER down to floor × this — forwarded to the owner PENDING, never auto-accepted." value={cfg.custBelowFloorRatio} on={(v) => set("custBelowFloorRatio", v)} def={defaults?.custBelowFloorRatio} step={0.05} />
        {Number(cfg.custBelowFloorRatio) < 1 && (
          <div style={{ color: C.amber, fontSize: 11.5, marginTop: 6 }}>
            ⚠ Guests can now send offers below the floor (down to floor × {cfg.custBelowFloorRatio}). These are always owner-reviewed — never auto-confirmed.
          </div>
        )}
      </Section>

      {/* ── Seasonal curve ─────────────────────────────────────────── */}
      <Section title="Season multiplier (national curve · per month)" hint="Cities with their own real curve (Goa, Leh, …) are unaffected.">
        <Grid labels={MONTHS} arr={cfg.seasonMults} def={defaults?.seasonMults} on={(i, v) => setArr("seasonMults", i, v)} />
      </Section>

      {/* ── Day of week ────────────────────────────────────────────── */}
      <Section title="Day-of-week multiplier">
        <Grid labels={DOW} arr={cfg.dowMults} def={defaults?.dowMults} on={(i, v) => setArr("dowMults", i, v)} />
      </Section>

      {/* ── Occupancy (yield) ──────────────────────────────────────── */}
      <Section title="Live occupancy (yield) multiplier">
        <Grid labels={OCC_LABELS} arr={cfg.occupancyMults} def={defaults?.occupancyMults} on={(i, v) => setArr("occupancyMults", i, v)} />
      </Section>

      {/* ── Lead time ──────────────────────────────────────────────── */}
      <Section title="Lead-time (how far ahead) multiplier">
        <Grid labels={LEAD_LABELS} arr={cfg.leadMults} def={defaults?.leadMults} on={(i, v) => setArr("leadMults", i, v)} />
      </Section>

      {/* ── Festivals / events ─────────────────────────────────────── */}
      <Section title="Festival / event multiplier">
        <Grid labels={eventNames} arr={cfg.eventMults} def={defaults?.eventMults} on={(i, v) => setArr("eventMults", i, v)} />
      </Section>

      {/* ── Calendar windows (single values) ───────────────────────── */}
      <Section title="Calendar windows">
        <NumField label="Monsoon (15 Jul–15 Sep)" value={cfg.monsoonMult} on={(v) => set("monsoonMult", v)} def={defaults?.monsoonMult} step={0.01} />
        <NumField label="School vacation" value={cfg.schoolMult} on={(v) => set("schoolMult", v)} def={defaults?.schoolMult} step={0.01} />
        <NumField label="Long weekend" value={cfg.longWeekendMult} on={(v) => set("longWeekendMult", v)} def={defaults?.longWeekendMult} step={0.01} />
        <NumField label="Isolated holiday" value={cfg.longWeekendHolidayMult} on={(v) => set("longWeekendHolidayMult", v)} def={defaults?.longWeekendHolidayMult} step={0.01} />
      </Section>

      {/* ── City baseline demand ───────────────────────────────────── */}
      <Section title="City baseline demand" hint="Baseline demand weight per city.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {Object.keys(cfg.cityDemand || {}).sort().map((city) => (
            <label key={city} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ color: C.textDim, fontSize: 11 }}>{city}</span>
              <input type="number" step={0.01} value={cfg.cityDemand[city]} onChange={(e) => setCity(city, e.target.value)} style={{ ...inputStyle, width: "100%" }} />
            </label>
          ))}
        </div>
      </Section>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <button onClick={save} disabled={saving} style={{ ...btnGold, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save pricing engine"}
        </button>
        <button onClick={resetToDefaults} disabled={saving} style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RotateCcw size={13} aria-hidden /> Reset to defaults
        </button>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.startsWith("✗") ? C.red : C.green }}>{msg}</span>}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: any }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ color: C.text, fontSize: 13.5, fontWeight: 700, marginBottom: hint ? 2 : 12, fontFamily: "Syne, sans-serif" }}>{title}</div>
      {hint && <div style={{ color: C.textDim, fontSize: 11.5, marginBottom: 12 }}>{hint}</div>}
      {children}
    </div>
  );
}

function NumField({ label, hint, value, on, def, step = 0.5 }: { label: string; hint?: string; value: any; on: (v: any) => void; def?: any; step?: number }) {
  const changed = def !== undefined && Number(value) !== Number(def);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", flexWrap: "wrap" }}>
      <div style={{ minWidth: 220, flex: "1 1 220px" }}>
        <div style={{ color: C.text, fontSize: 13 }}>{label}</div>
        {hint && <div style={{ color: C.textDim, fontSize: 11 }}>{hint}</div>}
      </div>
      <input type="number" step={step} value={value ?? ""} onChange={(e) => on(e.target.value === "" ? "" : Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
      {def !== undefined && (
        <span style={{ fontSize: 11, color: changed ? C.amber : C.textDim, minWidth: 92 }}>default {def}</span>
      )}
    </div>
  );
}

function Grid({ labels, arr, def, on }: { labels: string[]; arr: any[]; def?: any[]; on: (i: number, v: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
      {labels.map((lab, i) => {
        const changed = def && Number(arr?.[i]) !== Number(def[i]);
        return (
          <label key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ color: C.textDim, fontSize: 11 }}>{lab}</span>
            <input type="number" step={0.01} value={arr?.[i] ?? ""} onChange={(e) => on(i, e.target.value)} style={{ ...inputStyle, width: "100%", borderColor: changed ? C.amber + "88" : undefined }} />
          </label>
        );
      })}
    </div>
  );
}
