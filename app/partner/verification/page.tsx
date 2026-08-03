"use client";
/* eslint-disable @next/next/no-img-element */
//
// Partner-side Verification panel
//   • Tab 1 – Pending Proofs   : video requests awaiting hotel recording
//   • Tab 2 – Submitted Proofs : already recorded, AI report attached
//   • Tab 3 – Complaints       : guest evidence side-by-side with hotel video
//
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdaptiveVideoPlayer from "@/components/AdaptiveVideoPlayer";
import TrustRing from "@/components/verify/TrustRing";
import VerifChecklist from "@/components/verify/VerifChecklist";
import VerifStatusFlow from "@/components/verify/VerifStatusFlow";
import { CountUp } from "@/components/CountUp";

type Tab = "pending" | "submitted" | "complaints";

export default function PartnerVerification() {
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [requests, setRequests] = useState<any[]>([]);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // BUG-FIX 3: extract loader so it can be re-invoked on focus / refresh.
  // BULLETPROOF (v2): also call /api/verify/backfill so any newly-accepted
  // bid for this hotel auto-gets a vp_request. The partner doesn't have to
  // wait for the customer to click "Request Verification Video".
  const load = useCallback(async (hotelId: string, silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      try {
        await fetch("/api/verify/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hotelId }),
        });
      } catch {}
      const [rs, cs] = await Promise.all([
        fetch(`/api/verify/list?role=partner&id=${hotelId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/verify/complaint?hotelId=${hotelId}`,    { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      setRequests(rs.requests || []);
      setComplaints(cs.complaints || []);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    const u = localStorage.getItem("sb_partner_user");
    if (!u) { router.push("/partner"); return; }
    const parsed = JSON.parse(u);
    setPartner(parsed);
    const hotelId = parsed.hotel?.id;
    if (!hotelId) { setLoading(false); return; }
    load(hotelId, false);

    const onVis = () => { if (document.visibilityState === "visible") load(hotelId, true); };
    const onFocus = () => load(hotelId, true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, load]);

  const pending   = useMemo(() => requests.filter((r) => r.status === "pending"), [requests]);
  const submitted = useMemo(() => requests.filter((r) => r.status === "uploaded" || r.status === "verified" || r.status === "rejected"), [requests]);
  const openComplaints = useMemo(() => complaints.filter((c) => c.status === "open").length, [complaints]);

  if (loading) return <div className="pdash-root p-12 text-center text-luxury-500">Loading…</div>;
  if (!partner?.hotel) return <div className="pdash-root p-12 text-center text-luxury-500">No hotel found.</div>;

  return (
    <div className="bg-luxury-50 min-h-screen pdash-root">
      {/* premium dark navbar — matches the partner dashboard */}
      <nav className="sticky top-0 z-40" style={{ background: "linear-gradient(180deg,#1c140a,#13100a)", borderBottom: "1px solid rgba(140, 160, 182,0.16)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-5 flex items-center justify-between" style={{ height: "56px" }}>
          <Link href="/partner/dashboard" className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", boxShadow: "0 2px 8px rgba(106, 133, 160,0.4)" }}>S</div>
            <div className="min-w-0">
              <span className="font-display text-base text-white tracking-wide">StayBid</span>
              <span className="ml-1.5 text-[0.63rem] font-bold text-amber-400/75 tracking-[0.18em] uppercase">Partner</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => partner?.hotel?.id && load(partner.hotel.id, true)}
              disabled={refreshing}
              className="text-[0.68rem] text-white/60 hover:text-white border border-white/10 hover:border-white/25 px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50">
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
            <Link href="/partner/dashboard"
              className="text-[0.68rem] text-white/55 hover:text-amber-300 border border-white/10 hover:border-amber-400/40 px-2.5 py-1.5 rounded-lg transition-all">
              ← Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 sm:px-5 py-6">
        {/* ── Premium header ─────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-3xl p-5 mb-5"
             style={{ background: "linear-gradient(135deg,#1c140a 0%,#241a0c 55%,#33260f 100%)", boxShadow: "0 16px 36px -18px rgba(0,0,0,0.6)" }}>
          <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full opacity-30"
               style={{ background: "radial-gradient(circle, rgba(140, 160, 182,0.5), transparent 70%)" }} />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-2"
                   style={{ background: "rgba(140, 160, 182,0.14)", border: "1px solid rgba(140, 160, 182,0.3)" }}>
                <span className="sb-pulse-dot" style={{ background: "#a9b9c8" }} />
                <span className="text-[0.63rem] font-bold tracking-[0.18em] uppercase text-amber-200">Verification &amp; Complaints</span>
              </div>
              <h1 className="font-display text-2xl text-white leading-tight truncate">{partner.hotel.name}</h1>
              <p className="text-[0.78rem] text-white/50 mt-0.5">{partner.hotel.id}</p>
            </div>
          </div>
          <div className="relative grid grid-cols-3 gap-2 mt-4">
            {[
              { label: "Pending", value: pending.length, c: "#c6d0da" },
              { label: "Submitted", value: submitted.length, c: "#9DB07F" },
              { label: "Open complaints", value: openComplaints, c: openComplaints ? "#e6a0a0" : "#a4b4c5" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl px-3 py-2.5 text-center"
                   style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-xl font-bold" style={{ color: s.c, fontVariantNumeric: "tabular-nums" }}>
                  <CountUp value={s.value} duration={850} />
                </div>
                <div className="text-[0.63rem] uppercase tracking-wider mt-0.5 text-white/45">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-1.5 mb-4 overflow-x-auto">
          <TabBtn active={tab === "pending"}    onClick={() => setTab("pending")}>
            Pending Proofs · {pending.length}
          </TabBtn>
          <TabBtn active={tab === "submitted"}  onClick={() => setTab("submitted")}>
            Submitted · {submitted.length}
          </TabBtn>
          <TabBtn active={tab === "complaints"} onClick={() => setTab("complaints")}>
            Complaints · {complaints.length}
          </TabBtn>
        </div>

        {tab === "pending"    && <PendingList items={pending} />}
        {tab === "submitted"  && <SubmittedList items={submitted} />}
        {tab === "complaints" && <ComplaintList items={complaints} requests={requests} />}
      </div>
    </div>
  );
}

function TabBtn({ active, children, onClick }: any) {
  return (
    <button onClick={onClick}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[0.78rem] font-semibold transition-all ${
              active ? "text-white" : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-100"
            }`}
            style={active ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", boxShadow: "0 4px 12px rgba(106, 133, 160,0.32)" } : undefined}>
      {children}
    </button>
  );
}

function PendingList({ items }: { items: any[] }) {
  if (!items.length) return <Empty t="No pending verification requests." emoji="📭" />;
  return (
    <div className="space-y-3 sb-stagger">
      {items.map((r) => {
        const hrsLeft = r.due_by ? Math.max(0, Math.round((new Date(r.due_by).getTime() - Date.now()) / 3600000)) : null;
        const urgent = hrsLeft != null && hrsLeft <= 6;
        return (
          <div key={r.id} className="card-luxury sb-card-lift p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[0.63rem] uppercase tracking-widest text-gold-700 font-bold px-2 py-0.5 rounded-full bg-gold-50 border border-gold-200">{r.tier} · {r.required_secs}s</span>
                  {hrsLeft != null && (
                    <span className={`text-[0.63rem] font-bold px-2 py-0.5 rounded-full ${urgent ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                      ⏳ {hrsLeft}h left
                    </span>
                  )}
                </div>
                <div className="font-semibold text-luxury-900 mt-1.5">Booking {String(r.booking_id).slice(0, 14)}…</div>
                <div className="text-xs text-luxury-500 mt-0.5">Speak this code on camera: <span className="font-mono font-bold text-luxury-800 bg-luxury-100 px-1.5 py-0.5 rounded">{r.verification_code}</span></div>
              </div>
              <Link href={`/verification/record?type=hotel&requestId=${r.id}`}
                    className="btn-luxury text-sm whitespace-nowrap sb-card-lift">● Start Recording</Link>
            </div>
            <div className="mt-3 px-1"><VerifStatusFlow status="pending" tone="light" /></div>
          </div>
        );
      })}
    </div>
  );
}

function SubmittedList({ items }: { items: any[] }) {
  if (!items.length) return <Empty t="No submitted videos yet." emoji="🎬" />;
  return (
    <div className="space-y-3 sb-stagger">
      {items.map((r) => <SubmittedRow key={r.id} r={r} />)}
    </div>
  );
}

function SubmittedRow({ r }: { r: any }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`/api/verify/status/${r.booking_id}`).then((x) => x.json()).then(setData).catch(() => {});
  }, [r.booking_id]);
  const report = data?.report;
  const flagged = r.status === "rejected";
  return (
    <div className="card-luxury sb-card-lift p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[0.63rem] uppercase tracking-widest text-gold-700 font-bold px-2 py-0.5 rounded-full bg-gold-50 border border-gold-200">{r.tier}</span>
          <div className="font-semibold text-luxury-900 mt-1.5">Booking {String(r.booking_id).slice(0, 14)}…</div>
          <div className="text-xs text-luxury-500 mt-0.5">Status: {r.status}</div>
        </div>
        {report?.trust_score != null && <TrustRing score={report.trust_score} size={76} tone="light" />}
      </div>

      <div className="mt-3 px-1"><VerifStatusFlow status={r.status} hasReport={!!report} flagged={flagged} tone="light" /></div>

      {data?.hotelVideo && (
        <div className="mt-3 rounded-2xl overflow-hidden border border-luxury-100 bg-black/5">
          <AdaptiveVideoPlayer src={data.hotelVideo.url} urls={data.hotelVideo.urls} className="w-full aspect-video" />
        </div>
      )}
      {report?.checks && (
        <div className="mt-3"><VerifChecklist checks={report.checks} tone="light" columns={2} /></div>
      )}
    </div>
  );
}

function ComplaintList({ items, requests }: { items: any[]; requests: any[] }) {
  if (!items.length) return <Empty t="No complaints raised." emoji="🛟" />;
  return (
    <div className="space-y-4 sb-stagger">
      {items.map((c) => <ComplaintCard key={c.id} c={c} requests={requests} />)}
    </div>
  );
}

function ComplaintCard({ c, requests }: { c: any; requests: any[] }) {
  const [evidence, setEvidence] = useState<any>(null);
  const [hotelVid, setHotelVid] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const req = requests.find((r: any) => r.booking_id === c.booking_id);
    Promise.all([
      c.evidence_video_id ? fetch(`/api/verify/status/${c.booking_id}`).then((r) => r.json()).then((d) => d?.customerVideo) : Promise.resolve(null),
      req?.hotel_video_id ? fetch(`/api/verify/status/${c.booking_id}`).then((r) => r.json()).then((d) => d?.hotelVideo) : Promise.resolve(null),
    ]).then(([cv, hv]) => { setEvidence(cv); setHotelVid(hv); });
  }, [c.id, c.booking_id, c.evidence_video_id, requests]);

  const resolve = async (resolution: string) => {
    if (!confirm(`Mark this complaint as "${resolution}"?`)) return;
    setBusy(true);
    try {
      await fetch("/api/verify/complaint", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, status: "resolved", resolution }),
      });
      window.location.reload();
    } finally { setBusy(false); }
  };

  const runAi = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/verify/dispute", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaintId: c.id }),
      });
      if (!r.ok) { alert("Analysis failed"); return; }
      window.location.reload();
    } finally { setBusy(false); }
  };

  const verdictColor =
    c.ai_verdict === "customer_correct" ? "bg-red-50 border-red-200 text-red-900" :
    c.ai_verdict === "hotel_correct"    ? "bg-emerald-50 border-emerald-200 text-emerald-900" :
    c.ai_verdict === "inconclusive"     ? "bg-amber-50 border-amber-200 text-amber-900" : "";

  return (
    <div className="card-luxury sb-card-lift p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[0.63rem] uppercase tracking-widest text-red-700 font-bold">{c.category || "complaint"} · {c.status}</div>
          <div className="font-semibold text-luxury-900 mt-0.5">Booking {String(c.booking_id).slice(0, 14)}…</div>
          <div className="text-xs text-luxury-500 mt-1 max-w-xl">{c.description}</div>
        </div>
        {c.resolution && <span className="px-2 py-0.5 text-xs bg-luxury-100 rounded-full text-luxury-700 shrink-0">→ {c.resolution}</span>}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <SideVideo title="Hotel proof" video={hotelVid} />
        <SideVideo title="Guest evidence" video={evidence} />
      </div>

      {/* AI Verdict block (only visible after /api/verify/dispute runs) */}
      {c.ai_verdict ? (
        <div className={`mt-3 p-3 rounded-2xl border ${verdictColor}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-semibold">
              🤖 AI Verdict: {c.ai_verdict.replace("_", " ")} · confidence {c.ai_confidence}%
            </div>
            {c.auto_approvable && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900">Auto-approvable</span>}
          </div>
          {Array.isArray(c.discrepancies) && c.discrepancies.length > 0 && (
            <ul className="mt-2 text-xs space-y-0.5 list-disc pl-5">
              {c.discrepancies.map((d: any, i: number) => <li key={i}>{d.message}</li>)}
            </ul>
          )}
          {c.recommended_resolution && (
            <div className="text-xs mt-2 opacity-80">Recommended: <span className="font-bold">{c.recommended_resolution}</span></div>
          )}
        </div>
      ) : c.status === "open" && (
        <div className="mt-3 flex items-center justify-between gap-2 p-3 rounded-2xl bg-luxury-50 border border-luxury-200 flex-wrap">
          <div className="text-xs text-luxury-700">Run AI dispute analysis to compare both videos.</div>
          <button onClick={runAi} disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-linear-to-r from-gold-500 to-gold-600 text-white font-bold disabled:opacity-50 sb-card-lift">
            {busy ? "Analysing…" : "🧠 Run AI Analysis"}
          </button>
        </div>
      )}

      {c.status === "open" && (
        <div className="mt-3 flex flex-wrap gap-2 justify-end">
          <button onClick={() => resolve("refund")}        disabled={busy} className="px-4 py-2 text-xs rounded-full bg-red-600 text-white sb-card-lift">Full Refund</button>
          <button onClick={() => resolve("partial_refund")} disabled={busy} className="px-4 py-2 text-xs rounded-full bg-amber-500 text-white sb-card-lift">Partial Refund</button>
          <button onClick={() => resolve("replacement")}    disabled={busy} className="px-4 py-2 text-xs rounded-full bg-blue-600 text-white sb-card-lift">Replacement</button>
          <button onClick={() => resolve("denied")}         disabled={busy} className="px-4 py-2 text-xs rounded-full bg-luxury-200 text-luxury-800 sb-card-lift">Deny</button>
        </div>
      )}
    </div>
  );
}

function SideVideo({ title, video }: { title: string; video: any }) {
  return (
    <div>
      <div className="text-[0.63rem] uppercase tracking-widest text-luxury-500 mb-1.5 font-bold">{title}</div>
      {video ? (
        <div className="rounded-xl overflow-hidden border border-luxury-100 bg-black/5">
          <AdaptiveVideoPlayer src={video.url} urls={video.urls} className="w-full aspect-video" />
        </div>
      ) : (
        <div className="rounded-xl bg-luxury-100 aspect-video flex items-center justify-center text-luxury-400 text-xs border border-luxury-100">No video</div>
      )}
    </div>
  );
}

function Empty({ t, emoji = "✨" }: { t: string; emoji?: string }) {
  return (
    <div className="card-luxury sb-fade-in p-10 text-center text-luxury-500">
      <div className="text-4xl mb-2">{emoji}</div>
      {t}
    </div>
  );
}
