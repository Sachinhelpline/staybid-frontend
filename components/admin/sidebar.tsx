"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "⊞" },
  { href: "/admin/users", label: "Users", icon: "👤" },
  { href: "/admin/hotels", label: "Hotels", icon: "🏨" },
  { href: "/admin/bookings", label: "Bookings & Bids", icon: "📋" },
  { href: "/admin/verification", label: "Verification", icon: "🎥" },
  { href: "/admin/complaints", label: "Complaints", icon: "🚨" },
  { href: "/admin/pricing", label: "Pricing & Deals", icon: "💰" },
  { href: "/admin/fraud", label: "Fraud & Security", icon: "🛡️" },
  { href: "/admin/finance", label: "Finance", icon: "📊" },
  { href: "/admin/feedback", label: "Feedback", icon: "⭐" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️" },
];

export default function AdminSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: collapsed ? 64 : 240,
        background: "#0F1117",
        borderRight: "1px solid rgba(255,255,255,0.07)",
        transition: "width 0.25s ease",
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 40,
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          padding: collapsed ? "0 18px" : "0 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 22, flexShrink: 0 }}>⚡</span>
        {!collapsed && (
          <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, color: "#D4AF37", fontSize: 18, whiteSpace: "nowrap" }}>
            StayBid Admin
          </span>
        )}
        <button
          onClick={onToggle}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            color: "#8A8FA8",
            cursor: "pointer",
            fontSize: 18,
            padding: 4,
            flexShrink: 0,
          }}
          title="Toggle sidebar"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "12px 0", overflow: "hidden" }}>
        {NAV.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: collapsed ? "10px 18px" : "10px 20px",
                color: active ? "#D4AF37" : "#8A8FA8",
                background: active ? "rgba(212,175,55,0.1)" : "transparent",
                borderLeft: active ? "2px solid #D4AF37" : "2px solid transparent",
                textDecoration: "none",
                fontSize: 14,
                fontFamily: "DM Sans, sans-serif",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom version */}
      {!collapsed && (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            color: "#8A8FA8",
            fontSize: 11,
            fontFamily: "DM Sans, sans-serif",
          }}
        >
          StayBid Admin v1.0
        </div>
      )}
    </aside>
  );
}
