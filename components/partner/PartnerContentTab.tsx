"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PartnerContentTab — hotel-partner Pending Reviews queue.
// ═══════════════════════════════════════════════════════════════════════════
// Reads /api/partner/content/pending (auth via x-partner-token from
// localStorage.sb_partner_token + scoped via x-partner-hotel-id).
// Per-post actions:
//   - Approve  → publishes the post to the public feed (moderation_status=APPROVED)
//   - Reject   → rejects with required reason; author is notified
//   - Escalate → routes to admin (moderation_status=PENDING_ADMIN_REVIEW)
//
// Per Phase 2 contract, all three actions hit POST /api/partner/content/[id]
// with { action, reason?, notes? } body. The endpoint guards ownership + state.
import { useEffect, useState, useCallback } from "react";
import TierBadge from "@/components/tier/TierBadge";
import type { ContentTier } from "@/lib/tier/types";

type PendingPost = {
  id: string;
  hotel_id: string;
  author_id: string;
  media_type: "PHOTO" | "REEL" | "STORY";
  media_url: string;
  thumbnail_url?: string | null;
  caption?: string | null;
  verification_method?: "booking" | "location_otp" | "creator" | "hotel" | null;
  booking_id?: string | null;
  created_at: string;
  author?: {
    id: string;
    username?: string;
    display_name?: string;
    avatar_url?: string | null;
    user_type?: ContentTier;
  } | null;
  hotel_name?: string | null;
};

