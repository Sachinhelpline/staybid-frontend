"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Headphones } from "lucide-react";
import { api } from "@/lib/api";

// Agent panel login. Phone OTP via Railway (WhatsApp).
// After OTP verify → /api/agent/check-role validates role is in
// (admin | super_admin | support_agent) → token + user stored as
// sb_agent_token / sb_agent_user.
//
// Admins CAN also log in here (full role set allowed) — useful for
// testing the agent panel. Dedicated agents use this exclusively.
export default function AgentLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(0);

  async function sendOtp() {
    if (!/^\d{10}$/.test(phone)) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Pre-check role first so we don't OTP a non-agent
      const roleCheck = await fetch("/api/agent/check-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const roleData = await roleCheck.json();
      if (!roleData.ok) {
        setError(roleData.error || "Access denied");
        return;
      }
      // Send WhatsApp OTP
      await api.sendOtp({ phone: `+91${phone}`, delivery: "whatsapp" } as any);
      setStep("otp");
      setResendIn(30);
      const tick = setInterval(() => {
        setResendIn((s) => {
          if (s <= 1) {
            clearInterval(tick);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError(e?.message || "Couldn't send OTP. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{4,6}$/.test(otp)) {
      setError("Enter the OTP you received");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const verified = await api.verifyOtp(`+91${phone}`, otp);
      const token = (verified as any)?.token;
      if (!token) {
        setError("OTP verify failed. Try resending.");
        return;
      }
      // Confirm role + grab full user row in one go
      const roleCheck = await fetch("/api/agent/check-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const roleData = await roleCheck.json();
      if (!roleData.ok) {
        setError(roleData.error || "Access denied");
        return;
      }
      localStorage.setItem("sb_agent_token", token);
      localStorage.setItem("sb_agent_user", JSON.stringify(roleData.user));
      router.push("/agent");
    } catch (e: any) {
      setError(e?.message || "OTP verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.root}>
      <link
        href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />
      <div style={styles.card}>
        <div style={styles.brand}>
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "center", color: "#9fb1c2" }}><Headphones size={40} strokeWidth={2} aria-hidden /></div>
          <div style={styles.title}>StayBid Support</div>
          <div style={styles.subtitle}>Agent control panel</div>
        </div>

        {step === "phone" ? (
          <>
            <label style={styles.label}>Phone number</label>
            <div style={styles.phoneWrap}>
              <span style={styles.countryCode}>+91</span>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="9876543210"
                value={phone}
                maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                style={styles.phoneInput}
              />
            </div>
            <button onClick={sendOtp} disabled={loading} style={styles.primaryBtn}>
              {loading ? "Checking…" : "Send OTP on WhatsApp"}
            </button>
          </>
        ) : (
          <>
            <div style={styles.note}>
              OTP bheja gaya {`+91 ${phone}`} pe (WhatsApp).
            </div>
            <label style={styles.label}>Enter OTP</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              value={otp}
              maxLength={6}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
              style={styles.otpInput}
            />
            <button onClick={verifyOtp} disabled={loading} style={styles.primaryBtn}>
              {loading ? "Verifying…" : "Verify + Sign in"}
            </button>
            <button
              onClick={() => {
                setStep("phone");
                setOtp("");
                setError("");
              }}
              style={styles.secondaryBtn}
            >
              ← Change phone
            </button>
            {resendIn > 0 ? (
              <div style={styles.resendNote}>Resend possible in {resendIn}s</div>
            ) : (
              <button onClick={sendOtp} disabled={loading} style={styles.linkBtn}>
                ↻ Resend OTP
              </button>
            )}
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.footer}>
          Dedicated support team only. Admins log in at{" "}
          <a href="/admin/login" style={styles.footerLink}>
            /admin/login
          </a>
          .
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    // v716 (owner) — premium steel gradient canvas (matches admin/customer/partner).
    background:
      "radial-gradient(120% 85% at 12% 8%, rgba(120,145,170,0.16), transparent 58%), linear-gradient(155deg,#111722 0%,#0b0f18 55%,#07080c 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "DM Sans, sans-serif",
    padding: 20,
  },
  card: {
    // v716 — frosted dark glass card, part of the canvas (was a solid #0F1117 box).
    background: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 20,
    padding: "48px 40px",
    width: "100%",
    maxWidth: 440,
    boxShadow: "0 26px 64px -28px rgba(0,0,0,0.7)",
    backdropFilter: "blur(16px) saturate(1.2)",
    WebkitBackdropFilter: "blur(16px) saturate(1.2)",
  },
  brand: { textAlign: "center", marginBottom: 32 },
  title: {
    fontFamily: "Syne, sans-serif",
    fontWeight: 700,
    fontSize: 24,
    color: "#9fb1c2",
  },
  subtitle: { color: "#8A8FA8", fontSize: 14, marginTop: 6 },
  label: {
    display: "block",
    color: "#E8EAF0",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.05,
  },
  phoneWrap: {
    display: "flex",
    alignItems: "stretch",
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    marginBottom: 20,
  },
  countryCode: {
    padding: "14px 14px",
    color: "#8A8FA8",
    fontSize: 14,
    borderRight: "1px solid rgba(255,255,255,0.07)",
  },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    padding: "14px 12px",
    color: "#E8EAF0",
    fontSize: 16,
    outline: "none",
  },
  otpInput: {
    width: "100%",
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "14px 12px",
    color: "#E8EAF0",
    fontSize: 18,
    letterSpacing: 4,
    textAlign: "center",
    outline: "none",
    marginBottom: 20,
  },
  primaryBtn: {
    width: "100%",
    background: "#9fb1c2",
    color: "#0F1117",
    border: "none",
    padding: "14px",
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  },
  secondaryBtn: {
    width: "100%",
    background: "transparent",
    color: "#8A8FA8",
    border: "none",
    padding: 10,
    fontSize: 13,
    cursor: "pointer",
    marginTop: 10,
  },
  linkBtn: {
    width: "100%",
    background: "transparent",
    color: "#9fb1c2",
    border: "none",
    padding: 10,
    fontSize: 13,
    cursor: "pointer",
    marginTop: 10,
  },
  note: {
    background: "rgba(140, 160, 182, 0.08)",
    border: "1px solid rgba(140, 160, 182, 0.25)",
    color: "#9fb1c2",
    fontSize: 12,
    padding: 10,
    borderRadius: 8,
    marginBottom: 20,
    textAlign: "center",
  },
  resendNote: {
    textAlign: "center",
    color: "#5E6273",
    fontSize: 12,
    marginTop: 14,
  },
  error: {
    background: "rgba(255, 71, 87, 0.1)",
    border: "1px solid rgba(255, 71, 87, 0.3)",
    color: "#FF7878",
    fontSize: 13,
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  footer: {
    marginTop: 28,
    paddingTop: 20,
    borderTop: "1px solid rgba(255,255,255,0.07)",
    color: "#8A8FA8",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 1.6,
  },
  footerLink: { color: "#aeb9c8", textDecoration: "none", borderBottom: "1px dotted #8A8FA8" },
};
