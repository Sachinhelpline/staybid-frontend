// v450 — instant skeleton on navigation to the Explorer Passport. Mirrors the
// page's own in-flight loading branch (title → passport hero → stat block) so
// the route swap paints immediately instead of freezing the previous page.
import { SkelBar, SkelKeyframes } from "@/components/skeletons/nav-skel";

export default function PassportLoading() {
  return (
    <div style={{ minHeight: "100dvh", padding: "32px 20px 112px", maxWidth: 576, margin: "0 auto" }} aria-busy="true" aria-label="Loading your passport">
      <SkelBar w="160px" h={34} r={12} />
      <SkelBar w="100%" h={420} r={24} style={{ marginTop: 18 }} />
      <SkelBar w="100%" h={124} r={24} style={{ marginTop: 16 }} />
      <SkelKeyframes />
    </div>
  );
}
