"use client";

import SupportInbox from "@/components/support/SupportInbox";

export default function AdminSupportPage() {
  return (
    <SupportInbox
      tokenKey="sb_admin_token"
      userKey="sb_admin_user"
      metricsHref="/admin/support/metrics"
    />
  );
}
