"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const API = "/api/proxy";

/* ── Mock data (shown when backend returns no bids) ─────────────── */
const MOCK_BIDS = [
  {
    id: "mock-1", status: "PENDING", amount: 2800, createdAt: new Date(Date.now() - 3600000).toISOString(),
    customer: { name: "Rahul Sharma", phone: "+91 98765XXXXX" },
    room: { type: "Deluxe Mountain View", floorPrice: 2600 },
    checkIn: new Date(Date.now() + 86400000 * 3).toISOString(),
    checkOut: new Date(Date.now() + 86400000 * 6).toISOString(),
    guests: 2,
    requirements: "Room: deluxe, king bed | View: Mountain | Meal plan: BB | Special occasion: anniversary",
  },
  {
    id: "mock-2", status: "PENDING", amount: 3500, createdAt: new Date(Date.now() - 7200000).toISOString(),
    customer: { name: "Priya Mehta", phone: "+91 87654XXXXX" },
    room: { type: "Suite", floorPrice: 3200 },
    checkIn: new Date(Date.now() + 86400000 * 7).toISOString(),
    checkOut: new Date(Date.now() + 86400000 * 10).toISOString(),
    guests: 4,
    requirements: "Room: suite, king bed | View: Forest | Meal plan: HB | Early check-in requested | Family Trip",
  },
  {
    id: "mock-3", status: "COUNTER", amount: 2200, counterAmount: 2600, createdAt: new Date(Date.now() - 18000000).toISOString(),
    customer: { name: "Amit Patel", phone: "+91 76543XXXXX" },
    room: { type: "Standard Room", floorPrice: 2400 },
    checkIn: new Date(Date.now() + 86400000 * 1).toISOString(),
    checkOut: new Date(Date.now() + 86400000 * 3).toISOString(),
    guests: 2,
    requirements: "Room: standard, twin beds | View: Any | Meal plan: RO",
  },
  {
    id: "mock-4", status: "ACCEPTED", amount: 3100, createdAt: new Date(Date.now() - 86400000).toISOString(),
    customer: { name: "Sneha Gupta", phone: "+91 65432XXXXX" },
    room: { type: "Deluxe Suite", floorPrice: 2900 },
    checkIn: new Date(Date.now() + 86400000 * 14).toISOString(),
    checkOut: new Date(Date.now() + 86400000 * 17).toISOString(),
    guests: 2,
    requirements: "Room: suite, king bed | View: Mountain | Meal plan: BB | Honeymoon",
  },
];

