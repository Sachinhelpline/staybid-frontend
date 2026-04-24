"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PartnerLogin() {
  const router = useRouter();
  const [phone, setPhone]       = useState("");
  const [otp, setOtp]           = useState("");
  const [step, setStep]         = useState<"phone"|"otp">("phone");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    // Already logged in as partner?
    if (typeof window !== "undefined" && localStorage.getItem("sb_partner_token")) {
      router.replace("/partner/dashboard");
    }
  }, []);

  const sendOtp = async () => {
    if (phone.length < 10) return setError("Enter a valid 10-digit mobile number.");
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/proxy/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+91${phone}` }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send OTP");
      setStep("otp");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) return setError("Enter the OTP you received.");
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/proxy/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+91${phone}`, otp }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Incorrect OTP");

      const token = d.token || d.accessToken;
      const user  = d.user;

      // Check partner status — must have a hotel in Supabase
      const hotelRes = await fetch("/api/partner/hotel", {
        headers: { Authorization: `Bearer ${token}`, "x-phone": `+91${phone}` },
      });
      const hotelData = await hotelRes.json();

      if (!hotelRes.ok || !hotelData.hotel) {
        throw new Error("This account is not registered as a hotel partner. Contact support@staybid.in to get onboarded.");
      }

      // Store partner session separately from customer session
      localStorage.setItem("sb_partner_token", token);
      localStorage.setItem("sb_partner_user",  JSON.stringify({ ...user, hotel: hotelData.hotel }));
      router.replace("/partner/dashboard");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-luxury-950 via-luxury-900 to-luxury-800 flex items-center justify-center px-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');
        .font-display { font-family: 'Cormorant Garamond', serif; }
        body { font-family: 'Inter', sans-serif; }
        .gold-input { background: rgba(255,255,255,0.06); border: 1px solid rgba(201,145,26,0.25); border-radius: 12px; padding: 14px 16px; color: #fff; width: 100%; font-size: 0.9rem; outline: none; transition: all 0.2s; }
        .gold-input::placeholder { color: rgba(255,255,255,0.3); }
        .gold-input:focus { border-color: rgba(201,145,26,0.7); background: rgba(255,255,255,0.09); box-shadow: 0 0 0 3px rgba(201,145,26,0.12); }
        .gold-btn { background: linear-gradient(135deg,#c9911a,#f0b429); color: #fff; border: none; border-radius: 12px; padding: 14px; font-weight: 700; cursor: pointer; width: 100%; font-size: 0.9rem; transition: all 0.2s; }
        .gold-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(201,145,26,0.4); }
        .gold-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation: fadeUp 0.4s ease-out both; }
      `}</style>

      <div className="w-full max-w-sm fade-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xl"
              style={{ background: "linear-gradient(135deg,#c9911a,#f0b429)" }}>S</div>
            <div>
              <p className="font-display text-2xl text-white tracking-wide leading-none">StayBid</p>
              <p className="text-[0.65rem] text-amber-400/80 tracking-[0.2em] uppercase font-medium">Partner Portal</p>
            </div>
          </div>
          <h1 className="font-display text-3xl font-light text-white mb-1">Welcome Back</h1>
          <p className="text-white/40 text-sm">Sign in to manage your property</p>
        </div>

        <div className="bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl">
          {step === "phone" ? (
            <div className="space-y-4">
              <div>
                <label className="text-[0.65rem] font-bold text-white/40 uppercase tracking-widest block mb-2">Mobile Number</label>
                <div className="flex gap-2">
                  <div className="gold-input w-16 text-center text-white/60 flex-shrink-0 flex items-center justify-center" style={{width:"56px", padding:"14px 10px"}}>+91</div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g,"").slice(0,10)); setError(""); }}
                    placeholder="10-digit number"
                    className="gold-input flex-1"
                    maxLength={10}
                    inputMode="numeric"
                    autoFocus
                    onKeyDown={e => e.key === "Enter" && sendOtp()}
                  />
                </div>
              </div>
              <button onClick={sendOtp} disabled={loading || phone.length < 10} className="gold-btn">
                {loading ? "Sending OTP…" : "Send OTP →"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-white/50 text-sm">OTP sent to <span className="text-white font-semibold">+91 {phone}</span></p>
                <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                  className="text-amber-400/70 text-xs hover:text-amber-400 transition-colors mt-1">
                  ← Change number
                </button>
              </div>
              <div>
                <label className="text-[0.65rem] font-bold text-white/40 uppercase tracking-widest block mb-2">Enter OTP</label>
                <input
                  type="text"
                  value={otp}
                  onChange={e => { setOtp(e.target.value.replace(/\D/g,"").slice(0,6)); setError(""); }}
                  placeholder="• • • • • •"
                  className="gold-input text-center text-2xl tracking-[0.5em] font-bold"
                  maxLength={6}
                  inputMode="numeric"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && verifyOtp()}
                />
              </div>
              <button onClick={verifyOtp} disabled={loading || otp.length < 4} className="gold-btn">
                {loading ? "Verifying…" : "Sign In →"}
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300 leading-relaxed">
              ⚠️ {error}
            </div>
          )}
        </div>

        <div className="mt-5 text-center space-y-2">
          <p className="text-white/20 text-xs">Not a partner yet?{" "}
            <a href="mailto:support@staybid.in" className="text-amber-400/60 hover:text-amber-400 transition-colors">
              Apply for onboarding →
            </a>
          </p>
          <Link href="/" className="block text-white/20 text-xs hover:text-white/40 transition-colors">
            ← Back to StayBid customer site
          </Link>
        </div>
      </div>
    </div>
  );
}
