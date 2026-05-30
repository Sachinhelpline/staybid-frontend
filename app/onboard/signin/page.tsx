"use client";
// v243 — React 19 form: useActionState drives the submit (built-in pending +
// returned-error state) instead of hand-rolled busy/err useState. Inputs are
// uncontrolled (name + defaultValue), read from FormData in the action.
import { useActionState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { saveOnboardSession } from "@/lib/onboard/client";

function SigninInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [err, formAction, pending] = useActionState<string | null, FormData>(
    async (_prev, formData) => {
      const identifier = String(formData.get("identifier") || "").trim();
      const password = String(formData.get("password") || "");
      try {
        const r = await fetch("/api/onboard/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, password }),
        });
        const j = await r.json();
        if (!r.ok) return j.error || "Login failed";
        saveOnboardSession(j.token, j.user);
        router.push("/onboard/wizard");
        return null;
      } catch (e: any) {
        return e?.message || "Login failed";
      }
    },
    null,
  );

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8 sb-fade-in">
        <h1 className="font-display text-4xl text-luxury-900">Welcome back</h1>
        <p className="text-luxury-500 mt-2">Sign in to your StayBid Partner account</p>
      </div>

      <form action={formAction} className="card-luxury sb-card-lift sb-fade-in p-7 space-y-4" style={{ animationDelay: "0.1s" }}>
        <div className="sb-step-rail" aria-hidden />
        <Field label="Email or mobile">
          <input name="identifier" defaultValue={sp.get("id") || ""} placeholder="you@hotel.com or +91…"
                 className="input-luxury sb-focus-glow" required />
        </Field>
        <Field label="Password">
          <input name="password" type="password" placeholder="••••••••"
                 className="input-luxury sb-focus-glow" required />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        <button disabled={pending} className="btn-luxury sb-shimmer w-full disabled:opacity-50 relative">
          <span className="relative" style={{ zIndex: 2 }}>{pending ? "Signing in…" : "Sign in →"}</span>
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
