// GET /api/hotels/:id/autopilot
//   Returns the hotel's autopilot mode for the customer-side bid
//   scheduler. Defaults to 'auto' if column is missing or unreadable —
//   no caller is ever blocked by this lookup.
//
// v130 — Hybrid AI Autopilot (Option 2).

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_KEY } from "@/lib/sb";

const SB_H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

type AutopilotMode = "auto" | "hybrid" | "manual";

function safeMode(raw: any): AutopilotMode {
  if (raw === "hybrid" || raw === "manual") return raw;
  return "auto";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ mode: "auto" }, { status: 200 });
  }
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/hotels?id=eq.${encodeURIComponent(id)}&select=autopilot_mode,autopilot_updated_at&limit=1`,
      { headers: SB_H, cache: "no-store" },
    );
    if (!r.ok) {
      // 4xx most likely means the column doesn't exist (pre-migration).
      // Fall through to default 'auto'. Don't surface the upstream error.
      return NextResponse.json({ mode: "auto", source: "default" }, { status: 200 });
    }
    const rows = await r.json().catch(() => []);
    const row = Array.isArray(rows) ? rows[0] : null;
    const mode = safeMode(row?.autopilot_mode);
    const res = NextResponse.json({
      mode,
      updatedAt: row?.autopilot_updated_at || null,
      source: row ? "db" : "default",
    });
    // 60s edge cache — matches the in-browser memo in lib/autopilot.ts.
    res.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    return res;
  } catch {
    return NextResponse.json({ mode: "auto", source: "default" }, { status: 200 });
  }
}
