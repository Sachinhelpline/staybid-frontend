"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

type Screen = "options" | "phone" | "phone-otp" | "whatsapp" | "whatsapp-otp";

// ── SVG Icons ──────────────────────────────────────────────────────────────
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#25D366">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const PhoneIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
  </svg>
);

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [screen, setScreen] = useState<Screen>("options");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const recaptchaRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (recaptchaRef.current) {
        try { recaptchaRef.current.clear(); } catch {}
        recaptchaRef.current = null;
      }
    };
  }, []);

  // ── After Firebase auth: try backend sync, then fall back to Firebase user ─
  const syncAndLogin = async (firebaseUser: any, provider: string) => {
    const idToken = await firebaseUser.getIdToken();
    try {
      // Always use Vercel proxy — avoids ISP/Jio blocks on direct Railway URL
      const res = await fetch("/api/proxy/api/auth/social-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          provider,
          email: firebaseUser.email || null,
          name: firebaseUser.displayName || firebaseUser.phoneNumber || "Guest",
          phone: firebaseUser.phoneNumber || null,
          uid: firebaseUser.uid,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          login(data.token, data.user, "backend");
          router.push("/");
          return;
        }
      }
    } catch {}

    // Fallback: store Firebase token — tagged "firebase" so booking actions show inline phone verify
    login(idToken, {
      id: firebaseUser.uid,
      name: firebaseUser.displayName || firebaseUser.phoneNumber || "Guest",
      email: firebaseUser.email || "",
      phone: firebaseUser.phoneNumber || "",
      role: "customer",
    }, "firebase");
    router.push("/");
  };

  // ── Google Sign-In ─────────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    setLoading(true);
    setError("");
    try {
      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      await syncAndLogin(result.user, "google");
    } catch (e: any) {
      if (e.code !== "auth/popup-closed-by-user") {
        setError(e.message || "Google login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Facebook Sign-In ───────────────────────────────────────────────────────
  const signInWithFacebook = async () => {
    setLoading(true);
    setError("");
    try {
      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPopup, FacebookAuthProvider } = await import("firebase/auth");
      const provider = new FacebookAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      await syncAndLogin(result.user, "facebook");
    } catch (e: any) {
      if (e.code !== "auth/popup-closed-by-user") {
        setError(e.message || "Facebook login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP via Firebase (Mobile) ─────────────────────────────────────────
  const sendFirebaseOtp = async () => {
    if (phone.length < 10) return setError("Please enter a 10-digit number.");
    setLoading(true);
    setError("");
    try {
      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPhoneNumber, RecaptchaVerifier } = await import("firebase/auth");
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(firebaseAuth, "recaptcha-container", { size: "invisible" });
      }
      const result = await signInWithPhoneNumber(firebaseAuth, `+91${phone}`, recaptchaRef.current);
      setConfirmationResult(result);
      setScreen("phone-otp");
    } catch (e: any) {
      setError(e.message || "Failed to send OTP. Please try again.");
      recaptchaRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Firebase OTP ────────────────────────────────────────────────────
  const verifyFirebaseOtp = async () => {
    if (otp.length < 6) return setError("Please enter the 6-digit OTP.");
    if (!confirmationResult) return setError("OTP session expired — please resend.");
    setLoading(true);
    setError("");
    try {
      const result = await confirmationResult.confirm(otp);
      await syncAndLogin(result.user, "phone");
    } catch {
      setError("Incorrect or expired OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Send OTP via Backend (WhatsApp) ────────────────────────────────────────
  const sendWhatsAppOtp = async () => {
    if (phone.length < 10) return setError("Please enter a 10-digit number.");
    setLoading(true);
    setError("");
    try {
      await api.sendOtp(phone.startsWith("+91") ? phone : `+91${phone}`);
      setScreen("whatsapp-otp");
    } catch (e: any) {
      setError(e.message || "Failed to send OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Verify Backend OTP (WhatsApp) ──────────────────────────────────────────
  const verifyWhatsAppOtp = async () => {
    if (otp.length < 4) return setError("Please enter your OTP.");
    setLoading(true);
    setError("");
    try {
      const data = await api.verifyOtp(phone.startsWith("+91") ? phone : `+91${phone}`, otp);
      login(data.token || data.accessToken, data.user);
      router.push("/");
    } catch (e: any) {
      setError(e.message || "Incorrect OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setError("");
    setOtp("");
    if (screen === "phone-otp") { setScreen("phone"); setConfirmationResult(null); }
    else if (screen === "whatsapp-otp") setScreen("whatsapp");
    else { setScreen("options"); setPhone(""); }
  };

  const ErrorBox = () => error ? (
    <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
      <span className="text-red-400 mt-0.5 shrink-0 text-base">⚠</span>
      <p className="text-sm text-red-600 leading-relaxed">{error}</p>
    </div>
  ) : null;

  const Brand = ({ subtitle }: { subtitle: string }) => (
    <div className="text-center mb-8">
      <div className="w-16 h-16 rounded-2xl btn-luxury flex items-center justify-center text-white text-2xl font-bold mx-auto mb-5 shadow-gold-lg">S</div>
      <h1 className="font-display font-light text-luxury-900 text-3xl mb-1.5">StayBid</h1>
      <p className="text-luxury-400 text-sm tracking-wide">{subtitle}</p>
    </div>
  );

  return (
    <div className="min-h-[88vh] flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(160deg, #faf9f6 0%, #f4f2ec 100%)" }}>
      <div id="recaptcha-container" />
      <div className="w-full max-w-sm">

        {/* ── OPTIONS SCREEN ── */}
        {screen === "options" && (
          <>
            <Brand subtitle="Sign in to your account" />
            <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6 space-y-3">

              <button onClick={signInWithGoogle} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 border border-luxury-200 rounded-2xl hover:bg-luxury-50 transition-all duration-200 text-sm font-medium text-luxury-800 disabled:opacity-50">
                <GoogleIcon />
                <span className="flex-1 text-left">Continue with Google</span>
              </button>

              <button onClick={signInWithFacebook} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 border border-luxury-200 rounded-2xl hover:bg-blue-50 transition-all duration-200 text-sm font-medium text-luxury-800 disabled:opacity-50">
                <FacebookIcon />
                <span className="flex-1 text-left">Continue with Facebook</span>
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-luxury-100" />
                <span className="text-xs text-luxury-300 tracking-wider">OR</span>
                <div className="flex-1 h-px bg-luxury-100" />
              </div>

              <button onClick={() => { setError(""); setPhone(""); setScreen("whatsapp"); }} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 border border-green-200 bg-green-50 rounded-2xl hover:bg-green-100 transition-all duration-200 text-sm font-medium text-green-800 disabled:opacity-50">
                <WhatsAppIcon />
                <span className="flex-1 text-left">Login with WhatsApp OTP</span>
              </button>

              <button onClick={() => { setError(""); setPhone(""); setScreen("phone"); }} disabled={loading}
                className="w-full flex items-center gap-3 px-4 py-3.5 btn-luxury rounded-2xl text-sm font-medium text-white disabled:opacity-50">
                <PhoneIcon />
                <span className="flex-1 text-left">Login with Mobile OTP</span>
              </button>

              {loading && <p className="text-center text-xs text-luxury-400 pt-1">Please wait…</p>}
              <ErrorBox />
            </div>
            <p className="text-center text-xs text-luxury-300 mt-6 tracking-wide">
              By continuing, you agree to StayBid's Terms of Service.
            </p>
          </>
        )}

        {/* ── MOBILE OTP — ENTER PHONE ── */}
        {screen === "phone" && (
          <>
            <Brand subtitle="Enter your mobile number" />
            <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <span>←</span> Back
              </button>
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gold-50 border border-gold-200 mb-5 mx-auto">
                <PhoneIcon />
              </div>
              <h2 className="text-center font-display text-xl text-luxury-800 mb-1">Mobile OTP</h2>
              <p className="text-center text-xs text-luxury-400 mb-5">We'll send a one-time code via SMS</p>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Mobile Number</label>
              <div className="flex gap-2 mb-5">
                <span className="px-3 py-3 bg-luxury-50 border border-luxury-200 rounded-xl text-sm font-medium text-luxury-600 flex-shrink-0">+91</span>
                <input type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number" className="input-luxury text-sm"
                  maxLength={10} inputMode="numeric" autoFocus />
              </div>
              <button onClick={sendFirebaseOtp} disabled={loading || phone.length < 10}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40">
                {loading ? "Sending OTP…" : "Send OTP"}
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── MOBILE OTP — VERIFY ── */}
        {screen === "phone-otp" && (
          <>
            <Brand subtitle={`OTP sent to +91 ${phone}`} />
            <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <span>←</span> Change number
              </button>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Enter 6-Digit OTP</label>
              <input type="text" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-5"
                maxLength={6} inputMode="numeric" autoFocus />
              <button onClick={verifyFirebaseOtp} disabled={loading || otp.length < 6}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40 mb-3">
                {loading ? "Verifying…" : "Verify & Login"}
              </button>
              <button onClick={goBack} className="w-full py-2 text-sm text-luxury-400 hover:text-luxury-700 transition-colors">
                Didn't receive OTP? Resend
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── WHATSAPP OTP — ENTER PHONE ── */}
        {screen === "whatsapp" && (
          <>
            <Brand subtitle="Enter your WhatsApp number" />
            <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <span>←</span> Back
              </button>
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-green-50 border border-green-200 mb-5 mx-auto">
                <WhatsAppIcon />
              </div>
              <h2 className="text-center font-display text-xl text-green-700 mb-1">WhatsApp OTP</h2>
              <p className="text-center text-xs text-luxury-400 mb-5">We'll send a one-time code to your WhatsApp</p>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">WhatsApp Number</label>
              <div className="flex gap-2 mb-5">
                <span className="px-3 py-3 bg-green-50 border border-green-200 rounded-xl text-sm font-medium text-green-700 flex-shrink-0 flex items-center gap-1">
                  <WhatsAppIcon /> +91
                </span>
                <input type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="10-digit number" className="input-luxury text-sm"
                  maxLength={10} inputMode="numeric" autoFocus />
              </div>
              <button onClick={sendWhatsAppOtp} disabled={loading || phone.length < 10}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
                {loading ? "Sending OTP…" : "Send WhatsApp OTP"}
              </button>
              <ErrorBox />
            </div>
          </>
        )}

        {/* ── WHATSAPP OTP — VERIFY ── */}
        {screen === "whatsapp-otp" && (
          <>
            <Brand subtitle={`OTP sent to +91 ${phone}`} />
            <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-6">
              <button onClick={goBack} className="flex items-center gap-1.5 text-xs text-luxury-400 hover:text-luxury-700 mb-5 transition-colors">
                <span>←</span> Change number
              </button>
              <div className="flex items-center justify-center gap-2 mb-5">
                <WhatsAppIcon />
                <span className="text-sm text-green-700 font-medium">Check your WhatsApp for the OTP</span>
              </div>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">Enter OTP</label>
              <input type="text" value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-5"
                maxLength={6} inputMode="numeric" autoFocus />
              <button onClick={verifyWhatsAppOtp} disabled={loading || otp.length < 4}
                className="w-full py-3.5 rounded-2xl text-sm font-semibold text-white mb-3 transition-all duration-200 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #25D366, #128C7E)" }}>
                {loading ? "Verifying…" : "Verify & Login"}
              </button>
              <button onClick={goBack} className="w-full py-2 text-sm text-luxury-400 hover:text-luxury-700 transition-colors">
                Didn't receive OTP? Resend
              </button>
              <ErrorBox />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