/* ── Status Config ──────────────────────────────────────────────── */
const STATUS: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  PENDING:  { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Awaiting Response", dot: "bg-amber-500" },
  COUNTER:  { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Counter Sent",      dot: "bg-blue-500"  },
  ACCEPTED: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Accepted",          dot: "bg-emerald-500"},
  REJECTED: { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Rejected",          dot: "bg-red-400"   },
};

function nightsBetween(ci: string, co: string) {
  return Math.max(0, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86400000));
}

/* ═══════════════════════════════════════════════════════════════════
   Bid Action Modal
═══════════════════════════════════════════════════════════════════ */
function BidActionModal({ bid, onClose, onDone }: { bid: any; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<"accept" | "counter" | "reject" | null>(null);
  const [counterAmt, setCounterAmt] = useState(String(bid.room?.floorPrice || bid.amount));
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const nights = nightsBetween(bid.checkIn, bid.checkOut);

  const submit = async () => {
    if (!action) return;
    setLoading(true);
    const token = localStorage.getItem("sb_token");
    try {
      if (action === "accept") {
        await fetch(`${API}/api/bids/${bid.id}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        });
      } else if (action === "counter") {
        await fetch(`${API}/api/bids/${bid.id}/counter`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ counterAmount: parseFloat(counterAmt), message }),
        });
      } else if (action === "reject") {
        await fetch(`${API}/api/bids/${bid.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message }),
        });
      }
      onDone();
    } catch {
      onDone();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="p-6 border-b border-luxury-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-[0.18em] mb-1">Respond to Bid</p>
              <h3 className="font-display text-xl text-luxury-900">{bid.customer?.name || "Guest"}</h3>
              <p className="text-sm text-luxury-500 mt-0.5">{bid.room?.type || "Room"} · {nights} nights</p>
            </div>
            <button onClick={onClose} className="text-luxury-300 hover:text-luxury-600 text-2xl leading-none">×</button>
          </div>

          {/* Bid summary */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-luxury-50 rounded-xl p-3 text-center">
              <p className="text-[0.55rem] text-luxury-400 uppercase tracking-wider">Guest Bid</p>
              <p className="text-lg font-bold text-luxury-900">₹{bid.amount}</p>
            </div>
            <div className="bg-luxury-50 rounded-xl p-3 text-center">
              <p className="text-[0.55rem] text-luxury-400 uppercase tracking-wider">Check-in</p>
              <p className="text-sm font-bold text-luxury-800">
                {new Date(bid.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>
            <div className="bg-luxury-50 rounded-xl p-3 text-center">
              <p className="text-[0.55rem] text-luxury-400 uppercase tracking-wider">Revenue Est.</p>
              <p className="text-sm font-bold text-gold-700">₹{(bid.amount * nights).toLocaleString("en-IN")}</p>
            </div>
          </div>

          {bid.requirements && (
            <div className="mt-3 p-3 bg-blue-50 rounded-xl text-xs text-blue-700 leading-relaxed">
              <span className="font-bold">Guest preferences: </span>{bid.requirements}
            </div>
          )}
        </div>

        {/* Action selection */}
        <div className="p-6 space-y-3">
          <p className="text-xs font-bold text-luxury-400 uppercase tracking-wider mb-2">Choose Action</p>

          {/* Accept */}
          <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
            action === "accept" ? "border-emerald-400 bg-emerald-50" : "border-luxury-100 hover:border-emerald-200"
          }`}>
            <input type="radio" name="action" value="accept" checked={action === "accept"} onChange={() => setAction("accept")} className="accent-emerald-600" />
            <div className="flex-1">
              <p className="font-bold text-sm text-luxury-900">✅ Accept at ₹{bid.amount}/night</p>
              <p className="text-xs text-luxury-500">Guest confirms instantly · Est. revenue: ₹{(bid.amount * nights).toLocaleString("en-IN")}</p>
            </div>
          </label>

          {/* Counter */}
          <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
            action === "counter" ? "border-blue-400 bg-blue-50" : "border-luxury-100 hover:border-blue-200"
          }`}>
            <input type="radio" name="action" value="counter" checked={action === "counter"} onChange={() => setAction("counter")} className="accent-blue-600" />
            <div className="flex-1">
              <p className="font-bold text-sm text-luxury-900">💬 Counter Offer</p>
              <p className="text-xs text-luxury-500">Propose your price — guest gets to accept or decline</p>
            </div>
          </label>

          {action === "counter" && (
            <div className="ml-6 space-y-3">
              <div>
                <label className="text-xs font-semibold text-luxury-500 block mb-1.5">Your Counter Price (₹/night)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 font-bold">₹</span>
                  <input type="number" value={counterAmt} onChange={(e) => setCounterAmt(e.target.value)}
                    className="input-luxury pl-8 text-lg font-bold w-full" />
                </div>
                {parseFloat(counterAmt) > 0 && nights > 0 && (
                  <p className="text-xs text-blue-600 mt-1">Est. revenue: ₹{(parseFloat(counterAmt) * nights).toLocaleString("en-IN")}</p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-luxury-500 block mb-1.5">Message to Guest (optional)</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hi! We'd love to host you. Our best rate for this stay is…"
                  className="input-luxury text-sm resize-none w-full" rows={2} />
              </div>
            </div>
          )}

          {/* Reject */}
          <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
            action === "reject" ? "border-red-300 bg-red-50" : "border-luxury-100 hover:border-red-200"
          }`}>
            <input type="radio" name="action" value="reject" checked={action === "reject"} onChange={() => setAction("reject")} className="accent-red-500" />
            <div className="flex-1">
              <p className="font-bold text-sm text-luxury-900">❌ Decline</p>
              <p className="text-xs text-luxury-500">Not available for these dates or budget</p>
            </div>
          </label>

          {action === "reject" && (
            <div className="ml-6">
              <label className="text-xs font-semibold text-luxury-500 block mb-1.5">Reason (optional)</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Sorry, we're fully booked for these dates…"
                className="input-luxury text-sm resize-none w-full" rows={2} />
            </div>
          )}

          <button onClick={submit} disabled={!action || loading}
            className="btn-luxury w-full py-3.5 rounded-2xl text-sm mt-2 disabled:opacity-40">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending…
              </span>
            ) : (
              action === "accept" ? "Confirm Acceptance" :
              action === "counter" ? "Send Counter Offer" :
              action === "reject" ? "Decline Bid" :
              "Select an action first"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main Partner Panel
═══════════════════════════════════════════════════════════════════ */
export default function HotelPartnerPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("PENDING");
  const [selectedBid, setSelectedBid] = useState<any>(null);
  const [isMock, setIsMock] = useState(false);
  const [hotelName, setHotelName] = useState("Your Hotel");

  const fetchBids = useCallback(async () => {
    const token = localStorage.getItem("sb_token");
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/bids/hotel`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("no data");
      const data = await res.json();
      const list = data.bids || data.requests || [];
      if (list.length === 0) throw new Error("empty");
      setBids(list);
      setHotelName(data.hotel?.name || "Your Hotel");
      setIsMock(false);
    } catch {
      setBids(MOCK_BIDS as any);
      setIsMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    fetchBids();
  }, [user, authLoading, router, fetchBids]);

  const filtered = filter === "ALL" ? bids : bids.filter((b) => b.status === filter);

  const stats = {
    pending:  bids.filter(b => b.status === "PENDING").length,
    counter:  bids.filter(b => b.status === "COUNTER").length,
    accepted: bids.filter(b => b.status === "ACCEPTED").length,
    revenue:  bids.filter(b => b.status === "ACCEPTED").reduce((sum, b) => {
      return sum + (b.counterAmount || b.amount) * nightsBetween(b.checkIn, b.checkOut);
    }, 0),
  };

  if (authLoading || loading) return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-4">
      {[1, 2, 3].map(i => <div key={i} className="h-40 shimmer rounded-3xl" />)}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(160deg, #0f0c1a 0%, #1a1225 60%, #0f0c1a 100%)" }}>
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #c9911a, #f0b429)" }}>
              <span className="text-lg">🏨</span>
            </div>
            <div>
              <p className="text-gold-400 text-[0.65rem] font-bold tracking-[0.2em] uppercase">Partner Portal</p>
              <h1 className="text-white font-display font-light text-xl">{hotelName}</h1>
            </div>
          </div>

          {isMock && (
            <div className="bg-blue-900/40 border border-blue-500/30 rounded-2xl p-3 mb-4 flex items-start gap-2">
              <span className="text-blue-400 text-sm mt-0.5">ℹ️</span>
              <p className="text-blue-300 text-xs leading-relaxed">
                <strong className="text-blue-200">Demo Mode:</strong> Showing sample bid requests. Connect your hotel account to see live bids. Backend endpoint <code className="bg-blue-900/60 px-1 rounded text-[0.6rem]">GET /api/bids/hotel</code> needs to be enabled on Railway.
              </p>
            </div>
          )}
        </div>

        {/* Analytics cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Awaiting Reply", value: stats.pending,  icon: "⏳", color: "text-amber-400",   sub: "bids pending" },
            { label: "Countered",      value: stats.counter,  icon: "💬", color: "text-blue-400",    sub: "awaiting guest" },
            { label: "Confirmed",      value: stats.accepted, icon: "✅", color: "text-emerald-400", sub: "bookings won" },
            { label: "Est. Revenue",   value: `₹${stats.revenue > 0 ? (stats.revenue / 1000).toFixed(1) + "k" : "0"}`, icon: "💰", color: "text-gold-400", sub: "from accepted" },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center backdrop-blur-sm">
              <span className="text-xl block mb-1">{s.icon}</span>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[0.58rem] text-white/40 mt-0.5 tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {[
            { key: "PENDING",  label: "To Respond", count: stats.pending  },
            { key: "COUNTER",  label: "Countered",  count: stats.counter  },
            { key: "ACCEPTED", label: "Confirmed",  count: stats.accepted },
            { key: "ALL",      label: "All Bids",   count: bids.length    },
          ].map(({ key, label, count }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-bold tracking-wide transition-all duration-200 ${
                filter === key
                  ? "bg-gold-500 text-white shadow-gold"
                  : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/80 border border-white/10"
              }`}>
              {label} {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          ))}
        </div>

        {/* Bid list */}
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <span className="text-4xl block mb-4">🎉</span>
            <p className="text-white/60 text-sm">No bids in this category</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((bid: any) => {
              const st = STATUS[bid.status] || STATUS.PENDING;
              const nights = nightsBetween(bid.checkIn, bid.checkOut);
              const revenue = (bid.counterAmount || bid.amount) * nights;

              return (
                <div key={bid.id} className="bg-white/95 rounded-3xl border border-white/20 shadow-2xl overflow-hidden">
                  {/* Status bar */}
                  <div className={`h-1 ${bid.status === "PENDING" ? "bg-amber-400" : bid.status === "COUNTER" ? "bg-blue-400" : bid.status === "ACCEPTED" ? "bg-emerald-400" : "bg-red-400"}`} />

                  <div className="p-5">
                    {/* Top row */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white"
                          style={{ background: "linear-gradient(135deg, #c9911a, #f0b429)" }}>
                          {(bid.customer?.name || "G").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-luxury-900 text-sm">{bid.customer?.name || "Anonymous Guest"}</p>
                          <p className="text-xs text-luxury-400">{bid.guests} guests · {bid.room?.type || "Room"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        <span className={`text-[0.6rem] font-bold px-2.5 py-1 rounded-full border ${st.bg} ${st.text} ${st.border}`}>
                          {st.label}
                        </span>
                      </div>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      <div className="col-span-1">
                        <p className="text-[0.55rem] text-luxury-300 uppercase tracking-wider mb-0.5">Bid/night</p>
                        <p className="text-base font-bold text-luxury-900">₹{bid.amount}</p>
                      </div>
                      <div>
                        <p className="text-[0.55rem] text-luxury-300 uppercase tracking-wider mb-0.5">Check-in</p>
                        <p className="text-xs font-semibold text-luxury-700">
                          {new Date(bid.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.55rem] text-luxury-300 uppercase tracking-wider mb-0.5">Nights</p>
                        <p className="text-xs font-semibold text-luxury-700">{nights}</p>
                      </div>
                      <div>
                        <p className="text-[0.55rem] text-luxury-300 uppercase tracking-wider mb-0.5">Revenue</p>
                        <p className="text-xs font-bold text-gold-600">₹{revenue.toLocaleString("en-IN")}</p>
                      </div>
                    </div>

                    {/* Requirements */}
                    {bid.requirements && (
                      <div className="bg-luxury-50 rounded-xl p-2.5 mb-3 text-xs text-luxury-600 leading-relaxed">
                        <span className="text-[0.55rem] font-bold text-luxury-400 uppercase tracking-wider block mb-0.5">Guest Preferences</span>
                        {bid.requirements}
                      </div>
                    )}

                    {/* Counter shown */}
                    {bid.status === "COUNTER" && bid.counterAmount && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 mb-3 flex items-center justify-between">
                        <span className="text-xs text-blue-700">Your counter offer:</span>
                        <span className="font-bold text-blue-800 text-sm">₹{bid.counterAmount}/night</span>
                      </div>
                    )}

                    {/* Time since */}
                    <p className="text-[0.58rem] text-luxury-300 mb-3">
                      Received {new Date(bid.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>

                    {/* Action button */}
                    {bid.status === "PENDING" && (
                      <button onClick={() => setSelectedBid(bid)} className="btn-luxury w-full py-3 rounded-2xl text-sm">
                        Respond to Bid
                      </button>
                    )}
                    {bid.status === "ACCEPTED" && (
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
                        <span className="text-emerald-600 text-lg">✅</span>
                        <div>
                          <p className="text-xs font-bold text-emerald-800">Booking Confirmed</p>
                          <p className="text-[0.6rem] text-emerald-600">Revenue: ₹{revenue.toLocaleString("en-IN")} · Guest preparing for arrival</p>
                        </div>
                      </div>
                    )}
                    {bid.status === "COUNTER" && (
                      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-2xl p-3">
                        <span className="text-blue-600 text-lg">⏳</span>
                        <div>
                          <p className="text-xs font-bold text-blue-800">Awaiting Guest Response</p>
                          <p className="text-[0.6rem] text-blue-600">Offer sent at ₹{bid.counterAmount}/night — guest will accept or decline</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Backend Integration Note */}
        <div className="mt-10 bg-white/5 border border-white/10 rounded-3xl p-6">
          <p className="text-gold-400 text-[0.65rem] font-bold uppercase tracking-[0.18em] mb-3">Backend Integration</p>
          <p className="text-white/60 text-xs leading-relaxed mb-4">
            To enable live bid management for hotel partners, add these endpoints to your Railway backend:
          </p>
          <div className="space-y-2">
            {[
              { method: "GET",  path: "/api/bids/hotel",           desc: "Fetch bids for authenticated hotel owner" },
              { method: "POST", path: "/api/bids/:id/counter",     desc: "Send counter offer { counterAmount, message }" },
              { method: "POST", path: "/api/bids/:id/reject",      desc: "Reject bid { message? }" },
              { method: "POST", path: "/api/bids/:id/accept",      desc: "Accept bid (already exists ✓)" },
            ].map(({ method, path, desc }) => (
              <div key={path} className="bg-black/30 rounded-xl p-3 flex items-start gap-3">
                <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 ${
                  method === "GET" ? "bg-emerald-900/60 text-emerald-400" : "bg-blue-900/60 text-blue-400"
                }`}>{method}</span>
                <div>
                  <code className="text-gold-300 text-xs">{path}</code>
                  <p className="text-white/40 text-[0.58rem] mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 bg-black/30 rounded-xl p-4">
            <p className="text-[0.6rem] text-white/40 uppercase tracking-wider mb-2">Sample Backend Code</p>
            <pre className="text-[0.62rem] text-emerald-300 overflow-x-auto leading-relaxed">{`// GET /api/bids/hotel — add to Railway backend
app.get("/api/bids/hotel", authenticate, async (req: any, res) => {
  const hotel = await prisma.hotel.findFirst({
    where: { ownerId: req.user.id }
  });
  if (!hotel) return res.status(404).json({ error: "No hotel found" });
  const bids = await prisma.bid.findMany({
    where: { hotelId: hotel.id },
    include: { room: true, customer: { select: { name: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json({ hotel, bids });
});`}</pre>
          </div>
        </div>

        <p className="text-center text-white/20 text-xs mt-8">
          StayBid Partner Portal · {user?.name || user?.phone}
        </p>
      </div>

      {/* Action Modal */}
      {selectedBid && (
        <BidActionModal
          bid={selectedBid}
          onClose={() => setSelectedBid(null)}
          onDone={() => { setSelectedBid(null); fetchBids(); }}
        />
      )}
    </div>
  );
}
