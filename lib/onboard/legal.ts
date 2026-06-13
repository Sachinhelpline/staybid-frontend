// ============================================================================
// StayBid Host Agreement — versioned legal engine (v2.0, 2026-06)
//
// Bump CURRENT_VERSION when terms change so hosts must re-accept. The full
// text (with the negotiated commission baked in) is SHA-256 hashed and stored
// with each acceptance, alongside IP + user-agent + typed signature name —
// a valid click-wrap e-contract under §10A, Information Technology Act 2000.
//
// Commission is FLEXIBLE: 5–15%, agreed per hotel at signing time
// (COMMISSION_MIN..COMMISSION_MAX, default COMMISSION_DEFAULT). The agreed
// percent is stored on hotels.commission_percent + host_agreements row.
// ============================================================================
import crypto from "crypto";

export const CURRENT_VERSION = "v2.0-2026-06";

export const COMMISSION_MIN = 5;
export const COMMISSION_MAX = 15;
export const COMMISSION_DEFAULT = 12;

export function clampCommission(pct: unknown): number {
  const n = Number(pct);
  if (!Number.isFinite(n)) return COMMISSION_DEFAULT;
  return Math.min(COMMISSION_MAX, Math.max(COMMISSION_MIN, Math.round(n * 2) / 2));
}

// ----------------------------------------------------------------------------
// Granular consents — every key becomes a row in onboarding_consents.
// Order matters: rendered top-to-bottom in the Express flow.
// ----------------------------------------------------------------------------
export type ConsentKey =
  | "consent_listing"
  | "consent_data_sourcing"
  | "consent_ota_rates"
  | "consent_price_compare"
  | "consent_image_rights"
  | "consent_dpdp_privacy"
  | "consent_commission"
  | "consent_legal";

export const CONSENT_ITEMS: { key: ConsentKey; label: string; detail: string; required: boolean }[] = [
  {
    key: "consent_listing",
    label: "Authority to list",
    detail: "I confirm I am the owner / authorised signatory of this property and have full authority to list it on StayBid.",
    required: true,
  },
  {
    key: "consent_data_sourcing",
    label: "Public data sourcing (AI auto-fill)",
    detail: "I authorise StayBid to collect, store and use my property's publicly available digital footprint (Google, search engines, the property's own website and public directories) — including name, address, photos, amenities, descriptions, ratings and reviews — to build and keep my listing up to date.",
    required: true,
  },
  {
    key: "consent_ota_rates",
    label: "OTA rate intelligence",
    detail: "I authorise StayBid to fetch and monitor my property's publicly listed room rates on other online travel agencies (MakeMyTrip, Booking.com, Goibibo, Agoda etc.) to power dynamic pricing, parity checks and price comparison.",
    required: true,
  },
  {
    key: "consent_price_compare",
    label: "Price comparison display",
    detail: "I permit StayBid to display my rates alongside competitor OTA rates on customer-facing surfaces for transparent price comparison.",
    required: true,
  },
  {
    key: "consent_image_rights",
    label: "Image & content licence",
    detail: "I confirm I hold rights to all images/content uploaded or sourced for my listing, and grant StayBid a non-exclusive, royalty-free licence to display, resize and promote them across StayBid surfaces and marketing.",
    required: true,
  },
  {
    key: "consent_dpdp_privacy",
    label: "Personal data processing (DPDP Act 2023)",
    detail: "I consent to StayBid processing my personal data (identity, KYC documents, contact and bank details) for onboarding, verification, payouts, tax compliance and fraud prevention, in accordance with the Digital Personal Data Protection Act, 2023 and StayBid's Privacy Policy. I may withdraw consent by writing to the Grievance Officer; withdrawal de-lists the property.",
    required: true,
  },
  {
    key: "consent_commission",
    label: "Commission & settlement terms",
    detail: "I accept the agreed commission rate (as recorded in this agreement), the commission rules and the settlement schedule described in the Host Agreement.",
    required: true,
  },
  {
    key: "consent_legal",
    label: "Full agreement acceptance",
    detail: "I have read and accept the StayBid Host Agreement in full, including liability, indemnity, cancellation, dispute resolution and termination clauses, and intend my electronic acceptance to be legally binding under the Information Technology Act, 2000.",
    required: true,
  },
];

export const REQUIRED_CONSENT_KEYS: ConsentKey[] = CONSENT_ITEMS.filter((c) => c.required).map((c) => c.key);

