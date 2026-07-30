// v125 — Razorpay client helper, hardened.
// - Real error from /api/razorpay/order (description + code) bubbles up so
//   the user sees "Account inactive" / "Amount too low" / etc. — never the
//   generic "Order creation failed" again.
// - Script loader retries once on transient network blips.
// - Cancellation flows through as a typed __CANCELLED__ error the caller
//   can recognise (existing convention preserved).
// - Verification failure includes the server-supplied reason.

export interface RazorpayPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface OpenCheckoutOptions {
  amount: number; // in INR (rupees, not paise)
  hotelName: string;
  description?: string;
  userName?: string;
  userPhone?: string;
  userEmail?: string;
  // v125 — optional metadata so admin/cron can debug a stuck order later.
  notes?: Record<string, string>;
  receipt?: string;
  // v530 — flash FULL-payment context so the server can re-compute the
  // authoritative charge (tamper-safe money-in). Sent in the order body (NOT
  // as Razorpay notes). When present, the order fetch also carries the
  // customer Bearer so the server can validate any coupon/wallet discount.
  flash?: {
    dealId: string;
    roomId: string;
    checkInISO: string;
    nights: number;
    rooms: number;
    adults: number;
    children: number;
    mode: "full" | "hold" | "payhotel";
    couponCode?: string;
    walletCreditInr?: number;
  };
  // v531 — pay/accept an EXISTING bid; server re-derives the charge from the bid row.
  bid?: {
    bidId: string;
    mode: "full" | "hold" | "payhotel";
    couponCode?: string;
    walletCreditInr?: number;
  };
  // v531 — fresh Book Now / Upgrade / Negotiate; server enforces a floor-derived minimum.
  instant?: {
    roomId: string;
    nights: number;
    rooms: number;
    mode: "full" | "hold" | "payhotel";
    couponCode?: string;
    walletCreditInr?: number;
  };
  // v532 — settle a held bid's remaining balance; server re-derives it from the bid.
  balance?: {
    bidId: string;
  };
}

export class RazorpayError extends Error {
  code: string | null;
  status: number | null;
  constructor(message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = "RazorpayError";
    this.code = code;
    this.status = status;
  }
}

// v178 — open the Razorpay modal for an order that was ALREADY created
// server-side (with a server-validated amount). The caller verifies the
// payment through its own endpoint — this helper does NOT hit
// /api/razorpay/verify. Used by the partner service-subscription checkout
// so the amount can never be tampered client-side.
export interface OpenForOrderOptions {
  orderId: string;
  amountPaise: number;
  keyId: string;
  description?: string;
  userName?: string;
  userPhone?: string;
  userEmail?: string;
  // v285 — optional Razorpay Checkout `method` map (e.g. { emi:true, paylater:true,
  // card:true }) to emphasise EMI / BNPL. Providers actually shown (Home Credit,
  // Snapmint, Bajaj Finserv, Mobikwik, card/cardless EMI) depend on the merchant
  // account's activated methods — this only asks Checkout to surface them.
  method?: Record<string, boolean>;
}

export async function openRazorpayForOrder(
  opts: OpenForOrderOptions,
): Promise<RazorpayPaymentResult> {
  const loaded = await loadScript();
  if (!loaded) {
    throw new RazorpayError(
      "Razorpay script load nahi hua. Internet check karein aur retry karein.",
    );
  }
  return new Promise<RazorpayPaymentResult>((resolve, reject) => {
    const RazorpayCtor = (window as any).Razorpay;
    if (!RazorpayCtor) {
      reject(new RazorpayError("Razorpay checkout SDK missing on window"));
      return;
    }
    const rzp = new RazorpayCtor({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amountPaise,
      currency: "INR",
      name: "StayBid",
      description: opts.description || "Subscription",
      image: "/favicon.ico",
      prefill: {
        name: opts.userName || "",
        contact: opts.userPhone ? opts.userPhone.replace(/\D/g, "") : "",
        email: opts.userEmail || "",
      },
      theme: { color: "#4f6d8a" },
      ...(opts.method ? { method: opts.method } : {}),
      handler: (response: RazorpayPaymentResult) => resolve(response),
      modal: {
        ondismiss: () => reject(new RazorpayError("__CANCELLED__")),
        escape: true,
        backdropclose: false,
      },
    });
    try {
      rzp.on?.("payment.failed", (resp: any) => {
        const desc = resp?.error?.description || resp?.error?.reason || "Payment failed.";
        reject(new RazorpayError(desc, resp?.error?.code || null));
      });
    } catch {
      // Older SDK builds may not expose .on — safe to ignore.
    }
    rzp.open();
  });
}

