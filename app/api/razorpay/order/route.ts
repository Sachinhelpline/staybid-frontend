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
// Vercel env vars `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are set to a
// stale TEST-mode value (`rzp_test_pla...`) whose secret has rotated. So
// even after fixing the SDK swallowing the error, real customers still
// couldn't pay because the env var pair is broken.
//
// v125.1 makes the route self-heal: it tries env-var keys first, and if
// Razorpay responds 401 / "Authentication failed" it automatically retries
// with the known-good hardcoded LIVE keys. Customer transaction succeeds
// either way; the env-var mismatch is surfaced in the response under
// `_keysSource` for the diagnostic endpoint. This is the bulletproof
// pattern documented in CLAUDE.md ("keys hardcoded as fallback so payment
// works even without Vercel env vars").

import { NextRequest, NextResponse } from "next/server";
import { userFromReq } from "@/lib/sb";
import { resolveFlashOrderCharge } from "@/lib/pricing/flash-charge";
import { resolveBidOrderCharge, resolveInstantOrderCharge } from "@/lib/pricing/order-charge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Known-good LIVE production credentials (per CLAUDE.md). These are the
// canonical source of truth — env vars are an OPTIONAL override.
const LIVE_KEY_ID     = "rzp_live_SfFAsbYjbHfztd";
const LIVE_KEY_SECRET = "dv3xFGG44R2FSqlshkDVY2Gn";

const ENV_KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const ENV_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

// Build the candidate key list:
// 1. If env vars are set AND start with `rzp_live_`, try them first.
//    A `rzp_test_*` env var on production is almost always a misconfig,
//    so we skip it entirely.
// 2. Always fall back to the hardcoded LIVE pair.
type KeyPair = { id: string; secret: string; source: "env" | "hardcoded" };
function buildKeyCandidates(): KeyPair[] {
  const out: KeyPair[] = [];
  if (ENV_KEY_ID && ENV_KEY_SECRET && ENV_KEY_ID.startsWith("rzp_live_")) {
    out.push({ id: ENV_KEY_ID, secret: ENV_KEY_SECRET, source: "env" });
  }
  // Always include hardcoded as the safety net.
  if (!out.length || out[0].id !== LIVE_KEY_ID) {
    out.push({ id: LIVE_KEY_ID, secret: LIVE_KEY_SECRET, source: "hardcoded" });
  }
  return out;
}

const RZP_KEY_ID = ENV_KEY_ID.startsWith("rzp_live_")
  ? ENV_KEY_ID
  : LIVE_KEY_ID;
