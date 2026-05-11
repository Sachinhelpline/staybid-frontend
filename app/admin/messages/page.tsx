"use client";
// Admin → Booking-chat moderation. Lists every conversation in
// booking_messages with hotel + customer + last message preview.
// Click → side drawer expands the full conversation with hide/unhide
// per-message. "Show flagged only" filter surfaces conversations where
// the anti-bypass sanitizer caught contact-info attempts.

import { useEffect, useState } from "react";

type Convo = {
  bid_id: string;
  hotel_id: string;
  customer_id: string;
  hotel?: { name?: string; city?: string } | null;
  customer?: { name?: string; phone?: string } | null;
  last_message: { id: string; sender: string; body: string; created_at: string };
  message_count: number;
  hidden_count: number;
  flagged_count: number;
};

type Message = {
  id: string;
  bid_id: string;
  sender: string;
  sender_id: string;
  body: string;
  read_at?: string | null;
  hidden_at?: string | null;
  created_at: string;
};

export default function AdminMessages() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loading, setLoading] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Convo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true); setErr("");
    const q = new URLSearchParams();
    if (flaggedOnly) q.set("flagged", "1");
    if (search.trim()) q.set("search", search.trim());
    fetch(`/api/admin/messages?${q}`)
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(d.error); setConvos(d?.conversations || []); })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [flaggedOnly]);

  const openConvo = async (c: Convo) => {
    setSelected(c); setDrawerLoading(true);
    try {
      const r = await fetch(`/api/admin/messages?bidId=${encodeURIComponent(c.bid_id)}`);
      const j = await r.json();
      setMessages(j?.messages || []);
    } catch { setMessages([]); }
    finally { setDrawerLoading(false); }
  };

  const toggleHide = async (m: Message) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: m.id, action: m.hidden_at ? "unhide" : "hide" }),
      });
      if (!r.ok) throw new Error("Update failed");
      // Optimistic update
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, hidden_at: m.hidden_at ? null : new Date().toISOString() } : x));
      load(); // refresh counts in the list
    } catch (e: any) {
      alert(e?.message);
    } finally {
      setBusy(false);
    }
  };

  const isFlagged = (body: string) => typeof body === "string" && body.includes("•••••");

  return (
    <div style={{ padding: "24px 28px", fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, color: "#E8EAF0", margin: 0 }}>
            💬 Chat Moderation
          </h1>
          <p style={{ color: "#8A8FA8", fontSize: 13, margin: "6px 0 0" }}>
            All booking_messages · click a row to expand · hide individual messages
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="Search body / bid id…"
            style={{ minWidth: 220, padding: "8px 12px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#E8EAF0", fontFamily: "inherit", fontSize: 12, outline: "none" }} />
          <button onClick={() => setFlaggedOnly((v) => !v)}
            style={{
              padding: "8px 14px", borderRadius: 999,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid",
              ...(flaggedOnly
                ? { background: "rgba(239,68,68,0.18)", color: "#fca5a5", borderColor: "rgba(239,68,68,0.45)" }
                : { background: "rgba(255,255,255,0.04)", color: "#8A8FA8", borderColor: "rgba(255,255,255,0.1)" }),
            }}>
            🚩 Flagged only
          </button>
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>{err}</div>
      )}

      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 30, color: "#8A8FA8", textAlign: "center" }}>Loading…</div>
        ) : convos.length === 0 ? (
          <div style={{ padding: 30, color: "#8A8FA8", textAlign: "center" }}>No conversations match these filters.</div>
        ) : (
          <div style={{ display: "grid" }}>
            {convos.map((c) => {
              const lm = c.last_message;
              const flagged = isFlagged(lm.body);
              return (
                <button key={c.bid_id} onClick={() => openConvo(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", textAlign: "left",
                    background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer", fontFamily: "inherit", color: "#E8EAF0",
                  }}>
                  <div style={{ width: 36, height: 36, borderRadius: 999, background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {(c.customer?.name || "G").slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{c.customer?.name || "Guest"}</span>
                      <span style={{ color: "#8A8FA8", fontSize: 11 }}>↔</span>
                      <span style={{ color: "#8A8FA8", fontSize: 12 }}>{c.hotel?.name || c.hotel_id}</span>
                      {flagged && <span style={{ background: "rgba(239,68,68,0.18)", color: "#fca5a5", fontSize: 10, padding: "1px 8px", borderRadius: 999, border: "1px solid rgba(239,68,68,0.4)" }}>🚩 flagged</span>}
                      {c.hidden_count > 0 && <span style={{ background: "rgba(168,85,247,0.18)", color: "#d8b4fe", fontSize: 10, padding: "1px 8px", borderRadius: 999 }}>{c.hidden_count} hidden</span>}
                    </div>
                    <p style={{ color: "#8A8FA8", fontSize: 12, margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lm.sender === "customer" ? "👤" : "🏨"} {lm.body}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ color: "#8A8FA8", fontSize: 11, margin: 0 }}>{new Date(lm.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    <p style={{ color: "#666876", fontSize: 11, margin: "2px 0 0" }}>{c.message_count} msgs</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Side drawer for full conversation */}
      {selected && (
        <div onClick={() => setSelected(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(7,8,12,0.7)", backdropFilter: "blur(4px)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 480, maxWidth: "92vw", background: "#0F1117", borderLeft: "1px solid rgba(255,255,255,0.08)", height: "100vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ color: "#8A8FA8", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>Conversation</p>
                <p style={{ color: "#E8EAF0", fontSize: 15, fontWeight: 600, margin: "3px 0 0" }}>
                  {selected.customer?.name || "Guest"} ↔ {selected.hotel?.name || selected.hotel_id}
                </p>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#8A8FA8", fontSize: 22, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {drawerLoading ? (
                <p style={{ color: "#8A8FA8", textAlign: "center", padding: 20 }}>Loading messages…</p>
              ) : messages.length === 0 ? (
                <p style={{ color: "#8A8FA8", textAlign: "center", padding: 20 }}>No messages.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {messages.map((m) => {
                    const flagged = isFlagged(m.body);
                    const isHidden = !!m.hidden_at;
                    return (
                      <div key={m.id} style={{ background: isHidden ? "rgba(75,85,99,0.18)" : flagged ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${isHidden ? "rgba(168,85,247,0.4)" : flagged ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.06)"}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ color: "#E8EAF0", fontSize: 11, fontWeight: 700 }}>
                            {m.sender === "customer" ? "👤 Customer" : "🏨 Hotel"}
                          </span>
                          <span style={{ color: "#8A8FA8", fontSize: 10 }}>
                            {new Date(m.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p style={{ color: isHidden ? "#666876" : "#E8EAF0", fontSize: 13, margin: 0, whiteSpace: "pre-wrap", textDecoration: isHidden ? "line-through" : "none" }}>
                          {m.body}
                        </p>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                          {flagged && <span style={{ background: "rgba(239,68,68,0.18)", color: "#fca5a5", fontSize: 10, padding: "1px 8px", borderRadius: 999 }}>🚩 flagged</span>}
                          {isHidden && <span style={{ background: "rgba(168,85,247,0.18)", color: "#d8b4fe", fontSize: 10, padding: "1px 8px", borderRadius: 999 }}>hidden</span>}
                          <div style={{ flex: 1 }} />
                          <button onClick={() => toggleHide(m)} disabled={busy}
                            style={{
                              background: "transparent",
                              border: `1px solid ${isHidden ? "rgba(46,204,113,0.4)" : "rgba(239,68,68,0.4)"}`,
                              color: isHidden ? "#7EEAB1" : "#FF9AA8",
                              borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                            }}>
                            {isHidden ? "Unhide" : "Hide"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