function loadScript(attempt = 0): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as any).Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      // One retry on transient blip (CDN hiccup / slow cellular).
      if (attempt < 1) {
        setTimeout(() => loadScript(attempt + 1).then(resolve), 600);
      } else {
        resolve(false);
      }
    };
    document.head.appendChild(script);
  });
}

export async function openRazorpayCheckout(
  opts: OpenCheckoutOptions,
): Promise<RazorpayPaymentResult> {
  const loaded = await loadScript();
  if (!loaded) {
    throw new RazorpayError(
      "Razorpay script load nahi hua. Internet check karein aur retry karein.",
    );
  }

  // Create the order server-side
  let order: any;
  try {
    // v530/v531 — for a server-enforced order (flash / bid / instant), carry the
    // Bearer so the server can validate the customer's coupon/wallet discount
    // when re-computing the charge.
    const orderHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const needsAuth = !!(opts.flash || opts.bid || opts.instant || opts.balance);
    if (needsAuth && typeof window !== "undefined") {
      const tok = localStorage.getItem("sb_token");
      if (tok) orderHeaders.Authorization = `Bearer ${tok}`;
    }
    const orderRes = await fetch("/api/razorpay/order", {
      method: "POST",
      headers: orderHeaders,
      body: JSON.stringify({
        amount: opts.amount,
        receipt: opts.receipt || `staybid_${Date.now()}`,
        notes: { hotel: opts.hotelName, ...(opts.notes || {}) },
        ...(opts.flash ? { flash: opts.flash } : {}),
        ...(opts.bid ? { bid: opts.bid } : {}),
        ...(opts.instant ? { instant: opts.instant } : {}),
        ...(opts.balance ? { balance: opts.balance } : {}),
      }),
    });
    order = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok || !order?.id) {
      throw new RazorpayError(
        order?.error || "Payment order create nahi hua",
        order?.code || null,
        orderRes.status,
      );
    }
  } catch (err: any) {
    if (err instanceof RazorpayError) throw err;
    throw new RazorpayError(
      err?.message || "Network error while creating order. Try again.",
    );
  }

  return new Promise<RazorpayPaymentResult>((resolve, reject) => {
    const RazorpayCtor = (window as any).Razorpay;
    if (!RazorpayCtor) {
      reject(new RazorpayError("Razorpay checkout SDK missing on window"));
      return;
    }
    const rzp = new RazorpayCtor({
      key:
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_live_SfFAsbYjbHfztd",
      order_id: order.id,
      amount: order.amount,
      currency: "INR",
      name: "StayBid",
      description: opts.description || `Booking at ${opts.hotelName}`,
      image: "/favicon.ico",
      prefill: {
        name: opts.userName || "",
        contact: opts.userPhone ? opts.userPhone.replace(/\D/g, "") : "",
        email: opts.userEmail || "",
      },
      theme: { color: "#4f6d8a" },
      handler: async (response: RazorpayPaymentResult) => {
        try {
          const verifyRes = await fetch("/api/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          });
          const data = await verifyRes.json().catch(() => ({}));
          if (data?.verified) {
            resolve(response);
          } else {
            reject(
              new RazorpayError(
                data?.error
                  ? `Payment verification failed: ${data.error}`
                  : "Payment verification failed. Please contact support.",
              ),
            );
          }
        } catch (err: any) {
          reject(
            new RazorpayError(
              err?.message ||
                "Payment verification network error. Contact support.",
            ),
          );
        }
      },
      modal: {
        ondismiss: () => reject(new RazorpayError("__CANCELLED__")),
        escape: true,
        backdropclose: false,
      },
    });

    try {
      rzp.on?.("payment.failed", (resp: any) => {
        const desc = resp?.error?.description || resp?.error?.reason || "Payment failed.";
        reject(new RazorpayError(desc, resp?.error?.code || null));
      });
    } catch {
      // Older SDK builds may not expose .on — safe to ignore.
    }

    rzp.open();
  });
}
