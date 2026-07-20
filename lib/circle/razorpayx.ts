// v391 — RazorpayX payout client (Circle owner money-out).
//
// SERVER-ONLY. Reads creds from env; if any is missing the module reports
// NOT configured and every caller no-ops — so no payout can ever fire until the
// owner provisions RazorpayX and sets the env vars on Vercel:
//   RAZORPAYX_KEY_ID · RAZORPAYX_KEY_SECRET · RAZORPAYX_ACCOUNT_NUMBER
//
// Flow (per owner): ensure a contact + fund_account (bank/UPI) → create ONE
// payout for the owed total (IMPS). Idempotency is enforced two ways: the caller
// two-phase-claims the ledger rows, AND every payout carries an
// X-Payout-Idempotency key derived from the exact claimed row set, so a retry
// returns the SAME payout instead of sending twice.
//
// ⚠ Untested against live RazorpayX from this environment — verify one small
// payout in RazorpayX TEST mode before going live.

const RX_BASE = "https://api.razorpay.com/v1";

export function razorpayxConfig(): { keyId: string; keySecret: string; accountNumber: string } | null {
  const keyId = process.env.RAZORPAYX_KEY_ID || "";
  const keySecret = process.env.RAZORPAYX_KEY_SECRET || "";
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || "";
  if (!keyId || !keySecret || !accountNumber) return null;
  return { keyId, keySecret, accountNumber };
}
export const isRazorpayXConfigured = (): boolean => razorpayxConfig() !== null;

function authHeader(cfg: { keyId: string; keySecret: string }): string {
  return "Basic " + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
}

async function rxFetch(path: string, cfg: { keyId: string; keySecret: string }, init: RequestInit & { idempotencyKey?: string }): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: authHeader(cfg),
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) headers["X-Payout-Idempotency"] = init.idempotencyKey;
  const r = await fetch(`${RX_BASE}${path}`, { ...init, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.description || body?.error?.reason || `RazorpayX ${r.status}`;
    throw new Error(msg);
  }
  return body;
}

export type PayoutAccount = {
  method: string;               // 'bank' | 'upi'
  account_holder?: string | null;
  account_number?: string | null;
  ifsc?: string | null;
  upi_id?: string | null;
};

// Ensure a RazorpayX fund_account exists for this owner; returns its id + the
// contact id. Creates the contact + fund_account on first use.
export async function ensureFundAccount(
  acct: PayoutAccount,
  ownerRef: string,
  existingFundAccountId?: string | null,
): Promise<{ fundAccountId: string; contactId?: string; created: boolean }> {
  const cfg = razorpayxConfig();
  if (!cfg) throw new Error("RazorpayX not configured");
  if (existingFundAccountId) return { fundAccountId: existingFundAccountId, created: false };

  const name = (acct.account_holder || "Circle Owner").slice(0, 50);
  const contact = await rxFetch("/contacts", cfg, {
    method: "POST",
    body: JSON.stringify({ name, type: "vendor", reference_id: `circle_${ownerRef}`.slice(0, 40) }),
  });

  const faBody: any = { contact_id: contact.id };
  if (acct.method === "upi") {
    faBody.account_type = "vpa";
    faBody.vpa = { address: acct.upi_id };
  } else {
    faBody.account_type = "bank_account";
    faBody.bank_account = { name, ifsc: acct.ifsc, account_number: acct.account_number };
  }
  const fa = await rxFetch("/fund_accounts", cfg, { method: "POST", body: JSON.stringify(faBody) });
  return { fundAccountId: String(fa.id), contactId: String(contact.id), created: true };
}

// Create ONE IMPS payout for `amountPaise`. Idempotent on idempotencyKey.
export async function createPayout(params: {
  fundAccountId: string;
  amountPaise: number;
  idempotencyKey: string;
  referenceId: string;
  narration?: string;
}): Promise<{ id: string; status: string }> {
  const cfg = razorpayxConfig();
  if (!cfg) throw new Error("RazorpayX not configured");
  const mode = (process.env.RAZORPAYX_PAYOUT_MODE || "IMPS").toUpperCase();
  const payout = await rxFetch("/payouts", cfg, {
    method: "POST",
    idempotencyKey: params.idempotencyKey,
    body: JSON.stringify({
      account_number: cfg.accountNumber,
      fund_account_id: params.fundAccountId,
      amount: params.amountPaise,
      currency: "INR",
      mode,
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: params.referenceId.slice(0, 40),
      narration: (params.narration || "StayBid Circle payout").slice(0, 30),
    }),
  });
  return { id: String(payout.id), status: String(payout.status || "queued") };
}
