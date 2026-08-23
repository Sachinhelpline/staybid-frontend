"use client";

// Generic HQ Support Desk panel — raise a ticket + WhatsApp-style 2-way chat with
// StayBid HQ. Reused by every party surface (host / creator / trade agent / worker).
// Configure via props: which API base + which localStorage token key it authenticates
// with. Backed by the shared lib/support/desk data layer (one unified HQ store).

import { useState, useEffect, useCallback, useRef } from "react";

interface Ticket { id: string; subject: string; category: string | null; priority: string; status: string; updatedAt: string; createdAt: string }
interface Msg { id: string; body: string | null; fileName: string | null; mine: boolean; authorName: string; createdAt: string }
interface Detail extends Ticket { closedAt: string | null; messages: Msg[] }

const DEFAULT_CATEGORIES = [
  { v: "payment", l: "Payment" },
  { v: "payout", l: "Payout" },
  { v: "booking", l: "Booking" },
  { v: "listing", l: "Listing / Inventory" },
  { v: "technical", l: "Technical" },
  { v: "other", l: "Other" },
];
const PRIORITIES = [{ v: "low", l: "Low" }, { v: "normal", l: "Normal" }, { v: "high", l: "High / Urgent" }];

function fmt(dt: string) { return new Date(dt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

export default function SupportDeskPanel({
  apiBase, tokenKey, accent = "#b8860b", categories = DEFAULT_CATEGORIES, intro,
}: { apiBase: string; tokenKey: string; accent?: string; categories?: { v: string; l: string }[]; intro?: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ subject: "", category: "", priority: "normal", message: "" });
  const [creating, setCreating] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const token = () => { try { return typeof window !== "undefined" ? localStorage.getItem(tokenKey) || "" : ""; } catch { return ""; } };
  const H = (json = false): Record<string, string> => { const h: Record<string, string> = { Authorization: `Bearer ${token()}` }; if (json) h["Content-Type"] = "application/json"; return h; };

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(apiBase, { headers: H() }); const d = await r.json(); setTickets(d.tickets || []); }
    catch { /* ignore */ } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try { const r = await fetch(`${apiBase}/${id}`, { headers: H() }); if (r.ok) setDetail(await r.json()); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId, loadDetail]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages.length]);

  async function create() {
    if (!form.subject.trim()) { alert("Subject likhein"); return; }
    setCreating(true);
    try {
      const r = await fetch(apiBase, { method: "POST", headers: H(true), body: JSON.stringify({ subject: form.subject.trim(), category: form.category || undefined, priority: form.priority, message: form.message.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) { alert(d?.error || "Ticket nahi bana"); return; }
      setForm({ subject: "", category: "", priority: "normal", message: "" });
      await load(); if (d.id) setOpenId(d.id);
    } catch { alert("Ticket nahi bana"); } finally { setCreating(false); }
  }
  async function send() {
    if (!reply.trim() || !openId || sending) return;
    setSending(true);
    try { const r = await fetch(`${apiBase}/${openId}`, { method: "POST", headers: H(true), body: JSON.stringify({ body: reply.trim() }) }); if (r.ok) { setReply(""); await loadDetail(openId); await load(); } }
    catch { /* ignore */ } finally { setSending(false); }
  }
  async function download(msgId: string) {
    if (!openId) return;
    try { const r = await fetch(`${apiBase}/${openId}/file?msgId=${encodeURIComponent(msgId)}`, { headers: H() }); const d = await r.json(); if (d?.url) window.open(d.url, "_blank", "noopener"); } catch { /* ignore */ }
  }

  const card: React.CSSProperties = { border: "1px solid rgba(120,120,120,0.2)", background: "#fff", borderRadius: 16 };
  const input: React.CSSProperties = { border: "1px solid rgba(120,120,120,0.28)", borderRadius: 10, padding: "8px 12px", fontSize: 14, width: "100%", color: "#222" };
  const pill = (s: string) => {
    const c: Record<string, string> = { open: "#b45309", in_progress: "#0369a1", resolved: "#047857", closed: "#6b7280" };
    const l: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
    return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, color: c[s] || "#6b7280", border: `1px solid ${c[s] || "#6b7280"}33`, background: `${c[s] || "#6b7280"}12` }}>{l[s] || s}</span>;
  };

  if (openId && detail) {
    return (
      <div style={{ maxWidth: 640 }}>
        <button onClick={() => setOpenId(null)} style={{ fontSize: 13, color: accent, marginBottom: 10, background: "none", border: "none", cursor: "pointer" }}>← Back to tickets</button>
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(120,120,120,0.15)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div><p style={{ fontWeight: 600, color: "#222", margin: 0 }}>{detail.subject}</p><p style={{ fontSize: 12, color: "#888", margin: "2px 0 0" }}>{detail.category ? `${detail.category} · ` : ""}Raised {fmt(detail.createdAt)}</p></div>
            {pill(detail.status)}
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxHeight: "52vh", overflowY: "auto", background: "rgba(120,120,120,0.04)" }}>
            {detail.messages.length === 0 ? <p style={{ fontSize: 14, color: "#888", textAlign: "center", padding: "24px 0" }}>Abhi koi message nahi. Neeche apna sawaal likhein.</p>
              : detail.messages.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "80%", borderRadius: 16, padding: "8px 14px", fontSize: 14, ...(m.mine ? { background: accent, color: "#fff" } : { background: "#fff", border: "1px solid rgba(120,120,120,0.2)", color: "#222" }) }}>
                    {!m.mine && <p style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, margin: "0 0 2px" }}>{m.authorName}</p>}
                    {m.body && <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{m.body}</p>}
                    {m.fileName && <button onClick={() => download(m.id)} style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: m.mine ? "#fff" : accent, padding: 0 }}>📎 {m.fileName}</button>}
                    <p style={{ fontSize: 10, marginTop: 4, marginBottom: 0, color: m.mine ? "rgba(255,255,255,0.7)" : "#aaa" }}>{fmt(m.createdAt)}</p>
                  </div>
                </div>
              ))}
            <div ref={end} />
          </div>
          <div style={{ padding: 12, borderTop: "1px solid rgba(120,120,120,0.15)", display: "flex", gap: 8 }}>
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Apna message likhein…" style={{ ...input, flex: 1 }} />
            <button onClick={send} disabled={sending || !reply.trim()} style={{ borderRadius: 10, background: accent, color: "#fff", padding: "8px 16px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", opacity: sending || !reply.trim() ? 0.5 : 1 }}>{sending ? "…" : "Send"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
      {intro && <p style={{ fontSize: 14, color: "#666", margin: 0 }}>{intro}</p>}
      <div style={{ ...card, padding: 16 }}>
        <p style={{ fontWeight: 600, color: "#222", margin: "0 0 12px" }}>Raise a ticket</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject — apni problem likhein" style={input} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...input, background: "#fff" }}>
              <option value="">Category (optional)</option>
              {categories.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ ...input, background: "#fff" }}>
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </div>
          <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Detail likhein (optional)…" rows={3} style={{ ...input, resize: "none" }} />
          <button onClick={create} disabled={creating} style={{ alignSelf: "flex-start", borderRadius: 10, background: accent, color: "#fff", padding: "8px 18px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", opacity: creating ? 0.5 : 1 }}>{creating ? "Creating…" : "Submit ticket"}</button>
        </div>
      </div>
      <div>
        <p style={{ fontWeight: 600, color: "#222", margin: "0 0 8px" }}>My tickets</p>
        {loading ? <p style={{ fontSize: 14, color: "#888" }}>Loading…</p>
          : tickets.length === 0 ? <p style={{ fontSize: 14, color: "#888", border: "1px dashed rgba(120,120,120,0.3)", borderRadius: 12, padding: "24px 0", textAlign: "center" }}>Abhi koi ticket nahi. Upar se naya raise karein.</p>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tickets.map((t) => (
                  <button key={t.id} onClick={() => setOpenId(t.id)} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 500, color: "#222", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</p>
                      <p style={{ fontSize: 12, color: "#888", margin: "2px 0 0" }}>{t.category ? `${t.category} · ` : ""}{fmt(t.updatedAt)}{t.priority === "high" ? " · 🔴 Urgent" : ""}</p>
                    </div>
                    {pill(t.status)}
                  </button>
                ))}
              </div>}
      </div>
    </div>
  );
}
