// v283 Gap 3 — jobs assigned to the signed-in worker. Enriches each job with
// the hotel name (manual side-load — no FK embed in this schema).
import { NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { workerFromReq } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await workerFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!auth.worker) return NextResponse.json({ error: "Not registered as a worker." }, { status: 404 });

  try {
    const jr = await fetch(
      `${SB_URL}/rest/v1/workforce_jobs?worker_id=eq.${encodeURIComponent(auth.worker.id)}&select=*&order=created_at.desc&limit=200`,
      { headers: SB_READ, cache: "no-store" },
    );
    const jobs = jr.ok ? await jr.json() : [];

    const hotelIds = Array.from(new Set(jobs.map((j: any) => j.hotel_id).filter(Boolean)));
    let byId: Record<string, any> = {};
    if (hotelIds.length) {
      const hr = await fetch(
        `${SB_URL}/rest/v1/hotels?id=in.(${hotelIds.map((x) => `"${x}"`).join(",")})&select=id,name,city`,
        { headers: SB_READ, cache: "no-store" },
      );
      if (hr.ok) byId = Object.fromEntries((await hr.json()).map((h: any) => [h.id, h]));
    }
    const out = jobs.map((j: any) => ({ ...j, _hotel: byId[j.hotel_id] || null }));

    const kpis = {
      total: out.length,
      active: out.filter((j: any) => ["requested", "assigned", "in_progress"].includes(j.status)).length,
      completed: out.filter((j: any) => j.status === "completed").length,
      earnings: out.filter((j: any) => j.status === "completed").reduce((a: number, j: any) => a + Number(j.amount || 0), 0),
    };
    return NextResponse.json({ jobs: out, kpis, worker: { id: auth.worker.id, available: auth.worker.available } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load jobs" }, { status: 500 });
  }
}
