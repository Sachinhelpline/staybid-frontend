// v178 — Admin: subscription payment ledger (Phase 5).
//
//   GET → every service_payments row + revenue totals.
//
// Auth: requireVerifiedAdmin (signed admin JWT + server-side role lookup).
//
import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin, auditIdentity } from "@/lib/admin/verify";
import { SB_URL, SB_H } from "@/lib/sb-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/service_payments?select=*&order=created_at.desc&limit=500`,
      { headers: SB_H },
    );
    if (!r.ok) return NextResponse.json({ payments: [], totals: emptyTotals(), provisioned: false });
    const rows = await r.json().catch(() => []);
    const payments = Array.isArray(rows) ? rows : [];
    const paid = payments.filter((p: any) => p.status === "paid");
    const now = Date.now();
    const monthAgo = now - 30 * 86400000;
    const totals = {
      paidCount: paid.length,
      revenue: paid.reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0),
      revenue30d: paid
        .filter((p: any) => p.paid_at && new Date(p.paid_at).getTime() >= monthAgo)
        .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0),
      activeSubs: paid.filter((p: any) => p.expires_at && new Date(p.expires_at).getTime() > now).length,
    };
    return NextResponse.json({ payments, totals, provisioned: true });
  } catch {
    return NextResponse.json({ payments: [], totals: emptyTotals(), provisioned: false });
  }
}

function emptyTotals() {
  return { paidCount: 0, revenue: 0, revenue30d: 0, activeSubs: 0 };
}
