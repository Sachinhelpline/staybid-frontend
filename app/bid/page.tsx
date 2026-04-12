"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function BidPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [form, setForm] = useState({
    city: "", checkIn: "", checkOut: "", guests: "2", maxBudget: "", requirements: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!user) return router.push("/auth");
    if (!form.city || !form.checkIn || !form.checkOut || !form.maxBudget)
      return alert("Please fill all required fields");
    setLoading(true);
    try {
      await api.createBidRequest({
        city:         form.city,
        checkIn:      new Date(form.checkIn).toISOString(),
        checkOut:     new Date(form.checkOut).toISOString(),
        guests:       parseInt(form.guests),
        maxBudget:    parseFloat(form.maxBudget),
        requirements: form.requirements || undefined,
      });
      setSuccess(true);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const cities = ["Mussoorie", "Dhanaulti", "Rishikesh", "Shimla", "Manali", "Dehradun"];

  /* ── Success screen ── */
  if (success) return (
    <div
      className="min-h-[80vh] flex items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, #faf9f6 0%, #f4f2ec 100%)" }}
    >
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-gold-100 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">🎯</span>
        </div>
        <h1 className="font-display font-light text-luxury-900 text-3xl mb-2">Bid Request Sent!</h1>
        <p className="text-luxury-400 text-sm leading-relaxed mb-8">
          Hotels in <span className="font-semibold text-luxury-700">{form.city}</span> are now competing for your booking.
          You&apos;ll be notified as offers come in.
        </p>
        <button
          onClick={() => router.push("/hotels")}
          className="btn-luxury px-8 py-3.5 rounded-2xl text-sm"
        >
          Browse Hotels
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(160deg, #faf9f6 0%, #f4f2ec 100%)" }}
    >
      <div className="max-w-lg mx-auto px-5 py-14">

        {/* Header */}
        <div className="mb-10">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-3">Reverse Auction</p>
          <h1 className="font-display font-light text-luxury-900 mb-2" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            Name Your Price
          </h1>
          <p className="text-luxury-400 text-sm leading-relaxed">
            Tell us where and when. Hotels will compete with their best offers for your stay.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-7 space-y-6">

          {/* Destination */}
          <div>
            <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-3">
              Destination <span className="text-gold-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {cities.map((c) => (
                <button
                  key={c}
                  onClick={() => update("city", c)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium tracking-wide transition-all duration-200 ${
                    form.city === c
                      ? "btn-luxury shadow-gold"
                      : "bg-luxury-50 border border-luxury-200 text-luxury-600 hover:border-gold-300 hover:text-luxury-900"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
                Check-in <span className="text-gold-500">*</span>
              </label>
              <input
                type="date"
                value={form.checkIn}
                onChange={(e) => update("checkIn", e.target.value)}
                className="input-luxury text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
                Check-out <span className="text-gold-500">*</span>
              </label>
              <input
                type="date"
                value={form.checkOut}
                onChange={(e) => update("checkOut", e.target.value)}
                className="input-luxury text-sm"
              />
            </div>
          </div>

          {/* Guests */}
          <div>
            <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">Guests</label>
            <select
              value={form.guests}
              onChange={(e) => update("guests", e.target.value)}
              className="input-luxury text-sm"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n} {n === 1 ? "Guest" : "Guests"}</option>
              ))}
            </select>
          </div>

          {/* Budget */}
          <div>
            <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
              Max Budget (₹ / night) <span className="text-gold-500">*</span>
            </label>
            <input
              type="number"
              value={form.maxBudget}
              onChange={(e) => update("maxBudget", e.target.value)}
              placeholder="e.g. 2500"
              className="input-luxury text-xl font-bold"
            />
          </div>

          {/* Requirements */}
          <div>
            <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-1.5">
              Special Requirements
            </label>
            <textarea
              value={form.requirements}
              onChange={(e) => update("requirements", e.target.value)}
              placeholder="Mountain view, quiet room, near mall road…"
              className="input-luxury text-sm resize-none"
              rows={3}
            />
          </div>

          {/* Submit */}
          <button
            onClick={submit}
            disabled={loading || !form.city || !form.checkIn || !form.checkOut || !form.maxBudget}
            className="btn-luxury w-full py-4 rounded-2xl text-[15px] disabled:opacity-40 mt-2"
          >
            {loading ? "Submitting…" : "Submit Bid Request"}
          </button>
        </div>

        <p className="text-center text-xs text-luxury-300 mt-6 tracking-wide">
          Hotels respond within 2–4 hours on average.
        </p>
      </div>
    </div>
  );
}
