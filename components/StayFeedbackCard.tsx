"use client";
//
// StayFeedbackCard (v127) — post-checkout smiley feedback composer.
//
//   Rendered under each CHECKED_OUT (or post-checkout-date) booking on
//   /verification. Customer rates 5 checkpoints on a 3-smiley scale:
//
//       Room matches video · Staff behavior · Hygiene
//       Food quality · Staff response
//
//   • All-positive / neutral  → POST /api/complaints/submit one-shot, done.
//   • Any negative checkpoint → "Record evidence video" CTA opens
//                               /verification/record?type=stay_feedback&...
//
//   Schema lives in `complaints` (v98 surface). The new columns landed via
//   migrations/2026-05-16-stay-feedback.sql. Once submitted, the card
//   collapses into a "Thanks for your feedback" state.
//

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const CHECKPOINTS: { key: SmileyKey; label: string; sub: string; icon: string }[] = [
  { key: "roomMatch",     label: "Room matches video",  sub: "Did the room look like what the hotel showed?", icon: "🛏️" },
  { key: "staff",         label: "Staff behavior",      sub: "Were the staff polite and professional?",        icon: "🤝" },
  { key: "hygiene",       label: "Hygiene & cleanliness", sub: "Was the room and property clean?",             icon: "🧼" },
  { key: "food",          label: "Food quality",        sub: "If you had meals, how was the food?",            icon: "🍽️" },
  { key: "staffResponse", label: "Staff response",      sub: "Did the team respond quickly to requests?",      icon: "⚡" },
];

type Smiley = "positive" | "neutral" | "negative";
type SmileyKey = "roomMatch" | "staff" | "hygiene" | "food" | "staffResponse";
type Scores = Partial<Record<SmileyKey, Smiley>>;

const SMILEYS: { v: Smiley; icon: string; label: string; color: string }[] = [
  { v: "positive", icon: "😊", label: "Loved it",   color: "#16a34a" },
  { v: "neutral",  icon: "😐", label: "It's okay",  color: "#a16207" },
  { v: "negative", icon: "😞", label: "Not good",   color: "#dc2626" },
];

