"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const INTEREST_OPTIONS = [
  "Luxury Stays", "Adventure", "Wellness", "Family", "Honeymoon",
  "Foodie", "Solo Travel", "Mountain", "Beach", "Heritage",
];

export default function InfluencerRegisterPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [followers, setFollowers] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  const toggleInterest = (i: string) =>
    setInterests((prev) => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!agreementAccepted) { setError("Please accept the creator agreement to continue."); return; }
    setSubmitting(true);
    try {
      await api.registerInfluencer({
        bio, location,
        totalFollowers: Number(followers) || 0,
        interests,
        bankName, bankAccountNumber, ifscCode,
        agreementAccepted,
      });
      router.replace("/influencer/dashboard");
    } catch (err: any) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card-luxury p-6">
        <h2 className="font-display text-2xl font-bold text-luxury-900 mb-1">Become a StayBid Creator</h2>
        <p className="text-luxury-500 text-sm mb-5">Tell us about yourself. You can edit any of this later.</p>

        <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Short Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)}
          rows={3} maxLength={400}
          placeholder="Travel content, hospitality reviews, lifestyle…"
          className="input-luxury w-full mb-4" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Primary City</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Mussoorie" className="input-luxury w-full" />
          </div>
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Total Followers (across platforms)</label>
            <input value={followers} onChange={(e) => setFollowers(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric" placeholder="e.g. 12500" className="input-luxury w-full" />
          </div>
        </div>
      </div>

      <div className="card-luxury p-6">
        <h3 className="font-bold text-luxury-900 mb-1">Your Interests</h3>
        <p className="text-luxury-500 text-xs mb-3">We use these to surface relevant hotels and campaigns.</p>
        <div className="flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((i) => {
            const on = interests.includes(i);
            return (
              <button key={i} type="button" onClick={() => toggleInterest(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  on ? "bg-gold-500 text-white border-gold-600" : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
                }`}>
                {i}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card-luxury p-6">
        <h3 className="font-bold text-luxury-900 mb-1">Payout Bank Details</h3>
        <p className="text-luxury-500 text-xs mb-3">Optional now — required before your first payout. Stored encrypted.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)}
            placeholder="Bank name" className="input-luxury w-full" />
          <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric" placeholder="Account number" className="input-luxury w-full" />
          <input value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
            placeholder="IFSC" className="input-luxury w-full" />
        </div>
      </div>

      <div className="card-luxury p-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agreementAccepted}
            onChange={(e) => setAgreementAccepted(e.target.checked)}
            className="mt-1 w-5 h-5 accent-gold-600" />
          <span className="text-sm text-luxury-700">
            I agree to the StayBid <span className="font-semibold text-gold-700">Creator Agreement</span> — 12% commission on bookings attributed to me, payable monthly after a 14-day return window. KYC (Aadhaar + PAN) required before payout.
          </span>
        </label>
      </div>

      {error && (
        <div className="card-luxury p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button type="submit" disabled={submitting}
        className="btn-luxury w-full py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? "Creating your creator account…" : "Activate Creator Account"}
      </button>
    </form>
  );
}
