"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import AdaptiveVideoPlayer from "@/components/AdaptiveVideoPlayer";

type Booking = {
  id: string; bidId?: string; hotelId: string; hotelName?: string;
  status?: string; checkIn?: string; checkOut?: string;
};

const TIER_BADGE: Record<string, string> = {
  silver:   "bg-slate-200 text-slate-800",
  gold:     "bg-gold-100 text-gold-900 border-gold-300",
  platinum: "bg-gradient-to-r from-purple-500 to-indigo-500 text-white",
};

export default function VerificationPage() {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tier, setTier] = useState<"silver"|"gold"|"platinum">("silver");
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
      const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";
      const [bRes, biRes] = await Promise.all([
        fetch(`${API}/api/bookings/my`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch(`${API}/api/bids/my`,     { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      const bks: Booking[] = (bRes?.bookings || []).map((b: any) => ({
        id: b.id, hotelId: b.hotelId, hotelName: b.hotel?.name,
        status: b.status, checkIn: b.checkIn, checkOut: b.checkOut,
      }));
      const bids = (biRes?.bids || [])
        // Newest accepted/confirmed first so brand-new bookings surface at top.
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        .sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .map((b: any) => ({
          id: b.id, bidId: b.id, hotelId: b.hotelId, hotelName: b.hotel?.name,
          status: b.status, checkIn: b.request?.checkIn, checkOut: b.request?.checkOut,
        }));
      const merged = [...bks, ...bids].reduce<Booking[]>((acc, b) => {
        if (!acc.find((x) => x.hotelId === b.hotelId && x.checkIn === b.checkIn)) acc.push(b);
        return acc;
      }, []);
      setBookings(merged);

      try {
        const tr = await fetch("/api/users/me/tier", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (tr.ok) {
          const tj = await tr.json();
          if (tj?.tier) setTier(tj.tier);
        }
      } catch {}

      const sm: Record<string, any> = {};
      await Promise.all(merged.map(async (b) => {
        try {
          const s = await fetch(`/api/verify/status/${b.id}`, { cache: "no-store" }).then((r) => r.json());
          sm[b.id] = s;
        } catch {}
      }));
      setStatusByBooking(sm);
    } catch (e: any) { setErr(e?.message || "Failed to load"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) { router.push("/auth"); return; }
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

  if (authLoading || loading) {
    return <div className="max-w-4xl mx-auto p-12 text-center text-luxury-500">Loading…</div>;
  }

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-luxury-900">Requests, Complaints & Verification</h1>
            <p className="text-sm text-luxury-500 mt-1">Hotel-recorded room proofs · raise complaints with video evidence</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadAll(true)}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-full bg-luxury-100 text-luxury-700 hover:bg-luxury-200 disabled:opacity-50"
              aria-label="Refresh">
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${TIER_BADGE[tier]}`}>
              {tier} member
            </span>
          </div>
        </div>

        {err && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        {bookings.length === 0 ? (
          <div className="card-luxury p-10 text-center">
            <div className="text-5xl mb-3">🎬</div>
            <div className="font-display text-2xl text-luxury-900">No confirmed bookings yet</div>
            <p className="text-luxury-500 text-sm mt-2">Verification videos are available after a booking is confirmed.</p>
            <Link href="/hotels" className="btn-luxury mt-5 inline-block">Browse hotels</Link>
          </div>
        ) : (
          <div className="space-y-4">
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
    <div className="card-luxury p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-luxury-900">{booking.hotelName || "Hotel"}</div>
          <div className="text-xs text-luxury-500 mt-1">
            {booking.checkIn && new Date(booking.checkIn).toLocaleDateString("en-IN", { day:"numeric", month:"short" })}
            {booking.checkOut && ` → ${new Date(booking.checkOut).toLocaleDateString("en-IN",{ day:"numeric", month:"short" })}`}
            {" · "}{booking.id.slice(0, 12)}…
          </div>
        </div>
        <StatusBadge r={r} report={report} />
      </div>

      {!r && (
        <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-luxury-50 border border-luxury-100">
          <div className="text-sm text-luxury-700">Request a {tier === "platinum" ? 180 : tier === "gold" ? 120 : 60}s verification video from the hotel.</div>
          <button onClick={requestVideo} disabled={busy} className="btn-luxury text-sm whitespace-nowrap disabled:opacity-50">
            {busy ? "Requesting…" : "Request Verification Video"}
          </button>
        </div>
      )}

      {r && r.status === "pending" && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
          ⏳ Hotel has up to <span className="font-bold">{Math.max(0, Math.round((new Date(r.due_by).getTime() - Date.now()) / 3600000))} hrs</span> to upload your verification video.
          <div className="text-xs mt-1 font-mono">Code they must speak: <span className="font-bold">{r.verification_code}</span></div>
        </div>
      )}

      {r && (r.status === "uploaded" || r.status === "verified") && hotelVideo && (
        <VideoPanel video={hotelVideo} report={report} bookingId={booking.id} hotelId={booking.hotelId} requestId={r.id} />
      )}

      {err && <div className="mt-3 text-sm text-red-700">{err}</div>}
    </div>
  );
}

function StatusBadge({ r, report }: { r: any; report: any }) {
  if (!r) return <span className="text-xs px-2.5 py-1 rounded-full bg-luxury-100 text-luxury-600">Not requested</span>;
  if (r.status === "verified") {
    const score = report?.trust_score ?? 0;
    return <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${score >= 80 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>Verified · {score}/100</span>;
  }
  if (r.status === "rejected") return <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-800 font-bold">Flagged</span>;
  if (r.status === "uploaded") return <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">Uploaded</span>;
  return <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">Pending</span>;
}

function VideoPanel({ video, report, bookingId, hotelId, requestId }: any) {
  const checks = report?.checks || {};
  const checklist = [
    { key: "code_ok",     label: "Verification code spoken" },
    { key: "ocr_room",    label: "Room number visible" },
    { key: "ocr_booking", label: "Booking ID confirmed" },
    { key: "scene_match", label: "Scene matches expected room", custom: () => (checks.scene_match ?? 0) >= 0.7 },
    { key: "duration_ok", label: "Tier duration met" },
    { key: "geo_ok",      label: "Geo-tag valid" },
  ];
  return (
    <div className="mt-4 space-y-3">
      <AdaptiveVideoPlayer src={video.url} urls={video.urls} className="w-full aspect-video" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {report ? (
          <div className="card-luxury p-3 text-xs">
            <div className="font-display text-base text-gold-700 mb-2">AI Trust Score: {report.trust_score}/100</div>
            <div className="space-y-1">
              {checklist.map((c) => {
                const ok = c.custom ? c.custom() : checks[c.key];
                if (ok === undefined) return null;
                return (
                  <div key={c.key} className="flex items-center gap-2">
                    <span className={ok ? "text-emerald-600" : "text-red-500"}>{ok ? "✓" : "✗"}</span>
                    <span className="text-luxury-700">{c.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="card-luxury p-3 text-xs text-luxury-500">AI report pending…</div>
        )}
        <ComplaintTrigger bookingId={bookingId} hotelId={hotelId} requestId={requestId} tier={video.tier} />
      </div>
    </div>
  );
}

function ComplaintTrigger({ bookingId, hotelId, requestId, tier }: any) {
  return (
    <div className="card-luxury p-3 text-xs">
      <div className="font-semibold text-luxury-900 mb-1">Mismatch from what you got?</div>
      <p className="text-luxury-600 leading-relaxed">Record a {tier === "platinum" ? 180 : tier === "gold" ? 120 : 60}s evidence video showing the issue.</p>
      <Link href={`/verification/record?type=customer&requestId=${requestId}&bookingId=${bookingId}&hotelId=${hotelId}`}
            className="mt-2 inline-block text-gold-700 font-semibold hover:underline">Report Issue →</Link>
    </div>
  );
}

function TierExplainer({ tier }: { tier: string }) {
  return (
    <div className="mt-10 card-luxury p-5 bg-gradient-to-br from-luxury-50 to-gold-50/40">
      <div className="font-display text-lg text-luxury-900 mb-2">Your tier benefits</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { t: "silver", d: 60,  hrs: 24 },
          { t: "gold",   d: 120, hrs: 12 },
          { t: "platinum", d: 180, hrs: 4 },
        ].map((row) => (
          <div key={row.t} className={`p-3 rounded-xl border ${tier === row.t ? "border-gold-400 bg-gold-50" : "border-luxury-100 bg-white"}`}>
            <div className="font-bold uppercase tracking-wider text-luxury-700">{row.t}</div>
            <div className="text-luxury-500 mt-1">{row.d}s video · {row.hrs}h SLA</div>
          </div>
        ))}
      </div>
    </div>
  );
}
