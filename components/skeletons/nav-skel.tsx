// v450 — shared route-transition skeleton primitive.
//
// Next App Router renders a segment's `loading.tsx` INSTANTLY on navigation
// while the real (heavy, client-side) page streams in behind it — so the old
// page never sits frozen. Before v450 only 3 routes had a loading.tsx; this
// primitive lets the rest reuse the exact same gold-shimmer bar the
// hotels/[id] skeleton established (theme-aware, reduced-motion safe,
// self-contained so it paints before the page's own CSS/state exist).
//
// Pure server component (no 'use client') — safe to import into any
// loading.tsx. Render <SkelKeyframes/> once per skeleton, then <SkelBar/>s.

export function SkelBar({
  w,
  h = 14,
  r = 8,
  style,
}: {
  w: string;
  h?: number | string;
  r?: number;
  style?: React.CSSProperties;
}) {
  return <div className="sb-nav-skel-bar" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function SkelKeyframes() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      .sb-nav-skel-bar{
        background:linear-gradient(90deg, rgba(201,166,107,0.10) 25%, rgba(201,166,107,0.20) 50%, rgba(201,166,107,0.10) 75%);
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
  );
}
