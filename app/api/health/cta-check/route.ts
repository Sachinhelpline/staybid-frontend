// v125 — End-to-end CTA self-diagnostic.
//
// Probes every external dependency the customer-facing CTAs rely on:
//   • Razorpay   — public auth ping (cheaper than an order create)
//   • Supabase   — anon-readable table touch via REST
//   • Railway    — backend health endpoint
//
// Each probe runs in parallel with a short timeout and returns its own
// pass/fail + latency. The aggregate `ok` is true only when every probe
// passes. Designed to be polled from /admin/health (future UI) or curled
// from the command line during an outage drill.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_live_SfFAsbYjbHfztd";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "dv3xFGG44R2FSqlshkDVY2Gn";
const SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";
const RAILWAY = "https://staybid-live-production.up.railway.app";

type Probe = {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  status?: number;
};

async function timed<T>(name: string, fn: () => Promise<T>): Promise<Probe & { result?: T }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, latencyMs: Date.now() - t0, result };
  } catch (err: any) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - t0,
      detail: err?.message || String(err),
    };
  }
}

async function probeRazorpay(): Promise<Probe> {
  return timed("razorpay", async () => {
    const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString("base64");
    // Hits the lightest auth-required endpoint to confirm keys are alive
    // without spending a real order.
    const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const desc =
        body?.error?.description || body?.error?.code || `HTTP ${res.status}`;
      throw new Error(desc);
    }
    return { status: res.status };
  });
}

async function probeSupabase(): Promise<Probe> {
  return timed("supabase", async () => {
    const res = await fetch(`${SB_URL}/rest/v1/hotels?select=id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("Supabase did not return an array");
    return { status: res.status, rowsSeen: rows.length };
  });
}

async function probeRailway(): Promise<Probe> {
  return timed("railway", async () => {
    const res = await fetch(`${RAILWAY}/api/hotels?limit=1`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Railway HTTP ${res.status}`);
    return { status: res.status };
  });
}

async function probeRazorpayOrderRoute(origin: string): Promise<Probe> {
  return timed("self.razorpay-order-GET", async () => {
    const res = await fetch(`${origin}/api/razorpay/order`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`Self HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.ok) throw new Error("Order route reports not-ok");
    return { keyIdPrefix: data.keyIdPrefix, hasSecret: data.hasSecret };
  });
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  const [razorpay, supabase, railway, selfOrder] = await Promise.all([
    probeRazorpay(),
    probeSupabase(),
    probeRailway(),
    probeRazorpayOrderRoute(origin),
  ]);

  const probes = [razorpay, supabase, railway, selfOrder];
  const allOk = probes.every((p) => p.ok);

  return NextResponse.json(
    {
      ok: allOk,
      build: process.env.SB_BUILD || "dev",
      checkedAt: new Date().toISOString(),
      probes,
      // Quick advice based on which probe failed.
      advice: probes
        .filter((p) => !p.ok)
        .map((p) => {
          if (p.name === "razorpay")
            return "Razorpay keys may be inactive — check Razorpay Dashboard → Settings → API Keys.";
          if (p.name === "supabase")
            return "Supabase REST unreachable — check uxxhbdqedazpmvbvaosh project status.";
          if (p.name === "railway")
            return "Railway backend cold or down — wait 30s and retry, or check Railway logs.";
          if (p.name === "self.razorpay-order-GET")
            return "Local route /api/razorpay/order failed — check Vercel build logs.";
          return `${p.name}: ${p.detail}`;
        }),
    },
    { status: allOk ? 200 : 503 },
  );
}
