"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    if (!phone || phone.length < 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    if (!pin) {
      setError("Enter the master PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/check-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+91${phone}`, pin }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Login failed");
        return;
      }
      localStorage.setItem("sb_admin_token", data.token);
      localStorage.setItem("sb_admin_user", JSON.stringify(data.user));
      router.push("/admin");
    } catch (e: any) {
      setError(e.message || "Network error");
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
        <div style={{ textAlign: "center", marginBottom: 32 }}>
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
              marginBottom: 18,
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {error}
          </div>
        )}

        <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
          Admin Phone Number
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <span style={prefixStyle}>+91</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="98XXXXXXXX"
            style={inputStyle}
            autoFocus
          />
        </div>

        <label style={{ display: "block", color: "#8A8FA8", fontSize: 13, marginBottom: 8 }}>
          Master PIN
        </label>
        <div style={{ position: "relative" }}>
          <input
            type={showPin ? "text" : "password"}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter master PIN"
            onKeyDown={(e) => e.key === "Enter" && login()}
            style={{ ...inputStyle, paddingRight: 60, width: "100%", boxSizing: "border-box" }}
          />
          <button
            type="button"
            onClick={() => setShowPin((s) => !s)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "#8A8FA8",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            {showPin ? "HIDE" : "SHOW"}
          </button>
        </div>

        <button onClick={login} disabled={loading} style={primaryBtn(loading)}>
          {loading ? "Verifying…" : "Access Admin Panel →"}
        </button>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: "rgba(212,175,55,0.05)",
            border: "1px solid rgba(212,175,55,0.15)",
            borderRadius: 10,
            color: "#D4AF37",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <strong>Default master PIN:</strong>{" "}
          <code style={{ background: "#000", padding: "2px 6px", borderRadius: 4 }}>StayBidAdmin@2026</code>
          <br />
          <span style={{ color: "#8A8FA8" }}>
            Override by setting <code>ADMIN_MASTER_PIN</code> env var on Vercel. Phone must have role
            <code> super_admin</code> or <code>admin</code> in Supabase.
          </span>
        </div>

        <p style={{ textAlign: "center", color: "#8A8FA8", fontSize: 11, marginTop: 18 }}>
          Admin access only · Unauthorized attempts are logged
        </p>
      </div>
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
  letterSpacing: "0.05em",
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
