"use client";

// ═══════════════════════════════════════════════════════════════════════════
// StayCircle™ — Profile & settings  (v294.17, Phase 3)
//
// Circle's OWN profile/settings screen. The dashboard's "Profile & settings"
// row used to jump into the big, complex StayBid customer profile (/profile)
// which was confusing here. This is a simple, self-contained, premium-cozy
// screen: identity (view + inline edit), Circle preferences (local), and a
// secondary link to the full StayBid account for anyone who wants it.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Home, Receipt, Pencil, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const PREFS_KEY = "sb_circle_prefs";
type Prefs = { payoutReminders: boolean; propertyAlerts: boolean; returnsBeforeTax: boolean };
const DEFAULT_PREFS: Prefs = { payoutReminders: true, propertyAlerts: true, returnsBeforeTax: false };

const PREF_ROWS: { key: keyof Prefs; icon: React.ReactNode; label: string; sub: string }[] = [
  { key: "payoutReminders", icon: <CalendarClock size={17} aria-hidden />, label: "Monthly payout reminders", sub: "Get a nudge when your returns are credited" },
  { key: "propertyAlerts",  icon: <Home size={17} aria-hidden />, label: "New property alerts", sub: "Fresh properties matching your interest" },
  { key: "returnsBeforeTax", icon: <Receipt size={17} aria-hidden />, label: "Show returns before tax", sub: "Display indicative gross returns on cards" },
];

export default function CircleProfilePage() {
  const router = useRouter();
  const { user, token, tokenType, login, logout } = useAuth();

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    setName((user?.name || "").trim());
    setEmail((user?.email || "").trim());
  }, [user]);

  const displayName = (user?.name || "").trim() || "Investor";
  const initials = useMemo(
    () => displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "SC",
    [displayName],
  );
  const phone = user?.phone ? String(user.phone).replace(/(\d{2})\d{4,}(\d{2})/, "$1••••$2") : "";

  const togglePref = (k: keyof Prefs) => {
    setPrefs((p) => {
      const next = { ...p, [k]: !p[k] };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  const saveIdentity = async () => {
    const nm = name.trim();
    const em = email.trim();
    if (!nm) return;
    setSaving(true);
    // Best-effort backend update; the local update always applies so the
    // screen is self-contained even when Railway is cold.
    try { await api.updateProfile({ name: nm, email: em || undefined }); } catch { /* noop */ }
    const t = token || (typeof window !== "undefined" ? localStorage.getItem("sb_token") : null);
    if (t && user) login(t, { ...user, name: nm, email: em || user.email }, tokenType);
    setSaving(false);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const doLogout = () => {
    try { logout(); } catch { /* noop */ }
    router.push("/circle");
  };

  return (
    <div className="sbc-dash">
      <header className="sbc-dash-head">
        <Link href="/circle/dashboard" className="sbc-dash-back" aria-label="Back">←</Link>
        <span className="sbc-dash-title">Profile &amp; settings</span>
        <span style={{ width: 34 }} />
      </header>

      {/* identity */}
      <section className="sbc-dash-profile" style={{ flexWrap: "wrap" }}>
        <div className="sbc-dash-ava">{initials}</div>
        <div className="sbc-dash-who">
          <b>{displayName}</b>
          <span>{phone ? `📱 ${phone}` : "StayCircle Partner"}{user?.email ? ` · ${user.email}` : ""}</span>
        </div>
        {user ? (
          <button className="sbc-dash-edit" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : <><Pencil size={13} aria-hidden style={{display:"inline",verticalAlign:"-2px",marginRight:3}} />Edit</>}
          </button>
        ) : (
          <Link href="/auth" className="sbc-dash-edit gold">Sign in</Link>
        )}

        {editing && user && (
          <div className="sbc-set-form">
            <label className="sbc-set-field">
              <span>Name</span>
              <input className="sbc-set-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </label>
            <label className="sbc-set-field">
              <span>Email</span>
              <input className="sbc-set-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
            </label>
            <div className="sbc-set-actions">
              <button className="sbc-set-save" onClick={saveIdentity} disabled={saving || !name.trim()}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
            <p className="sbc-set-note">📱 Your phone number is your login — it can&apos;t be changed here.</p>
          </div>
        )}
      </section>

      {saved && <div className="sbc-set-toast">✓ Profile updated</div>}

      {/* preferences */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">StayCircle preferences</div>
        <div className="sbc-dash-links">
          {PREF_ROWS.map((r) => (
            <button
              key={r.key}
              type="button"
              className="sbc-dash-link sbc-set-row"
              onClick={() => togglePref(r.key)}
              aria-pressed={prefs[r.key]}
            >
              <span>{r.icon}</span>
              <span className="sbc-set-row-txt">
                <b>{r.label}</b>
                <em>{r.sub}</em>
              </span>
              <span className={`sbc-toggle${prefs[r.key] ? " on" : ""}`} aria-hidden><i /></span>
            </button>
          ))}
        </div>
      </section>

      {/* account */}
      <section className="sbc-dash-sec">
        <div className="sbc-dash-sec-h">Account</div>
        <div className="sbc-dash-links">
          <Link href="/profile" className="sbc-dash-link">
            <span><Settings size={15} aria-hidden /></span>Full StayBid account settings<em>›</em>
          </Link>
          {user && (
            <button className="sbc-dash-link danger" onClick={doLogout}>
              <span>↩</span>Sign out<em></em>
            </button>
          )}
        </div>
        <p className="sbc-set-foot">StayCircle keeps your investor profile simple. Advanced options — payment methods, security, connected logins — live in your full StayBid account.</p>
      </section>

      <div style={{ height: "calc(84px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
