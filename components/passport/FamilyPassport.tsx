"use client";
// FamilyPassport (v266, Phase 2b) — link family members into one shared
// collection. Owner creates a family + adds members by Explorer ID; everyone
// sees a combined stamp count + each member's rank. Members can leave; the
// owner disbands.
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";
import { PassportMedal, MEDAL_CHAMPAGNE, type MedalFace } from "@/components/passport/PassportMedal";

// Pull the first hex out of a member's rankGradient so each avatar medal is
// tinted to that member's rank. Falls back to champagne.
function faceFromGradient(grad: string): MedalFace {
  const hex = grad.match(/#[0-9a-fA-F]{6}/)?.[0];
  if (!hex) return MEDAL_CHAMPAGNE;
  return { metal: "gold", core: hex, glow: hex };
}

type Member = {
  userId: string;
  role: string;
  name: string;
  explorerId: string | null;
  rankLabel: string;
  rankEmoji: string;
  rankGradient: string;
  xp: number;
  stamps: number;
  isYou: boolean;
};

export function FamilyPassport({ myExplorerId }: { myExplorerId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [combined, setCombined] = useState<{ stamps: number; cities: number; members: number }>({ stamps: 0, cities: 0, members: 0 });
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () => {
    setLoading(true);
    api.getPassportFamily()
      .then((d) => {
        setFamily(d?.family || null);
        setMembers(d?.members || []);
        setCombined(d?.combined || { stamps: 0, cities: 0, members: 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.createPassportFamily("My Family");
      if (r?.ok || r?.familyId) load(); else setError(r?.error || "Couldn't create family.");
    } catch { setError("Couldn't create family."); } finally { setBusy(false); }
  };

  const addMember = async () => {
    const id = addId.trim().toUpperCase();
    if (!id) return;
    setBusy(true); setError("");
    try {
      const r = await api.addPassportFamilyMember(id);
      if (r?.ok) { setAddId(""); load(); } else setError(r?.error || "Couldn't add member.");
    } catch { setError("Couldn't add member."); } finally { setBusy(false); }
  };

  const removeMember = async (userId: string) => {
    setBusy(true); setError("");
    try { await api.removePassportFamilyMember(userId); load(); }
    catch { setError("Couldn't update member."); } finally { setBusy(false); }
  };

  const leave = async (userId: string) => {
    setBusy(true); setError("");
    try {
      const r = await api.removePassportFamilyMember(userId);
      if (r?.ok) load(); else setError(r?.error || "Couldn't leave.");
    } catch { setError("Couldn't leave."); } finally { setBusy(false); }
  };

  const disband = async () => {
    setBusy(true); setError("");
    try { await api.disbandPassportFamily(); load(); }
    catch { setError("Couldn't disband."); } finally { setBusy(false); }
  };

  const copyMyId = () => {
    if (!myExplorerId) return;
    navigator.clipboard?.writeText(myExplorerId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (loading) {
    return <div className="h-32 rounded-3xl shimmer" />;
  }

  const isOwner = !!family?.isOwner;

  return (
    <div>
      <style>{`
        @keyframes fpIdSheen { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        .fp-id-btn {
          border-radius: 14px;
          background: linear-gradient(135deg,#1d252e,#151b21);
          box-shadow: 0 6px 18px -8px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(106,133,160,0.3);
        }
        .fp-id-val {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-weight: 800; font-size: 0.92rem; letter-spacing: 0.04em;
          background: linear-gradient(110deg,#eceff3,#c6d0da 45%,#8ba0b5 70%,#eceff3);
          background-size: 220% 220%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: fpIdSheen 4s ease infinite;
        }
        @keyframes fpCombShine { 0%{transform:translateX(-120%) skewX(-18deg)} 60%,100%{transform:translateX(260%) skewX(-18deg)} }
        .fp-comb { position: relative; overflow: hidden; }
        .fp-comb::after {
          content:""; position:absolute; top:0; left:0; width:42%; height:100%;
          background: linear-gradient(90deg, transparent, rgba(176, 192, 209,0.55), transparent);
          animation: fpCombShine 6s ease-in-out infinite; pointer-events:none;
        }
        @media (prefers-reduced-motion: reduce) {
          .fp-id-val, .fp-comb::after { animation: none; }
        }
      `}</style>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2" style={{ color: "var(--text-base)" }}>
          <Users size={17} strokeWidth={2.2} aria-hidden style={{ color: "#8198ae" }} /> Family Passport
        </h3>
        {family && (
          <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            {combined.members} member{combined.members === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl px-3 py-2 text-xs font-medium" style={{ background: "#fde8e4", color: "#a85b4e" }}>
          {error}
        </div>
      )}

      {!family ? (
        // ── No family yet ──
        <div className="ppx-card rounded-3xl p-5 text-center">
          <p className="mb-2"><Users size={28} strokeWidth={2} aria-hidden style={{ display: "inline-block", color: "#8198ae" }} /></p>
          <p className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>
            Travel as a family
          </p>
          <p className="text-xs mt-1 mb-4" style={{ color: "var(--text-muted)" }}>
            Pool everyone's stamps into one shared collection. You add members by their Explorer ID.
          </p>
          <button
            onClick={create}
            disabled={busy}
            className="px-5 py-2.5 rounded-xl text-white font-bold text-sm relative overflow-hidden sb-shimmer"
            style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}
          >
            <span className="relative" style={{ zIndex: 2 }}>{busy ? "Creating…" : "Start a Family Passport"}</span>
          </button>
        </div>
      ) : (
        // ── Has a family ──
        <div className="space-y-3">
          {/* Combined card */}
          <div
            className="fp-comb rounded-3xl p-5"
            style={{
              background: "color-mix(in srgb, var(--accent) 10%, var(--bg-card))",
              border: "1px solid rgba(106,133,160,0.4)",
              boxShadow: "0 14px 34px -16px rgba(120,90,20,0.45)",
            }}
          >
            <p className="text-[0.6rem] uppercase tracking-widest font-bold relative z-10" style={{ color: "var(--accent)" }}>
              {family.name}
            </p>
            <div className="flex items-end gap-4 mt-1 relative z-10">
              <div>
                <p className="font-display text-3xl font-bold leading-none tabular-nums" style={{ color: "var(--text-base)" }}>
                  <CountUp value={combined.stamps} duration={1000} />
                </p>
                <p className="text-[0.6rem] uppercase tracking-widest font-bold mt-1" style={{ color: "var(--accent)" }}>
                  Family stamps
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="font-display text-2xl font-bold leading-none tabular-nums" style={{ color: "var(--text-base)" }}>
                  {combined.members}
                </p>
                <p className="text-[0.6rem] uppercase tracking-widest font-bold mt-1" style={{ color: "var(--accent)" }}>
                  Members
                </p>
              </div>
            </div>
          </div>

          {/* Members list */}
          <div className="space-y-2 sb-stagger">
            {members.map((m) => (
              <div
                key={m.userId}
                className="sb-card-lift rounded-[22px] p-3 flex items-center gap-3"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-soft)",
                  boxShadow: "0 6px 16px -10px rgba(0,0,0,0.3)",
                }}
              >
                <PassportMedal
                  glyph={m.name.charAt(0).toUpperCase()}
                  size={42}
                  m={faceFromGradient(m.rankGradient)}
                  pulse={m.isYou}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>
                      {m.name}{m.isYou && " (You)"}
                    </p>
                    {m.role === "owner" && (
                      <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(106,133,160,0.2)", color: "var(--accent)" }}>
                        OWNER
                      </span>
                    )}
                  </div>
                  <p className="text-[0.62rem] mt-0.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {m.rankEmoji} {m.rankLabel} · {m.stamps} stamps
                  </p>
                </div>
                {/* Remove (owner removing a non-owner member) / Leave (self, non-owner) */}
                {isOwner && m.role !== "owner" && (
                  <button onClick={() => removeMember(m.userId)} disabled={busy}
                    className="shrink-0 text-[0.62rem] font-bold px-2.5 py-1.5 rounded-lg"
                    style={{ background: "#fde8e4", color: "#a85b4e" }}>
                    Remove
                  </button>
                )}
                {m.isYou && m.role !== "owner" && (
                  <button onClick={() => leave(m.userId)} disabled={busy}
                    className="shrink-0 text-[0.62rem] font-bold px-2.5 py-1.5 rounded-lg"
                    style={{ background: "var(--bg-pill)", color: "var(--text-soft)" }}>
                    Leave
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Owner: add member */}
          {isOwner && (
            <div className="ppx-card rounded-[22px] p-3.5">
              <p className="text-xs font-bold mb-2" style={{ color: "var(--text-base)" }}>Add a member</p>
              <div className="flex gap-2">
                <input
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  placeholder="SB-EXP-123456"
                  className="flex-1 rounded-xl px-3 py-2 text-sm font-mono uppercase"
                  style={{ background: "var(--bg-page)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }}
                />
                <button onClick={addMember} disabled={busy || !addId.trim()}
                  className="shrink-0 px-4 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                  style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
                  Add
                </button>
              </div>
              <p className="text-[0.6rem] mt-1.5" style={{ color: "var(--text-muted)" }}>
                Ask them for their Explorer ID (shown on their passport).
              </p>
            </div>
          )}

          {/* Your Explorer ID — easy share so the owner can add you */}
          {myExplorerId && (
            <button onClick={copyMyId} className="fp-id-btn w-full py-2.5 px-3 flex items-center justify-center gap-2">
              <span className="text-[0.6rem] uppercase tracking-widest font-bold" style={{ color: "var(--accent)" }}>Your ID</span>
              <span className="fp-id-val">{myExplorerId}</span>
              {/* .fp-id-btn is a FIXED dark surface → use fixed light-muted, not the flipping --text-muted (dark-brown, unreadable on near-black in light mode) */}
              <span className="text-[0.6rem]" style={{ color: copied ? "#a9d6b8" : "rgba(176, 192, 209,0.55)" }}>
                {copied ? "✓ Copied" : "tap to copy"}
              </span>
            </button>
          )}

          {/* Owner disband */}
          {isOwner && (
            <button onClick={disband} disabled={busy}
              className="w-full text-[0.66rem] font-semibold py-1.5"
              style={{ color: "#a85b4e" }}>
              Disband family
            </button>
          )}
        </div>
      )}
    </div>
  );
}
