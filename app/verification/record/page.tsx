"use client";
/* eslint-disable @next/next/no-img-element */
//
// Ultra-modern guided per-step recorder.
//   • Each step records its OWN short blob (auto-stops when minSecs reached)
//   • Customer reviews each segment → can RETRY any step before submitting
//   • Final preview screen shows all segments stitched + total duration
//   • Submit → uploads each segment DIRECTLY to Supabase Storage (bypasses
//     Vercel's 4.5 MB body limit that was causing "Unexpected token 'R'"
//     413 Request-Entity-Too-Large HTML responses)
//   • Server side: /api/verify/finalize receives URLs + metadata only
//
import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Step = { id: string; title: string; title_hi: string; prompt: string; prompt_hi: string;
              minSecs: number; required: boolean; optional?: boolean; ai_checks: string[]; min_pass_score: number };
type Cfg = { tier: "silver"|"gold"|"platinum"; durationSecs: number; slaHours: number; steps: Step[] };
type Segment = { stepId: string; blob: Blob; durationSecs: number; url?: string; storagePath?: string; uploaded?: boolean };

const SUPABASE_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

function RecordInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const type = (sp.get("type") || "hotel") as "hotel" | "customer";
  const requestId = sp.get("requestId") || "";

  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [code, setCode] = useState<string>("");
  const [stepIdx, setStepIdx] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [phase, setPhase] = useState<"idle"|"recording"|"step-done"|"preview"|"uploading"|"done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [permsReady, setPermsReady] = useState(false);

  const videoEl = useRef<HTMLVideoElement | null>(null);
  const previewVideoEl = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stepStartedAtRef = useRef<number>(0);
  const autoStopTimerRef = useRef<any>(null);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(i); }, []);

  // Load cfg + code
  useEffect(() => {
    if (!requestId) return;
    (async () => {
      try {
        const direct = await fetch(`/api/verify/one?id=${requestId}`).then((r) => r.json()).catch(() => null);
        const tier = direct?.request?.tier || "silver";
        const codeVal = direct?.request?.verification_code || "";
        setCode(codeVal);
        const c = await fetch(`/api/verify/tier-config?tier=${tier}&code=${encodeURIComponent(codeVal)}`).then((r) => r.json());
        setCfg(c);
      } catch (e: any) { setErr(e?.message || "Failed to load config"); }
    })();
  }, [requestId]);

  useEffect(() => {
    if (cfg?.tier === "platinum" && !geo && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setErr("Location permission required for Platinum tier")
      );
    }
  }, [cfg?.tier, geo]);

  // Setup camera once
  const ensureStream = async () => {
    if (streamRef.current) return streamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } }, audio: true,
    });
    streamRef.current = stream;
    if (videoEl.current) { videoEl.current.srcObject = stream; videoEl.current.muted = true; await videoEl.current.play(); }
    setPermsReady(true);
    return stream;
  };

  const stopAndSave = (autoTriggered: boolean) => {
    if (!recorderRef.current || !cfg) return;
    if (autoStopTimerRef.current) { clearTimeout(autoStopTimerRef.current); autoStopTimerRef.current = null; }
    const rec = recorderRef.current;
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
      const dur = Math.round((Date.now() - stepStartedAtRef.current) / 1000);
      const stepId = cfg.steps[stepIdx].id;
      setSegments((prev) => {
        // Replace any existing segment for this step (retry support)
        const without = prev.filter((s) => s.stepId !== stepId);
        return [...without, { stepId, blob, durationSecs: dur }];
      });
      setPhase("step-done");
      if (autoTriggered) setInfo("✅ Step recorded. Tap continue or retry.");
    };
    rec.stop();
  };

  const startStep = async (idx: number) => {
    if (!cfg) return;
    setErr(null); setInfo(null);
    setStepIdx(idx);
    try {
      const stream = await ensureStream();
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus"
                 : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(500);
      recorderRef.current = rec;
      stepStartedAtRef.current = Date.now();
      setPhase("recording");
      // Hard cap: minSecs + 8s headroom — auto-stop so customer can move on
      const cap = (cfg.steps[idx].minSecs + 8) * 1000;
      autoStopTimerRef.current = setTimeout(() => stopAndSave(true), cap);
    } catch (e: any) {
      setErr(e?.message || "Camera/mic permission denied");
    }
  };

  const retryStep = (idx: number) => {
    setSegments((prev) => prev.filter((s) => s.stepId !== cfg!.steps[idx].id));
    startStep(idx);
  };

  const continueAfterStep = () => {
    if (!cfg) return;
    if (stepIdx + 1 < cfg.steps.length) {
      // Optional last step — give user the option to skip
      const next = cfg.steps[stepIdx + 1];
      if (next.optional && !confirm(`${next.title} is optional. Record it?`)) {
        finishToPreview();
        return;
      }
      startStep(stepIdx + 1);
    } else {
      finishToPreview();
    }
  };

  const finishToPreview = () => {
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPhase("preview");
  };

  // Direct-to-Supabase upload, one blob per segment. Returns updated segments.
  const uploadAllSegments = async (): Promise<Segment[] | null> => {
    if (!cfg) return null;
    const updated: Segment[] = [];
    for (const seg of segments) {
      try {
        const ext = seg.blob.type.includes("webm") ? "webm" : "mp4";
        const path = `${requestId}/${type}/${seg.stepId}-${Date.now()}.${ext}`;
        const url = `${SUPABASE_URL}/storage/v1/object/verification-videos/${path}`;
        const r = await fetch(url, {
          method: "POST",
          headers: {
            apikey: SUPABASE_ANON,
            Authorization: `Bearer ${SUPABASE_ANON}`,
            "Content-Type": seg.blob.type || "video/webm",
            "x-upsert": "true",
          },
          body: seg.blob,
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`Upload step ${seg.stepId}: ${r.status} ${text.slice(0, 100)}`);
        }
        // Generate a signed URL good for 30 days
        const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/verification-videos/${path}`, {
          method: "POST",
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
          body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 30 }),
        });
        const sj = await sr.json().catch(() => ({}));
        const signed = sj.signedURL || sj.signedUrl;
        const playbackUrl = signed ? `${SUPABASE_URL}/storage/v1${signed}` : url;
        updated.push({ ...seg, url: playbackUrl, storagePath: path, uploaded: true });
      } catch (e: any) {
        setErr(e?.message || `Failed uploading step ${seg.stepId}`);
        return null;
      }
    }
    return updated;
  };

  const submit = async () => {
    if (!cfg) return;
    setPhase("uploading"); setErr(null);
    try {
      const uploaded = await uploadAllSegments();
      if (!uploaded) { setPhase("preview"); return; }
      const totalSecs = uploaded.reduce((s, x) => s + x.durationSecs, 0);
      const token = localStorage.getItem(type === "hotel" ? "sb_partner_token" : "sb_token") || localStorage.getItem("sb_token") || "";
      const r = await fetch("/api/verify/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          requestId, type,
          segments: uploaded.map((s) => ({ stepId: s.stepId, url: s.url, storagePath: s.storagePath, durationSecs: s.durationSecs })),
          totalSecs, verificationCode: code, geo,
        }),
      });
      // Robust JSON parse — never explode on HTML error pages.
      const text = await r.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
      if (!r.ok) { setErr(j.error || `Upload failed (${r.status})`); setPhase("preview"); return; }
      // Trigger AI analysis (fire-and-forget)
      fetch("/api/verify/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) }).catch(() => {});
      setPhase("done");
    } catch (e: any) {
      setErr(e?.message || "Submit failed"); setPhase("preview");
    }
  };

  // ---------- Render ----------
  if (!cfg) return <div className="min-h-screen bg-luxury-900 text-white flex items-center justify-center">Loading session…</div>;

  if (phase === "done") {
    return (
      <div className="min-h-screen bg-luxury-900 text-white flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-6xl mb-4">✓</div>
          <h1 className="font-display text-3xl">Recording uploaded</h1>
          <p className="text-white/70 mt-2 text-sm">AI analysis is running. {type === "hotel" ? "Guest will be notified." : "Your evidence is on file."}</p>
          <button onClick={() => router.push(type === "hotel" ? "/partner/dashboard" : "/verification")}
                  className="mt-6 px-7 py-3 rounded-full bg-gradient-to-r from-gold-600 to-gold-500 font-semibold">Done</button>
        </div>
      </div>
    );
  }

  if (phase === "preview") {
    const total = segments.reduce((s, x) => s + x.durationSecs, 0);
    return (
      <div className="min-h-screen bg-luxury-900 text-white p-5">
        <div className="max-w-md mx-auto">
          <h1 className="font-display text-3xl">Review your recording</h1>
          <p className="text-white/60 text-sm mt-1">Total {total}s · Tier requires {cfg.durationSecs}s</p>
          {total < cfg.durationSecs * 0.9 && (
            <div className="mt-3 p-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-100 text-sm">
              ⚠️ Total below tier minimum. Re-record some steps before submitting.
            </div>
          )}
          <div className="mt-5 space-y-3">
            {cfg.steps.map((step, i) => {
              const seg = segments.find((s) => s.stepId === step.id);
              return (
                <div key={step.id} className="rounded-2xl bg-white/5 border border-white/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-widest text-gold-300">Step {i + 1}{step.optional ? " · Optional" : ""}</div>
                      <div className="font-semibold">{step.title}</div>
                      <div className="text-xs text-white/60">{seg ? `${seg.durationSecs}s recorded` : (step.optional ? "Skipped" : "Not recorded")}</div>
                    </div>
                    {seg && (
                      <video src={URL.createObjectURL(seg.blob)} controls className="w-24 h-16 rounded bg-black object-cover" />
                    )}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => retryStep(i)}
                            className="text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20">{seg ? "↻ Retry" : "● Record"}</button>
                  </div>
                </div>
              );
            })}
          </div>
          {err && <div className="mt-4 text-red-300 text-sm bg-red-500/20 border border-red-400/30 rounded-xl p-3">{err}</div>}
          <button onClick={submit}
                  disabled={segments.filter((s) => cfg.steps.find((st) => st.id === s.stepId)?.required).length < cfg.steps.filter((s) => s.required).length}
                  className="mt-5 w-full py-3.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-600 font-bold text-black disabled:opacity-50">
            Submit verification
          </button>
        </div>
      </div>
    );
  }

  if (phase === "uploading") {
    return (
      <div className="min-h-screen bg-luxury-900 text-white flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full border-4 border-gold-300 border-t-gold-600 animate-spin"></div>
          <p className="mt-4 text-white/80">Uploading {segments.length} segments to Supabase…</p>
          <p className="text-xs text-white/50 mt-1">Direct upload (no Vercel 4.5 MB limit)</p>
        </div>
      </div>
    );
  }

  // idle / recording / step-done
  const cur = cfg.steps[stepIdx];
  const dwell = phase === "recording" ? (now - stepStartedAtRef.current) / 1000 : 0;
  const stepProgress = cur ? Math.min(100, (dwell / cur.minSecs) * 100) : 0;
  const totalSoFar = segments.reduce((s, x) => s + x.durationSecs, 0) + dwell;

  return (
    <div className="min-h-screen bg-luxury-900 text-white relative overflow-hidden">
      <video ref={videoEl} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/10 to-black/80" />

      {/* Header */}
      <div className="relative z-10 p-4 flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest opacity-70">{cfg.tier} · {cfg.durationSecs}s · {segments.length}/{cfg.steps.length}</div>
        <div className="text-sm font-mono">{Math.floor(totalSoFar)}s / {cfg.durationSecs}s</div>
      </div>
      <div className="relative z-10 px-4">
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300 transition-all" style={{ width: `${Math.min(100, (totalSoFar / cfg.durationSecs) * 100)}%` }} />
        </div>
      </div>

      {/* Center prompt */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none px-6">
        {phase === "idle" && (
          <div className="text-center pointer-events-auto bg-black/60 backdrop-blur-md rounded-3xl px-6 py-6 max-w-md border border-white/15">
            <div className="font-display text-3xl mb-2">Ready to record</div>
            <div className="text-white/70 text-sm leading-relaxed mb-5">
              {cfg.steps.length} guided steps. Each step auto-stops when its target time is reached — you can retry any step before submitting.
              {cfg.tier === "platinum" && " Geo + timestamp auto-captured."}
            </div>
            <button onClick={() => startStep(0)}
                    className="px-8 py-3.5 rounded-full bg-gradient-to-r from-red-500 to-red-600 font-bold shadow-lg active:scale-95 transition">
              ● Start Step 1
            </button>
          </div>
        )}

        {phase === "recording" && cur && (
          <div className="text-center pointer-events-auto bg-black/60 backdrop-blur-md rounded-3xl px-6 py-5 max-w-md border border-white/20">
            <div className="text-xs uppercase tracking-widest text-gold-300 mb-2 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Recording · Step {stepIdx + 1}
            </div>
            <div className="font-display text-2xl leading-tight">{cur.prompt.replace("{{code}}", code)}</div>
            <div className="text-xs text-white/60 mt-1">{cur.prompt_hi.replace("{{code}}", code)}</div>
            <div className="mt-4 h-1 w-full bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-gold-400 transition-all" style={{ width: `${stepProgress}%` }} />
            </div>
            <div className="text-xs mt-2 opacity-70">{Math.floor(dwell)}s / hold {cur.minSecs}s · auto-stops at {cur.minSecs + 8}s</div>
            <button onClick={() => stopAndSave(false)}
                    disabled={dwell < Math.min(2, cur.minSecs * 0.3)}
                    className="mt-4 px-6 py-2 rounded-full bg-white/15 hover:bg-white/25 font-semibold text-sm disabled:opacity-40">
              ⏹ Stop & save step
            </button>
          </div>
        )}

        {phase === "step-done" && cur && (
          <div className="text-center pointer-events-auto bg-black/70 backdrop-blur-md rounded-3xl px-6 py-6 max-w-md border border-emerald-400/40">
            <div className="text-emerald-300 text-3xl mb-1">✓</div>
            <div className="font-display text-xl">{cur.title} captured</div>
            <div className="text-xs text-white/60 mt-1">{segments.find((s) => s.stepId === cur.id)?.durationSecs}s recorded</div>
            <div className="mt-5 flex gap-2 justify-center">
              <button onClick={() => retryStep(stepIdx)} className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 font-semibold text-sm">↻ Retry</button>
              <button onClick={continueAfterStep} className="px-6 py-2.5 rounded-full bg-gradient-to-r from-gold-500 to-gold-600 text-black font-bold text-sm">
                {stepIdx + 1 < cfg.steps.length ? `Next → ${cfg.steps[stepIdx + 1].title}` : "Review & submit"}
              </button>
            </div>
            <button onClick={finishToPreview} className="mt-3 text-xs text-white/50 hover:text-white">Finish here & review</button>
          </div>
        )}
      </div>

      {info && phase === "step-done" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-emerald-500/90 text-sm">{info}</div>
      )}
      {err && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-red-500/90 text-sm max-w-sm">{err}</div>
      )}
    </div>
  );
}

export default function RecordPage() {
  return <Suspense><RecordInner /></Suspense>;
}
