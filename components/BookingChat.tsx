"use client";
// Booking-flow chat component — same UI for customer + hotel sides.
// Used by /bookings (customer view) + /partner/dashboard (hotel view).
// Distinguished by `mode` prop which controls auth headers + bubble
// alignment.

import { useEffect, useRef, useState } from "react";
import { sanitizeText } from "@/lib/sanitize-text";

export type ChatMessage = {
  id: string;
  bid_id: string;
  sender: "customer" | "hotel" | "admin";
  sender_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

type Props = {
  bidId: string;
  mode: "customer" | "hotel";
  hotelId?: string;           // required for hotel mode
  partnerToken?: string;      // required for hotel mode
  collapsed?: boolean;        // start collapsed
  unreadHint?: number;        // shows badge before expanding
  hotelName?: string;
  customerName?: string;
};

export default function BookingChat({
  bidId, mode, hotelId, partnerToken,
  collapsed: collapsedDefault = true,
  unreadHint = 0,
  hotelName = "Hotel",
  customerName = "Guest",
}: Props) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [draft, setDraft]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState("");
  const [warning, setWarning]     = useState("");
  const scrollRef                 = useRef<HTMLDivElement | null>(null);

  const authHeaders = () => {
    if (mode === "customer") {
      const t = (() => { try { return localStorage.getItem("sb_token"); } catch { return null; } })();
      return t ? { Authorization: `Bearer ${t}` } : {};
    } else {
      const headers: Record<string, string> = {};
      if (partnerToken) headers["x-partner-token"] = partnerToken;
      if (hotelId)      headers["x-partner-hotel-id"] = hotelId;
      return headers;
    }
  };

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/booking-messages?bidId=${encodeURIComponent(bidId)}`, {
        headers: authHeaders(),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load");
      setMessages(j.messages || []);
      // Mark messages from other side as read
      if (mode === "customer" || (mode === "hotel" && partnerToken)) {
        await fetch("/api/booking-messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ bidId, markRead: true }),
        }).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  // Load when expanded, poll every 15s
  useEffect(() => {
    if (collapsed) return;
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, bidId]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setWarning("");
    // Client-side sanitize preview — backend re-applies it authoritatively
    const { clean, blocked } = sanitizeText(body);
    if (blocked) {
      setWarning("Personal-contact info masked. Use the trip details only — phone/email/links aren't allowed.");
    }
    setSending(true); setError("");
    try {
      const r = await fetch("/api/booking-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ bidId, body: clean }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Send failed");
      setDraft("");
      // Optimistic update
      setMessages((prev) => [...prev, j.message]);
    } catch (e: any) {
      setError(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mt-3 w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-gold-200 hover:border-gold-400 bg-gold-50/40 hover:bg-gold-50 transition text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-luxury-800">
          💬 {mode === "customer" ? `Message ${hotelName}` : `Message ${customerName}`}
        </span>
        <span className="flex items-center gap-2">
          {unreadHint > 0 && (
            <span className="text-[0.6rem] font-bold uppercase tracking-wide bg-red-500 text-white px-2 py-0.5 rounded-full">
              {unreadHint} new
            </span>
          )}
          <span className="text-xs text-luxury-400">Open ▾</span>
        </span>
      </button>
    );
  }

  const myKind = mode; // "customer" or "hotel"

  return (
    <div className="mt-3 rounded-2xl border border-luxury-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between bg-linear-to-r from-luxury-50 to-gold-50 border-b border-luxury-100">
        <p className="text-xs font-bold text-luxury-700">
          💬 Trip chat · {mode === "customer" ? hotelName : customerName}
        </p>
        <button onClick={() => setCollapsed(true)} className="text-luxury-400 hover:text-luxury-800 text-xs">Close ✕</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="px-3 py-3 space-y-2 max-h-72 overflow-y-auto bg-luxury-50/30">
        {loading && messages.length === 0 && (
          <p className="text-xs text-luxury-400 text-center py-4">Loading messages…</p>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center py-6">
            <p className="text-xs text-luxury-500">No messages yet. Say hi 👋</p>
            <p className="text-[0.62rem] text-luxury-400 mt-1 leading-relaxed">
              Coordinate check-in time, early arrival, dietary needs etc.
            </p>
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender === myKind;
          return (
            <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  isMine
                    ? "bg-linear-to-br from-gold-500 to-amber-600 text-white rounded-br-md"
                    : "bg-white border border-luxury-100 text-luxury-800 rounded-bl-md"
                }`}
              >
                <p className="whitespace-pre-wrap wrap-break-word">{m.body}</p>
                <p className={`text-[0.55rem] mt-1 ${isMine ? "text-white/70" : "text-luxury-400"}`}>
                  {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  {isMine && m.read_at ? " · seen" : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="px-3 py-2.5 border-t border-luxury-100 bg-white">
        {warning && (
          <p className="text-[0.65rem] text-amber-700 mb-1.5">⚠ {warning}</p>
        )}
        {error && (
          <p className="text-[0.65rem] text-red-600 mb-1.5">⚠ {error}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 px-3 py-2 rounded-xl border border-luxury-200 focus:border-gold-400 focus:outline-hidden text-sm bg-luxury-50/40 resize-none"
            style={{ color: "var(--text-base, #1F1A0F)", caretColor: "var(--accent, #8198ae)" }}
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="px-4 py-2 rounded-xl bg-linear-to-r from-gold-500 to-amber-600 text-white text-sm font-semibold disabled:opacity-40 transition-transform active:scale-[0.97]"
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
        <p className="text-[0.55rem] text-luxury-400 mt-1.5 leading-relaxed">
          Anti-bypass guard: phone, email, links + off-platform language get masked.
        </p>
      </div>
    </div>
  );
}
