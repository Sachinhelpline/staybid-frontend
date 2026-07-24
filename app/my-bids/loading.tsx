// v450 — instant skeleton on navigation to My Bids. Approximates the page
// layout (title → segmented filter → stacked bid cards) so the route swap
// paints immediately instead of freezing the previous page.
import { SkelBar, SkelKeyframes } from "@/components/skeletons/nav-skel";

export default function MyBidsLoading() {
  return (
    <div style={{ minHeight: "100dvh", padding: "22px 16px 96px", maxWidth: 640, margin: "0 auto" }} aria-busy="true" aria-label="Loading your bids">
      <SkelBar w="46%" h={26} />
      <SkelBar w="66%" h={14} style={{ marginTop: 10 }} />
      {/* segmented filter */}
      <SkelBar w="100%" h={46} r={999} style={{ marginTop: 18 }} />
      {/* bid cards */}
      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {[0, 1, 2].map((i) => (
          <SkelBar key={i} w="100%" h={132} r={22} />
        ))}
      </div>
      <SkelKeyframes />
    </div>
  );
}
