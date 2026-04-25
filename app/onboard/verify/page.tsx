"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveOnboardSession } from "@/lib/onboard/client";

function VerifyInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [identifier] = useState(sp.get("id") || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [secsLeft, setSecsLeft] = useState(30);

  useEffect(() => {
    const i = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(i);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/onboard/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, code, password }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Verification failed"); setBusy(false); return; }
      saveOnboardSession(j.token, j.user);
      router.push("/onboard/wizard");
    } catch (e: any) { setErr(e?.message || "Failed"); setBusy(false); }
  };

  const resend = async () => {
    if (secsLeft > 0) return;
    setInfo(null); setErr(null);
    try {
      const r = await fetch("/api/onboard/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Could not resend"); return; }
      setInfo("New code sent."); setSecsLeft(30);
    } catch (e: any) { setErr(e?.message || "Failed"); }
  };

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="text-center mb-8">
        <h1 className="font-display text-4xl text-luxury-900">Verify & set password</h1>
        <p className="text-luxury-500 mt-2">
          We sent a 6-digit code to <span className="font-semibold text-luxury-800">{identifier}</span>
        </p>
      </div>

      <form onSubmit={submit} className="card-luxury p-7 space-y-4">
        <Field label="6-digit code">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                 placeholder="123456" maxLength={6}
                 className="input-luxury text-center text-2xl tracking-[0.5em] font-bold" required />
        </Field>
        <Field label="Choose a password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 placeholder="Min 6 characters"
                 className="input-luxury" required />
        </Field>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}
        {info && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{info}</div>}

        <button disabled={busy || !code || password.length < 6} className="btn-luxury w-full disabled:opacity-50">
          {busy ? "Verifying…" : "Verify & continue →"}
        </button>

        <div className="text-center text-sm">
          <button type="button" onClick={resend} disabled={secsLeft > 0}
                  className={secsLeft > 0 ? "text-luxury-400" : "text-gold-700 font-medium"}>
            {secsLeft > 0 ? `Resend code in ${secsLeft}s` : "Resend code"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function VerifyPage() {
  return <Suspense><VerifyInner /></Suspense>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-luxury-500 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
