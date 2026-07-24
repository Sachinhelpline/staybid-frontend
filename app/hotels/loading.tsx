// v450 — instant skeleton on navigation to the hotels listing. Mirrors the
// page's own in-flight skeleton (search bar → filter chips → card grid) so the
// route transition and the page's first paint hand off seamlessly instead of
// leaving the previous page frozen.
import { SkelBar, SkelKeyframes } from "@/components/skeletons/nav-skel";

export default function HotelsLoading() {
  return (
    <div style={{ minHeight: "100dvh", padding: "16px 16px 24px", maxWidth: 1120, margin: "0 auto" }} aria-busy="true" aria-label="Loading hotels">
      {/* search + filter row */}
      <SkelBar w="100%" h={46} r={14} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {["68px", "82px", "60px", "74px", "56px"].map((w, i) => (
          <SkelBar key={i} w={w} h={30} r={999} />
        ))}
      </div>
      {/* card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 16,
          marginTop: 20,
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ display: "grid", gap: 9 }}>
            <SkelBar w="100%" h={168} r={18} />
            <SkelBar w="72%" h={16} />
            <SkelBar w="48%" h={13} />
            <SkelBar w="60%" h={15} style={{ marginTop: 2 }} />
          </div>
        ))}
      </div>
      <SkelKeyframes />
    </div>
  );
}