// v127.1 — 48-hour feedback window after checkout. Past this the
// lifecycle cron auto-fills positive feedback + deletes the hotel
// verification video. UI shows a live countdown so the customer knows.
const FEEDBACK_WINDOW_HOURS = 48;

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function StayFeedbackCard({
  bidId,
  hotelName,
  hotelId,
  verificationRequestId,
  checkOut,
}: {
  bidId: string;
  hotelName: string;
  hotelId?: string;
  verificationRequestId?: string;
  checkOut?: string;
}) {
  const router = useRouter();
  const { token } = useAuth();
  const [scores, setScores] = useState<Scores>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ feedback: any; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if we've already submitted feedback for this booking (idempotency).
  // /api/complaints/my exists from v98. Filter on feedbackType + bidId.
  useEffect(() => {
    let alive = true;
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch("/api/complaints/my", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) { setLoading(false); return; }
        const j = await r.json().catch(() => ({}));
        const rows: any[] = j.complaints || j.rows || [];
        const match = rows.find(
          (c) => c.feedbackType === "stay_feedback" && (c.bidId === bidId || c.bookingId === bidId),
        );
        if (alive && match) setExisting({ feedback: match.feedback, createdAt: match.createdAt });
      } catch {} finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [token, bidId]);

  const filled = Object.keys(scores).length;
  const negCount = (Object.values(scores) as Smiley[]).filter((v) => v === "negative").length;
  const allFilled = filled === CHECKPOINTS.length;

  // Deadline countdown — based on checkOut + FEEDBACK_WINDOW_HOURS.
  // Re-renders every 60s. Doesn't render at all if checkOut is missing.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const deadlineMs = checkOut ? new Date(checkOut).getTime() + FEEDBACK_WINDOW_HOURS * 3600_000 : null;
  const remainingMs = deadlineMs ? deadlineMs - Date.now() : null;
  void tick; // referenced just to keep React re-rendering this hook chain
  const expired = remainingMs !== null && remainingMs <= 0;

  const submit = async (kind: "submit_only" | "record_then_submit") => {
    if (!allFilled || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      // For the record-then-submit branch, stash the in-progress feedback
      // in localStorage keyed by bidId so /verification/record can include
      // the customer's video ids in the final complaint POST.
      if (kind === "record_then_submit") {
        try {
          localStorage.setItem(
            `sb_stay_feedback_${bidId}`,
            JSON.stringify({
              bidId, hotelId, hotelName, verificationRequestId,
              scores, note, startedAt: Date.now(),
            }),
          );
        } catch {}
        const params = new URLSearchParams({
          type: "stay_feedback",
          bidId,
          ...(hotelId ? { hotelId } : {}),
          ...(verificationRequestId ? { requestId: verificationRequestId } : {}),
        });
        router.push(`/verification/record?${params.toString()}`);
        return;
      }

      const r = await fetch("/api/complaints/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "stay_feedback",
          bidId,
          hotelId,
          verificationRequestId,
          feedback: { ...scores, note: note.trim() || undefined },
          priority: "low",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Failed to submit");
      setExisting({ feedback: j.complaint?.feedback || scores, createdAt: new Date().toISOString() });
    } catch (e: any) {
      setErr(e?.message || "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;

  if (existing) {
    const f = existing.feedback || {};
    return (
      <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-emerald-50 to-luxury-50 border border-emerald-200">
        <div className="flex items-start gap-3">
          <div className="text-3xl">✓</div>
          <div className="flex-1">
            <div className="font-display text-lg text-emerald-900">Thanks for your feedback</div>
            <div className="text-xs text-emerald-800/70 mt-0.5">
              Submitted {new Date(existing.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {" · "}+100 StayPoints credited
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {CHECKPOINTS.map((c) => {
                const v = f[c.key] as Smiley | undefined;
                if (!v) return null;
                const s = SMILEYS.find((x) => x.v === v)!;
                return (
                  <div key={c.key} className="text-xs px-2.5 py-1 rounded-full bg-white/70 border border-luxury-100" title={c.label}>
                    <span>{s.icon}</span>
                    <span className="ml-1 text-luxury-700">{c.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 rounded-2xl bg-gradient-to-br from-gold-50/40 to-luxury-50 border border-gold-200/60">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-display text-lg text-luxury-900">Rate your stay at {hotelName}</div>
          <div className="text-xs text-luxury-500 mt-0.5">5 quick questions · earn 100 StayPoints</div>
        </div>
        <div className="text-xs text-luxury-500 font-mono whitespace-nowrap">{filled}/{CHECKPOINTS.length}</div>
      </div>

      {remainingMs !== null && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 border ${
          expired
            ? "bg-luxury-100 border-luxury-200 text-luxury-600"
            : remainingMs < 6 * 3600_000
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-emerald-50 border-emerald-200 text-emerald-900"
        }`}>
          <span>⏳</span>
          <span>
            {expired
              ? "Window closed — we'll auto-mark this stay as positive shortly."
              : <>You have <span className="font-semibold">{formatRemaining(remainingMs)}</span> left to submit feedback. After {FEEDBACK_WINDOW_HOURS}h post-checkout we auto-mark it as positive and delete the hotel's verification video.</>}
          </span>
        </div>
      )}

      <div className="space-y-2.5">
        {CHECKPOINTS.map((c) => (
          <div key={c.key} className="p-3 rounded-xl bg-white border border-luxury-100">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-xl shrink-0">{c.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-luxury-900">{c.label}</div>
                  <div className="text-xs text-luxury-500 mt-0.5">{c.sub}</div>
                </div>
              </div>
            </div>
            <div className="flex gap-1.5" role="radiogroup" aria-label={c.label}>
              {SMILEYS.map((s) => {
                const active = scores[c.key] === s.v;
                return (
                  <button
                    key={s.v}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScores((p) => ({ ...p, [c.key]: s.v }))}
                    className={`flex-1 py-2 px-2 rounded-lg border text-sm font-medium transition ${
                      active
                        ? "border-current shadow-sm"
                        : "border-luxury-100 bg-luxury-50/40 hover:bg-white"
                    }`}
                    style={
                      active
                        ? { color: s.color, background: `${s.color}10`, borderColor: `${s.color}55` }
                        : undefined
                    }
                  >
                    <span className="mr-1">{s.icon}</span>
                    <span className="text-xs">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <textarea
        placeholder="Optional note (max 1000 chars)…"
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
        rows={2}
        className="mt-3 w-full p-2.5 text-sm rounded-lg border border-luxury-100 bg-white focus:outline-none focus:border-gold-400 resize-none"
      />

      {negCount > 0 && allFilled && (
        <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
          <div className="font-semibold mb-1">📹 You flagged {negCount} negative checkpoint{negCount > 1 ? "s" : ""}.</div>
          <div>Record a short evidence video so the admin can review side-by-side with the hotel's verification video. This helps us act faster on your concern.</div>
        </div>
      )}

      {err && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        {negCount > 0 ? (
          <>
            <button
              onClick={() => submit("record_then_submit")}
              disabled={!allFilled || submitting}
              className="btn-luxury w-full sm:flex-1 disabled:opacity-50"
            >
              📹 Record evidence video
            </button>
            <button
              onClick={() => submit("submit_only")}
              disabled={!allFilled || submitting}
              className="w-full sm:w-auto px-4 py-2 rounded-full bg-luxury-100 hover:bg-luxury-200 text-luxury-700 text-sm font-semibold disabled:opacity-50"
            >
              Submit without video
            </button>
          </>
        ) : (
          <button
            onClick={() => submit("submit_only")}
            disabled={!allFilled || submitting}
            className="btn-luxury w-full disabled:opacity-50"
          >
            {submitting ? "Submitting…" : allFilled ? "Submit feedback" : `Rate all ${CHECKPOINTS.length} checkpoints to continue`}
          </button>
        )}
      </div>
    </div>
  );
}

// Helper exported for /verification/page.tsx to decide visibility.
export function isPostCheckout(booking: { status?: string; checkOut?: string }): boolean {
  if (booking.status === "CHECKED_OUT") return true;
  if (booking.checkOut) {
    const out = new Date(booking.checkOut);
    if (!isNaN(out.getTime()) && out.getTime() < Date.now()) return true;
  }
  return false;
}
