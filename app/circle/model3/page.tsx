"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /circle/model3 — Pre-Buy Marketplace shell (v339 · Phase M0).
//
// Model 3 = an investor pre-buys room-nights WHOLESALE on StayBid-operated
// properties, then resells them for a margin. M0 ships the shared 3-step
// shell + an HONEST supply state at Step 1 ("N operated properties across
// X cities ready for pre-buy — full pick-your-dates marketplace launching").
// The real browse → yearly-calendar → build-&-pay flow is Phase M1.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import CircleStepShell from "@/components/circle/CircleStepShell";

type Summary = { prebuyHotels: number; cities: string[] };

export default function Model3Page() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/circle/marketplace-summary")
      .then((r) => r.json())
      .then((j) => { if (alive) setSum(j?.model3 ?? { prebuyHotels: 0, cities: [] }); })
      .catch(() => { if (alive) setSum({ prebuyHotels: 0, cities: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const n = sum?.prebuyHotels ?? 0;
  const cities = sum?.cities ?? [];

  return (
    <CircleStepShell
      model="Model 3"
      tag="Pre-Buy Marketplace"
      title="Pre-buy rooms wholesale. Resell for a margin."
      subtitle="Lock room-nights on StayBid-operated properties at wholesale, then list them back on StayBid + OTAs. You keep the margin; unsold-inventory risk is yours."
      activeStep={1}
    >
      <div className="sbc-ms-empty">
        <div className="sbc-ms-empty-ic">🔑</div>
        {loading ? (
          <>
            <div className="sbc-ms-empty-h">Loading supply…</div>
            <p className="sbc-ms-empty-p">Checking which operated properties are open for pre-buy.</p>
          </>
        ) : n > 0 ? (
          <>
            <div className="sbc-ms-empty-h">
              {n} operated {n === 1 ? "property" : "properties"} ready for pre-buy
            </div>
            <p className="sbc-ms-empty-p">
              {cities.length
                ? <>Across {cities.length === 1 ? "" : ""}<b>{cities.join(" · ")}</b>. </>
                : null}
              The full <b>pick-your-dates</b> marketplace — browse every property, pick a date range on a
              yearly calendar at live wholesale price, and pay — is launching next.
            </p>
            {cities.length ? (
              <div className="sbc-ms-chips">
                {cities.map((c) => (
                  <span key={c} className="sbc-ms-chip">{c}</span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="sbc-ms-empty-h">Pre-buy supply is being onboarded</div>
            <p className="sbc-ms-empty-p">
              StayBid is provisioning operated properties for the pre-buy marketplace. Check back
              soon — or express interest below and we&apos;ll notify you when it opens.
            </p>
          </>
        )}

        <Link href="/circle" className="sbc-ms-cta">Back to StayCircle</Link>
        <p className="sbc-ms-note">
          Investors only · pre-buying to resell carries unsold-inventory risk. Income depends on actual
          resale — never guaranteed.
        </p>
      </div>
    </CircleStepShell>
  );
}
