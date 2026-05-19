"use client";

import SupportMetrics from "@/components/support/SupportMetrics";

export default function AdminSupportMetricsPage() {
  return (
    <SupportMetrics
      tokenKey="sb_admin_token"
      userKey="sb_admin_user"
      backHref="/admin/support"
    />
  );
}
