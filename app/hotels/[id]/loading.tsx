// v407 — instant skeleton on navigation to a hotel page. The hotel detail
// page is the heaviest route (large client bundle + many mount fetches), so
// without a loading.tsx the OLD page stayed frozen until the new one was
// ready — the main reason navigation "felt slow". Next renders this instantly
// on route change while the real page streams in. Theme-aware (transparent
// bg → the page's own cream/dark backdrop shows through).
export default function HotelLoading() {
  const bar = (w: string, h = 14) => (
    <div
      className="sb-nav-skel-bar"
      style={{ width: w, height: h, borderRadius: 8 }}
    />
  );
  return (
    <div style={{ minHeight: "100dvh", padding: "0 0 24px" }} aria-busy="true" aria-label="Loading hotel">
      {/* hero block */}
      <div
        className="sb-nav-skel-bar"
        style={{ width: "100%", height: "38vh", minHeight: 240, borderRadius: 0 }}
      />
      <div style={{ padding: "18px 16px", display: "grid", gap: 14, maxWidth: 900, margin: "0 auto" }}>
        {bar("62%", 24)}
        {bar("40%", 16)}
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {bar("84px", 40)}
          {bar("84px", 40)}
          {bar("84px", 40)}
        </div>
        <div style={{ height: 8 }} />
        {bar("100%", 96)}
        {bar("92%")}
        {bar("96%")}
        {bar("70%")}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .sb-nav-skel-bar{
          background:linear-gradient(90deg, rgba(201,166,107,0.10) 25%, rgba(201,166,107,0.20) 50%, rgba(201,166,107,0.10) 75%);
          background-size:200% 100%;
          animation:sbNavSkel 1.35s ease-in-out infinite;
        }
        html[data-theme="dark"] .sb-nav-skel-bar{
          background:linear-gradient(90deg, rgba(217,190,130,0.06) 25%, rgba(217,190,130,0.13) 50%, rgba(217,190,130,0.06) 75%);
          background-size:200% 100%;
        }
        @keyframes sbNavSkel{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @media (prefers-reduced-motion: reduce){ .sb-nav-skel-bar{animation:none} }
      `,
        }}
      />
    </div>
  );
}
