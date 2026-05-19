"use client";

import SupportChatPage from "@/components/support/SupportChatPage";

export default function AgentChatRoute({
  params,
}: {
  params: { id: string };
}) {
  return (
    <SupportChatPage
      conversationId={params.id}
      tokenKey="sb_agent_token"
      userKey="sb_agent_user"
      backHref="/agent"
    />
  );
}