type ActionState = {
  postId: string;
  kind: "reject" | "escalate" | null;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

export default function PartnerContentTab({ hotelId }: { hotelId: string }) {
  const [posts, setPosts] = useState<PendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>({
    postId: "",
    kind: null,
  });
  const [reasonText, setReasonText] = useState("");
  const [notesText, setNotesText] = useState("");

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const tok =
        typeof window !== "undefined"
          ? localStorage.getItem("sb_partner_token") || ""
          : "";
      const r = await fetch("/api/partner/content/pending", {
        headers: {
          "x-partner-token": tok,
          "x-partner-hotel-id": hotelId,
        },
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j?.error || `Status ${r.status}`);
        setPosts([]);
      } else {
        setPosts(j?.posts || []);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const closeActionModal = () => {
    setActionState({ postId: "", kind: null });
    setReasonText("");
    setNotesText("");
  };

  const submitAction = async (
    postId: string,
    action: "approve" | "reject" | "escalate",
    reason?: string,
    notes?: string
  ) => {
    setBusyId(postId);
    try {
      const tok =
        typeof window !== "undefined"
          ? localStorage.getItem("sb_partner_token") || ""
          : "";
      const r = await fetch(
        `/api/partner/content/${encodeURIComponent(postId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-partner-token": tok,
            "x-partner-hotel-id": hotelId,
          },
          body: JSON.stringify({ action, reason, notes }),
        }
      );
      const j = await r.json();
      if (!r.ok) {
        alert(j?.error || `Action failed (${r.status})`);
        return;
      }
      // Optimistically drop from queue
      setPosts((curr) => curr.filter((p) => p.id !== postId));
      closeActionModal();
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="font-display text-2xl font-light text-luxury-900">
            Content Reviews
          </h2>
          <p className="text-sm text-luxury-400 mt-1">
            Reels &amp; photos tagged to your hotel by verified guests.
            Approve to publish, reject if inappropriate, or escalate if
            unsure.
          </p>
        </div>
        <button
          onClick={fetchPending}
          className="text-xs text-gold-600 font-semibold border border-gold-200 hover:bg-gold-50 px-3 py-2 rounded-lg"
        >
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <div className="text-center py-16 text-luxury-400 text-sm">
          Loading queue…
        </div>
      )}

      {!loading && err && (
        <div className="text-center py-16 text-red-500 text-sm bg-red-50 rounded-2xl border border-red-200">
          {err}
        </div>
      )}

      {!loading && !err && posts.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-luxury-100">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-luxury-800 font-semibold mb-1">
            No pending reviews
          </p>
          <p className="text-xs text-luxury-400">
            When a verified guest uploads content tagged to your hotel,
            it&apos;ll appear here for approval.
          </p>
        </div>
      )}

      {!loading && !err && posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((p) => {
            const handle =
              p.author?.username || p.author?.display_name || "user";
            const tier = (p.author?.user_type as ContentTier) || "PUBLIC";
            const verificationLabel =
              p.verification_method === "booking"
                ? "🎫 Verified Guest (booking)"
                : p.verification_method === "location_otp"
                  ? "📍 Verified Local (on-site OTP)"
                  : null;
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-luxury-100 p-4 sb-card-lift"
              >
                <div className="flex gap-4 items-start">
                  {/* Media thumbnail */}
                  <div
                    className="flex-shrink-0 rounded-xl overflow-hidden bg-luxury-100"
                    style={{
                      width: 110,
                      height: 156,
                      position: "relative",
                    }}
                  >
                    {p.media_type === "PHOTO" ? (
                      <img
                        src={p.thumbnail_url || p.media_url}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <video
                        src={p.media_url}
                        poster={p.thumbnail_url || undefined}
                        muted
                        playsInline
                        preload="metadata"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          background: "#000",
                        }}
                      />
                    )}
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        padding: "2px 6px",
                        background: "rgba(0,0,0,0.55)",
                        color: "#fff",
                        borderRadius: 4,
                      }}
                    >
                      {p.media_type}
                    </span>
                  </div>

                  {/* Meta + actions */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="font-semibold text-sm text-luxury-900">
                        @{handle}
                      </span>
                      <TierBadge tier={tier} size="xs" />
                      <span className="text-xs text-luxury-400">
                        · {timeAgo(p.created_at)}
                      </span>
                    </div>

                    {verificationLabel && (
                      <div className="text-xs text-emerald-700 mb-1.5 font-medium">
                        {verificationLabel}
                      </div>
                    )}

                    {p.caption && (
                      <p className="text-sm text-luxury-700 mb-3 line-clamp-3">
                        {p.caption}
                      </p>
                    )}

                    <div className="flex gap-2 flex-wrap">
                      <button
                        disabled={busyId === p.id}
                        onClick={() => submitAction(p.id, "approve")}
                        className="text-xs font-semibold text-emerald-700 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        ✓ Approve
                      </button>
                      <button
                        disabled={busyId === p.id}
                        onClick={() =>
                          setActionState({ postId: p.id, kind: "reject" })
                        }
                        className="text-xs font-semibold text-red-600 border border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        ✕ Reject
                      </button>
                      <button
                        disabled={busyId === p.id}
                        onClick={() =>
                          setActionState({ postId: p.id, kind: "escalate" })
                        }
                        className="text-xs font-semibold text-amber-700 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        ⚠ Escalate to Admin
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action modal — used for both Reject (reason required) and
          Escalate (optional notes). */}
      {actionState.kind && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeActionModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white max-w-md w-full mx-4 rounded-3xl shadow-luxury-lg p-6"
          >
            <h3 className="font-display text-xl font-light text-luxury-900 mb-2">
              {actionState.kind === "reject"
                ? "Reject content"
                : "Escalate to admin"}
            </h3>
            <p className="text-sm text-luxury-400 mb-4">
              {actionState.kind === "reject"
                ? "The author will be notified with your reason. They can repost with corrected content."
                : "An admin will review and decide. Add optional notes about why you're escalating."}
            </p>
            {actionState.kind === "reject" ? (
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Reason (required)..."
                rows={3}
                className="w-full p-3 rounded-xl border border-luxury-200 text-sm resize-none focus:outline-none focus:border-gold-400"
              />
            ) : (
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Notes for admin (optional)..."
                rows={3}
                className="w-full p-3 rounded-xl border border-luxury-200 text-sm resize-none focus:outline-none focus:border-gold-400"
              />
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={closeActionModal}
                className="flex-1 py-3 rounded-xl border border-luxury-200 text-sm font-semibold text-luxury-600"
              >
                Cancel
              </button>
              <button
                disabled={
                  busyId === actionState.postId ||
                  (actionState.kind === "reject" && !reasonText.trim())
                }
                onClick={() => {
                  if (actionState.kind === "reject") {
                    submitAction(
                      actionState.postId,
                      "reject",
                      reasonText.trim()
                    );
                  } else {
                    submitAction(
                      actionState.postId,
                      "escalate",
                      undefined,
                      notesText.trim() || undefined
                    );
                  }
                }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{
                  background:
                    actionState.kind === "reject"
                      ? "linear-gradient(135deg, #dc2626, #b91c1c)"
                      : "linear-gradient(135deg, #d97706, #b45309)",
                }}
              >
                {actionState.kind === "reject" ? "Reject" : "Escalate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
