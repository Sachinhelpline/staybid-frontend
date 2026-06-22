import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

// POST /api/host/workforce/hire — a host requests a worker for a job.
// Body: { workerId, name, phone, scheduledAt?, durationHint?, message? }
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const workerId = String(body?.workerId || "").trim();
  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!workerId || !name || phone.length < 8) {
    return NextResponse.json({ error: "Worker, name and a valid phone are required." }, { status: 400 });
  }

  const user = userFromReq(req);

  // Look up the worker so we can snapshot skill + rate onto the job row.
  let skill: string | null = null;
  let amount: number | null = null;
  try {
    const wr = await fetch(
      `${SB_URL}/rest/v1/workforce_workers?id=eq.${encodeURIComponent(workerId)}&select=skill,rate&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (wr.ok) {
      const [w] = await wr.json();
      if (w) { skill = w.skill ?? null; amount = w.rate ?? null; }
    }
  } catch { /* snapshot is best-effort */ }

  const row = {
    worker_id: workerId,
    user_id: user?.id || null,
    skill,
    scheduled_at: body?.scheduledAt ? String(body.scheduledAt).slice(0, 40) : null,
    duration_hint: String(body?.durationHint || "").trim().slice(0, 120) || null,
    contact: { name, phone },
    amount,
    status: "requested",
    notes: String(body?.message || "").trim().slice(0, 1000) || null,
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/workforce_jobs`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save request", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
