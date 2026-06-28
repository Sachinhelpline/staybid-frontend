"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HOST_CHANNELS, HOST_CHANNEL_STATUS, type HostChannel } from "@/lib/host/modules";

interface Connection {
  id: string; channel: string; property_ref?: string; listing_url?: string;
  status?: string; last_sync_at?: string; created_at?: string;
}

export default function HostChannels() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connect, setConnect] = useState<HostChannel | null>(null);

  function load() {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    fetch("/api/host/channels", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => setConnections(d.connections || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const channelByKey = Object.fromEntries(HOST_CHANNELS.map((c) => [c.key, c]));

  return (
    <div className="hostos-discovery">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-5 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mt-3 mb-3"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🔗 Channel Manager</span>
        <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.9rem,5vw,3rem)", color: "var(--text-base)" }}>
          All your channels. <span style={{ color: "var(--accent)" }}>One dashboard.</span>
        </h1>
        <p className="mt-3 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          List on Booking.com, Airbnb, MakeMyTrip & every major OTA — synced in real time.
          One calendar, one rate plan, zero double-bookings. We wire up the sync; you just earn.
        </p>
      </section>

      {/* Your connections */}
      {!loading && connections.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-2">
          <h2 className="font-display text-lg mb-2" style={{ color: "var(--text-base)" }}>Your channels</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sb-stagger">
            {connections.map((c) => {
              const meta = channelByKey[c.channel];
              const st = HOST_CHANNEL_STATUS[c.status || "requested"] || HOST_CHANNEL_STATUS.requested;
              return (
                <div key={c.id} className="sb-card-lift rounded-2xl p-4 flex items-center gap-3"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                  <div className="text-2xl">{meta?.icon || "🔗"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate" style={{ color: "var(--text-base)" }}>{meta?.name || c.channel}</div>
                    {c.property_ref && <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{c.property_ref}</div>}
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                    style={{ background: `${st.tone}1a`, color: st.tone }}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Supported OTAs */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-28">
        <h2 className="font-display text-lg mb-2" style={{ color: "var(--text-base)" }}>
          {connections.length > 0 ? "Add another channel" : "Supported channels"}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sb-stagger">
          {HOST_CHANNELS.map((ch) => (
            <div key={ch.key} className="sb-card-lift h-full rounded-2xl p-5 flex flex-col"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: `${ch.accent}1a` }}>{ch.icon}</div>
                <div className="font-display text-lg" style={{ color: "var(--text-base)" }}>{ch.name}</div>
              </div>
              <p className="text-sm mt-2 flex-1" style={{ color: "var(--text-soft)" }}>{ch.blurb}</p>
              <button onClick={() => setConnect(ch)}
                className="mt-4 w-full px-4 py-2.5 rounded-full text-white font-semibold text-sm"
                style={{ background: "linear-gradient(135deg,#1d4ed8,#1e40af)" }}>Connect {ch.name}</button>
            </div>
          ))}
        </div>
      </section>

      {connect && <ConnectSheet channel={connect} onClose={() => setConnect(null)} onDone={load} />}

      <style jsx global>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}

function ConnectSheet({ channel, onClose, onDone }: { channel: HostChannel; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [propertyRef, setPropertyRef] = useState("");
  const [listingUrl, setListingUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 8) { setErr("Enter a valid name & phone."); setState("error"); return; }
    setState("sending"); setErr("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/channels/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ channel: channel.key, name, phone, propertyRef, listingUrl, message: msg }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Could not send.");
      setState("done"); onDone();
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
            <div className="font-display text-2xl">Request received!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              Our team will set up your <b>{channel.name}</b> sync and confirm once it's live.
            </p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(135deg,#1d4ed8,#1e40af)" }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="font-display text-xl flex items-center gap-2"><span>{channel.icon}</span> Connect {channel.name}</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <div className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>{channel.blurb}</div>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={propertyRef} onChange={(e) => setPropertyRef(e.target.value)} placeholder="Property name / city (optional)" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} placeholder="Existing listing URL (optional)" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Anything we should know? (optional)" rows={2} className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>
            {state === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{err}</div>}
            <button onClick={submit} disabled={state === "sending"}
              className="w-full mt-4 px-6 py-3 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#1d4ed8,#1e40af)" }}>
              {state === "sending" ? "Sending…" : "Request connection"}
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
