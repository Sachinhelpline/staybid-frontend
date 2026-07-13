"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — List your property (customer onboarding)  (v312)
//
// The CUSTOMER half of the shared-form unification. Uses the SAME
// <CircleOnboardForm> the admin editor uses ("dono ko almost same rakho, alag
// alag build mat kro") — the ONLY difference is the caller: this route POSTs to
// /api/circle/onboard which saves status='pending' (needs admin approval before
// it enters the /circle feed), whereas the admin editor publishes directly.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import CircleOnboardForm, { type CircleFormSubmit } from "@/components/circle/CircleOnboardForm";

type Submission = {
  id: string;
  title: string;
  city: string;
  status: string;
  monthly_rate?: number;
  created_at: string;
};

const STATUS_UI: Record<string, { label: string; cls: string }> = {
  pending: { label: "⏳ Under review", cls: "wait" },
  active: { label: "✅ Live in StayCircle", cls: "ok" },
  sold_out: { label: "🔒 Sold out", cls: "ok" },
  coming_soon: { label: "🔜 Coming soon", cls: "wait" },
  inactive: { label: "⏸ Inactive", cls: "bad" },
  rejected: { label: "⚠️ Not approved", cls: "bad" },
};

export default function CircleOnboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const loadSubs = useCallback(() => {
    const token = localStorage.getItem("sb_token");
    if (!token) { setLoading(false); return; }
    fetch("/api/circle/onboard", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setSubs(Array.isArray(d?.submissions) ? d.submissions : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      redirectToSignIn(router, { route: "/circle/onboard" });
      return;
    }
    loadSubs();
  }, [user, authLoading, router, loadSubs]);

  const handleSubmit = async (payload: CircleFormSubmit) => {
    setErr("");
    setSubmitting(true);
    const token = localStorage.getItem("sb_token");
    try {
      const r = await fetch("/api/circle/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...payload,
          owner_contact: { name: user?.name || "", phone: user?.phone || "" },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(d?.error || "Couldn't submit your property. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setSubmitting(false);
      loadSubs();
    } catch {
      setErr("Network error — please check your connection and try again.");
      setSubmitting(false);
    }
  };

  if (authLoading || (!user && loading)) {
    return (
      <div className="sbc-onb-wrap">
        <div className="sbc-onb-loading">Loading…</div>
      </div>
    );
  }
  if (!user) return null; // redirecting to sign-in

  return (
    <div className="sbc-onb-wrap">
      {/* hero */}
      <div className="sbc-onb-hero sb-fade-in">
        <div className="sbc-onb-eyebrow">🏡 StayCircle™ · List your property</div>
        <h1 className="sbc-onb-title">Put your property in front of investors</h1>
        <p className="sbc-onb-sub">
          Add your property, its room categories and expected monthly income. Our team
          reviews every listing before it goes live in the StayCircle investment
          feed — usually within 1–2 working days.
        </p>
      </div>

      {done ? (
        <div className="sbc-onb-card sbc-onb-success sb-fade-in">
          <div className="sbc-onb-success-icon">🎉</div>
          <h2 className="sbc-onb-success-title">Submitted for review</h2>
          <p className="sbc-onb-success-sub">
            Thanks! Your property is now with our team. We'll review the details
            and get it live in the StayCircle feed shortly — you'll see it below
            once it's approved.
          </p>
          <div className="sbc-onb-success-actions">
            <button className="sbc-onb-btn-primary" onClick={() => setDone(false)}>
              ＋ List another property
            </button>
            <Link href="/circle/discover" className="sbc-onb-btn-ghost">
              Browse StayCircle →
            </Link>
          </div>
        </div>
      ) : (
        <div className="sbc-onb-card sb-fade-in">
          <CircleOnboardForm
            variant="public"
            submitting={submitting}
            submitLabel="Submit for review"
            onSubmit={handleSubmit}
          />
          {err && <div className="sbc-onb-err">⚠ {err}</div>}
        </div>
      )}

      {/* my submissions */}
      {subs.length > 0 && (
        <div className="sbc-onb-subs sb-fade-in">
          <div className="sbc-onb-subs-head">Your listings</div>
          <div className="sbc-onb-subs-list">
            {subs.map((s) => {
              const ui = STATUS_UI[s.status] || { label: s.status, cls: "" };
              return (
                <div key={s.id} className="sbc-onb-sub-row sb-card-lift">
                  <div className="sbc-onb-sub-main">
                    <div className="sbc-onb-sub-title">{s.title}</div>
                    <div className="sbc-onb-sub-meta">
                      📍 {s.city}
                      {s.monthly_rate ? ` · from ₹${Number(s.monthly_rate).toLocaleString("en-IN")}/mo` : ""}
                    </div>
                  </div>
                  <span className={`sbc-onb-sub-badge ${ui.cls}`}>{ui.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style jsx global>{`
        .sbc-onb-wrap {
          max-width: 760px;
          margin: 0 auto;
          padding: 20px 16px 80px;
          display: grid;
          gap: 18px;
        }
        .sbc-onb-loading {
          text-align: center;
          padding: 60px 0;
          color: var(--text-muted, #6e5430);
          font-size: 14px;
        }
        .sbc-onb-hero { text-align: center; padding: 8px 0 4px; }
        .sbc-onb-eyebrow {
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--cozy-champagne, #c9a66b);
        }
        .sbc-onb-title {
          font-family: "Cormorant Garamond", Georgia, serif;
          font-style: italic;
          font-size: clamp(1.7rem, 5vw, 2.4rem);
          font-weight: 700;
          color: var(--text-base, #1f1a0f);
          margin: 6px 0 8px;
          line-height: 1.15;
        }
        .sbc-onb-sub {
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--text-soft, #4a3820);
          max-width: 560px;
          margin: 0 auto;
        }
        .sbc-onb-card {
          background: var(--bg-card, #fffcf6);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          border-radius: 18px;
          padding: 20px;
          box-shadow: var(--shadow-card, 0 6px 24px rgba(120, 90, 30, 0.08));
        }
        .sbc-onb-err {
          color: #c0503e;
          font-size: 12.5px;
          font-weight: 600;
          margin-top: 12px;
          text-align: center;
        }
        .sbc-onb-success { text-align: center; padding: 34px 22px; }
        .sbc-onb-success-icon { font-size: 46px; }
        .sbc-onb-success-title {
          font-family: "Cormorant Garamond", Georgia, serif;
          font-style: italic;
          font-size: 1.7rem;
          color: var(--text-base, #1f1a0f);
          margin: 10px 0 6px;
        }
        .sbc-onb-success-sub {
          font-size: 13.5px;
          line-height: 1.55;
          color: var(--text-soft, #4a3820);
          max-width: 460px;
          margin: 0 auto 18px;
        }
        .sbc-onb-success-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .sbc-onb-btn-primary {
          background: var(--cozy-champagne, #c9a66b);
          color: #221a0c;
          border: none;
          border-radius: 12px;
          padding: 12px 22px;
          font-size: 13.5px;
          font-weight: 800;
          cursor: pointer;
        }
        .sbc-onb-btn-ghost {
          display: inline-flex;
          align-items: center;
          background: transparent;
          color: var(--text-soft, #4a3820);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.2));
          border-radius: 12px;
          padding: 12px 18px;
          font-size: 13px;
          font-weight: 700;
          text-decoration: none;
        }
        .sbc-onb-subs { display: grid; gap: 10px; }
        .sbc-onb-subs-head {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--cozy-champagne, #c9a66b);
          padding-left: 2px;
        }
        .sbc-onb-subs-list { display: grid; gap: 8px; }
        .sbc-onb-sub-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          background: var(--bg-card, #fffcf6);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.16));
          border-radius: 14px;
          padding: 12px 14px;
        }
        .sbc-onb-sub-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-base, #1f1a0f);
        }
        .sbc-onb-sub-meta {
          font-size: 11.5px;
          color: var(--text-muted, #6e5430);
          margin-top: 2px;
        }
        .sbc-onb-sub-badge {
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(201, 166, 107, 0.14);
          color: var(--cozy-cocoa, #4a3820);
          white-space: nowrap;
        }
        .sbc-onb-sub-badge.ok { background: rgba(94, 124, 78, 0.16); color: #4a6f4a; }
        .sbc-onb-sub-badge.wait { background: rgba(201, 166, 107, 0.18); color: #8a6a20; }
        .sbc-onb-sub-badge.bad { background: rgba(192, 80, 62, 0.14); color: #a85b4e; }
      `}</style>
    </div>
  );
}
