"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  sidebarCollapsed: boolean;
  isMobile?: boolean;
  onMobileMenu?: () => void;
}

export default function AdminTopbar({ sidebarCollapsed, isMobile, onMobileMenu }: Props) {
  const router = useRouter();
  const [notifs, setNotifs] = useState({ verif: 0, complaints: 0, fraud: 0, payouts: 0 });

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.notifs) setNotifs(d.notifs);
      })
      .catch(() => {});
  }, []);

  const totalBadge = notifs.verif + notifs.complaints + notifs.fraud + notifs.payouts;

  function logout() {
    localStorage.removeItem("sb_admin_token");
    localStorage.removeItem("sb_admin_user");
    router.push("/admin/login");
  }

  const left = isMobile ? 0 : sidebarCollapsed ? 64 : 240;

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left,
        right: 0,
        height: 64,
        background: "#0F1117",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        alignItems: "center",
        padding: isMobile ? "0 14px" : "0 24px",
        gap: isMobile ? 10 : 16,
        zIndex: 30,
        transition: "left 0.25s ease",
      }}
    >
      {/* Mobile hamburger */}
      {isMobile && (
        <button
          onClick={onMobileMenu}
          aria-label="Open menu"
          style={{
            background: "rgba(212,175,55,0.1)",
            border: "1px solid rgba(212,175,55,0.3)",
            color: "#D4AF37",
            borderRadius: 10,
            width: 40,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>☰</span>
        </button>
      )}

      {isMobile && (
        <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, color: "#D4AF37", fontSize: 16 }}>
          ⚡ Admin
        </span>
      )}

      {/* Search — hidden on mobile */}
      {!isMobile && (
        <input
          placeholder="Search users, hotels, bookings…"
          style={{
            flex: 1,
            maxWidth: 400,
            background: "#151820",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 10,
            padding: "8px 14px",
            color: "#E8EAF0",
            fontFamily: "DM Sans, sans-serif",
            fontSize: 14,
            outline: "none",
          }}
        />
      )}

      <div style={{ flex: 1 }} />

      {/* Notification badges */}
      {!isMobile && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {[
            { label: "Verif", count: notifs.verif, color: "#3D9CF5" },
            { label: "Complaints", count: notifs.complaints, color: "#FF4757" },
            { label: "Fraud", count: notifs.fraud, color: "#A855F7" },
            { label: "Payouts", count: notifs.payouts, color: "#2ECC71" },
          ].map((n) =>
            n.count > 0 ? (
              <span
                key={n.label}
                style={{
                  background: n.color + "22",
                  border: `1px solid ${n.color}44`,
                  color: n.color,
                  borderRadius: 8,
                  padding: "3px 10px",
                  fontSize: 12,
                  fontFamily: "DM Sans, sans-serif",
                  fontWeight: 600,
                }}
              >
                {n.count} {n.label}
              </span>
            ) : null
          )}
          {totalBadge === 0 && <span style={{ color: "#8A8FA8", fontSize: 13 }}>All clear ✓</span>}
        </div>
      )}

      {/* Mobile: single combined badge */}
      {isMobile && totalBadge > 0 && (
        <span
          style={{
            background: "rgba(255,71,87,0.1)",
            border: "1px solid rgba(255,71,87,0.3)",
            color: "#FF4757",
            borderRadius: 999,
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          🔔 {totalBadge}
        </span>
      )}

      <button
        onClick={logout}
        style={{
          background: "rgba(255,71,87,0.1)",
          border: "1px solid rgba(255,71,87,0.3)",
          color: "#FF4757",
          borderRadius: 10,
          padding: isMobile ? "6px 10px" : "6px 14px",
          cursor: "pointer",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {isMobile ? "↪" : "Logout"}
      </button>
    </header>
  );
}
