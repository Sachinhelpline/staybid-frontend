"use client";

// Hybrid AI + agent support widget. Mounted globally in app/layout.tsx.
// Hides on: /admin, /partner, /onboard, /auth, /, /discover, /reels, /me,
// /me/posts, /saved/posts (reel-app surfaces + admin/partner panels).
//
// Lifecycle:
//   1. User taps floating bubble → panel opens
//   2. If user has an open conversation → resume it
//   3. Else → show "Start a new chat" + past-conversation list
//   4. Inside an active chat → message + polling every 5s
//   5. Closes via X or backdrop tap

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { notify } from "@/lib/notifications";

type SupportSender = "user" | "ai" | "agent" | "system";
type SupportStatus = "ai_active" | "escalated" | "agent_active" | "resolved" | "closed";

type Message = {
  id: string;
  conversation_id: string;
  sender: SupportSender;
  sender_name: string | null;
  body: string;
  created_at: string;
};

type Conversation = {
  id: string;
  status: SupportStatus;
  subject: string | null;
  assigned_agent_name: string | null;
  last_message_at: string;
  user_unread_count: number;
};

// Routes where the widget is intentionally hidden
const HIDE_PREFIXES = [
  "/admin",
  "/partner",
  "/onboard",
  "/auth",
];
const HIDE_EXACT = new Set(["/", "/discover", "/reels", "/me", "/me/posts", "/saved/posts"]);

function shouldHide(pathname: string | null): boolean {
  if (!pathname) return false;
  if (HIDE_EXACT.has(pathname)) return true;
  for (const p of HIDE_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function getAnonId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("sb_support_anon_id");
  if (!id) {
    id = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("sb_support_anon_id", id);
  }
  return id;
}

function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const anon = typeof window !== "undefined" ? getAnonId() : "";
  if (anon) h["x-support-anon-id"] = anon;
  return h;
}

