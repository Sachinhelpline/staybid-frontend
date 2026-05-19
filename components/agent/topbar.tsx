"use client";

import { useRouter } from "next/navigation";

type Props = {
  agent: { id: string; name: string | null; role: string } | null;
};

export function AgentTopbar({ agent }: Props) {
  const router = useRouter();

  function logout() {
    localStorage.removeItem("sb_agent_token");
    localStorage.removeItem("sb_agent_user");
    router.replace("/agent/login");
  }

  const initial = (agent?.name || "A").charAt(0).toUpperCase();
  const roleLabel =
    agent?.role === "admin" || agent?.role === "super_admin"
      ? "Admin"
      : "Support Agent";

  return (
    <header style={styles.topbar}>
      <div style={styles.subtitle}>Hybrid AI + human conversations</div>
      <div style={styles.right}>
        <div style={styles.agent}>
          <div style={styles.avatar}>{initial}</div>
          <div style={styles.who}>
            <div style={styles.name}>{agent?.name || "Agent"}</div>
            <div style={styles.role}>{roleLabel}</div>
          </div>
        </div>
        <button type="button" onClick={logout} style={styles.logout}>
          Log out
        </button>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topbar: {
    height: 56,
    flex: "0 0 56px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    padding: "0 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  subtitle: { color: "#8A8FA8", fontSize: 12 },
  right: { display: "flex", alignItems: "center", gap: 14 },
  agent: { display: "flex", alignItems: "center", gap: 10 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "linear-gradient(140deg, #D4AF37, #8B6914)",
    color: "#0F1117",
    fontWeight: 700,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  who: { lineHeight: 1.2 },
  name: { color: "#E8EAF0", fontSize: 13, fontWeight: 600 },
  role: { color: "#8A8FA8", fontSize: 10, letterSpacing: 0.04, textTransform: "uppercase" },
  logout: {
    background: "transparent",
    color: "#8A8FA8",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
  },
};
