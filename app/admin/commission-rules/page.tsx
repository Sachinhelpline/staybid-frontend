"use client";
// Admin → Commission Rules (v95)
// ─────────────────────────────────────────────────────────────────────────
// Edit the platform-default slabs/loyalty bonuses AND set per-creator
// overrides. A creator override beats the global default for any future
// booking attributed to that creator (existing commissions in
// influencer_commissions are NOT rewritten — the metadata snapshot on
// bid_attributions preserves the rate used at write time).
// ─────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import type { CommissionRule, Slab, LoyaltyBonus } from "@/lib/commission";

type Creator = { id: string; userId: string; displayName: string; phone: string | null };

const DEFAULT_SLABS: Slab[] = [
  { minBookings: 1,   maxBookings: 25,  pct: 5  },
  { minBookings: 26,  maxBookings: 50,  pct: 7  },
  { minBookings: 51,  maxBookings: 100, pct: 10 },
  { minBookings: 101, maxBookings: 300, pct: 12 },
];
const DEFAULT_BONUSES: LoyaltyBonus[] = [
  { months: 3, bonusPct: 1 },
  { months: 6, bonusPct: 2 },
];

export default function AdminCommissionRules() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [okMsg, setOkMsg]       = useState("");

  const [globalRule, setGlobalRule] = useState<CommissionRule | null>(null);
  const [overrides, setOverrides]   = useState<CommissionRule[]>([]);
  const [creators, setCreators]     = useState<Creator[]>([]);

  const [editing, setEditing] = useState<null | { kind: "global" } | { kind: "creator"; creatorId: string }>(null);
  const [draftSlabs, setDraftSlabs]     = useState<Slab[]>(DEFAULT_SLABS);
  const [draftBonuses, setDraftBonuses] = useState<LoyaltyBonus[]>(DEFAULT_BONUSES);
  const [draftNote, setDraftNote]       = useState("");

  function load() {
    setLoading(true); setErr("");
    fetch("/api/admin/commission-rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) { setErr(d.error); return; }
        setGlobalRule(d.global);
        setOverrides(d.overrides || []);
        setCreators(d.creators || []);
      })
      .catch((e) => setErr(e?.message || "fetch failed"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function openEditor(target: { kind: "global" } | { kind: "creator"; creatorId: string }) {
    setEditing(target);
    setOkMsg("");
    if (target.kind === "global") {
      setDraftSlabs(globalRule?.slabs?.length ? globalRule.slabs : DEFAULT_SLABS);
      setDraftBonuses(globalRule?.loyaltyBonuses?.length ? globalRule.loyaltyBonuses : DEFAULT_BONUSES);
      setDraftNote(globalRule?.note || "");
    } else {
      const ov = overrides.find(o => o.creator_id === target.creatorId);
      setDraftSlabs(ov?.slabs?.length ? ov.slabs : (globalRule?.slabs || DEFAULT_SLABS));
      setDraftBonuses(ov?.loyaltyBonuses?.length ? ov.loyaltyBonuses : (globalRule?.loyaltyBonuses || DEFAULT_BONUSES));
      setDraftNote(ov?.note || "");
    }
  }

  function closeEditor() { setEditing(null); setOkMsg(""); }

  async function save() {
    if (!editing) return;
    setSaving(true); setErr(""); setOkMsg("");
    try {
      let res: Response;
      if (editing.kind === "global") {
        res = await fetch("/api/admin/commission-rules", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "global", slabs: draftSlabs, loyaltyBonuses: draftBonuses, note: draftNote || null }),
        });
      } else {
        res = await fetch("/api/admin/commission-rules", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "creator", creatorId: editing.creatorId, slabs: draftSlabs, loyaltyBonuses: draftBonuses, note: draftNote || null }),
        });
      }
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "save failed");
      setOkMsg(editing.kind === "global" ? "Platform default updated." : "Creator override saved.");
      await new Promise(r => setTimeout(r, 400));
      closeEditor();
      load();
    } catch (e: any) {
      setErr(e?.message || "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride(creatorId: string) {
    if (!confirm("Deactivate this creator's override? Future bookings will use the platform default.")) return;
    setSaving(true); setErr(""); setOkMsg("");
    try {
      const r = await fetch(`/api/admin/commission-rules?creatorId=${encodeURIComponent(creatorId)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "delete failed");
      setOkMsg("Override deactivated.");
      load();
    } catch (e: any) {
      setErr(e?.message || "delete failed");
    } finally {
      setSaving(false);
    }
  }

  const creatorById = useMemo(() => Object.fromEntries(creators.map(c => [c.id, c])), [creators]);

  // ── Add-creator-override picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const creatorsWithoutOverride = creators.filter(c => !overrides.some(o => o.creator_id === c.id));
  const visibleCreators = pickerSearch
    ? creatorsWithoutOverride.filter(c => (c.displayName + " " + (c.phone || "")).toLowerCase().includes(pickerSearch.toLowerCase()))
    : creatorsWithoutOverride;

  return (
    <div style={{ padding: "24px 28px", fontFamily: "DM Sans, sans-serif" }}>
      <h1 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 26, margin: 0 }}>💰 Commission Rules</h1>
      <p style={{ color: "#8A8FA8", fontSize: 13, margin: "6px 0 20px" }}>
        Slab-based commission with loyalty bonus. Slabs are matched by THIS calendar month's attributed booking count.
        Loyalty bonus kicks in when the creator stays at the same slab (or higher) for N consecutive months.
        Per-creator overrides take precedence over the platform default.
      </p>

      {err && <Banner color="#FF4757">{err}</Banner>}
      {okMsg && <Banner color="#2ECC71">{okMsg}</Banner>}

      {loading ? (
        <p style={{ color: "#8A8FA8" }}>Loading…</p>
      ) : (
        <>
          {/* ── PLATFORM DEFAULT ─────────────────────────────────── */}
          <Panel title="Platform default" subtitle={globalRule?.note ? globalRule.note : "Applied to every creator without an explicit override."}>
            <RuleSummary rule={globalRule} />
            <button onClick={() => openEditor({ kind: "global" })} style={primaryBtn}>Edit default →</button>
          </Panel>

          {/* ── PER-CREATOR OVERRIDES ─────────────────────────────── */}
          <Panel
            title="Per-creator overrides"
            subtitle={`${overrides.length} active override${overrides.length === 1 ? "" : "s"}. Useful when a region or top creator needs a different rate card.`}
            right={
              <button onClick={() => setPickerOpen(true)} style={primaryBtn}>+ Add override</button>
            }
          >
            {overrides.length === 0 ? (
              <p style={{ color: "#8A8FA8", padding: "12px 0", fontSize: 13 }}>
                No per-creator overrides yet — everyone uses the platform default.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {overrides.map((ov) => {
                  const c = creatorById[ov.creator_id!];
                  return (
                    <div key={ov.id} style={overrideCard}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: "#E8EAF0", fontWeight: 600, margin: 0 }}>
                          ✨ {c?.displayName || "Creator"} <span style={{ color: "#8A8FA8", fontWeight: 400, fontSize: 12 }}>· {c?.phone || ov.creator_id?.slice(0, 12)}</span>
                        </p>
                        <RuleSummary rule={ov} compact />
                        {ov.note && <p style={{ color: "#666876", fontSize: 11, margin: "4px 0 0", fontStyle: "italic" }}>{ov.note}</p>}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button onClick={() => openEditor({ kind: "creator", creatorId: ov.creator_id! })} style={ghostBtn}>Edit</button>
                        <button onClick={() => removeOverride(ov.creator_id!)} style={dangerBtn}>Deactivate</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </>
      )}

      {/* ── PICKER (Add override) ─────────────────────────────────── */}
      {pickerOpen && (
        <Modal onClose={() => setPickerOpen(false)} title="Pick a creator">
          <input
            placeholder="Search by name or phone…"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            style={inputStyle}
            autoFocus
          />
          <div style={{ maxHeight: 360, overflow: "auto", marginTop: 12, display: "grid", gap: 6 }}>
            {visibleCreators.length === 0 ? (
              <p style={{ color: "#8A8FA8", textAlign: "center", padding: 16, fontSize: 13 }}>
                No matching creators. All active creators may already have overrides.
              </p>
            ) : (
              visibleCreators.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setPickerOpen(false); openEditor({ kind: "creator", creatorId: c.id }); }}
                  style={pickerRow}
                >
                  <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{c.displayName}</span>
                  <span style={{ color: "#8A8FA8", fontSize: 12 }}>{c.phone || c.id.slice(0, 12)}</span>
                </button>
              ))
            )}
          </div>
        </Modal>
      )}

      {/* ── EDITOR ───────────────────────────────────────────────── */}
      {editing && (
        <Modal
          onClose={closeEditor}
          title={
            editing.kind === "global"
              ? "Edit platform default"
              : `Override for ${creatorById[editing.creatorId]?.displayName || "creator"}`
          }
          maxWidth={760}
        >
          {/* SLABS */}
          <h3 style={sectionH}>Monthly booking slabs</h3>
          <p style={sectionP}>
            Bookings counted in THIS calendar month. The rate applies the moment a booking lands in the slab's range.
            Above the top slab's range, the top rate continues to apply.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {draftSlabs.map((s, i) => (
              <div key={i} style={slabRow}>
                <NumInput label="From"  value={s.minBookings} onChange={v => updateSlabs(setDraftSlabs, i, { minBookings: v })} />
                <NumInput label="To"    value={s.maxBookings} onChange={v => updateSlabs(setDraftSlabs, i, { maxBookings: v })} />
                <NumInput label="%"     value={s.pct}         onChange={v => updateSlabs(setDraftSlabs, i, { pct: v })} step={0.5} />
                <button onClick={() => setDraftSlabs(prev => prev.filter((_, j) => j !== i))} style={removeBtn} disabled={draftSlabs.length <= 1}>✕</button>
              </div>
            ))}
            <button onClick={() => {
              const last = draftSlabs[draftSlabs.length - 1];
              setDraftSlabs([...draftSlabs, { minBookings: (last?.maxBookings || 0) + 1, maxBookings: (last?.maxBookings || 0) + 50, pct: (last?.pct || 5) + 2 }]);
            }} style={ghostBtn}>+ Add slab</button>
          </div>

          {/* LOYALTY */}
          <h3 style={{ ...sectionH, marginTop: 24 }}>Loyalty bonus</h3>
          <p style={sectionP}>
            Extra % added when the creator stays at this slab (or moves up) for N consecutive months without dropping below.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {draftBonuses.map((b, i) => (
              <div key={i} style={slabRow}>
                <NumInput label="Months" value={b.months}   onChange={v => updateBonuses(setDraftBonuses, i, { months: v })} />
                <NumInput label="+%"     value={b.bonusPct} onChange={v => updateBonuses(setDraftBonuses, i, { bonusPct: v })} step={0.5} />
                <button onClick={() => setDraftBonuses(prev => prev.filter((_, j) => j !== i))} style={removeBtn}>✕</button>
              </div>
            ))}
            <button onClick={() => {
              const last = draftBonuses[draftBonuses.length - 1];
              setDraftBonuses([...draftBonuses, { months: (last?.months || 0) + 3, bonusPct: (last?.bonusPct || 0) + 1 }]);
            }} style={ghostBtn}>+ Add bonus tier</button>
          </div>

          {/* NOTE */}
          <h3 style={{ ...sectionH, marginTop: 24 }}>Note (optional)</h3>
          <input
            placeholder="Why this rule? e.g. 'Mumbai pilot — capped at 10%'"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            style={inputStyle}
          />

          {/* PREVIEW */}
          <h3 style={{ ...sectionH, marginTop: 24 }}>Preview</h3>
          <RulePreview slabs={draftSlabs} bonuses={draftBonuses} />

          {err && <Banner color="#FF4757">{err}</Banner>}
          {okMsg && <Banner color="#2ECC71">{okMsg}</Banner>}

          <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
            <button onClick={closeEditor} style={ghostBtn} disabled={saving}>Cancel</button>
            <button onClick={save} style={primaryBtn} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function updateSlabs(setter: (fn: (prev: Slab[]) => Slab[]) => void, i: number, patch: Partial<Slab>) {
  setter(prev => prev.map((s, j) => j === i ? { ...s, ...patch } : s));
}
function updateBonuses(setter: (fn: (prev: LoyaltyBonus[]) => LoyaltyBonus[]) => void, i: number, patch: Partial<LoyaltyBonus>) {
  setter(prev => prev.map((b, j) => j === i ? { ...b, ...patch } : b));
}

function RuleSummary({ rule, compact }: { rule: CommissionRule | null; compact?: boolean }) {
  if (!rule) return <p style={{ color: "#8A8FA8" }}>—</p>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {rule.slabs.map((s, i) => (
        <span key={i} style={{ ...slabPill, padding: compact ? "3px 8px" : "5px 12px", fontSize: compact ? 11 : 12 }}>
          {s.minBookings}–{s.maxBookings} · <b style={{ color: "#9fb1c2" }}>{s.pct}%</b>
        </span>
      ))}
      {rule.loyaltyBonuses.map((b, i) => (
        <span key={`b${i}`} style={{ ...slabPill, padding: compact ? "3px 8px" : "5px 12px", fontSize: compact ? 11 : 12, background: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.35)" }}>
          {b.months} mo · <b style={{ color: "#2ECC71" }}>+{b.bonusPct}%</b>
        </span>
      ))}
    </div>
  );
}

function RulePreview({ slabs, bonuses }: { slabs: Slab[]; bonuses: LoyaltyBonus[] }) {
  // Live preview: walk a few synthetic booking counts and show the effective rate.
  const sample = [1, 10, 25, 26, 50, 51, 75, 100, 101, 200, 300, 500];
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {sample.map((n) => {
        const sorted = [...slabs].sort((a, b) => a.minBookings - b.minBookings);
        const matched = sorted.find(s => n >= s.minBookings && n <= s.maxBookings)
                     || (n > (sorted[sorted.length - 1]?.maxBookings ?? 0) ? sorted[sorted.length - 1] : null);
        const base = matched?.pct ?? 0;
        return (
          <div key={n} style={{ display: "grid", gridTemplateColumns: "70px 1fr 70px 70px 70px", gap: 8, alignItems: "center", fontSize: 12, color: "#E8EAF0" }}>
            <span style={{ color: "#8A8FA8" }}>{n} bkgs</span>
            <span style={{ color: "#8A8FA8" }}>→ {matched ? `slab ${matched.minBookings}–${matched.maxBookings}` : "no slab match"}</span>
            <span style={{ textAlign: "right", color: "#9fb1c2" }}><b>{base}%</b> base</span>
            <span style={{ textAlign: "right", color: "#2ECC71" }}>
              {bonuses[0] ? `+${bonuses[0].bonusPct}% @ ${bonuses[0].months}mo` : ""}
            </span>
            <span style={{ textAlign: "right", color: "#c6d0da" }}>
              {bonuses[bonuses.length - 1] && bonuses.length > 1 ? `+${bonuses[bonuses.length - 1].bonusPct}% @ ${bonuses[bonuses.length - 1].months}mo` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NumInput({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <span style={{ color: "#8A8FA8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step || 1}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }}
      />
    </label>
  );
}

function Banner({ color, children }: { color: string; children: any }) {
  return (
    <div style={{ background: color + "1A", border: `1px solid ${color}55`, color, padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Panel({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: any; children: any }) {
  return (
    <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <div>
          <p style={{ color: "#E8EAF0", fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</p>
          {subtitle && <p style={{ color: "#8A8FA8", fontSize: 12, margin: "4px 0 0" }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Modal({ title, onClose, maxWidth, children }: { title: string; onClose: () => void; maxWidth?: number; children: any }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 22, width: "100%", maxWidth: maxWidth || 480, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <p style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "Syne, sans-serif" }}>{title}</p>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A8FA8", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { background: "#0F1117", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" };
const primaryBtn: React.CSSProperties = { background: "linear-gradient(160deg,#d4dde6 0%,#b1bfd0 52%,#93a7bc 100%)", color: "#0F1117", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
const ghostBtn: React.CSSProperties = { background: "rgba(255,255,255,0.06)", color: "#E8EAF0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
const dangerBtn: React.CSSProperties = { background: "rgba(255,71,87,0.12)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.4)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
const removeBtn: React.CSSProperties = { background: "rgba(255,71,87,0.15)", color: "#FF4757", border: "none", borderRadius: 8, padding: "0 10px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "DM Sans, sans-serif", height: 36 };
const slabRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-end", background: "rgba(255,255,255,0.03)", padding: "8px 10px", borderRadius: 10 };
const slabPill: React.CSSProperties = { background: "rgba(140, 160, 182,0.12)", border: "1px solid rgba(140, 160, 182,0.35)", color: "#E8EAF0", borderRadius: 999, fontSize: 12, fontWeight: 600 };
const overrideCard: React.CSSProperties = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 12, display: "flex", alignItems: "flex-start", gap: 14 };
const pickerRow: React.CSSProperties = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "10px 12px", color: "#E8EAF0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "DM Sans, sans-serif", textAlign: "left" };
const sectionH: React.CSSProperties = { color: "#E8EAF0", fontSize: 14, fontWeight: 700, margin: "0 0 6px", fontFamily: "Syne, sans-serif" };
const sectionP: React.CSSProperties = { color: "#8A8FA8", fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 };