// ----------------------------------------------------------------------------
// Clauses
// ----------------------------------------------------------------------------
export const COMMISSION_RULES = `
COMMISSION RULES & CONDITIONS (flexible 5%–15%):
• The commission rate for this property is agreed at signing time within the
  band of ${COMMISSION_MIN}% (minimum) to ${COMMISSION_MAX}% (maximum) of the gross booking value
  (excluding GST collected from the guest) of every confirmed booking
  originated through StayBid — including reverse-auction bids, instant
  bookings and flash deals.
• The agreed rate is recorded in this agreement and on the property's account;
  it applies uniformly to all booking types unless a separate written addendum
  states otherwise.
• Rate review: StayBid may propose a revised rate (within the 5–15% band) with
  30 days' written notice. The host may accept, renegotiate, or terminate
  without penalty before the revision takes effect. Continued use of the
  platform after the effective date constitutes acceptance.
• Promotional reductions: StayBid may unilaterally REDUCE the effective
  commission for promotional periods; it may never increase it beyond the
  agreed rate without the notice process above.
• Commission is exclusive of GST; GST on StayBid's commission invoice is
  charged additionally as per law. StayBid issues a monthly tax invoice for
  commission deducted.
• Commission is automatically deducted before payout. No commission is charged
  on bookings cancelled with a full refund to the guest.
`.trim();

export const SETTLEMENT_CLAUSE = `
PAYMENTS & SETTLEMENT:
• Guest payments are collected by StayBid through its PCI-DSS compliant payment
  gateway (Razorpay).
• Net payout = gross booking value − agreed commission − applicable TCS/TDS.
• As an e-commerce operator, StayBid collects TCS under Section 52 of the CGST
  Act, 2017 and deducts TDS under Section 194-O of the Income-tax Act, 1961,
  where applicable, and deposits these against the host's GSTIN/PAN.
• Payouts are made to the verified bank account on file on a weekly cycle
  (T+7 from guest check-in), subject to completed KYC and bank verification.
• The host is solely responsible for its own GST registration (where turnover
  thresholds apply), invoicing the guest for the stay, and all direct/indirect
  taxes on its share of revenue.
`.trim();

export const CANCELLATION_POLICY = `
STANDARD STAYBID CANCELLATION POLICY:
• Free cancellation up to 24 hours before check-in.
• 50% charge if cancelled within 24 hours of check-in.
• 100% charge for no-shows.
• Hotel may set stricter policies for peak/festive dates with prior notice
  visible to the guest at booking time.
• If the HOTEL cancels a confirmed booking, StayBid may relocate the guest at
  the hotel's cost and apply a service-level penalty.
`.trim();

export const COMPLIANCE_CLAUSE = `
HOST DECLARATIONS & STATUTORY COMPLIANCE:
The host declares and warrants that the property holds and will maintain all
registrations, licences and permissions required to operate lawfully,
including (as applicable):
• Trade licence / Shops & Establishments registration from the local authority.
• FSSAI licence where food & beverage is served.
• Fire safety NOC and structural safety compliance.
• Local police / tourism department registration where mandated, and
  Form-C reporting for foreign guests under the Foreigners Act/Registration
  of Foreigners Rules.
• GST registration where statutory thresholds apply.
• Compliance with the Sexual Harassment of Women at Workplace Act, 2013 and
  applicable labour laws for its staff.
StayBid may request copies of any of the above at any time and may suspend the
listing pending production.
`.trim();

export const DATA_CLAUSE = `
DATA, PRIVACY & PLATFORM INTELLIGENCE:
• The host authorises StayBid to source, store and refresh the property's
  publicly available digital footprint (search engines, the property's own
  website, public OTA listings) for listing creation and upkeep ("Data
  Sourcing Consent").
• The host authorises StayBid to monitor the property's publicly listed rates
  on other platforms for dynamic pricing and price-comparison display ("Rate
  Intelligence Consent").
• Personal data of the host and its staff is processed per the Digital
  Personal Data Protection Act, 2023; guest personal data shared with the
  hotel for a booking may be used ONLY to service that booking and must be
  deleted when no longer required.
• KYC documents and bank details are stored encrypted; bank account numbers
  are AES-256 encrypted at rest and never displayed in full.
• Either party shall notify the other within 72 hours of becoming aware of a
  data breach affecting shared data.
`.trim();

