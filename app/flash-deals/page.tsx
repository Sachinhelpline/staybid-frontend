"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function FlashDealsPage() {
  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("");

  useEffect(() => {
    setLoading(true);
    api.getFlashDeals(city || undefined)
      .then((d) => setDeals(d.deals || []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [city]);

  const cities = ["All", "Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali"];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
        <h1 className="font-display text-3xl">Flash Deals</h1>
      </div>
      <p className="text-gray-500 mb-6">Limited-time AI-powered deals. Book before they expire!</p>

      <div className="flex flex-wrap gap-2 mb-8">
        {cities.map((c) => (
          <button key={c} onClick={() => setCity(c === "All" ? "" : c)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition ${
              (c === "All" && !city) || c === city ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {c}
          </button>
        ))}
      </div>

      {loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 shimmer rounded-2xl" />)}
        </div>
      )}

      {!loading && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {deals.map((d: any) => {
            const expires = new Date(d.validUntil);
            const left = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 3600000));
            return (
              <div key={d.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg transition group">
                <div className="h-3 bg-gradient-to-r from-red-500 to-orange-400" />
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-white bg-red-500 px-2 py-0.5 rounded-full">{d.discount}% OFF</span>
                    <span className="text-xs text-gray-400">{left}h left</span>
                  </div>
                  <h3 className="font-bold text-lg mb-1">{d.hotel?.name || "Hotel"}</h3>
                  <p className="text-sm text-gray-500 mb-1">{d.room?.type} · {d.city}</p>
                  <p className="text-xs text-gray-400 mb-4">{d.bookingCount}/{d.maxBookings} booked</p>

                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-sm text-gray-400 line-through">₹{d.floorPrice}</span>
                      <span className="text-3xl font-bold text-brand-700 ml-2">₹{d.aiPrice}</span>
                      <span className="text-xs text-gray-400">/night</span>
                    </div>
                    <Link href={`/hotels/${d.hotelId}`}
                      className="px-4 py-2 bg-brand-600 text-white text-sm font-bold rounded-xl hover:bg-brand-700 transition">
                      Book Now
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && deals.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <span className="text-5xl mb-4 block">⚡</span>
          <p className="text-lg font-medium">No flash deals right now</p>
          <p className="text-sm">Check back later for AI-powered offers</p>
        </div>
      )}
    </div>
  );
}
