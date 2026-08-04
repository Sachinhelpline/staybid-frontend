"use client";
// v283 Gap 3 — worker panel sign-in. Phone OTP (Railway) → /api/worker/login
// resolves the workforce_workers row by phone. Approved → dashboard; pending →
// "under review"; not registered → apply. Session stored as sb_worker_token /
// sb_worker (separate from customer / partner / admin sessions).

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Wrench, ClipboardList, BadgeCheck } from "lucide-react";

export default function WorkerLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ kind: "pending" | "notreg"; status?: string } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("sb_worker_token")) router.replace("/worker/dashboard");
  }, [router]);

  const sendOtp = async () => {
    if (phone.length < 10) return setError("Enter a valid 10-digit mobile number.");
    setLoading(true); setError(""); setNotice(null);
    try {
      const res = await fetch("/api/proxy/api/auth/send-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: `+91${phone}` }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send OTP");
      setStep("otp");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) return setError("Enter the OTP you received.");
    setLoading(true); setError(""); setNotice(null);
    try {
      const res = await fetch("/api/proxy/api/auth/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: `+91${phone}`, otp }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Incorrect OTP");
      const token = d.token || d.accessToken;

      const lr = await fetch("/api/worker/login", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const ld = await lr.json();

      if (lr.status === 404 || ld.registered === false) { setNotice({ kind: "notreg" }); return; }
      if (!ld.approved) { setNotice({ kind: "pending", status: ld.status }); return; }

      localStorage.setItem("sb_worker_token", token);
      localStorage.setItem("sb_worker", JSON.stringify(ld.worker));
      router.replace("/worker/dashboard");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={wrap}>
      {/* v693 — desktop split-screen. Below lg the brand pane hides and the
          card fills the width, centred (byte-identical to the old layout).
          Presentation only — no auth logic changed. */}
      <style>{`
        .wauth-form { flex: 1 1 100%; display: flex; align-items: flex-start; justify-content: center; padding: 40px 14px; min-width: 0; }
        .wauth-brand { display: none; }
        .wauth-brand-inner { max-width: 420px; }
        .wauth-brand-tag { font-family: var(--font-display,'Cormorant Garamond',serif); font-size: clamp(1.9rem,2.7vw,2.7rem); line-height: 1.1; font-weight: 600; margin: 0 0 15px; color: #f6f0e4; }
        .wauth-brand-sub { font-size: 0.95rem; line-height: 1.6; color: rgba(240,233,220,0.8); margin: 0 0 26px; max-width: 360px; }
        .wauth-brand-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 13px; }
        .wauth-brand-list li { display: flex; align-items: center; gap: 12px; font-size: 0.9rem; color: rgba(240,233,220,0.9); }
        .wauth-brand-list li svg { color: #e6c98a; flex-shrink: 0; }
        @media (min-width: 1024px) {
          .wauth-brand { display: flex; align-items: center; flex: 1 1 54%; min-width: 0; padding: 48px 5vw; position: relative; overflow: hidden;
            background: radial-gradient(120% 85% at 12% 8%, rgba(150,120,70,0.20), transparent 58%), linear-gradient(155deg,#2b2419 0%,#1c160d 55%,#120d07 100%); }
          .wauth-form { flex: 1 1 46%; padding-top: 0; align-items: center; }
        }
      `}</style>

      {/* Desktop-only brand pane (fixed warm-walnut, reads in both themes). */}
      <aside className="wauth-brand" aria-hidden="true">
        <div className="wauth-brand-inner">
          <div style={{ marginBottom: 18 }}><Wrench size={30} strokeWidth={2} aria-hidden style={{ color: "var(--accent)" }} /></div>
          <h2 className="wauth-brand-tag">Your jobs.<br />One place.</h2>
          <p className="wauth-brand-sub">Sign in to see the jobs hotels have assigned you, track your work, and manage your workforce profile.</p>
          <ul className="wauth-brand-list">
            <li><ClipboardList size={18} aria-hidden /><span>See every job hotels assign to you</span></li>
            <li><Wrench size={18} aria-hidden /><span>Track work &amp; update your status</span></li>
            <li><BadgeCheck size={18} aria-hidden /><span>Build your verified worker profile</span></li>
          </ul>
        </div>
      </aside>

      <div className="wauth-form">
      <div style={card} className="sb-fade-in">
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div><Wrench size={34} strokeWidth={2} aria-hidden style={{ color: "var(--accent)" }} /></div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-base)", margin: "6px 0 2px" }}>Worker sign-in</h1>
          <p style={{ color: "var(--text-soft)", fontSize: 13, margin: 0 }}>See jobs hotels have assigned to you.</p>
        </div>

        {error && <div style={errBox}>{error}</div>}

        {notice?.kind === "pending" && (
          <div style={noteBox}>
            ⏳ Your application is <b>{notice.status || "under review"}</b>. We'll notify you once it's approved.
          </div>
        )}
        {notice?.kind === "notreg" && (
          <div style={noteBox}>
            This number isn't registered as a worker yet.{" "}
            <Link href="/host/workforce/join" style={{ color: "var(--accent)", fontWeight: 700 }}>Apply to join →</Link>
          </div>
        )}

        {step === "phone" ? (
          <>
            <label style={lbl}>Mobile number</label>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ ...inp, width: 52, textAlign: "center", flex: "0 0 auto", color: "var(--text-soft)" }}>+91</span>
              <input style={inp} inputMode="tel" value={phone} maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && sendOtp()} placeholder="10-digit mobile" />
            </div>
            <button onClick={sendOtp} disabled={loading || phone.length < 10} style={{ ...btnPrimary, width: "100%", marginTop: 16 }}>{loading ? "Sending…" : "Send OTP"}</button>
          </>
        ) : (
          <>
            <label style={lbl}>Enter OTP sent to +91{phone}</label>
            <input style={inp} inputMode="numeric" value={otp} maxLength={6}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()} placeholder="••••" />
            <button onClick={verifyOtp} disabled={loading || otp.length < 4} style={{ ...btnPrimary, width: "100%", marginTop: 16 }}>{loading ? "Verifying…" : "Verify & sign in"}</button>
            <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }} style={{ ...btnGhost, width: "100%", marginTop: 8 }}>← Change number</button>
          </>
        )}

        <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", margin: "16px 0 0" }}>
          New here? <Link href="/host/workforce/join" style={{ color: "var(--accent)", fontWeight: 600 }}>Apply to join the workforce →</Link>
        </p>
      </div>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100dvh", background: "var(--bg-page)", display: "flex", alignItems: "stretch" };
const card: React.CSSProperties = { width: "100%", maxWidth: 400, background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: 18, padding: 24, boxShadow: "var(--shadow-card)" };
const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 6 };
const inp: React.CSSProperties = { width: "100%", padding: "11px 13px", borderRadius: 11, border: "1px solid var(--border-strong)", background: "var(--bg-input)", color: "var(--text-base)", fontSize: 15, outline: "none", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { padding: "12px 18px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: "pointer", border: "none", background: "linear-gradient(135deg,var(--accent),var(--accent-soft))", color: "#1F1A0F" };
const btnGhost: React.CSSProperties = { padding: "10px 16px", borderRadius: 12, fontSize: 13.5, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-soft)" };
const errBox: React.CSSProperties = { background: "rgba(212,149,131,0.14)", border: "1px solid rgba(212,149,131,0.4)", color: "var(--cozy-rose,#b5675a)", padding: "9px 13px", borderRadius: 10, fontSize: 13, marginBottom: 14 };
const noteBox: React.CSSProperties = { background: "var(--accent-soft)", border: "1px solid var(--border-strong)", color: "var(--text-base)", padding: "10px 13px", borderRadius: 10, fontSize: 13, marginBottom: 14, lineHeight: 1.5 };
