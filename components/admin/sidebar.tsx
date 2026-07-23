"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SwitchExperienceButton from "@/components/SwitchExperienceButton";
import { AppTourButton, HelpSupportButton } from "@/components/HelpLauncher";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: "⊞" },
  { href: "/admin/users", label: "Users", icon: "👤" },
  { href: "/admin/creators", label: "Creators", icon: "✨" },
  { href: "/admin/hotels", label: "Hotels", icon: "🏨" },
  { href: "/admin/bookings", label: "Bookings & Bids", icon: "📋" },
  { href: "/admin/host", label: "StayBid for Hosts", icon: "🏠" },
  { href: "/admin/host/pricing", label: "Host Wizard Pricing", icon: "🧮" },
  // v319 — Channel Manager admin health console
  { href: "/admin/channels", label: "Channel Health", icon: "📡" },
  // v288 — StayCircle™ Community Partner Platform (room-level investing)
  { href: "/admin/circle", label: "StayCircle", icon: "◎" },
  // v330 — Circle Model 3 pre-buy inventory oversight (blocks + payouts)
  { href: "/admin/circle-inventory", label: "Circle Inventory", icon: "🧾" },
  // v341 — Circle Marketplace M2: Model-3 pre-buy supply admin (enable + window)
  { href: "/admin/circle-supply", label: "Circle Supply", icon: "🏢" },
  // v361 — Circle Model 3: travel-agent monthly auction oversight
  { href: "/admin/auction", label: "Agent Auction", icon: "🏷️" },
  { href: "/admin/verification", label: "Verification", icon: "🎥" },
  { href: "/admin/videos", label: "Hotel Videos", icon: "🎬" },
  { href: "/admin/complaints", label: "Complaints", icon: "🚨" },
  { href: "/admin/pricing", label: "Pricing & Deals", icon: "💰" },
  { href: "/kiosk", label: "Offline Kiosk", icon: "🖥️", external: true },
  { href: "/admin/hold-config", label: "Hold Config", icon: "🔒" },
  { href: "/admin/holds", label: "Active Holds", icon: "⏱" },
  { href: "/admin/analytics", label: "Bid Analytics", icon: "📊" },
  { href: "/admin/messages", label: "Chat Moderation", icon: "💬" },
  // v146 — Hybrid AI + agent support inbox
  { href: "/admin/support", label: "Support Inbox", icon: "🎧" },
  // Phase 5 tier-system — escalated content moderation queue
  { href: "/admin/content", label: "Content Reviews", icon: "🖼️" },
  // v402 — reel reports + blocked-contact comment flags
  { href: "/admin/moderation", label: "Moderation", icon: "🚩" },
  { href: "/admin/passport", label: "Passports", icon: "🛂" },
  { href: "/admin/services", label: "Service Access", icon: "🔑" },
  { href: "/admin/fraud", label: "Fraud & Security", icon: "🛡️" },
  { href: "/admin/finance", label: "Finance", icon: "📊" },
  { href: "/admin/commission-rules", label: "Creator Commission", icon: "✨" },
  { href: "/admin/hotel-commission-rules", label: "Hotel Commission", icon: "🏨" },
  { href: "/admin/redemption-rules", label: "Redemption Rules", icon: "🎁" },
  { href: "/admin/redemption-codes", label: "Issued Codes", icon: "🎟️" },
  { href: "/admin/revenue", label: "Revenue", icon: "💹" },
  { href: "/admin/reports", label: "Reports Center", icon: "📑" },
  { href: "/admin/feedback", label: "Feedback", icon: "⭐" },
  { href: "/admin/notifications", label: "Notifications", icon: "📨" },
  { href: "/admin/rls", label: "RLS / Security", icon: "🛡️" },
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
          // v126 — fixed-height (not minHeight) so the inner <nav> can
          // properly own its overflow-y. With minHeight, content > viewport
          // grew the aside beyond the screen and clipped sidebar entries
          // below the fold instead of scrolling inside the sidebar.
          height: "100vh",
          maxHeight: "100vh",
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

        {/* Nav items — v126: tightened row padding + visible gold scrollbar +
            "scroll for more" hint so all 23 entries are discoverable on
            shorter laptops without the user having to hunt for a hidden
            scrollbar. */}
        <nav
          className="admin-sidebar-nav"
          style={{ flex: 1, padding: "6px 0", overflowY: "auto", overflowX: "hidden", minHeight: 0 }}
        >
          {NAV.map((item) => {
            const external = (item as any).external === true;
            const active = external
              ? false
              : item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                // Kiosk is a chrome-less fullscreen surface — open in a new tab
                // so the admin never gets trapped without the sidebar.
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                onClick={isMobile ? onMobileClose : undefined}
                title={effectiveCollapsed ? item.label : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: effectiveCollapsed ? "8px 18px" : "8px 20px",
                  color: active ? "#D4AF37" : "#8A8FA8",
                  background: active ? "rgba(212,175,55,0.1)" : "transparent",
                  borderLeft: active ? "2px solid #D4AF37" : "2px solid transparent",
                  textDecoration: "none",
                  fontSize: 13,
                  lineHeight: 1.25,
                  fontFamily: "DM Sans, sans-serif",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                {!effectiveCollapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
          {/* v404 — App Tour + Help & Support (opened from the menu; the
              floating "?" + support bubble were removed from every screen). */}
          {(() => {
            const navBtn: React.CSSProperties = {
              display: "flex", alignItems: "center", gap: 11, width: "100%",
              padding: effectiveCollapsed ? "8px 18px" : "8px 20px",
              color: "#8A8FA8", background: "transparent", border: "none",
              borderLeft: "2px solid transparent", cursor: "pointer", fontSize: 13,
              lineHeight: 1.25, fontFamily: "DM Sans, sans-serif", whiteSpace: "nowrap", textAlign: "left",
            };
            return (
              <>
                <AppTourButton title={effectiveCollapsed ? "App Tour" : undefined} style={{ ...navBtn, marginTop: 4, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>❓</span>
                  {!effectiveCollapsed && <span>App Tour</span>}
                </AppTourButton>
                <HelpSupportButton title={effectiveCollapsed ? "Help & Support" : undefined} style={navBtn}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>🎧</span>
                  {!effectiveCollapsed && <span>Help &amp; Support</span>}
                </HelpSupportButton>
              </>
            );
          })()}
          {/* v324 — Switch experience (opens the global panel switcher).
              In-nav entry, styled like a nav item — NO floating pill. */}
          <SwitchExperienceButton
            title={effectiveCollapsed ? "Switch experience" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              width: "100%",
              padding: effectiveCollapsed ? "8px 18px" : "8px 20px",
              marginTop: 4,
              color: "#8A8FA8",
              background: "transparent",
              border: "none",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              borderLeft: "2px solid transparent",
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1.25,
              fontFamily: "DM Sans, sans-serif",
              whiteSpace: "nowrap",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 15, flexShrink: 0 }}>⇄</span>
            {!effectiveCollapsed && <span>Switch experience</span>}
          </SwitchExperienceButton>
        </nav>

        {!effectiveCollapsed && (
          <div
            style={{
              padding: "10px 20px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              color: "#8A8FA8",
              fontSize: 11,
              fontFamily: "DM Sans, sans-serif",
              flexShrink: 0,
            }}
          >
            StayBid Admin v1.0
          </div>
        )}

        <style jsx>{`
          .admin-sidebar-nav { scrollbar-width: thin; scrollbar-color: rgba(212,175,55,0.45) transparent; }
          .admin-sidebar-nav::-webkit-scrollbar { width: 6px; }
          .admin-sidebar-nav::-webkit-scrollbar-track { background: transparent; }
          .admin-sidebar-nav::-webkit-scrollbar-thumb {
            background: linear-gradient(180deg, rgba(212,175,55,0.55), rgba(212,175,55,0.25));
            border-radius: 999px;
          }
          .admin-sidebar-nav::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(180deg, rgba(212,175,55,0.85), rgba(212,175,55,0.45));
          }
        `}</style>
      </aside>
    </>
  );
}
