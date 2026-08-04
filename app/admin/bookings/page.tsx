"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ClipboardList, CircleCheck, Hourglass, MessageSquare, Wallet,
  Link2, Sparkles, Building2, Zap, HelpCircle, Globe, BedDouble, TriangleAlert,
} from "lucide-react";
import DataTable from "@/components/admin/data-table";
import KpiCard from "@/components/admin/kpi-card";
import { LivePill, LiveCountdown, useAutoPoll } from "@/components/admin/live-ticker";
// v177 — auto-cleanup of stale bids in the admin booking ledger. Same
// rule the customer /my-bids + hotel partner Bid Inbox views use.
import { filterActiveBids } from "@/lib/bid-expiry";

// v94 — source style map (mirror of lib/attribution SOURCE_*) — kept local
// because the admin panel doesn't import from the customer-side lib.
const SOURCE_STYLE: Record<string, { icon: ReactNode; label: string; color: string }> = {
  direct:        { icon: <Link2 size={13} strokeWidth={2} aria-hidden />,      label: "Direct",      color: "#3D9CF5" },
  creator:       { icon: <Sparkles size={13} strokeWidth={2} aria-hidden />,   label: "Creator",     color: "#A855F7" },
  "hotel-feed":  { icon: <Building2 size={13} strokeWidth={2} aria-hidden />,  label: "Hotel reel",  color: "#9fb1c2" },
  flash:         { icon: <Zap size={13} strokeWidth={2} aria-hidden />,        label: "Flash deal",  color: "#FF4757" },
  unknown:       { icon: <HelpCircle size={13} strokeWidth={2} aria-hidden />, label: "Unknown",     color: "#8A8FA8" },
};