export default function SupportWidget() {
  const pathname = usePathname();
  const { user, token } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "chat">("list");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // Track previous unread to detect TRANSITIONS (0→N) and avoid spamming
  // notifications on every refresh.
  const prevUnreadRef = useRef<number>(-1);
  // Tracks whether we've already attempted to claim the anon chats for
  // this signed-in session — once claimed, this widget doesn't retry.
  const claimedRef = useRef<boolean>(false);

  if (shouldHide(pathname)) return null;

  // Anon chats → user chats migration. Fires once when user signs in
  // AND the device has an anonymous_id from a prior anonymous session.
  useEffect(() => {
    if (!user || !token || claimedRef.current) return;
    if (typeof window === "undefined") return;
    const anonId = localStorage.getItem("sb_support_anon_id");
    if (!anonId) return;
    claimedRef.current = true;
    fetch("/api/support/claim-anon", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonymousId: anonId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && j.claimed > 0 && open) {
          // Refresh the list view so the user immediately sees their
          // claimed chats.
          fetchConversations();
        }
      })
      .catch(() => {});
  }, [user, token, open]);

  // Lazy-load conversation list when widget opens
  useEffect(() => {
    if (!open) return;
    fetchConversations();
  }, [open, token]);

  // Background unread polling every 60s (only when widget is closed
  // — when open, the inner chat polls itself every 5s)
  useEffect(() => {
    if (open) return;
    const t = setInterval(() => fetchConversations(), 60_000);
    return () => clearInterval(t);
  }, [open, token]);

  async function fetchConversations() {
    try {
      const r = await fetch("/api/support/conversations", {
        headers: authHeaders(token),
      });
      if (!r.ok) return;
      const j = await r.json();
      const list: Conversation[] = j.conversations || [];
      setConversations(list);
      const unread = list.reduce((s, c) => s + (c.user_unread_count || 0), 0);

      // Fire a notification on TRANSITIONS only — when prev was 0 (or
      // unset) and a new unread shows up while the widget is closed.
      // Surfaces a desktop notification + in-app toast via lib/notifications.
      if (prevUnreadRef.current >= 0 && unread > prevUnreadRef.current && !open) {
        const newest = list.find((c) => c.user_unread_count > 0);
        notify({
          kind: "info",
          title: newest?.assigned_agent_name
            ? `${newest.assigned_agent_name} replied`
            : "Support reply received",
          body: "Open the chat to view the message",
          duration: 6000,
          actions: [
            {
              label: "Open chat",
              primary: true,
              onClick: () => setOpen(true),
            },
          ],
        });
      }
      prevUnreadRef.current = unread;
      setUnreadTotal(unread);
    } catch {}
  }

  async function startNewChat() {
    try {
      const r = await fetch("/api/support/conversations", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          metadata: {
            pageUrl: typeof window !== "undefined" ? window.location.pathname : null,
            locale: typeof navigator !== "undefined" ? navigator.language : null,
          },
        }),
      });
      if (!r.ok) return;
      const j = await r.json();
      if (j?.conversation?.id) {
        setActiveId(j.conversation.id);
        setView("chat");
        setConversations((prev) => [j.conversation, ...prev]);
      }
    } catch {}
  }

  function openChat(id: string) {
    setActiveId(id);
    setView("chat");
  }

  function backToList() {
    setView("list");
    setActiveId(null);
    fetchConversations();
  }

  function closeWidget() {
    setOpen(false);
    setView("list");
    setActiveId(null);
  }

  return (
    <>
      {/* FAB */}
      <button
        type="button"
        aria-label="Open support chat"
        onClick={() => setOpen((p) => !p)}
        className="sb-support-fab"
      >
        <span className="sb-support-fab-icon" aria-hidden>
          {open ? "✕" : "💬"}
        </span>
        {!open && unreadTotal > 0 && (
          <span className="sb-support-fab-badge" aria-label={`${unreadTotal} new`}>
            {unreadTotal > 9 ? "9+" : unreadTotal}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <>
          <div className="sb-support-backdrop" onClick={closeWidget} />
          <div className="sb-support-panel" role="dialog" aria-label="StayBid Support">
            <header className="sb-support-header">
              <div className="sb-support-header-left">
                {view === "chat" && (
                  <button
                    type="button"
                    onClick={backToList}
                    className="sb-support-back"
                    aria-label="Back to conversations"
                  >
                    ←
                  </button>
                )}
                <div>
                  <div className="sb-support-title">StayBid Support</div>
                  <div className="sb-support-subtitle">
                    {view === "chat" ? "Live chat" : "Hum madad ke liye yahaan hain"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeWidget}
                className="sb-support-close"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {view === "list" ? (
              <ConversationList
                conversations={conversations}
                onOpen={openChat}
                onStartNew={startNewChat}
                signedIn={!!user}
              />
            ) : activeId ? (
              <ChatView
                conversationId={activeId}
                token={token}
                onClosed={backToList}
              />
            ) : null}
          </div>
        </>
      )}

      <style jsx global>{`
        .sb-support-fab {
          position: fixed;
          right: max(16px, env(safe-area-inset-right, 0px));
          bottom: calc(96px + env(safe-area-inset-bottom, 0px));
          z-index: 9998;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(140deg, #C9A66B, #8B6914);
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          box-shadow:
            0 6px 18px -4px rgba(31, 26, 15, 0.45),
            0 2px 6px -1px rgba(31, 26, 15, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .sb-support-fab:hover { transform: translateY(-2px); }
        .sb-support-fab-icon { line-height: 1; }
        .sb-support-fab-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          min-width: 20px;
          height: 20px;
          padding: 0 6px;
          background: #D49583;
          color: #fff;
          border-radius: 10px;
          border: 2px solid #FAF5EB;
          font-size: 11px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        @media (min-width: 1024px) {
          .sb-support-fab {
            bottom: max(24px, env(safe-area-inset-bottom, 0px));
          }
        }

        .sb-support-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(31, 26, 15, 0.32);
          backdrop-filter: blur(2px);
          z-index: 9998;
        }
        .sb-support-panel {
          position: fixed;
          z-index: 9999;
          right: max(16px, env(safe-area-inset-right, 0px));
          bottom: calc(160px + env(safe-area-inset-bottom, 0px));
          width: min(380px, calc(100vw - 24px));
          height: min(620px, calc(100vh - 220px));
          background: var(--bg-card, #FFFCF6);
          border-radius: 18px;
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          box-shadow: 0 24px 60px -8px rgba(31, 26, 15, 0.4);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        @media (max-width: 480px) {
          .sb-support-panel {
            right: 12px;
            left: 12px;
            bottom: 84px;
            width: auto;
            height: calc(100vh - 110px);
          }
        }

        .sb-support-header {
          flex: 0 0 auto;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: linear-gradient(180deg, #FFFCF6 0%, #FAF5EB 100%);
          border-bottom: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
        }
        .sb-support-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sb-support-back {
          background: transparent;
          border: none;
          font-size: 20px;
          line-height: 1;
          padding: 4px 8px;
          cursor: pointer;
          color: var(--text-base, #1F1A0F);
          border-radius: 6px;
        }
        .sb-support-back:hover { background: rgba(0, 0, 0, 0.04); }
        .sb-support-title {
          font-family: "Cormorant Garamond", serif;
          font-style: italic;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-base, #1F1A0F);
          line-height: 1.1;
        }
        .sb-support-subtitle {
          font-size: 11px;
          color: var(--text-muted, #6E5430);
          margin-top: 1px;
        }
        .sb-support-close {
          background: transparent;
          border: none;
          font-size: 16px;
          padding: 6px 10px;
          cursor: pointer;
          color: var(--text-muted, #6E5430);
          border-radius: 6px;
        }
        .sb-support-close:hover { background: rgba(0, 0, 0, 0.04); color: var(--text-base, #1F1A0F); }
      `}</style>
    </>
  );
}

