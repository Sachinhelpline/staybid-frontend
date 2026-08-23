"use client";

// HQ Support Desk — PARTNER tab. A hotel owner raises + tracks support tickets and
// chats with the StayBid HQ team. Backed by /api/partner/support/* (Supabase store
// shared with the HQ panel — real 2-way). Self-contained, additive.

import { useState, useEffect, useCallback, useRef } from "react";

interface Ticket {
  id: string; subject: string; category: string | null; priority: string;
  status: string; hotelId: string | null; updatedAt: string; createdAt: string; unread?: boolean;
}
interface Msg {
  id: string; body: string | null; fileName: string | null; mimeType: string | null;
  size: number | null; mine: boolean; authorName: string; createdAt: string;
}
interface Detail extends Ticket { closedAt: string | null; messages: Msg[] }

const CATEGORIES = [
  { v: "payment", l: "Payment" },
  { v: "booking", l: "Booking" },
  { v: "payout", l: "Payout" },
  { v: "listing", l: "Listing / Rooms" },
  { v: "channel", l: "Channel / OTA" },
  { v: "technical", l: "Technical" },
  { v: "other", l: "Other" },
];
const PRIORITIES = [
  { v: "low", l: "Low" },
  { v: "normal", l: "Normal" },
  { v: "high", l: "High / Urgent" },
];

