"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { io } from "socket.io-client";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";
const today = new Date().toISOString().split("T")[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

function bidProb(amount: number, floor: number) {
  const r = amount / floor;
  if (r >= 1.00) return { p: 95, label: "👑 Priority Booking", badge: "Max Cashback Points", color: "text-emerald-600", bg: "bg-emerald-50", track: "#10b981" };
  if (r >= 0.95) return { p: Math.round(70+(r-0.95)/0.05*24), label: "⭐ Strong Offer",    badge: "Bonus Points Eligible", color: "text-yellow-600", bg: "bg-yellow-50",  track: "#ca8a04" };
  if (r >= 0.90) return { p: Math.round(45+(r-0.90)/0.05*24), label: "✨ Good Standing",   badge: "Standard Points",       color: "text-amber-600",  bg: "bg-amber-50",   track: "#d97706" };
  if (r >= 0.85) return { p: Math.round(25+(r-0.85)/0.05*19), label: "Moderate",           badge: "",                      color: "text-orange-500", bg: "bg-orange-50",  track: "#f97316" };
  if (r >= 0.78) return { p: Math.round(10+(r-0.78)/0.07*14), label: "Low Chance",         badge: "",                      color: "text-orange-600", bg: "bg-orange-100", track: "#ea580c" };
  return {         p: Math.max(2, Math.round(r/0.78*9)),       label: "Very Low",           badge: "",                      color: "text-red-500",    bg: "bg-red-50",     track: "#ef4444" };
}

const sampleReviews = [
  { id:"s1", rating:5, comment:"Breathtaking views and impeccable service. Staff went above and beyond to make our anniversary special.", createdAt:"2026-03-15", guestName:"Priya S." },
  { id:"s2", rating:4, comment:"Lovely property with excellent amenities. The mountain air and peaceful surroundings made it a perfect getaway.", createdAt:"2026-02-28", guestName:"Rahul M." },
  { id:"s3", rating:5, comment:"Worth every rupee! Negotiated a great price through StayBid and the experience exceeded all expectations.", createdAt:"2026-01-10", guestName:"Anita K." },
];

export default function HotelDetail() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [hotel, setHotel]     = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Flash deal URL params
  const dealId       = searchParams.get("dealId");
  const dealPrice    = searchParams.get("dealPrice");
  const dealRoomId   = searchParams.get("roomId");
  const dealDiscount = searchParams.get("discount");
  const directBook   = searchParams.get("directBook") === "true";

  // Normal bid state
  const [bidRoom, setBidRoom]           = useState<any>(null);
  const [bidAmount, setBidAmount]       = useState("");
  const [bidMsg, setBidMsg]             = useState("");
  const [checkIn, setCheckIn]           = useState("");
  const [checkOut, setCheckOut]         = useState("");
  const [bidLoading, setBidLoading]     = useState(false);
  const [bidSuccess, setBidSuccess]     = useState(false);
  const [myBids, setMyBids]             = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState("");

  // Tabs
  const [tab, setTab] = useState("rooms");

  // Book Now state
  const [bnRoom, setBnRoom]       = useState<any>(null);
  const [bnIn, setBnIn]           = useState(today);
  const [bnOut, setBnOut]         = useState(tomorrow);
  const [bnAdults, setBnAdults]   = useState(2);
  const [bnChildren, setBnChildren] = useState(0);
  const [bnLoading, setBnLoading] = useState(false);
  const [bnSuccess, setBnSuccess] = useState(false);

  // Negotiate state
  const [negRoom, setNegRoom]     = useState<any>(null);
  const [negAmt, setNegAmt]       = useState(0);
  const [negIn, setNegIn]         = useState(today);
  const [negOut, setNegOut]       = useState(tomorrow);
  const [negLoading, setNegLoading] = useState(false);
  const [negSuccess, setNegSuccess] = useState(false);
  const [negAuto, setNegAuto]     = useState(false);

  // Flash deal booking state
  const [flashBookOpen, setFlashBookOpen]     = useState(false);
  const [flashCheckOut, setFlashCheckOut]     = useState(tomorrow);
  const [flashAdults, setFlashAdults]         = useState(2);
  const [flashChildren, setFlashChildren]     = useState(0);
  const [bookLoading, setBookLoading]         = useState(false);
  const [flashBookSuccess, setFlashBookSuccess] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getHotel(id as string)
      .then((d) => {
        setHotel(d.hotel);
        if (dealRoomId && d.hotel?.rooms) {
          const room = d.hotel.rooms.find((r: any) => r.id === dealRoomId);
          if (room) setFlashAdults(room.capacity || 2);
        }
        if (directBook && dealId) setFlashBookOpen(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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
      if (bid.hotelId === id)
        setMyBids((prev) => prev.map((b) => b.id === bid.id ? { ...b, ...bid } : b));
    });
    return () => { socket.disconnect(); };
  }, [user, id]);

  // ── Flash deal calculations ────────────────────────
  const flashRoom      = hotel?.rooms?.find((r: any) => r.id === dealRoomId);
  const baseCapacity   = flashRoom?.capacity || 2;
  const flashNights    = Math.max(1, Math.ceil(
    (new Date(flashCheckOut).getTime() - new Date(today).getTime()) / 86400000
  ));
  const extraAdults        = Math.max(0, flashAdults - baseCapacity);
  const extraAdultRate     = 500;
  const childRate          = 200;
  const flashBaseTotal     = parseFloat(dealPrice || "0") * flashNights;
  const flashExtraTotal    = extraAdults * extraAdultRate * flashNights;
  const flashChildTotal    = flashChildren * childRate * flashNights;
  const flashGrandTotal    = flashBaseTotal + flashExtraTotal + flashChildTotal;

  // ── Flash deal booking ─────────────────────────────
  const handleFlashBook = async () => {
    if (!user) return router.push("/auth");
    setBookLoading(true);
    try {
      const reqRes = await api.createBidRequest?.({
        hotelId: hotel.id, roomId: dealRoomId,
        amount: parseFloat(dealPrice!),
        checkIn: today, checkOut: flashCheckOut,
        guests: flashAdults + flashChildren,
      });
      const bidRes = await api.placeBid({
        hotelId: hotel.id, roomId: dealRoomId!,
        amount: parseFloat(dealPrice!),
        message: `Flash Deal | ${flashNights} nights | ${flashAdults} adults | ${flashChildren} children | Total ₹${flashGrandTotal}`,
        requestId: reqRes?.request?.id,
        dealId: dealId,
      });
      const token = localStorage.getItem("sb_token");
      await fetch(`${API}/api/bids/${bidRes.bid.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      // Save dates locally so bookings page can show them even if backend doesn't return them
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({
        checkIn: today, checkOut: flashCheckOut,
      }));
      setFlashBookOpen(false);
      setFlashBookSuccess(true);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBookLoading(false);
    }
  };

  // ── Normal bid ─────────────────────────────────────
  const handleBid = async () => {
    if (!user) return router.push("/auth");
    if (!bidAmount || !bidRoom || !checkIn || !checkOut) return alert("Please fill all fields");
    setBidLoading(true);
    try {
      const reqRes = await api.createBidRequest?.({
        hotelId: hotel.id, roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        checkIn, checkOut, guests: bidRoom.capacity || 2,
      });
      await api.placeBid({
        hotelId: hotel.id, roomId: bidRoom.id,
        amount: parseFloat(bidAmount),
        message: bidMsg || undefined,
        requestId: reqRes?.request?.id,
      });
      setBidSuccess(true);
      setBidRoom(null);
      fetchMyBids();
    } catch (e: any) { alert(e.message); }
    finally { setBidLoading(false); }
  };

  const openBookNow = (r: any) => { setBnRoom(r); setBnAdults(r.capacity||2); setBnChildren(0); setBnIn(today); setBnOut(tomorrow); setBnSuccess(false); };
  const openNegotiate = (r: any) => { setNegRoom(r); setNegAmt(Math.round(r.floorPrice*0.88)); setNegIn(today); setNegOut(tomorrow); setNegSuccess(false); };

  const handleBookNow = async () => {
    if (!user) return router.push("/auth");
    if (!bnIn || !bnOut) return alert("Select dates");
    setBnLoading(true);
    try {
      const nights = Math.max(1, Math.ceil((new Date(bnOut).getTime()-new Date(bnIn).getTime())/86400000));
      const reqRes = await api.createBidRequest?.({ hotelId: hotel.id, roomId: bnRoom.id, amount: bnRoom.floorPrice, checkIn: bnIn, checkOut: bnOut, guests: bnAdults+bnChildren });
      const bidRes = await api.placeBid({ hotelId: hotel.id, roomId: bnRoom.id, amount: bnRoom.floorPrice, requestId: reqRes?.request?.id });
      const token = localStorage.getItem("sb_token");
      await fetch(`${API}/api/bids/${bidRes.bid.id}/accept`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` } });
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: bnIn, checkOut: bnOut }));
      setBnSuccess(true);
    } catch(e:any) { alert(e.message); }
    finally { setBnLoading(false); }
  };

  const handleNegotiate = async () => {
    if (!user) return router.push("/auth");
    if (!negIn || !negOut) return alert("Select dates");
    setNegLoading(true);
    try {
      const reqRes = await api.createBidRequest?.({ hotelId: hotel.id, roomId: negRoom.id, amount: negAmt, checkIn: negIn, checkOut: negOut, guests: negRoom.capacity||2 });
      const bidRes = await api.placeBid({ hotelId: hotel.id, roomId: negRoom.id, amount: negAmt, requestId: reqRes?.request?.id });
      localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn: negIn, checkOut: negOut }));
      const token = localStorage.getItem("sb_token");
      const aRes = await fetch(`${API}/api/bids/${bidRes.bid.id}/accept`, { method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` } });
      setNegAuto(aRes.ok);
      setNegSuccess(true);
      fetchMyBids();
    } catch(e:any) { alert(e.message); }
    finally { setNegLoading(false); }
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
    } catch (e: any) { alert(e.message); }
    finally { setActionLoading(""); }
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
    } catch (e: any) { alert(e.message); }
    finally { setActionLoading(""); }
  };

  const statusStyle = (s: string) => {
    switch (s) {
      case "PENDING":  return { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending"  };
      case "COUNTER":  return { bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200",  label: "Counter"  };
      case "ACCEPTED": return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Accepted" };
      case "REJECTED": return { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Rejected" };
      default:         return { bg: "bg-luxury-50",  text: "text-luxury-600",  border: "border-luxury-100",  label: s };
    }
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto px-5 py-10 space-y-5">
      <div className="h-72 shimmer rounded-3xl" />
      <div className="h-8 w-2/3 shimmer rounded-full" />
      <div className="h-4 w-1/3 shimmer rounded-full" />
    </div>
  );

  if (!hotel) return (
    <div className="text-center py-28 text-luxury-400">
      <div className="w-16 h-16 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-4">
        <span className="text-2xl">🏨</span>
      </div>
      <p className="text-lg font-semibold text-luxury-700 mb-1">Hotel not found</p>
      <Link href="/hotels" className="text-sm text-gold-500 hover:text-gold-600 transition-colors">← Back to hotels</Link>
    </div>
  );

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-5 py-10">

        {/* ── Flash Deal Banner ── */}
        {dealId && dealPrice && (
          <div className="mb-6 p-4 rounded-2xl border border-gold-300 bg-gradient-to-r from-gold-50 to-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-gold-600 uppercase tracking-widest">⚡ Flash Deal Active</p>
                <p className="text-sm text-luxury-700 mt-0.5">
                  {flashRoom?.name || "Room"} at{" "}
                  <span className="font-bold text-luxury-900 text-lg">₹{dealPrice}</span>/night
                  {dealDiscount && (
                    <span className="ml-2 px-2 py-0.5 bg-gold-500 text-white text-xs font-bold rounded-full">{dealDiscount}% OFF</span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => { if (!user) router.push("/auth"); else setFlashBookOpen(true); }}
              className="btn-luxury px-6 py-2.5 rounded-xl text-sm whitespace-nowrap shadow-gold"
            >
              Book This Flash Deal
            </button>
          </div>
        )}

        {/* ── Hero image ── */}
        <div className="h-72 md:h-96 rounded-3xl overflow-hidden bg-luxury-100 mb-8 relative shadow-luxury-lg">
          {hotel.images?.[0] ? (
            <img src={hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-7xl opacity-15">🏨</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          {hotel.trustBadge && (
            <span className="absolute top-4 left-4 badge-gold flex items-center gap-1">✓ Verified Stay</span>
          )}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h1 className="font-display font-light text-white text-3xl md:text-4xl leading-tight drop-shadow-lg">{hotel.name}</h1>
            <p className="text-white/70 text-sm mt-1 tracking-wide">{hotel.city}, {hotel.state}</p>
          </div>
        </div>

        {/* ── Hotel meta ── */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          {hotel.starRating && (
            <span className="text-gold-400 text-lg tracking-widest">{"★".repeat(hotel.starRating)}</span>
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
                <span key={a} className="px-3 py-1.5 bg-white border border-luxury-200 rounded-full text-sm text-luxury-600">{a}</span>
              ))}
            </div>
          </div>
        )}

        {/* ── Tabs ── */}
        <div className="flex gap-1 border-b border-luxury-200 mb-8">
          {["rooms","reviews","about"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold capitalize transition-all ${tab===t ? "text-gold-600 border-b-2 border-gold-500 -mb-px" : "text-luxury-400 hover:text-luxury-700"}`}>
              {t === "rooms" ? "🛏 Rooms" : t === "reviews" ? "★ Reviews" : "ℹ About"}
            </button>
          ))}
        </div>

        {/* ── REVIEWS TAB ── */}
        {tab === "reviews" && (
          <div className="space-y-4 mb-10">
            {(hotel.reviews?.length > 0 ? hotel.reviews : sampleReviews).map((r: any) => (
              <div key={r.id} className="card-luxury p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-luxury-900">{r.guestName || ("Guest " + (r.id||"").slice(0,4).toUpperCase())}</p>
                  <span className="text-gold-400 text-sm">{"★".repeat(r.rating||5)}</span>
                </div>
                <p className="text-luxury-600 text-sm italic leading-relaxed">"{r.comment}"</p>
                <p className="text-xs text-luxury-300 mt-3">{new Date(r.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── ABOUT TAB ── */}
        {tab === "about" && (
          <div className="mb-10 space-y-6">
            {hotel.description && <p className="text-luxury-600 leading-relaxed">{hotel.description}</p>}
            {hotel.amenities?.length > 0 && (
              <div>
                <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-3">Amenities</p>
                <div className="flex flex-wrap gap-2">
                  {hotel.amenities.map((a:string) => <span key={a} className="px-3 py-1.5 bg-white border border-luxury-200 rounded-full text-sm text-luxury-600">{a}</span>)}
                </div>
              </div>
            )}
            <div className="card-luxury p-4">
              <p className="text-xs font-bold text-luxury-400 uppercase tracking-widest mb-3">Location</p>
              <p className="text-luxury-800 font-medium mb-3">{hotel.city}, {hotel.state}</p>
              <a href={`https://maps.google.com/?q=${encodeURIComponent((hotel.name||"")+" "+hotel.city)}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-500 px-4 py-2 rounded-lg">
                🗺 Get Directions
              </a>
            </div>
          </div>
        )}

        {tab === "rooms" && <>

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
                      <span className={`px-3 py-1 rounded-full text-xs font-bold border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                    </div>
                    {b.status === "COUNTER" && (
                      <div className="mt-4 p-4 bg-orange-50 rounded-2xl border border-orange-200">
                        <p className="text-sm font-medium text-orange-800 mb-3">
                          Hotel countered at <span className="text-xl font-bold text-orange-700">₹{b.counterAmount}</span>
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => handleCounterAccept(b.id)} disabled={actionLoading === b.id}
                            className="flex-1 py-2.5 btn-luxury rounded-xl text-sm disabled:opacity-40">
                            {actionLoading === b.id ? "…" : `Accept ₹${b.counterAmount}`}
                          </button>
                          <button onClick={() => handleCounterReject(b.id)} disabled={actionLoading === b.id}
                            className="flex-1 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition border border-red-200 disabled:opacity-40">
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {b.status === "ACCEPTED" && (
                      <p className="mt-3 text-sm text-emerald-600 font-medium">✓ Booking confirmed at ₹{b.counterAmount || b.amount}</p>
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
          {hotel.rooms?.map((r: any) => {
            const isFlashRoom = dealRoomId === r.id && dealPrice;
            return (
              <div key={r.id}
                className={`rounded-3xl border overflow-hidden transition-all duration-300 ${
                  isFlashRoom ? "border-gold-400 bg-amber-50/40 shadow-gold"
                  : bidRoom?.id === r.id ? "border-gold-400 bg-gold-100/30 shadow-gold"
                  : "border-luxury-100 bg-white hover:border-luxury-200 hover:shadow-luxury"
                }`}
              >
                {r.images?.[0] && (
                  <img src={r.images[0]} alt={r.name} className="w-full h-52 object-cover" />
                )}
                <div className="p-5">
                  {isFlashRoom && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-xs font-bold text-gold-600 uppercase tracking-widest">Flash Deal Room</span>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-luxury-900">{r.name || r.type}</h3>
                      <p className="text-sm text-luxury-400 mt-0.5 tracking-wide">{r.type} · {r.capacity} guests</p>
                      {r.amenities?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {r.amenities.slice(0, 4).map((a: string) => (
                            <span key={a} className="text-xs px-2.5 py-0.5 bg-luxury-50 border border-luxury-100 rounded-full text-luxury-500">{a}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {isFlashRoom ? (
                        <>
                          <p className="text-xs font-bold text-gold-500 uppercase tracking-widest">Flash Price</p>
                          <p className="text-sm text-luxury-300 line-through">₹{r.floorPrice}</p>
                          <p className="text-2xl font-bold text-gold-600">₹{dealPrice}</p>
                          <p className="text-xs text-luxury-400 mb-3">/night · {dealDiscount}% off</p>
                          <button onClick={() => { if (!user) router.push("/auth"); else setFlashBookOpen(true); }}
                            className="btn-luxury px-5 py-2.5 rounded-xl text-sm shadow-gold">
                            ⚡ Book Flash Deal
                          </button>
                        </>
                      ) : (
                        <>
                          {/* OTA Comparison */}
                          {(r.mrp||r.floorPrice) && (() => {
                            const mrp = r.mrp || Math.round(r.floorPrice * 1.4);
                            const otas = [
                              { name:"MakeMyTrip", price: Math.round(mrp*0.87) },
                              { name:"Booking.com", price: Math.round(mrp*0.91) },
                              { name:"Goibibo",     price: Math.round(mrp*0.84) },
                              { name:"Agoda",       price: Math.round(mrp*0.89) },
                            ];
                            const bestOTA = Math.min(...otas.map(o=>o.price));
                            const saving = bestOTA - r.floorPrice;
                            return (
                              <div className="mb-4 p-3 bg-luxury-50 rounded-2xl border border-luxury-100 text-left">
                                <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest mb-2">Price Comparison</p>
                                <div className="space-y-1.5">
                                  {otas.map(o => (
                                    <div key={o.name} className="flex justify-between items-center text-xs">
                                      <span className="text-luxury-400">{o.name}</span>
                                      <span className="text-luxury-400 line-through">₹{o.price.toLocaleString()}</span>
                                    </div>
                                  ))}
                                  <div className="flex justify-between items-center px-3 py-2 bg-gold-500 rounded-xl mt-2">
                                    <span className="font-bold text-white text-xs">🏆 StayBid</span>
                                    <span className="font-bold text-white text-sm">₹{r.floorPrice.toLocaleString()}</span>
                                  </div>
                                  {saving > 0 && <p className="text-[0.65rem] text-emerald-600 font-semibold text-center">✓ Save ₹{saving.toLocaleString()} vs best OTA</p>}
                                </div>
                              </div>
                            );
                          })()}
                          <p className="text-2xl font-bold text-luxury-900">₹{r.floorPrice.toLocaleString()}</p>
                          <p className="text-xs text-luxury-400 mb-3">/night</p>
                          <div className="flex gap-2">
                            <button onClick={() => openBookNow(r)} className="btn-luxury px-4 py-2 rounded-xl text-sm">Book Now</button>
                            <button onClick={() => openNegotiate(r)} className="px-4 py-2 rounded-xl text-sm font-semibold border border-luxury-300 text-luxury-700 hover:border-gold-400 hover:text-gold-600 transition">🤝 Negotiate</button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        </> /* end rooms tab */}
      </div>

      {/* ══════════════════════════════════════════
          FLASH DEAL BOOKING MODAL
      ══════════════════════════════════════════ */}
      {flashBookOpen && dealPrice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFlashBookOpen(false)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-luxury-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}>
            {/* Gold header */}
            <div className="bg-gradient-to-r from-gold-600 to-gold-400 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/70 uppercase tracking-widest">⚡ Flash Deal Booking</p>
                <p className="text-white font-semibold text-lg">{flashRoom?.name || "Room"}</p>
                <p className="text-white/70 text-sm">{hotel.name}</p>
              </div>
              <button onClick={() => setFlashBookOpen(false)} className="text-white/70 hover:text-white text-2xl">✕</button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[70vh]">

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in (Today)</label>
                  <div className="input-luxury text-sm bg-luxury-50 text-luxury-400 cursor-not-allowed flex items-center gap-2">
                    🔒 {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                  <input
                    type="date"
                    value={flashCheckOut}
                    onChange={(e) => setFlashCheckOut(e.target.value)}
                    min={tomorrow}
                    className="input-luxury text-sm"
                  />
                </div>
              </div>

              {/* Guests */}
              <div className="mb-5">
                <label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-3">Guests</label>
                <div className="space-y-3">
                  {/* Adults */}
                  <div className="flex items-center justify-between p-3 bg-luxury-50 rounded-2xl">
                    <div>
                      <p className="text-sm font-semibold text-luxury-900">Adults</p>
                      <p className="text-xs text-luxury-400">
                        {baseCapacity} included · Extra ₹{extraAdultRate}/night each
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFlashAdults(Math.max(1, flashAdults - 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-luxury-900">{flashAdults}</span>
                      <button onClick={() => setFlashAdults(Math.min(8, flashAdults + 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        +
                      </button>
                    </div>
                  </div>

                  {/* Children */}
                  <div className="flex items-center justify-between p-3 bg-luxury-50 rounded-2xl">
                    <div>
                      <p className="text-sm font-semibold text-luxury-900">Children <span className="text-luxury-400 font-normal">(5–12 yrs)</span></p>
                      <p className="text-xs text-luxury-400">₹{childRate}/night each · Under 5 free</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFlashChildren(Math.max(0, flashChildren - 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        −
                      </button>
                      <span className="w-6 text-center font-bold text-luxury-900">{flashChildren}</span>
                      <button onClick={() => setFlashChildren(Math.min(6, flashChildren + 1))}
                        className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center text-luxury-600 hover:border-gold-400 hover:text-gold-600 transition font-bold text-lg">
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rate Breakdown */}
              <div className="bg-gold-50 border border-gold-200 rounded-2xl p-4 mb-5">
                <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-3">Rate Breakdown</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-luxury-700">
                    <span>₹{dealPrice} × {flashNights} night{flashNights > 1 ? "s" : ""}</span>
                    <span className="font-semibold">₹{flashBaseTotal.toLocaleString()}</span>
                  </div>
                  {extraAdults > 0 && (
                    <div className="flex justify-between text-luxury-700">
                      <span>{extraAdults} extra adult{extraAdults > 1 ? "s" : ""} × ₹{extraAdultRate} × {flashNights}n</span>
                      <span className="font-semibold">₹{flashExtraTotal.toLocaleString()}</span>
                    </div>
                  )}
                  {flashChildren > 0 && (
                    <div className="flex justify-between text-luxury-700">
                      <span>{flashChildren} child{flashChildren > 1 ? "ren" : ""} × ₹{childRate} × {flashNights}n</span>
                      <span className="font-semibold">₹{flashChildTotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="border-t border-gold-200 pt-2 mt-2 flex justify-between">
                    <span className="font-bold text-luxury-900">Total ({flashNights} night{flashNights > 1 ? "s" : ""})</span>
                    <span className="font-bold text-xl text-luxury-900">₹{flashGrandTotal.toLocaleString()}</span>
                  </div>
                  {dealDiscount && (
                    <p className="text-xs text-gold-600 font-medium text-right">{dealDiscount}% savings vs regular price</p>
                  )}
                </div>
              </div>

              <button
                onClick={handleFlashBook}
                disabled={bookLoading}
                className="btn-luxury w-full py-4 rounded-2xl text-base font-semibold shadow-gold disabled:opacity-40"
              >
                {bookLoading ? "Confirming…" : `Confirm Booking · ₹${flashGrandTotal.toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ BOOK NOW MODAL ══ */}
      {bnRoom && !bnSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBnRoom(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-luxury-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-luxury-900 to-luxury-800 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">Instant Booking</p>
                <p className="text-white font-semibold text-lg">{bnRoom.name||bnRoom.type}</p>
                <p className="text-white/60 text-sm">{hotel.name}</p>
              </div>
              <button onClick={() => setBnRoom(null)} className="text-white/60 hover:text-white text-2xl">✕</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in</label>
                  <input type="date" value={bnIn} min={today} onChange={e=>setBnIn(e.target.value)} className="input-luxury text-sm"/></div>
                <div><label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                  <input type="date" value={bnOut} min={bnIn} onChange={e=>setBnOut(e.target.value)} className="input-luxury text-sm"/></div>
              </div>
              <div className="space-y-3">
                {[["Adults", bnAdults, setBnAdults, 1, 8],["Children (5-12)", bnChildren, setBnChildren, 0, 6]].map(([label, val, setter, mn, mx]: any) => (
                  <div key={label as string} className="flex items-center justify-between p-3 bg-luxury-50 rounded-2xl">
                    <p className="text-sm font-semibold text-luxury-900">{label as string}</p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setter(Math.max(mn, val-1))} className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center font-bold text-luxury-600 hover:border-gold-400">−</button>
                      <span className="w-5 text-center font-bold">{val}</span>
                      <button onClick={() => setter(Math.min(mx, val+1))} className="w-8 h-8 rounded-full border border-luxury-200 flex items-center justify-center font-bold text-luxury-600 hover:border-gold-400">+</button>
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const nights = Math.max(1, Math.ceil((new Date(bnOut).getTime()-new Date(bnIn).getTime())/86400000));
                const extra = Math.max(0, bnAdults-(bnRoom.capacity||2));
                const total = bnRoom.floorPrice*nights + extra*500*nights + bnChildren*200*nights;
                return (
                  <div className="bg-gold-50 border border-gold-200 rounded-2xl p-4">
                    <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-3">Rate Breakdown</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between text-luxury-700"><span>₹{bnRoom.floorPrice.toLocaleString()} × {nights} night{nights>1?"s":""}</span><span className="font-semibold">₹{(bnRoom.floorPrice*nights).toLocaleString()}</span></div>
                      {extra > 0 && <div className="flex justify-between text-luxury-700"><span>{extra} extra adult{extra>1?"s":""} × ₹500 × {nights}n</span><span className="font-semibold">₹{(extra*500*nights).toLocaleString()}</span></div>}
                      {bnChildren > 0 && <div className="flex justify-between text-luxury-700"><span>{bnChildren} child{bnChildren>1?"ren":""} × ₹200 × {nights}n</span><span className="font-semibold">₹{(bnChildren*200*nights).toLocaleString()}</span></div>}
                      <div className="border-t border-gold-200 pt-2 mt-2 flex justify-between font-bold text-luxury-900"><span>Total</span><span className="text-xl">₹{total.toLocaleString()}</span></div>
                    </div>
                  </div>
                );
              })()}
              <button onClick={handleBookNow} disabled={bnLoading} className="btn-luxury w-full py-4 rounded-2xl text-base font-semibold shadow-gold disabled:opacity-40">
                {bnLoading ? "Confirming…" : "Confirm Booking"}
              </button>
            </div>
          </div>
        </div>
      )}
      {bnSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBnRoom(null)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5"><span className="text-3xl">🎉</span></div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Booking Confirmed!</h3>
            <p className="text-luxury-400 text-sm mb-6">Your booking at <span className="font-semibold text-luxury-700">{hotel.name}</span> is confirmed.</p>
            <div className="flex gap-3">
              <button onClick={() => setBnRoom(null)} className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm">Close</button>
              <Link href="/bookings" className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">My Bookings</Link>
            </div>
          </div>
        </div>
      )}

      {/* ══ NEGOTIATE MODAL ══ */}
      {negRoom && !negSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNegRoom(null)}>
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-luxury-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-luxury-900 to-luxury-800 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/60 uppercase tracking-widest">🤝 Negotiate Your Price</p>
                <p className="text-white font-semibold text-lg">{negRoom.name||negRoom.type}</p>
              </div>
              <button onClick={() => setNegRoom(null)} className="text-white/60 hover:text-white text-2xl">✕</button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
              <style>{`.neg-slider{accent-color:var(--sc,#d97706)}.neg-slider::-webkit-slider-thumb{background:var(--sc,#d97706)}`}</style>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in</label>
                  <input type="date" value={negIn} min={today} onChange={e=>setNegIn(e.target.value)} className="input-luxury text-sm"/></div>
                <div><label className="text-xs font-bold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                  <input type="date" value={negOut} min={negIn} onChange={e=>setNegOut(e.target.value)} className="input-luxury text-sm"/></div>
              </div>

              {/* AI Pricing — only after dates selected */}
              {negIn && negOut && negIn < negOut ? (() => {
                const prob = bidProb(negAmt, negRoom.floorPrice);
                const min = Math.round(negRoom.floorPrice * 0.65);
                const max = Math.round(negRoom.floorPrice * 1.05);
                const nights = Math.max(1, Math.ceil((new Date(negOut).getTime()-new Date(negIn).getTime())/86400000));
                const totalBid = negAmt * nights;
                return (
                  <div className={`rounded-2xl border-2 p-5 transition-all duration-300 ${prob.bg}`} style={{ borderColor: prob.track }}>
                    <p className="text-xs font-bold text-luxury-500 uppercase tracking-widest mb-4">AI Smart Pricing</p>

                    {/* Per-night + total */}
                    <div className="text-center mb-1">
                      <p className="text-4xl font-bold text-luxury-900">₹{negAmt.toLocaleString()}</p>
                      <p className="text-xs text-luxury-400 mt-0.5">per night</p>
                    </div>
                    <div className="flex items-center justify-center gap-2 mb-4 text-sm text-luxury-600">
                      <span>₹{negAmt.toLocaleString()} × {nights} night{nights>1?"s":""}</span>
                      <span>=</span>
                      <span className="font-bold text-luxury-900 text-base">₹{totalBid.toLocaleString()}</span>
                    </div>

                    {/* Slider */}
                    <input type="range" min={min} max={max} step={50} value={negAmt}
                      onChange={e => setNegAmt(Number(e.target.value))}
                      className="neg-slider w-full h-2 rounded-full cursor-pointer mb-5"
                      style={{ "--sc": prob.track } as any} />

                    {/* Probability bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-luxury-400 mb-1.5">
                        <span>Acceptance probability</span>
                        <span className={`font-bold text-sm ${prob.color}`}>{prob.p}%</span>
                      </div>
                      <div className="h-3 bg-white/60 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width:`${prob.p}%`, background: prob.track }} />
                      </div>
                    </div>

                    {/* Label + cashback badge */}
                    <div className="flex items-center justify-between mt-3">
                      <p className={`text-base font-bold ${prob.color} transition-colors duration-300`}>{prob.label}</p>
                      {prob.badge && (
                        <span className="text-[0.65rem] font-bold px-2 py-1 rounded-full bg-white/70 border" style={{ borderColor: prob.track, color: prob.track }}>
                          {prob.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.65rem] text-luxury-400 text-center mt-1.5">AI analyses hotel patterns to predict acceptance</p>
                  </div>
                );
              })() : (
                <div className="rounded-2xl border border-dashed border-luxury-200 p-6 text-center text-luxury-400 text-sm">
                  Select check-in & check-out dates to see AI pricing
                </div>
              )}

              <button onClick={handleNegotiate} disabled={negLoading || !negIn || !negOut || negIn >= negOut}
                className="btn-luxury w-full py-4 rounded-2xl text-base font-semibold shadow-gold disabled:opacity-40">
                {negLoading ? "Submitting…" : `Submit Bid · ₹${negAmt.toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {negSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNegRoom(null)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5"><span className="text-3xl">{negAuto ? "🎉" : "✅"}</span></div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">{negAuto ? "Booking Confirmed!" : "Bid Submitted!"}</h3>
            <p className="text-luxury-400 text-sm mb-6">{negAuto ? "Your bid was auto-accepted! Check My Bookings." : "The hotel will review your offer and respond soon. You'll be notified."}</p>
            <div className="flex gap-3">
              <button onClick={() => setNegRoom(null)} className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm">Close</button>
              <Link href={negAuto ? "/bookings" : "/my-bids"} className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">{negAuto ? "My Bookings" : "My Bids"}</Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          FLASH BOOKING SUCCESS
      ══════════════════════════════════════════ */}
      {flashBookSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFlashBookSuccess(false)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Booking Confirmed!</h3>
            <p className="text-luxury-400 text-sm leading-relaxed mb-2">
              Your flash deal booking at <span className="font-semibold text-luxury-700">{hotel.name}</span> is confirmed.
            </p>
            <p className="text-gold-600 font-bold text-lg mb-6">₹{flashGrandTotal.toLocaleString()} · {flashNights} night{flashNights > 1 ? "s" : ""}</p>
            <div className="flex gap-3">
              <button onClick={() => setFlashBookSuccess(false)}
                className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 text-sm font-medium">
                Close
              </button>
              <Link href="/bookings" className="flex-1 py-3 rounded-2xl btn-luxury text-sm text-center">
                My Bookings
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          NORMAL BID MODAL
      ══════════════════════════════════════════ */}
      {bidRoom && !bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidRoom(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-luxury-lg p-6"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gradient-to-r from-gold-500 to-gold-300 rounded-full mx-auto mb-6" />
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-1">Place Your Bid</h3>
            <p className="text-sm text-luxury-400 mb-6">
              {bidRoom.name || bidRoom.type} at <span className="text-luxury-700 font-medium">{hotel.name}</span>
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-in</label>
                <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)}
                  min={today} className="input-luxury text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Check-out</label>
                <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)}
                  min={checkIn || today} className="input-luxury text-sm" />
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Your Bid Amount (₹)</label>
              <input type="number" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)}
                placeholder={`Floor ₹${bidRoom.floorPrice} — MRP ₹${bidRoom.mrp}`}
                className="input-luxury text-lg font-bold" />
              {bidAmount && parseFloat(bidAmount) < bidRoom.floorPrice && (
                <p className="text-xs text-red-500 mt-1.5">Minimum bid is ₹{bidRoom.floorPrice}</p>
              )}
            </div>
            <div className="mb-6">
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Message (optional)</label>
              <textarea value={bidMsg} onChange={(e) => setBidMsg(e.target.value)}
                placeholder="e.g. Anniversary trip, need the best deal…"
                className="input-luxury text-sm resize-none" rows={2} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBidRoom(null)}
                className="flex-1 py-3 rounded-2xl border border-luxury-200 text-luxury-600 font-medium hover:bg-luxury-50 transition text-sm">
                Cancel
              </button>
              <button onClick={handleBid}
                disabled={bidLoading || !bidAmount || !checkIn || !checkOut || parseFloat(bidAmount) < bidRoom.floorPrice}
                className="flex-1 py-3 rounded-2xl btn-luxury disabled:opacity-40 text-sm">
                {bidLoading ? "Submitting…" : "Submit Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bidSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBidSuccess(false)}>
          <div className="bg-white max-w-sm w-full mx-4 rounded-3xl shadow-luxury-lg p-8 text-center"
            onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-5">
              <span className="text-3xl">🎉</span>
            </div>
            <h3 className="font-display font-light text-luxury-900 text-2xl mb-2">Bid Placed!</h3>
            <p className="text-luxury-400 text-sm leading-relaxed mb-6">
              The hotel will review your offer and respond soon.
            </p>
            <button onClick={() => setBidSuccess(false)} className="btn-luxury w-full py-3 rounded-2xl text-sm">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
