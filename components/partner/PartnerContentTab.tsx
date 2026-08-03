"use client";
// ═══════════════════════════════════════════════════════════════════════════
// PartnerContentTab — hotel-partner "Guest Content" view.
// ═══════════════════════════════════════════════════════════════════════════
// v160 — the hotel no longer gates guest content. A guest with a confirmed,
// checked-out booking publishes content directly (the booking ID is the
// proof). This tab is now READ-ONLY: it shows the published reels & photos
// guests have posted about the hotel.
//
// The only action available is "🚩 Report" — if a post is abusive/fake the
// partner reports it (reason required) and it is escalated to admin
// (moderation_status=PENDING_ADMIN_REVIEW), which immediately takes it off
// the public feed pending admin review. The hotel cannot block a publish on
// its own.
//
// Reads  GET  /api/partner/content/pending  (published guest content)
// Posts  POST /api/partner/content/[id]     ({ action: "report", reason })
// Auth: x-partner-token (sb_partner_token) + x-partner-hotel-id.
import { useEffect, useState, useCallback } from "react";
import { RotateCw, Camera, Ticket, MapPin, Flag } from "lucide-react";
import TierBadge from "@/components/tier/TierBadge";
import { modalPortal } from "@/lib/partner/modal-portal";
import type { ContentTier } from "@/lib/tier/types";

type GuestPost = {
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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

export default function PartnerContentTab({ hotelId }: { hotelId: string }) {
  const [posts, setPosts] = useState<GuestPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string>("");
  const [reasonText, setReasonText] = useState("");

  const fetchContent = useCallback(async () => {
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
      setErr(e?.message || "Failed to load guest content");
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const closeReportModal = () => {
    setReportId("");
    setReasonText("");
  };

  const submitReport = async (postId: string, reason: string) => {
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
          body: JSON.stringify({ action: "report", reason }),
        }
      );
      const j = await r.json();
      if (!r.ok) {
        alert(j?.error || `Report failed (${r.status})`);
        return;
      }
      // Reported posts leave the public feed → drop from this read-only list
      setPosts((curr) => curr.filter((p) => p.id !== postId));
      closeReportModal();
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
            Guest Content
          </h2>
          <p className="text-sm text-luxury-400 mt-1">
            Reels &amp; photos guests have posted about your hotel. Verified
            guests (with a confirmed booking) publish directly — no approval
            needed. See something abusive or fake? Report it and our team
            reviews it.
          </p>
        </div>
        <button
          onClick={fetchContent}
          className="text-xs text-gold-600 font-semibold border border-gold-200 hover:bg-gold-50 px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
        >
          <RotateCw size={13} strokeWidth={2.3} aria-hidden />Refresh
        </button>
      </div>

      {loading && (
        <div className="text-center py-16 text-luxury-400 text-sm">
          Loading guest content…
        </div>
      )}

      {!loading && err && (
        <div className="text-center py-16 text-red-500 text-sm bg-red-50 rounded-2xl border border-red-200">
          {err}
        </div>
      )}

      {!loading && !err && posts.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-luxury-100">
          <div className="w-16 h-16 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center mx-auto mb-3">
            <Camera size={24} strokeWidth={1.9} aria-hidden className="text-gold-600" />
          </div>
          <p className="text-luxury-800 font-semibold mb-1">
            No guest content yet
          </p>
          <p className="text-xs text-luxury-400">
            When a guest posts a reel or photo about their stay, it shows up
            here automatically.
          </p>
        </div>
      )}

      {!loading && !err && posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((p) => {
            const handle =
              p.author?.username || p.author?.display_name || "user";
            const tier = (p.author?.user_type as ContentTier) || "PUBLIC";
            const verification =
              p.verification_method === "booking"
                ? { Ic: Ticket, text: "Verified Guest (booking)" }
                : p.verification_method === "location_otp"
                  ? { Ic: MapPin, text: "Verified Local (on-site OTP)" }
                  : null;
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-luxury-100 p-4 sb-card-lift"
              >
                <div className="flex gap-4 items-start">
                  {/* Media thumbnail */}
                  <div
                    className="shrink-0 rounded-xl overflow-hidden bg-luxury-100"
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

                  {/* Meta + report */}
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

                    {verification && (
                      <div className="text-xs text-emerald-700 mb-1.5 font-medium inline-flex items-center gap-1">
                        <verification.Ic size={12} strokeWidth={2.3} aria-hidden />{verification.text}
                      </div>
                    )}

                    <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden />Live on feed
                    </div>

                    {p.caption && (
                      <p className="text-sm text-luxury-700 mb-3 line-clamp-3">
                        {p.caption}
                      </p>
                    )}

                    <div className="flex gap-2 flex-wrap">
                      <button
                        disabled={busyId === p.id}
                        onClick={() => setReportId(p.id)}
                        className="text-xs font-semibold text-red-600 border border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        <Flag size={12} strokeWidth={2.3} aria-hidden />Report to admin
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Report modal — reason required. Reporting escalates the post to
          admin and removes it from the public feed pending review. */}
      {reportId && modalPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
          onClick={closeReportModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white max-w-md w-full mx-4 rounded-3xl shadow-luxury-lg p-6"
          >
            <h3 className="font-display text-xl font-light text-luxury-900 mb-2">
              Report this content
            </h3>
            <p className="text-sm text-luxury-400 mb-4">
              The post will be taken off the public feed and an admin will
              review it. Tell us what&apos;s wrong — abusive, fake, not your
              hotel, etc.
            </p>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Reason (required)..."
              rows={3}
              className="w-full p-3 rounded-xl border border-luxury-200 bg-white text-luxury-900 text-sm resize-none focus:outline-hidden focus:border-gold-400"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={closeReportModal}
                className="flex-1 py-3 rounded-xl border border-luxury-200 text-sm font-semibold text-luxury-600"
              >
                Cancel
              </button>
              <button
                disabled={busyId === reportId || !reasonText.trim()}
                onClick={() => submitReport(reportId, reasonText.trim())}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                }}
              >
                Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
