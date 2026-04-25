"use client";
/* eslint-disable @next/next/no-img-element */
//
// Guided in-browser recording for tier-based verification videos.
// Used by:
//   - Hotel partner uploading the room proof (type=hotel)
//   - Customer recording complaint evidence    (type=customer)
//
// Hard rules enforced client-side AND re-checked server-side at /api/verify/upload:
//   • Single continuous take inside the app — no file picker fallback
//   • Per-step minimum dwell time before "Next" unlocks
//   • Total duration must hit tier target (60 / 120 / 180s)
//   • Hotel must speak the SB-XXXX code (audio captured for AI to verify)
//   • Platinum requires geo capture (navigator.geolocation)
//
import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Step = { id: string; prompt: string; minSecs: number; required: boolean };
type Cfg = { tier: "silver"|"gold"|"platinum"; durationSecs: number; slaHours: number; steps: Step[] };

function RecordInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const type = (sp.get("type") || "hotel") as "hotel" | "customer";
  const requestId = sp.get("requestId") || "";

  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [code, setCode] = useState<string>("");
  const [stepIdx, setStepIdx] = useState(0);
  const [stepStartedAt, setStepStartedAt] = useState<number>(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordedSecs, setRecordedSecs] = useState(0);
  const [permissionsErr, setPermissionsErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  const videoEl = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  // Tick for elapsed display
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);

  // Load tier config + the verification request to grab the code
  useEffect(() => {
    if (!requestId) return;
    (async () => {
      try {
        const direct = await fetch(`/api/verify/one?id=${requestId}`).catch(() => null);
        let tier: any = "silver"; let codeVal = "";
        if (direct?.ok) {
          const j = await direct.json();
          tier = j.request?.tier || "silver";
          codeVal = j.request?.verification_code || "";
        }
        setCode(codeVal);
        const cfgRes = await fetch(`/api/verify/tier-config?tier=${tier}&code=${encodeURIComponent(codeVal)}`).then((r) => r.json());
        setCfg(cfgRes);
      } catch (e: any) { setErr(e?.message || "Failed to load config"); }
    })();
  }, [requestId]);

  // Geo for platinum
  useEffect(() => {
    if (cfg?.tier === "platinum" && !geo && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setPermissionsErr("Location permission required for Platinum tier"),
      );
    }
  }, [cfg?.tier, geo]);

  const startRecording = async () => {
    setErr(null); setPermissionsErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoEl.current) {
        videoEl.current.srcObject = stream;
        await videoEl.current.play();
      }
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(1000);
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setStepStartedAt(Date.now());
      setRecording(true);
    } catch (e: any) {
      setPermissionsErr(e?.message || "Camera/mic permission denied");
    }
  };

  const advance = () => {
    if (!cfg) return;
    const cur = cfg.steps[stepIdx];
    if (!cur) return;
    const elapsed = (Date.now() - stepStartedAt) / 1000;
    if (elapsed < cur.minSecs) return; // shouldn't happen, button disabled
    setCompleted((c) => Array.from(new Set([...c, cur.id])));
    if (stepIdx + 1 < cfg.steps.length) {
      setStepIdx(stepIdx + 1);
      setStepStartedAt(Date.now());
    } else {
      stopAndUpload();
    }
  };

  const stopAndUpload = async () => {
    if (!recorderRef.current || !cfg) return;
    setUploading(true);
    try {
      const blob: Blob = await new Promise((resolve) => {
        recorderRef.current!.onstop = () => resolve(new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" }));
        recorderRef.current!.stop();
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const totalSecs = Math.round((Date.now() - startedAtRef.current) / 1000);
      setRecordedSecs(totalSecs);

      const fd = new FormData();
      fd.append("file", blob, `${type}-${requestId}.webm`);
      fd.append("requestId", requestId);
      fd.append("type", type);
      fd.append("stepsCompleted", JSON.stringify(completed.concat(cfg.steps[stepIdx]?.id).filter(Boolean)));
      fd.append("actualSecs", String(totalSecs));
      fd.append("verificationCode", code);
      if (geo) fd.append("geo", JSON.stringify(geo));

      // For partners we use the partner token; for customers the customer token.
      const token =
        localStorage.getItem(type === "hotel" ? "sb_partner_token" : "sb_token") ||
        localStorage.getItem("sb_token") || "";

      const r = await fetch("/api/verify/upload", { method: "POST", body: fd, headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");

      // Trigger AI analysis
      await fetch("/api/verify/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });
      setDone(true);
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setUploading(false); }
  };

  // ------- Render --------
  if (!cfg) return <div className="p-12 text-center text-luxury-500">Loading session…</div>;

  const cur = cfg.steps[stepIdx];
  const dwell = recording ? (now - stepStartedAt) / 1000 : 0;
  const stepProgress = cur ? Math.min(100, (dwell / cur.minSecs) * 100) : 0;
  const totalElapsed = recording ? (now - startedAtRef.current) / 1000 : 0;
  const totalProgress = Math.min(100, (totalElapsed / cfg.durationSecs) * 100);
  const canAdvance = !!cur && dwell >= cur.minSecs;

  if (done) {
    return (
      <div className="min-h-screen bg-luxury-900 text-white flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-6xl mb-4">✓</div>
          <h1 className="font-display text-3xl">Recording uploaded</h1>
          <p className="text-white/70 mt-2 text-sm">AI analysis is running. {type === "hotel" ? "The guest will be notified." : "Your evidence is on file."}</p>
          <button onClick={() => router.push(type === "hotel" ? "/partner/dashboard" : "/verification")}
                  className="mt-6 px-7 py-3 rounded-full bg-gradient-to-r from-gold-600 to-gold-500 font-semibold">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-luxury-900 text-white relative">
      <video ref={videoEl} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/10 to-black/80" />

      {/* Header */}
      <div className="relative z-10 p-4 flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest opacity-70">{cfg.tier} · {cfg.durationSecs}s</div>
        <div className="text-sm font-mono">{Math.floor(totalElapsed)}s / {cfg.durationSecs}s</div>
      </div>
      {recording && (
        <div className="relative z-10 px-4">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-gold-500 to-gold-300" style={{ width: `${totalProgress}%` }} />
          </div>
        </div>
      )}

      {/* Center prompt */}
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none px-6">
        {!recording ? (
          <div className="text-center pointer-events-auto">
            <div className="font-display text-3xl mb-2">Ready to record</div>
            <div className="text-white/70 max-w-sm mx-auto text-sm leading-relaxed mb-6">
              You'll be guided through {cfg.steps.length} steps. Don't pause — recording is one single take.
              {cfg.tier === "platinum" && " Geo + timestamp will be auto-captured."}
            </div>
            {permissionsErr && <div className="text-red-300 text-sm mb-3">{permissionsErr}</div>}
            <button onClick={startRecording}
                    className="px-8 py-3.5 rounded-full bg-gradient-to-r from-red-500 to-red-600 font-bold shadow-lg">
              ● Start Recording
            </button>
          </div>
        ) : cur ? (
          <div className="text-center pointer-events-auto bg-black/60 backdrop-blur-md rounded-3xl px-6 py-5 max-w-md border border-white/20">
            <div className="text-xs uppercase tracking-widest text-gold-300 mb-2">Step {stepIdx + 1} of {cfg.steps.length}</div>
            <div className="font-display text-2xl leading-tight">{cur.prompt.replace("{{code}}", code)}</div>
            <div className="mt-4 h-1 w-full bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-gold-400" style={{ width: `${stepProgress}%` }} />
            </div>
            <div className="text-xs mt-2 opacity-70">Hold for at least {cur.minSecs}s</div>
          </div>
        ) : null}
      </div>

      {/* Bottom controls */}
      {recording && cur && (
        <div className="absolute bottom-0 left-0 right-0 z-10 p-5 flex items-center justify-between gap-3 pointer-events-auto">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            REC
          </div>
          <button onClick={advance} disabled={!canAdvance || uploading}
                  className={`px-7 py-3 rounded-full font-semibold transition ${
                    canAdvance ? "bg-gradient-to-r from-gold-500 to-gold-600 text-black" : "bg-white/10 text-white/40"
                  }`}>
            {uploading ? "Uploading…" : stepIdx + 1 === cfg.steps.length ? "Finish & Upload" : "Next →"}
          </button>
        </div>
      )}

      {err && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-red-500/90 text-sm">{err}</div>
      )}
    </div>
  );
}

export default function RecordPage() {
  return <Suspense><RecordInner /></Suspense>;
}
