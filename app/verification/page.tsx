"use client";
/* eslint-disable @next/next/no-img-element */
import { RotateCw, Clapperboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import AdaptiveVideoPlayer from "@/components/AdaptiveVideoPlayer";
import StayFeedbackCard, { isPostCheckout } from "@/components/StayFeedbackCard";
import TrustRing from "@/components/verify/TrustRing";
import VerifChecklist from "@/components/verify/VerifChecklist";
import VerifStatusFlow from "@/components/verify/VerifStatusFlow";
import { CountUp } from "@/components/CountUp";
// v142 — Phase-6 verification tour. 2 steps: bookings list → request video.
import { usePageTour } from "@/lib/tutorial/usePageTour";

type Booking = {
  id: string; bidId?: string; hotelId: string; hotelName?: string;
  status?: string; checkIn?: string; checkOut?: string;
};

const TIER_BADGE: Record<string, string> = {
  silver:   "bg-slate-200 text-slate-800",
  gold:     "bg-gold-100 text-gold-900 border-gold-300",
  platinum: "bg-linear-to-r from-purple-500 to-indigo-500 text-white",
};

export default function VerificationPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tier, setTier] = useState<"silver"|"gold"|"platinum">("silver");
  // v142 — Phase 6 verification tour. delayMs:1300 so the bookings
  // list populates from /api/verification/bookings before fire.
  usePageTour("verify", "verify", { delayMs: 1300 });
  const [statusByBooking, setStatusByBooking] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // BUG-FIX 3: extract the loader so it can be re-invoked on visibility/focus
  // and via a manual Refresh button. Previously this fired only once on mount,
  // so a brand-new booking made elsewhere never appeared until a hard reload.
  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setErr(null);
    try {
      // BULLETPROOF (v3): single Supabase-DIRECT endpoint replaces
      // Railway-bridged fetch + per-booking /verify/status loop. Works
      // for Firebase + backend tokens, never drops a fresh booking,
      // ships verification + AI report in one round-trip.
      if (user?.id) {
        try {
          await fetch("/api/verify/backfill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId: user.id }),
          });
        } catch {}
      }
      if (!user?.id) { setLoading(false); setRefreshing(false); return; }
      const direct = await fetch(
        `/api/my/verification-bookings?customerId=${encodeURIComponent(user.id)}`,
        { cache: "no-store" }
      ).then((r) => r.json()).catch(() => ({ bookings: [] }));

      const merged: Booking[] = (direct.bookings || []).map((b: any) => ({
        id: b.id, bidId: b.bidId, hotelId: b.hotelId, hotelName: b.hotelName,
        status: b.status, checkIn: b.checkIn, checkOut: b.checkOut,
      }));
      setBookings(merged);

      // Build the status-by-booking map directly from the same response.
      const sm: Record<string, any> = {};
      for (const b of (direct.bookings || [])) {
        if (b.verification) {
          sm[b.id] = {
            request: {
              id: b.verification.requestId,
              status: b.verification.status,
              tier: b.verification.tier,
              required_secs: b.verification.requiredSecs,
              verification_code: b.verification.verificationCode,
              due_by: b.verification.dueBy,
              hotel_video_id: b.verification.hotelVideo?.id || null,
              customer_video_id: b.verification.customerVideo?.id || null,
            },
            hotelVideo:    b.verification.hotelVideo,
            customerVideo: b.verification.customerVideo,
            report:        b.verification.report,
          };
        }
      }
      setStatusByBooking(sm);

      try {
        const tr = await fetch("/api/users/me/tier", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (tr.ok) {
          const tj = await tr.json();
          if (tj?.tier) setTier(tj.tier);
        }
      } catch {}
    } catch (e: any) { setErr(e?.message || "Failed to load"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { redirectToSignIn(router, { route: "/verification" }); return; }
    loadAll(false);
  }, [user, token, authLoading, router, loadAll]);

  // BUG-FIX 3: re-fetch when the tab regains visibility / window focus, so a
  // booking made in another tab (or a confirmation that lands while this page
  // is hidden) appears without a manual reload.
  useEffect(() => {
    if (!user || !token) return;
    const onVis = () => { if (document.visibilityState === "visible") loadAll(true); };
    const onFocus = () => loadAll(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, token, loadAll]);

  // Summary counts for the premium hero strip.
  const summary = useMemo(() => {
    let verified = 0, pending = 0, awaiting = 0, avgScore = 0, scored = 0;
    for (const b of bookings) {
      const s = statusByBooking[b.id];
      const r = s?.request;
      if (!r) { awaiting++; continue; }
      if (r.status === "verified") { verified++; }
      else if (r.status === "pending" || r.status === "uploaded") { pending++; }
      if (s?.report?.trust_score != null) { avgScore += s.report.trust_score; scored++; }
    }
    return { verified, pending, awaiting, avg: scored ? Math.round(avgScore / scored) : 0, scored };
  }, [bookings, statusByBooking]);

  if (authLoading || loading) {
    return <div className="max-w-4xl mx-auto p-12 text-center text-luxury-500">Loading…</div>;
  }

  return (
    <div className="lux-bg verif-root min-h-screen">
      <div className="max-w-4xl mx-auto px-5 py-10">
        {/* ── Premium hero ─────────────────────────────────────────── */}
        <div className="sb-fade-in relative overflow-hidden rounded-3xl p-6 mb-6"
             style={{
               background: "linear-gradient(135deg, var(--cozy-warm-dark,#1F1A0F) 0%, #2A2417 60%, #3a2f18 100%)",
               boxShadow: "0 18px 40px -18px rgba(31,26,15,0.55)",
             }}>
          <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-30"
               style={{ background: "radial-gradient(circle, rgba(106,133,160,0.55), transparent 70%)" }} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-2"
                   style={{ background: "rgba(106,133,160,0.16)", border: "1px solid rgba(106,133,160,0.3)" }}>
                <span className="sb-pulse-dot" style={{ background: "#5f7c98" }} />
                <span className="text-[0.62rem] font-bold tracking-[0.18em] uppercase" style={{ color: "#c8d2dc" }}>Stay Verification</span>
              </div>
              <h1 className="font-display text-[1.7rem] sm:text-3xl leading-tight" style={{ color: "#f4f6f8" }}>
                Room proofs &amp; complaints
              </h1>
              <p className="text-sm mt-1" style={{ color: "rgba(176, 192, 209,0.62)" }}>
                Hotels record what they promised. AI scores it. You stay protected.
              </p>
            </div>
            <button
              onClick={() => loadAll(true)}
              disabled={refreshing}
              className="shrink-0 text-xs px-3 py-1.5 rounded-full transition-all disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.08)", color: "#c8d2dc", border: "1px solid rgba(106,133,160,0.28)" }}
              aria-label="Refresh">
              {refreshing ? "Refreshing…" : <><RotateCw size={13} strokeWidth={2.4} aria-hidden style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 5 }} /> Refresh</>}
            </button>
          </div>

          {/* stat strip */}
          <div className="relative grid grid-cols-4 gap-2 mt-5">
            {[
              { label: "Verified", value: summary.verified, c: "#9DB07F" },
              { label: "In progress", value: summary.pending, c: "#c8d2dc" },
              { label: "Awaiting", value: summary.awaiting, c: "#becad5" },
              { label: "Avg trust", value: summary.avg, suffix: summary.scored ? "" : "", c: "#5f7c98", isScore: true },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl px-3 py-2.5 text-center"
                   style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-xl font-bold" style={{ color: s.c, fontVariantNumeric: "tabular-nums" }}>
                  <CountUp value={s.value} duration={900} />{s.isScore && summary.scored ? <span className="text-[0.65rem] opacity-70">/100</span> : null}
                </div>
                <div className="text-[0.6rem] uppercase tracking-wider mt-0.5" style={{ color: "rgba(176, 192, 209,0.5)" }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div className="relative mt-4 flex items-center justify-between">
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 ${TIER_BADGE[tier]}`}>
              <span className="sb-pulse-dot is-warn" style={{ background: tier === "platinum" ? "#A855F7" : tier === "gold" ? "#8198ae" : "#94a3b8" }} />
              {tier} member
            </span>
            <Link href="/trust" className="text-[0.68rem]" style={{ color: "rgba(176, 192, 209,0.8)" }}>How it works →</Link>
          </div>
        </div>

        {err && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        {bookings.length === 0 ? (
          <div className="card-luxury sb-card-lift sb-fade-in p-10 text-center">
            <div className="mb-3"><Clapperboard size={40} strokeWidth={2} aria-hidden style={{ display: "inline-block", color: "#8198ae" }} /></div>
            <div className="font-display text-2xl text-luxury-900">No confirmed bookings yet</div>
            <p className="text-luxury-500 text-sm mt-2">Verification videos are available after a booking is confirmed.</p>
            <Link href="/hotels" className="btn-luxury mt-5 inline-block sb-card-lift">Browse hotels</Link>
          </div>
        ) : (
          <div className="space-y-4 sb-stagger">
            {bookings.map((b) => (
              <BookingCard key={b.id} booking={b} status={statusByBooking[b.id]} tier={tier}
                           onRefresh={async () => {
                             const s = await fetch(`/api/verify/status/${b.id}`).then((r) => r.json());
                             setStatusByBooking((sm) => ({ ...sm, [b.id]: s }));
                           }} />
            ))}
          </div>
        )}

        <TierExplainer tier={tier} />
      </div>
    </div>
  );
}

function BookingCard({ booking, status, tier, onRefresh }: { booking: Booking; status: any; tier: string; onRefresh: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = status?.request;
  const report = status?.report;
  const hotelVideo = status?.hotelVideo;
  const flagged = r?.status === "rejected";

  const requestVideo = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/verify/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingId: booking.id, bidId: booking.bidId, hotelId: booking.hotelId, tier }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await onRefresh();
    } catch (e: any) { setErr(e?.message || "Request failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="card-luxury sb-card-lift p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-display text-lg font-semibold text-luxury-900 truncate">{booking.hotelName || "Hotel"}</div>
          <div className="text-xs text-luxury-500 mt-1">
            {booking.checkIn && new Date(booking.checkIn).toLocaleDateString("en-IN", { day:"numeric", month:"short" })}
            {booking.checkOut && ` → ${new Date(booking.checkOut).toLocaleDateString("en-IN",{ day:"numeric", month:"short" })}`}
            {" · "}{booking.id.slice(0, 12)}…
          </div>
        </div>
        <StatusBadge r={r} report={report} />
      </div>

      {/* premium progress rail (only once a request exists) */}
      {r && (
        <div className="mt-4 px-1">
          <VerifStatusFlow status={r.status} hasReport={!!report} flagged={flagged} tone="light" />
        </div>
      )}

      {!r && (
        <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-[22px] bg-luxury-50 border border-luxury-100">
          <div className="text-sm text-luxury-700">Request a {tier === "platinum" ? 180 : tier === "gold" ? 120 : 60}s verification video from the hotel.</div>
          <button onClick={requestVideo} disabled={busy} className="btn-luxury text-sm whitespace-nowrap disabled:opacity-50">
            {busy ? "Requesting…" : "Request Verification Video"}
          </button>
        </div>
      )}

      {r && r.status === "pending" && (
        <div className="mt-4 p-3 rounded-[22px] bg-amber-50 border border-amber-200 text-sm text-amber-900">
          ⏳ Hotel has up to <span className="font-bold">{Math.max(0, Math.round((new Date(r.due_by).getTime() - Date.now()) / 3600000))} hrs</span> to upload your verification video.
          <div className="text-xs mt-1 font-mono">Code they must speak: <span className="font-bold">{r.verification_code}</span></div>
        </div>
      )}

      {r && (r.status === "uploaded" || r.status === "verified") && hotelVideo && (
        <VideoPanel
          video={hotelVideo}
          report={report}
          bookingId={booking.bidId || booking.id}
          hotelId={booking.hotelId}
          requestId={r.id}
          hotelName={booking.hotelName}
          postCheckout={isPostCheckout({ status: booking.status, checkOut: booking.checkOut })}
        />
      )}

      {/* v127 — Post-checkout smiley feedback. */}
      {isPostCheckout({ status: booking.status, checkOut: booking.checkOut }) && (
        <StayFeedbackCard
          bidId={booking.bidId || booking.id}
          hotelName={booking.hotelName || "this stay"}
          hotelId={booking.hotelId}
          verificationRequestId={r?.id}
          checkOut={booking.checkOut}
        />
      )}

      {err && <div className="mt-3 text-sm text-red-700">{err}</div>}
    </div>
  );
}

function StatusBadge({ r, report }: { r: any; report: any }) {
  if (!r) return <span className="text-xs px-2.5 py-1 rounded-full bg-luxury-100 text-luxury-600 shrink-0">Not requested</span>;
  if (r.status === "verified") {
    const score = report?.trust_score ?? 0;
    return <span className={`text-xs px-2.5 py-1 rounded-full font-bold shrink-0 tabular-nums ${score >= 80 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>Verified · {score}/100</span>;
  }
  if (r.status === "rejected") return <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-800 font-bold shrink-0">Flagged</span>;
  if (r.status === "uploaded") return <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 shrink-0">Uploaded</span>;
  return <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 shrink-0">Pending</span>;
}

function VideoPanel({ video, report, bookingId, hotelId, requestId, hotelName, postCheckout }: any) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl overflow-hidden border border-luxury-100 bg-black/5">
        <AdaptiveVideoPlayer src={video.url} urls={video.urls} className="w-full aspect-video" />
      </div>
      {report ? (
        <div className="verif-report rounded-2xl p-4 border border-luxury-100"
             style={{ background: "linear-gradient(135deg, var(--cozy-cream-50,#fcfcfd), var(--cozy-cream-200,#e7ebef))" }}>
          <div className="flex items-center gap-4">
            <TrustRing score={report.trust_score ?? 0} size={92} tone="light" />
            <div className="min-w-0 flex-1">
              <div className="text-[0.62rem] font-bold tracking-widest uppercase text-gold-700">AI Trust Report</div>
              <div className="font-display text-lg text-luxury-900 leading-tight mt-0.5">
                {report.trust_score >= 80 ? "Room matches the promise" : report.trust_score >= 50 ? "Mostly verified" : "Needs a closer look"}
              </div>
              {Array.isArray(report.issues_detected) && report.issues_detected.length > 0 && (
                <div className="text-xs text-luxury-500 mt-1">{report.issues_detected[0]}</div>
              )}
            </div>
          </div>
          <div className="mt-3">
            <VerifChecklist checks={report.checks} tone="light" columns={2} />
          </div>
        </div>
      ) : (
        <div className="card-luxury p-3 text-xs text-luxury-500">AI report pending…</div>
      )}

      {/* v127.2 — Mid-stay complaint composer (only before checkout). */}
      {!postCheckout && (
        <StayFeedbackCard
          mode="mid_stay"
          bidId={bookingId}
          hotelName={hotelName || "this hotel"}
          hotelId={hotelId}
          verificationRequestId={requestId}
        />
      )}
    </div>
  );
}

function TierExplainer({ tier }: { tier: string }) {
  return (
    <div className="mt-10 card-luxury sb-fade-in p-5"
      style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--bg-card))" }}>
      <div className="font-display text-lg text-luxury-900 mb-3">Your tier benefits</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { t: "silver", d: 60,  hrs: 24, emoji: "🥈" },
          { t: "gold",   d: 120, hrs: 12, emoji: "🥇" },
          { t: "platinum", d: 180, hrs: 4, emoji: "💎" },
        ].map((row) => (
          <div key={row.t} className={`p-3 rounded-2xl border sb-card-lift transition-all ${tier === row.t ? "border-gold-400 bg-gold-50 shadow-sm" : "border-luxury-100 bg-white"}`}>
            <div className="text-base mb-0.5">{row.emoji}</div>
            <div className="font-bold uppercase tracking-wider text-luxury-700">{row.t}</div>
            <div className="text-luxury-500 mt-1">{row.d}s video · {row.hrs}h SLA</div>
          </div>
        ))}
      </div>
    </div>
  );
}
