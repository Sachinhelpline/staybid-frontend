"use client";
// FamilyPassport (v266, Phase 2b) — link family members into one shared
// collection. Owner creates a family + adds members by Explorer ID; everyone
// sees a combined stamp count + each member's rank. Members can leave; the
// owner disbands.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";

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
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg font-semibold" style={{ color: "var(--text-base)" }}>
          👨‍👩‍👧 Family Passport
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
        <div className="rounded-3xl p-5 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
          <p className="text-3xl mb-2">👨‍👩‍👧‍👦</p>
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
            style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}
          >
            <span className="relative" style={{ zIndex: 2 }}>{busy ? "Creating…" : "Start a Family Passport"}</span>
          </button>
        </div>
      ) : (
        // ── Has a family ──
        <div className="space-y-3">
          {/* Combined card */}
          <div
            className="rounded-3xl p-5 relative overflow-hidden"
            style={{ background: "linear-gradient(160deg,#fffdf8,#fbf3e2)", border: "1px solid rgba(201,166,107,0.4)" }}
          >
            <p className="text-[0.6rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>
              {family.name}
            </p>
            <div className="flex items-end gap-4 mt-1">
              <div>
                <p className="font-display text-3xl font-bold leading-none" style={{ color: "#3A2D10" }}>
                  <CountUp value={combined.stamps} duration={1000} />
                </p>
                <p className="text-[0.6rem] uppercase tracking-widest font-bold mt-1" style={{ color: "#8B6914" }}>
                  Family stamps
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="font-display text-2xl font-bold leading-none" style={{ color: "#3A2D10" }}>
                  {combined.members}
                </p>
                <p className="text-[0.6rem] uppercase tracking-widest font-bold mt-1" style={{ color: "#8B6914" }}>
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
                className="rounded-2xl p-3 flex items-center gap-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                  style={{ background: m.rankGradient }}
                >
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-bold text-sm leading-tight" style={{ color: "var(--text-base)" }}>
                      {m.name}{m.isYou && " (You)"}
                    </p>
                    {m.role === "owner" && (
                      <span className="text-[0.5rem] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(201,166,107,0.2)", color: "#8B6914" }}>
                        OWNER
                      </span>
                    )}
                  </div>
                  <p className="text-[0.62rem] mt-0.5" style={{ color: "var(--text-muted)" }}>
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
            <div className="rounded-2xl p-3.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
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
                  style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
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
            <button onClick={copyMyId}
              className="w-full rounded-xl border-2 border-dashed py-2 flex items-center justify-center gap-2"
              style={{ borderColor: "rgba(201,166,107,0.4)", background: "var(--bg-page)" }}>
              <span className="text-[0.6rem] uppercase tracking-widest font-bold" style={{ color: "#8B6914" }}>Your ID</span>
              <span className="font-mono text-sm font-bold" style={{ color: "var(--text-base)" }}>{myExplorerId}</span>
              <span className="text-[0.6rem]" style={{ color: copied ? "#4a6f4a" : "var(--text-muted)" }}>
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