export const LIABILITY_CLAUSE = `
LIABILITY & INDEMNITY:
StayBid acts as a marketplace/intermediary (an "e-commerce entity" under the
Consumer Protection (E-Commerce) Rules, 2020) connecting guests and hotels.
The hotel is solely responsible for:
• Quality of stay, hygiene, safety and licensed operation of the property.
• Honouring confirmed bookings and bid acceptances at the agreed rate.
• Conduct of its staff and the accuracy of listing information it confirms.
• Tax compliance (GST, luxury tax, local levies) on its share of revenue.
StayBid is not liable for property damage, guest injury, or local-law disputes
arising from the stay. The hotel agrees to indemnify and hold harmless StayBid
against claims, losses and penalties that arise from the hotel's acts or
omissions, including misdeclared amenities, licence lapses or guest harm.
StayBid's aggregate liability under this agreement is capped at the commission
earned from the hotel in the 3 months preceding the claim.
`.trim();

export const TERMINATION_CLAUSE = `
TERM, SUSPENSION & TERMINATION:
• This agreement is effective from e-signature and continues until terminated.
• Either party may terminate with 15 days' written notice; confirmed bookings
  existing at termination must be honoured or mutually migrated.
• StayBid may suspend or de-list immediately for: fraud, safety incidents,
  repeated booking denials, licence lapses, chargeback abuse, attempts to take
  platform-originated guests off-platform, or breach of this agreement.
• On termination, accrued payouts (less dues) are settled in the next cycle;
  clauses on liability, indemnity, data and disputes survive termination.
`.trim();

export const DISPUTE_CLAUSE = `
DISPUTE RESOLUTION & GOVERNING LAW:
• All disputes shall first be attempted to be resolved through StayBid's
  mediation desk within 14 days of being raised in writing.
• Failing mediation, disputes are referred to binding arbitration by a sole
  arbitrator seated in New Delhi, India, conducted in English under the
  Arbitration and Conciliation Act, 1996 (as amended).
• Subject to the above, courts at New Delhi have exclusive jurisdiction.
• This agreement is governed by the laws of the Republic of India.
• Grievance Officer (IT Rules, 2021 / DPDP Act): grievance@staybids.in —
  acknowledgement within 48 hours, resolution within 15 days.
`.trim();

export const ESIGN_CLAUSE = `
ELECTRONIC EXECUTION:
This agreement is executed electronically. The host's typed full legal name,
checkbox consents, authenticated session (OTP-verified account), IP address,
device user-agent and timestamp are recorded together with a SHA-256 hash of
this exact text, and constitute a valid and enforceable electronic contract
under Section 10A of the Information Technology Act, 2000. A copy is available
to the host on request and within the partner dashboard.
`.trim();

// ----------------------------------------------------------------------------
// Full agreement text — commission % baked in, then hashed at signing time.
// ----------------------------------------------------------------------------
export function fullAgreementText(commissionPct: number = COMMISSION_DEFAULT): string {
  const pct = clampCommission(commissionPct);
  return [
    `STAYBID HOST AGREEMENT — ${CURRENT_VERSION}`,
    "",
    `Between: StayBid ("the Platform") and the property owner / authorised`,
    `signatory identified by the verified account executing this agreement`,
    `("the Host"), for the property identified in the onboarding record.`,
    "",
    `1. COMMISSION — AGREED RATE: ${pct}%`,
    `StayBid charges a commission of ${pct}% on the gross booking value`,
    `(net of taxes collected from the guest) of every confirmed booking`,
    `originated through the platform. Commission is automatically deducted`,
    `before payout.`,
    "",
    COMMISSION_RULES,
    "",
    `2. PAYMENTS & SETTLEMENT`,
    SETTLEMENT_CLAUSE,
    "",
    `3. CANCELLATION POLICY`,
    CANCELLATION_POLICY,
    "",
    `4. STATUTORY COMPLIANCE`,
    COMPLIANCE_CLAUSE,
    "",
    `5. DATA, PRIVACY & PLATFORM INTELLIGENCE`,
    DATA_CLAUSE,
    "",
    `6. LIABILITY & INDEMNITY`,
    LIABILITY_CLAUSE,
    "",
    `7. TERM & TERMINATION`,
    TERMINATION_CLAUSE,
    "",
    `8. DISPUTE HANDLING & GOVERNING LAW`,
    DISPUTE_CLAUSE,
    "",
    `9. ELECTRONIC EXECUTION`,
    ESIGN_CLAUSE,
    "",
    `10. CONSENTS`,
    `By signing this agreement the host grants each of the following consents,`,
    `each recorded individually in StayBid's consent ledger:`,
    ...CONSENT_ITEMS.map((c) => `• ${c.label}: ${c.detail}`),
  ].join("\n");
}

export function hashAgreement(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Legacy export kept so any existing import keeps compiling (was fixed 12%).
export const COMMISSION_PERCENT = COMMISSION_DEFAULT;
