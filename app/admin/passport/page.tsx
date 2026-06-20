"use client";
// /admin/passport — Explorer Passport config / issue / adjust (Phase 2c, v267).
//
// Search any explorer by ID / display name / phone → review their passport →
// grant or remove a stamp, or set additive bonus XP. The passport engine is
// deterministic, so these are the only two durable levers (a real stamp row,
// or persisted bonus_xp). Every mutation is audit-logged server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RANKS,
  STAMP_REWARDS,
  rankForXp,
  XP_PER_STAMP,
  XP_NEW_CITY_BONUS,
  XP_PER_BADGE,
} from "@/lib/passport/engine";

// ── dark-luxury tokens (match the rest of /admin) ──────────────────────
const BG = "#07080C";
const CARD = "#151820";
const SURFACE = "#0F1117";
const BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#D4AF37";
const TEXT = "#E8EAF0";
const MUTE = "#8A8FA8";
const GREEN = "#2ECC71";
const RED = "#FF4757";

type Profile = {
  user_id: string;
  explorer_id: string | null;
  display_name: string | null;
  member_since: string | null;
  xp: number | null;
  bonus_xp: number | null;
  rank_key: string | null;
  stamps_count: number | null;
  properties_visited: number | null;
  cities_visited: number | null;
  user: { name: string | null; phone: string | null; email: string | null } | null;
  rankLabel?: string;
  rankEmoji?: string;
};

type Stamp = {
  id: string;
  hotel_name: string | null;
  city: string | null;
  region: string | null;
  source_type: string | null;
  stay_date: string | null;
  earned_at: string | null;
};

