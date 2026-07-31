import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedAdmin } from "@/lib/admin/verify";
import { SB_URL, SB_KEY } from "@/lib/sb";

// ─────────────────────────────────────────────────────────────────────────────
// Admin moderation queue — reel content reports + blocked-contact comment flags.
//   GET   → both queues (newest first) + KPI counts.
//   PATCH → { table: "content_reports" | "comment_flags", id, status }
//           status ∈ open | reviewed | dismissed | actioned
// Behind the admin shell (same posture as /api/admin/fraud).
// ─────────────────────────────────────────────────────────────────────────────
const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function sbGet(path: string) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_H, cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function GET(req: Request) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [reports, flags] = await Promise.all([
    sbGet("content_reports?select=*&order=created_at.desc&limit=300"),
    sbGet("comment_flags?select=*&order=created_at.desc&limit=300"),
  ]);
  const openReports = reports.filter((r: any) => r.status === "open").length;
  const openFlags   = flags.filter((f: any) => f.status === "open").length;
  return NextResponse.json({
    reports,
    flags,
    kpis: {
      openReports,
      openFlags,
      totalReports: reports.length,
      totalFlags: flags.length,
    },
  });
}

const TABLES = new Set(["content_reports", "comment_flags"]);
const STATUSES = new Set(["open", "reviewed", "dismissed", "actioned"]);

export async function PATCH(req: NextRequest) {
  const admin = await requireVerifiedAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const table = String(body?.table || "");
    const id = String(body?.id || "");
    const status = String(body?.status || "");
    if (!TABLES.has(table) || !id || !STATUSES.has(status)) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=minimal" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
