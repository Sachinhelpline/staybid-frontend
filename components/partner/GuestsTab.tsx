"use client";
//
// v170 — Guest CRM (partner panel, Phase 3).
//
// Aggregates every guest the hotel has hosted — from accepted bids +
// front-desk reservations — into one profile per person (deduped by
// phone). Shows stay history, total spend, repeat-guest tag, and lets
// the partner add tags / a VIP flag / private notes (persisted via
// /api/partner/guests).
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Users, ArrowLeft, TriangleAlert } from "lucide-react";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }
function nights(a?: string, b?: string) {
  if (!a || !b) return 1;
  return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}
function fmtD(s?: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function normPhone(p: any) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}
// Stable identity key: phone when we have one, else the lowercased name.
function guestKey(name: any, phone: any) {
  const np = normPhone(phone);
  if (np.length >= 10) return "p:" + np;
  const nm = String(name || "").trim().toLowerCase();
  return nm ? "n:" + nm : "";
}

const TAG_OPTIONS = ["Regular", "Corporate", "Family", "Honeymoon", "Solo traveller", "Long-stay", "Group"];

export default function GuestsTab({ bids, hotelId }: { bids: any[]; hotelId: string }) {
  const [reservations, setReservations] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [provisioned, setProvisioned] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "stays" | "spend">("recent");
  const [vipOnly, setVipOnly] = useState(false);
  const [selKey, setSelKey] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/guests?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      const m: Record<string, any> = {};
      (d.profiles || []).forEach((p: any) => { m[p.guest_key] = p; });
      setProfiles(m);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
  }, [hotelId]);

  useEffect(() => {
    if (!hotelId) return;
    fetch(`/api/partner/walk-in?hotelId=${encodeURIComponent(hotelId)}`, {
      headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setReservations((d.reservations || []).filter((x: any) => x.source === "walk_in" || x.source === "group")))
      .catch(() => {});
    loadProfiles();
  }, [hotelId, loadProfiles]);

  // ── aggregate guests from accepted bids + reservations ────────────────────
  const guests = useMemo(() => {
    const map: Record<string, any> = {};
    const add = (name: string, phone: string, email: string, date: string, spend: number, kind: string, label: string) => {
      const key = guestKey(name, phone);
      if (!key) return;
      if (!map[key]) map[key] = { key, name: "", phone: "", email: "", stays: 0, spend: 0, first: "", last: "", history: [] as any[] };
      const g = map[key];
      if (name && name.trim()) g.name = name.trim();
      if (phone) g.phone = phone;
      if (email) g.email = email;
      g.stays++; g.spend += spend;
      if (date) {
        if (!g.first || date < g.first) g.first = date;
        if (!g.last || date > g.last) g.last = date;
      }
      g.history.push({ date, spend, kind, label });
    };

    bids.filter((b) => b.status === "ACCEPTED").forEach((b) => {
      const n = nights(b.checkIn, b.checkOut);
      add(
        b.guestName || b.customer?.name || "",
        b.guestPhone || b.customer?.phone || "",
        "",
        String(b.checkIn || b.createdAt || "").slice(0, 10),
        Number(b.counterAmount || b.amount || 0) * n,
        "Booking",
        `${b.room?.name || b.room?.type || "Room"} · ${n} night${n > 1 ? "s" : ""}`
      );
    });
    reservations.forEach((r) => {
      const n = nights(r.fromDate, r.toDate);
      add(
        r.guestName || "", r.guestPhone || "", r.guestEmail || "",
        String(r.fromDate || "").slice(0, 10),
        Number(r.amount || 0) * n,
        "Reservation",
        `${n} night${n > 1 ? "s" : ""}`
      );
    });

    Object.values(map).forEach((g: any) => g.history.sort((a: any, b: any) => (b.date || "").localeCompare(a.date || "")));
    return Object.values(map) as any[];
  }, [bids, reservations]);

  const merged = useMemo(() =>
    guests.map((g: any) => {
      const p = profiles[g.key];
      return {
        ...g,
        tags: Array.isArray(p?.tags) ? p.tags : [],
        vip: !!p?.vip,
        note: p?.note || "",
        repeat: g.stays >= 2,
      };
    }), [guests, profiles]);

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let out = merged.filter((g) => {
      if (vipOnly && !g.vip) return false;
      if (qq && !`${g.name} ${g.phone}`.toLowerCase().includes(qq)) return false;
      return true;
    });
    out = out.sort((a, b) =>
      sort === "spend" ? b.spend - a.spend :
      sort === "stays" ? b.stays - a.stays :
      (b.last || "").localeCompare(a.last || "")
    );
    return out;
  }, [merged, q, sort, vipOnly]);

  const selected = merged.find((g) => g.key === selKey) || null;

  async function saveProfile(g: any, patch: { tags?: string[]; vip?: boolean; note?: string }) {
    const next = {
      tags: patch.tags ?? g.tags,
      vip: patch.vip ?? g.vip,
      note: patch.note ?? g.note,
    };
    // optimistic
    setProfiles((p) => ({
      ...p,
      [g.key]: { ...(p[g.key] || {}), guest_key: g.key, tags: next.tags, vip: next.vip, note: next.note },
    }));
    try {
      const r = await fetch("/api/partner/guests", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId, guestKey: g.key, name: g.name, phone: g.phone, email: g.email, ...next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        if (r.status === 412) { setProvisioned(false); alert("Guest CRM isn't set up in the DB yet — apply the migration first."); }
        else alert("❌ " + (d.error || "Save failed"));
        loadProfiles();
      }
    } catch { alert("❌ Network error"); loadProfiles(); }
  }

  // ── detail view ───────────────────────────────────────────────────────────
  if (selected) {
    return (
      <GuestDetail
        g={selected}
        onBack={() => setSelKey(null)}
        onSave={(patch) => saveProfile(selected, patch)}
      />
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  return (
    <div className="fade-up">
      <div className="mb-4">
        <h2 className="sec-title text-xl">Guest CRM</h2>
        <p className="text-[0.7rem] text-luxury-500 mt-0.5">{merged.length} guests · stay history, repeat tags &amp; notes.</p>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 bg-amber-50 border-amber-200">
          <p className="text-[0.74rem] text-amber-800 font-semibold inline-flex items-center gap-1.5"><TriangleAlert size={13} strokeWidth={2.3} aria-hidden /> Guest CRM storage isn't set up yet</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            Apply <span className="font-mono">migrations/2026-05-21-guest-profiles.sql</span> — until then tags/notes won't save.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3.5 flex-wrap">
        {([["recent", "Recent"], ["stays", "Most stays"], ["spend", "Top spend"]] as const).map(([id, lbl]) => (
          <button key={id} onClick={() => setSort(id)}
            className={`text-[0.72rem] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
              sort === id ? "text-white border-transparent" : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
            }`}
            style={sort === id ? { background: "radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" } : undefined}>
            {lbl}
          </button>
        ))}
        <button onClick={() => setVipOnly((v) => !v)}
          className={`text-[0.72rem] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
            vipOnly ? "bg-amber-500 text-white border-amber-500" : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
          }`}>
          ★ VIP only
        </button>
        <div className="relative flex-1 min-w-[150px]">
          <Search size={13} strokeWidth={2.4} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-luxury-400 pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Name / phone" className="inp-p w-full pl-7" />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card-p text-center py-10">
          <Users size={30} strokeWidth={1.8} aria-hidden className="mx-auto mb-2 text-luxury-400" />
          <p className="text-luxury-600 font-semibold text-sm">
            {merged.length === 0 ? "No guest records yet" : "Nothing matches this filter"}
          </p>
          {merged.length === 0 && (
            <p className="text-luxury-400 text-xs mt-0.5">Guests appear here automatically as bookings and reservations come in.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((g) => (
            <button key={g.key} onClick={() => setSelKey(g.key)}
              className="card-p card-tight w-full text-left flex items-center gap-3 hover:-translate-y-0.5 transition-transform">
              <div className="w-9 h-9 rounded-full bg-gold-100 flex items-center justify-center text-xs font-bold text-gold-700 shrink-0">
                {(g.name || "G").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[0.84rem] font-bold text-luxury-900 truncate">{g.name || "Guest"}</p>
                  {g.vip && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">★ VIP</span>}
                  {g.repeat && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Repeat</span>}
                </div>
                <p className="text-[0.66rem] text-luxury-500 truncate">
                  {g.phone || "no phone"} · {g.stays} stay{g.stays !== 1 ? "s" : ""} · last {fmtD(g.last)}
                </p>
              </div>
              <p className="text-[0.8rem] font-bold text-luxury-900 shrink-0">{fmtCur(g.spend)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Guest detail ────────────────────────────────────────────────────────────
function GuestDetail({
  g, onBack, onSave,
}: {
  g: any;
  onBack: () => void;
  onSave: (patch: { tags?: string[]; vip?: boolean; note?: string }) => void;
}) {
  const [note, setNote] = useState(g.note || "");
  const [noteDirty, setNoteDirty] = useState(false);

  return (
    <div className="fade-up">
      <button onClick={onBack} className="text-[0.74rem] font-bold text-gold-600 mb-2.5 inline-flex items-center gap-1"><ArrowLeft size={13} strokeWidth={2.4} aria-hidden /> All guests</button>

      <div className="card-p mb-3">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-gold-100 flex items-center justify-center text-base font-bold text-gold-700 shrink-0">
            {(g.name || "G").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>{g.name || "Guest"}</p>
              {g.vip && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">★ VIP</span>}
              {g.repeat && <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Repeat guest</span>}
            </div>
            <p className="text-[0.7rem] text-luxury-500">{g.phone || "no phone"}{g.email ? ` · ${g.email}` : ""}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {[
            { k: "Stays", v: String(g.stays) },
            { k: "Total spend", v: fmtCur(g.spend) },
            { k: "First seen", v: fmtD(g.first) },
          ].map((s) => (
            <div key={s.k} className="bg-luxury-50 rounded-lg px-2.5 py-1.5">
              <p className="text-[0.63rem] text-luxury-400 uppercase tracking-wider font-bold">{s.k}</p>
              <p className="text-[0.78rem] font-bold text-luxury-900 truncate">{s.v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* tags + VIP */}
      <div className="card-p mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[0.78rem] font-bold text-luxury-900">Tags</p>
          <button onClick={() => onSave({ vip: !g.vip })}
            className={`text-[0.68rem] font-bold px-2.5 py-1 rounded-lg border transition-all ${
              g.vip ? "bg-amber-500 text-white border-amber-500" : "bg-white text-luxury-500 border-luxury-200"
            }`}>
            ★ {g.vip ? "VIP guest" : "Mark VIP"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAG_OPTIONS.map((tg) => {
            const on = g.tags.includes(tg);
            return (
              <button key={tg}
                onClick={() => onSave({ tags: on ? g.tags.filter((x: string) => x !== tg) : [...g.tags, tg] })}
                className={`text-[0.68rem] font-semibold px-2.5 py-1 rounded-full border transition-all ${
                  on ? "bg-gold-500 text-white border-gold-500" : "bg-white text-luxury-500 border-luxury-200 hover:border-gold-300"
                }`}>
                {on ? "✓ " : ""}{tg}
              </button>
            );
          })}
        </div>
      </div>

      {/* notes */}
      <div className="card-p mb-3">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Private notes</p>
        <textarea value={note} rows={3}
          onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
          placeholder="Preferences, allergies, special instructions…"
          className="inp-p resize-none" />
        {noteDirty && (
          <button onClick={() => { onSave({ note }); setNoteDirty(false); }} className="btn-gold mt-2">Save note</button>
        )}
      </div>

      {/* stay history */}
      <div className="card-p">
        <p className="text-[0.78rem] font-bold text-luxury-900 mb-2">Stay history</p>
        {g.history.length === 0 ? (
          <p className="text-xs text-luxury-400 py-2">No stay records.</p>
        ) : (
          <div className="space-y-1.5">
            {g.history.map((h: any, i: number) => (
              <div key={i} className="flex items-center gap-2.5 py-1 border-b border-luxury-50 last:border-0">
                <span className="text-[0.63rem] font-bold px-1.5 py-0.5 rounded-sm bg-luxury-100 text-luxury-600 shrink-0">{h.kind}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[0.74rem] font-semibold text-luxury-800 truncate">{h.label}</p>
                  <p className="text-[0.63rem] text-luxury-400">{fmtD(h.date)}</p>
                </div>
                <p className="text-[0.76rem] font-bold text-luxury-900 shrink-0">{fmtCur(h.spend)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
