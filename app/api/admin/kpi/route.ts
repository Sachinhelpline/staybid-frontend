// v584 — DECK KPI SCORECARD (admin-gated).
//
// The owner's "Execution Roadmap, KPIs & Scale Blueprint" deck as a LIVE
// dashboard: each deck KPI computed from the real tables (bid_requests,
// bookings, bids) against the deck's target band. Read-only; every number
// is derived in memory from bounded parallel reads (the same pattern as
// /api/admin/analytics/bidding).
//
// Honesty rule: a KPI we don't instrument yet (assisted-booking share) is
// returned with actual=null + a note — never a fabricated number.
//
// GET /api/admin/kpi?days=90   (x-admin-token / Bearer, adminFromReq)

import { NextRequest, NextResponse } from "next/server";
import { SB_URL, SB_READ } from "@/lib/sb";
import { adminFromReq } from "@/lib/admin/audit";

async function sbGet(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_READ, cache: "no-store" });
  if (!r.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

const nightsOf = (ci?: string | null, co?: string | null) => {
  const a = new Date(String(ci || "")).getTime();
  const b = new Date(String(co || "")).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400_000));
};

export async function GET(req: NextRequest) {
  if (!adminFromReq(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const days = Math.max(7, Math.min(365, Number(searchParams.get("days") || 90)));
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
  const since = encodeURIComponent(sinceIso);

  const [reqs, bookings, bids] = await Promise.all([
    sbGet(`bid_requests?createdAt=gte.${since}&select=id,createdAt&limit=10000`),
    sbGet(`bookings?createdAt=gte.${since}&select=id,customerId,paidAmount,status,checkIn,checkOut,createdAt&limit=10000`),
    sbGet(`bids?createdAt=gte.${since}&select=id,status,createdAt,updatedAt&limit=10000`),
  ]);

  // ── derive ────────────────────────────────────────────────────────────
  const leads = reqs.length;

  const cancelled = bookings.filter((b: any) => /cancel|refund/i.test(String(b.status || "")));
  const paid = bookings.filter(
    (b: any) => Number(b.paidAmount) > 0 && !/cancel|refund/i.test(String(b.status || "")),
  );

  const conversion = leads ? (paid.length / leads) * 100 : null;

  const abv = paid.length
    ? Math.round(paid.reduce((s: number, b: any) => s + Number(b.paidAmount), 0) / paid.length)
    : null;

  const byCustomer: Record<string, number> = {};
  paid.forEach((b: any) => {
    const c = String(b.customerId || "");
    if (c) byCustomer[c] = (byCustomer[c] || 0) + 1;
  });
  const customers = Object.keys(byCustomer).length;
  const repeaters = Object.values(byCustomer).filter((n) => n >= 2).length;
  const repeatRate = customers ? (repeaters / customers) * 100 : null;

  const cancelRate = bookings.length ? (cancelled.length / bookings.length) * 100 : null;

  const premium = paid.filter(
    (b: any) => Number(b.paidAmount) / nightsOf(b.checkIn, b.checkOut) >= 12000,
  );
  const premiumShare = paid.length ? (premium.length / paid.length) * 100 : null;

  const accepted = bids.filter((b: any) => b.status === "ACCEPTED");
  const acceptRate = bids.length ? (accepted.length / bids.length) * 100 : null;
  const mins = accepted
    .map((b: any) => (new Date(b.updatedAt).getTime() - new Date(b.createdAt).getTime()) / 60000)
    .filter((m: number) => Number.isFinite(m) && m >= 0 && m < 60 * 24)
    .sort((a: number, b: number) => a - b);
  const medianAcceptMins = mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null;

  // ── deck targets (Execution Roadmap sheet) ────────────────────────────
  const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  const kpis = [
    { key: "leads",     label: "Qualified leads (bid requests)", actual: leads,                  unit: "",    target: "25,000 / quarter",  band: null,        note: `${days}-day window` },
    { key: "conv",      label: "Inquiry → booking conversion",   actual: r1(conversion),         unit: "%",   target: "18–25%",            band: [18, 25] },
    { key: "abv",       label: "Average booking value",          actual: abv,                    unit: "₹",   target: "₹22,000",           band: [22000, Infinity] },
    { key: "repeat",    label: "Repeat guest rate",              actual: r1(repeatRate),         unit: "%",   target: "20%",               band: [20, Infinity] },
    { key: "cancel",    label: "Cancellation rate",              actual: r1(cancelRate),         unit: "%",   target: "< 7%",              band: [0, 7], invert: true },
    { key: "premium",   label: "Premium experiences share",      actual: r1(premiumShare),       unit: "%",   target: "30%",               band: [30, Infinity] },
    { key: "accept",    label: "Bid accept rate",                actual: r1(acceptRate),         unit: "%",   target: "—",                 band: null },
    { key: "speed",     label: "Median accept time",             actual: medianAcceptMins,       unit: "min", target: "—",                 band: null },
    { key: "assisted",  label: "Assisted (WhatsApp) share",      actual: null,                   unit: "%",   target: "35–45%",            band: null,
      note: "Not instrumented yet — WhatsApp taps are client-side only" },
  ].map((k: any) => {
    let status: "ok" | "low" | "na" = "na";
    if (k.actual != null && Array.isArray(k.band)) {
      const v = Number(k.actual);
      status = k.invert
        ? (v <= k.band[1] ? "ok" : "low")
        : (v >= k.band[0] ? "ok" : "low");
    }
    return { ...k, status };
  });

  return NextResponse.json({
    days, since: sinceIso,
    totals: { leads, bookings: bookings.length, paidBookings: paid.length, bids: bids.length },
    kpis,
  });
}
