// v283 Gap 3 — worker sign-in resolver. Called with a Bearer JWT (from Railway
// verify-otp, proving phone ownership). Resolves the workforce_workers row by
// that phone and returns it — or a "not registered" signal so the UI can route
// the person to the /host/workforce/join application form.
import { NextResponse } from "next/server";
import { workerFromReq } from "@/lib/worker/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await workerFromReq(req);
  if (!auth) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!auth.worker) {
    return NextResponse.json({ registered: false, phone: auth.phone }, { status: 404 });
  }
  const w = auth.worker;
  if (w.status !== "approved") {
    return NextResponse.json({ registered: true, approved: false, status: w.status, worker: publicWorker(w) });
  }
  return NextResponse.json({ registered: true, approved: true, worker: publicWorker(w) });
}

function publicWorker(w: any) {
  return {
    id: w.id, name: w.name, skill: w.skill, city: w.city, locality: w.locality,
    rate: w.rate, rate_unit: w.rate_unit, rating: w.rating, jobs_done: w.jobs_done,
    verified: w.verified, background_checked: w.background_checked, available: w.available,
    avatar_url: w.avatar_url, bio: w.bio, languages: w.languages, status: w.status,
  };
}