const RZP_KEY_SECRET = ENV_KEY_ID.startsWith("rzp_live_")
  ? ENV_KEY_SECRET
  : LIVE_KEY_SECRET;

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
  if (flash && flash.dealId && flash.mode === "full") {
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
        const minAllowed = sc.charge - Math.max(50, sc.charge * 0.05);
        if (amountRupees < minAllowed) {
          return NextResponse.json(
            {
              error: "This flash price is no longer available. Please refresh the deal and try again.",
              expected: sc.charge,
            },
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
  if (bidCtx && bidCtx.bidId && bidCtx.mode === "full") {
    try {
      const u = userFromReq(req);
      const sc = await resolveBidOrderCharge({
        bidId: String(bidCtx.bidId),
        userId: u?.id || null,
        couponCode: bidCtx.couponCode || null,
        walletCreditInr: Number(bidCtx.walletCreditInr) || 0,
      });
      if (sc && sc.charge > 0) {
        const minAllowed = sc.charge - Math.max(50, sc.charge * 0.05);
        if (amountRupees < minAllowed) {
          return NextResponse.json(
            { error: "This price is no longer available. Please refresh and try again.", expected: sc.charge },
            { status: 400 },
          );
        }
      }
    } catch { /* fail open */ }
  }

  const instantCtx = body?.instant;
  if (instantCtx && instantCtx.roomId && instantCtx.mode === "full") {
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
      // minCharge is a FLOOR (Book Now ≈ it, Negotiate/Upgrade ≥ it) — reject
      // only an amount that falls materially below that floor.
      if (sc && sc.minCharge > 0) {
        const minAllowed = sc.minCharge - Math.max(50, sc.minCharge * 0.05);
        if (amountRupees < minAllowed) {
          return NextResponse.json(
            { error: "This price is no longer available. Please refresh and try again.", expected: sc.minCharge },
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

  // v125.1 — try each keypair in order. The first one that doesn't return
  // 401 wins. On 401 ("Authentication failed") fall through to the next.
  // This makes the customer transaction immune to a misconfigured env var.
  const candidates = buildKeyCandidates();
  let lastDescription = "Order creation failed";
  let lastCode: string | null = null;
  let lastStatus = 500;
  let lastData: any = null;

  for (const cand of candidates) {
    const auth = Buffer.from(`${cand.id}:${cand.secret}`).toString("base64");
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
        // 20 s should be plenty — Razorpay typically responds in 200-600ms.
        // A hang past this means the network is wedged and we should fail
        // fast rather than letting the user stare at "Opening Razorpay…".
        signal: AbortSignal.timeout(20_000),
      });

      const data = await rzpRes.json().catch(() => ({}));

      if (rzpRes.ok) {
        // Success — annotate with which keypair worked so the diagnostic
        // endpoint can flag a stale env-var override without blocking
        // customers.
        if (cand.source === "hardcoded" && candidates.length > 1) {
          console.warn(
            "[razorpay/order] env-var keys failed auth; succeeded with hardcoded LIVE keys",
          );
        }
        return NextResponse.json({ ...data, _keysSource: cand.source });
      }

      // 401 / 403 → bad credentials, try next candidate. Anything else is
      // a hard upstream failure (bad amount, account suspended for a real
      // reason, Razorpay 5xx) and we propagate immediately.
      lastDescription =
        data?.error?.description ||
        data?.error?.reason ||
        data?.description ||
        `Razorpay returned ${rzpRes.status}`;
      lastCode = data?.error?.code || null;
      lastStatus = rzpRes.status;
      lastData = data;

      if (rzpRes.status === 401 || rzpRes.status === 403) {
        console.warn(
          `[razorpay/order] auth failed with source=${cand.source} keyId=${cand.id.slice(0, 12)}... — trying next candidate`,
        );
        continue;
      }

      // Non-auth error: stop, return verbatim.
      console.error("[razorpay/order] upstream error", {
        status: rzpRes.status,
        body: data,
        keySource: cand.source,
      });
      return NextResponse.json(
        {
          error: lastDescription,
          code: lastCode,
          status: rzpRes.status,
          _keysSource: cand.source,
        },
        { status: rzpRes.status >= 400 && rzpRes.status < 500 ? 400 : 502 },
      );
    } catch (err: any) {
      const isAbort = err?.name === "AbortError" || err?.name === "TimeoutError";
      lastDescription = isAbort
        ? "Razorpay took too long to respond. Please try again."
        : err?.message ||
          "Could not reach Razorpay. Check your internet and retry.";
      console.error("[razorpay/order] network error", err);
      lastStatus = 502;
      // Network blip with the env keypair? It's not credentials — don't
      // burn another attempt against the hardcoded pair on the same blip.
      break;
    }
  }

  return NextResponse.json(
    { error: lastDescription, code: lastCode, status: lastStatus, _data: lastData },
    { status: lastStatus >= 400 && lastStatus < 500 ? 400 : 502 },
  );
}

// Health probe — lets the diagnostic endpoint confirm the route is live
// without spending a real Razorpay order. Reports which key candidates
// will be tried (in order) so a stale env-var override is visible.
export async function GET() {
  const candidates = buildKeyCandidates();
  return NextResponse.json({
    ok: true,
    primaryKeyIdPrefix: RZP_KEY_ID.slice(0, 12),
    hasSecret: !!RZP_KEY_SECRET,
    envKeyIdPrefix: ENV_KEY_ID.slice(0, 12) || null,
    envIsLive: ENV_KEY_ID.startsWith("rzp_live_"),
    envIsTest: ENV_KEY_ID.startsWith("rzp_test_"),
    candidates: candidates.map((c) => ({
      source: c.source,
      keyIdPrefix: c.id.slice(0, 12),
    })),
  });
}
