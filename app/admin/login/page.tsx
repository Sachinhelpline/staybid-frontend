"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  function fullPhone() {
    return phone.startsWith("+91") ? phone : `+91${phone}`;
  }

  async function sendOtp() {
    if (!phone || phone.length < 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      // Uses the proxy-aware api.sendOtp helper (works on Jio etc.)
      await api.sendOtp(fullPhone());
      setStep("otp");
      setInfo(`OTP sent on WhatsApp to +91 ${phone}`);
    } catch (e: any) {
      setError(e?.message || "Failed to send OTP. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!otp || otp.length < 4) {
      setError("Enter the 6-digit OTP");
      return;
    }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      // 1. Verify OTP through Railway (proxy-aware)
      const data = await api.verifyOtp(fullPhone(), otp);
      if (!data?.token) {
        throw new Error("Invalid OTP — please try again");
      }

      // 2. Check role in Supabase directly (Railway's user object can be stale)
      const roleRes = await fetch("/api/admin/check-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone() }),
      });
      const roleData = await roleRes.json();

      if (!roleData.ok) {
        setError(roleData.error || "Access denied. Admin accounts only.");
        return;
      }

      // 3. Save and redirect
      const user = { ...(data.user || {}), ...(roleData.user || {}), role: roleData.role };
      localStorage.setItem("sb_admin_token", data.token);
      localStorage.setItem("sb_admin_user", JSON.stringify(user));
      router.push("/admin");
    } catch (e: any) {
      const msg = String(e?.message || "");
      // Railway's verify-otp returns { error: "Invalid OTP" } on bad code
      if (msg.toLowerCase().includes("otp") || msg.toLowerCase().includes("invalid")) {
        setError("Invalid OTP. Check your WhatsApp and try the latest one.");
      } else {
        setError(msg || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#07080C",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "DM Sans, sans-serif",
        padding: 20,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />

      <div
        style={{
          background: "#0F1117",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 20,
          padding: "48px 40px",
          width: "100%",
          maxWidth: 440,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 24, color: "#D4AF37" }}>
            StayBid Admin
          </div>
          <div style={{ color: "#8A8FA8", fontSize: 14, marginTop: 6 }}>God-mode control panel</div>
        </div>

        {error && <Banner kind="error" text={error} />}
        {info && !error && <Banner kind="info" text={info} />}

        {step === "phone" ? (
          <>
            <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
              Admin Phone Number
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={prefixStyle}>+91</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="98XXXXXXXX"
                onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                style={inputStyle}
                autoFocus
              />
            </div>
            <button onClick={sendOtp} disabled={loading} style={primaryBtn(loading)}>
              {loading ? "Sending OTP…" : "Send OTP →"}
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <button
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                  setInfo("");
                }}
                style={{ background: "none", border: "none", color: "#D4AF37", cursor: "pointer", fontSize: 18 }}
              >
                ←
              </button>
              <span style={{ color: "#8A8FA8", fontSize: 13 }}>Change number</span>
            </div>
            <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
              Enter 6-digit OTP from WhatsApp
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="• • • • • •"
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
              style={otpStyle}
              autoFocus
            />
            <button onClick={verifyOtp} disabled={loading} style={primaryBtn(loading)}>
              {loading ? "Verifying…" : "Access Admin Panel →"}
            </button>
            <button
              onClick={sendOtp}
              disabled={loading}
              style={{
                marginTop: 12,
                width: "100%",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10,
                padding: "10px",
                color: "#8A8FA8",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
              }}
            >
              Resend OTP
            </button>
          </>
        )}

        <p style={{ textAlign: "center", color: "#8A8FA8", fontSize: 12, marginTop: 24, lineHeight: 1.6 }}>
          Admin access only. Unauthorized attempts are logged.
          <br />
          <span style={{ opacity: 0.6 }}>OTP via WhatsApp · expires in 5 min</span>
        </p>
      </div>
    </div>
  );
}

function Banner({ kind, text }: { kind: "error" | "info"; text: string }) {
  const isErr = kind === "error";
  return (
    <div
      style={{
        background: isErr ? "rgba(255,71,87,0.1)" : "rgba(46,204,113,0.1)",
        border: `1px solid ${isErr ? "rgba(255,71,87,0.3)" : "rgba(46,204,113,0.3)"}`,
        borderRadius: 10,
        padding: "10px 14px",
        color: isErr ? "#FF4757" : "#2ECC71",
        fontSize: 13,
        marginBottom: 18,
        lineHeight: 1.5,
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

const prefixStyle: React.CSSProperties = {
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#8A8FA8",
  fontSize: 14,
  flexShrink: 0,
};
const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "12px 14px",
  color: "#E8EAF0",
  fontSize: 16,
  outline: "none",
  letterSpacing: "0.1em",
};
const otpStyle: React.CSSProperties = {
  width: "100%",
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10,
  padding: "14px",
  color: "#E8EAF0",
  fontSize: 22,
  outline: "none",
  textAlign: "center",
  letterSpacing: "0.4em",
  boxSizing: "border-box",
};
function primaryBtn(loading: boolean): React.CSSProperties {
  return {
    marginTop: 16,
    width: "100%",
    background: "linear-gradient(135deg, #D4AF37, #F0D060)",
    border: "none",
    borderRadius: 12,
    padding: "14px",
    color: "#000",
    fontSize: 15,
    fontWeight: 700,
    cursor: loading ? "default" : "pointer",
    opacity: loading ? 0.7 : 1,
    fontFamily: "DM Sans, sans-serif",
  };
}
