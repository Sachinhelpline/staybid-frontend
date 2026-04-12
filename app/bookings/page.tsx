"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const statusStyle: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING:    { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Pending"     },
  CONFIRMED:  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Confirmed"   },
  CHECKED_IN: { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200",    label: "Checked In"  },
  CHECKED_OUT:{ bg: "bg-luxury-50",  text: "text-luxury-600",  border: "border-luxury-200",  label: "Checked Out" },
  CANCELLED:  { bg: "bg-red-50",     text: "text-red-600",     border: "border-red-200",     label: "Cancelled"   },
};

export default function BookingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    api.getMyBookings()
      .then((d) => setBookings(d.bookings || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

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
          <h1 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            My Bookings
          </h1>
        </div>

        {/* Empty state */}
        {bookings.length === 0 && (
          <div className="text-center py-24">
            <div className="w-20 h-20 rounded-full bg-white border border-luxury-100 flex items-center justify-center mx-auto mb-5 shadow-luxury">
              <span className="text-3xl">📋</span>
            </div>
            <p className="text-lg font-semibold text-luxury-800 mb-1">No bookings yet</p>
            <p className="text-sm text-luxury-400 mb-6">Start by placing a bid or booking a flash deal.</p>
          </div>
        )}

        {/* Booking cards */}
        <div className="space-y-4">
          {bookings.map((b: any) => {
            const st = statusStyle[b.status] || { bg: "bg-luxury-50", text: "text-luxury-600", border: "border-luxury-100", label: b.status };
            return (
              <div key={b.id} className="card-luxury p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-luxury-900 text-[1.05rem] leading-snug">{b.hotel?.name || "Hotel"}</h3>
                    <p className="text-sm text-luxury-400 mt-0.5">{b.room?.type || "Room"} · {b.guests} guest{b.guests !== 1 ? "s" : ""}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${st.bg} ${st.text} ${st.border} shrink-0`}>
                    {st.label}
                  </span>
                </div>

                {/* Dates & amount */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-[0.65rem] text-luxury-300 uppercase tracking-wider mb-1">Check-in</p>
                    <p className="text-sm font-medium text-luxury-700">
                      {new Date(b.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.65rem] text-luxury-300 uppercase tracking-wider mb-1">Check-out</p>
                    <p className="text-sm font-medium text-luxury-700">
                      {new Date(b.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.65rem] text-luxury-300 uppercase tracking-wider mb-1">Amount</p>
                    <p className="text-sm font-bold text-gold-600">₹{b.totalAmount}</p>
                  </div>
                </div>

                {/* Footer */}
                <div className="divider-gold mb-3" />
                <div className="flex items-center justify-between text-xs text-luxury-300 tracking-wide">
                  <span>Booked {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className="uppercase">{b.paymentMode}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
