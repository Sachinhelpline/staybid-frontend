"use client";

// Admin / support_agent dashboard. Split layout: conversation list (left)
// + active conversation + user-context panel (right).
//
// Auth: admin layout already gates /admin/* and stores sb_admin_token in
// localStorage. We forward it as Authorization Bearer + identity headers,
// matching the existing /admin/messages and /admin/holds pattern.

import { useEffect, useMemo, useRef, useState } from "react";
import { CANNED_REPLIES } from "@/lib/support/knowledge";
import { notify } from "@/lib/notifications";

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
  recentBookings: Array<{
    id: string;
    status: string;
    checkIn: string;
    checkOut: string;
    hotelId: string;
  }>;
  recentBids: Array<{
    id: string;
    status: string;
    amount: number;
    hotelId: string;
    createdAt: string;
  }>;
  walletBalance: number;
};

type View = "queue" | "mine" | "all" | "resolved";

function adminHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("sb_admin_token") || "";
  const user = JSON.parse(localStorage.getItem("sb_admin_user") || "{}");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  if (user?.id) h["x-admin-id"] = user.id;
  if (user?.phone) h["x-admin-phone"] = user.phone;
  if (user?.name) h["x-admin-name"] = user.name;
  return h;
}

export default function AdminSupportPage() {
  const [view, setView] = useState<View>("queue");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  // Tracks conversation ids we've already alerted on this session so a
  // background refresh of an existing queue row doesn't re-notify.
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef<boolean>(true);

  async function loadList() {
    setLoadingList(true);
    try {
      const r = await fetch(
        `/api/admin/support/conversations?view=${view}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
        { headers: adminHeaders() }
      );
      if (!r.ok) return;
      const j = await r.json();
      const list: Conversation[] = j.conversations || [];

      // Desktop notification on NEW escalations entering the queue. Skip
      // on the first load — that's just initial state, not a new arrival.
      if (view === "queue" && !firstLoadRef.current) {
        for (const c of list) {
          if (c.status === "escalated" && !alertedIdsRef.current.has(c.id)) {
            alertedIdsRef.current.add(c.id);
            notify({
              kind: "warning",
              title: "New support escalation",
              body: c.subject || c.escalation_reason || "Open the inbox to view",
              duration: 8000,
            });
          }
        }
        // Garbage-collect alerted ids no longer in queue (resolved/taken)
        const liveIds = new Set(list.map((c) => c.id));
        alertedIdsRef.current = new Set(
          [...alertedIdsRef.current].filter((id) => liveIds.has(id))
        );
      } else if (view === "queue") {
        // Seed the alerted set on first load so we don't re-fire on
        // already-existing escalations.
        for (const c of list) {
          if (c.status === "escalated") alertedIdsRef.current.add(c.id);
        }
      }
      firstLoadRef.current = false;

      setConversations(list);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadList();
    // Background poll every 15s
    const t = setInterval(loadList, 15_000);
    return () => clearInterval(t);
  }, [view, search]);

  return (
    <div style={styles.root}>
      <header style={styles.topbar}>
        <div>
          <h1 style={styles.title}>Customer Support</h1>
          <div style={styles.subtitle}>Hybrid AI + human chat moderation</div>
        </div>
        <div style={styles.viewTabs}>
          {([
            ["queue", "Queue"],
            ["mine", "My active"],
            ["all", "All active"],
            ["resolved", "Resolved"],
          ] as Array<[View, string]>).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                ...styles.viewTab,
                ...(view === v ? styles.viewTabActive : {}),
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div style={styles.body}>
        <aside style={styles.sidebar}>
          <input
            type="text"
            placeholder="Search subject / user id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <div style={styles.listScroll}>
            {loadingList ? (
              <div style={styles.empty}>Loading…</div>
            ) : conversations.length === 0 ? (
              <div style={styles.empty}>Koi conversation nahi {view === "queue" ? "queue mein" : ""}.</div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    ...styles.convItem,
                    ...(selectedId === c.id ? styles.convItemActive : {}),
                  }}
                >
                  <div style={styles.convItemHeader}>
                    <StatusPill status={c.status} />
                    {c.agent_unread_count > 0 && (
                      <span style={styles.unreadBadge}>{c.agent_unread_count}</span>
                    )}
                  </div>
                  <div style={styles.convItemSubject}>
                    {c.subject || "(no subject)"}
                  </div>
                  <div style={styles.convItemMeta}>
                    {c.user_id ? `user ${c.user_id.slice(0, 10)}…` : `anon`}
                    {" · "}
                    {timeAgo(c.last_message_at)}
                    {c.escalation_reason ? ` · ${c.escalation_reason}` : ""}
                  </div>
                  {c.assigned_agent_name && (
                    <div style={styles.convItemAgent}>
                      🎫 {c.assigned_agent_name}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <main style={styles.main}>
          {selectedId ? (
            <ConversationDetail
              key={selectedId}
              conversationId={selectedId}
              onAfterAction={loadList}
            />
          ) : (
            <div style={styles.placeholder}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
              <div>Select a conversation to view + reply</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ConversationDetail({
  conversationId,
  onAfterAction,
}: {
  conversationId: string;
  onAfterAction: () => void;
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiFromSuggest, setAiFromSuggest] = useState(false);
  const sinceRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function loadFull() {
    const r = await fetch(`/api/admin/support/conversations/${conversationId}`, {
      headers: adminHeaders(),
    });
    if (!r.ok) return;
    const j = await r.json();
    setConv(j.conversation);
    setMessages(j.messages || []);
    setUserContext(j.userContext || null);
    sinceRef.current = j.messages?.length
      ? j.messages[j.messages.length - 1].created_at
      : new Date().toISOString();
    scrollToBottom();
  }

  useEffect(() => {
    loadFull();
    // Poll every 5s for new messages on the active conv
    const t = setInterval(async () => {
      if (!sinceRef.current) return;
      try {
        const r = await fetch(
          `/api/admin/support/conversations/${conversationId}?since=${encodeURIComponent(sinceRef.current)}`,
          { headers: adminHeaders() }
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
          headers: adminHeaders(),
          body: JSON.stringify({ body: text, aiSuggested: aiFromSuggest }),
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
        setAiFromSuggest(false);
        onAfterAction();
      }
    } finally {
      setSending(false);
    }
  }

  async function action(name: "take" | "release" | "resolve" | "ai_handoff") {
    try {
      const r = await fetch(
        `/api/admin/support/conversations/${conversationId}`,
        {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({ action: name }),
        }
      );
      if (r.ok) {
        const j = await r.json();
        if (j.conversation) setConv(j.conversation);
        onAfterAction();
      }
    } catch {}
  }

  async function aiSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const r = await fetch(`/api/admin/support/suggest`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ conversationId }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.suggestion) {
          setReply(j.suggestion);
          setAiFromSuggest(true);
        }
      } else if (r.status === 503) {
        alert("AI suggestions disabled — ANTHROPIC_API_KEY not set");
      }
    } finally {
      setSuggesting(false);
    }
  }

  if (!conv) return <div style={styles.placeholder}>Loading conversation…</div>;

  const locked = conv.status === "closed" || conv.status === "resolved";
  const isMine = conv.assigned_agent_id && typeof window !== "undefined"
    && conv.assigned_agent_id === JSON.parse(localStorage.getItem("sb_admin_user") || "{}").id;

  return (
    <div style={styles.detail}>
      <div style={styles.detailLeft}>
        <header style={styles.detailHeader}>
          <div>
            <div style={styles.detailSubject}>{conv.subject || "(no subject)"}</div>
            <div style={styles.detailMeta}>
              <StatusPill status={conv.status} />
              {" · "}
              {conv.user_id || conv.anonymous_id || "—"}
              {conv.escalation_reason ? ` · escalated: ${conv.escalation_reason}` : ""}
            </div>
          </div>
          <div style={styles.detailActions}>
            {!conv.assigned_agent_id && !locked && (
              <button type="button" onClick={() => action("take")} style={styles.btnPrimary}>
                ✋ Take
              </button>
            )}
            {isMine && !locked && (
              <>
                <button type="button" onClick={() => action("release")} style={styles.btnSecondary}>
                  Release
                </button>
                <button type="button" onClick={() => action("ai_handoff")} style={styles.btnSecondary}>
                  ↩ AI handoff
                </button>
              </>
            )}
            {!locked && (
              <button type="button" onClick={() => action("resolve")} style={styles.btnResolve}>
                ✓ Resolve
              </button>
            )}
          </div>
        </header>

        <div ref={scrollRef} style={styles.detailScroll}>
          {messages.map((m) => (
            <AdminMessageRow key={m.id} m={m} />
          ))}
        </div>

        {!locked && (
          <div style={styles.composer}>
            <div style={styles.composerTools}>
              <button type="button" onClick={aiSuggest} disabled={suggesting} style={styles.toolBtn}>
                {suggesting ? "…" : "🤖 Suggest reply"}
              </button>
              <details style={{ position: "relative" }}>
                <summary style={{ ...styles.toolBtn, cursor: "pointer", listStyle: "none" }}>
                  📋 Canned
                </summary>
                <div style={styles.cannedDropdown}>
                  {CANNED_REPLIES.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => {
                        setReply(c.body);
                        setAiFromSuggest(false);
                      }}
                      style={styles.cannedItem}
                    >
                      <div style={{ fontWeight: 600 }}>{c.label}</div>
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                        {c.body.slice(0, 80)}…
                      </div>
                    </button>
                  ))}
                </div>
              </details>
              {aiFromSuggest && (
                <span style={styles.aiSuggestBadge}>AI-suggested · edit before send</span>
              )}
            </div>
            <textarea
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                if (aiFromSuggest) setAiFromSuggest(false);
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type reply… (⌘+Enter to send)"
              style={styles.composerInput}
              rows={4}
            />
            <button
              type="button"
              onClick={send}
              disabled={!reply.trim() || sending}
              style={styles.btnSend}
            >
              {sending ? "Sending…" : "Send →"}
            </button>
          </div>
        )}
      </div>

      <aside style={styles.contextPanel}>
        <ContextPanel ctx={userContext} conv={conv} />
      </aside>
    </div>
  );
}

function AdminMessageRow({ m }: { m: Message }) {
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
    <div style={{ display: "flex", justifyContent: align, marginBottom: 8 }}>
      <div
        style={{
          maxWidth: "78%",
          background: bg,
          border: `1px solid ${border}`,
          color: "#E8EAF0",
          padding: "8px 12px",
          borderRadius: 10,
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          fontStyle: isSystem ? "italic" : "normal",
          opacity: isSystem ? 0.85 : 1,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.04,
            opacity: 0.75,
            marginBottom: 3,
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
    <div style={styles.contextInner}>
      <div style={styles.contextSection}>
        <div style={styles.contextSectionTitle}>Customer</div>
        {!ctx?.user ? (
          <div style={styles.contextEmpty}>
            {conv.anonymous_id ? `Anonymous: ${conv.anonymous_id.slice(0, 16)}…` : "Not signed in"}
          </div>
        ) : (
          <div>
            <div style={styles.contextRow}>
              <span style={styles.contextLabel}>Name</span>
              <span>{ctx.user.name || "—"}</span>
            </div>
            <div style={styles.contextRow}>
              <span style={styles.contextLabel}>Phone</span>
              <span>{ctx.user.phone || "—"}</span>
            </div>
            <div style={styles.contextRow}>
              <span style={styles.contextLabel}>Email</span>
              <span>{ctx.user.email || "—"}</span>
            </div>
            <div style={styles.contextRow}>
              <span style={styles.contextLabel}>Tier</span>
              <span>{ctx.user.tier || "silver"}</span>
            </div>
            <div style={styles.contextRow}>
              <span style={styles.contextLabel}>Wallet</span>
              <span>₹{ctx.walletBalance}</span>
            </div>
          </div>
        )}
      </div>

      {ctx && ctx.recentBookings.length > 0 && (
        <div style={styles.contextSection}>
          <div style={styles.contextSectionTitle}>Recent bookings</div>
          {ctx.recentBookings.map((b) => (
            <div key={b.id} style={styles.contextItem}>
              <div style={{ fontWeight: 600 }}>{b.status}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {b.checkIn?.slice(0, 10)} → {b.checkOut?.slice(0, 10)}
              </div>
              <div style={{ fontSize: 10, opacity: 0.55, fontFamily: "monospace" }}>
                {b.id.slice(0, 14)}…
              </div>
            </div>
          ))}
        </div>
      )}

      {ctx && ctx.recentBids.length > 0 && (
        <div style={styles.contextSection}>
          <div style={styles.contextSectionTitle}>Recent bids</div>
          {ctx.recentBids.map((b) => (
            <div key={b.id} style={styles.contextItem}>
              <div style={{ fontWeight: 600 }}>
                {b.status} · ₹{b.amount}
              </div>
              <div style={{ fontSize: 10, opacity: 0.55, fontFamily: "monospace" }}>
                {b.id.slice(0, 14)}…
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.contextSection}>
        <div style={styles.contextSectionTitle}>Conversation</div>
        <div style={styles.contextRow}>
          <span style={styles.contextLabel}>Started</span>
          <span>{timeAgo(conv.created_at)}</span>
        </div>
        <div style={styles.contextRow}>
          <span style={styles.contextLabel}>Messages</span>
          <span>{conv.user_message_count}</span>
        </div>
        {conv.metadata?.pageUrl && (
          <div style={styles.contextRow}>
            <span style={styles.contextLabel}>From</span>
            <span style={{ fontFamily: "monospace", fontSize: 10 }}>
              {conv.metadata.pageUrl}
            </span>
          </div>
        )}
      </div>
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
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        textTransform: "uppercase",
        letterSpacing: 0.05,
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
    if (diff < 60) return "abhi";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 60px)",
    fontFamily: "'DM Sans', system-ui, sans-serif",
    color: "#E8EAF0",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  title: {
    fontFamily: "'Syne', serif",
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
    color: "#E8EAF0",
  },
  subtitle: {
    fontSize: 12,
    color: "#8A8FA8",
    marginTop: 2,
  },
  viewTabs: { display: "flex", gap: 6 },
  viewTab: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#8A8FA8",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  viewTabActive: {
    background: "rgba(212, 175, 55, 0.15)",
    color: "#D4AF37",
    borderColor: "rgba(212, 175, 55, 0.4)",
  },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  sidebar: {
    width: 340,
    flex: "0 0 340px",
    background: "#0F1117",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    padding: 12,
    gap: 10,
  },
  searchInput: {
    width: "100%",
    padding: "8px 12px",
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "#E8EAF0",
    fontSize: 13,
    outline: "none",
  },
  listScroll: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 },
  empty: { padding: 24, textAlign: "center", color: "#8A8FA8", fontSize: 13 },
  convItem: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    color: "#E8EAF0",
    padding: 10,
    borderRadius: 10,
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  convItemActive: {
    background: "rgba(212, 175, 55, 0.08)",
    borderColor: "rgba(212, 175, 55, 0.4)",
  },
  convItemHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  convItemSubject: { fontSize: 13, color: "#E8EAF0" },
  convItemMeta: { fontSize: 11, color: "#8A8FA8" },
  convItemAgent: { fontSize: 10, color: "#7BA361", marginTop: 2 },
  unreadBadge: {
    background: "#FF4757",
    color: "#fff",
    fontSize: 10,
    fontWeight: 700,
    padding: "1px 7px",
    borderRadius: 999,
  },
  main: { flex: 1, display: "flex", flexDirection: "column", background: "#07080C", overflow: "hidden" },
  placeholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#8A8FA8",
    fontSize: 14,
  },
  detail: { flex: 1, display: "flex", overflow: "hidden" },
  detailLeft: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    background: "#0F1117",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  detailSubject: { fontSize: 15, fontWeight: 600, color: "#E8EAF0" },
  detailMeta: { fontSize: 11, color: "#8A8FA8", marginTop: 3, display: "flex", alignItems: "center", gap: 6 },
  detailActions: { display: "flex", gap: 6 },
  btnPrimary: {
    background: "#D4AF37",
    color: "#0F1117",
    border: "none",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  btnSecondary: {
    background: "#151820",
    color: "#E8EAF0",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnResolve: {
    background: "rgba(46, 204, 113, 0.15)",
    color: "#2ECC71",
    border: "1px solid rgba(46, 204, 113, 0.4)",
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  detailScroll: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    background: "#07080C",
  },
  composer: {
    flex: "0 0 auto",
    padding: 12,
    background: "#0F1117",
    borderTop: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  composerTools: { display: "flex", gap: 6, alignItems: "center" },
  toolBtn: {
    background: "#151820",
    color: "#E8EAF0",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  aiSuggestBadge: {
    background: "rgba(212, 175, 55, 0.15)",
    color: "#D4AF37",
    fontSize: 10,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid rgba(212, 175, 55, 0.4)",
  },
  cannedDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: 4,
    background: "#0F1117",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    width: 320,
    maxHeight: 320,
    overflowY: "auto",
    zIndex: 10,
    padding: 4,
  },
  cannedItem: {
    background: "transparent",
    color: "#E8EAF0",
    border: "none",
    padding: 8,
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    fontSize: 12,
  },
  composerInput: {
    width: "100%",
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: 10,
    color: "#E8EAF0",
    fontSize: 13,
    fontFamily: "inherit",
    resize: "vertical",
    outline: "none",
  },
  btnSend: {
    alignSelf: "flex-end",
    background: "#D4AF37",
    color: "#0F1117",
    border: "none",
    padding: "8px 22px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  contextPanel: {
    width: 280,
    flex: "0 0 280px",
    background: "#0F1117",
    borderLeft: "1px solid rgba(255,255,255,0.07)",
    overflowY: "auto",
  },
  contextInner: { padding: 14, display: "flex", flexDirection: "column", gap: 14 },
  contextSection: {
    background: "#151820",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    padding: 12,
  },
  contextSectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.05,
    color: "#D4AF37",
    marginBottom: 10,
  },
  contextEmpty: { color: "#8A8FA8", fontSize: 12, fontStyle: "italic" },
  contextRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#E8EAF0",
    padding: "3px 0",
  },
  contextLabel: { color: "#8A8FA8" },
  contextItem: {
    background: "#0F1117",
    border: "1px solid rgba(255,255,255,0.05)",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    fontSize: 12,
    color: "#E8EAF0",
  },
};
