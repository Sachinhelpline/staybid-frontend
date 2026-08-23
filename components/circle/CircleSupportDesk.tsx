"use client";

// StayCircle — in-app Support Desk (ticket + 2-way chat with StayBid HQ).
// Backed by /api/circle/support/* (the SAME unified Supabase store the HQ panel
// reads — real 2-way). party_type = 'investor'. Self-contained, additive; the
// FAQ + WhatsApp/email on /circle/support stay as-is above this.

import { useState, useEffect, useCallback, useRef } from "react";

interface Ticket { id: string; subject: string; category: string | null; priority: string; status: string; updatedAt: string; createdAt: string; unread?: boolean }
interface Msg { id: string; body: string | null; fileName: string | null; mine: boolean; authorName: string; createdAt: string }
interface Detail extends Ticket { closedAt: string | null; messages: Msg[] }

const CATEGORIES = [
  { v: "payout", l: "Earnings / Payout" },
  { v: "kyc", l: "KYC / Verification" },
  { v: "listing", l: "Inventory / Listing" },
  { v: "booking", l: "Booking" },
  { v: "technical", l: "Technical" },
  { v: "other", l: "Other" },
];
const PRIORITIES = [
  { v: "low", l: "Low" },
  { v: "normal", l: "Normal" },
  { v: "high", l: "High / Urgent" },
];

const GOLD = "#b8860b";
function token() { try { return typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : ""; } catch { return ""; } }
function H(json = false): Record<string, string> { const h: Record<string, string> = { Authorization: `Bearer ${token()}` }; if (json) h["Content-Type"] = "application/json"; return h; }
function fmt(dt: string) { return new Date(dt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
function pill(s: string) {
  const c: Record<string, string> = { open: "#b45309", in_progress: "#0369a1", resolved: "#047857", closed: "#6b7280" };
  const l: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
  return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, color: c[s] || "#6b7280", border: `1px solid ${c[s] || "#6b7280"}33`, background: `${c[s] || "#6b7280"}12` }}>{l[s] || s}</span>;
}

