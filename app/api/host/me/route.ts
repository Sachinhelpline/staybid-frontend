import { NextResponse } from "next/server";
import { SB_URL, SB_READ, userFromReq } from "@/lib/sb";

export const dynamic = "force-dynamic";

const REST = `${SB_URL}/rest/v1`;

// GET /api/host/me — the signed-in user's own host-vertical activity across
// every module: leads, property inquiries, design projects, store orders,
// workforce hires, channel connections. Scoped by user_id (the same id the
// host routes write). Mirrors /api/admin/host but for one user, read-only.
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

export async function GET(req: Request) {
  const user = userFromReq(req);
  if (!user?.id) {
    return NextResponse.json({ signedIn: false, leads: [], inquiries: [], projects: [], orders: [], jobs: [], channels: [], portfolios: [], summary: empty() });
  }
  const uid = encodeURIComponent(user.id);

  try {
    const [leads, inquiries, projects, orders, jobs, channels, portfolios] = await Promise.all([
      sbGet(`host_leads?user_id=eq.${uid}&select=id,interest,status,city,message,created_at,metadata&order=created_at.desc&limit=50`),
      sbGet(`discovery_inquiries?user_id=eq.${uid}&select=id,property_id,status,message,created_at&order=created_at.desc&limit=50`),
      sbGet(`host_design_projects?user_id=eq.${uid}&select=id,title,style,room_type,status,budget_min,budget_max,created_at&order=created_at.desc&limit=50`),
      sbGet(`store_orders?user_id=eq.${uid}&select=id,mode,status,total,emi_months,razorpay_payment_id,created_at&order=created_at.desc&limit=50`),
      sbGet(`workforce_jobs?user_id=eq.${uid}&select=id,worker_id,skill,status,amount,scheduled_at,created_at&order=created_at.desc&limit=50`),
      sbGet(`host_channels?user_id=eq.${uid}&select=id,channel,property_ref,status,created_at&order=created_at.desc&limit=50`),
      // v284: portfolio configs (the 5-phase configurator purchases). preferences
      // is the sanitized journey metadata written by /api/host/portfolio/checkout.
      sbGet(`host_portfolio_configs?user_id=eq.${uid}&select=id,tier,cities,rooms,design,addons,payment_mode,pay_now,recurring,security,status,preferences,created_at&order=created_at.desc&limit=20`),
    ]);

    // Side-load joins: property titles + worker names + order items + option counts.
    const propIds = Array.from(new Set(inquiries.map((i) => i.property_id).filter(Boolean)));
    const workerIds = Array.from(new Set(jobs.map((j) => j.worker_id).filter(Boolean)));
    const projIds = projects.map((p) => p.id);
    const orderIds = orders.map((o) => o.id);

    const [props, workers, optionRows, orderItems] = await Promise.all([
      propIds.length ? sbGet(`discovery_properties?id=in.(${propIds.map((x) => `"${x}"`).join(",")})&select=id,title,city`) : Promise.resolve([]),
      workerIds.length ? sbGet(`workforce_workers?id=in.(${workerIds.map((x) => `"${x}"`).join(",")})&select=id,name,city`) : Promise.resolve([]),
      projIds.length ? sbGet(`host_design_options?project_id=in.(${projIds.map((x) => `"${x}"`).join(",")})&select=project_id,id`) : Promise.resolve([]),
      orderIds.length ? sbGet(`store_order_items?order_id=in.(${orderIds.map((x) => `"${x}"`).join(",")})&select=order_id,name,qty`) : Promise.resolve([]),
    ]);

    const propById = Object.fromEntries(props.map((p: any) => [p.id, p]));
    const workerById = Object.fromEntries(workers.map((w: any) => [w.id, w]));
    const optCount = new Map<string, number>();
    for (const o of optionRows) optCount.set(o.project_id, (optCount.get(o.project_id) || 0) + 1);
    const itemsByOrder = new Map<string, any[]>();
    for (const it of orderItems) {
      const arr = itemsByOrder.get(it.order_id) || [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }

    const inquiriesOut = inquiries.map((i) => ({ ...i, _property: propById[i.property_id] || null }));
    const jobsOut = jobs.map((j) => ({ ...j, _worker: workerById[j.worker_id] || null }));
    const projectsOut = projects.map((p) => ({ ...p, _optionCount: optCount.get(p.id) || 0 }));
    const ordersOut = orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] }));

    const num = (v: any) => Number(v) || 0;
    const activePortfolios = portfolios.filter((p) => p.status === "active");
    const summary = {
      leads: leads.length,
      inquiries: inquiriesOut.length,
      projects: projectsOut.length,
      orders: ordersOut.length,
      jobs: jobsOut.length,
      channels: channels.length,
      portfolios: portfolios.length,
      activePortfolios: activePortfolios.length,
      portfolioInvested: activePortfolios.reduce((a, p) => a + num(p.pay_now), 0),
      storeSpend: ordersOut.filter((o) => o.razorpay_payment_id).reduce((a, o) => a + num(o.total), 0),
      total: leads.length + inquiriesOut.length + projectsOut.length + ordersOut.length + jobsOut.length + channels.length + portfolios.length,
    };

    return NextResponse.json({
      signedIn: true,
      leads, inquiries: inquiriesOut, projects: projectsOut, orders: ordersOut, jobs: jobsOut, channels, portfolios,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ signedIn: true, error: String(e?.message || e).slice(0, 160), leads: [], inquiries: [], projects: [], orders: [], jobs: [], channels: [], portfolios: [], summary: empty() }, { status: 502 });
  }
}

function empty() {
  return { leads: 0, inquiries: 0, projects: 0, orders: 0, jobs: 0, channels: 0, portfolios: 0, activePortfolios: 0, portfolioInvested: 0, storeSpend: 0, total: 0 };
}
