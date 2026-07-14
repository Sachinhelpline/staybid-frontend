"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /circle/model4 — Investor Exchange shell (v339 · Phase M0).
//
// Model 4 = a B2B exchange: an investor lists pre-bought room-nights, another
// investor buys them; StayBid takes a fee. M0 ships the shared 3-step shell +
// an HONEST "N live listings" / "opening soon" state at Step 1. The real
// browse → buy flow is Phase M3.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import CircleStepShell from "@/components/circle/CircleStepShell";

export default function Model4Page() {
  const [live, setLive] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/circle/marketplace-summary")
      .then((r) => r.json())
      .then((j) => { if (alive) setLive(Number(j?.model4?.liveListings ?? 0)); })
      .catch(() => { if (alive) setLive(0); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const n = live ?? 0;

  return (
    <CircleStepShell
      model="Model 4"
      tag="Investor Exchange"
      title="Trade room-nights with other investors."
      subtitle="A members-only B2B exchange for pre-bought inventory — list what you own, or buy another investor's room-nights and resell them yourself."
      activeStep={1}
    >
      <div className="sbc-ms-empty">
        <div className="sbc-ms-empty-ic">⇄</div>
        {loading ? (
          <>
            <div className="sbc-ms-empty-h">Loading exchange…</div>
            <p className="sbc-ms-empty-p">Checking for live listings on the investor exchange.</p>
          </>
        ) : n > 0 ? (
          <>
            <div className="sbc-ms-empty-h">
              {n} live {n === 1 ? "listing" : "listings"} on the exchange
            </div>
            <p className="sbc-ms-empty-p">
              The full <b>browse &amp; buy</b> marketplace — see every investor listing, buy in one tap,
              and the block transfers to you — is launching next.
            </p>
          </>
        ) : (
          <>
            <div className="sbc-ms-empty-h">The exchange is opening soon</div>
            <p className="sbc-ms-empty-p">
              No live listings yet. Once investors start pre-buying inventory (Model 3), they can list
              it here for other members to buy. You&apos;ll be able to browse and buy in one tap.
            </p>
          </>
        )}

        <Link href="/circle/model3" className="sbc-ms-cta">Explore Model 3 pre-buy →</Link>
        <p className="sbc-ms-note">
          Investors only · B2B wholesale exchange. Resale income depends on actual bookings — never
          guaranteed.
        </p>
      </div>
    </CircleStepShell>
  );
}
