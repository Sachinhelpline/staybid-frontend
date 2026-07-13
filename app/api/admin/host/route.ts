// v276 — Admin Host Hub API (StayBid for Hosts vertical).
//
//   GET  /api/admin/host  → all 6 host-vertical data sources + analytics KPIs:
//        leads (host_leads), design projects (host_design_projects + options),
//        store orders (store_orders + items), property inquiries
//        (discovery_inquiries), workforce jobs (workforce_jobs), channel
//        requests (host_channels). Parallel-fetched; users side-loaded for the
//        rows that only carry a user_id.
//
//   PATCH /api/admin/host  body { source, id, status }
//        source ∈ lead | inquiry | order | job | channel.
//        Updates that row's status. Audit-logged.
//
// Auth: x-admin-token / x-admin-id (adminFromReq). Mutations audit-logged.
//
import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_H, SB_READ } from "@/lib/sb";
import { adminFromReq, logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

async function sbGet(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${REST}/${path}`, { headers: SB_READ, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

// PostgREST count helper — uses Prefer: count=exact + a HEAD-ish range.
async function sbCount(table: string, filter = ""): Promise<number> {
  try {
    const url = `${REST}/${table}?select=id${filter ? `&${filter}` : ""}`;
    const r = await fetch(url, {
      headers: { ...SB_READ, Prefer: "count=exact", Range: "0-0" },
      cache: "no-store",
    });
    const cr = r.headers.get("content-range") || "";
    const total = cr.split("/")[1];
    return total && total !== "*" ? Number(total) : 0;
  } catch {
    return 0;
  }
}

// Side-load users by id (manual join — no PostgREST FK embed in this schema).
async function attachUsers(rows: any[], idKey = "user_id"): Promise<any[]> {
  const ids = Array.from(new Set(rows.map((r) => r?.[idKey]).filter(Boolean)));
  if (!ids.length) return rows;
  const users = await sbGet(
    `users?id=in.(${ids.map((x) => encodeURIComponent(x)).join(",")})&select=id,name,phone,email`,
  );
  const byId = Object.fromEntries(users.map((u: any) => [u.id, u]));
  return rows.map((r) => ({ ...r, _user: byId[r?.[idKey]] || null }));
}

export async function GET(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [
      leads,
      projects,
      orders,
      inquiries,
      jobs,
      channels,
      propertySubmissions,
      portfolios,
    ] = await Promise.all([
      sbGet("host_leads?select=*&order=created_at.desc&limit=200"),
      sbGet("host_design_projects?select=*&order=created_at.desc&limit=120"),
      sbGet("store_orders?select=*&order=created_at.desc&limit=120"),
      sbGet("discovery_inquiries?select=*&order=created_at.desc&limit=200"),
      sbGet("workforce_jobs?select=*&order=created_at.desc&limit=200"),
      sbGet("host_channels?select=*&order=created_at.desc&limit=200"),
      // v281 — owner property listings for lease/rent. Newest + pending on top
      // so the admin review queue sees fresh submissions first.
      sbGet("discovery_properties?select=*&order=created_at.desc&limit=200").catch(() => []),
      // v284 — portfolio configurator purchases (the 5-phase journey).
      // preferences JSONB is the sanitized non-priced journey metadata.
      sbGet("host_portfolio_configs?select=*&order=created_at.desc&limit=200").catch(() => []),
    ]);

    // Enrich rows that only carry user_id.
    const [projectsU, ordersU, jobsU, channelsU, propSubsU, portfoliosU] = await Promise.all([
      attachUsers(projects),
      attachUsers(orders),
      attachUsers(jobs),
      attachUsers(channels),
      // v281 — property submissions carry submitted_by (nullable for seed rows).
      attachUsers(propertySubmissions, "submitted_by"),
      // v284 — portfolio configs carry user_id.
      attachUsers(portfolios),
    ]);

    // Side-load design-option counts + worker names + property names + order items.
    const projIds = projectsU.map((p) => p.id);
    const workerIds = Array.from(new Set(jobsU.map((j) => j.worker_id).filter(Boolean)));
    const propIds = Array.from(new Set(inquiries.map((i) => i.property_id).filter(Boolean)));
    const orderIds = ordersU.map((o) => o.id);

    const [optionRows, workers, props, orderItems] = await Promise.all([
      projIds.length
        ? sbGet(`host_design_options?project_id=in.(${projIds.map((x) => `"${x}"`).join(",")})&select=project_id,id,title,est_cost`)
        : Promise.resolve([]),
      workerIds.length
        ? sbGet(`workforce_workers?id=in.(${workerIds.map((x) => `"${x}"`).join(",")})&select=id,name,skill,city`)
        : Promise.resolve([]),
      propIds.length
        ? sbGet(`discovery_properties?id=in.(${propIds.map((x) => `"${x}"`).join(",")})&select=id,title,city`).catch(() => [])
        : Promise.resolve([]),
      orderIds.length
        ? sbGet(`store_order_items?order_id=in.(${orderIds.map((x) => `"${x}"`).join(",")})&select=order_id,name,mode,qty,line_total`)
        : Promise.resolve([]),
    ]);

    const optCount = new Map<string, number>();
    for (const o of optionRows) optCount.set(o.project_id, (optCount.get(o.project_id) || 0) + 1);
    const workerById = Object.fromEntries(workers.map((w: any) => [w.id, w]));
    const propById = Object.fromEntries(props.map((p: any) => [p.id, p]));
    const itemsByOrder = new Map<string, any[]>();
    for (const it of orderItems) {
      const arr = itemsByOrder.get(it.order_id) || [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }

    // v336 (Circle Phase F) — side-load the provisioned operated hotel's
    // approval_status so the admin sees whether a provisioned listing is still a
    // DRAFT (needs "Go Live") or already published to customers. Operated supply
    // is provisioned as a DRAFT (approval_status='pending') by v309 and only
    // enters the customer feed once an admin publishes it.
    const provIds = Array.from(new Set(propSubsU.map((p) => p.provisioned_hotel_id).filter(Boolean)));
    const provHotels = provIds.length
      ? await sbGet(`hotels?id=in.(${provIds.map((x) => `"${x}"`).join(",")})&select=id,approval_status,status`).catch(() => [])
      : [];
    const provHotelById = Object.fromEntries(provHotels.map((h: any) => [h.id, h]));
    const propSubsOut = propSubsU.map((p) => ({
      ...p,
      _provisionedHotel: p.provisioned_hotel_id ? (provHotelById[p.provisioned_hotel_id] || null) : null,
    }));

    const projectsOut = projectsU.map((p) => ({ ...p, _optionCount: optCount.get(p.id) || 0 }));
    const jobsOut = jobsU.map((j) => ({ ...j, _worker: workerById[j.worker_id] || null }));
    const inquiriesOut = inquiries.map((i) => ({ ...i, _property: propById[i.property_id] || null }));
    const ordersOut = ordersU.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] }));

    // KPIs — derived in memory (cheap; rows already loaded). Revenue counts
    // only paid orders / jobs (those carrying a razorpay_payment_id).
    const num = (v: any) => Number(v) || 0;
    const isNew = (s?: string) => !s || s === "new" || s === "requested" || s === "pending";

    const storeGmv = ordersOut
      .filter((o) => o.razorpay_payment_id || o.status === "paid" || o.status === "completed")
      .reduce((a, o) => a + num(o.total), 0);
    const workforceRevenue = jobsOut
      .filter((j) => j.razorpay_payment_id || j.status === "paid" || j.status === "completed")
      .reduce((a, j) => a + num(j.amount), 0);

    const kpis = {
      leads: leads.length,
      leadsNew: leads.filter((l) => isNew(l.status)).length,
      projects: projectsOut.length,
      orders: ordersOut.length,
      storeGmv,
      inquiries: inquiriesOut.length,
      inquiriesNew: inquiriesOut.filter((i) => isNew(i.status)).length,
      jobs: jobsOut.length,
      jobsActive: jobsOut.filter((j) => isNew(j.status)).length,
      workforceRevenue,
      channels: channelsU.length,
      channelsNew: channelsU.filter((c) => isNew(c.status)).length,
      // v281 — owner property listings awaiting review.
      propertySubmissions: propSubsU.length,
      propertySubmissionsPending: propSubsU.filter((p) => p.status === "pending_review").length,
      // v284/v285 — portfolio configurator purchases. Revenue = money ACTUALLY
      // collected (charged_amount for holds, else pay_now); 'hold_paid' counts as
      // a live portfolio (10% paid, balance pending after the visit).
      portfolios: portfoliosU.length,
      portfoliosActive: portfoliosU.filter((p) => p.status === "active" || p.status === "hold_paid").length,
      portfolioRevenue: portfoliosU
        .filter((p) => p.status === "active" || p.status === "hold_paid")
        .reduce((a, p) => a + (num(p.charged_amount) > 0 ? num(p.charged_amount) : num(p.pay_now)), 0),
    };

    return NextResponse.json({
      kpis,
      leads,
      projects: projectsOut,
      orders: ordersOut,
      inquiries: inquiriesOut,
      jobs: jobsOut,
      channels: channelsU,
      propertySubmissions: propSubsOut,
      portfolios: portfoliosU,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load host data" }, { status: 500 });
  }
}

const SOURCE_TABLE: Record<string, string> = {
  lead: "host_leads",
  inquiry: "discovery_inquiries",
  order: "store_orders",
  job: "workforce_jobs",
  channel: "host_channels",
  // v281 — owner property listing review (pending_review → available / rejected).
  property: "discovery_properties",
};

// Tables that do NOT have an updated_at column — skip the timestamp bump.
const NO_UPDATED_AT = new Set(["host_leads", "discovery_inquiries", "discovery_properties"]);

export async function PATCH(req: NextRequest) {
  const admin = adminFromReq(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const source = String(body.source || "");
  const id = String(body.id || "");
  const status = String(body.status || "").trim().slice(0, 40);
  const table = SOURCE_TABLE[source];

  if (!table || !id || !status) {
    return NextResponse.json({ error: "source, id, status required" }, { status: 400 });
  }

  try {
    const patch: any = { status };
    // These tables carry an updated_at column; keep it fresh.
    if (!NO_UPDATED_AT.has(table)) {
      patch.updated_at = new Date().toISOString();
    }
    const r = await fetch(`${REST}/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: SB_H,
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Update failed", detail: t.slice(0, 200) }, { status: 502 });
    }
    logAdminAction({ admin, action: "host_status_update", targetType: source, targetId: `${id}:${status}` } as any);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}
