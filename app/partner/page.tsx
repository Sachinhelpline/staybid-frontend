"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BedDouble, LineChart, Wallet } from "lucide-react";

export default function PartnerLogin() {
  const router = useRouter();
  const [phone, setPhone]       = useState("");
  const [otp, setOtp]           = useState("");
  const [step, setStep]         = useState<"phone"|"otp">("phone");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  // v105 — Gmail sign-in (Firebase Google OAuth) as Railway-OTP fallback.
  // Activates the same hotel-ownership flow but proves identity via Google
  // instead of phone OTP. Useful until MSG91/Gupshup plans are bought.
  const [googleLoading, setGoogleLoading] = useState(false);

  const signInWithGoogle = async () => {
    setGoogleLoading(true); setError("");
    try {
      const fb = await import("firebase/auth");
      const { firebaseAuth } = await import("@/lib/firebase");
      const provider = new fb.GoogleAuthProvider();
      const result = await fb.signInWithPopup(firebaseAuth, provider);
      const email = result.user?.email || "";
      const name  = result.user?.displayName || "";
      if (!email) throw new Error("Google did not return an email. Try again.");

      const res = await fetch("/api/partner/google-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "Login failed");

      localStorage.setItem("sb_partner_token", d.token);
      localStorage.setItem("sb_partner_user",  JSON.stringify({ ...d.user, hotel: d.user.hotel }));
      // v109 — wake up the customer-side TierProvider so the menu /
      // /upgrade banner / DialerNav all flip to "Hotel Partner" before
      // we navigate away. Same-tab login doesn't fire `storage` events
      // in this tab, so the custom event is the only signal.
      if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:tier-refresh"));
      router.replace("/partner/dashboard");
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed");
    } finally {
      setGoogleLoading(false);
    }
  };

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
      // v109 — same as the Google path above. Flips the customer menu
      // to show "Hotel Partner" entry the moment OTP login succeeds.
      if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:tier-refresh"));
      router.replace("/partner/dashboard");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="pauth-root min-h-screen bg-linear-to-br from-luxury-950 via-luxury-900 to-luxury-800 flex items-stretch">
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
        /* v693 — desktop split-screen. On <lg the brand pane hides and the form
           pane fills the width, centred (byte-identical to the old single card).
           Presentation only — no auth logic changed. */
        .pauth-form { flex: 1 1 100%; display: flex; align-items: center; justify-content: center; padding: 40px 16px; min-width: 0; }
        .pauth-brand { display: none; }
        .pauth-brand-inner { max-width: 440px; }
        .pauth-brand-tag { font-family: 'Cormorant Garamond', serif; font-size: clamp(2rem, 2.8vw, 2.9rem); line-height: 1.08; font-weight: 600; margin: 0 0 16px; color: #f4f7fb; }
        .pauth-brand-sub { font-size: 0.98rem; line-height: 1.6; color: rgba(226,234,244,0.78); margin: 0 0 28px; max-width: 380px; }
        .pauth-brand-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
        .pauth-brand-list li { display: flex; align-items: center; gap: 12px; font-size: 0.92rem; color: rgba(226,234,244,0.9); }
        .pauth-brand-list li svg { color: #a0b2c6; flex-shrink: 0; }
        /* v714 (owner ss1) — ONE continuous premium steel canvas across the
           whole desktop sign-in so the brand half and the form half stop
           reading as two different cards. The gradient moves to the ROOT
           (full-bleed); the brand pane is transparent (shows the shared
           canvas) and the form pane is a faint translucent wash of the SAME
           colour with a hairline seam — a gentle frosted column, not a second
           card. The glass sign-in card floats on it. Mobile (<1024) unchanged. */
        @media (min-width: 1024px) {
          .pauth-root {
            background:
              radial-gradient(120% 85% at 12% 8%, rgba(106,133,160,0.22), transparent 58%),
              linear-gradient(155deg,#1a2431 0%,#111824 55%,#0b1017 100%) !important;
          }
          .pauth-brand { display: flex; align-items: center; flex: 1 1 54%; min-width: 0; padding: 48px 5vw; position: relative; overflow: hidden;
            background: transparent; }
          .pauth-form { flex: 1 1 46%;
            background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.016) 100%);
            backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
            border-left: 1px solid rgba(255,255,255,0.08);
            box-shadow: inset 34px 0 62px -42px rgba(0,0,0,0.5); }
        }
      `}</style>

      {/* v693 — desktop-only brand pane (partner-themed steel). Hidden <lg. */}
      <aside className="pauth-brand" aria-hidden="true">
        <div className="pauth-brand-inner">
          <div className="inline-flex items-center gap-2.5 mb-6">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", boxShadow: "0 3px 12px rgba(106, 133, 160,0.4)" }}>S</div>
            <span className="font-display text-xl text-white tracking-wide">StayBid Partner</span>
          </div>
          <h2 className="pauth-brand-tag">Fill your rooms.<br />Own your pricing.</h2>
          <p className="pauth-brand-sub">Manage inventory, accept live bids, and reach travellers across every channel — from one partner dashboard.</p>
          <ul className="pauth-brand-list">
            <li><BedDouble size={18} aria-hidden /><span>List rooms &amp; control availability in real time</span></li>
            <li><LineChart size={18} aria-hidden /><span>Accept, counter, or auto-price incoming bids</span></li>
            <li><Wallet size={18} aria-hidden /><span>Track bookings &amp; settlements in one place</span></li>
          </ul>
        </div>
      </aside>

      <div className="pauth-form">
      <div className="w-full max-w-sm fade-up">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-3.5">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)", boxShadow: "0 3px 12px rgba(106, 133, 160,0.4)" }}>S</div>
            <div>
              <p className="font-display text-xl text-white tracking-wide leading-none">StayBid</p>
              <p className="text-[0.63rem] text-amber-400/80 tracking-[0.2em] uppercase font-medium">Partner Portal</p>
            </div>
          </div>
          <h1 className="font-display text-2xl font-light text-white mb-0.5">Welcome Back</h1>
          <p className="text-white/40 text-[0.82rem]">Sign in to manage your property</p>
        </div>

        <div className="bg-white/6 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
          {step === "phone" ? (
            <div className="space-y-4">
              <div>
                <label className="text-[0.65rem] font-bold text-white/40 uppercase tracking-widest block mb-2">Mobile Number</label>
                <div className="flex gap-2">
                  <div className="gold-input w-16 text-center text-white/60 shrink-0 flex items-center justify-center" style={{width:"56px", padding:"14px 10px"}}>+91</div>
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

          {/* v105 — Google sign-in fallback. Mobile OTP via Railway is the
              canonical flow but WhatsApp/SMS provider plans are not active
              yet — so the OTP never reaches partners. Gmail sign-in works
              as long as the partner's registered email matches a hotel
              owner in the database. */}
          {step === "phone" && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[0.65rem] uppercase tracking-widest text-white/30 font-semibold">or</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <button
                onClick={signInWithGoogle}
                disabled={googleLoading || loading}
                className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-white text-luxury-900 font-semibold text-sm hover:bg-luxury-50 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                  <path fill="#b0becc" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                {googleLoading ? "Verifying…" : "Continue with Google"}
              </button>
              <p className="text-[0.65rem] text-white/30 text-center mt-2 leading-relaxed">
                Use the Gmail registered against your hotel. WhatsApp OTP coming soon once provider plan activates.
              </p>
            </>
          )}
        </div>

        <div className="mt-5 text-center space-y-2">
          <Link href="/partner/staff" className="block text-amber-400/60 text-xs hover:text-amber-400 transition-colors">
            🧑‍💼 Staff member? Sign in with your code →
          </Link>
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
    </div>
  );
}
