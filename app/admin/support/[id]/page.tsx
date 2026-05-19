"use client";

import SupportChatPage from "@/components/support/SupportChatPage";

export default function AdminSupportChatRoute({
  params,
}: {
  params: { id: string };
}) {
  return (
    <SupportChatPage
      conversationId={params.id}
      tokenKey="sb_admin_token"
      userKey="sb_admin_user"
      backHref="/admin/support"
    />
  );
}
