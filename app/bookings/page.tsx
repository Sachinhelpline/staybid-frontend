"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const statusStyle: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  PENDING:    { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending",    dot: "bg-amber-400"   },
  CONFIRMED:  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Confirmed",  dot: "bg-emerald-400" },
  ACCEPTED:   { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Confirmed",  dot: "bg-emerald-400" },
  CHECKED_IN: { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Checked In", dot: "bg-blue-400"    },
  CHECKED_OUT:{ bg: "bg-luxury-50",  text: "text-luxury-600",  border: "border-luxury-200",  label: "Checked Out",dot: "bg-luxury-400"  },
  CANCELLED:  { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Cancelled",  dot: "bg-red-400"     },
};

function BookingCard({ b }: { b: any }) {
  const [expanded, setExpanded] = useState(false);
  const st = statusStyle[b.status] || { bg: "bg-luxury-50", text: "text-luxury-600", border: "border-luxury-100", label: b.status, dot: "bg-luxury-400" };

  const bookingId = b.id?.slice(0, 8).toUpperCase() || "—";
  const checkIn   = b.checkIn  ? new Date(b.checkIn)  : null;
  const checkOut  = b.checkOut ? new Date(b.checkOut) : null;
  const nights    = checkIn && checkOut
    ? Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / 86400000))
    : 1;
  const fmtDate   = (d: Date | null) => d
    ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "—";

  const hotel   = b.hotel  || {};
  const room    = b.room   || {};
  const phone   = hotel.phone   || hotel.contact || hotel.phoneNumber || null;
  const address = hotel.address || hotel.location || hotel.city || null;
  const city    = hotel.city    || b.city || null;
  const email   = hotel.email   || null;
  const stars   = hotel.starRating || hotel.stars || null;
  const perNight = b.totalAmount ? Math.round(b.totalAmount / nights) : b.totalAmount;

  return (
    <div className="card-luxury overflow-hidden">
      {/* Top gold stripe */}
      <div className="h-[3px] bg-gradient-to-r from-gold-500 via-amber-300 to-gold-500" />

      <div className="p-5">
        {/* ── Row 1: hotel name + status badge ── */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-luxury-900 text-[1.1rem] leading-snug truncate">
              {hotel.name || "Hotel"}
            </h3>
            {stars && (
              <p className="text-gold-500 text-xs tracking-widest mt-0.5">
                {"★".repeat(Math.min(5, stars))}
              </p>
            )}
          </div>
          <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border shrink-0 ${st.bg} ${st.text} ${st.border}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${b.status === "CONFIRMED" || b.status === "ACCEPTED" ? "animate-pulse" : ""}`} />
            {st.label}
          </span>
        </div>

        {/* Room type + city */}
        <p className="text-sm text-luxury-400 mb-4">
          {room.type || "Room"}
          {city ? ` · ${city}` : ""}
          {b.guests ? ` · ${b.guests} guest${b.guests !== 1 ? "s" : ""}` : ""}
        </p>

        {/* ── Booking ID strip ── */}
        <div className="flex items-center justify-between bg-luxury-50 border border-luxury-100 rounded-xl px-4 py-2.5 mb-4">
          <div>
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-0.5">Booking ID</p>
            <p className="font-mono font-bold text-luxury-800 text-sm tracking-widest">#{bookingId}</p>
          </div>
          <div className="text-right">
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-0.5">Type</p>
            <p className="text-xs font-semibold text-luxury-700 uppercase tracking-wide">{b.paymentMode || "BID BOOKING"}</p>
          </div>
        </div>

        {/* ── Dates ── */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-luxury-50 rounded-xl p-3 border border-luxury-100">
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Check-in</p>
            <p className="text-sm font-semibold text-luxury-800 leading-snug">{fmtDate(checkIn)}</p>
            <p className="text-[0.65rem] text-luxury-400 mt-0.5">From 12:00 PM</p>
          </div>
          <div className="bg-luxury-50 rounded-xl p-3 border border-luxury-100">
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-1">Check-out</p>
            <p className="text-sm font-semibold text-luxury-800 leading-snug">{fmtDate(checkOut)}</p>
            <p className="text-[0.65rem] text-luxury-400 mt-0.5">By 11:00 AM</p>
          </div>
        </div>

        {/* ── Amount ── */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <p className="text-[0.6rem] text-luxury-400 uppercase tracking-widest mb-0.5">{nights} Night{nights !== 1 ? "s" : ""}</p>
            <p className="text-2xl font-bold text-luxury-900">₹{(b.totalAmount || 0).toLocaleString()}</p>
            {nights > 1 && <p className="text-xs text-luxury-400">₹{perNight?.toLocaleString()}/night</p>}
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-500 to-amber-600 flex items-center justify-center shadow-gold">
            <span className="text-white font-bold text-lg">{nights}N</span>
          </div>
        </div>

        {/* ── Expand toggle ── */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-xs text-luxury-400 hover:text-luxury-700 transition-colors pt-3 border-t border-luxury-100"
        >
          <span className="font-medium uppercase tracking-widest">{expanded ? "Hide Details" : "View Hotel Details"}</span>
          <span className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>▼</span>
        </button>

        {/* ── Expanded hotel details ── */}
        {expanded && (
          <div className="mt-4 space-y-3 border-t border-luxury-100 pt-4">

            {/* Location */}
            {(address || city) && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0">
                  <span className="text-sm">📍</span>
                </div>
                <div>
                  <p className="text-[0.65rem] text-luxury-400 uppercase tracking-widest mb-0.5">Location</p>
                  <p className="text-sm text-luxury-800 font-medium">{[address, city].filter(Boolean).join(", ")}</p>
                </div>
              </div>
            )}

            {/* Phone */}
            {phone && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0">
                  <span className="text-sm">📞</span>
                </div>
                <div>
                  <p className="text-[0.65rem] text-luxury-400 uppercase tracking-widest mb-0.5">Hotel Contact</p>
                  <a href={`tel:${phone}`} className="text-sm text-gold-600 font-semibold hover:underline">{phone}</a>
                </div>
              </div>
            )}

            {/* Email */}
            {email && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0">
                  <span className="text-sm">✉️</span>
                </div>
                <div>
                  <p className="text-[0.65rem] text-luxury-400 uppercase tracking-widest mb-0.5">Email</p>
                  <a href={`mailto:${email}`} className="text-sm text-gold-600 font-semibold hover:underline">{email}</a>
                </div>
              </div>
            )}

            {/* Room details */}
            {room.type && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0">
                  <span className="text-sm">🛏</span>
                </div>
                <div>
                  <p className="text-[0.65rem] text-luxury-400 uppercase tracking-widest mb-0.5">Room</p>
                  <p className="text-sm text-luxury-800 font-medium">{room.type}{room.capacity ? ` · Up to ${room.capacity} guests` : ""}</p>
                </div>
              </div>
            )}

            {/* Booked on */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gold-50 border border-gold-200 flex items-center justify-center shrink-0">
                <span className="text-sm">🗓</span>
              </div>
              <div>
                <p className="text-[0.65rem] text-luxury-400 uppercase tracking-widest mb-0.5">Booked On</p>
                <p className="text-sm text-luxury-800 font-medium">
                  {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
            </div>

            {/* No phone/address placeholder */}
            {!phone && !address && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                Hotel contact details will be shared via SMS/email before check-in.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }

    Promise.all([
      api.getMyBookings().catch(() => ({ bookings: [] })),
      api.getMyBids().catch(() => ({ bids: [] })),
    ]).then(([bookData, bidData]) => {
      const fromBookings = (bookData.bookings || []).map((b: any) => ({ ...b, _source: "booking" }));
      const fromBids = (bidData.bids || [])
        .filter((b: any) => b.status === "ACCEPTED" || b.status === "CONFIRMED")
        .map((b: any) => ({
          id: b.id,
          status: b.status,
          checkIn:  b.request?.checkIn  || b.checkIn,
          checkOut: b.request?.checkOut || b.checkOut,
          guests:   b.request?.guests   || b.guests || 2,
          totalAmount: b.amount,
          hotel: b.hotel,
          room:  b.room,
          city:  b.hotel?.city || b.city,
          createdAt: b.createdAt,
          paymentMode: "FLASH DEAL",
          _source: "bid",
        }));

      const seen = new Set();
      const merged = [...fromBookings, ...fromBids].filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBookings(merged);
    }).finally(() => setLoading(false));
  }, [user, authLoading, router]);

  if (authLoading || loading) return (
    <div className="max-w-2xl mx-auto px-5 py-12 space-y-4">
      {[1, 2, 3].map((i) => <div key={i} className="h-48 shimmer rounded-3xl" />)}
    </div>
  );

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-2xl mx-auto px-5 py-12">

        <div className="mb-8">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-2">Account</p>
          <h1 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            My Bookings
          </h1>
          {bookings.length > 0 && (
            <p className="text-sm text-luxury-400 mt-1">{bookings.length} booking{bookings.length !== 1 ? "s" : ""}</p>
          )}
        </div>

        {bookings.length === 0 && (
          <div className="text-center py-24">
            <div className="w-20 h-20 rounded-full bg-white border border-luxury-100 flex items-center justify-center mx-auto mb-5 shadow-luxury">
              <span className="text-3xl">📋</span>
            </div>
            <p className="text-lg font-semibold text-luxury-800 mb-1">No bookings yet</p>
            <p className="text-sm text-luxury-400 mb-6">Start by placing a bid or booking a flash deal.</p>
          </div>
        )}

        <div className="space-y-5">
          {bookings.map((b) => <BookingCard key={b.id} b={b} />)}
        </div>
      </div>
    </div>
  );
}
