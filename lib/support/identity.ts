// Per-surface identity resolvers for the HQ Support Desk. Each maps a surface's
// own auth (customer sb_token / trade Google / worker OTP) to a DeskIdentity that
// the shared lib/support/desk data layer uses to scope tickets. Server-only.

import { decodeJwt } from "@/lib/sb-server";
import { resolveOwnerIdsCrossPool } from "@/lib/partner/owner-ids";
import { tradeAgentFromReq } from "@/lib/trade/auth";
import { workerFromReq } from "@/lib/worker/auth";
import type { DeskIdentity } from "@/lib/support/desk";

// Customer sb_token surfaces (StayCircle already has its own; these cover Host + Creator).
async function customerIdentity(req: Request, partyType: string): Promise<DeskIdentity | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const p = token ? decodeJwt(token) : null;
  if (!p?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(p.id, p.phone || req.headers.get("x-phone") || "", p.email || req.headers.get("x-email") || "");
  return { ownerId: p.id, ownerIds, partyType, contactName: p.name || p.email || null, contactRef: p.phone || p.email || null };
}

export const hostIdentity = (req: Request) => customerIdentity(req, "host");
export const creatorIdentity = (req: Request) => customerIdentity(req, "creator");

// Travel agent — Google/social identity (same resolver /api/trade/* uses).
export async function tradeIdentity(req: Request): Promise<DeskIdentity | null> {
  const a = await tradeAgentFromReq(req);
  const u = a?.user;
  if (!u?.id) return null;
  const ownerIds = await resolveOwnerIdsCrossPool(u.id, (u as any).phone || "", u.email || "");
  return { ownerId: u.id, ownerIds, partyType: "agent", contactName: u.name || u.email || null, contactRef: (u as any).phone || u.email || null };
}

// Workforce worker — resolved by the phone in their OTP token (last 10 digits, stable).
export async function workerIdentity(req: Request): Promise<DeskIdentity | null> {
  const w = await workerFromReq(req);
  if (!w?.phone) return null;
  const last10 = w.phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  return { ownerId: last10, ownerIds: [last10], partyType: "worker", contactName: w.worker?.name || null, contactRef: w.phone };
}
