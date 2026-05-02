"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminTopbar({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
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

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: sidebarCollapsed ? 64 : 240,
        right: 0,
        height: 64,
        background: "#0F1117",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 16,
        zIndex: 30,
        transition: "left 0.25s ease",
      }}
    >
      {/* Search */}
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

      <div style={{ flex: 1 }} />

      {/* Notification badges */}
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
        {totalBadge === 0 && (
          <span style={{ color: "#8A8FA8", fontSize: 13 }}>All clear ✓</span>
        )}
      </div>

      {/* Admin user menu */}
      <button
        onClick={logout}
        style={{
          background: "rgba(255,71,87,0.1)",
          border: "1px solid rgba(255,71,87,0.3)",
          color: "#FF4757",
          borderRadius: 10,
          padding: "6px 14px",
          cursor: "pointer",
          fontFamily: "DM Sans, sans-serif",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Logout
      </button>
    </header>
  );
}
