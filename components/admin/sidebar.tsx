"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "⊞" },
  { href: "/admin/users", label: "Users", icon: "👤" },
  { href: "/admin/hotels", label: "Hotels", icon: "🏨" },
  { href: "/admin/bookings", label: "Bookings & Bids", icon: "📋" },
  { href: "/admin/verification", label: "Verification", icon: "🎥" },
  { href: "/admin/videos", label: "Hotel Videos", icon: "🎬" },
  { href: "/admin/complaints", label: "Complaints", icon: "🚨" },
  { href: "/admin/pricing", label: "Pricing & Deals", icon: "💰" },
  { href: "/admin/fraud", label: "Fraud & Security", icon: "🛡️" },
  { href: "/admin/finance", label: "Finance", icon: "📊" },
  { href: "/admin/revenue", label: "Revenue", icon: "💹" },
  { href: "/admin/feedback", label: "Feedback", icon: "⭐" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️" },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function AdminSidebar({ collapsed, onToggle, isMobile, mobileOpen, onMobileClose }: Props) {
  const pathname = usePathname();
  const effectiveCollapsed = isMobile ? false : collapsed;
  const width = isMobile ? 260 : effectiveCollapsed ? 64 : 240;

  // Hidden off-canvas on mobile when closed
  const translateX = isMobile && !mobileOpen ? "-100%" : "0";

  return (
    <>
      {/* Backdrop on mobile */}
      {isMobile && mobileOpen && (
        <div
          onClick={onMobileClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 45,
          }}
        />
      )}

      <aside
        style={{
          width,
          background: "#0F1117",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          transition: "width 0.25s ease, transform 0.25s ease",
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 50,
          overflow: "hidden",
          transform: translateX !== "0" ? `translateX(${translateX})` : undefined,
          boxShadow: isMobile && mobileOpen ? "8px 0 32px rgba(0,0,0,0.5)" : undefined,
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            padding: effectiveCollapsed ? "0 18px" : "0 20px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 22, flexShrink: 0 }}>⚡</span>
          {!effectiveCollapsed && (
            <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, color: "#D4AF37", fontSize: 18, whiteSpace: "nowrap" }}>
              StayBid Admin
            </span>
          )}
          <button
            onClick={isMobile ? onMobileClose : onToggle}
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
            title={isMobile ? "Close menu" : "Toggle sidebar"}
          >
            {isMobile ? "✕" : effectiveCollapsed ? "›" : "‹"}
          </button>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "12px 0", overflow: "auto" }}>
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={isMobile ? onMobileClose : undefined}
                title={effectiveCollapsed ? item.label : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: effectiveCollapsed ? "12px 18px" : "12px 20px",
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
                {!effectiveCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!effectiveCollapsed && (
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
    </>
  );
}