// ─── Conversation list view ────────────────────────────────
function ConversationList({
  conversations,
  onOpen,
  onStartNew,
  signedIn,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
  onStartNew: () => void;
  signedIn: boolean;
}) {
  return (
    <div className="sb-support-list">
      <button type="button" onClick={onStartNew} className="sb-support-new-btn">
        💬 Naya chat shuru karein
      </button>
      {!signedIn && (
        <div className="sb-support-anon-note">
          Sign-in karne se aapki bookings + bids automatically pull ho jaati hain — fast resolution milti hai.
        </div>
      )}
      {conversations.length === 0 ? (
        <div className="sb-support-empty">
          <div className="sb-support-empty-emoji">✨</div>
          <div>Koi past conversation nahi.</div>
          <div className="sb-support-empty-sub">Booking, bid, payment — kuch bhi pucho.</div>
        </div>
      ) : (
        <>
          <div className="sb-support-list-heading">Past chats</div>
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sb-support-list-item"
              onClick={() => onOpen(c.id)}
            >
              <div className="sb-support-list-item-top">
                <span className={`sb-support-list-status sb-support-list-status-${c.status}`}>
                  {labelForStatus(c.status)}
                </span>
                {c.user_unread_count > 0 && (
                  <span className="sb-support-list-badge">{c.user_unread_count}</span>
                )}
              </div>
              <div className="sb-support-list-subject">
                {c.subject || "(no subject)"}
              </div>
              <div className="sb-support-list-time">
                {timeAgo(c.last_message_at)}
                {c.assigned_agent_name ? ` · ${c.assigned_agent_name}` : ""}
              </div>
            </button>
          ))}
        </>
      )}
      <style jsx global>{`
        .sb-support-list {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sb-support-new-btn {
          flex: 0 0 auto;
          background: linear-gradient(140deg, #C9A66B, #8B6914);
          color: #fff;
          padding: 12px;
          border: none;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 10px -2px rgba(139, 105, 20, 0.35);
        }
        .sb-support-anon-note {
          font-size: 11px;
          color: var(--text-muted, #6E5430);
          padding: 8px 10px;
          background: rgba(201, 166, 107, 0.08);
          border-radius: 8px;
          border: 1px solid rgba(201, 166, 107, 0.18);
        }
        .sb-support-empty {
          text-align: center;
          padding: 32px 12px;
          color: var(--text-muted, #6E5430);
        }
        .sb-support-empty-emoji { font-size: 32px; margin-bottom: 8px; }
        .sb-support-empty-sub { font-size: 12px; margin-top: 4px; }
        .sb-support-list-heading {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted, #6E5430);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 6px;
        }
        .sb-support-list-item {
          text-align: left;
          background: var(--bg-elevated, #F2EAD8);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.12));
          border-radius: 10px;
          padding: 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: var(--text-base, #1F1A0F);
          transition: transform 0.15s ease;
        }
        .sb-support-list-item:hover { transform: translateY(-1px); }
        .sb-support-list-item-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .sb-support-list-status {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .sb-support-list-status-ai_active { background: #fff3d4; color: #8b6914; }
        .sb-support-list-status-escalated { background: #fde2d6; color: #a45034; }
        .sb-support-list-status-agent_active { background: #d8ecd1; color: #4a6f4a; }
        .sb-support-list-status-resolved,
        .sb-support-list-status-closed { background: #e8dcc8; color: #6e5430; }
        .sb-support-list-badge {
          background: #D49583;
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 999px;
        }
        .sb-support-list-subject {
          font-size: 13px;
          color: var(--text-base, #1F1A0F);
        }
        .sb-support-list-time {
          font-size: 11px;
          color: var(--text-muted, #6E5430);
        }
      `}</style>
    </div>
  );
}

