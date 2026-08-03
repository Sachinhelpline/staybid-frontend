"use client";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Zap, X } from "lucide-react";
import AdminSidebar from "@/components/admin/sidebar";
import AdminTopbar from "@/components/admin/topbar";
import { installAdminFetchInterceptor } from "@/lib/admin/client-fetch";
import "./admin.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const isLogin = pathname === "/admin/login";

  useEffect(() => {
    if (isLogin) { setChecking(false); return; }
    const token = localStorage.getItem("sb_admin_token");
    const user = localStorage.getItem("sb_admin_user");
    if (!token || !user) {
      router.replace("/admin/login");
      return;
    }
    try {
      const u = JSON.parse(user);
      if (u.role !== "admin" && u.role !== "super_admin") {
        router.replace("/admin/login");
        return;
      }
    } catch {
      router.replace("/admin/login");
      return;
    }
    setAuthed(true);
    setChecking(false);
  }, [pathname, isLogin, router]);

  useEffect(() => {
    if (isLogin) {
      setApiError(null);
      return;
    }

    return installAdminFetchInterceptor({
      onUnauthorized: () => {
        setAuthed(false);
        setChecking(false);
        router.replace("/admin/login?reason=session_expired");
      },
      onFailure: ({ status }) => {
        setApiError(
          status >= 500
            ? "The admin data service is temporarily unavailable. Data on this page may be incomplete."
            : `An admin request failed (HTTP ${status}). Data on this page may be incomplete.`,
        );
      },
    });
  }, [isLogin, router]);

  useEffect(() => {
    // v122.1 — bump the "mobile" cutoff from 768 → 1024. At 768-1023 the
    // sidebar (240px) + padding (272px) was eating 512px of an 1024px
    // viewport, leaving only ~500px of usable content area. Now 768-1023
    // gets the off-canvas drawer treatment (full-width content, hamburger
    // to open the sidebar). True desktop (>=1024) keeps the fixed
    // sidebar layout it always had.
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isLogin) {
    return (
      <>
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
        {children}
      </>
    );
  }

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", background: "#07080C", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Zap size={26} strokeWidth={2.2} aria-hidden style={{ color: "#9fb1c2" }} />
      </div>
    );
  }

  if (!authed) return null;

  const sideW = isMobile ? 0 : collapsed ? 64 : 240;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <div style={{ background: "#07080C", minHeight: "100vh" }}>
        <AdminSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          isMobile={isMobile}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
        <AdminTopbar
          sidebarCollapsed={collapsed}
          isMobile={isMobile}
          onMobileMenu={() => setMobileOpen(true)}
        />
        <main
          style={{
            marginLeft: sideW,
            paddingTop: 64,
            minHeight: "100vh",
            transition: "margin-left 0.25s ease",
            padding: isMobile ? "76px 14px 24px 14px" : `80px 32px 32px ${sideW + 32}px`,
          }}
        >
          {apiError && (
            <div
              role="alert"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,71,87,0.45)",
                background: "rgba(255,71,87,0.1)",
                color: "#ff9aa4",
                fontSize: 13,
              }}
            >
              <span>{apiError}</span>
              <button
                type="button"
                aria-label="Dismiss admin data error"
                onClick={() => setApiError(null)}
                style={{ border: 0, background: "transparent", color: "#ff9aa4", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
              >
                <X size={18} strokeWidth={2.2} aria-hidden />
              </button>
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  );
}
