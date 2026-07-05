import { NextResponse } from "next/server";
import { SB_URL, SB_H, userFromReq } from "@/lib/sb";
import { computeBundle, clampConfig, MONTHLY_MAX_ROOMS, type PortfolioConfig } from "@/lib/host/wizard-rules";
import { resolveWizardConfig } from "@/lib/host/wizard-config-store";
import { sanitizeJourneyPreferences } from "@/lib/host/journey-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY_ID = "rzp_live_SfFAsbYjbHfztd";

// POST /api/host/portfolio/checkout
// Body: { config: { tier, cities, rooms, design, addons, paymentMode },
//         contact:{name,phone,email}, preferences?: JourneyPreferences }
// The server re-computes the ENTIRE bundle from lib/host/wizard-rules — the
// client never sets any amount. The Razorpay charge = breakdown.payNow.
// `preferences` are NON-PRICED journey metadata (v284 5-phase wizard) —
// whitelisted via sanitizeJourneyPreferences, never touch computeBundle.
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Resolve the admin-edited pricing config (falls back to bundled defaults).
  const wc = await resolveWizardConfig();

  const raw = body?.config && typeof body.config === "object" ? body.config : {};
  const cfg: PortfolioConfig = clampConfig({
    tier: raw.tier,
    cities: Array.isArray(raw.cities) ? raw.cities : [],
    rooms: Number(raw.rooms) || 0,
    design: String(raw.design || "essential"),
    addons: Array.isArray(raw.addons) ? raw.addons : [],
    paymentMode: raw.paymentMode,
  }, wc);

  const contact = body?.contact && typeof body.contact === "object" ? body.contact : {};
  const name = String(contact?.name || "").trim().slice(0, 120);
  const phone = String(contact?.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
  if (!name || phone.length < 8) {
    return NextResponse.json({ error: "Name and a valid phone are required." }, { status: 400 });
  }

  // v285 — monthly plan covers a SINGLE property. Enforce server-side too so a
  // tampered client can't sneak a multi-room monthly through.
  if (cfg.paymentMode === "monthly" && cfg.rooms > MONTHLY_MAX_ROOMS) {
    return NextResponse.json(
      { error: `The Monthly plan covers ${MONTHLY_MAX_ROOMS} property. Reduce to ${MONTHLY_MAX_ROOMS} room, or pick Quarterly / Half-yearly / Yearly for a ${cfg.rooms}-room portfolio.` },
      { status: 400 },
    );
  }

  // Server-authoritative compute (same resolved config the wizard previewed).
  const bundle = computeBundle(cfg, wc);
  if (!bundle.ok) {
    return NextResponse.json({ error: bundle.error || "Invalid configuration." }, { status: 400 });
  }

  // v285 — pay option decides the amount charged NOW (the client never sets it):
  //   full → full payNow · emi → full payNow (split by Razorpay) · hold → 10% now.
  const payOption = ["full", "hold", "emi"].includes(String(body?.payOption)) ? String(body.payOption) : "full";
  const holdAmount = Math.round(bundle.payNow * 0.10);
  const chargeable = payOption === "hold" ? holdAmount : bundle.payNow;
  const balanceDue = payOption === "hold" ? Math.max(0, bundle.payNow - holdAmount) : 0;
  if (!Number.isFinite(chargeable) || chargeable <= 0) {
    return NextResponse.json({ error: "Nothing to charge for this configuration." }, { status: 400 });
  }

  // Create the Razorpay order via the shared self-healing route (amount in rupees).
  const origin = new URL(req.url).origin;
  let rzp: any = null;
  try {
    const orderRes = await fetch(`${origin}/api/razorpay/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: chargeable,
        receipt: `hostpf_${Date.now()}`,
        notes: { kind: "host_portfolio", payOption, tier: cfg.tier, rooms: String(cfg.rooms), cities: String(cfg.cities.length) },
      }),
    });
    rzp = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !rzp?.id) {
      return NextResponse.json(
        { error: rzp?.error || "Could not start payment.", detail: rzp?.code || null },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  // Persist the config snapshot (status pending_payment until verify).
  const user = userFromReq(req);
  const row = {
    user_id: user?.id || null,
    tier: cfg.tier,
    cities: cfg.cities,
    rooms: cfg.rooms,
    design: cfg.design,
    addons: cfg.addons,
    payment_mode: cfg.paymentMode,
    breakdown: bundle,
    pay_now: bundle.payNow,
    recurring: bundle.recurringAfter,
    security: bundle.security,
    // v285 — how the partner chose to pay the payNow amount.
    pay_option: payOption,
    charged_amount: chargeable,
    hold_amount: payOption === "hold" ? holdAmount : null,
    balance_due: payOption === "hold" ? balanceDue : 0,
    status: "pending_payment",
    contact: { name, phone, email: String(contact?.email || "").trim().slice(0, 160) || null },
    // v284: sanitized journey preferences (return profile, city mode, property
    // types, sourcing, design theme, operating mode, wishlist add-ons).
    // Display/ops metadata only — pricing stays 100% computeBundle-driven.
    preferences: sanitizeJourneyPreferences(body?.preferences),
    razorpay_order_id: rzp.id,
  };

  let configId: string | null = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/host_portfolio_configs`, {
      method: "POST",
      headers: { ...SB_H, Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: "Could not save configuration", detail: t.slice(0, 200) }, { status: 502 });
    }
    const [saved] = await r.json();
    configId = saved?.id || null;
  } catch (e: any) {
    return NextResponse.json({ error: "Save failed.", detail: String(e?.message || e).slice(0, 160) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    configId,
    razorpayOrderId: rzp.id,
    amount: chargeable,
    keyId: PUBLIC_KEY_ID,
    payOption,
    holdAmount: payOption === "hold" ? holdAmount : 0,
    balanceDue,
    breakdown: bundle,
  });
}
