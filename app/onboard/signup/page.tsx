"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email && !phone) { setErr("Email or mobile is required."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/onboard/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.existing) { router.push(`/onboard/signin?id=${encodeURIComponent(email || phone)}`); return; }
        setErr(j.error || "Signup failed"); setBusy(false); return;
      }
      const id = email || phone;
      router.push(`/onboard/verify?id=${encodeURIComponent(id)}`);
    } catch (e: any) {
      setErr(e?.message || "Signup failed"); setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8">
        <h1 className="font-display text-4xl text-luxury-900">Create your partner account</h1>
        <p className="text-luxury-500 mt-2">One-time OTP, then you set your own password.</p>
      </div>

      <form onSubmit={submit} className="card-luxury p-7 space-y-4">
        <Field label="Your name (optional)">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sachin Tomer"
                 className="input-luxury" />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hotel.com"
                 className="input-luxury" />
        </Field>
        <div className="text-center text-xs text-luxury-400 uppercase tracking-widest">or</div>
        <Field label="Mobile (with country code)">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98XXX XXXXX"
                 className="input-luxury" />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        <button disabled={busy} className="btn-luxury w-full disabled:opacity-50">
          {busy ? "Sending OTP…" : "Continue →"}
        </button>

        <div className="text-center text-sm text-luxury-500">
          Already have an account? <Link href="/onboard/signin" className="text-gold-700 font-medium">Sign in</Link>
        </div>
      </form>

      <p className="text-xs text-center text-luxury-400 mt-6 leading-relaxed">
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
