"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const statusStyle: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING:  { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending"  },
  COUNTER:  { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  label: "Countered"},
  ACCEPTED: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Accepted" },
  REJECTED: { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Rejected" },
};

export default function MyBidsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [filter, setFilter] = useState("ALL");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

  const fetchBids = () => {
    api.getMyBids()
      .then((d) => setBids(d.bids || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    fetchBids();
  }, [user, authLoading, router]);

  const handleCounterAccept = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("sb_token");
      const res = await fetch(`${API_URL}/api/bids/${bidId}/counter-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchBids();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleCounterReject = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("sb_token");
      const res = await fetch(`${API_URL}/api/bids/${bidId}/counter-reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchBids();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading("");
    }
  };

  const filters = ["ALL", "PENDING", "COUNTER", "ACCEPTED", "REJECTED"];
  const filtered = filter === "ALL" ? bids : bids.filter((b) => b.status === filter);

  const pendingCount  = bids.filter((b) => b.status === "PENDING").length;
  const counterCount  = bids.filter((b) => b.status === "COUNTER").length;
  const acceptedCount = bids.filter((b) => b.status === "ACCEPTED").length;

  if (authLoading || loading) return (
    <div className="max-w-2xl mx-auto px-5 py-12 space-y-4">
      {[1, 2, 3].map((i) => <div key={i} className="h-36 shimmer rounded-3xl" />)}
    </div>
  );

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-2xl mx-auto px-5 py-12">

        {/* Header */}
        <div className="mb-8">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-2">Account</p>
          <h1 className="font-display font-light text-luxury-900 mb-1" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            My Bids
          </h1>
          <p className="text-luxury-400 text-sm">All bids you have placed across hotels.</p>
        </div>

        {/* Summary cards */}
        {bids.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: "Pending",  value: pendingCount,  color: "text-amber-600"   },
              { label: "Countered",value: counterCount,  color: "text-orange-600"  },
              { label: "Accepted", value: acceptedCount, color: "text-emerald-600" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-luxury-100 rounded-2xl p-4 text-center shadow-luxury">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-luxury-400 mt-0.5 tracking-wide">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filter pills */}
        {bids.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 ${
                  filter === f
                    ? "btn-luxury shadow-gold"
                    : "bg-white border border-luxury-200 text-luxury-500 hover:border-gold-300"
                }`}
              >
                {f === "ALL" ? `All (${bids.length})` : `${f.charAt(0) + f.slice(1).toLowerCase()} (${bids.filter(b => b.status === f).length})`}
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {bids.length === 0 && (
          <div className="text-center py-24">
            <div className="w-20 h-20 rounded-full bg-white border border-luxury-100 flex items-center justify-center mx-auto mb-5 shadow-luxury">
              <span className="text-3xl">🎯</span>
            </div>
            <p className="text-lg font-semibold text-luxury-800 mb-1">No bids placed yet</p>
            <p className="text-sm text-luxury-400 mb-6">Browse hotels and place your first bid.</p>
            <Link href="/hotels" className="btn-luxury px-6 py-3 rounded-2xl text-sm inline-block">
              Browse Hotels
            </Link>
          </div>
        )}

        {/* Bid cards */}
        <div className="space-y-4">
          {filtered.map((b: any) => {
            const st = statusStyle[b.status] || { bg: "bg-luxury-50", text: "text-luxury-600", border: "border-luxury-100", label: b.status };
            return (
              <div key={b.id} className="card-luxury p-5">
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Link
                      href={`/hotels/${b.hotelId}`}
                      className="font-semibold text-luxury-900 hover:text-gold-600 transition-colors text-[1rem] leading-snug"
                    >
                      {b.hotel?.name || "Hotel"}
                    </Link>
                    <p className="text-sm text-luxury-400 mt-0.5">{b.room?.type || "Room"}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border shrink-0 ${st.bg} ${st.text} ${st.border}`}>
                    {st.label}
                  </span>
                </div>

                {/* Bid details */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-[0.62rem] text-luxury-300 uppercase tracking-wider mb-1">Your Bid</p>
                    <p className="text-sm font-bold text-luxury-900">₹{b.amount}</p>
                  </div>
                  {b.checkIn && (
                    <div>
                      <p className="text-[0.62rem] text-luxury-300 uppercase tracking-wider mb-1">Check-in</p>
                      <p className="text-sm text-luxury-700">
                        {new Date(b.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                  )}
                  {b.checkOut && (
                    <div>
                      <p className="text-[0.62rem] text-luxury-300 uppercase tracking-wider mb-1">Check-out</p>
                      <p className="text-sm text-luxury-700">
                        {new Date(b.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                  )}
                </div>

                {/* Counter offer */}
                {b.status === "COUNTER" && (
                  <div className="mt-3 p-4 bg-orange-50 rounded-2xl border border-orange-200">
                    <p className="text-sm font-medium text-orange-800 mb-3">
                      Hotel countered at{" "}
                      <span className="text-xl font-bold text-orange-700">₹{b.counterAmount}</span>
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCounterAccept(b.id)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2.5 btn-luxury rounded-xl text-sm disabled:opacity-40"
                      >
                        {actionLoading === b.id ? "…" : `Accept ₹${b.counterAmount}`}
                      </button>
                      <button
                        onClick={() => handleCounterReject(b.id)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition border border-red-200 disabled:opacity-40"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {b.status === "ACCEPTED" && (
                  <p className="mt-2 text-sm text-emerald-600 font-medium">
                    ✓ Confirmed at ₹{b.counterAmount || b.amount}
                  </p>
                )}

                {/* Footer */}
                <div className="divider-gold mt-3 mb-3" />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-luxury-300 tracking-wide">
                    {b.createdAt
                      ? new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                      : ""}
                  </p>
                  <Link
                    href={`/hotels/${b.hotelId}`}
                    className="text-xs text-gold-500 hover:text-gold-600 transition-colors font-medium tracking-wide"
                  >
                    View Hotel →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
