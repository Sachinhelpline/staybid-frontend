"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

  async function sendOtp() {
    if (!phone || phone.length < 10) { setError("Enter valid 10-digit phone number"); return; }
    setLoading(true); setError("");
    try {
      await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.startsWith("+91") ? phone : `+91${phone}` }),
      });
      setStep("otp");
    } catch {
      setError("Failed to send OTP. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!otp || otp.length < 4) { setError("Enter OTP"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${API}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.startsWith("+91") ? phone : `+91${phone}`, otp }),
      });
      const data = await res.json();
      if (!data.token) throw new Error("Invalid OTP");
      const user = data.user;
      if (user?.role !== "admin" && user?.role !== "super_admin") {
        setError("Access denied. Admin accounts only.");
        return;
      }
      localStorage.setItem("sb_admin_token", data.token);
      localStorage.setItem("sb_admin_user", JSON.stringify(user));
      router.push("/admin");
    } catch (e: any) {
      setError(e.message || "Invalid OTP. Try again.");
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
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />

      <div
        style={{
          background: "#0F1117",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 20,
          padding: "48px 40px",
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 24, color: "#D4AF37" }}>
            StayBid Admin
          </div>
          <div style={{ color: "#8A8FA8", fontSize: 14, marginTop: 6 }}>God-mode control panel</div>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(255,71,87,0.1)",
              border: "1px solid rgba(255,71,87,0.3)",
              borderRadius: 10,
              padding: "10px 14px",
              color: "#FF4757",
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        {step === "phone" ? (
          <>
            <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
              Admin Phone Number
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <span
                style={{
                  background: "#151820",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  color: "#8A8FA8",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                +91
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="98XXXXXXXX"
                onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                style={{
                  flex: 1,
                  background: "#151820",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  color: "#E8EAF0",
                  fontSize: 16,
                  outline: "none",
                  letterSpacing: "0.1em",
                }}
              />
            </div>
            <button
              onClick={sendOtp}
              disabled={loading}
              style={{
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
              }}
            >
              {loading ? "Sending…" : "Send OTP →"}
            </button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <button
                onClick={() => setStep("phone")}
                style={{ background: "none", border: "none", color: "#D4AF37", cursor: "pointer", fontSize: 18 }}
              >
                ←
              </button>
              <span style={{ color: "#8A8FA8", fontSize: 13 }}>
                OTP sent to +91 {phone}
              </span>
            </div>
            <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
              Enter OTP
            </label>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="• • • • • •"
              onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
              style={{
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
              }}
            />
            <button
              onClick={verifyOtp}
              disabled={loading}
              style={{
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
              }}
            >
              {loading ? "Verifying…" : "Access Admin Panel →"}
            </button>
          </>
        )}

        <p style={{ textAlign: "center", color: "#8A8FA8", fontSize: 12, marginTop: 24 }}>
          Admin access only. Unauthorized attempts are logged.
        </p>
      </div>
    </div>
  );
}
