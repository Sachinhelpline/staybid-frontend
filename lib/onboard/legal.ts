// Versioned host agreement. Bump CURRENT_VERSION when terms change so users
// must re-accept. The full text is hashed and stored with each acceptance.
import crypto from "crypto";

export const CURRENT_VERSION = "v1.0-2026-04";
export const COMMISSION_PERCENT = 12;

export const CANCELLATION_POLICY = `
Standard StayBid cancellation policy:
• Free cancellation up to 24 hours before check-in.
• 50% charge if cancelled within 24 hours of check-in.
• 100% charge for no-shows.
• Hotel may set stricter policies for peak/festive dates with prior notice.
`.trim();

export const LIABILITY_CLAUSE = `
StayBid acts as a marketplace connecting guests and hotels. The hotel is solely
responsible for:
• Quality of stay, hygiene, safety and licensed operation.
• Honouring confirmed bookings and bid acceptances at the agreed rate.
• Tax compliance (GST, luxury tax, local levies) on its share of revenue.
StayBid is not liable for property damage, guest injury, or local-law disputes
arising from the stay. The hotel agrees to indemnify StayBid against claims
that arise from the hotel's acts or omissions.
`.trim();

export const DISPUTE_CLAUSE = `
• All disputes shall first be attempted to be resolved through StayBid's
  mediation desk within 14 days of being raised.
• Failing mediation, disputes are subject to binding arbitration in Delhi, India,
  conducted in English under the Arbitration and Conciliation Act, 1996.
• The agreement is governed by the laws of the Republic of India.
`.trim();

export function fullAgreementText(commissionPct = COMMISSION_PERCENT): string {
  return [
    `STAYBID HOST AGREEMENT — ${CURRENT_VERSION}`,
    "",
    `1. COMMISSION`,
    `StayBid charges a commission of ${commissionPct}% on the gross booking value`,
    `(net of taxes) of every confirmed booking originated through the platform.`,
    `Commission is automatically deducted before payout.`,
    "",
    `2. CANCELLATION POLICY`,
    CANCELLATION_POLICY,
    "",
    `3. LIABILITY`,
    LIABILITY_CLAUSE,
    "",
    `4. DISPUTE HANDLING`,
    DISPUTE_CLAUSE,
    "",
    `5. CONSENTS`,
    `By signing this agreement the host confirms that:`,
    `• They are authorised to list the property.`,
    `• They permit StayBid to display rates alongside competitor OTAs for price comparison.`,
    `• They have rights to all images uploaded and grant StayBid a non-exclusive licence to display them.`,
    `• They accept the terms of this agreement in full.`,
  ].join("\n");
}

export function hashAgreement(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
