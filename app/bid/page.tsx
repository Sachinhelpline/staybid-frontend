"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function BidPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [form, setForm] = useState({ city: "", checkIn: "", checkOut: "", guests: "2", maxBudget: "", requirements: "" });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!user) return router.push("/auth");
    if (!form.city || !form.checkIn || !form.checkOut || !form.maxBudget) return alert("Fill all required fields");
    setLoading(true);
    try {
      await api.createBidRequest({
        city: form.city,
        checkIn: new Date(form.checkIn).toISOString(),
        checkOut: new Date(form.checkOut).toISOString(),
        guests: parseInt(form.guests),
        maxBudget: parseFloat(form.maxBudget),
        requirements: form.requirements || undefined,
      });
      setSuccess(true);
    } catch (e: any) { alert(e.message); }
    finally { setLoading(false); }
  };

  if (success) return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <span className="text-6xl mb-4 block">🎯</span>
        <h1 className="font-display text-3xl mb-2">Bid Request Sent!</h1>
        <p className="text-gray-500 mb-6">Hotels in {form.city} will start bidding for your stay. You&apos;ll get notified when offers come in.</p>
        <button onClick={() => router.push("/hotels")} className="px-6 py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition">Browse Hotels</button>
      </div>
    </div>
  );

  const cities = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="font-display text-3xl mb-2">Name Your Price</h1>
      <p className="text-gray-500 mb-8">Tell us where you want to stay and your budget. Hotels will compete for your booking.</p>

      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-5">
        <div>
          <label className="text-sm font-medium text-gray-600 block mb-2">Destination *</label>
          <div className="flex flex-wrap gap-2">
            {cities.map((c) => (
              <button key={c} onClick={() => update("city", c)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${form.city === c ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-600 block mb-1">Check-in *</label>
            <input type="date" value={form.checkIn} onChange={(e) => update("checkIn", e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600 block mb-1">Check-out *</label>
            <input type="date" value={form.checkOut} onChange={(e) => update("checkOut", e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600 block mb-1">Guests</label>
          <select value={form.guests} onChange={(e) => update("guests", e.target.value)}
            className="w-full px-3 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm">
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? "Guest" : "Guests"}</option>)}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600 block mb-1">Max Budget (₹ per night) *</label>
          <input type="number" value={form.maxBudget} onChange={(e) => update("maxBudget", e.target.value)}
            placeholder="e.g. 2000"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-lg font-bold" />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600 block mb-1">Special Requirements</label>
          <textarea value={form.requirements} onChange={(e) => update("requirements", e.target.value)}
            placeholder="Mountain view, quiet room, near mall road..."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm" rows={3} />
        </div>

        <button onClick={submit} disabled={loading}
          className="w-full py-4 bg-brand-600 text-white rounded-xl font-bold text-lg hover:bg-brand-700 transition disabled:opacity-40">
          {loading ? "Submitting..." : "Submit Bid Request"}
        </button>
      </div>
    </div>
  );
}
