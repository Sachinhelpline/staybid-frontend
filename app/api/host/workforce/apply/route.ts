// v283 Gap 3 — worker onboarding. A pro applies to join the StayBid workforce.
// Creates a workforce_workers row with status='pending' + available=false so it
// stays OUT of the public catalog until an admin approves it.
//
//   POST /api/host/workforce/apply
//   body { name, phone, skill, city, locality?, rate?, rateUnit?, bio?,
//          languages?, avatarUrl?, email?, note? }
import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";

export const dynamic = "force-dynamic";

const SKILLS = new Set([
  "housekeeping", "cook", "chef", "front_desk", "manager", "security",
  "maintenance", "gardener", "driver", "spa", "waiter", "cleaner", "other",
]);

export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const name = String(body?.name || "").trim().slice(0, 120);
  const phone = String(body?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  const skill = SKILLS.has(String(body?.skill)) ? String(body.skill) : "other";
  const city = String(body?.city || "").trim().slice(0, 80) || null;
  if (!name || phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Name and a valid 10-digit phone are required." }, { status: 400 });
  }

  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const langs = Array.isArray(body?.languages) ? body.languages.slice(0, 12).map((s: any) => String(s).slice(0, 30)) : [];

  const row = {
    name,
    phone,
    email: String(body?.email || "").trim().slice(0, 160) || null,
    skill,
    city,
    locality: String(body?.locality || "").trim().slice(0, 120) || null,
    rate: num(body?.rate),
    rate_unit: ["job", "hour", "day", "month"].includes(String(body?.rateUnit)) ? String(body.rateUnit) : "job",
    bio: String(body?.bio || "").trim().slice(0, 1000) || null,
    languages: langs,
    avatar_url: String(body?.avatarUrl || "").trim().slice(0, 600) || null,
    applied_note: String(body?.note || "").trim().slice(0, 1000) || null,
    status: "pending",
    available: false,
    active: true,
    verified: false,
    background_checked: false,
  };

  try {
    // Soft-dedupe: if an approved/pending worker already exists on this phone,
    // don't create a duplicate row — tell them to sign in instead.
    const last10 = phone.replace(/\D/g, "").slice(-10);
    const ex = await fetch(
      `${SB_URL}/rest/v1/workforce_workers?phone=ilike.*${last10}&select=id,status&limit=1`,
      { headers: SB_READ, cache: "no-store" },
    );
    if (ex.ok) {
      const [w] = await ex.json();
      if (w) {
        return NextResponse.json(
          { error: `This number is already registered (status: ${w.status}). Sign in at /worker instead.`, existing: true, status: w.status },
          { status: 409 },
        );
      }
    }

    const r = await fetch(`${SB_URL}/rest/v1/workforce_workers`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not submit application", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    return NextResponse.json({ ok: true, id: saved?.id });
  } catch (e: any) {
    return NextResponse.json({ error: "Network error", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }
}
