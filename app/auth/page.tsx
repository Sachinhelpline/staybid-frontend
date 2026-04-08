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
    if (phone.length < 10) return setError("Enter valid 10-digit phone");
    setLoading(true); setError("");
    try {
      await api.sendOtp(phone.startsWith("+91") ? phone : `+91${phone}`);
      setStep("otp");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const verify = async () => {
    if (otp.length < 4) return setError("Enter valid OTP");
    setLoading(true); setError("");
    try {
      const data = await api.verifyOtp(phone.startsWith("+91") ? phone : `+91${phone}`, otp);
      login(data.token, data.user);
      router.push("/");
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4">S</span>
          <h1 className="font-display text-3xl mb-1">Welcome to StayBid</h1>
          <p className="text-gray-500 text-sm">Login with your phone number</p>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          {step === "phone" ? (
            <>
              <label className="text-sm font-medium text-gray-600 block mb-2">Phone Number</label>
              <div className="flex gap-2 mb-4">
                <span className="px-3 py-3 bg-gray-100 rounded-xl text-sm font-medium text-gray-600">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="Enter phone number"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  maxLength={10}
                />
              </div>
              <button onClick={sendOtp} disabled={loading} className="w-full py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition disabled:opacity-40">
                {loading ? "Sending..." : "Send OTP"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">OTP sent to +91{phone}</p>
              <label className="text-sm font-medium text-gray-600 block mb-2">Enter OTP</label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="Enter OTP"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-center text-xl tracking-widest font-bold mb-4"
                maxLength={6}
              />
              <button onClick={verify} disabled={loading} className="w-full py-3 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition disabled:opacity-40">
                {loading ? "Verifying..." : "Verify & Login"}
              </button>
              <button onClick={() => { setStep("phone"); setOtp(""); }} className="w-full py-2 mt-2 text-sm text-gray-500 hover:text-gray-700">
                Change number
              </button>
            </>
          )}
          {error && <p className="text-sm text-red-500 mt-3 text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
