// v407 — instant skeleton on navigation to the flash-deals page. Renders
// immediately on route change while the real page loads its deals, so the
// transition feels instant instead of leaving the previous page frozen.
export default function FlashDealsLoading() {
  return (
    <div style={{ minHeight: "100dvh", padding: "18px 16px 90px", maxWidth: 720, margin: "0 auto" }} aria-busy="true" aria-label="Loading flash deals">
      <div className="sb-nav-skel-bar" style={{ width: "55%", height: 26, borderRadius: 8 }} />
      <div className="sb-nav-skel-bar" style={{ width: "78%", height: 15, borderRadius: 8, marginTop: 10 }} />
      <div style={{ display: "grid", gap: 14, marginTop: 22 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sb-nav-skel-bar" style={{ width: "100%", height: 120, borderRadius: 16 }} />
        ))}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .sb-nav-skel-bar{
          background:linear-gradient(90deg, rgba(106,133,160,0.10) 25%, rgba(106,133,160,0.20) 50%, rgba(106,133,160,0.10) 75%);
          background-size:200% 100%;
          animation:sbNavSkel 1.35s ease-in-out infinite;
        }
        html[data-theme="dark"] .sb-nav-skel-bar{
          background:linear-gradient(90deg, rgba(176, 192, 209,0.06) 25%, rgba(176, 192, 209,0.13) 50%, rgba(176, 192, 209,0.06) 75%);
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
