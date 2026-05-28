"use client";;
import { use } from "react";

import SupportChatPage from "@/components/support/SupportChatPage";

export default function AdminSupportChatRoute(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = use(props.params);
  return (
    <SupportChatPage
      conversationId={params.id}
      tokenKey="sb_admin_token"
      userKey="sb_admin_user"
      backHref="/admin/support"
    />
  );
}
