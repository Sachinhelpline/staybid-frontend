"use client";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AdminSidebar from "@/components/admin/sidebar";
import AdminTopbar from "@/components/admin/topbar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
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

  const sideW = collapsed ? 64 : 240;

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <div style={{ background: "#07080C", minHeight: "100vh" }}>
        <AdminSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <AdminTopbar sidebarCollapsed={collapsed} />
        <main
          style={{
            marginLeft: sideW,
            paddingTop: 64,
            minHeight: "100vh",
            transition: "margin-left 0.25s ease",
            padding: `80px 32px 32px ${sideW + 32}px`,
          }}
        >
          {children}
        </main>
      </div>
    </>
  );
}
