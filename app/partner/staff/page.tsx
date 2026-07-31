"use client";
//
// v170 — Staff login (partner panel, Phase 3).
//
// Staff members sign in here with the login code + PIN their hotel owner
// created. Stores the same sb_partner_token / sb_partner_user keys the
// owner login uses, so the dashboard works unchanged — only role-scoped.
//
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function StaffLogin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const signIn = async () => {
    if (!code.trim() || !pin.trim()) return setError("Login code aur PIN dono daalo.");
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/partner/staff-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginCode: code.trim().toUpperCase(), pin: pin.trim() }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Login failed");
      localStorage.setItem("sb_partner_token", d.token);
      localStorage.setItem("sb_partner_user", JSON.stringify(d.user));
      router.replace("/partner/dashboard");
    } catch (e: any) {
      setError(e?.message || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-luxury-950 via-luxury-900 to-luxury-800 flex items-center justify-center px-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');
        .font-display { font-family: 'Cormorant Garamond', serif; }
        body { font-family: 'Inter', sans-serif; }
        .gold-input { background: rgba(255,255,255,0.06); border: 1px solid rgba(106, 133, 160,0.25); border-radius: 11px; padding: 12px 14px; color: #fff; width: 100%; font-size: 0.85rem; outline: none; transition: all 0.18s; }
        .gold-input::placeholder { color: rgba(255,255,255,0.3); }
        .gold-input:focus { border-color: rgba(106, 133, 160,0.7); background: rgba(255,255,255,0.09); box-shadow: 0 0 0 3px rgba(106, 133, 160,0.13); }
        .gold-btn { background: radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%); color: #fff; border: none; border-radius: 11px; padding: 12px; font-weight: 700; cursor: pointer; width: 100%; font-size: 0.85rem; transition: all 0.18s; box-shadow: 0 2px 10px rgba(106, 133, 160,0.25); }
        .gold-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(106, 133, 160,0.4); }
        .gold-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation: fadeUp 0.4s ease-out both; }
      `}</style>

      <div className="w-full max-w-sm fade-up">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-3.5">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", boxShadow: "0 3px 12px rgba(106, 133, 160,0.4)" }}>S</div>
            <div>
              <p className="font-display text-xl text-white tracking-wide leading-none">StayBid</p>
              <p className="text-[0.6rem] text-amber-400/80 tracking-[0.2em] uppercase font-medium">Staff Sign-in</p>
            </div>
          </div>
          <h1 className="font-display text-2xl font-light text-white mb-0.5">Staff Login</h1>
          <p className="text-white/40 text-[0.82rem]">Hotel owner se mila login code &amp; PIN daalo</p>
        </div>

        <div className="bg-white/6 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
          <div className="space-y-4">
            <div>
              <label className="text-[0.62rem] font-bold text-white/40 uppercase tracking-widest block mb-2">Login Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setError(""); }}
                placeholder="8-character code"
                className="gold-input font-mono tracking-[0.2em] text-center text-base"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && signIn()}
              />
            </div>
            <div>
              <label className="text-[0.62rem] font-bold text-white/40 uppercase tracking-widest block mb-2">PIN</label>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                placeholder="• • • •"
                className="gold-input text-center text-xl tracking-[0.4em]"
                onKeyDown={(e) => e.key === "Enter" && signIn()}
              />
            </div>
            <button onClick={signIn} disabled={loading || !code.trim() || !pin.trim()} className="gold-btn">
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300 leading-relaxed">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="mt-5 text-center">
          <Link href="/partner" className="text-amber-400/60 text-xs hover:text-amber-400 transition-colors">
            🏨 Hotel owner? Sign in here →
          </Link>
        </div>
      </div>
    </div>
  );
}
