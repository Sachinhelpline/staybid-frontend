"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const statusColors: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-green-100 text-green-800",
  CHECKED_IN: "bg-blue-100 text-blue-800",
  CHECKED_OUT: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-red-100 text-red-600",
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
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      {[1, 2, 3].map((i) => <div key={i} className="h-32 shimmer rounded-2xl" />)}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">My Bookings</h1>

      {bookings.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <span className="text-5xl mb-4 block">📋</span>
          <p className="text-lg font-medium">No bookings yet</p>
          <p className="text-sm">Start by placing a bid or booking a flash deal</p>
        </div>
      )}

      <div className="space-y-4">
        {bookings.map((b: any) => (
          <div key={b.id} className="bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-sm transition">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-lg">{b.hotel?.name || "Hotel"}</h3>
                <p className="text-sm text-gray-500">{b.room?.type || "Room"} · {b.guests} guests</p>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${statusColors[b.status] || "bg-gray-100"}`}>
                {b.status}
              </span>
            </div>

            <div className="flex gap-6 text-sm text-gray-600 mb-3">
              <div>
                <span className="text-gray-400 text-xs block">Check-in</span>
                {new Date(b.checkIn).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </div>
              <div>
                <span className="text-gray-400 text-xs block">Check-out</span>
                {new Date(b.checkOut).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </div>
              <div>
                <span className="text-gray-400 text-xs block">Amount</span>
                <span className="font-bold text-brand-700">₹{b.totalAmount}</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Booked {new Date(b.createdAt).toLocaleDateString()}</span>
              <span className="uppercase">{b.paymentMode}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
