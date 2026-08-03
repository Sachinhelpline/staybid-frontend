"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — Help & support  (v294.20, Phase 6)
//
// Circle's OWN help screen — a premium-cozy FAQ + contact surface, SEPARATE
// from the customer / hotel-partner support flows. The dashboard row used to
// deep-link straight into WhatsApp; it now lands here with Circle-specific
// answers first, and WhatsApp / email as one tap away. Self-contained — no
// backend, no new API.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, Mail, Wallet, CheckCircle2, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CIRCLE_INCOME_DISCLOSURE } from "@/lib/circle/disclosure";

const WA = "https://wa.me/918881555188?text=";
const wa = (msg: string) => `${WA}${encodeURIComponent(msg)}`;

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do StayCircle earnings work?",
    a: <>You lock a property (or a bundle of rooms), and StayCircle runs it for you. Your share of the monthly revenue is paid out as a <b>payout</b> — you can track every one under <b>Earnings &amp; payouts</b>. Returns shown are indicative projections based on property performance bands, not guaranteed.</>,
  },
  {
    q: "When and how do I get paid?",
    a: <>Payouts are credited on a monthly cycle. Each appears in <b>Earnings &amp; payouts</b> with its month, amount and status (Paid / Pending). To receive them, complete your <b>KYC &amp; verification</b> so we have a verified bank account on file.</>,
  },
  {
    q: "Why do I need to complete KYC?",
    a: <>KYC is your StayCircle <b>investor identity + payout verification</b> — it lets us pay you securely to a verified bank account. It is completely separate from any hotel video verification. Finish it once under <b>KYC &amp; verification</b>.</>,
  },
  {
    q: "How do I lock a property or build a bundle?",
    a: <>Browse properties in <b>Discover</b>, then use <b>Build Bundle</b> to pick your rooms and commit. Your locked properties and committed monthly amount show up on your <b>Dashboard</b> and <b>Portfolio</b>.</>,
  },
  {
    q: "Is my money / commitment safe?",
    a: <>Every property is verified and legal, pricing is transparent with no hidden charges, and payments run through secure Razorpay. If anything looks off, reach out below and our team will help right away.</>,
  },
  {
    q: "How is this different from the Hotel Partner panel?",
    a: <>StayCircle is for <b>investing</b> in and earning from hospitality — separate from running your own hotel. The Hotel Partner and For Hosts panels stay locked here unless you're actually a partner/host; your Circle earnings, KYC and support are all Circle-own.</>,
  },
];

export default function CircleSupportPage() {
  const { user } = useAuth();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="sbc-dash">
      <header className="sbc-dash-head">
        <Link href="/circle/dashboard" className="sbc-dash-back" aria-label="Back">←</Link>
        <span className="sbc-dash-title">Help &amp; support</span>
        <span style={{ width: 34 }} />
      </header>

      <section className="sbc-help-intro">
        <b>We're here to help{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</b>
        <span>Quick answers below — or reach our StayCircle team directly. Most queries get a reply within a few hours.</span>
      </section>

      {/* contact cards */}
      <div className="sbc-help-contacts">
        <a className="sbc-help-contact" href={wa("Hi StayCircle, I need help with my investment.")} target="_blank" rel="noopener noreferrer">
          <span className="sbc-help-contact-ic"><MessageCircle size={18} aria-hidden /></span>
          <b>WhatsApp us</b>
          <span>Fastest — chat with the team</span>
        </a>
        <a className="sbc-help-contact" href="mailto:support@staybid.in?subject=StayCircle%20support">
          <span className="sbc-help-contact-ic"><Mail size={18} aria-hidden /></span>
          <b>Email us</b>
          <span>support@staybid.in</span>
        </a>
      </div>

      {/* FAQ */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Frequently asked</div>
        <div className="sbc-faq">
          {FAQS.map((f, i) => (
            <div key={i} className={`sbc-faq-item${open === i ? " open" : ""}`}>
              <button type="button" className="sbc-faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {f.q}<em>+</em>
              </button>
              {open === i && <div className="sbc-faq-a">{f.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* quick links to the other Circle-own surfaces */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Manage your account</div>
        <div className="sbc-dash-links">
          <Link href="/circle/earnings" className="sbc-dash-link"><span><Wallet size={15} aria-hidden /></span>Earnings &amp; payouts<em>›</em></Link>
          <Link href="/circle/kyc" className="sbc-dash-link"><span><CheckCircle2 size={15} aria-hidden /></span>KYC &amp; verification<em>›</em></Link>
          <Link href="/circle/profile" className="sbc-dash-link"><span><Settings size={15} aria-hidden /></span>Profile &amp; settings<em>›</em></Link>
        </div>
      </section>

      <p className="sbc-set-foot" style={{ textAlign: "center" }}>
        {CIRCLE_INCOME_DISCLOSURE}
      </p>

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
