// v125.1 — self-healing order route.
//
// History
// -------
// v124.2 called the `razorpay` SDK. Its errors are plain
// `{ statusCode, error: { description } }` objects (not Error instances) so
// `err.message` was always undefined → user saw a generic "Order creation
// failed" alert with zero signal about the real cause.
//
// v125 switched to Razorpay's REST API directly. The first real error
// description ("Authentication failed") surfaced — revealing that the
// Vercel env vars `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` were set to a
// stale TEST-mode key pair whose secret had rotated. So even after fixing
// the SDK swallowing the error, real customers still couldn't pay because
// the env var pair was broken.
//
// v125.1 makes the route self-heal: it tries env-var keys first, and if
// Razorpay responds 401 / "Authentication failed" it automatically retries
// with the known-good hardcoded LIVE keys. Customer transaction succeeds
// either way; the env-var mismatch is surfaced in the response under
// v621: hardcoded fallback + self-heal REMOVED — credentials are now
// environment-only and the route fails closed when they are absent.

import { NextRequest, NextResponse } from "next/server";
import { userFromReq } from "@/lib/sb";
import { resolveFlashOrderCharge } from "@/lib/pricing/flash-charge";
import { resolveBidOrderCharge, resolveInstantOrderCharge, resolveBalanceCharge, resolveHoldDeposit } from "@/lib/pricing/order-charge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay credentials are ENVIRONMENT-ONLY (hotfix v621 security; v621.2
// consolidates onto the shared lib/razorpay-server helper). The previous
// hardcoded LIVE fallback + "self-heal to hardcoded on 401" retry has been
// removed — the route fails closed when the env pair is absent.
// Deployment prerequisite: set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (LIVE)
// in the server environment BEFORE deploying this change (see runbook).
import { razorpayKeyId, razorpayKeySecret, razorpayConfigured } from "@/lib/razorpay-server";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const amountRupees = Number(body?.amount);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return NextResponse.json(
      { error: "Amount must be a positive number (in INR rupees)" },
      { status: 400 },
    );
  }

  // Razorpay min ₹1 (100 paise), max ₹5,00,000 per order. Receipt ≤ 40 chars.
  const amountPaise = Math.round(amountRupees * 100);
  if (amountPaise < 100) {
    return NextResponse.json(
      { error: "Minimum order amount is ₹1" },
      { status: 400 },
    );
  }
  // v530 — FLASH money-in enforcement. This generic order route otherwise
  // trusts the client `amount` (the platform-wide hole). For a flash FULL-
  // payment order we re-compute the authoritative charge server-side
  // (spine ladder price × nights × rooms + server-priced extras − server-
  // VALIDATED coupon/wallet discount) and reject a materially-lower amount.
  // This closes the "pay ₹1 for a confirmed flash booking" exploit. The
  // redemption is validated (ownership + balance), NOT debited — the existing
  // post-payment applyRedemption still does the real debit. Only fires for
  // flash FULL orders; hold / pay-at-hotel deposits (partial by design) and
  // every non-flash flow are byte-for-byte untouched. FAILS OPEN on any gap so
  // a legit booking is never blocked by a pricing hiccup. The 5% / ₹50 grace
  // absorbs spine/rounding drift between page load and checkout.
  const flash = body?.flash;
  if (flash && flash.dealId) {
    try {
      const u = userFromReq(req);
      const sc = await resolveFlashOrderCharge({
        userId: u?.id || null,
        roomId: String(flash.roomId || ""),
        checkInISO: String(flash.checkInISO || ""),
        nights: Number(flash.nights) || 1,
        rooms: Number(flash.rooms) || 1,
        adults: Number(flash.adults) || 1,
        children: Number(flash.children) || 0,
        couponCode: flash.couponCode || null,
        walletCreditInr: Number(flash.walletCreditInr) || 0,
      });
      if (sc && sc.charge > 0) {
        // full → the whole charge; hold/pay-at-hotel → the admin-configured
        // deposit tier for that total (v532b — deposit-minimum uses the same
        // rule set in the admin Hold Payment Config page).
        const expected = flash.mode === "full"
          ? sc.charge
          : await resolveHoldDeposit(sc.charge, sc.hotelId);
        if (expected > 0 && amountRupees < expected - Math.max(50, expected * 0.05)) {
          return NextResponse.json(
            { error: "This flash price is no longer available. Please refresh the deal and try again.", expected },
            { status: 400 },
          );
        }
      }
    } catch { /* fail open — never block a legit booking on a pricing error */ }
  }

  // v531 — extend the flash money-in enforcement to the other customer flows.
  // Same discipline throughout: server re-derives the authoritative charge,
  // rejects a materially-low FULL-payment amount (5% / ₹50 grace), reads an
  // optional Bearer to validate the redemption, and FAILS OPEN on any gap.
  // Hold / pay-at-hotel deposits (partial by design) and every non-customer
  // flow stay untouched. Two contexts:
  //   • body.bid     — pay / accept an EXISTING bid (amount already in the row)
  //   • body.instant — fresh Book Now / Upgrade / Negotiate (floor re-derived)
  const bidCtx = body?.bid;
  if (bidCtx && bidCtx.bidId) {
    try {
      const u = userFromReq(req);
      const sc = await resolveBidOrderCharge({
        bidId: String(bidCtx.bidId),
        userId: u?.id || null,
        couponCode: bidCtx.couponCode || null,
        walletCreditInr: Number(bidCtx.walletCreditInr) || 0,
      });
      if (sc && sc.charge > 0) {
        const expected = bidCtx.mode === "full"
          ? sc.charge
          : await resolveHoldDeposit(sc.charge, sc.hotelId);
        if (expected > 0 && amountRupees < expected - Math.max(50, expected * 0.05)) {
          return NextResponse.json(
            { error: "This price is no longer available. Please refresh and try again.", expected },
            { status: 400 },
          );
        }
      }
    } catch { /* fail open */ }
  }

  const instantCtx = body?.instant;
  if (instantCtx && instantCtx.roomId) {
    try {
      const u = userFromReq(req);
      const sc = await resolveInstantOrderCharge({
        userId: u?.id || null,
        roomId: String(instantCtx.roomId),
        nights: Number(instantCtx.nights) || 1,
        rooms: Number(instantCtx.rooms) || 1,
        couponCode: instantCtx.couponCode || null,
        walletCreditInr: Number(instantCtx.walletCreditInr) || 0,
      });
      // minCharge is a FLOOR (Book Now ≈ it, Negotiate/Upgrade ≥ it); for a
      // hold/pay-at-hotel it becomes the admin deposit tier on that floor.
      if (sc && sc.minCharge > 0) {
        const expected = instantCtx.mode === "full"
          ? sc.minCharge
          : await resolveHoldDeposit(sc.minCharge, sc.hotelId);
        if (expected > 0 && amountRupees < expected - Math.max(50, expected * 0.05)) {
          return NextResponse.json(
            { error: "This price is no longer available. Please refresh and try again.", expected },
            { status: 400 },
          );
        }
      }
    } catch { /* fail open */ }
  }

  // v532 — settle the remaining BALANCE of a held bid. The balance is
  // otherwise read from client localStorage (a ₹1 balance would "complete" a
  // full booking for deposit + ₹1). Server re-derives it: authoritative room
  // base − the redemption ACTUALLY applied to the bid − the server-computed
  // deposit, and rejects a materially-low amount. No mode gate (a balance is
  // always a full settlement). FAILS OPEN on any gap.
  const balanceCtx = body?.balance;
  if (balanceCtx && balanceCtx.bidId) {
    try {
      const sc = await resolveBalanceCharge({ bidId: String(balanceCtx.bidId) });
      if (sc && sc.balance > 0) {
        const minAllowed = sc.balance - Math.max(50, sc.balance * 0.05);
        if (amountRupees < minAllowed) {
          return NextResponse.json(
            { error: "This balance is no longer valid. Please reopen the booking and try again.", expected: sc.balance },
            { status: 400 },
          );
        }
      }
    } catch { /* fail open */ }
  }

  const rawReceipt = String(body?.receipt || `rcpt_${Date.now()}`);
  const receipt = rawReceipt.slice(0, 40);
  const notes =
    body?.notes && typeof body.notes === "object" && !Array.isArray(body.notes)
      ? body.notes
      : {};

  // Fail closed when the Razorpay secret is not configured — never fall back
  // to a hardcoded credential.
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "payment_config_missing" }, { status: 503 });
  }

  const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString("base64");
  try {
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes,
        payment_capture: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = await rzpRes.json().catch(() => ({}));
    if (rzpRes.ok) {
      return NextResponse.json(data);
    }

    const description =
      data?.error?.description ||
      data?.error?.reason ||
      data?.description ||
      `Razorpay returned ${rzpRes.status}`;
    console.error("[razorpay/order] upstream error", { status: rzpRes.status, body: data });
    return NextResponse.json(
      { error: description, code: data?.error?.code || null, status: rzpRes.status },
      { status: rzpRes.status >= 400 && rzpRes.status < 500 ? 400 : 502 },
    );
  } catch (err: any) {
    const isAbort = err?.name === "AbortError" || err?.name === "TimeoutError";
    const description = isAbort
      ? "Razorpay took too long to respond. Please try again."
      : err?.message || "Could not reach Razorpay. Check your internet and retry.";
    console.error("[razorpay/order] network error", err);
    return NextResponse.json({ error: description, status: 502 }, { status: 502 });
  }
}

// Health probe — lets the diagnostic endpoint confirm the route is live
// without spending a real Razorpay order. Reports which key candidates
// will be tried (in order) so a stale env-var override is visible.
export async function GET() {
  return NextResponse.json({ ok: true, configured: razorpayConfigured() });
}
