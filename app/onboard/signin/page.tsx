"use client";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { saveOnboardSession } from "@/lib/onboard/client";

function SigninInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [identifier, setIdentifier] = useState(sp.get("id") || "");
  const [password, setPassword]     = useState("");
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r = await fetch("/api/onboard/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Login failed"); setBusy(false); return; }
      saveOnboardSession(j.token, j.user);
      router.push("/onboard/wizard");
    } catch (e: any) { setErr(e?.message || "Login failed"); setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8">
        <h1 className="font-display text-4xl text-luxury-900">Welcome back</h1>
        <p className="text-luxury-500 mt-2">Sign in to your StayBid Partner account</p>
      </div>

      <form onSubmit={submit} className="card-luxury p-7 space-y-4">
        <Field label="Email or mobile">
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@hotel.com or +91…"
                 className="input-luxury" required />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                 className="input-luxury" required />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        <button disabled={busy} className="btn-luxury w-full disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in →"}
        </button>

        <div className="flex items-center justify-between text-sm text-luxury-500 pt-1">
          <Link href="/onboard/signup" className="text-gold-700 font-medium">Create account</Link>
          <Link href="/onboard/verify" className="text-luxury-500 hover:text-gold-700">Forgot? Use OTP</Link>
        </div>
      </form>
    </div>
  );
}

export default function SigninPage() {
  return <Suspense><SigninInner /></Suspense>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
