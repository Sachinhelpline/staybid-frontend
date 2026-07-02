"use client";
// v283 Gap 3 — worker onboarding form. A hospitality pro applies to join the
// StayBid workforce. Submits to /api/host/workforce/apply (status=pending).
// After approval by admin, they sign in at /worker to see assigned jobs.

import { useState } from "react";
import Link from "next/link";

const SKILLS = [
  { v: "housekeeping", l: "Housekeeping" }, { v: "cook", l: "Cook" }, { v: "chef", l: "Chef" },
  { v: "front_desk", l: "Front Desk" }, { v: "manager", l: "Manager" }, { v: "security", l: "Security" },
  { v: "maintenance", l: "Maintenance" }, { v: "gardener", l: "Gardener" }, { v: "driver", l: "Driver" },
  { v: "spa", l: "Spa / Wellness" }, { v: "waiter", l: "Waiter" }, { v: "cleaner", l: "Cleaner" }, { v: "other", l: "Other" },
];
const RATE_UNITS = [{ v: "job", l: "per job" }, { v: "hour", l: "per hour" }, { v: "day", l: "per day" }, { v: "month", l: "per month" }];

export default function WorkforceJoin() {
  const [f, setF] = useState<any>({ skill: "housekeeping", rateUnit: "job", languages: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const submit = async () => {
    setErr("");
    if (!f.name?.trim() || String(f.phone || "").replace(/\D/g, "").length < 10) {
      setErr("Please enter your name and a valid 10-digit phone."); return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/host/workforce/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          languages: String(f.languages || "").split(",").map((s: string) => s.trim()).filter(Boolean),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not submit");
      setDone(true);
    } catch (e: any) { setErr(e?.message || "Could not submit"); }
    finally { setLoading(false); }
  };

  if (done) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: "center" }} className="sb-card-lift sb-fade-in">
          <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-base)", margin: "0 0 8px" }}>Application received!</h1>
          <p style={{ color: "var(--text-soft)", fontSize: 14, lineHeight: 1.6, margin: "0 0 18px" }}>
            Our team will review your profile and verify your details. Once approved you can sign in to see jobs assigned to you.
          </p>
          <Link href="/worker" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>Go to Worker sign-in →</Link>
          <div style={{ marginTop: 12 }}>
            <Link href="/host/workforce" style={{ color: "var(--text-muted)", fontSize: 13 }}>← Back to Workforce</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card} className="sb-fade-in">
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent)", textTransform: "uppercase" }}>StayBid Workforce</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-base)", margin: "6px 0 4px" }}>Join as a hospitality pro</h1>
          <p style={{ color: "var(--text-soft)", fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            Get hired by hotels near you. Set your rate, pick your skill, and manage jobs from your phone.
          </p>
        </div>

        {err && <div style={errBox}>{err}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Field label="Full name *"><input style={inp} value={f.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Your name" /></Field>
          <Field label="Phone (WhatsApp) *" half><input style={inp} inputMode="tel" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile" /></Field>
          <Field label="Email" half><input style={inp} value={f.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="optional" /></Field>
          <Field label="Skill *" half>
            <select style={inp} value={f.skill} onChange={(e) => set("skill", e.target.value)}>
              {SKILLS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </Field>
          <Field label="City" half><input style={inp} value={f.city || ""} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Mussoorie" /></Field>
          <Field label="Locality" half><input style={inp} value={f.locality || ""} onChange={(e) => set("locality", e.target.value)} placeholder="Area / neighbourhood" /></Field>
          <Field label="Rate ₹" half><input style={inp} inputMode="decimal" value={f.rate || ""} onChange={(e) => set("rate", e.target.value)} placeholder="e.g. 800" /></Field>
          <Field label="Rate unit" half>
            <select style={inp} value={f.rateUnit} onChange={(e) => set("rateUnit", e.target.value)}>
              {RATE_UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
            </select>
          </Field>
          <Field label="Languages (comma-separated)"><input style={inp} value={f.languages || ""} onChange={(e) => set("languages", e.target.value)} placeholder="Hindi, English" /></Field>
          <Field label="About you"><textarea rows={3} style={{ ...inp, resize: "vertical" }} value={f.bio || ""} onChange={(e) => set("bio", e.target.value)} placeholder="Experience, specialities…" /></Field>
        </div>

        <button onClick={submit} disabled={loading} style={{ ...btnPrimary, width: "100%", marginTop: 18 }} className="sb-shimmer">
          <span style={{ position: "relative", zIndex: 2 }}>{loading ? "Submitting…" : "Submit application"}</span>
        </button>
        <p style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", margin: "12px 0 0" }}>
          Already registered? <Link href="/worker" style={{ color: "var(--accent)", fontWeight: 600 }}>Sign in to your worker panel →</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, half, children }: { label: string; half?: boolean; children: any }) {
  return (
    <div style={{ width: half ? "calc(50% - 6px)" : "100%" }}>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--text-soft)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100dvh", background: "var(--bg-page)", padding: "24px 14px 80px", display: "flex", justifyContent: "center", alignItems: "flex-start" };
const card: React.CSSProperties = { width: "100%", maxWidth: 560, background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: 18, padding: 22, boxShadow: "var(--shadow-card)" };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--bg-input)", color: "var(--text-base)", fontSize: 14, outline: "none", boxSizing: "border-box" };
const btnPrimary: React.CSSProperties = { padding: "12px 18px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: "pointer", border: "none", background: "linear-gradient(135deg,var(--accent),var(--accent-soft))", color: "#1F1A0F", position: "relative", overflow: "hidden" };
const errBox: React.CSSProperties = { background: "rgba(212,149,131,0.14)", border: "1px solid rgba(212,149,131,0.4)", color: "var(--cozy-rose,#b5675a)", padding: "9px 13px", borderRadius: 10, fontSize: 13, marginBottom: 14 };
