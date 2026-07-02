// v283 Gap 3 — worker-panel auth. Mirrors the partner panel: the worker signs
// in with phone OTP (Railway verify-otp → JWT proving phone ownership), and we
// resolve the workforce_workers row by that phone. No new auth infra.
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export type WorkerAuth = { phone: string; worker: any | null };

// Resolve the workforce_workers row for the phone carried in the Bearer JWT.
// Returns null only when there is no valid token / phone; returns
// { phone, worker: null } when authenticated but not registered as a worker.
export async function workerFromReq(req: Request): Promise<WorkerAuth | null> {
  const u = userFromReq(req);
  const phone = u?.phone || "";
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  try {
    // last-10-digit match covers +91xxxxxxxxxx / 91xxxxxxxxxx / xxxxxxxxxx.
    const r = await fetch(
      `${SB_URL}/rest/v1/workforce_workers?phone=ilike.*${last10}&select=*&order=created_at.asc&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (!r.ok) return { phone, worker: null };
    const [w] = await r.json();
    return { phone, worker: w || null };
  } catch {
    return { phone, worker: null };
  }
}
