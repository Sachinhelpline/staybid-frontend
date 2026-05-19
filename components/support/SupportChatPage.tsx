"use client";

// v150 — Full-page chat view used by BOTH /admin/support/[id] and /agent/[id].
//
// The inline split-pane in SupportInbox was too cramped (user feedback:
// "reply karne ka itna kam space, jo type kar rahe wo dikh nahi raha").
// This dedicated route gives the conversation thread + composer + customer
// context their own breathing room.
//
// Reuses the SAME /api/admin/support/* endpoints so admins and agents
// (both with role in admin|super_admin|support_agent) can use it.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CANNED_REPLIES } from "@/lib/support/knowledge";

type SupportSender = "user" | "ai" | "agent" | "system";
type SupportStatus = "ai_active" | "escalated" | "agent_active" | "resolved" | "closed";

type Message = {
  id: string;
  conversation_id: string;
  sender: SupportSender;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
  ai_confidence: number | null;
};

type Conversation = {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  status: SupportStatus;
  subject: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  escalation_reason: string | null;
  escalated_at: string | null;
  last_message_at: string;
  agent_unread_count: number;
  user_message_count: number;
  metadata: any;
  created_at: string;
};

type UserContext = {
  user: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    tier: string | null;
    role: string | null;
    createdAt: string;
  } | null;
  recentBookings: Array<{ id: string; status: string; checkIn: string; checkOut: string; hotelId: string }>;
  recentBids: Array<{ id: string; status: string; amount: number; hotelId: string; createdAt: string }>;
  walletBalance: number;
};

export type SupportChatPageProps = {
  conversationId: string;
  tokenKey: string;
  userKey: string;
  backHref: string;        // "/admin/support" or "/agent"
};

function buildHeaders(tokenKey: string, userKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(tokenKey) || "";
  const user = JSON.parse(localStorage.getItem(userKey) || "{}");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (user?.id) h["x-admin-id"] = user.id;
  if (user?.phone) h["x-admin-phone"] = user.phone;
  if (user?.name) h["x-admin-name"] = user.name;
  return h;
}

