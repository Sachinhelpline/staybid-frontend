"use client";
//
// v170 — Camera QR / barcode scanner for the partner panel.
//
// Lets a front-desk employee scan a guest's StayPoints reward code directly
// with the device camera (phone / tablet) instead of typing it. Uses the
// native BarcodeDetector API — zero npm dependency. Degrades gracefully:
//   • Chrome / Edge on Android  → live camera scan
//   • Safari / Firefox          → "use manual entry" message (no crash)
//   • permission denied / no cam → clear error, manual entry still works
//
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Compass, X } from "lucide-react";
import { modalPortal } from "@/lib/partner/modal-portal";

type Props = {
  onDetected: (code: string) => void;
  buttonClassName?: string;
  buttonLabel?: string;
};

// Formats we ask the detector for. Filtered against the device's real
// supported list at runtime so an unsupported value never throws.
const WANT_FORMATS = [
  "qr_code", "code_128", "code_39", "code_93", "codabar",
  "ean_13", "ean_8", "itf", "upc_a", "upc_e",
  "data_matrix", "aztec", "pdf417",
];

type Status = "idle" | "starting" | "scanning" | "error" | "unsupported";

export default function CodeScanner({ onDetected, buttonClassName, buttonLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");

  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const rafRef      = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const lastTickRef = useRef(0);
  const doneRef     = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch {} }
  }, []);

  const close = useCallback(() => {
    stop();
    setOpen(false);
    setStatus("idle");
    setErrMsg("");
    doneRef.current = false;
  }, [stop]);

  const handleHit = useCallback((raw: string) => {
    if (doneRef.current) return;
    const code = (raw || "").trim();
    if (!code) return;
    doneRef.current = true;
    try { (navigator as any).vibrate?.(60); } catch {}
    stop();
    setOpen(false);
    setStatus("idle");
    onDetected(code);
  }, [onDetected, stop]);

  const tick = useCallback(async () => {
    const v = videoRef.current;
    const det = detectorRef.current;
    if (!v || !det || doneRef.current) return;
    const now = performance.now();
    // Throttle detection to ~4.5 fps — plenty for a steady code, easy on CPU.
    if (now - lastTickRef.current > 220 && v.readyState >= 2) {
      lastTickRef.current = now;
      try {
        const codes = await det.detect(v);
        if (codes && codes.length) { handleHit(codes[0].rawValue); return; }
      } catch { /* transient detect error — keep looping */ }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [handleHit]);

  const start = useCallback(async () => {
    doneRef.current = false;
    setOpen(true);
    setStatus("starting");
    setErrMsg("");

    const BD = typeof window !== "undefined" ? (window as any).BarcodeDetector : undefined;
    if (!BD) { setStatus("unsupported"); return; }

    try {
      let formats = WANT_FORMATS;
      try {
        const sup: string[] = await BD.getSupportedFormats();
        if (sup?.length) {
          const f = WANT_FORMATS.filter((x) => sup.includes(x));
          if (f.length) formats = f;
        }
      } catch {}
      detectorRef.current = new BD({ formats });
    } catch {
      try { detectorRef.current = new BD(); }
      catch { setStatus("unsupported"); return; }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrMsg("Camera is not available on this device.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { stop(); return; }
      v.srcObject = stream;
      v.setAttribute("playsinline", "true");
      await v.play().catch(() => {});
      setStatus("scanning");
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setStatus("error");
      setErrMsg(
        e?.name === "NotAllowedError" || e?.name === "SecurityError"
          ? "Camera permission denied. Allow camera access in your browser and try again."
          : e?.name === "NotFoundError"
          ? "No camera found on this device."
          : "Could not start the camera."
      );
    }
  }, [stop, tick]);

  // Hard cleanup if the component unmounts mid-scan.
  useEffect(() => () => stop(), [stop]);

  return (
    <>
      <button type="button" onClick={start} className={buttonClassName || "btn-gold"}>
        {buttonLabel || <span className="inline-flex items-center gap-1.5"><Camera size={14} strokeWidth={2.3} aria-hidden />Scan with Camera</span>}
      </button>

      {open && modalPortal(
        <div
          className="fixed inset-0 z-200 flex items-center justify-center p-4"
          style={{ background: "rgba(10,8,5,0.93)", backdropFilter: "blur(4px)" }}
          onClick={close}
        >
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-white font-display text-lg">Scan guest code</p>
              <button
                onClick={close}
                aria-label="Close scanner"
                className="w-8 h-8 rounded-full bg-white/12 text-white flex items-center justify-center hover:bg-white/20 transition"
              ><X size={17} strokeWidth={2.4} aria-hidden /></button>
            </div>

            <div className="scan-frame">
              <video ref={videoRef} muted playsInline />
              {status === "scanning" && (<><div className="scan-reticle" /><div className="scan-laser" /></>)}
              {status === "starting" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-9 h-9 rounded-full border-2 border-gold-400 border-t-transparent animate-spin" />
                </div>
              )}
              {(status === "error" || status === "unsupported") && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                  {status === "unsupported"
                    ? <Compass size={30} strokeWidth={1.8} aria-hidden className="mb-2 text-white/90" />
                    : <Camera size={30} strokeWidth={1.8} aria-hidden className="mb-2 text-white/90" />}
                  <p className="text-white/90 text-sm font-semibold leading-snug">
                    {status === "unsupported"
                      ? "Live camera scan needs Chrome or Edge (Android works best)."
                      : errMsg}
                  </p>
                  <p className="text-white/55 text-xs mt-2">You can still type the code manually below.</p>
                </div>
              )}
            </div>

            {status === "scanning" && (
              <p className="text-white/65 text-xs text-center mt-2.5">
                Hold the QR / barcode steady inside the frame
              </p>
            )}
            <button
              onClick={close}
              className="btn-ghost w-full mt-2.5"
              style={{ background: "rgba(255,255,255,0.1)", color: "#fff", borderColor: "rgba(255,255,255,0.22)" }}
            >
              {status === "scanning" ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
