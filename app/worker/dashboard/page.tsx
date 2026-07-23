"use client";
// v283 Gap 3 — worker dashboard. My assigned jobs (accept / start / complete /
// decline), availability toggle, and a profile editor. Session: sb_worker_token.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import SwitchExperienceButton from "@/components/SwitchExperienceButton";
import { AppTourButton, HelpSupportButton } from "@/components/HelpLauncher";

const inr = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);
const when = (s?: string) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null);

const STATUS_STYLE: Record<string, { bg: string; c: string; label: string }> = {
  requested:  { bg: "rgba(245,158,11,0.16)", c: "#b5791f", label: "New request" },
  assigned:   { bg: "rgba(61,156,245,0.16)", c: "#2f6bb0", label: "Accepted" },
  in_progress:{ bg: "rgba(168,85,247,0.16)", c: "#7c3fb5", label: "In progress" },
  completed:  { bg: "rgba(34,197,94,0.16)", c: "#2f8f52", label: "Completed" },
  cancelled:  { bg: "rgba(212,149,131,0.16)", c: "#b5675a", label: "Cancelled" },
};

// worker-side actions available per current status
const ACTIONS: Record<string, { action: string; label: string; primary?: boolean; danger?: boolean }[]> = {
  requested:   [{ action: "accept", label: "✓ Accept", primary: true }, { action: "decline", label: "Decline", danger: true }],
  assigned:    [{ action: "start", label: "▶ Start job", primary: true }, { action: "decline", label: "Cancel", danger: true }],
  in_progress: [{ action: "complete", label: "✓ Mark complete", primary: true }],
};

