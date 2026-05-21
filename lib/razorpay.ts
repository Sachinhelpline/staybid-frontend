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
      theme: { color: "#c9911a" },
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
    const orderRes = await fetch("/api/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: opts.amount,
        receipt: opts.receipt || `staybid_${Date.now()}`,
        notes: { hotel: opts.hotelName, ...(opts.notes || {}) },
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
      theme: { color: "#c9911a" },
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
