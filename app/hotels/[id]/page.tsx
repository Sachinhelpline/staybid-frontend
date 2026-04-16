"use client";
import { useState, useEffect, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

export default function HotelDetail() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  const dealId    = searchParams.get("dealId");
  const dealPrice = searchParams.get("dealPrice");
  const dealRoomId = searchParams.get("roomId");
  const dealDiscount = searchParams.get("discount");

  useEffect(() => {
    if (id) {
      api.getHotel(id as string)
        .then((d) => {
          setHotel(d.hotel);
          if (dealRoomId && d.hotel?.rooms) {
            const room = d.hotel.rooms.find((r: any) => r.id === dealRoomId);
            if (room) {
              setBidRoom(room);
              if (dealPrice) setBidAmount(dealPrice);
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [id]);

  const fetchMyBids = () => {
    if (!user) return;
    api.getMyBids?.()
      .then((d) => {
        const hotelBids = (d.bids || []).filter((b: any) => b.hotelId === id);
        setMyBids(hotelBids);
      })
      .catch(() => {});
  };

  useEffect(() => { fetchMyBids(); }, [user, id]);

  useEffect(() => {
    if (!user) return;
    const socket = io(API);
    socket.emit("join:customer", user.id);
    socket.on("bid:counter", (bid: any) => {
      if (bid.hotelId === id) {
        setMyBids((prev) => prev.map((b) => (b.id === bid.id ? { ...b, ...bid } : b)));
      }
    });
    return () => { socket.disconnect(); };
  }, [user, id]);

  const handleBid = async () => {
    if (!user) return router.push("/auth");
    if (!bidAmount || !bidRoom || !checkIn || !checkOut) return alert("Please fill all fields");
    setBidLoading(true);
    try {
      const reqRes = await api.createBidRequest?.({
        hotelId: hotel.id,
        roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        checkIn,
        checkOut,
        guests: bidRoom.capacity || 2,
      });
      await api.placeBid({
        hotelId: hotel.id,
        roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        message: bidMsg || undefined,
        requestId: reqRes?.request?.id || undefined,
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
      const token = localStorage.getItem("sb_token");
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
      const token = localStorage.getItem("sb_token");
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

  const statusStyle = (s: string) => {
    switch (s) {
      case "PENDING":  return { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200",  label: "Pending"  };
      case "COUNTER":  return { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", label: "Counter"  };
      case "ACCEPTED": return { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200",label: "Accepted" };
      case "REJECTED": return { bg: "bg-red-50",    text: "text-red-600",    border: "border-red-200",    label: "Rejected" };
      default:         return { bg: "bg-luxury-50", text: "text-luxury-600", border: "border-luxury-100", label: s };
    }
  };

  /* ── Loading state ── */
  if (loading) return (
    <div className="max-w-4xl mx-auto px-5 py-10 space-y-5">
      <div className="h-72 shimmer rounded-3xl" />
      <div className="h-8 w-2/3 shimmer rounded-full" />
      <div className="h-4 w-1/3 shimmer rounded-full" />
      <div className="h-4 w-1/2 shimmer rounded-full" />
    </div>
  );

  /* ── Not found ── */
  if (!hotel) return (
    <div className="text-center py-28 text-luxury-400">
      <div className="w-16 h-16 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🏨</span>
      </div>
      <p className="text-lg font-semibold text-luxury-700 mb-1">Hotel not found</p>
      <Link href="/hotels" className="text-sm text-gold-500 hover:text-gold-600 transition-colors">
        ← Back to hotels
      </Link>
    </div>
  );

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-5 py-10">

        {/* ── Hero image ── */}
        <div className="h-72 md:h-96 rounded-3xl overflow-hidden bg-luxury-100 mb-8 relative shadow-luxury-lg">
          {hotel.images?.[0] ? (
            <img src={hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-7xl opacity-15">🏨</span>
            </div>
          )}
          {/* Dark gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

          {hotel.trustBadge && (
            <span className="absolute top-4 left-4 badge-gold flex items-center gap-1">
              ✓ Verified Stay
            </span>
          )}

          {/* Hotel name overlay on image */}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h1 className="font-display font-light text-white text-3xl md:text-4xl leading-tight drop-shadow-lg">
              {hotel.name}
            </h1>
            <p className="text-white/70 text-sm mt-1 tracking-wide">{hotel.city}, {hotel.state}</p>
          </div>
        </div>

        {/* ── Flash Deal Banner ── */}
        {dealId && dealPrice && (
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-gold-900/10 to-gold-500/10 border border-gold-300 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-gold-600 uppercase tracking-widest">Flash Deal Active</p>
                <p className="text-sm text-luxury-700 mt-0.5">
                  Special price <span className="font-bold text-luxury-900 text-lg">₹{dealPrice}</span>/night
                  {dealDiscount && <span className="ml-2 badge-gold">{dealDiscount}% OFF</span>}
                </p>
              </div>
            </div>
            <Link href="/flash-deals" className="text-xs text-gold-500 hover:text-gold-600 transition-colors whitespace-nowrap">
              All Deals →
            </Link>
          </div>
        )}

        {/* ── Hotel meta ── */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          {hotel.starRating && (
            <span className="text-gold-400 text-lg tracking-widest">
              {"★".repeat(hotel.starRating)}
            </span>
          )}
          {hotel.avgRating > 0 && (
            <span className="px-3 py-1 bg-gold-100 text-gold-600 text-sm font-semibold rounded-full border border-gold-200">
              ★ {hotel.avgRating.toFixed(1)} · {hotel.totalReviews} reviews
            </span>
          )}
        </div>

        {hotel.description && (
          <p className="text-luxury-600 mb-8 leading-relaxed text-[0.95rem]">{hotel.description}</p>
        )}

        {/* ── Amenities ── */}
        {hotel.amenities?.length > 0 && (
          <div className="mb-10">
            <h2 className="font-semibold text-luxury-900 text-base mb-4 tracking-tight">Amenities</h2>
            <div className="flex flex-wrap gap-2">
              {hotel.amenities.map((a: string) => (
                <span key={a} className="px-3 py-1.5 bg-white border border-luxury-200 rounded-full text-sm text-luxury-600">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Divider ── */}
        <div className="divider-gold mb-10" />

        {/* ── My Bids ── */}
        {myBids.length > 0 && (
          <div className="mb-10">
            <h2 className="font-semibold text-luxury-900 text-base mb-5 tracking-tight">Your Bids</h2>
            <div className="space-y-3">
              {myBids.map((b: any) => {
                const st = statusStyle(b.status);
                return (
                  <div key={b.id} className="card-luxury p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-luxury-900">{b.room?.type || "Room"}</p>
                        <p className="text-sm text-luxury-400 mt-0.5">Your bid: <span className="font-semibold text-luxury-700">₹{b.amount}</span></p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${st.bg} ${st.text} ${st.border}`}>
                        {st.label}
                      </span>
                    </div>

                    {b.status === "COUNTER" && (
                      <div className="mt-4 p-4 bg-orange-50 rounded-2xl border border-orange-200">
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
                      <p className="mt-3 text-sm text-emerald-600 font-medium">
                        ✓ Booking confirmed at ₹{b.counterAmount || b.amount}
                      </p>
                    )}
                    {b.status === "REJECTED" && (
                      <p className="mt-3 text-sm text-red-500">Bid was not accepted</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Available Rooms ── */}
        <h2 className="font-semibold text-luxury-900 text-base mb-5 tracking-tight">Available Rooms</h2>

        {hotel.rooms?.length === 0 && (
          <p className="text-luxury-400 py-6 text-sm">No rooms available right now.</p>
        )}

        <div className="space-y-4 mb-10">
          {hotel.rooms?.map((r: any) => (
            <div
              key={r.id}
              className={`rounded-3xl border overflow-hidden transition-all duration-300 ${
                bidRoom?.id === r.id
                  ? "border-gold-400 bg-gold-100/30 shadow-gold"
                  : "border-luxury-100 bg-white hover:border-luxury-200 hover:shadow-luxury"
              }`}
            >
              {r.images?.[0] && (
                <img src={r.images[0]} alt={r.name} className="w-full h-52 object-cover" />
              )}
              <div className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-luxury-900">{r.name || r.type}</h3>
                    <p className="text-sm text-luxury-400 mt-0.5 tracking-wide">{r.type} · {r.capacity} guests</p>
                    {r.amenities?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {r.amenities.slice(0, 4).map((a: string) => (
                          <span key={a} className="text-xs px-2.5 py-0.5 bg-luxury-50 border border-luxury-100 rounded-full text-luxury-500">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    {dealRoomId === r.id && dealPrice ? (
                      <>
                        <p className="text-xs font-bold text-gold-500 uppercase tracking-widest">Flash Deal</p>
                        <p className="text-sm text-luxury-300 line-through">₹{r.floorPrice}</p>
                        <p className="text-2xl font-bold text-gold-600">₹{dealPrice}</p>
                        <p className="text-xs text-luxury-400 mb-3">/night · {dealDiscount}% off</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-luxury-300 line-through">MRP ₹{r.mrp}</p>
                        <p className="text-2xl font-bold text-luxury-900">₹{r.floorPrice}</p>
                        <p className="text-xs text-luxury-400 mb-3">floor price / night</p>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setBidRoom(r);
                        setBidAmount(dealRoomId === r.id && dealPrice ? dealPrice : "");
                        setBidMsg("");
                        setCheckIn("");
                        setCheckOut("");
                        setBidSuccess(false);
                      }}
                      className="btn-luxury px-5 py-2.5 rounded-xl text-sm"
                    >
                      {dealRoomId === r.id && dealPrice ? "Book Flash Deal" : "Place Bid"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Reviews ── */}
        {hotel.reviews?.length > 0 && (
          <div>
            <div className="divider-gold mb-8" />
            <h2 className="font-semibold text-luxury-900 text-base mb-5 tracking-tight">Guest Reviews</h2>
            <div className="space-y-3">
              {hotel.reviews.map((r: any) => (
                <div key={r.id} className="p-5 bg-white border border-luxury-100 rounded-2xl">
                  <p className="text-sm text-luxury-700 leading-relaxed">{r.comment}</p>
                  <p className="text-xs text-luxury-300 mt-3 tracking-wide">
                    {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          BID MODAL
      ══════════════════════════════════════════ */}
      {bidRoom && !bidSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidRoom(null)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-luxury-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Gold top accent */}
            <div className="w-12 h-1 bg-gradient-to-r from-gold-500 to-gold-300 rounded-full mx-auto mb-6" />

            <h3 className="font-display font-light text-luxury-900 text-2xl mb-1">Place Your Bid</h3>
            <p className="text-sm text-luxury-400 mb-6">
              {bidRoom.name || bidRoom.type} at <span className="text-luxury-700 font-medium">{hotel.name}</span>
            </p>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in</label>
                <input
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="input-luxury text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                <input
                  type="date"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  min={checkIn || new Date().toISOString().split("T")[0]}
                  className="input-luxury text-sm"
                />
              </div>
            </div>

            {/* Bid amount */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
                Your Bid Amount (₹)
              </label>
              <input
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder={dealRoomId === bidRoom?.id && dealPrice ? `Flash Deal ₹${dealPrice}` : `Floor ₹${bidRoom.floorPrice} — MRP ₹${bidRoom.mrp}`}
                className="input-luxury text-lg font-bold"
              />
              {bidAmount && parseFloat(bidAmount) < bidRoom.floorPrice && (
                <p className="text-xs text-red-500 mt-1.5">Minimum bid is ₹{bidRoom.floorPrice}</p>
              )}
            </div>

            {/* Message */}
            <div className="mb-6">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
                Message (optional)
              </label>
              <textarea
                value={bidMsg}
                onChange={(e) => setBidMsg(e.target.value)}
                placeholder="e.g. Anniversary trip, need the best deal…"
                className="input-luxury text-sm resize-none"
                rows={2}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setBidRoom(null)}
                className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 font-medium hover:bg-luxury-50 transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleBid}
                disabled={bidLoading || !bidAmount || !checkIn || !checkOut || parseFloat(bidAmount) < bidRoom.floorPrice}
                className="flex-1 py-3 rounded-2xl btn-luxury disabled:opacity-40 text-sm"
              >
                {bidLoading ? "Submitting…" : "Submit Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          BID SUCCESS MODAL
      ══════════════════════════════════════════ */}
      {bidSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidSuccess(false)}
        >
          <div
            className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Bid Placed!</h3>
            <p className="text-luxury-400 text-sm leading-relaxed mb-6">
              The hotel will review your offer and respond soon. You&apos;ll be notified when they accept or counter.
            </p>
            <button
              onClick={() => setBidSuccess(false)}
              className="btn-luxury w-full py-3 rounded-2xl text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