export default function WorkerDashboard() {
  const router = useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({ total: 0, active: 0, completed: 0, earnings: 0 });
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);

  const tok = () => (typeof window !== "undefined" ? localStorage.getItem("sb_worker_token") || "" : "");
  const authH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });

  const load = useCallback(() => {
    if (!tok()) { router.replace("/worker"); return; }
    setLoading(true); setErr("");
    Promise.all([
      fetch("/api/worker/jobs", { headers: authH() }).then((r) => r.json()),
      fetch("/api/worker/profile", { headers: authH() }).then((r) => r.json()),
    ])
      .then(([j, p]) => {
        if (j?.error && /sign in|registered/i.test(j.error)) { localStorage.removeItem("sb_worker_token"); router.replace("/worker"); return; }
        setJobs(j.jobs || []); setKpis(j.kpis || {}); setWorker(p.worker || null);
      })
      .catch((e) => setErr(e?.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);
  useEffect(load, [load]);

  const act = async (id: string, action: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/worker/jobs/${id}`, { method: "PATCH", headers: authH(), body: JSON.stringify({ action }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Action failed");
      load();
    } catch (e: any) { setErr(e?.message || "Action failed"); }
    finally { setBusy(""); }
  };

  const toggleAvail = async () => {
    if (!worker) return;
    setBusy("avail");
    try {
      const r = await fetch("/api/worker/profile", { method: "PATCH", headers: authH(), body: JSON.stringify({ available: !worker.available }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Failed");
      setWorker(d.worker);
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(""); }
  };

  const signOut = () => { localStorage.removeItem("sb_worker_token"); localStorage.removeItem("sb_worker"); router.replace("/worker"); };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-page)", padding: "18px 14px 90px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={avatar}>{worker?.avatar_url ? <img src={worker.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : (worker?.name || "?").slice(0, 1)}</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-base)" }}>{worker?.name || "Worker"}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-soft)", textTransform: "capitalize" }}>{(worker?.skill || "").replace(/_/g, " ")}{worker?.city ? ` · ${worker.city}` : ""}{worker?.verified ? " · ✓ Verified" : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AppTourButton style={btnGhost} label="Tour" />
            <HelpSupportButton style={btnGhost} label="Help" />
            <SwitchExperienceButton style={btnGhost} label="Switch" />
            <button onClick={signOut} style={btnGhost}>Sign out</button>
          </div>
        </div>

        {err && <div style={errBox}>{err}</div>}

        {/* Availability + edit */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={toggleAvail} disabled={busy === "avail"} style={{ ...pill, background: worker?.available ? "rgba(34,197,94,0.16)" : "var(--bg-pill)", color: worker?.available ? "#2f8f52" : "var(--text-soft)", border: `1px solid ${worker?.available ? "rgba(34,197,94,0.4)" : "var(--border-strong)"}` }}>
            {worker?.available ? "🟢 Available for jobs" : "⚪ Not available"} · tap to toggle
          </button>
          <button onClick={() => setEditing(true)} style={{ ...pill, background: "var(--bg-pill)", color: "var(--text-base)", border: "1px solid var(--border-strong)" }}>✎ Edit profile</button>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          <Kpi label="Active" value={String(kpis.active ?? 0)} />
          <Kpi label="Completed" value={String(kpis.completed ?? 0)} />
          <Kpi label="Earnings" value={inr(kpis.earnings)} />
        </div>

        {/* Jobs */}
        <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--text-base)", margin: "0 0 10px" }}>My jobs</h2>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ ...cardBox, textAlign: "center", color: "var(--text-muted)", padding: 30 }}>No jobs assigned yet. Keep your availability on — hotels near you will find you.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jobs.map((j) => {
              const st = STATUS_STYLE[j.status] || STATUS_STYLE.requested;
              const acts = ACTIONS[j.status] || [];
              return (
                <div key={j.id} style={cardBox} className="sb-card-lift">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-base)", textTransform: "capitalize" }}>{(j.skill || "job").replace(/_/g, " ")}</div>
                      {j._hotel?.name && <div style={{ fontSize: 12.5, color: "var(--text-soft)" }}>🏨 {j._hotel.name}{j._hotel.city ? ` · ${j._hotel.city}` : ""}</div>}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: st.bg, color: st.c, whiteSpace: "nowrap" }}>{st.label}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8, fontSize: 12.5, color: "var(--text-soft)" }}>
                    {j.amount != null && <span>💰 {inr(j.amount)}</span>}
                    {when(j.scheduled_at) && <span>📅 {when(j.scheduled_at)}</span>}
                    {j.duration_hint && <span>⏱ {j.duration_hint}</span>}
                    {j.contact?.name && <span>👤 {j.contact.name}{j.contact.phone ? ` · ${j.contact.phone}` : ""}</span>}
                  </div>
                  {j.notes && <div style={{ fontSize: 12.5, color: "var(--text-soft)", marginTop: 6, lineHeight: 1.5 }}>“{j.notes}”</div>}
                  {acts.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      {acts.map((a) => (
                        <button key={a.action} disabled={busy === j.id} onClick={() => act(j.id, a.action)}
                          style={a.primary ? btnPrimarySm : a.danger ? btnDangerSm : btnGhostSm}>{a.label}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && worker && <ProfileEditor worker={worker} authH={authH} onClose={() => setEditing(false)} onSaved={(w) => { setWorker(w); setEditing(false); }} />}
    </div>
  );
}

function ProfileEditor({ worker, authH, onClose, onSaved }: { worker: any; authH: () => any; onClose: () => void; onSaved: (w: any) => void }) {
  const [f, setF] = useState<any>({
    bio: worker.bio || "", city: worker.city || "", locality: worker.locality || "",
    rate: worker.rate ?? "", rate_unit: worker.rate_unit || "job", avatar_url: worker.avatar_url || "",
    languages: Array.isArray(worker.languages) ? worker.languages.join(", ") : "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/worker/profile", {
        method: "PATCH", headers: authH(),
        body: JSON.stringify({ ...f, languages: String(f.languages || "").split(",").map((s: string) => s.trim()).filter(Boolean) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Save failed");
      onSaved(d.worker);
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 14px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardBox, width: "100%", maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-base)", margin: 0 }}>Edit profile</h3>
          <button onClick={onClose} style={btnGhostSm}>✕</button>
        </div>
        {err && <div style={errBox}>{err}</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Fld label="City" half><input style={inp} value={f.city} onChange={(e) => set("city", e.target.value)} /></Fld>
          <Fld label="Locality" half><input style={inp} value={f.locality} onChange={(e) => set("locality", e.target.value)} /></Fld>
          <Fld label="Rate ₹" half><input style={inp} inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} /></Fld>
          <Fld label="Rate unit" half>
            <select style={inp} value={f.rate_unit} onChange={(e) => set("rate_unit", e.target.value)}>
              {["job", "hour", "day", "month"].map((u) => <option key={u} value={u}>per {u}</option>)}
            </select>
          </Fld>
          <Fld label="Languages (comma-separated)"><input style={inp} value={f.languages} onChange={(e) => set("languages", e.target.value)} /></Fld>
          <Fld label="Avatar URL"><input style={inp} value={f.avatar_url} onChange={(e) => set("avatar_url", e.target.value)} placeholder="https://…" /></Fld>
          <Fld label="About you"><textarea rows={3} style={{ ...inp, resize: "vertical" }} value={f.bio} onChange={(e) => set("bio", e.target.value)} /></Fld>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={btnGhostSm}>Cancel</button>
          <button onClick={save} disabled={saving} style={btnPrimarySm}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div style={{ ...cardBox, padding: 14, textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-base)" }}>{value}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{label}</div></div>;
}
function Fld({ label, half, children }: { label: string; half?: boolean; children: any }) {
  return <div style={{ width: half ? "calc(50% - 5px)" : "100%" }}><label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-soft)", marginBottom: 4 }}>{label}</label>{children}</div>;
}

const avatar: React.CSSProperties = { width: 46, height: 46, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),var(--accent-soft))", color: "#1F1A0F", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, textTransform: "uppercase", overflow: "hidden", flex: "0 0 auto" };
const cardBox: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-soft)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-soft)" };
const pill: React.CSSProperties = { padding: "9px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--bg-input)", color: "var(--text-base)", fontSize: 13.5, outline: "none", boxSizing: "border-box" };
const btnPrimarySm: React.CSSProperties = { padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none", background: "linear-gradient(135deg,var(--accent),var(--accent-soft))", color: "#1F1A0F" };
const btnGhostSm: React.CSSProperties = { padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-soft)" };
const btnDangerSm: React.CSSProperties = { padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(212,149,131,0.5)", background: "transparent", color: "var(--cozy-rose,#b5675a)" };
const btnGhost: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-soft)" };
const errBox: React.CSSProperties = { background: "rgba(212,149,131,0.14)", border: "1px solid rgba(212,149,131,0.4)", color: "var(--cozy-rose,#b5675a)", padding: "9px 13px", borderRadius: 10, fontSize: 13, marginBottom: 14 };
