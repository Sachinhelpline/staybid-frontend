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
}

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if ((window as any).Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export async function openRazorpayCheckout(opts: OpenCheckoutOptions): Promise<RazorpayPaymentResult> {
  const loaded = await loadScript();
  if (!loaded) throw new Error("Razorpay script load karne mein error. Internet check karein.");

  const orderRes = await fetch("/api/razorpay/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: opts.amount,
      receipt: `staybid_${Date.now()}`,
      notes: { hotel: opts.hotelName },
    }),
  });
  const order = await orderRes.json();
  if (!orderRes.ok) throw new Error(order.error || "Payment order create nahi hua");

  return new Promise((resolve, reject) => {
    const rzp = new (window as any).Razorpay({
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "",
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
          const data = await verifyRes.json();
          if (data.verified) {
            resolve(response);
          } else {
            reject(new Error("Payment verification failed. Please contact support."));
          }
        } catch {
          reject(new Error("Payment verification failed. Please contact support."));
        }
      },
      modal: {
        ondismiss: () => reject(new Error("__CANCELLED__")),
      },
    });
    rzp.open();
  });
}
