"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

export default function HotelDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [hotel, setHotel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bidRoom, setBidRoom] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidMsg, setBidMsg] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [bidLoading, setBidLoading] = useState(false);
  const [bidSuccess, setBidSuccess] = useState(false);
  const [myBids, setMyBids] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState("");

  useEffect(() => {
    if (id) {
      api.getHotel(id as string)
        .then((d) => setHotel(d.hotel))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [id]);

  // Fetch my bids
  const fetchMyBids = () => {
    if (!user) return;
    api.getMyBids?.()
      .then((d) => {
        const hotelBids = (d.bids || []).filter((b: any) => b.hotelId === id);
        setMyBids(hotelBids);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchMyBids();
  }, [user, id]);

  // Socket.io — listen for counter offers
  useEffect(() => {
    if (!user) return;
    const socket = io(API);
    socket.emit("join:customer", user.id);

    socket.on("bid:counter", (bid: any) => {
      if (bid.hotelId === id) {
        setMyBids((prev) =>
          prev.map((b) => (b.id === bid.id ? { ...b, ...bid } : b))
        );
      }
    });

    return () => { socket.disconnect(); };
  }, [user, id]);

  const handleBid = async () => {
    if (!user) return router.push("/auth");
    if (!bidAmount || !bidRoom || !checkIn || !checkOut) return alert("Please fill all fields");
    setBidLoading(true);
    try {
      // First create bid request
      await api.createBidRequest?.({
        hotelId: hotel.id,
        roomId: bidRoom.id,
        checkIn,
        checkOut,
        guests: bidRoom.capacity || 2,
      });

      // Then place bid
      await api.placeBid({
        hotelId: hotel.id,
        roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        message: bidMsg || undefined,
      });
      setBidSuccess(true);
      setBidRoom(null);
      fetchMyBids();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBidLoading(false);
    }
  };

  const handleCounterAccept = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/bids/${bidId}/counter-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert("Booking confirmed! 🎉");
      fetchMyBids();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleCounterReject = async (bidId: string) => {
    setActionLoading(bidId);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/bids/${bidId}/counter-reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchMyBids();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading("");
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "PENDING": return "bg-yellow-100 text-yellow-700";
      case "COUNTER": return "bg-orange-100 text-orange-700";
      case "ACCEPTED": return "bg-green-100 text-green-700";
      case "REJECTED": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="h-64 shimmer rounded-2xl" />
      <div className="h-8 w-1/2 shimmer rounded" />
      <div className="h-4 w-1/3 shimmer rounded" />
    </div>
  );

  if (!hotel) return (
    <div className="text-center py-20 text-gray-400">
      <p className="text-lg">Hotel not found</p>
      <Link href="/hotels" className="text-brand-600 underline mt-2 inline-block">Back to hotels</Link>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Hero Image */}
      <div className="h-64 md:h-80 rounded-3xl overflow-hidden bg-gradient-to-br from-brand-100 to-brand-50 mb-6 relative">
        {hotel.images?.[0] ? (
          <img src={hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><span className="text-7xl opacity-20">🏨</span></div>
        )}
        {hotel.trustBadge && (
          <span className="absolute top-4 left-4 px-3 py-1.5 bg-brand-600 text-white text-sm font-bold rounded-xl">✓ Verified Stay</span>
        )}
      </div>

      {/* Hotel Info */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl md:text-4xl mb-1">{hotel.name}</h1>
          <p className="text-gray-500">{hotel.city}, {hotel.state}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-accent-400">{Array.from({ length: hotel.starRating }).map(() => "★").join("")}</span>
            {hotel.avgRating > 0 && <span className="text-sm font-semibold bg-brand-50 text-brand-700 px-2 py-0.5 rounded-lg">★ {hotel.avgRating.toFixed(1)} ({hotel.totalReviews})</span>}
          </div>
        </div>
      </div>

      {hotel.description && <p className="text-gray-600 mb-8 leading-relaxed">{hotel.description}</p>}

      {hotel.amenities?.length > 0 && (
        <div className="mb-8">
          <h2 className="font-bold text-lg mb-3">Amenities</h2>
          <div className="flex flex-wrap gap-2">
            {hotel.amenities.map((a: string) => (
              <span key={a} className="px-3 py-1.5 bg-gray-100 rounded-full text-sm text-gray-600">{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── MY BIDS SECTION ── */}
      {myBids.length > 0 && (
        <div className="mb-8">
          <h2 className="font-bold text-lg mb-4">Your Bids</h2>
          <div className="space-y-3">
            {myBids.map((b: any) => (
              <div key={b.id} className="p-4 bg-white border border-gray-100 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold">{b.room?.type || "Room"}</p>
                    <p className="text-sm text-gray-500">Your bid: ₹{b.amount}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusColor(b.status)}`}>
                    {b.status}
                  </span>
                </div>

                {/* Counter Offer */}
                {b.status === "COUNTER" && (
                  <div className="mt-3 p-3 bg-orange-50 rounded-xl border border-orange-200">
                    <p className="text-sm font-medium text-orange-800 mb-2">
                      Hotel countered with <span className="text-lg font-bold">₹{b.counterAmount}</span>
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCounterAccept(b.id)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 transition disabled:opacity-40"
                      >
                        {actionLoading === b.id ? "..." : "Accept ₹" + b.counterAmount}
                      </button>
                      <button
                        onClick={() => handleCounterReject(b.id)}
                        disabled={actionLoading === b.id}
                        className="flex-1 py-2 bg-red-100 text-red-600 text-sm font-bold rounded-xl hover:bg-red-200 transition disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {b.status === "ACCEPTED" && (
                  <p className="mt-2 text-sm text-green-600 font-medium">✅ Booking confirmed at ₹{b.counterAmount || b.amount}</p>
                )}

                {b.status === "REJECTED" && (
                  <p className="mt-2 text-sm text-red-500 font-medium">Bid was rejected</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ROOMS ── */}
      <h2 className="font-bold text-lg mb-4">Available Rooms</h2>
      {hotel.rooms?.length === 0 && <p className="text-gray-400 py-4">No rooms available right now.</p>}
      <div className="space-y-4 mb-8">
        {hotel.rooms?.map((r: any) => (
          <div key={r.id} className={`rounded-2xl border transition overflow-hidden ${bidRoom?.id === r.id ? "border-brand-500 bg-brand-50" : "border-gray-100 bg-white hover:border-gray-200"}`}>
            {r.images?.[0] && <img src={r.images[0]} alt={r.name} className="w-full h-48 object-cover" />}
            <div className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold">{r.name || r.type}</h3>
                  <p className="text-sm text-gray-500">{r.type} · {r.capacity} guests</p>
                  {r.amenities?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.amenities.slice(0, 4).map((a: string) => (
                        <span key={a} className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-500">{a}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm text-gray-400 line-through">MRP ₹{r.mrp}</p>
                  <p className="text-2xl font-bold text-brand-700">₹{r.floorPrice}</p>
                  <p className="text-xs text-gray-400">floor price / night</p>
                  <button onClick={() => { setBidRoom(r); setBidAmount(""); setBidMsg(""); setCheckIn(""); setCheckOut(""); setBidSuccess(false); }} className="mt-2 px-5 py-2 bg-brand-600 text-white text-sm font-bold rounded-xl hover:bg-brand-700 transition">
                    Place Bid
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── BID MODAL ── */}
      {bidRoom && !bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setBidRoom(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-2xl mb-1">Place Your Bid</h3>
            <p className="text-sm text-gray-500 mb-5">{bidRoom.name || bidRoom.type} at {hotel.name}</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-sm font-medium text-gray-600 block mb-1">Check-in</label>
                <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} min={new Date().toISOString().split("T")[0]} className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600 block mb-1">Check-out</label>
                <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} min={checkIn || new Date().toISOString().split("T")[0]} className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm font-medium text-gray-600 block mb-1">Your Bid Amount (₹)</label>
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} placeholder={`Floor: ₹${bidRoom.floorPrice} | MRP: ₹${bidRoom.mrp}`} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-lg font-bold" />
              {bidAmount && parseFloat(bidAmount) < bidRoom.floorPrice && (
                <p className="text-xs text-red-500 mt-1">Bid must be at least ₹{bidRoom.floorPrice} (floor price)</p>
              )}
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-gray-600 block mb-1">Message (optional)</label>
              <textarea value={bidMsg} onChange={(e) => setBidMsg(e.target.value)} placeholder="e.g. Planning anniversary trip, need best deal..." className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" rows={2} />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setBidRoom(null)} className="flex-1 py-3 rounded-xl border border-gray-200 font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleBid} disabled={bidLoading || !bidAmount || !checkIn || !checkOut || parseFloat(bidAmount) < bidRoom.floorPrice} className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 transition disabled:opacity-40">
                {bidLoading ? "Submitting..." : "Submit Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BID SUCCESS ── */}
      {bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setBidSuccess(false)}>
          <div className="bg-white max-w-sm rounded-3xl p-8 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="text-5xl mb-4 block">🎉</span>
            <h3 className="font-display text-2xl mb-2">Bid Placed!</h3>
            <p className="text-gray-500 text-sm mb-6">The hotel will review your bid and respond. You&apos;ll get a notification when they accept or counter.</p>
            <button onClick={() => setBidSuccess(false)} className="px-6 py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition">Got it</button>
          </div>
        </div>
      )}

      {/* ── REVIEWS ── */}
      {hotel.reviews?.length > 0 && (
        <div>
          <h2 className="font-bold text-lg mb-4">Reviews</h2>
          <div className="space-y-3">
            {hotel.reviews.map((r: any) => (
              <div key={r.id} className="p-4 bg-white border border-gray-100 rounded-xl">
                <p className="text-sm text-gray-700">{r.comment}</p>
                <p className="text-xs text-gray-400 mt-2">{new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
