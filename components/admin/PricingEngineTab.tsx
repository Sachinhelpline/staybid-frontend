"use client";
// v720 — Admin "Pricing Engine" tab. Tunes the DIGITS inside the AI dynamic-
// pricing formula (the 9 demand factors, the multiplier clamp, the OTA undercut
// %, the flash discount %, and an opt-in "cap live at MRP"). The AI formula is
// unchanged — admin only adjusts the numbers it multiplies; the engine still
// runs the full model on top of them. Reads/writes /api/admin/pricing-config.
//
// v731 — MODERN CONTROL-PANEL REDESIGN (presentation only; all state/effects/API
// calls are byte-identical). Full-width (no maxWidth), elevated section cards with
// icon headers, NumField "control cards" in a responsive grid, styled multiplier
// tiles, a segmented mode control, and a sticky glass save bar. Classes in admin.css
// (.pe-*).
import { useEffect, useState, type CSSProperties, type ComponentType } from "react";
import {
  Loader2, RotateCcw, Sliders, TrendingDown, Sparkles, CalendarRange, CalendarDays,
  Gauge, Clock3, PartyPopper, CalendarClock, MapPin, Save,
} from "lucide-react";
import { adminColors as C } from "@/lib/admin/styles";

function hdr() {
  const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
  return { "x-admin-token": t, "Content-Type": "application/json" };
}