function token() {
  try { return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : ""; }
  catch { return ""; }
}
function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}
function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function statusPill(s: string) {
  const map: Record<string, string> = {
    open: "bg-amber-50 text-amber-700 border-amber-200",
    in_progress: "bg-sky-50 text-sky-700 border-sky-200",
    resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    closed: "bg-luxury-50 text-luxury-600 border-luxury-200",
  };
  const label: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${map[s] || "bg-luxury-50 text-luxury-600 border-luxury-200"}`}>{label[s] || s}</span>;
}

export default function SupportTab({ hotelId }: { hotelId?: string }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: "", category: "", priority: "normal", message: "" });
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const chatFileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/partner/support", { headers: authHeaders() });
      const d = await r.json();
      setTickets(d.tickets || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/partner/support/${id}`, { headers: authHeaders() });
      if (r.ok) setDetail(await r.json());
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (openId) loadDetail(openId); else setDetail(null); }, [openId, loadDetail]);
  useEffect(() => { threadEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages.length]);

  async function createTicket() {
    if (!form.subject.trim()) { alert("Subject likhein"); return; }
    setCreating(true);
    try {
      const r = await fetch("/api/partner/support", {
        method: "POST", headers: authHeaders(true),
        body: JSON.stringify({
          subject: form.subject.trim(),
          category: form.category || undefined,
          priority: form.priority,
          message: form.message.trim() || undefined,
          hotelId: hotelId || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d?.error || "Ticket nahi bana"); return; }
      setForm({ subject: "", category: "", priority: "normal", message: "" });
      await load();
      if (d.id) setOpenId(d.id);
    } catch { alert("Ticket nahi bana"); } finally { setCreating(false); }
  }

  async function sendReply() {
    if (!reply.trim() || !openId || sending) return;
    setSending(true);
    try {
      const r = await fetch(`/api/partner/support/${openId}`, {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({ body: reply.trim() }),
      });
      if (r.ok) { setReply(""); await loadDetail(openId); await load(); }
    } catch { /* ignore */ } finally { setSending(false); }
  }

  async function download(msgId: string) {
    if (!openId) return;
    try {
      const r = await fetch(`/api/partner/support/${openId}/file?msgId=${encodeURIComponent(msgId)}`, { headers: authHeaders() });
      const d = await r.json();
      if (d?.url) window.open(d.url, "_blank", "noopener");
    } catch { /* ignore */ }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (chatFileInput.current) chatFileInput.current.value = "";
    if (!f || !openId) return;
    if (f.size > 15 * 1024 * 1024) { alert("File 15 MB se badi hai"); return; }
    setSending(true);
    try {
      await fetch(`/api/partner/support/${openId}/file?fileName=${encodeURIComponent(f.name)}&mimeType=${encodeURIComponent(f.type || "application/octet-stream")}`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/octet-stream" }, body: f });
      await loadDetail(openId);
    } catch { /* ignore */ } finally { setSending(false); }
  }

  // ── Thread view ──
  if (openId && detail) {
    return (
      <div className="max-w-3xl">
        <button onClick={() => setOpenId(null)} className="text-sm text-luxury-600 hover:text-luxury-900 mb-3">← Back to tickets</button>
        <div className="rounded-2xl border border-luxury-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-luxury-100 flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-luxury-900">{detail.subject}</p>
              <p className="text-xs text-luxury-500 mt-0.5">
                {detail.category ? `${detail.category} · ` : ""}Raised {fmt(detail.createdAt)}
              </p>
            </div>
            {statusPill(detail.status)}
          </div>
          <div className="p-4 flex flex-col gap-3 max-h-[55vh] overflow-y-auto bg-luxury-50/40">
            {detail.messages.length === 0 ? (
              <p className="text-sm text-luxury-500 text-center py-8">Abhi koi message nahi. Neeche apna sawaal likhein.</p>
            ) : detail.messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${m.mine ? "bg-amber-500 text-white" : "bg-white border border-luxury-200 text-luxury-900"}`}>
                  {!m.mine && <p className="text-[11px] font-medium opacity-70 mb-0.5">{m.authorName}</p>}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  {m.fileName && (
                    <button onClick={() => download(m.id)} className={`mt-1 flex items-center gap-1.5 underline ${m.mine ? "text-white" : "text-amber-700"}`}>
                      📎 <span className="truncate">{m.fileName}</span>
                    </button>
                  )}
                  <p className={`text-[10px] mt-1 ${m.mine ? "text-white/70" : "text-luxury-400"}`}>{fmt(m.createdAt)}</p>
                </div>
              </div>
            ))}
            <div ref={threadEnd} />
          </div>
          <div className="p-3 border-t border-luxury-100 flex items-center gap-2">
            <input ref={chatFileInput} type="file" className="hidden" onChange={onPickFile} />
            <button onClick={() => chatFileInput.current?.click()} disabled={sending} title="Attach file" className="rounded-lg border border-luxury-200 bg-white px-3 py-2 text-base leading-none disabled:opacity-50">📎</button>
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
              placeholder="Apna message likhein…"
              className="flex-1 rounded-lg border border-luxury-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
            <button onClick={sendReply} disabled={sending || !reply.trim()} className="rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List + new ticket ──
  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-luxury-900">Support</h3>
        <p className="text-sm text-luxury-500">Koi bhi problem — payment, booking, payout, listing — yahan ticket raise karein. StayBid HQ team seedha yahin reply karegi.</p>
      </div>

      {/* new ticket */}
      <div className="rounded-2xl border border-luxury-200 bg-white p-4">
        <p className="font-medium text-luxury-900 mb-3">Raise a ticket</p>
        <div className="flex flex-col gap-3">
          <input
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Subject — e.g. July ka payout nahi aaya"
            className="rounded-lg border border-luxury-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="rounded-lg border border-luxury-200 px-3 py-2 text-sm bg-white">
              <option value="">Category (optional)</option>
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="rounded-lg border border-luxury-200 px-3 py-2 text-sm bg-white">
              {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </div>
          <textarea
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Detail likhein (optional)…"
            rows={3}
            className="rounded-lg border border-luxury-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          />
          <button onClick={createTicket} disabled={creating} className="self-start rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? "Creating…" : "Submit ticket"}
          </button>
        </div>
      </div>

      {/* my tickets */}
      <div>
        <p className="font-medium text-luxury-900 mb-2">My tickets</p>
        {loading ? (
          <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-luxury-100 animate-pulse" />)}</div>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-luxury-500 rounded-xl border border-dashed border-luxury-200 py-8 text-center">Abhi koi ticket nahi. Upar se naya raise karein.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.map((t) => (
              <button key={t.id} onClick={() => setOpenId(t.id)}
                className="flex items-center justify-between gap-3 rounded-xl border border-luxury-200 bg-white px-4 py-3 text-left hover:border-amber-300 transition-colors">
                <div className="min-w-0">
                  <p className="font-medium text-luxury-900 truncate">
                    {t.unread && <span title="New reply from HQ" className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1.5 align-middle" />}
                    {t.subject}
                  </p>
                  <p className="text-xs text-luxury-500 mt-0.5">
                    {t.category ? `${t.category} · ` : ""}{fmt(t.updatedAt)}
                    {t.priority === "high" ? " · 🔴 Urgent" : ""}
                    {t.unread ? " · 🟢 New reply" : ""}
                  </p>
                </div>
                {statusPill(t.status)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
