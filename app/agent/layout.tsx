"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AgentSidebar } from "@/components/agent/sidebar";
import { AgentTopbar } from "@/components/agent/topbar";

type AgentUser = { id: string; name: string | null; phone: string | null; role: string };

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [agent, setAgent] = useState<AgentUser | null>(null);
  const [checked, setChecked] = useState(false);

  // /agent/login is the only route that bypasses the auth gate
  const isLoginPage = pathname === "/agent/login";

  useEffect(() => {
    if (isLoginPage) {
      setChecked(true);
      return;
    }
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("sb_agent_token");
    const userRaw = localStorage.getItem("sb_agent_user");
    if (!token || !userRaw) {
      router.replace("/agent/login");
      return;
    }
    try {
      setAgent(JSON.parse(userRaw));
    } catch {
      router.replace("/agent/login");
      return;
    }
    setChecked(true);
  }, [isLoginPage, router]);

  if (isLoginPage) {
    return (
      <>
        <link
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
        {children}
      </>
    );
  }

  if (!checked || !agent) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#07080C",
          color: "#8A8FA8",
          fontFamily: "DM Sans, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#07080C",
        color: "#E8EAF0",
        fontFamily: "DM Sans, sans-serif",
        display: "flex",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />
      <AgentSidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        <AgentTopbar agent={agent} />
        <main style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>{children}</main>
      </div>
    </div>
  );
}