const thc: CSSProperties = { padding: "4px 8px", fontWeight: 600, whiteSpace: "nowrap" };
const tdc: CSSProperties = { padding: "6px 8px", whiteSpace: "nowrap", verticalAlign: "top" };

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
  const [preview, setPreview] = useState<any | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadPreview() {
    setPreviewLoading(true);
    try {
      const r = await fetch("/api/admin/pricing-config/optimizer-preview", { headers: hdr(), cache: "no-store" });
      const d = await r.json();
      setPreview(d?.rows ? d : { rows: [], error: d?.error });
    } catch (e: any) { setPreview({ rows: [], error: e?.message || "network" }); }
    finally { setPreviewLoading(false); }
  }

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
    <div className="pe-wrap">
      <div className="pe-intro">
        <span className="pe-intro-ico"><Sliders size={17} strokeWidth={2.2} aria-hidden /></span>
        <div>
          These are the <b style={{ color: C.text }}>numbers inside the AI pricing formula</b>. The engine still runs the full demand model
          (season × day × festival × lead-time × city × occupancy …) — you only tune the digits it multiplies. Changes take effect on the
          next price recalc (~60s). A blank or out-of-range value is rejected on save. Use <b style={{ color: C.text }}>Reset to defaults</b> to restore the built-in values.
        </div>
      </div>

      {/* ── Global price rules ─────────────────────────────────────── */}
      <Section title="Global price rules" icon={Sliders} accent={C.gold}>
        <div className="pe-grid pe-num-grid">
          <NumField label="OTA undercut %" hint="Live price is forced this far below the cheapest competitor" value={cfg.undercutPct} on={(v) => set("undercutPct", v)} def={defaults?.undercutPct} suffix="%" />
          <NumField label="Flash discount %" hint="Flash-deal price = live − this %" value={cfg.flashDiscountPct} on={(v) => set("flashDiscountPct", v)} def={defaults?.flashDiscountPct} suffix="%" />
          <NumField label="Multiplier floor (clamp min)" hint="Lowest the combined multiplier can go" value={cfg.clampMin} on={(v) => set("clampMin", v)} def={defaults?.clampMin} step={0.01} suffix="×" />
          <NumField label="Multiplier ceiling (clamp max)" hint="Highest the combined multiplier can go" value={cfg.clampMax} on={(v) => set("clampMax", v)} def={defaults?.clampMax} step={0.01} suffix="×" />
          <NumField label="Micro-variation ± %" hint="Small hourly jitter band" value={cfg.microAmplitudePct} on={(v) => set("microAmplitudePct", v)} def={defaults?.microAmplitudePct} step={0.1} suffix="%" />
        </div>
        <label className="pe-toggle" htmlFor="capmrp" style={{ marginTop: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={!!cfg.capLiveAtMrp} onChange={(e) => set("capLiveAtMrp", e.target.checked)} id="capmrp" />
          <span style={{ color: C.text, fontSize: 13 }}>
            Cap live price at MRP <span style={{ color: C.textDim }}>— never let the dynamic price exceed the rack/MRP rate</span>
          </span>
        </label>
      </Section>

      {/* ── Customer bid floor (Gap-1) ─────────────────────────────── */}
      <Section title="Customer bid floor" icon={TrendingDown} accent={C.blue} hint="How low a guest can auto-WIN a room in the bid arena. 'Static' = today (the hotel's set floor, unchanged). 'Dynamic' raises the win-floor with live demand in peak season, never below the hotel's floor.">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ color: C.textDim, fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Mode</span>
          <div className="pe-seg">
            {(["static", "dynamic"] as const).map((m) => (
              <button key={m} className={cfg.custFloorMode === m ? "on" : ""} onClick={() => set("custFloorMode", m)}>
                {m === "static" ? "Static (today)" : "Dynamic (season-linked)"}
              </button>
            ))}
          </div>
        </div>
        <div className="pe-grid pe-num-grid">
          <NumField label="Max win-discount below live %" hint="Dynamic only — win-floor = live price − this %" value={cfg.custFloorMaxWinDiscountPct} on={(v) => set("custFloorMaxWinDiscountPct", v)} def={defaults?.custFloorMaxWinDiscountPct} suffix="%" />
          <NumField label="Floor min fraction" hint="Dynamic only — floor never below the hotel's floorPrice × this (1.0 = never below the hotel's floor)" value={cfg.custFloorMinFraction} on={(v) => set("custFloorMinFraction", v)} def={defaults?.custFloorMinFraction} step={0.05} suffix="×" />
        </div>
        {cfg.custFloorMode === "dynamic" && (
          <div style={{ color: C.amber, fontSize: 11.5, marginTop: 10 }}>
            ⚠ Dynamic mode changes which guest bids auto-win. Applies on the next price recalc (~60s).
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.border}`, margin: "14px 0 12px" }} />
        <div className="pe-grid pe-num-grid">
          <NumField label="Below-floor offer ratio" hint="1.0 = OFF (guest can't bid below floor). Set below 1.0 (e.g. 0.85) to let a guest OFFER down to floor × this — forwarded to the owner PENDING, never auto-accepted." value={cfg.custBelowFloorRatio} on={(v) => set("custBelowFloorRatio", v)} def={defaults?.custBelowFloorRatio} step={0.05} suffix="×" />
        </div>
        {Number(cfg.custBelowFloorRatio) < 1 && (
          <div style={{ color: C.amber, fontSize: 11.5, marginTop: 10 }}>
            ⚠ Guests can now send offers below the floor (down to floor × {cfg.custBelowFloorRatio}). These are always owner-reviewed — never auto-confirmed.
          </div>
        )}
      </Section>

      {/* ── Yield optimizer (Gap-2) ────────────────────────────────── */}
      <Section title="AI yield optimizer" icon={Sparkles} accent={C.purple} hint="An expected-revenue layer on top of the demand model: it nudges the live price (guarded ±12%, never below floor, never above the OTA-undercut cap) to the price that maximises price × probability-of-booking. OFF = the proven rule price. Preview it before enabling.">
        <label className="pe-toggle" htmlFor="yieldopt" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={!!cfg.yieldOptimizerEnabled} onChange={(e) => set("yieldOptimizerEnabled", e.target.checked)} id="yieldopt" />
          <span style={{ color: C.text, fontSize: 13 }}>
            Enable yield optimizer <span style={{ color: C.textDim }}>— applies the expected-revenue price on the next recalc</span>
          </span>
        </label>
        <button onClick={loadPreview} disabled={previewLoading} className="pe-btn-ghost" style={{ marginTop: 12 }}>
          {previewLoading ? <><Loader2 size={13} style={{ animation: "sb-halo-spin 0.9s linear infinite" }} aria-hidden />Computing…</> : "Preview effect (no change)"}
        </button>
        {preview && (
          preview.error ? <div style={{ color: C.red, fontSize: 12, marginTop: 10 }}>{preview.error}</div> :
          preview.rows?.length ? (
            <div style={{ overflowX: "auto", marginTop: 12, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ color: C.textDim, fontSize: 11, marginBottom: 8 }}>Sample of {preview.rows.length} rooms for {preview.date} · rule → optimized (Δ%) · expected-revenue lift. Low = near-empty date, High = nearly sold-out.</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.textDim, textAlign: "left" }}>
                    <th style={thc}>Room</th><th style={thc}>Floor</th>
                    <th style={thc}>Low occ: rule→opt (Δ)</th><th style={thc}>ER lift</th>
                    <th style={thc}>High occ: rule→opt (Δ)</th><th style={thc}>ER lift</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: any, i: number) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={tdc}><span style={{ color: C.text }}>{String(row.room).slice(0, 22)}</span><br /><span style={{ color: C.textDim, fontSize: 10 }}>{String(row.hotel).slice(0, 24)}</span></td>
                      <td style={tdc}>₹{row.floor}</td>
                      <td style={tdc}>₹{row.low.rule} → <b style={{ color: row.low.deltaPct === 0 ? C.textDim : C.gold }}>₹{row.low.optimized}</b> ({row.low.deltaPct > 0 ? "+" : ""}{row.low.deltaPct}%)</td>
                      <td style={{ ...tdc, color: row.low.erLiftPct > 0 ? C.green : C.textDim }}>{row.low.erLiftPct > 0 ? "+" : ""}{row.low.erLiftPct}%</td>
                      <td style={tdc}>₹{row.high.rule} → <b style={{ color: row.high.deltaPct === 0 ? C.textDim : C.gold }}>₹{row.high.optimized}</b> ({row.high.deltaPct > 0 ? "+" : ""}{row.high.deltaPct}%)</td>
                      <td style={{ ...tdc, color: row.high.erLiftPct > 0 ? C.green : C.textDim }}>{row.high.erLiftPct > 0 ? "+" : ""}{row.high.erLiftPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div style={{ color: C.textDim, fontSize: 12, marginTop: 10 }}>No priced rooms to sample.</div>
        )}
      </Section>

      {/* ── Seasonal curve ─────────────────────────────────────────── */}
      <Section title="Season multiplier (national curve · per month)" icon={CalendarRange} accent={C.green} hint="Cities with their own real curve (Goa, Leh, …) are unaffected.">
        <Grid labels={MONTHS} arr={cfg.seasonMults} def={defaults?.seasonMults} on={(i, v) => setArr("seasonMults", i, v)} />
      </Section>

      {/* ── Day of week ────────────────────────────────────────────── */}
      <Section title="Day-of-week multiplier" icon={CalendarDays} accent={C.blue}>
        <Grid labels={DOW} arr={cfg.dowMults} def={defaults?.dowMults} on={(i, v) => setArr("dowMults", i, v)} />
      </Section>

      {/* ── Occupancy (yield) ──────────────────────────────────────── */}
      <Section title="Live occupancy (yield) multiplier" icon={Gauge} accent={C.gold}>
        <Grid labels={OCC_LABELS} arr={cfg.occupancyMults} def={defaults?.occupancyMults} on={(i, v) => setArr("occupancyMults", i, v)} />
      </Section>

      {/* ── Lead time ──────────────────────────────────────────────── */}
      <Section title="Lead-time (how far ahead) multiplier" icon={Clock3} accent={C.purple}>
        <Grid labels={LEAD_LABELS} arr={cfg.leadMults} def={defaults?.leadMults} on={(i, v) => setArr("leadMults", i, v)} />
      </Section>

      {/* ── Festivals / events ─────────────────────────────────────── */}
      <Section title="Festival / event multiplier" icon={PartyPopper} accent={C.amber}>
        <Grid labels={eventNames} arr={cfg.eventMults} def={defaults?.eventMults} on={(i, v) => setArr("eventMults", i, v)} />
      </Section>

      {/* ── Calendar windows (single values) ───────────────────────── */}
      <Section title="Calendar windows" icon={CalendarClock} accent={C.green}>
        <div className="pe-grid pe-num-grid">
          <NumField label="Monsoon (15 Jul–15 Sep)" value={cfg.monsoonMult} on={(v) => set("monsoonMult", v)} def={defaults?.monsoonMult} step={0.01} suffix="×" />
          <NumField label="School vacation" value={cfg.schoolMult} on={(v) => set("schoolMult", v)} def={defaults?.schoolMult} step={0.01} suffix="×" />
          <NumField label="Long weekend" value={cfg.longWeekendMult} on={(v) => set("longWeekendMult", v)} def={defaults?.longWeekendMult} step={0.01} suffix="×" />
          <NumField label="Isolated holiday" value={cfg.longWeekendHolidayMult} on={(v) => set("longWeekendHolidayMult", v)} def={defaults?.longWeekendHolidayMult} step={0.01} suffix="×" />
        </div>
      </Section>

      {/* ── City baseline demand ───────────────────────────────────── */}
      <Section title="City baseline demand" icon={MapPin} accent={C.blue} hint="Baseline demand weight per city.">
        <div className="pe-grid pe-cell-grid">
          {Object.keys(cfg.cityDemand || {}).sort().map((city) => (
            <label key={city} className="pe-cell">
              <span className="pe-cell-label" title={city}>{city}</span>
              <input type="number" step={0.01} value={cfg.cityDemand[city]} onChange={(e) => setCity(city, e.target.value)} className="pe-cell-input" />
            </label>
          ))}
        </div>
      </Section>

      <div className="pe-savebar">
        <button onClick={save} disabled={saving} className="pe-btn-primary">
          {saving ? <><Loader2 size={13} style={{ animation: "sb-halo-spin 0.9s linear infinite" }} aria-hidden />Saving…</> : <><Save size={14} strokeWidth={2.3} aria-hidden />Save pricing engine</>}
        </button>
        <button onClick={resetToDefaults} disabled={saving} className="pe-btn-ghost">
          <RotateCcw size={13} aria-hidden /> Reset to defaults
        </button>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 600, color: msg.startsWith("✗") ? C.red : C.green }}>{msg}</span>}
      </div>
    </div>
  );
}

function Section({ title, hint, icon: Icon, accent, children }: { title: string; hint?: string; icon: ComponentType<any>; accent: string; children: any }) {
  return (
    <div className="pe-card">
      <div className="pe-card-head">
        <span className="pe-ico" style={{ background: accent + "1e", color: accent }}><Icon size={17} strokeWidth={2.2} aria-hidden /></span>
        <div>
          <div className="pe-title">{title}</div>
          {hint && <div className="pe-hint">{hint}</div>}
        </div>
      </div>
      <div className="pe-body">{children}</div>
    </div>
  );
}

function NumField({ label, hint, value, on, def, step = 0.5, suffix }: { label: string; hint?: string; value: any; on: (v: any) => void; def?: any; step?: number; suffix?: string }) {
  const changed = def !== undefined && Number(value) !== Number(def);
  return (
    <div className="pe-field">
      <div className="pe-field-label">
        <div className="pe-field-name">{label}</div>
        {hint && <div className="pe-field-hint">{hint}</div>}
      </div>
      <div className="pe-input-wrap">
        <input type="number" step={step} value={value ?? ""} onChange={(e) => on(e.target.value === "" ? "" : Number(e.target.value))} className={`pe-input${changed ? " pe-changed" : ""}`} />
        {suffix && <span className="pe-suffix">{suffix}</span>}
      </div>
      {def !== undefined && (
        <span className={`pe-def${changed ? " pe-changed-def" : ""}`}>def {def}</span>
      )}
    </div>
  );
}

function Grid({ labels, arr, def, on }: { labels: string[]; arr: any[]; def?: any[]; on: (i: number, v: string) => void }) {
  return (
    <div className="pe-grid pe-cell-grid">
      {labels.map((lab, i) => {
        const changed = def && Number(arr?.[i]) !== Number(def[i]);
        return (
          <label key={i} className={`pe-cell${changed ? " pe-changed" : ""}`}>
            <span className="pe-cell-label" title={lab}>{lab}</span>
            <input type="number" step={0.01} value={arr?.[i] ?? ""} onChange={(e) => on(i, e.target.value)} className="pe-cell-input" />
          </label>
        );
      })}
    </div>
  );
}
