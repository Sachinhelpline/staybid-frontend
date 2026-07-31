"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Admin login — Google/Gmail ONLY (hotfix v621 security).
//
// The legacy phone + Master-PIN form is REMOVED. Admins sign in with Google at
// /auth (mobile OTP is intentionally disabled). That returns a Railway HS256
// access JWT stored as sb_token; this page sends it to /api/admin/check-role as
// `Authorization: Bearer <sb_token>`, which verifies the signature and re-checks
// the admin/super_admin role in the database. On success we reuse the SAME
// verified token as sb_admin_token and store only the server-verified identity
// as sb_admin_user — never the local sb_user role. There is no PIN field, no
// default PIN, and no client-supplied phone/email/role.
export default function AdminLogin() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "signin" | "verifying">(
    "checking",
  );
  const [error, setError] = useState("");

  async function verifySession(token: string) {
    setPhase("verifying");
    setError("");
    try {
      const res = await fetch("/api/admin/check-role", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(
          data.error ||
            "This Google account is not an admin. Sign in with an admin account.",
        );
        setPhase("signin");
        return;
      }
      // Reuse the SAME verified Railway token as the admin session token, and
      // store only the server-returned verified identity.
      localStorage.setItem("sb_admin_token", token);
      localStorage.setItem("sb_admin_user", JSON.stringify(data.user));
      router.replace("/admin");
    } catch (e: any) {
      setError(e?.message || "Network error — please try again.");
      setPhase("signin");
    }
  }

  // On mount: if a Gmail/Railway session already exists, verify it; otherwise
  // offer Google sign-in.
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (token) verifySession(token);
    else setPhase("signin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function continueWithGoogle() {
    // Send the admin to the shared Google sign-in and return here afterward.
    router.push("/auth?return=/admin/login");
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
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div
            style={{
              fontFamily: "Syne, sans-serif",
              fontWeight: 700,
              fontSize: 24,
              color: "#9fb1c2",
            }}
          >
            StayBid Admin
          </div>
          <div style={{ color: "#8A8FA8", fontSize: 14, marginTop: 6 }}>
            Control panel access
          </div>
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

        {phase === "verifying" || phase === "checking" ? (
          <div
            style={{
              textAlign: "center",
              color: "#9fb1c2",
              fontSize: 14,
              padding: "18px 0",
            }}
          >
            Verifying your admin session…
          </div>
        ) : (
          <button onClick={continueWithGoogle} style={googleBtn}>
            <span style={{ fontSize: 18 }}>🔐</span> Continue with Google
          </button>
        )}

        <div
          style={{
            marginTop: 18,
            padding: 14,
            background: "rgba(140, 160, 182,0.05)",
            border: "1px solid rgba(140, 160, 182,0.15)",
            borderRadius: 10,
            color: "#9fb1c2",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          Sign in with a Google account whose role is{" "}
          <code>admin</code> or <code>super_admin</code> in the platform
          database. Access is granted only after the server verifies your
          Google session and your admin role.
        </div>

        <p
          style={{
            textAlign: "center",
            color: "#8A8FA8",
            fontSize: 11,
            marginTop: 18,
          }}
        >
          Admin access only · Unauthorized attempts are logged
        </p>
      </div>
    </div>
  );
}

const googleBtn: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  background: "linear-gradient(135deg, #9fb1c2, #c6d0da)",
  border: "none",
  borderRadius: 12,
  padding: "14px",
  color: "#000",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "DM Sans, sans-serif",
};
