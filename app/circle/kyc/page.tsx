"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — KYC & verification  (v294.18, Phase 4)
//
// Circle's OWN investor KYC — identity + payout details, COMPLETELY SEPARATE
// from the hotel-partner video verification (vp_requests / vp_videos). The
// dashboard row used to jump into /verification (the hotel room-video flow),
// which clashed badly. This is a clean, premium-cozy KYC form backed by the
// new circle_kyc table.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

type Kyc = {
  status: "not_started" | "submitted" | "verified" | "rejected";
  full_name?: string; pan?: string; aadhaar_last4?: string;
  bank_account?: string; bank_ifsc?: string; bank_holder?: string;
  review_note?: string | null;
};

const STATUS_UI: Record<Kyc["status"], { icon: string; title: string; sub: string; cls: string }> = {
  not_started: { icon: "🪪", title: "Complete your KYC", sub: "Verify your identity to receive monthly payouts securely.", cls: "" },
  submitted:   { icon: "⏳", title: "Under review", sub: "We're verifying your details. This usually takes 1–2 working days.", cls: "wait" },
  verified:    { icon: "✅", title: "KYC verified", sub: "You're all set — payouts will reach your verified bank account.", cls: "ok" },
  rejected:    { icon: "⚠️", title: "Needs your attention", sub: "Something didn't match. Please review and resubmit.", cls: "bad" },
};

export default function CircleKycPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [kyc, setKyc] = useState<Kyc>({ status: "not_started" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [f, setF] = useState({ full_name: "", pan: "", aadhaar_last4: "", bank_account: "", bank_ifsc: "", bank_holder: "" });

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    const token = localStorage.getItem("sb_token");
    if (!token) { setLoading(false); return; }
    fetch("/api/circle/kyc", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const k: Kyc = d?.kyc || { status: "not_started" };
        setKyc(k);
        setF({
          full_name: k.full_name || (user?.name || ""),
          pan: k.pan || "", aadhaar_last4: k.aadhaar_last4 || "",
          bank_account: k.bank_account || "", bank_ifsc: k.bank_ifsc || "", bank_holder: k.bank_holder || "",
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setErr("");
    if (!f.full_name.trim()) { setErr("Please enter your full name."); return; }
    setSaving(true);
    const token = localStorage.getItem("sb_token");
    try {
      const r = await fetch("/api/circle/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(f),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d?.error || "Could not save. Please try again."); setSaving(false); return; }
      setKyc(d.kyc || { ...f, status: "submitted" });
    } catch {
      setErr("Network issue — please try again.");
    }
    setSaving(false);
  };

  const s = STATUS_UI[kyc.status] || STATUS_UI.not_started;
  const editable = kyc.status === "not_started" || kyc.status === "rejected";

  return (
    <div className="sbc-dash">
      <header className="sbc-dash-head">
        <Link href="/circle/dashboard" className="sbc-dash-back" aria-label="Back">←</Link>
        <span className="sbc-dash-title">KYC &amp; verification</span>
        <span style={{ width: 34 }} />
      </header>

      {!user ? (
        <section className="sbc-dash-profile" style={{ justifyContent: "space-between" }}>
          <div className="sbc-dash-who"><b>Sign in to start KYC</b><span>Verify your identity to receive payouts.</span></div>
          <Link href="/auth" className="sbc-dash-edit gold">Sign in</Link>
        </section>
      ) : (
        <>
          <section className={`sbc-kyc-banner ${s.cls}`}>
            <span className="sbc-kyc-ic">{s.icon}</span>
            <div>
              <b>{loading ? "Loading…" : s.title}</b>
              <span>{loading ? "Fetching your KYC status." : s.sub}</span>
              {kyc.status === "rejected" && kyc.review_note ? <em>{kyc.review_note}</em> : null}
            </div>
          </section>

          <p className="sbc-kyc-note">
            🔒 This is your <b>StayCircle investor KYC</b> — for identity &amp; secure payouts. It is separate from any hotel video verification.
          </p>

          {editable ? (
            <section className="sbc-dash-sec">
              <div className="sbc-dash-sec-h">Your details</div>
              <div className="sbc-kyc-form">
                <label className="sbc-set-field">
                  <span>Full name (as per PAN)</span>
                  <input className="sbc-set-input" value={f.full_name} onChange={set("full_name")} placeholder="Full name" />
                </label>
                <label className="sbc-set-field">
                  <span>PAN</span>
                  <input className="sbc-set-input" value={f.pan} onChange={set("pan")} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: "uppercase" }} />
                </label>
                <label className="sbc-set-field">
                  <span>Aadhaar — last 4 digits</span>
                  <input className="sbc-set-input" value={f.aadhaar_last4} onChange={set("aadhaar_last4")} placeholder="1234" inputMode="numeric" maxLength={4} />
                </label>
                <div className="sbc-kyc-div">Payout bank account</div>
                <label className="sbc-set-field">
                  <span>Account holder name</span>
                  <input className="sbc-set-input" value={f.bank_holder} onChange={set("bank_holder")} placeholder="As per bank records" />
                </label>
                <label className="sbc-set-field">
                  <span>Account number</span>
                  <input className="sbc-set-input" value={f.bank_account} onChange={set("bank_account")} placeholder="Account number" inputMode="numeric" />
                </label>
                <label className="sbc-set-field">
                  <span>IFSC</span>
                  <input className="sbc-set-input" value={f.bank_ifsc} onChange={set("bank_ifsc")} placeholder="HDFC0001234" maxLength={11} style={{ textTransform: "uppercase" }} />
                </label>
                {err && <p className="sbc-kyc-err">{err}</p>}
                <div className="sbc-set-actions">
                  <button className="sbc-set-save" onClick={submit} disabled={saving}>
                    {saving ? "Submitting…" : "Submit for verification"}
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <section className="sbc-dash-sec">
              <div className="sbc-dash-sec-h">Submitted details</div>
              <div className="sbc-dash-links">
                <div className="sbc-dash-link" style={{ cursor: "default" }}><span>🪪</span>{kyc.full_name || "—"}<em></em></div>
                {kyc.pan ? <div className="sbc-dash-link" style={{ cursor: "default" }}><span>#</span>PAN {kyc.pan}<em></em></div> : null}
                {kyc.aadhaar_last4 ? <div className="sbc-dash-link" style={{ cursor: "default" }}><span>🆔</span>Aadhaar ••••{kyc.aadhaar_last4}<em></em></div> : null}
                {kyc.bank_account ? <div className="sbc-dash-link" style={{ cursor: "default" }}><span>🏦</span>A/c ••••{String(kyc.bank_account).slice(-4)} · {kyc.bank_ifsc || ""}<em></em></div> : null}
              </div>
              <p className="sbc-set-foot">Need to change something? Contact support and we&apos;ll reopen your KYC.</p>
            </section>
          )}
        </>
      )}

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
