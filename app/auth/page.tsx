"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AuthPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendOtp = async () => {
    if (phone.length < 10) return setError("Enter a valid 10-digit phone number");
    setLoading(true);
    setError("");
    try {
      await api.sendOtp(phone.startsWith("+91") ? phone : `+91${phone}`);
      setStep("otp");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (otp.length < 4) return setError("Enter the OTP you received");
    setLoading(true);
    setError("");
    try {
      const data = await api.verifyOtp(
        phone.startsWith("+91") ? phone : `+91${phone}`,
        otp
      );
      login(data.token || data.accessToken, data.user);
      router.push("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-[88vh] flex items-center justify-center px-4"
      style={{ background: "linear-gradient(160deg, #faf9f6 0%, #f4f2ec 100%)" }}
    >
      <div className="w-full max-w-sm">

        {/* ── Brand mark ── */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-2xl btn-luxury flex items-center justify-center text-white text-2xl font-bold mx-auto mb-5 shadow-gold-lg">
            S
          </div>
          <h1 className="font-display font-light text-luxury-900 text-3xl mb-1.5">Welcome to StayBid</h1>
          <p className="text-luxury-400 text-sm tracking-wide">
            {step === "phone" ? "Sign in with your phone number" : `OTP sent to +91 ${phone}`}
          </p>
        </div>

        {/* ── Card ── */}
        <div className="bg-white rounded-3xl border border-luxury-100 shadow-luxury p-7">

          {step === "phone" ? (
            <>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">
                Phone Number
              </label>
              <div className="flex gap-2 mb-5">
                <span className="px-3 py-3 bg-luxury-50 border border-luxury-200 rounded-xl text-sm font-medium text-luxury-600 flex-shrink-0">
                  +91
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="Enter 10-digit number"
                  className="input-luxury text-sm"
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
              <button
                onClick={sendOtp}
                disabled={loading || phone.length < 10}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40"
              >
                {loading ? "Sending…" : "Send OTP"}
              </button>
            </>
          ) : (
            <>
              <label className="text-xs font-semibold text-luxury-500 uppercase tracking-wider block mb-2">
                Enter OTP
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className="input-luxury text-center text-2xl tracking-[0.5em] font-bold mb-5"
                maxLength={6}
                inputMode="numeric"
                autoFocus
              />
              <button
                onClick={verify}
                disabled={loading || otp.length < 4}
                className="btn-luxury w-full py-3.5 rounded-2xl text-sm disabled:opacity-40 mb-3"
              >
                {loading ? "Verifying…" : "Verify & Sign In"}
              </button>
              <button
                onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                className="w-full py-2 text-sm text-luxury-400 hover:text-luxury-700 transition-colors tracking-wide"
              >
                Change number
              </button>
            </>
          )}

          {error && (
            <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
              <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
              <div>
                <p className="text-sm text-red-700 font-medium">Login nahi ho pa raha</p>
                <p className="text-xs text-red-500 mt-0.5 leading-relaxed">{error}</p>
                {(error.toLowerCase().includes("server") || error.toLowerCase().includes("network") || error.toLowerCase().includes("wrong")) && (
                  <p className="text-xs text-red-400 mt-1">Server temporarily down ho sakta hai. Kuch minutes baad try karein.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-luxury-300 mt-6 tracking-wide">
          By signing in, you agree to StayBid&apos;s terms of service.
        </p>
      </div>
    </div>
  );
}
