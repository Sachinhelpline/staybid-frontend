"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/agent", label: "Inbox", icon: "💬" },
  { href: "/agent/metrics", label: "Metrics", icon: "📊" },
];

export function AgentSidebar() {
  const pathname = usePathname();

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>
        <div style={styles.brandEmoji}>🎧</div>
        <div>
          <div style={styles.brandTitle}>Support</div>
          <div style={styles.brandSub}>Agent panel</div>
        </div>
      </div>

      <nav style={styles.nav}>
        {NAV.map((item) => {
          const active =
            item.href === "/agent"
              ? pathname === "/agent"
              : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                ...styles.navItem,
                ...(active ? styles.navItemActive : {}),
              }}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={styles.footer}>
        <Link href="/" style={styles.footerLink}>← Customer site</Link>
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220,
    flex: "0 0 220px",
    background: "#0F1117",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    padding: 16,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px 18px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    marginBottom: 14,
  },
  brandEmoji: { fontSize: 28 },
  brandTitle: {
    fontFamily: "Syne, serif",
    fontSize: 17,
    fontWeight: 700,
    color: "#D4AF37",
  },
  brandSub: { fontSize: 10, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: 0.06 },
  nav: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    color: "#8A8FA8",
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    transition: "background 0.15s ease",
  },
  navItemActive: {
    background: "rgba(212, 175, 55, 0.12)",
    color: "#D4AF37",
    fontWeight: 600,
  },
  navIcon: { fontSize: 15 },
  footer: {
    paddingTop: 14,
    borderTop: "1px solid rgba(255,255,255,0.05)",
  },
  footerLink: {
    color: "#5E6273",
    fontSize: 11,
    textDecoration: "none",
  },
};