export default function AdminPassportPage() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [selected, setSelected] = useState<Profile | null>(null);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // grant-stamp form
  const [gCity, setGCity] = useState("");
  const [gHotel, setGHotel] = useState("");
  const [gDate, setGDate] = useState("");
  // bonus-xp input
  const [bonusInput, setBonusInput] = useState("");

  const adminHeaders = useCallback((): HeadersInit => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    let id = "";
    try {
      const u = JSON.parse(localStorage.getItem("sb_admin_user") || "null");
      id = u?.id || "";
    } catch {}
    return {
      "Content-Type": "application/json",
      ...(tok ? { "x-admin-token": tok } : {}),
      ...(id ? { "x-admin-id": id } : {}),
    };
  }, []);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  const search = useCallback(
    async (term: string) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/admin/passport?q=${encodeURIComponent(term)}`, {
          headers: adminHeaders(),
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok) {
          setErr(j?.error || `Status ${r.status}`);
          setList([]);
        } else {
          setList(j?.profiles || []);
        }
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [adminHeaders],
  );

  useEffect(() => {
    search("");
  }, [search]);

  const openDetail = useCallback(
    async (p: Profile) => {
      setSelected(p);
      setStamps([]);
      setBonusInput(String(p.bonus_xp ?? 0));
      setGCity("");
      setGHotel("");
      setGDate("");
      setDetailLoading(true);
      try {
        const r = await fetch(`/api/admin/passport?userId=${encodeURIComponent(p.user_id)}`, {
          headers: adminHeaders(),
          cache: "no-store",
        });
        const j = await r.json();
        if (r.ok) {
          if (j?.profile) setSelected(j.profile);
          setStamps(j?.stamps || []);
        }
      } catch {}
      setDetailLoading(false);
    },
    [adminHeaders],
  );

  const post = useCallback(
    async (payload: any): Promise<any | null> => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/passport", {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          flash(j?.error || `Error ${r.status}`);
          return null;
        }
        return j;
      } catch (e: any) {
        flash(e?.message || "Request failed");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [adminHeaders],
  );

  const grantStamp = async () => {
    if (!selected) return;
    const j = await post({
      action: "grant_stamp",
      userId: selected.user_id,
      city: gCity || undefined,
      hotelName: gHotel || undefined,
      stayDate: gDate || undefined,
    });
    if (j?.ok) {
      flash("Stamp granted");
      openDetail(selected);
      search(q);
    }
  };

  const removeStamp = async (stampId: string) => {
    if (!selected) return;
    const j = await post({ action: "remove_stamp", userId: selected.user_id, stampId });
    if (j?.ok) {
      flash("Stamp removed");
      openDetail(selected);
      search(q);
    }
  };

  const saveBonus = async () => {
    if (!selected) return;
    const n = Math.max(0, Math.floor(Number(bonusInput)));
    const j = await post({ action: "set_bonus_xp", userId: selected.user_id, bonusXp: n });
    if (j?.ok) {
      flash("Bonus XP saved");
      if (j.profile) setSelected((s) => (s ? { ...s, ...j.profile } : s));
      search(q);
    }
  };

  const effectiveRank = useMemo(() => {
    if (!selected) return null;
    return rankForXp(Number(selected.xp || 0));
  }, [selected]);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: TEXT, padding: "24px 20px 80px", fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 26, color: GOLD, margin: "0 0 4px" }}>
          🛂 Passports
        </h1>
        <p style={{ color: MUTE, fontSize: 13, margin: "0 0 18px" }}>
          Issue or remove stamps · adjust bonus XP. The rank &amp; rewards ladder are derived
          automatically — only stamps and bonus XP are admin-controlled.
        </p>

        {/* Search */}
        <form
          onSubmit={(e) => { e.preventDefault(); search(q); }}
          style={{ display: "flex", gap: 8, marginBottom: 16 }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by Explorer ID, name or phone…"
            style={{
              flex: 1, background: SURFACE, border: `1px solid ${BORDER}`, color: TEXT,
              borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none",
            }}
          />
          <button type="submit" disabled={loading}
            style={{ background: GOLD, color: "#1a1a1a", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            {loading ? "…" : "Search"}
          </button>
        </form>

        {err && (
          <div style={{ background: "rgba(255,71,87,0.12)", border: `1px solid ${RED}`, color: "#ffb3bb", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
            {err}
          </div>
        )}

        {/* List */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
          {list.map((p) => (
            <button
              key={p.user_id}
              onClick={() => openDetail(p)}
              style={{
                textAlign: "left", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14,
                padding: 14, cursor: "pointer", color: TEXT, display: "flex", flexDirection: "column", gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  {p.display_name || p.user?.name || "Explorer"}
                </span>
                <span style={{ fontSize: 11, color: GOLD, fontFamily: "monospace" }}>{p.explorer_id || "—"}</span>
              </div>
              <div style={{ fontSize: 12, color: MUTE }}>
                {p.rankEmoji} {p.rankLabel} · {Number(p.xp || 0).toLocaleString()} XP
                {Number(p.bonus_xp || 0) > 0 && (
                  <span style={{ color: GOLD }}> (+{Number(p.bonus_xp)} bonus)</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: MUTE }}>
                {p.stamps_count ?? 0} stamps · {p.cities_visited ?? 0} cities
                {p.user?.phone ? ` · ${p.user.phone}` : ""}
              </div>
            </button>
          ))}
          {!loading && list.length === 0 && (
            <div style={{ color: MUTE, fontSize: 13, padding: 12 }}>No passports found.</div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", zIndex: 60, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "30px 16px", overflowY: "auto" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 720, background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 22 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800 }}>
                  {selected.display_name || selected.user?.name || "Explorer"}
                </div>
                <div style={{ fontSize: 12, color: MUTE, fontFamily: "monospace" }}>
                  {selected.explorer_id || "—"}
                  {selected.user?.phone ? ` · ${selected.user.phone}` : ""}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: MUTE, fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>

            {/* Stat strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
              {[
                { l: "Rank", v: `${effectiveRank?.rank.emoji || ""} ${effectiveRank?.rank.label || "—"}` },
                { l: "Total XP", v: Number(selected.xp || 0).toLocaleString() },
                { l: "Stamps", v: selected.stamps_count ?? stamps.length },
                { l: "Cities", v: selected.cities_visited ?? 0 },
              ].map((s) => (
                <div key={s.l} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase", letterSpacing: 0.5 }}>{s.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{s.v}</div>
                </div>
              ))}
            </div>

            {/* Bonus XP */}
            <Section title="Bonus XP (additive, persists)">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number" min={0}
                  value={bonusInput}
                  onChange={(e) => setBonusInput(e.target.value)}
                  style={inputStyle}
                />
                <button onClick={saveBonus} disabled={busy} style={primaryBtn}>Save</button>
              </div>
              <p style={{ fontSize: 11, color: MUTE, margin: "6px 0 0" }}>
                Added on top of the computed XP every load. Current bonus: {selected.bonus_xp ?? 0}.
              </p>
            </Section>

            {/* Grant stamp */}
            <Section title="Grant a stamp (+150 XP)">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input value={gHotel} onChange={(e) => setGHotel(e.target.value)} placeholder="Hotel name (optional)" style={inputStyle} />
                <input value={gCity} onChange={(e) => setGCity(e.target.value)} placeholder="City (optional)" style={inputStyle} />
                <input type="date" value={gDate} onChange={(e) => setGDate(e.target.value)} style={inputStyle} />
                <button onClick={grantStamp} disabled={busy} style={primaryBtn}>Grant stamp</button>
              </div>
            </Section>

            {/* Stamps list */}
            <Section title={`Stamps (${stamps.length})`}>
              {detailLoading ? (
                <div style={{ color: MUTE, fontSize: 13 }}>Loading…</div>
              ) : stamps.length === 0 ? (
                <div style={{ color: MUTE, fontSize: 13 }}>No stamps yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {stamps.map((s) => (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 10px" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {s.hotel_name || s.city || "Stay"}
                          {s.source_type === "admin" && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 6, padding: "1px 5px" }}>ADMIN</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: MUTE }}>
                          {s.city || "—"} · {(s.stay_date || s.earned_at || "").slice(0, 10)}
                        </div>
                      </div>
                      <button onClick={() => removeStamp(s.id)} disabled={busy}
                        style={{ background: "rgba(255,71,87,0.12)", border: `1px solid ${RED}`, color: "#ffb3bb", borderRadius: 8, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Reference ladders */}
            <Section title="Rank ladder (reference)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {RANKS.map((r) => {
                  const here = effectiveRank?.rank.key === r.key;
                  return (
                    <span key={r.key} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: `1px solid ${here ? GOLD : BORDER}`, color: here ? GOLD : MUTE, background: here ? "rgba(212,175,55,0.1)" : "transparent" }}>
                      {r.emoji} {r.label} · {r.xpMin.toLocaleString()}
                    </span>
                  );
                })}
              </div>
              <p style={{ fontSize: 10, color: MUTE, margin: "8px 0 0" }}>
                XP = {XP_PER_STAMP}/stamp + {XP_NEW_CITY_BONUS}/new city + {XP_PER_BADGE}/badge + bonus XP.
              </p>
            </Section>

            <Section title="Reward ladder (reference)">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {STAMP_REWARDS.map((r) => {
                  const unlocked = (selected.stamps_count ?? stamps.length) >= r.stamps;
                  return (
                    <span key={r.key} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: `1px solid ${unlocked ? GREEN : BORDER}`, color: unlocked ? GREEN : MUTE }}>
                      {r.emoji} {r.stamps}× → {r.title}
                    </span>
                  );
                })}
              </div>
            </Section>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: CARD, border: `1px solid ${GOLD}`, color: GOLD, padding: "10px 18px", borderRadius: 12, zIndex: 80, fontSize: 13, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#D4AF37", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#0B0D13", border: "1px solid rgba(255,255,255,0.1)", color: "#E8EAF0",
  borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", width: "100%",
};
const primaryBtn: React.CSSProperties = {
  background: "#D4AF37", color: "#1a1a1a", border: "none", borderRadius: 9,
  padding: "9px 16px", fontWeight: 700, cursor: "pointer", fontSize: 13, whiteSpace: "nowrap",
};
