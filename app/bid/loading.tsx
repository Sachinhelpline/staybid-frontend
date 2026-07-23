// v407 — instant loader on navigation to /bid (the reverse-auction game
// zone). The /bid route carries a large client component; this dark, branded
// splash renders immediately on route change so the transition feels instant
// and blends into the game-zone's dark boot backdrop (no cream flash).
export default function BidLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading bid zone"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #0d0a05 0%, #1f1a0f 100%)",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 16 }}>
        <div className="sb-bid-splash-spinner" />
        <div style={{ color: "rgba(217,190,130,0.85)", fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase" }}>
          Loading your auction
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .sb-bid-splash-spinner{
          width:42px;height:42px;border-radius:50%;
          border:2px solid rgba(201,166,107,0.20);
          border-top-color:#c9a66b;
          animation:sbBidSpin .8s linear infinite;
        }
        @keyframes sbBidSpin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion: reduce){ .sb-bid-splash-spinner{animation:none} }
      `,
        }}
      />
    </div>
  );
}
