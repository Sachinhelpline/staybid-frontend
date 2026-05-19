"use client";

import SupportMetrics from "@/components/support/SupportMetrics";

export default function AgentMetricsPage() {
  return (
    <SupportMetrics
      tokenKey="sb_agent_token"
      userKey="sb_agent_user"
      backHref="/agent"
    />
  );
}
