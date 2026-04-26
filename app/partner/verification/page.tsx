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

  if (loading) return <div className="p-12 text-center text-luxury-500">Loading…</div>;
  if (!partner?.hotel) return <div className="p-12 text-center text-luxury-500">No hotel found.</div>;

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-luxury-900">Verification & Complaints</h1>
            <p className="text-sm text-luxury-500 mt-1">{partner.hotel.name} · {partner.hotel.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => partner?.hotel?.id && load(partner.hotel.id, true)}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-full bg-luxury-100 text-luxury-700 hover:bg-luxury-200 disabled:opacity-50">
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
            <Link href="/partner/dashboard" className="text-sm text-luxury-500 hover:text-gold-700">← Dashboard</Link>
          </div>
        </div>

        <div className="flex gap-2 mb-5 border-b border-luxury-200">
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
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              active ? "border-gold-500 text-gold-800" : "border-transparent text-luxury-500 hover:text-luxury-800"
            }`}>
      {children}
    </button>
  );
}

function PendingList({ items }: { items: any[] }) {
  if (!items.length) return <Empty t="No pending verification requests." />;
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <div key={r.id} className="card-luxury p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-gold-700 font-bold">{r.tier} · {r.required_secs}s</div>
            <div className="font-semibold text-luxury-900 mt-0.5">Booking {String(r.booking_id).slice(0, 14)}…</div>
            <div className="text-xs text-luxury-500">Code: <span className="font-mono font-bold">{r.verification_code}</span> · Due {new Date(r.due_by).toLocaleString("en-IN")}</div>
          </div>
          <Link href={`/verification/record?type=hotel&requestId=${r.id}`}
                className="btn-luxury text-sm whitespace-nowrap">Start Recording →</Link>
        </div>
      ))}
    </div>
  );
}

function SubmittedList({ items }: { items: any[] }) {
  if (!items.length) return <Empty t="No submitted videos yet." />;
  return (
    <div className="space-y-3">
      {items.map((r) => <SubmittedRow key={r.id} r={r} />)}
    </div>
  );
}

function SubmittedRow({ r }: { r: any }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch(`/api/verify/status/${r.booking_id}`).then((x) => x.json()).then(setData).catch(() => {});
  }, [r.booking_id]);
  return (
    <div className="card-luxury p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-gold-700 font-bold">{r.tier}</div>
          <div className="font-semibold text-luxury-900">Booking {String(r.booking_id).slice(0, 14)}…</div>
          <div className="text-xs text-luxury-500">Status: {r.status}</div>
        </div>
        {data?.report && (
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${
            data.report.trust_score >= 80 ? "bg-emerald-100 text-emerald-800" :
            data.report.trust_score >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
          }`}>
            Trust {data.report.trust_score}/100
          </div>
        )}
      </div>
      {data?.hotelVideo && (
        <div className="mt-3"><AdaptiveVideoPlayer src={data.hotelVideo.url} urls={data.hotelVideo.urls} className="w-full aspect-video" /></div>
      )}
    </div>
  );
}

function ComplaintList({ items, requests }: { items: any[]; requests: any[] }) {
  if (!items.length) return <Empty t="No complaints raised." />;
  return (
    <div className="space-y-4">
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
    <div className="card-luxury p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-red-700 font-bold">{c.category || "complaint"} · {c.status}</div>
          <div className="font-semibold text-luxury-900 mt-0.5">Booking {String(c.booking_id).slice(0, 14)}…</div>
          <div className="text-xs text-luxury-500 mt-1 max-w-xl">{c.description}</div>
        </div>
        {c.resolution && <span className="px-2 py-0.5 text-xs bg-luxury-100 rounded-full text-luxury-700">→ {c.resolution}</span>}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <SideVideo title="Hotel proof" video={hotelVid} />
        <SideVideo title="Guest evidence" video={evidence} />
      </div>

      {/* AI Verdict block (only visible after /api/verify/dispute runs) */}
      {c.ai_verdict ? (
        <div className={`mt-3 p-3 rounded-2xl border ${verdictColor}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">
              AI Verdict: {c.ai_verdict.replace("_", " ")} · confidence {c.ai_confidence}%
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
        <div className="mt-3 flex items-center justify-between gap-2 p-3 rounded-2xl bg-luxury-50 border border-luxury-200">
          <div className="text-xs text-luxury-700">Run AI dispute analysis to compare both videos.</div>
          <button onClick={runAi} disabled={busy} className="text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-600 text-white font-bold disabled:opacity-50">
            {busy ? "Analysing…" : "🧠 Run AI Analysis"}
          </button>
        </div>
      )}

      {c.status === "open" && (
        <div className="mt-3 flex flex-wrap gap-2 justify-end">
          <button onClick={() => resolve("refund")}        disabled={busy} className="px-4 py-2 text-xs rounded-full bg-red-600 text-white">Full Refund</button>
          <button onClick={() => resolve("partial_refund")} disabled={busy} className="px-4 py-2 text-xs rounded-full bg-amber-500 text-white">Partial Refund</button>
          <button onClick={() => resolve("replacement")}    disabled={busy} className="px-4 py-2 text-xs rounded-full bg-blue-600 text-white">Replacement</button>
          <button onClick={() => resolve("denied")}         disabled={busy} className="px-4 py-2 text-xs rounded-full bg-luxury-200 text-luxury-800">Deny</button>
        </div>
      )}
    </div>
  );
}

function SideVideo({ title, video }: { title: string; video: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-luxury-500 mb-1">{title}</div>
      {video ? (
        <AdaptiveVideoPlayer src={video.url} urls={video.urls} className="w-full aspect-video" />
      ) : (
        <div className="rounded-xl bg-luxury-100 aspect-video flex items-center justify-center text-luxury-400 text-xs">No video</div>
      )}
    </div>
  );
}

function Empty({ t }: { t: string }) {
  return <div className="card-luxury p-8 text-center text-luxury-500">{t}</div>;
}
