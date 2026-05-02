"use client";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AdminSidebar from "@/components/admin/sidebar";
import AdminTopbar from "@/components/admin/topbar";
import "./admin.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

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
    const check = () => setIsMobile(window.innerWidth < 768);
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
        <div style={{ color: "#D4AF37", fontSize: 24 }}>⚡</div>
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
          {children}
        </main>
      </div>
    </>
  );
}
