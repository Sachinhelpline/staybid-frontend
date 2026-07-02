// v283 Gap 3 — worker acts on one of their assigned jobs. Ownership-guarded
// status transitions only. On "complete" we bump the worker's jobs_done.
import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { workerFromReq } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

// action → { from-states allowed, to-state }
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  accept:   { from: ["requested"], to: "assigned" },
  start:    { from: ["assigned"], to: "in_progress" },
  complete: { from: ["in_progress"], to: "completed" },
  decline:  { from: ["requested", "assigned"], to: "cancelled" },
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await workerFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!auth.worker) return NextResponse.json({ error: "Not registered as a worker." }, { status: 404 });
  if (auth.worker.status !== "approved") return NextResponse.json({ error: "Your application is not approved yet." }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body?.action || "");
  const t = TRANSITIONS[action];
  if (!t) return NextResponse.json({ error: "action must be accept|start|complete|decline" }, { status: 400 });

  try {
    // Fetch the job + verify it belongs to this worker and is in an allowed from-state.
    const jr = await fetch(
      `${SB_URL}/rest/v1/workforce_jobs?id=eq.${encodeURIComponent(id)}&select=id,worker_id,status&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    const [job] = jr.ok ? await jr.json() : [];
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (job.worker_id !== auth.worker.id) return NextResponse.json({ error: "Not your job." }, { status: 403 });
    if (!t.from.includes(job.status)) {
      return NextResponse.json({ error: `Cannot ${action} a ${job.status} job.` }, { status: 409 });
    }

    const pr = await fetch(`${SB_URL}/rest/v1/workforce_jobs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({ status: t.to, updated_at: new Date().toISOString() }),
    });
    if (!pr.ok) {
      const txt = await pr.text();
      return NextResponse.json({ error: "Update failed", detail: txt.slice(0, 200) }, { status: 502 });
    }
    const [row] = await pr.json();

    // Best-effort: bump jobs_done when a job completes.
    if (t.to === "completed") {
      try {
        const next = Number(auth.worker.jobs_done || 0) + 1;
        await fetch(`${SB_URL}/rest/v1/workforce_workers?id=eq.${encodeURIComponent(auth.worker.id)}`, {
          method: "PATCH", headers: SB_H,
          body: JSON.stringify({ jobs_done: next, updated_at: new Date().toISOString() }),
        });
      } catch { /* non-blocking */ }
    }
    return NextResponse.json({ ok: true, job: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
