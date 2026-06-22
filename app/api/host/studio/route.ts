import { NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ, userFromReq } from "@/lib/sb";
import { generateDesignOptions } from "@/lib/host/design-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REST = `${SB_URL}/rest/v1`;

// GET /api/host/studio            → recent projects (+ options) for the user
// GET /api/host/studio?id=<dpr>   → one project + its options
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const user = userFromReq(req);

  try {
    if (id) {
      const [pRes, oRes] = await Promise.all([
        fetch(`${REST}/host_design_projects?id=eq.${encodeURIComponent(id)}&select=*`, { headers: SB_READ }),
        fetch(`${REST}/host_design_options?project_id=eq.${encodeURIComponent(id)}&select=*&order=sort_order.asc`, { headers: SB_READ }),
      ]);
      const project = (await pRes.json())?.[0] || null;
      const options = (await oRes.json()) || [];
      if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ project, options });
    }

    if (!user?.id) return NextResponse.json({ projects: [] });
    const pRes = await fetch(
      `${REST}/host_design_projects?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=created_at.desc&limit=20`,
      { headers: SB_READ },
    );
    const projects = (await pRes.json()) || [];
    if (!projects.length) return NextResponse.json({ projects: [] });
    const ids = projects.map((p: any) => p.id);
    const oRes = await fetch(
      `${REST}/host_design_options?project_id=in.(${ids.map((x: string) => `"${x}"`).join(",")})&select=*&order=sort_order.asc`,
      { headers: SB_READ },
    );
    const allOpts = (await oRes.json()) || [];
    const byProject: Record<string, any[]> = {};
    for (const o of allOpts) (byProject[o.project_id] ||= []).push(o);
    return NextResponse.json({ projects: projects.map((p: any) => ({ ...p, options: byProject[p.id] || [] })) });
  } catch (e: any) {
    return NextResponse.json({ error: "Load failed", detail: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }
}

// POST /api/host/studio — create a project, generate options, persist, return.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const images = Array.isArray(body?.images) ? body.images.filter((x: any) => typeof x === "string").slice(0, 8) : [];
  const style = String(body?.style || "").trim().slice(0, 60) || null;
  const roomType = String(body?.roomType || "").trim().slice(0, 60) || null;
  const budgetMin = Number(body?.budgetMin) > 0 ? Math.round(Number(body.budgetMin)) : null;
  const budgetMax = Number(body?.budgetMax) > 0 ? Math.round(Number(body.budgetMax)) : null;
  const user = userFromReq(req);

  let result;
  try {
    result = await generateDesignOptions({
      images, style: style || undefined, roomType: roomType || undefined,
      budgetMin: budgetMin || undefined, budgetMax: budgetMax || undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "AI generation failed", detail: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }

  try {
    // 1. project
    const pr = await fetch(`${REST}/host_design_projects`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user?.id || null,
        hotel_id: String(body?.hotelId || "").trim() || null,
        title: String(body?.title || "").trim().slice(0, 140) || `${roomType || "Room"} · ${style || "Mixed styles"}`,
        room_type: roomType, style, budget_min: budgetMin, budget_max: budgetMax,
        source_images: images, status: "ready", ai_provider: result.provider,
      }),
    });
    if (!pr.ok) throw new Error(`project insert ${pr.status}`);
    const project = (await pr.json())?.[0];

    // 2. options
    const rows = result.options.map((o, i) => ({
      project_id: project.id, style: o.style, title: o.title, description: o.description,
      est_cost: o.estCost, products: o.products, sort_order: i,
    }));
    let options: any[] = [];
    if (rows.length) {
      const or = await fetch(`${REST}/host_design_options`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
      options = or.ok ? await or.json() : [];
    }
    return NextResponse.json({ project, options, provider: result.provider });
  } catch (e: any) {
    return NextResponse.json({ error: "Save failed", detail: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }
}
