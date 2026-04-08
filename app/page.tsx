"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function Home() {
  const [city, setCity] = useState("");
  const [deals, setDeals] = useState<any[]>([]);

  useEffect(() => {
    api.getFlashDeals().then((d) => setDeals(d.deals?.slice(0, 3) || [])).catch(() => {});
  }, []);

  const cities = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-emerald-600 text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
        <div className="relative max-w-6xl mx-auto px-4 py-20 md:py-32">
          <p className="text-brand-100 font-medium text-sm tracking-widest uppercase mb-4">India&apos;s First Reverse-Auction Hotel Platform</p>
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl leading-tight mb-6">
            Name Your Price.<br />Hotels Compete.
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-lg mb-10">
            Bid on premium mountain stays at prices you choose. Off-season deals you won&apos;t find anywhere else.
          </p>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-xl">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Where do you want to go?"
              className="flex-1 px-5 py-4 rounded-2xl text-gray-900 bg-white/95 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-400 text-base"
            />
            <Link
              href={`/hotels${city ? `?city=${city}` : ""}`}
              className="px-8 py-4 bg-accent-500 hover:bg-accent-400 text-brand-900 font-bold rounded-2xl transition text-center whitespace-nowrap"
            >
              Search Hotels
            </Link>
          </div>

          {/* Quick city chips */}
          <div className="flex flex-wrap gap-2 mt-6">
            {cities.map((c) => (
              <Link key={c} href={`/hotels?city=${c}`} className="px-4 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-sm transition border border-white/20">
                {c}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="font-display text-3xl text-center mb-12">How StayBid Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: "🔍", title: "1. Search & Browse", desc: "Find hotels in your destination. Check rooms, amenities, and ratings." },
            { icon: "💰", title: "2. Name Your Price", desc: "Place a bid with your budget. Hotels see it and compete for your booking." },
            { icon: "✅", title: "3. Book & Save", desc: "Accept the best offer. Pay securely via Razorpay. Save up to 40% off MRP." },
          ].map((s) => (
            <div key={s.title} className="text-center p-8 rounded-3xl bg-white border border-gray-100 hover:shadow-lg transition">
              <span className="text-4xl mb-4 block">{s.icon}</span>
              <h3 className="font-bold text-lg mb-2">{s.title}</h3>
              <p className="text-gray-500 text-sm">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Flash Deals Preview */}
      {deals.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-display text-3xl">
              <span className="inline-block w-3 h-3 bg-red-500 rounded-full animate-pulse mr-2" />
              Flash Deals
            </h2>
            <Link href="/flash-deals" className="text-brand-600 font-medium text-sm hover:underline">View All →</Link>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {deals.map((d: any) => (
              <div key={d.id} className="rounded-2xl bg-white border border-gray-100 overflow-hidden hover:shadow-lg transition">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white bg-red-500 px-2 py-0.5 rounded-full">{d.discount}% OFF</span>
                    <span className="text-xs text-gray-400">{d.city}</span>
                  </div>
                  <h3 className="font-bold text-lg mb-1">{d.hotel?.name || "Hotel"}</h3>
                  <p className="text-sm text-gray-500 mb-3">{d.room?.type} Room</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-brand-700">₹{d.aiPrice}</span>
                    <span className="text-sm text-gray-400 line-through">₹{d.floorPrice}</span>
                    <span className="text-xs text-gray-400">/night</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t mt-16 py-10 text-center text-sm text-gray-400">
        <p>© 2026 StayBid. Made in India with ❤️</p>
      </footer>
    </div>
  );
}