// ─── Active chat view ──────────────────────────────────────
function ChatView({
  conversationId,
  token,
  onClosed,
}: {
  conversationId: string;
  token: string | null;
  onClosed: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<Pick<
    Conversation,
    "id" | "status" | "assigned_agent_name"
  > | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sinceRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/support/conversations/${conversationId}`, {
        headers: authHeaders(token),
      });
      if (!r.ok || cancelled) return;
      const j = await r.json();
      setMessages(j.messages || []);
      setConv(j.conversation || null);
      sinceRef.current = j.messages?.length
        ? j.messages[j.messages.length - 1].created_at
        : new Date().toISOString();
      scrollToBottom();
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, token]);

  // Polling
  useEffect(() => {
    pollRef.current = window.setInterval(async () => {
      if (!sinceRef.current) return;
      try {
        const r = await fetch(
          `/api/support/conversations/${conversationId}/messages?since=${encodeURIComponent(
            sinceRef.current
          )}`,
          { headers: authHeaders(token) }
        );
        if (!r.ok) return;
        const j = await r.json();
        const fresh: Message[] = j.messages || [];
        if (fresh.length) {
          setMessages((prev) => mergeMessages(prev, fresh));
          sinceRef.current = fresh[fresh.length - 1].created_at;
          scrollToBottom();
        }
        if (j.conversation) {
          setConv((p) =>
            p
              ? {
                  ...p,
                  status: j.conversation.status,
                  assigned_agent_name: j.conversation.assigned_agent_name,
                }
              : null
          );
        }
      } catch {}
    }, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [conversationId, token]);

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");

    // Optimistic user message
    const tempId = `tmp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender: "user",
      sender_name: null,
      body: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();
    setAiTyping(true);

    try {
      const r = await fetch(
        `/api/support/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ body: text }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== tempId);
          const next = [...filtered];
          if (j.userMessage) next.push(j.userMessage);
          if (j.aiReply) next.push(j.aiReply);
          sinceRef.current = (
            j.aiReply?.created_at ||
            j.userMessage?.created_at ||
            new Date().toISOString()
          );
          return next;
        });
        if (j.conversationStatus) {
          setConv((p) => (p ? { ...p, status: j.conversationStatus } : null));
        }
        scrollToBottom();
      } else {
        // restore input on failure
        setInput(text);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    } catch {
      setInput(text);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setAiTyping(false);
      setSending(false);
    }
  }

  async function escalate() {
    if (escalating) return;
    setEscalating(true);
    try {
      const r = await fetch(
        `/api/support/conversations/${conversationId}/escalate`,
        {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({ reason: "user_request" }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        setConv((p) => (p ? { ...p, status: j.conversation.status } : null));
        // Force-refresh messages
        sinceRef.current = new Date(0).toISOString();
      }
    } catch {}
    setEscalating(false);
  }

  async function closeChat() {
    try {
      await fetch(`/api/support/conversations/${conversationId}`, {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "close" }),
      });
    } catch {}
    onClosed();
  }

  const placeholder = useMemo(() => {
    if (!conv) return "Type karein…";
    if (conv.status === "closed" || conv.status === "resolved") return "Yeh chat band ho gaya hai";
    if (conv.status === "agent_active") return `${conv.assigned_agent_name || "Agent"} ko likhein…`;
    return "Apna sawaal likhein… (Hinglish OK)";
  }, [conv]);

  const showEscalate =
    conv && (conv.status === "ai_active") && messages.some((m) => m.sender === "user");
  const isLocked = conv && (conv.status === "closed" || conv.status === "resolved");

  return (
    <div className="sb-support-chat">
      {conv && (
        <div className="sb-support-chat-banner">
          {conv.status === "ai_active" && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-ai" />
              <span>StayBid Assistant aapki madad kar raha hai</span>
              {showEscalate && (
                <button
                  type="button"
                  className="sb-support-banner-action"
                  onClick={escalate}
                  disabled={escalating}
                >
                  Talk to human
                </button>
              )}
            </>
          )}
          {conv.status === "escalated" && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-esc" />
              <span>Team ko forward kar diya hai — soon reply aayega</span>
            </>
          )}
          {conv.status === "agent_active" && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-agent" />
              <span>{conv.assigned_agent_name || "Support"} live hai</span>
            </>
          )}
          {(conv.status === "resolved" || conv.status === "closed") && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-closed" />
              <span>Yeh conversation band ho gaya hai</span>
            </>
          )}
        </div>
      )}

      <div ref={scrollRef} className="sb-support-chat-scroll">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {aiTyping && (
          <div className="sb-support-msg sb-support-msg-ai">
            <div className="sb-support-bubble sb-support-bubble-ai sb-support-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <div className="sb-support-chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          disabled={!!isLocked || sending}
          maxLength={4000}
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || sending || !!isLocked}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>

      {!isLocked && (
        <button
          type="button"
          onClick={closeChat}
          className="sb-support-chat-close-btn"
        >
          Mark as resolved
        </button>
      )}

      <style jsx global>{`
        .sb-support-chat {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .sb-support-chat-banner {
          flex: 0 0 auto;
          padding: 8px 12px;
          font-size: 11px;
          color: var(--text-muted, #6E5430);
          background: var(--bg-elevated, #F2EAD8);
          border-bottom: 1px solid var(--border-soft, rgba(184, 134, 11, 0.12));
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sb-support-banner-dot {
          width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
          animation: sbSupportPulse 1.8s ease-in-out infinite;
        }
        .sb-support-banner-dot-ai { background: #C9A66B; }
        .sb-support-banner-dot-esc { background: #D49583; }
        .sb-support-banner-dot-agent { background: #7F9269; }
        .sb-support-banner-dot-closed { background: #B0A290; animation: none; }
        @keyframes sbSupportPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .sb-support-banner-action {
          margin-left: auto;
          background: rgba(212, 149, 131, 0.18);
          color: #a45034;
          border: 1px solid rgba(212, 149, 131, 0.45);
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 999px;
          cursor: pointer;
        }
        .sb-support-banner-action:hover { background: rgba(212, 149, 131, 0.32); }

        .sb-support-chat-scroll {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--bg-page, #FAF5EB);
        }
        .sb-support-msg { display: flex; }
        .sb-support-msg-user { justify-content: flex-end; }
        .sb-support-msg-ai,
        .sb-support-msg-agent,
        .sb-support-msg-system { justify-content: flex-start; }
        .sb-support-bubble {
          max-width: 78%;
          padding: 8px 11px;
          border-radius: 14px;
          font-size: 13.5px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .sb-support-bubble-user {
          background: linear-gradient(140deg, #C9A66B, #B89149);
          color: #fff;
          border-bottom-right-radius: 4px;
        }
        .sb-support-bubble-ai {
          background: #fff;
          color: var(--text-base, #1F1A0F);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.12));
          border-bottom-left-radius: 4px;
        }
        .sb-support-bubble-agent {
          background: #ECF1E5;
          color: var(--text-base, #1F1A0F);
          border: 1px solid rgba(127, 146, 105, 0.32);
          border-bottom-left-radius: 4px;
        }
        .sb-support-bubble-system {
          background: rgba(201, 166, 107, 0.14);
          color: var(--text-muted, #6E5430);
          font-size: 12px;
          font-style: italic;
          text-align: center;
          max-width: 92%;
          margin: 0 auto;
        }
        .sb-support-msg-sender {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 2px;
          opacity: 0.7;
        }

        .sb-support-typing {
          display: inline-flex;
          gap: 3px;
        }
        .sb-support-typing span {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--text-muted, #6E5430);
          animation: sbTypingBounce 1.2s ease-in-out infinite;
        }
        .sb-support-typing span:nth-child(2) { animation-delay: 0.15s; }
        .sb-support-typing span:nth-child(3) { animation-delay: 0.30s; }
        @keyframes sbTypingBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }

        .sb-support-chat-input {
          flex: 0 0 auto;
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          background: var(--bg-card, #FFFCF6);
          border-top: 1px solid var(--border-soft, rgba(184, 134, 11, 0.12));
        }
        .sb-support-chat-input input {
          flex: 1;
          padding: 10px 12px;
          border-radius: 22px;
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          font-size: 13px;
          background: var(--bg-input, #FFFCF6);
          color: var(--text-base, #1F1A0F);
          outline: none;
        }
        .sb-support-chat-input input:focus {
          border-color: #C9A66B;
          box-shadow: 0 0 0 3px rgba(201, 166, 107, 0.18);
        }
        .sb-support-chat-input button {
          padding: 0 16px;
          border-radius: 22px;
          border: none;
          background: linear-gradient(140deg, #C9A66B, #8B6914);
          color: #fff;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .sb-support-chat-input button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .sb-support-chat-close-btn {
          flex: 0 0 auto;
          padding: 8px;
          background: transparent;
          border: none;
          color: var(--text-muted, #6E5430);
          font-size: 11px;
          cursor: pointer;
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  return (
    <div className={`sb-support-msg sb-support-msg-${m.sender}`}>
      <div className={`sb-support-bubble sb-support-bubble-${m.sender}`}>
        {m.sender !== "user" && m.sender !== "system" && m.sender_name && (
          <div className="sb-support-msg-sender">{m.sender_name}</div>
        )}
        {m.body}
      </div>
    </div>
  );
}

function mergeMessages(prev: Message[], fresh: Message[]): Message[] {
  const ids = new Set(prev.map((m) => m.id));
  const next = [...prev];
  for (const m of fresh) {
    if (!ids.has(m.id)) next.push(m);
  }
  return next;
}

function labelForStatus(s: SupportStatus): string {
  switch (s) {
    case "ai_active": return "AI";
    case "escalated": return "Queued";
    case "agent_active": return "Live";
    case "resolved": return "Resolved";
    case "closed": return "Closed";
  }
}

function timeAgo(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "abhi";
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
    return `${Math.floor(diff / 86400)} d ago`;
  } catch {
    return "";
  }
}
