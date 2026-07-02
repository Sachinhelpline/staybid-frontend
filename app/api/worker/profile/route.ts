// v283 Gap 3 — worker self-profile. GET own row; PATCH self-editable fields
// (availability, bio, rate, languages, avatar, city, locality). Trust/lifecycle
// fields (status, verified, background_checked, jobs_done, rating) are NOT
// editable here — only the admin can change those.
import { NextResponse } from "next/server";
import { SB_URL, SB_H } from "@/lib/sb";
import { workerFromReq } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await workerFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!auth.worker) return NextResponse.json({ error: "Not registered as a worker." }, { status: 404 });
  return NextResponse.json({ worker: auth.worker });
}

export async function PATCH(req: Request) {
  const auth = await workerFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!auth.worker) return NextResponse.json({ error: "Not registered as a worker." }, { status: 404 });
  if (auth.worker.status !== "approved") {
    return NextResponse.json({ error: "Your application is not approved yet." }, { status: 403 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const str = (v: any, n = 1000) => (v == null ? undefined : String(v).slice(0, n));
  const num = (v: any) => { if (v === "" || v == null) return undefined; const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : undefined; };

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ("available" in body) patch.available = !!body.available;
  if ("bio" in body) patch.bio = str(body.bio);
  if ("city" in body) patch.city = str(body.city, 80);
  if ("locality" in body) patch.locality = str(body.locality, 120);
  if ("avatar_url" in body) patch.avatar_url = str(body.avatar_url, 600);
  if ("rate" in body) { const r = num(body.rate); if (r !== undefined) patch.rate = r; }
  if ("rate_unit" in body && ["job", "hour", "day", "month"].includes(String(body.rate_unit))) patch.rate_unit = String(body.rate_unit);
  if ("languages" in body && Array.isArray(body.languages)) patch.languages = body.languages.slice(0, 12).map((s: any) => String(s).slice(0, 30));

  try {
    const r = await fetch(`${SB_URL}/rest/v1/workforce_workers?id=eq.${encodeURIComponent(auth.worker.id)}`, {
      method: "PATCH",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [row] = await r.json();
    return NextResponse.json({ ok: true, worker: row });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
