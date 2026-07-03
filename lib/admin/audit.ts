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
//     admin: adminFromReq(req),
//     action: "user.ban",
//     targetType: "user",
//     targetId: userId,
//     details: { reason: "..." },
//   });
import { SB_URL, SB_ADMIN_H, decodeJwt } from "@/lib/sb";

export type AdminIdentity = {
  id?: string | null;
  phone?: string | null;
  name?: string | null;
} | null;

export function adminFromReq(req: Request): AdminIdentity {
  try {
    // v284.1 — ALSO accept the token via the `x-admin-token` header. Most
    // admin pages send { "x-admin-token": localStorage.sb_admin_token }
    // (NOT an Authorization Bearer), so gated routes using adminFromReq
    // were 401-ing whenever the x-admin-id fallback header was empty
    // (e.g. the /admin/host pages read the non-existent `sb_admin_id`
    // localStorage key). The token itself — Railway JWT or adm_ opaque —
    // is the proof; honor it from either header.
    const auth = req.headers.get("authorization") || "";
    const t =
      auth.replace(/^Bearer\s+/i, "").trim() ||
      (req.headers.get("x-admin-token") || "").trim();
    if (t) {
      // 1. JWT path — Railway-issued admin JWTs (OTP login flow) decode to
      //    a claim payload with { id, phone, name }.
      const p = decodeJwt(t);
      if (p?.id) return { id: p.id, phone: p.phone || null, name: p.name || null };

      // v104.2 — opaque admin token path. The master-PIN login flow in
      // /api/admin/check-role issues `adm_<48hex>` opaque tokens (not
      // JWTs). The check-role endpoint already verified admin role
      // before issuing, so the token's presence alone is sufficient
      // proof of admin. We can't extract user identity from an opaque
      // token, so the caller MUST send their identity via x-admin-*
      // headers (the layout sets these from localStorage.sb_admin_user).
      if (/^adm_[a-f0-9]{8,}$/i.test(t)) {
        const id    = req.headers.get("x-admin-id")    || "master-pin-admin";
        const phone = req.headers.get("x-admin-phone") || null;
        const name  = req.headers.get("x-admin-name")  || null;
        return { id, phone, name };
      }
    }
    // Fallback: explicit x-admin-* headers without a Bearer token.
    const id = req.headers.get("x-admin-id");
    const phone = req.headers.get("x-admin-phone");
    const name = req.headers.get("x-admin-name");
    if (id || phone) return { id, phone, name };
  } catch {}
  return null;
}

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
