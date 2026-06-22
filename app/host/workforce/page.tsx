"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Worker {
  id: string; name: string; skill?: string; city?: string; locality?: string;
  rate?: number; rate_unit?: string; rating?: number; jobs_done?: number;
  verified?: boolean; background_checked?: boolean; avatar_url?: string;
  bio?: string; languages?: string[];
}

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

const SKILL_LABEL: Record<string, string> = {
  housekeeping: "Housekeeping", laundry: "Laundry", maintenance: "Maintenance",
  chef: "Chef / Kitchen", guest_support: "Guest Support", transport: "Transport", other: "Other",
};
const SKILL_ICON: Record<string, string> = {
  housekeeping: "🧹", laundry: "🧺", maintenance: "🔧", chef: "👨‍🍳",
  guest_support: "🛎️", transport: "🚗", other: "🧑‍🔧",
};
const UNIT_LABEL: Record<string, string> = { job: "/job", hour: "/hr", day: "/day" };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export default function HostWorkforce() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [city, setCity] = useState("all");
  const [skill, setSkill] = useState("all");
  const [loading, setLoading] = useState(true);
  const [hire, setHire] = useState<Worker | null>(null);

  useEffect(() => {
    fetch("/api/host/workforce")
      .then((r) => r.json())
      .then((d) => { setWorkers(d.workers || []); setCities(d.cities || []); setSkills(d.skills || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => workers.filter((w) =>
    (city === "all" || w.city === city) &&
    (skill === "all" || w.skill === skill),
  ), [workers, city, skill]);

  return (
    <div className="hostos-discovery">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-5 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mt-3 mb-3"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🧑‍🔧 Workforce on Demand</span>
        <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.9rem,5vw,3rem)", color: "var(--text-base)" }}>
          Trained hospitality staff, <span style={{ color: "var(--accent)" }}>on demand.</span>
        </h1>
        <p className="mt-3 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          Verified, background-checked housekeeping, kitchen, maintenance and guest-support staff —
          book per job, per hour, or per day. No long-term contracts.
        </p>
      </section>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3 sticky top-0 z-20" style={{ background: "var(--bg-page)" }}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
          <Chip active={skill === "all"} onClick={() => setSkill("all")}>🧑‍🔧 All roles</Chip>
          {skills.map((s) => <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>{SKILL_ICON[s] || "•"} {SKILL_LABEL[s] || s}</Chip>)}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          <Chip active={city === "all"} onClick={() => setCity("all")}>📍 All cities</Chip>
          {cities.map((c) => <Chip key={c} active={city === c} onClick={() => setCity(c)}>{c}</Chip>)}
        </div>
      </div>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-28">
        {loading ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>Finding staff…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>No staff match these filters.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sb-stagger">
            {shown.map((w) => (
              <WorkerCard key={w.id} w={w} onHire={() => setHire(w)} />
            ))}
          </div>
        )}
      </section>

      {hire && <HireSheet worker={hire} onClose={() => setHire(null)} />}

      <style jsx global>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-full sb-card-lift"
      style={active
        ? { background: "var(--accent)", color: "#fff" }
        : { background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
      {children}
    </button>
  );
}

function WorkerCard({ w, onHire }: { w: Worker; onHire: () => void }) {
  return (
    <div className="sb-card-lift h-full rounded-2xl overflow-hidden flex flex-col p-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 overflow-hidden"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          {w.avatar_url
            ? <img src={w.avatar_url} alt={w.name} loading="lazy" className="w-full h-full object-cover" />
            : initials(w.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold leading-snug truncate" style={{ color: "var(--text-base)" }}>{w.name}</div>
            {w.verified && <span title="Verified" className="text-sm flex-shrink-0">✅</span>}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {SKILL_ICON[w.skill || ""] || "•"} {SKILL_LABEL[w.skill || ""] || w.skill}
            {w.city ? ` · ${w.locality ? `${w.locality}, ` : ""}${w.city}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs" style={{ color: "var(--text-soft)" }}>
            {w.rating != null && <span>⭐ {w.rating.toFixed(1)}</span>}
            {w.jobs_done != null && <span>· {w.jobs_done} jobs</span>}
            {w.background_checked && <span>· 🛡️ Bg-checked</span>}
          </div>
        </div>
      </div>

      {w.bio && <p className="text-sm mt-3 line-clamp-2" style={{ color: "var(--text-soft)" }}>{w.bio}</p>}

      {(w.languages || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {(w.languages || []).slice(0, 4).map((l) => (
            <span key={l} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>{l}</span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-end justify-between">
        <div className="font-display text-xl" style={{ color: "var(--accent)" }}>
          {inr(w.rate)}<span className="text-xs" style={{ color: "var(--text-muted)" }}>{UNIT_LABEL[w.rate_unit || "job"] || "/job"}</span>
        </div>
      </div>
      <button onClick={onHire}
        className="mt-3 w-full px-4 py-2.5 rounded-full text-white font-semibold text-sm"
        style={{ background: "linear-gradient(135deg,#9a3412,#7c2d12)" }}>Hire / Request</button>
    </div>
  );
}

function HireSheet({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationHint, setDurationHint] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 8) { setErr("Enter a valid name & phone."); setState("error"); return; }
    setState("sending"); setErr("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/workforce/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workerId: worker.id, name, phone, scheduledAt, durationHint, message: msg }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Could not send.");
      setState("done");
    } catch (e: any) { setErr(e?.message || "Something went wrong."); setState("error"); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 sm:p-6"
        style={{ background: "var(--bg-card)", color: "var(--text-base)", boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}>
        {state === "done" ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-display text-2xl">Request sent!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              Our team will confirm <b>{worker.name}</b>’s availability and reach out shortly.
            </p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(135deg,#9a3412,#7c2d12)" }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="font-display text-xl">Hire {worker.name}</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
              {SKILL_ICON[worker.skill || ""] || "•"} {SKILL_LABEL[worker.skill || ""] || worker.skill}
              {worker.city ? ` · ${worker.city}` : ""} · {inr(worker.rate)}{UNIT_LABEL[worker.rate_unit || "job"] || "/job"}
            </div>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} placeholder="When do you need them? (e.g. Tomorrow 9 AM)" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={durationHint} onChange={(e) => setDurationHint(e.target.value)} placeholder="Duration (e.g. 4 hours, full day)" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Any details about the job? (optional)" rows={2} className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>
            {state === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{err}</div>}
            <button onClick={submit} disabled={state === "sending"}
              className="w-full mt-4 px-6 py-3 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#9a3412,#7c2d12)" }}>
              {state === "sending" ? "Sending…" : "Send request"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
