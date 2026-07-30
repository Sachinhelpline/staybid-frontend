"use client";
// ═══════════════════════════════════════════════════════════════════════════
// Admin → Content Reviews
// ═══════════════════════════════════════════════════════════════════════════
// Cross-hotel queue of social_posts with moderation_status='PENDING_ADMIN_REVIEW'.
// These reached admin because either:
//   - A hotel partner explicitly escalated ("borderline / not sure")
//   - The auto-approve cron escalated instead of auto-approving (future)
//
// Per-post admin actions:
//   - Approve → moderation_status='APPROVED', notifies author
//   - Reject  → moderation_status='REJECTED', reason required, notifies author
//   - Flag    → moderation_status='FLAGGED' (visible to admin only; can later
//                  be unflagged or rejected)
//   - Delete  → moderation_status='DELETED' (soft delete)
//
// Auth: x-admin-token header (sb_admin_token from localStorage). Every
// mutation goes through Phase 2's POST /api/admin/content/[id] which logs
// to admin_audit_log via logAdminAction.
import { useEffect, useState, useCallback } from "react";

type AdminPendingPost = {
  id: string;
  hotel_id: string;
  author_id: string;
  media_type: "PHOTO" | "REEL" | "STORY";
  media_url: string;
  thumbnail_url?: string | null;
  caption?: string | null;
  verification_method?: string | null;
  booking_id?: string | null;
  created_at: string;
  escalated_to_admin_at?: string | null;
  escalated_by?: string | null;
  author?: {
    id: string;
    username?: string;
    display_name?: string;
    avatar_url?: string | null;
    user_type?: string;
    user_id?: string;
  } | null;
  hotel?: { id: string; name?: string; city?: string; ownerId?: string } | null;
};

type ActionKind = "approve" | "reject" | "flag" | "unflag" | "delete";

const COLORS = {
  bg: "#07080C",
  surface: "#0F1117",
  card: "#151820",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.12)",
  text: "#E8EAF0",
  textSoft: "#8A8FA8",
  textMuted: "#5A6175",
  gold: "#9fb1c2",
  goldSoft: "#c6d0da",
  green: "#2ECC71",
  red: "#FF4757",
  amber: "#F0A030",
  blue: "#3D9CF5",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

