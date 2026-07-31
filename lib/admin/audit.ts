// v98 — Admin action audit trail.
//
// /admin/settings → Action Logs tab has been reading from `admin_action_logs`
// since Session 1 of the admin-panel build (Apr 2026), but nothing was
// writing. Every admin mutation (ban user, override price, resolve
// complaint, mark hold paid, etc.) was happening with zero audit trail.
//
// `logAdminAction` is fire-and-forget: callers don't await the write so
// a logging failure never blocks the real operation. It reads the admin
// identity from the Bearer token if present, else falls back to an
// `x-admin-id` header that the admin layout could set in the future.
//
// Usage:
//   await someMutation();
//   logAdminAction({
//     admin: auditIdentity(admin),   // verified admin, or "unknown"
//     action: "user.ban",
//     targetType: "user",
//     targetId: userId,
//     details: { reason: "..." },
//   });
import { SB_URL, SB_ADMIN_H } from "@/lib/sb";

// AdminIdentity is the shape written to the audit trail. It is now produced
// ONLY by the verified admin gate (lib/admin/verify.ts `auditIdentity`) — the
// legacy `adminFromReq` helper (which trusted a decoded-but-unverified JWT, the
// mere presence of an `adm_` string, or a bare `x-admin-id` header) has been
// REMOVED. Audit rows must carry the verified admin identity, or "unknown".
export type AdminIdentity = {
  id?: string | null;
  phone?: string | null;
  name?: string | null;
} | null;

export type LogAdminActionInput = {
  admin: AdminIdentity;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, any> | null;
};

export function logAdminAction(input: LogAdminActionInput): void {
  // Fire-and-forget. Awaiting this would slow down every admin operation
  // and a logging failure should never roll back the actual mutation.
  const row = {
    adminId:    input.admin?.id     ?? null,
    adminPhone: input.admin?.phone  ?? null,
    adminName:  input.admin?.name   ?? null,
    action:     input.action,
    targetType: input.targetType    ?? null,
    targetId:   input.targetId      ?? null,
    details:    input.details       ?? null,
    timestamp:  new Date().toISOString(),
  };
  // v100 — uses SB_ADMIN_H so writes survive even if admin_action_logs
  // gets locked down to service-role-only via the /admin/rls page.
  // When SUPABASE_SERVICE_ROLE_KEY isn't set, SB_ADMIN_H falls back to
  // the anon header (current behaviour).
  fetch(`${SB_URL}/rest/v1/admin_action_logs`, {
    method: "POST",
    headers: SB_ADMIN_H,
    body: JSON.stringify(row),
  }).catch(() => {});
}
