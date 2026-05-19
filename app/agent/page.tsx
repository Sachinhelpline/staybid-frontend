"use client";

import SupportInbox from "@/components/support/SupportInbox";

export default function AgentInboxPage() {
  return (
    <SupportInbox
      tokenKey="sb_agent_token"
      userKey="sb_agent_user"
      metricsHref="/agent/metrics"
      hidePageTopbar
    />
  );
}
