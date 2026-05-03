"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const INTEREST_OPTIONS = [
  "Luxury Stays", "Adventure", "Wellness", "Family", "Honeymoon",
  "Foodie", "Solo Travel", "Mountain", "Beach", "Heritage",
];

export default function InfluencerProfilePage() {
  const [inf, setInf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [followers, setFollowers] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");

  useEffect(() => {
    api.getMyInfluencer()
      .then((d) => {
        const i = d?.influencer;
        if (!i) return;
        setInf(i);
        setBio(i.bio || "");
        setLocation(i.location || "");
        setFollowers(String(i.total_followers || ""));
        setInterests(Array.isArray(i.interests) ? i.interests : []);
        setBankName(i.bank_name || "");
        setBankAccountNumber(i.bank_account_number || "");
        setIfscCode(i.ifsc_code || "");
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleInterest = (i: string) =>
    setInterests((prev) => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);

  const save = async () => {
    if (!inf) return;
    setSaving(true); setMsg("");
    try {
      await api.updateInfluencerProfile(inf.id, {
        bio, location,
        totalFollowers: Number(followers) || 0,
        interests,
        bankName, bankAccountNumber, ifscCode,
      });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2200);
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Loading…</div>;
  if (!inf)    return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Not registered.</div>;

  return (
    <div className="space-y-5">
      <div className="card-luxury p-6">
        <h2 className="font-bold text-luxury-900 mb-4">Public Profile</h2>
        <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Bio</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={400}
          className="input-luxury w-full mb-4" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Primary City</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="input-luxury w-full" />
          </div>
          <div>
            <label className="block text-xs font-bold text-luxury-700 uppercase tracking-wider mb-1.5">Total Followers</label>
            <input value={followers} inputMode="numeric"
              onChange={(e) => setFollowers(e.target.value.replace(/[^0-9]/g, ""))}
              className="input-luxury w-full" />
          </div>
        </div>
      </div>

      <div className="card-luxury p-6">
        <h2 className="font-bold text-luxury-900 mb-3">Interests</h2>
        <div className="flex flex-wrap gap-2">
          {INTEREST_OPTIONS.map((i) => {
            const on = interests.includes(i);
            return (
              <button key={i} type="button" onClick={() => toggleInterest(i)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  on ? "bg-gold-500 text-white border-gold-600" : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
                }`}>{i}</button>
            );
          })}
        </div>
      </div>

      <div className="card-luxury p-6">
        <h2 className="font-bold text-luxury-900 mb-3">Payout Bank</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" className="input-luxury w-full" />
          <input value={bankAccountNumber} inputMode="numeric"
            onChange={(e) => setBankAccountNumber(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Account number" className="input-luxury w-full" />
          <input value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
            placeholder="IFSC" className="input-luxury w-full" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="btn-luxury px-6 py-3 rounded-xl font-bold disabled:opacity-50">
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {msg && <span className="text-sm font-semibold text-luxury-700">{msg}</span>}
      </div>
    </div>
  );
}