export default function AdminBookings() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [hotel, setHotel] = useState("");
  const [source, setSource] = useState<"all" | "direct" | "creator" | "hotel-feed" | "flash">("all");
  const [selected, setSelected] = useState<any | null>(null);

  function load() {
    setLoading(true);
    const q = new URLSearchParams({ status, hotel });
    fetch(`/api/admin/bookings?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => { setBookings(d.bookings || []); setLoading(false); })
      .catch(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);
  // v126.2 — live auto-poll every 10s + LIVE pill at top.
  const { lastAt, refresh } = useAutoPoll(load, 10_000);

  // v177 — drop stale bids before any aggregation. Paid ACCEPTED rows +
  // CHECKED_IN/OUT stays + active in-window bids survive; everything past
  // its slot or past the IST-midnight cutoff is filtered out so the admin
  // ledger doesn't accumulate 3-day-old PENDING rows.
  const activeBookings = filterActiveBids(bookings as any[]);

  // v94 — source filter is applied client-side over the active set.
  const filteredBookings = source === "all" ? activeBookings : activeBookings.filter((b) => (b.source || "direct") === source);

  // Live source-breakdown chip strip for the current dataset.
  const sourceCounts = activeBookings.reduce<Record<string, number>>((acc, b) => {
    const s = b.source || "direct"; acc[s] = (acc[s] || 0) + 1; return acc;
  }, {});

  const columns = [
    // v239 — Use last 6 chars instead of first 8. CUIDs share a common
    // timestamp-derived prefix (`bid_mpn0/1/2/q…`), so the first 8 chars
    // looked identical across 10+ adjacent rows (Sachin: "BID-bid_mpn0,
    // BID-bid_mpn1, BID-bid_mpn2 same dikh rahe"). Last 6 chars are the
    // random suffix and are visually distinguishable. Tap-to-copy puts
    // the FULL id on the clipboard so admins can paste into Supabase
    // queries; title attribute alone was useless on touch devices.
    { key: "id", label: "Bid ID", render: (b: any) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          try {
            navigator.clipboard.writeText(b.id);
            const t = e.currentTarget;
            const orig = t.dataset.orig || t.textContent || "";
            if (!t.dataset.orig) t.dataset.orig = orig;
            t.textContent = "✓ Copied";
            setTimeout(() => { t.textContent = t.dataset.orig || orig; }, 1200);
          } catch {}
        }}
        title={`Bid ID: ${b.id} (tap to copy)`}
        style={{ background: "transparent", border: "none", color: "#8A8FA8", fontSize: 12, fontFamily: "monospace", cursor: "pointer", padding: 0 }}
      >
        BID-…{b.id?.slice(-6)}
      </button>
    ) },
    { key: "hotelName", label: "Hotel", render: (b: any) => <span>{b.hotelName} <span style={{ color: "#8A8FA8", fontSize: 11 }}>· {b.hotelCity}</span></span> },
    {
      key: "checkIn",
      label: "Stay",
      render: (b: any) => b.checkIn ? `${new Date(b.checkIn).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} → ${new Date(b.checkOut).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : "—",
    },
    {
      key: "amount",
      label: "Bid",
      render: (b: any) => `₹${Number(b.amount).toLocaleString()}`,
    },
    {
      // v241 — numRooms column. Multi-room bids surface here so admin
      // sees the full configuration at a glance. capacityMismatch flag
      // adds a yellow tint for over-packed configurations.
      key: "numRooms",
      label: "Rooms",
      render: (b: any) => {
        const n = Math.max(1, Number(b.numRooms || 1));
        const mismatch = !!b.capacityMismatch;
        return (
          <span
            title={mismatch ? "Capacity mismatch — guests > capacity × rooms" : `${n} room${n > 1 ? "s" : ""}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: mismatch ? "rgba(176, 192, 209,0.18)" : "rgba(140, 160, 182,0.10)",
              color: mismatch ? "#c6d0da" : "#9fb1c2",
              padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: mismatch ? "1px solid rgba(176, 192, 209,0.35)" : "1px solid transparent",
            }}
          >
            <BedDouble size={13} strokeWidth={2} aria-hidden /> {n}{mismatch ? <TriangleAlert size={12} strokeWidth={2.4} aria-hidden style={{ marginLeft: 2 }} /> : ""}
          </span>
        );
      },
    },
    {
      key: "paidTotal",
      label: "Paid",
      render: (b: any) => b.paidTotal ? <span style={{ color: "#2ECC71" }}>₹{Number(b.paidTotal).toLocaleString()}</span> : <span style={{ color: "#8A8FA8" }}>—</span>,
    },
    {
      key: "flowType",
      label: "Flow",
      render: (b: any) => b.flowType ? <span style={{ background: "rgba(168,85,247,0.15)", color: "#A855F7", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}>{b.flowType}</span> : "—",
    },
    {
      // v94 — booking-source attribution column
      key: "source",
      label: "Source",
      render: (b: any) => {
        const meta = SOURCE_STYLE[b.source || "direct"] || SOURCE_STYLE.direct;
        const label = b.source === "creator" && b.creatorHandle ? `@${b.creatorHandle}` : meta.label;
        return (
          <span
            title={`Channel: ${meta.label}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: meta.color + "22", color: meta.color,
              padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            }}
          >
            <span>{meta.icon}</span><span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      render: (b: any) => (
        <span
          style={{
            background: bidStatusColor(b.status) + "22",
            color: bidStatusColor(b.status),
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {b.status}
        </span>
      ),
    },
    {
      key: "createdAt",
      label: "Live",
      // v126.2 — live timeline:
      //   • ACCEPTED with acceptance_window → countdown to expiry (15 min default)
      //   • PENDING with auto_accept_at → countdown to auto-accept
      //   • CHECKED_IN with checkOut → countdown to checkout
      //   • else → "X ago" relative time
      render: (b: any) => {
        const now = Date.now();
        if (b.status === "ACCEPTED" && b.acceptance_window_expires_at) {
          return <LiveCountdown endsAt={b.acceptance_window_expires_at} label="PAY IN" />;
        }
        if (b.status === "PENDING" && b.auto_accept_at) {
          return <LiveCountdown endsAt={b.auto_accept_at} label="AUTO" />;
        }
        if (b.status === "CHECKED_IN" && b.checkOut) {
          return <LiveCountdown endsAt={b.checkOut} label="CHK-OUT" />;
        }
        const created = b.createdAt ? new Date(b.createdAt).getTime() : null;
        if (!created) return "—";
        const diff = now - created;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return <span style={{ color: "#2ECC71" }}>just now</span>;
        if (mins < 60) return <span style={{ color: "#8A8FA8", fontSize: 11 }}>{mins}m ago</span>;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return <span style={{ color: "#8A8FA8", fontSize: 11 }}>{hrs}h ago</span>;
        const days = Math.floor(hrs / 24);
        return <span style={{ color: "#8A8FA8", fontSize: 11 }}>{days}d ago</span>;
      },
    },
    {
      key: "actions",
      label: "",
      render: (b: any) => (
        <button
          onClick={() => setSelected(b)}
          style={{
            background: "rgba(140, 160, 182,0.1)",
            color: "#9fb1c2",
            border: "1px solid rgba(140, 160, 182,0.3)",
            padding: "5px 12px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Timeline
        </button>
      ),
    },
  ];

  // v103 — KPI strip computed from currently loaded bookings/bids
  // v177 — KPI strip mirrors the filtered set so admin counts match
  // what's actually rendered after stale rows are dropped.
  const stats = useMemo(() => {
    const total      = activeBookings.length;
    const accepted   = activeBookings.filter((b: any) => ["accepted","confirmed","checked_in","checked_out","ACCEPTED","CONFIRMED","CHECKED_IN","CHECKED_OUT"].includes(b.status)).length;
    const pending    = activeBookings.filter((b: any) => ["open","OPEN","PENDING","pending"].includes(b.status)).length;
    const countered  = activeBookings.filter((b: any) => ["counter","COUNTER","COUNTERED","countered"].includes(b.status)).length;
    const gross      = activeBookings.reduce((s: number, b: any) => s + Number(b.paidTotal || 0), 0);
    return { total, accepted, pending, countered, gross };
  }, [activeBookings]);

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 22, margin: 0 }}>
          Bookings & Bids
        </h1>
        <LivePill lastRefreshAt={lastAt} refreshNow={refresh} size="md" />
      </div>

      <div className="admin-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 22 }}>
        <KpiCard title="Total Bids"   value={stats.total}     icon={<ClipboardList size={18} strokeWidth={2} aria-hidden />} color="#9fb1c2" live onClick={() => setStatus("all")} />
        <KpiCard title="Accepted+"    value={stats.accepted}  icon={<CircleCheck size={18} strokeWidth={2} aria-hidden />} color="#2ECC71" live sub="confirmed → checked-out" onClick={() => setStatus("ACCEPTED")} />
        <KpiCard title="Pending"      value={stats.pending}   icon={<Hourglass size={18} strokeWidth={2} aria-hidden />} color="#c6d0da" live onClick={() => setStatus("PENDING")} />
        <KpiCard title="Countered"    value={stats.countered} icon={<MessageSquare size={18} strokeWidth={2} aria-hidden />} color="#FF8C42" live onClick={() => setStatus("COUNTER")} />
        <KpiCard title="Gross Paid"   value={stats.gross}     format={(n) => "₹" + Math.round(n).toLocaleString("en-IN")} icon={<Wallet size={18} strokeWidth={2} aria-hidden />} color="#3D9CF5" live onClick={() => (typeof window !== "undefined" && (window.location.href = "/admin/finance"))} />
      </div>

      <div className="admin-filters" style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Filter by hotel name…"
          value={hotel}
          onChange={(e) => setHotel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={inputStyle}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="counter">Countered</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="confirmed">Confirmed</option>
          <option value="checked_in">Checked In</option>
          <option value="checked_out">Checked Out</option>
        </select>
        <button onClick={load} style={btnStyle}>Search</button>
        <span style={{ marginLeft: "auto", color: "#8A8FA8", alignSelf: "center", fontSize: 13 }}>
          {filteredBookings.length} of {activeBookings.length} bids
        </span>
      </div>

      {/* v94 — Source filter pill row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "#8A8FA8", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Source:
        </span>
        {(["all", "direct", "creator", "hotel-feed", "flash"] as const).map((s) => {
          const meta = s === "all" ? { icon: <Globe size={13} strokeWidth={2} aria-hidden />, label: "All", color: "#9fb1c2" } : SOURCE_STYLE[s];
          const isActive = source === s;
          const count = s === "all" ? activeBookings.length : (sourceCounts[s] || 0);
          return (
            <button key={s} onClick={() => setSource(s)}
              style={{
                background: isActive ? meta.color + "33" : "rgba(255,255,255,0.04)",
                color: isActive ? meta.color : "#8A8FA8",
                border: `1px solid ${isActive ? meta.color + "55" : "rgba(255,255,255,0.07)"}`,
                padding: "6px 12px", borderRadius: 999,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                display: "inline-flex", gap: 6, alignItems: "center",
              }}>
              <span>{meta.icon}</span><span>{meta.label}</span>
              <span style={{ color: isActive ? meta.color : "#8A8FA8", fontSize: 11 }}>· {count}</span>
            </button>
          );
        })}
      </div>

      <DataTable columns={columns} data={filteredBookings} loading={loading} pageSize={15} />

      {selected && <BidTimelineModal bid={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BidTimelineModal({ bid, onClose }: { bid: any; onClose: () => void }) {
  // v716.1 (owner ss4 BUG) — a payment CANNOT exist before the bid is accepted,
  // so the "Payment" milestone + the "Paid Total" stat must be gated on BOTH a
  // real positive amount AND a non-pre-acceptance status. This is the last line
  // of defence: even if a stray bid_paid_amounts row leaks a value (e.g. the
  // legacy below-floor rows already in the DB), a PENDING/COUNTER/rejected bid
  // never reads as PAID.
  const st = String(bid.status || "").toLowerCase();
  const notPayable = ["pending", "counter", "countered", "rejected", "declined", "expired", "cancelled", "lowball"].includes(st);
  const isPaid = Number(bid.paidTotal) > 0 && !notPayable;
  const steps = [
    { label: "Bid Created", date: bid.createdAt, done: true },
    { label: "Hotel Countered", date: bid.counterAmount ? bid.createdAt : null, done: !!bid.counterAmount },
    { label: "Accepted", date: ["accepted", "confirmed", "checked_in", "checked_out"].includes(bid.status?.toLowerCase()) ? bid.createdAt : null, done: ["accepted", "confirmed", "checked_in", "checked_out"].includes(bid.status?.toLowerCase()) },
    { label: "Payment", date: isPaid ? (bid.paidAt || bid.createdAt) : null, done: isPaid },
    { label: "Checked In", date: ["checked_in", "checked_out"].includes(bid.status?.toLowerCase()) ? bid.checkIn : null, done: ["checked_in", "checked_out"].includes(bid.status?.toLowerCase()) },
    { label: "Checked Out", date: bid.status?.toLowerCase() === "checked_out" ? bid.checkOut : null, done: bid.status?.toLowerCase() === "checked_out" },
  ];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 640, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {/* v239 — Same first-8-chars-collide issue as the list column. Show last 6 with tap-to-copy full id. */}
            <h2
              onClick={(e) => {
                e.stopPropagation();
                try {
                  navigator.clipboard.writeText(bid.id);
                  const t = e.currentTarget;
                  const orig = t.dataset.orig || t.textContent || "";
                  if (!t.dataset.orig) t.dataset.orig = orig;
                  t.textContent = "✓ Copied";
                  setTimeout(() => { t.textContent = t.dataset.orig || orig; }, 1200);
                } catch {}
              }}
              title={`Bid ID: ${bid.id} (tap to copy)`}
              style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", margin: "0 0 4px", cursor: "pointer" }}
            >BID-…{bid.id?.slice(-6)}</h2>
            <div style={{ color: "#8A8FA8", fontSize: 13 }}>{bid.hotelName} · {bid.hotelCity}</div>
          </div>
          <span
            style={{
              background: bidStatusColor(bid.status) + "22",
              color: bidStatusColor(bid.status),
              padding: "6px 14px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {bid.status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "20px 0" }}>
          <Stat label="Bid Amount" value={`₹${Number(bid.amount).toLocaleString()}`} />
          <Stat label="Counter" value={bid.counterAmount ? `₹${Number(bid.counterAmount).toLocaleString()}` : "—"} />
          <Stat label="Paid Total" value={isPaid ? `₹${Number(bid.paidTotal).toLocaleString()}` : "—"} />
          <Stat label="Flow Type" value={bid.flowType || "—"} />
        </div>

        {/* Timeline */}
        <div style={{ marginTop: 24 }}>
          <div style={{ color: "#8A8FA8", fontSize: 12, marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Workflow Timeline
          </div>
          <div style={{ position: "relative", paddingLeft: 24 }}>
            <div style={{ position: "absolute", left: 7, top: 4, bottom: 4, width: 2, background: "rgba(255,255,255,0.07)" }} />
            {steps.map((s, i) => (
              <div key={i} style={{ position: "relative", paddingBottom: 18 }}>
                <div
                  style={{
                    position: "absolute",
                    left: -22,
                    top: 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: s.done ? "#2ECC71" : "#0F1117",
                    border: `2px solid ${s.done ? "#2ECC71" : "rgba(255,255,255,0.15)"}`,
                  }}
                />
                <div style={{ color: s.done ? "#E8EAF0" : "#8A8FA8", fontSize: 14, fontWeight: s.done ? 600 : 400 }}>
                  {s.label}
                </div>
                {s.date && (
                  <div style={{ color: "#8A8FA8", fontSize: 11, marginTop: 2 }}>
                    {new Date(s.date).toLocaleString("en-IN")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {bid.message && (
          <div style={{ marginTop: 16, padding: 14, background: "#0F1117", borderRadius: 10, borderLeft: "3px solid #9fb1c2" }}>
            <div style={{ color: "#8A8FA8", fontSize: 11, marginBottom: 4 }}>MESSAGE</div>
            <div style={{ color: "#E8EAF0", fontSize: 13 }}>{bid.message}</div>
          </div>
        )}

        <div style={{ marginTop: 24, display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
          <button
            onClick={() => alert(`Refund stub: ₹${bid.paidTotal} would be refunded via Razorpay`)}
            style={{ ...btnStyle, background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)" }}
          >
            Trigger Refund
          </button>
          <button
            onClick={() => alert("Booking flagged for manual review")}
            style={{ ...btnStyle, background: "rgba(176, 192, 209,0.1)", color: "#c6d0da", border: "1px solid rgba(176, 192, 209,0.3)" }}
          >
            Escalate
          </button>
          <button onClick={onClose} style={{ ...btnStyle, marginLeft: "auto", background: "#0F1117", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.07)" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: "#0F1117", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 600, marginTop: 4, fontFamily: "Syne, sans-serif" }}>{value}</div>
    </div>
  );
}
function bidStatusColor(s: string) {
  const x = (s || "").toLowerCase();
  if (["accepted", "confirmed", "checked_in", "checked_out"].includes(x)) return "#2ECC71";
  if (["rejected", "cancelled"].includes(x)) return "#FF4757";
  if (["counter", "open", "pending"].includes(x)) return "#9fb1c2";
  return "#8A8FA8";
}
const inputStyle: React.CSSProperties = { background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", color: "#E8EAF0", fontSize: 14, outline: "none", fontFamily: "DM Sans, sans-serif", minWidth: 220 };
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 160, cursor: "pointer" };
const btnStyle: React.CSSProperties = { background: "#9fb1c2", color: "#000", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "DM Sans, sans-serif" };
