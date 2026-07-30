"use client";
// v243 — React 19 form: useActionState drives the submit (built-in pending +
// returned-error state) instead of hand-rolled busy/err useState. Inputs are
// uncontrolled (name + defaultValue), read from FormData in the action.
//
// v261 — Sachin: "abhi hmara mobile otp kaam nhi kar raha hai — abhi ke liye
// gmail verification ko hi login ke liye access dedo, future ke liye mobile otp
// ko rakhlo." Google (Gmail) sign-in is now the primary, password-free path.
// The email/mobile + password form stays below as a secondary option for
// existing accounts; "Forgot? Use OTP" preserved for the future.
import { useActionState, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { saveOnboardSession } from "@/lib/onboard/client";

function SigninInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleErr, setGoogleErr] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    setGoogleBusy(true);
    setGoogleErr(null);
    try {
      const { firebaseAuth } = await import("@/lib/firebase");
      const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(firebaseAuth, provider);
      const fu: any = result.user;
      const idToken = await fu.getIdToken().catch(() => undefined);
      const r = await fetch("/api/onboard/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fu.email,
          name: fu.displayName,
          uid: fu.uid,
          idToken,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Google sign-in failed");
      saveOnboardSession(j.token, j.user);
      router.push("/onboard/wizard");
    } catch (e: any) {
      if (e?.code !== "auth/popup-closed-by-user") {
        setGoogleErr(e?.message || "Google sign-in failed. Please try again.");
      }
    } finally {
      setGoogleBusy(false);
    }
  };

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

      {/* Google (Gmail) — primary, password-free */}
      <div className="card-luxury sb-card-lift sb-fade-in p-7 space-y-3">
        <div className="sb-step-rail" aria-hidden />
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleBusy}
          className="w-full flex items-center justify-center gap-3 px-4 py-4 rounded-2xl bg-white border-2 border-gold-300 shadow-gold hover:bg-gold-50 transition-all duration-200 text-sm font-semibold text-luxury-900 disabled:opacity-50"
        >
          <GoogleIcon />
          <span>{googleBusy ? "Signing in…" : "Continue with Google"}</span>
        </button>
        <p className="text-center text-[11px] text-luxury-400">
          Fastest & recommended — sign in with your Gmail
        </p>
        {googleErr && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {googleErr}
          </div>
        )}
      </div>

      {/* OR divider */}
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-luxury-200" />
        <span className="text-xs uppercase tracking-wider text-luxury-400">or use password</span>
        <div className="flex-1 h-px bg-luxury-200" />
      </div>

      <form action={formAction} className="card-luxury sb-fade-in p-7 space-y-4">
        <Field label="Email or mobile">
          <input name="identifier" defaultValue={sp.get("id") || ""} placeholder="you@hotel.com or +91…"
                 className="input-luxury sb-focus-glow" required />
        </Field>
        <Field label="Password">
          <input name="password" type="password" placeholder="••••••••"
                 className="input-luxury sb-focus-glow" required />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

        <button disabled={pending} className="btn-luxury w-full disabled:opacity-50 relative">
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

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" fill="#b0becc"/>
      <path d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