export default function CircleSupportDesk() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState({ subject: "", category: "", priority: "normal", message: "" });
  const [creating, setCreating] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/circle/support", { headers: H() }); const d = await r.json(); setTickets(d.tickets || []); }
    catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try { const r = await fetch(`/api/circle/support/${id}`, { headers: H() }); if (r.ok) setDetail(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId, loadDetail]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages.length]);

  async function create() {
    if (!form.subject.trim()) { alert("Subject likhein"); return; }
    setCreating(true);
    try {
      const r = await fetch("/api/circle/support", { method: "POST", headers: H(true), body: JSON.stringify({ subject: form.subject.trim(), category: form.category || undefined, priority: form.priority, message: form.message.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) { alert(d?.error || "Ticket nahi bana"); return; }
      setForm({ subject: "", category: "", priority: "normal", message: "" });
      await load(); if (d.id) setOpenId(d.id);
    } catch { alert("Ticket nahi bana"); } finally { setCreating(false); }
  }
  async function send() {
    if (!reply.trim() || !openId || sending) return;
    setSending(true);
    try { const r = await fetch(`/api/circle/support/${openId}`, { method: "POST", headers: H(true), body: JSON.stringify({ body: reply.trim() }) }); if (r.ok) { setReply(""); await loadDetail(openId); await load(); } }
    catch { /* ignore */ } finally { setSending(false); }
  }
  async function download(msgId: string) {
    if (!openId) return;
    try { const r = await fetch(`/api/circle/support/${openId}/file?msgId=${encodeURIComponent(msgId)}`, { headers: H() }); const d = await r.json(); if (d?.url) window.open(d.url, "_blank", "noopener"); } catch { /* ignore */ }
  }
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!f || !openId) return;
    if (f.size > 15 * 1024 * 1024) { alert("File 15 MB se badi hai"); return; }
    setSending(true);
    try {
      await fetch(`/api/circle/support/${openId}/file?fileName=${encodeURIComponent(f.name)}&mimeType=${encodeURIComponent(f.type || "application/octet-stream")}`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/octet-stream" }, body: f });
      await loadDetail(openId);
    } catch { /* ignore */ } finally { setSending(false); }
  }

  const card: React.CSSProperties = { border: "1px solid rgba(74,56,32,0.15)", background: "#fff", borderRadius: 16 };
  const input: React.CSSProperties = { border: "1px solid rgba(74,56,32,0.2)", borderRadius: 10, padding: "8px 12px", fontSize: 14, width: "100%", color: "#4a3820" };

  if (openId && detail) {
    return (
      <div style={{ maxWidth: 640 }}>
        <button onClick={() => setOpenId(null)} style={{ fontSize: 13, color: GOLD, marginBottom: 10, background: "none", border: "none", cursor: "pointer" }}>← Back to tickets</button>
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(74,56,32,0.1)", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div><p style={{ fontWeight: 600, color: "#4a3820", margin: 0 }}>{detail.subject}</p><p style={{ fontSize: 12, color: "rgba(74,56,32,0.6)", margin: "2px 0 0" }}>{detail.category ? `${detail.category} · ` : ""}Raised {fmt(detail.createdAt)}</p></div>
            {pill(detail.status)}
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxHeight: "52vh", overflowY: "auto", background: "rgba(74,56,32,0.03)" }}>
            {detail.messages.length === 0 ? <p style={{ fontSize: 14, color: "rgba(74,56,32,0.6)", textAlign: "center", padding: "24px 0" }}>Abhi koi message nahi. Neeche apna sawaal likhein.</p>
              : detail.messages.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "80%", borderRadius: 16, padding: "8px 14px", fontSize: 14, ...(m.mine ? { background: GOLD, color: "#fff" } : { background: "#fff", border: "1px solid rgba(74,56,32,0.15)", color: "#4a3820" }) }}>
                    {!m.mine && <p style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, margin: "0 0 2px" }}>{m.authorName}</p>}
                    {m.body && <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{m.body}</p>}
                    {m.fileName && <button onClick={() => download(m.id)} style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: m.mine ? "#fff" : GOLD, padding: 0 }}>📎 {m.fileName}</button>}
                    <p style={{ fontSize: 10, marginTop: 4, marginBottom: 0, color: m.mine ? "rgba(255,255,255,0.7)" : "rgba(74,56,32,0.5)" }}>{fmt(m.createdAt)}</p>
                  </div>
                </div>
              ))}
            <div ref={end} />
          </div>
          <div style={{ padding: 12, borderTop: "1px solid rgba(74,56,32,0.1)", display: "flex", gap: 8 }}>
            <input ref={fileInput} type="file" style={{ display: "none" }} onChange={onPickFile} />
            <button onClick={() => fileInput.current?.click()} disabled={sending} title="Attach file" style={{ borderRadius: 10, border: "1px solid rgba(74,56,32,0.2)", background: "#fff", padding: "8px 12px", fontSize: 16, lineHeight: 1, cursor: "pointer" }}>📎</button>
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Apna message likhein…" style={{ ...input, flex: 1 }} />
            <button onClick={send} disabled={sending || !reply.trim()} style={{ borderRadius: 10, background: GOLD, color: "#fff", padding: "8px 16px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", opacity: sending || !reply.trim() ? 0.5 : 1 }}>{sending ? "…" : "Send"}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ ...card, padding: 16 }}>
        <p style={{ fontWeight: 600, color: "#4a3820", margin: "0 0 12px" }}>Raise a ticket</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject — e.g. Payout abhi tak nahi aaya" style={input} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...input, background: "#fff" }}>
              <option value="">Category (optional)</option>
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ ...input, background: "#fff" }}>
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </div>
          <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Detail likhein (optional)…" rows={3} style={{ ...input, resize: "none" }} />
          <button onClick={create} disabled={creating} style={{ alignSelf: "flex-start", borderRadius: 10, background: GOLD, color: "#fff", padding: "8px 18px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", opacity: creating ? 0.5 : 1 }}>{creating ? "Creating…" : "Submit ticket"}</button>
        </div>
      </div>

      <div>
        <p style={{ fontWeight: 600, color: "#4a3820", margin: "0 0 8px" }}>My tickets</p>
        {loading ? <p style={{ fontSize: 14, color: "rgba(74,56,32,0.6)" }}>Loading…</p>
          : tickets.length === 0 ? <p style={{ fontSize: 14, color: "rgba(74,56,32,0.6)", border: "1px dashed rgba(74,56,32,0.2)", borderRadius: 12, padding: "24px 0", textAlign: "center" }}>Abhi koi ticket nahi. Upar se naya raise karein.</p>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tickets.map((t) => (
                  <button key={t.id} onClick={() => setOpenId(t.id)} style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontWeight: 500, color: "#4a3820", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.unread && <span title="New reply from HQ" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#dc2626", marginRight: 6, verticalAlign: "middle" }} />}
                        {t.subject}
                      </p>
                      <p style={{ fontSize: 12, color: "rgba(74,56,32,0.6)", margin: "2px 0 0" }}>{t.category ? `${t.category} · ` : ""}{fmt(t.updatedAt)}{t.priority === "high" ? " · 🔴 Urgent" : ""}{t.unread ? " · 🟢 New reply" : ""}</p>
                    </div>
                    {pill(t.status)}
                  </button>
                ))}
              </div>}
      </div>
    </div>
  );
}