export default function SupportChatPage({
  conversationId,
  tokenKey,
  userKey,
  backHref,
}: SupportChatPageProps) {
  const router = useRouter();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userCtx, setUserCtx] = useState<UserContext | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);
  const [showCanned, setShowCanned] = useState(false);
  const sinceRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const headers = () => buildHeaders(tokenKey, userKey);

  async function loadFull() {
    const r = await fetch(`/api/admin/support/conversations/${conversationId}`, {
      headers: headers(),
    });
    if (!r.ok) return;
    const j = await r.json();
    setConv(j.conversation);
    setMessages(j.messages || []);
    setUserCtx(j.userContext || null);
    sinceRef.current = j.messages?.length
      ? j.messages[j.messages.length - 1].created_at
      : new Date().toISOString();
    scrollToBottom();
  }

  useEffect(() => {
    loadFull();
    const t = setInterval(async () => {
      if (!sinceRef.current) return;
      try {
        const r = await fetch(
          `/api/admin/support/conversations/${conversationId}?since=${encodeURIComponent(sinceRef.current)}`,
          { headers: headers() }
        );
        if (!r.ok) return;
        const j = await r.json();
        const fresh: Message[] = j.messages || [];
        if (fresh.length) {
          setMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            return [...prev, ...fresh.filter((m) => !ids.has(m.id))];
          });
          sinceRef.current = fresh[fresh.length - 1].created_at;
          scrollToBottom();
        }
        if (j.conversation) setConv(j.conversation);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [conversationId]);

  function scrollToBottom() {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
  }

  async function send() {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await fetch(
        `/api/admin/support/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ body: text, aiSuggested }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        if (j.message) {
          setMessages((prev) => [...prev, j.message]);
          sinceRef.current = j.message.created_at;
          scrollToBottom();
        }
        setReply("");
        setAiSuggested(false);
      }
    } finally {
      setSending(false);
    }
  }

  async function action(name: "take" | "release" | "resolve" | "ai_handoff") {
    try {
      const r = await fetch(`/api/admin/support/conversations/${conversationId}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: name }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.conversation) setConv(j.conversation);
        if (name === "resolve") {
          // Navigate back to list after resolve
          setTimeout(() => router.push(backHref), 800);
        }
      }
    } catch {}
  }

  async function aiSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const r = await fetch(`/api/admin/support/suggest`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ conversationId }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.suggestion) {
          setReply(j.suggestion);
          setAiSuggested(true);
        }
      } else if (r.status === 503) {
        alert("AI suggestions disabled — ANTHROPIC_API_KEY not set");
      }
    } finally {
      setSuggesting(false);
    }
  }

  if (!conv) {
    return (
      <div style={S.loading}>Loading conversation…</div>
    );
  }

  const locked = conv.status === "closed" || conv.status === "resolved";
  const myId = typeof window !== "undefined"
    ? JSON.parse(localStorage.getItem(userKey) || "{}").id
    : null;
  const isMine = conv.assigned_agent_id && conv.assigned_agent_id === myId;

  return (
    <div style={S.root}>
      {/* Top bar */}
      <header style={S.topbar}>
        <Link href={backHref} style={S.backLink}>
          ← Back to inbox
        </Link>
        <div style={S.topbarRight}>
          <StatusPill status={conv.status} />
          {!conv.assigned_agent_id && !locked && (
            <button type="button" onClick={() => action("take")} style={S.btnPrimary}>
              ✋ Take
            </button>
          )}
          {isMine && !locked && (
            <>
              <button type="button" onClick={() => action("release")} style={S.btnSecondary}>
                Release
              </button>
              <button type="button" onClick={() => action("ai_handoff")} style={S.btnSecondary}>
                ↩ AI handoff
              </button>
            </>
          )}
          {!locked && (
            <button type="button" onClick={() => action("resolve")} style={S.btnResolve}>
              ✓ Resolve
            </button>
          )}
        </div>
      </header>

      {/* Body: thread (left) + context (right) */}
      <div style={S.body}>
        <main style={S.thread}>
          <div style={S.threadHeader}>
            <div style={S.subjectLine}>
              {conv.subject || "(no subject)"}
              {conv.metadata?.category && (
                <span style={S.categoryChip}>{conv.metadata.category}</span>
              )}
            </div>
            <div style={S.subMeta}>
              {conv.user_id || conv.anonymous_id || "—"}
              {conv.escalation_reason && ` · escalated: ${conv.escalation_reason}`}
              {" · "}started {timeAgo(conv.created_at)}
            </div>
          </div>

          <div ref={scrollRef} style={S.scroll}>
            {messages.map((m) => <Bubble key={m.id} m={m} />)}
          </div>

          {!locked && (
            <div style={S.composer}>
              <div style={S.composerTools}>
                <button type="button" onClick={aiSuggest} disabled={suggesting} style={S.toolBtn}>
                  {suggesting ? "…" : "🤖 Suggest reply"}
                </button>
                <div style={{ position: "relative" }}>
                  <button type="button" onClick={() => setShowCanned((p) => !p)} style={S.toolBtn}>
                    📋 Canned
                  </button>
                  {showCanned && (
                    <div style={S.cannedDropdown}>
                      {CANNED_REPLIES.map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => {
                            setReply(c.body);
                            setAiSuggested(false);
                            setShowCanned(false);
                          }}
                          style={S.cannedItem}
                        >
                          <div style={{ fontWeight: 600, color: "#E8EAF0" }}>{c.label}</div>
                          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                            {c.body.slice(0, 110)}…
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {aiSuggested && (
                  <span style={S.aiBadge}>AI-suggested · edit before send</span>
                )}
              </div>

              <textarea
                value={reply}
                onChange={(e) => {
                  setReply(e.target.value);
                  if (aiSuggested) setAiSuggested(false);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Type your reply…   (⌘+Enter or Ctrl+Enter to send)"
                style={S.composerInput}
                rows={6}
              />

              <div style={S.composerActions}>
                <span style={S.charCount}>{reply.length} / 4000</span>
                <button
                  type="button"
                  onClick={send}
                  disabled={!reply.trim() || sending}
                  style={S.btnSend}
                >
                  {sending ? "Sending…" : "Send →"}
                </button>
              </div>
            </div>
          )}
        </main>

        <aside style={S.contextRail}>
          <ContextPanel ctx={userCtx} conv={conv} />
        </aside>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const isUser = m.sender === "user";
  const isAI = m.sender === "ai";
  const isAgent = m.sender === "agent";
  const isSystem = m.sender === "system";
  const align = isUser ? "flex-end" : "flex-start";
  const bg =
    isUser ? "#1B2F3E"
    : isAI ? "#251D08"
    : isAgent ? "#1F2A18"
    : "#2A2210";
  const border =
    isUser ? "#3A557A"
    : isAI ? "#5C4313"
    : isAgent ? "#4A6633"
    : "#5E4A20";
  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 10 }}>
      <div
        style={{
          maxWidth: "72%",
          background: bg,
          border: `1px solid ${border}`,
          color: "#E8EAF0",
          padding: "12px 16px",
          borderRadius: 14,
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          fontStyle: isSystem ? "italic" : "normal",
          opacity: isSystem ? 0.85 : 1,
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.05,
            opacity: 0.75,
            marginBottom: 5,
            color: isAI ? "#D4AF37" : isAgent ? "#7BA361" : isUser ? "#82B2DD" : "#A89674",
          }}
        >
          {m.sender_name || m.sender}
          {m.ai_confidence != null && ` · conf ${m.ai_confidence}`}
          {" · "}
          {timeAgo(m.created_at)}
        </div>
        {m.body}
      </div>
    </div>
  );
}

function ContextPanel({ ctx, conv }: { ctx: UserContext | null; conv: Conversation }) {
  return (
    <div style={S.contextInner}>
      <Section title="Customer">
        {!ctx?.user ? (
          <div style={S.contextEmpty}>
            {conv.anonymous_id ? `Anonymous: ${conv.anonymous_id.slice(0, 18)}…` : "Not signed in"}
          </div>
        ) : (
          <>
            <Row label="Name" value={ctx.user.name || "—"} />
            <Row label="Phone" value={ctx.user.phone || "—"} />
            <Row label="Email" value={ctx.user.email || "—"} />
            <Row label="Tier" value={ctx.user.tier || "silver"} />
            <Row label="Wallet" value={`₹${ctx.walletBalance}`} />
          </>
        )}
      </Section>

      {ctx && ctx.recentBookings.length > 0 && (
        <Section title={`Recent bookings (${ctx.recentBookings.length})`}>
          {ctx.recentBookings.map((b) => (
            <div key={b.id} style={S.contextItem}>
              <div style={{ fontWeight: 600 }}>{b.status}</div>
              <div style={{ fontSize: 11.5, opacity: 0.75 }}>
                {b.checkIn?.slice(0, 10)} → {b.checkOut?.slice(0, 10)}
              </div>
              <div style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
                {b.id.slice(0, 18)}…
              </div>
            </div>
          ))}
        </Section>
      )}

      {ctx && ctx.recentBids.length > 0 && (
        <Section title={`Recent bids (${ctx.recentBids.length})`}>
          {ctx.recentBids.map((b) => (
            <div key={b.id} style={S.contextItem}>
              <div style={{ fontWeight: 600 }}>{b.status} · ₹{b.amount}</div>
              <div style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
                {b.id.slice(0, 18)}…
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Conversation">
        <Row label="Started" value={timeAgo(conv.created_at)} />
        <Row label="Messages" value={String(conv.user_message_count)} />
        {conv.metadata?.pageUrl && <Row label="From" value={conv.metadata.pageUrl} />}
        {conv.metadata?.locale && <Row label="Locale" value={conv.metadata.locale} />}
        {conv.metadata?.category && <Row label="Category" value={conv.metadata.category} />}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={S.contextSection}>
      <div style={S.contextSectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.contextRow}>
      <span style={S.contextLabel}>{label}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: SupportStatus }) {
  const map: Record<SupportStatus, [string, string]> = {
    ai_active: ["#D4AF37", "AI"],
    escalated: ["#FF4757", "Queue"],
    agent_active: ["#2ECC71", "Live"],
    resolved: ["#3D9CF5", "Resolved"],
    closed: ["#8A8FA8", "Closed"],
  };
  const [color, label] = map[status];
  return (
    <span
      style={{
        background: `${color}22`,
        color,
        fontSize: 11,
        fontWeight: 700,
        padding: "5px 12px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: 0.06,
        border: `1px solid ${color}55`,
      }}
    >
      {label}
    </span>
  );
}

function timeAgo(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

const S: Record<string, React.CSSProperties> = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#07080C",
    color: "#E8EAF0",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  loading: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#07080C",
    color: "#8A8FA8",
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  topbar: {
    flex: "0 0 auto",
    padding: "14px 22px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  backLink: {
    color: "#8A8FA8",
    fontSize: 13,
    textDecoration: "none",
    fontWeight: 500,
  },
  topbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  btnPrimary: {
    background: "#D4AF37",
    color: "#0F1117",
    border: "none",
    padding: "8px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnSecondary: {
    background: "#151820",
    color: "#E8EAF0",
    border: "1px solid rgba(255,255,255,0.12)",
    padding: "8px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnResolve: {
    background: "rgba(46, 204, 113, 0.16)",
    color: "#2ECC71",
    border: "1px solid rgba(46, 204, 113, 0.45)",
    padding: "8px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    minHeight: 0,
  },
  thread: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    overflow: "hidden",
  },
  threadHeader: {
    flex: "0 0 auto",
    padding: "16px 26px 14px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  subjectLine: {
    fontSize: 17,
    fontWeight: 700,
    color: "#E8EAF0",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  categoryChip: {
    background: "rgba(212, 175, 55, 0.12)",
    color: "#D4AF37",
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 10px",
    borderRadius: 999,
    textTransform: "capitalize",
    letterSpacing: 0.04,
    border: "1px solid rgba(212, 175, 55, 0.3)",
  },
  subMeta: {
    fontSize: 12,
    color: "#8A8FA8",
    marginTop: 5,
  },
  scroll: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 26px",
    background: "#07080C",
  },
  composer: {
    flex: "0 0 auto",
    padding: 22,
    background: "#0F1117",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  composerTools: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  toolBtn: {
    background: "#151820",
    color: "#E8EAF0",
    border: "1px solid rgba(255,255,255,0.14)",
    padding: "9px 16px",
    borderRadius: 9,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  aiBadge: {
    background: "rgba(212, 175, 55, 0.15)",
    color: "#D4AF37",
    fontSize: 11,
    padding: "5px 12px",
    borderRadius: 999,
    border: "1px solid rgba(212, 175, 55, 0.4)",
    fontWeight: 600,
  },
  cannedDropdown: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: 6,
    background: "#0F1117",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    width: 380,
    maxHeight: 360,
    overflowY: "auto",
    zIndex: 20,
    padding: 6,
    boxShadow: "0 16px 36px -8px rgba(0,0,0,0.7)",
  },
  cannedItem: {
    display: "block",
    width: "100%",
    background: "transparent",
    border: "none",
    padding: 12,
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
  },
  composerInput: {
    width: "100%",
    minHeight: 140,
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: "14px 16px",
    color: "#E8EAF0",
    fontSize: 14.5,
    lineHeight: 1.55,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
    boxSizing: "border-box",
  },
  composerActions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  charCount: {
    fontSize: 11,
    color: "#5E6273",
  },
  btnSend: {
    background: "linear-gradient(140deg, #E7CFA0, #D4AF37 55%, #8B6914)",
    color: "#0F1117",
    border: "none",
    padding: "12px 32px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 12px -2px rgba(212, 175, 55, 0.45)",
  },
  contextRail: {
    width: 320,
    flex: "0 0 320px",
    background: "#0F1117",
    borderLeft: "1px solid rgba(255,255,255,0.07)",
    overflowY: "auto",
  },
  contextInner: {
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  contextSection: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 16,
  },
  contextSectionTitle: {
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.06,
    color: "#D4AF37",
    marginBottom: 12,
  },
  contextEmpty: { color: "#8A8FA8", fontSize: 12.5, fontStyle: "italic" },
  contextRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12.5,
    color: "#E8EAF0",
    padding: "4px 0",
    gap: 10,
  },
  contextLabel: { color: "#8A8FA8" },
  contextItem: {
    background: "#0F1117",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    fontSize: 12.5,
    color: "#E8EAF0",
  },
};
