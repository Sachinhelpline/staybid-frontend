// v450 — instant skeleton on navigation to Bookings. Approximates the page
// layout (title → booking cards) so the route swap paints immediately instead
// of freezing the previous page.
import { SkelBar, SkelKeyframes } from "@/components/skeletons/nav-skel";

export default function BookingsLoading() {
  return (
    <div style={{ minHeight: "100dvh", padding: "22px 16px 96px", maxWidth: 720, margin: "0 auto" }} aria-busy="true" aria-label="Loading your bookings">
      <SkelBar w="42%" h={26} />
      <SkelBar w="60%" h={14} style={{ marginTop: 10 }} />
      <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
        {[0, 1, 2].map((i) => (
          <SkelBar key={i} w="100%" h={150} r={20} />
        ))}
      </div>
      <SkelKeyframes />
    </div>
  );
}