export default function AdminContentPage() {
  const [posts, setPosts] = useState<AdminPendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    postId: string;
    kind: ActionKind;
  } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [notesText, setNotesText] = useState("");

  const adminHeaders = useCallback((): HeadersInit => {
    const tok =
      typeof window !== "undefined"
        ? localStorage.getItem("sb_admin_token") || ""
        : "";
    const id =
      typeof window !== "undefined"
        ? (() => {
            try {
              const u = JSON.parse(
                localStorage.getItem("sb_admin_user") || "null"
              );
              return u?.id || "";
            } catch {
              return "";
            }
          })()
        : "";
    return {
      ...(tok ? { "x-admin-token": tok } : {}),
      ...(id ? { "x-admin-id": id } : {}),
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/content/pending-review", {
        headers: adminHeaders(),
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
  }, [adminHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const closeAction = () => {
    setActionTarget(null);
    setReasonText("");
    setNotesText("");
  };

  const submitAction = async (
    postId: string,
    action: ActionKind,
    reason?: string,
    notes?: string
  ) => {
    setBusyId(postId);
    try {
      const r = await fetch(
        `/api/admin/content/${encodeURIComponent(postId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...adminHeaders(),
          },
          body: JSON.stringify({ action, reason, notes }),
        }
      );
      const j = await r.json();
      if (!r.ok) {
        alert(j?.error || `Action failed (${r.status})`);
        return;
      }
      // Optimistically drop from queue (it's no longer PENDING_ADMIN_REVIEW)
      setPosts((curr) => curr.filter((p) => p.id !== postId));
      closeAction();
    } catch (e: any) {
      alert(e?.message || "Network error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{
        background: COLORS.bg,
        minHeight: "100vh",
        color: COLORS.text,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        padding: "24px 28px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Syne', system-ui, sans-serif",
              fontSize: "1.7rem",
              fontWeight: 600,
              margin: 0,
              marginBottom: 4,
              color: COLORS.goldSoft,
            }}
          >
            🖼️ Content Reviews
          </h1>
          <p
            style={{
              color: COLORS.textSoft,
              fontSize: "0.85rem",
              margin: 0,
            }}
          >
            Escalations from hotel partners + cross-hotel admin moderation
            queue.
          </p>
        </div>
        <button
          onClick={load}
          style={{
            background: COLORS.surface,
            color: COLORS.gold,
            border: `1px solid ${COLORS.borderStrong}`,
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: "0.82rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {loading && (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: COLORS.textSoft,
            fontSize: "0.9rem",
          }}
        >
          Loading admin queue…
        </div>
      )}

      {!loading && err && (
        <div
          style={{
            padding: "20px 20px",
            background: "rgba(255,71,87,0.08)",
            border: `1px solid rgba(255,71,87,0.25)`,
            borderRadius: 14,
            color: COLORS.red,
            fontSize: "0.88rem",
          }}
        >
          {err}
        </div>
      )}

      {!loading && !err && posts.length === 0 && (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 600, color: COLORS.text, marginBottom: 4 }}>
            No pending admin reviews
          </div>
          <div style={{ color: COLORS.textSoft, fontSize: "0.82rem" }}>
            When a hotel partner escalates content, it&apos;ll appear here.
          </div>
        </div>
      )}

      {!loading && !err && posts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {posts.map((p) => {
            const handle =
              p.author?.username || p.author?.display_name || "user";
            const verificationLabel =
              p.verification_method === "booking"
                ? "🎫 Verified Guest (booking)"
                : p.verification_method === "location_otp"
                  ? "📍 Verified Local (on-site OTP)"
                  : p.verification_method
                    ? p.verification_method
                    : null;
            return (
              <div
                key={p.id}
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 14,
                  padding: 16,
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                {/* Media thumbnail */}
                <div
                  style={{
                    width: 120,
                    height: 168,
                    background: "#000",
                    borderRadius: 10,
                    overflow: "hidden",
                    position: "relative",
                    flexShrink: 0,
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
                      background: "rgba(0,0,0,0.65)",
                      color: "#fff",
                      borderRadius: 4,
                    }}
                  >
                    {p.media_type}
                  </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Header row */}
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{ fontWeight: 700, color: COLORS.text }}
                    >
                      @{handle}
                    </span>
                    {p.author?.user_type && (
                      <span
                        style={{
                          fontSize: "0.66rem",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "rgba(140, 160, 182,0.16)",
                          color: COLORS.goldSoft,
                          border: `1px solid rgba(140, 160, 182,0.30)`,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {p.author.user_type}
                      </span>
                    )}
                    <span style={{ color: COLORS.textMuted, fontSize: "0.75rem" }}>
                      · uploaded {timeAgo(p.created_at)}
                    </span>
                  </div>

                  {/* Hotel + verification */}
                  <div
                    style={{
                      fontSize: "0.82rem",
                      color: COLORS.textSoft,
                      marginBottom: 4,
                    }}
                  >
                    🏨{" "}
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>
                      {p.hotel?.name || "Unknown hotel"}
                    </span>
                    {p.hotel?.city && (
                      <span> · {p.hotel.city}</span>
                    )}
                  </div>
                  {verificationLabel && (
                    <div
                      style={{
                        fontSize: "0.78rem",
                        color: COLORS.green,
                        marginBottom: 6,
                      }}
                    >
                      {verificationLabel}
                    </div>
                  )}

                  {/* Escalation note */}
                  <div
                    style={{
                      fontSize: "0.74rem",
                      color: COLORS.amber,
                      marginBottom: 8,
                    }}
                  >
                    ⚠ Escalated {timeAgo(p.escalated_to_admin_at)}
                    {p.escalated_by && (
                      <span style={{ color: COLORS.textMuted }}>
                        {" "}by {p.escalated_by === "cron" ? "auto-cron" : "hotel partner"}
                      </span>
                    )}
                  </div>

                  {p.caption && (
                    <p
                      style={{
                        fontSize: "0.85rem",
                        color: COLORS.text,
                        lineHeight: 1.5,
                        marginBottom: 12,
                        maxHeight: 80,
                        overflow: "hidden",
                      }}
                    >
                      {p.caption}
                    </p>
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => submitAction(p.id, "approve")}
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: COLORS.green,
                        border: `1px solid rgba(46,204,113,0.35)`,
                        background: "rgba(46,204,113,0.10)",
                        padding: "6px 12px",
                        borderRadius: 8,
                        cursor: busyId === p.id ? "not-allowed" : "pointer",
                        opacity: busyId === p.id ? 0.5 : 1,
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() =>
                        setActionTarget({ postId: p.id, kind: "reject" })
                      }
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: COLORS.red,
                        border: `1px solid rgba(255,71,87,0.35)`,
                        background: "rgba(255,71,87,0.10)",
                        padding: "6px 12px",
                        borderRadius: 8,
                        cursor: busyId === p.id ? "not-allowed" : "pointer",
                        opacity: busyId === p.id ? 0.5 : 1,
                      }}
                    >
                      ✕ Reject
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() =>
                        setActionTarget({ postId: p.id, kind: "flag" })
                      }
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: COLORS.amber,
                        border: `1px solid rgba(240,160,48,0.35)`,
                        background: "rgba(240,160,48,0.10)",
                        padding: "6px 12px",
                        borderRadius: 8,
                        cursor: busyId === p.id ? "not-allowed" : "pointer",
                        opacity: busyId === p.id ? 0.5 : 1,
                      }}
                    >
                      🚩 Flag
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() =>
                        setActionTarget({ postId: p.id, kind: "delete" })
                      }
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: COLORS.textMuted,
                        border: `1px solid ${COLORS.borderStrong}`,
                        background: COLORS.surface,
                        padding: "6px 12px",
                        borderRadius: 8,
                        cursor: busyId === p.id ? "not-allowed" : "pointer",
                        opacity: busyId === p.id ? 0.5 : 1,
                      }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action confirm modal — Reject requires reason; Flag/Delete take optional notes. */}
      {actionTarget && (
        <div
          onClick={closeAction}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 14,
              padding: 22,
              width: "min(480px, 92vw)",
              color: COLORS.text,
            }}
          >
            <h3
              style={{
                fontFamily: "'Syne', system-ui, sans-serif",
                fontSize: "1.3rem",
                fontWeight: 600,
                margin: 0,
                marginBottom: 8,
                color: COLORS.goldSoft,
              }}
            >
              {actionTarget.kind === "reject" && "Reject content"}
              {actionTarget.kind === "flag" && "Flag content"}
              {actionTarget.kind === "delete" && "Delete content"}
            </h3>
            <p
              style={{
                color: COLORS.textSoft,
                fontSize: "0.85rem",
                marginBottom: 14,
                lineHeight: 1.5,
              }}
            >
              {actionTarget.kind === "reject" &&
                "The author will be notified with your reason. Audit-logged."}
              {actionTarget.kind === "flag" &&
                "Hides post from public feed pending re-review. Audit-logged."}
              {actionTarget.kind === "delete" &&
                "Soft-deletes the post (DELETED status). Audit-logged."}
            </p>
            {actionTarget.kind === "reject" && (
              <textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Reason (required)…"
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 10,
                  color: COLORS.text,
                  fontSize: "0.85rem",
                  resize: "none",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            )}
            {(actionTarget.kind === "flag" || actionTarget.kind === "delete") && (
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Admin notes (optional)…"
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.borderStrong}`,
                  borderRadius: 10,
                  color: COLORS.text,
                  fontSize: "0.85rem",
                  resize: "none",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                onClick={closeAction}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  background: "transparent",
                  border: `1px solid ${COLORS.borderStrong}`,
                  color: COLORS.textSoft,
                  borderRadius: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                disabled={
                  busyId === actionTarget.postId ||
                  (actionTarget.kind === "reject" && !reasonText.trim())
                }
                onClick={() => {
                  if (actionTarget.kind === "reject") {
                    submitAction(
                      actionTarget.postId,
                      "reject",
                      reasonText.trim()
                    );
                  } else {
                    submitAction(
                      actionTarget.postId,
                      actionTarget.kind,
                      undefined,
                      notesText.trim() || undefined
                    );
                  }
                }}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  background:
                    actionTarget.kind === "reject"
                      ? COLORS.red
                      : actionTarget.kind === "flag"
                        ? COLORS.amber
                        : COLORS.borderStrong,
                  color:
                    actionTarget.kind === "delete" ? COLORS.text : "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity:
                    busyId === actionTarget.postId ||
                    (actionTarget.kind === "reject" && !reasonText.trim())
                      ? 0.5
                      : 1,
                }}
              >
                {actionTarget.kind === "reject" && "Reject"}
                {actionTarget.kind === "flag" && "Flag"}
                {actionTarget.kind === "delete" && "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
