"use client";
// v243 — React 19 form: useActionState drives submit (pending + error state).
// Inputs uncontrolled (name + FormData) instead of per-field useState.
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();

  const [err, formAction, pending] = useActionState<string | null, FormData>(
    async (_prev, formData) => {
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const phone = String(formData.get("phone") || "").trim();
      if (!email && !phone) return "Email or mobile is required.";
      try {
        const r = await fetch("/api/onboard/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, phone }),
        });
        const j = await r.json();
        if (!r.ok) {
          if (j.existing) { router.push(`/onboard/signin?id=${encodeURIComponent(email || phone)}`); return null; }
          return j.error || "Signup failed";
        }
        const id = email || phone;
        const dev = j?.devOtp?.email || j?.devOtp?.sms;
        const qs = `id=${encodeURIComponent(id)}${dev ? `&dev=${encodeURIComponent(dev)}` : ""}`;
        router.push(`/onboard/verify?${qs}`);
        return null;
      } catch (e: any) {
        return e?.message || "Signup failed";
      }
    },
    null,
  );

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8 sb-fade-in">
        <h1 className="font-display text-4xl text-luxury-900">Create your partner account</h1>
        <p className="text-luxury-500 mt-2">One-time OTP, then you set your own password.</p>
      </div>

      <form action={formAction} className="card-luxury sb-card-lift sb-fade-in p-7 space-y-4" style={{ animationDelay: "0.1s" }}>
        <div className="sb-step-rail" aria-hidden />
        <Field label="Your name (optional)">
          <input name="name" placeholder="e.g. Sachin Tomer"
                 className="input-luxury sb-focus-glow" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" placeholder="you@hotel.com"
                 className="input-luxury sb-focus-glow" />
        </Field>
        <div className="text-center text-xs text-luxury-400 uppercase tracking-widest">or</div>
        <Field label="Mobile (with country code)">
          <input name="phone" type="tel" placeholder="+91 98XXX XXXXX"
                 className="input-luxury sb-focus-glow" />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        <button disabled={pending} className="btn-luxury sb-shimmer w-full disabled:opacity-50 relative">
          <span className="relative" style={{ zIndex: 2 }}>{pending ? "Sending OTP…" : "Continue →"}</span>
        </button>

        <div className="text-center text-sm text-luxury-500">
          Already have an account? <Link href="/onboard/signin" className="text-gold-700 font-medium">Sign in</Link>
        </div>
      </form>

      <p className="text-xs text-center text-luxury-400 mt-6 leading-relaxed sb-fade-in" style={{ animationDelay: "0.2s" }}>
        By continuing you agree to StayBid's Partner Terms & accept that you are authorized to list this property.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
