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
import { w as wstr } from "@/lib/support/widget-strings";

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
  "/agent",
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

type LangKey = "hi" | "en" | "es" | "fr" | "ar";

const LANG_OPTIONS: Array<{ key: LangKey; flag: string; label: string }> = [
  { key: "hi", flag: "🇮🇳", label: "Hinglish" },
  { key: "en", flag: "🇺🇸", label: "English" },
  { key: "es", flag: "🇪🇸", label: "Español" },
  { key: "fr", flag: "🇫🇷", label: "Français" },
  { key: "ar", flag: "🇸🇦", label: "العربية" },
];

function getStoredLang(): LangKey {
  // v149 — Default is now ENGLISH (was Hinglish). Hindi only when the
  // browser is explicitly hi-* (not en-IN). User can still pick any
  // language from the header chip.
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem("sb_support_lang");
  if (saved && ["hi", "en", "es", "fr", "ar"].includes(saved)) return saved as LangKey;
  // Auto-detect from browser — STRICT prefix only (en-IN must NOT become hi)
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("hi")) return "hi";
  if (nav.startsWith("ar")) return "ar";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("fr")) return "fr";
  return "en";
}

// v149 — Pre-chat subject picker. The user picks one category which is
// saved as the conversation subject + as metadata.category. Agents see it
// in their inbox; future routing can target subject-specific agents.
type Category = {
  key: string;
  label: string;
  icon: string;
  hint: string;
};
const CATEGORIES: Category[] = [
  { key: "booking", label: "Booking", icon: "🏨", hint: "Confirm, modify, status" },
  { key: "bid", label: "Bid / Negotiate", icon: "🎟️", hint: "Counter, lifecycle, slots" },
  { key: "payment", label: "Payment", icon: "💳", hint: "Card, UPI, failed payment" },
  { key: "refund", label: "Refund", icon: "💰", hint: "Cancellations + chargebacks" },
  { key: "wallet_points", label: "Wallet / Points", icon: "⭐", hint: "StayPoints + balance" },
  { key: "tech", label: "Technical Issue", icon: "🔧", hint: "App / login / loading" },
  { key: "hotel_info", label: "Hotel Info", icon: "📍", hint: "Amenities, photos, reviews" },
  { key: "other", label: "Other", icon: "💬", hint: "Something else" },
];

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
  const [view, setView] = useState<"list" | "subject" | "chat">("list");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // Track previous unread to detect TRANSITIONS (0→N) and avoid spamming
  // notifications on every refresh.
  const prevUnreadRef = useRef<number>(-1);
  // Tracks whether we've already attempted to claim the anon chats for
  // this signed-in session — once claimed, this widget doesn't retry.
  const claimedRef = useRef<boolean>(false);
  // Language picker state — persists to localStorage
  const [lang, setLang] = useState<LangKey>("hi");
  const [langOpen, setLangOpen] = useState(false);
  // v157 — voice output toggle: when on, AI/agent messages are spoken
  // aloud via SpeechSynthesis on arrival. Persisted to localStorage.
  const [voiceOut, setVoiceOut] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setVoiceOut(localStorage.getItem("sb_support_voice_out") === "1");
  }, []);
  function toggleVoiceOut() {
    const next = !voiceOut;
    setVoiceOut(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("sb_support_voice_out", next ? "1" : "0");
      // Cancel any in-flight speech when turning off
      if (!next && "speechSynthesis" in window) speechSynthesis.cancel();
    }
  }
  useEffect(() => {
    setLang(getStoredLang());
  }, []);
  function changeLang(next: LangKey) {
    setLang(next);
    if (typeof window !== "undefined") localStorage.setItem("sb_support_lang", next);
    setLangOpen(false);
  }
  const currentLang = LANG_OPTIONS.find((o) => o.key === lang) || LANG_OPTIONS[0];
  // v150 — localized widget UI strings table
  const s = wstr(lang);

  // ⚠ v148.1 — DO NOT early-return BEFORE this point. All hooks must run
  // in the same order on every render. Moving the shouldHide check below
  // all useEffect calls fixes the "Application error: client-side
  // exception" crash that bit users navigating between /hotels (widget
  // shown) and / (widget hidden). Render-time gating now happens at the
  // JSX level via `isHidden`.
  const isHidden = shouldHide(pathname);

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
  // — when open, the inner chat polls itself every 5s). Skipped when
  // widget is hidden on the current route — saves needless network calls.
  useEffect(() => {
    if (open || isHidden) return;
    const t = setInterval(() => fetchConversations(), 60_000);
    return () => clearInterval(t);
  }, [open, token, isHidden]);

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

  // v149 — Start chat is now a 2-step flow:
  //   1. User taps "New chat" → opens subject picker
  //   2. User picks a category → calls /api/support/conversations
  //      with { subject, category } → opens chat view with seeded welcome
  function startNewChat() {
    setView("subject");
  }

  async function createConvWithCategory(cat: Category) {
    try {
      const r = await fetch("/api/support/conversations", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          subject: cat.label,
          category: cat.key,
          metadata: {
            pageUrl: typeof window !== "undefined" ? window.location.pathname : null,
            // Send picked language as ISO locale string.
            locale: ({ hi: "hi-IN", en: "en-US", es: "es-ES", fr: "fr-FR", ar: "ar-SA" })[lang],
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

  // Render gate AFTER all hooks have run — see ⚠ v148.1 note above.
  if (isHidden) return null;

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
                <div className="sb-support-avatar" aria-hidden>
                  <span className="sb-support-avatar-emoji">🎧</span>
                  <span className="sb-support-avatar-dot" />
                </div>
                <div className="sb-support-titleblock">
                  <div className="sb-support-title">{s.brandName}</div>
                  <div className="sb-support-subtitle">
                    {view === "chat" ? s.liveChat : s.brandSubtitle}
                  </div>
                </div>
              </div>
              <div className="sb-support-header-right">
                {/* v157 — Voice-out toggle */}
                <button
                  type="button"
                  onClick={toggleVoiceOut}
                  className="sb-support-voice-btn"
                  aria-label={voiceOut ? "Disable voice replies" : "Enable voice replies"}
                  title={voiceOut ? "Voice replies ON — tap to mute" : "Voice replies OFF — tap to enable"}
                  style={{ color: voiceOut ? "#7F9269" : undefined }}
                >
                  {voiceOut ? "🔊" : "🔇"}
                </button>
                <div className="sb-support-lang-wrap">
                  <button
                    type="button"
                    onClick={() => setLangOpen((p) => !p)}
                    className="sb-support-lang-btn"
                    aria-label={`Language: ${currentLang.label}`}
                    title={currentLang.label}
                  >
                    <span className="sb-support-lang-flag">{currentLang.flag}</span>
                    <span className="sb-support-lang-code">{lang.toUpperCase()}</span>
                    <span className="sb-support-lang-arrow">▾</span>
                  </button>
                  {langOpen && (
                    <div className="sb-support-lang-menu">
                      {LANG_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => changeLang(opt.key)}
                          className={`sb-support-lang-item ${opt.key === lang ? "is-active" : ""}`}
                        >
                          <span className="sb-support-lang-flag">{opt.flag}</span>
                          <span>{opt.label}</span>
                          {opt.key === lang && <span className="sb-support-lang-check">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeWidget}
                  className="sb-support-close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </header>

            {view === "list" ? (
              <ConversationList
                conversations={conversations}
                onOpen={openChat}
                onStartNew={startNewChat}
                signedIn={!!user}
                s={s}
              />
            ) : view === "subject" ? (
              <SubjectPicker
                onPick={createConvWithCategory}
                onCancel={() => setView("list")}
                s={s}
              />
            ) : activeId ? (
              <ChatView
                conversationId={activeId}
                token={token}
                lang={lang}
                s={s}
                voiceOut={voiceOut}
                onClosed={backToList}
              />
            ) : null}
          </div>
        </>
      )}

      <style jsx global>{`
        /* v151 — 3D animated responsive FAB.
           - Size cut roughly in half (56 → 32/36/40 across breakpoints)
           - Layered radial highlight gives 3D depth (top-left light source)
           - Outer pulse ring breathes (2.4s infinite)
           - Inner conic-gradient shimmer rotates slowly (8s infinite)
           - Idle bounce 4s cycle for "live" feel
           - Hover: scale + lift + shadow upgrade
        */
        .sb-support-fab {
          position: fixed;
          right: max(14px, env(safe-area-inset-right, 0px));
          bottom: calc(96px + env(safe-area-inset-bottom, 0px));
          z-index: 9998;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          /* 3D base: radial highlight + linear undercoat */
          background:
            radial-gradient(circle at 30% 25%, rgba(255,255,255,0.55), rgba(255,255,255,0) 55%),
            linear-gradient(155deg, #E7CFA0 0%, #C9A66B 45%, #8B6914 100%);
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          line-height: 1;
          box-shadow:
            /* Outer ambient drop */
            0 10px 22px -6px rgba(31, 26, 15, 0.45),
            0 4px 8px -2px rgba(31, 26, 15, 0.28),
            /* Outer rim ring */
            0 0 0 1px rgba(184, 134, 11, 0.32),
            /* Inner top highlight */
            inset 0 1px 0 rgba(255, 255, 255, 0.55),
            /* Inner bottom shadow */
            inset 0 -2px 4px rgba(31, 26, 15, 0.25);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          animation: sbFabBreathe 4s ease-in-out infinite;
          overflow: visible;
          isolation: isolate;
        }
        .sb-support-fab::before {
          /* Live pulsing ring */
          content: "";
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 2px solid rgba(212, 175, 55, 0.55);
          opacity: 0;
          animation: sbFabPulse 2.4s ease-out infinite;
          pointer-events: none;
        }
        .sb-support-fab::after {
          /* Rotating conic shimmer overlay */
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            rgba(255, 255, 255, 0.20) 60deg,
            transparent 120deg,
            transparent 240deg,
            rgba(255, 255, 255, 0.12) 300deg,
            transparent 360deg
          );
          mix-blend-mode: screen;
          animation: sbFabSheen 8s linear infinite;
          pointer-events: none;
        }
        @keyframes sbFabBreathe {
          0%, 100% { transform: translateY(0) scale(1); }
          50%      { transform: translateY(-1px) scale(1.04); }
        }
        @keyframes sbFabPulse {
          0%   { opacity: 0.7; transform: scale(1); }
          70%  { opacity: 0; transform: scale(1.55); }
          100% { opacity: 0; transform: scale(1.55); }
        }
        @keyframes sbFabSheen {
          to { transform: rotate(360deg); }
        }
        .sb-support-fab:hover {
          transform: translateY(-3px) scale(1.1);
          box-shadow:
            0 14px 30px -6px rgba(31, 26, 15, 0.55),
            0 6px 12px -2px rgba(31, 26, 15, 0.35),
            0 0 0 1px rgba(184, 134, 11, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.65),
            inset 0 -2px 4px rgba(31, 26, 15, 0.25);
          animation-play-state: paused;
        }
        .sb-support-fab-icon {
          line-height: 1;
          position: relative;
          z-index: 2;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.25));
        }
        .sb-support-fab-badge {
          position: absolute;
          top: -3px;
          right: -3px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: linear-gradient(140deg, #FF6B7A, #D49583);
          color: #fff;
          border-radius: 999px;
          border: 1.5px solid #FFFCF6;
          font-size: 9.5px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 3;
          box-shadow: 0 2px 4px rgba(212, 86, 95, 0.4);
        }
        @media (prefers-reduced-motion: reduce) {
          .sb-support-fab,
          .sb-support-fab::before,
          .sb-support-fab::after { animation: none; }
        }
        /* Tablet: 600-1023px */
        @media (min-width: 600px) {
          .sb-support-fab {
            width: 38px;
            height: 38px;
            font-size: 16px;
            right: max(18px, env(safe-area-inset-right, 0px));
          }
        }
        /* Laptop / Desktop: ≥1024px */
        @media (min-width: 1024px) {
          .sb-support-fab {
            width: 40px;
            height: 40px;
            font-size: 17px;
            bottom: max(24px, env(safe-area-inset-bottom, 0px));
            right: 22px;
          }
        }
        /* Wide desktop: ≥1440px — a hair bigger for visibility */
        @media (min-width: 1440px) {
          .sb-support-fab {
            width: 44px;
            height: 44px;
            font-size: 18px;
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
          width: min(420px, calc(100vw - 24px));
          height: min(680px, calc(100vh - 220px));
          background: #FFFCF6;
          border-radius: 22px;
          border: 1px solid rgba(201, 166, 107, 0.28);
          box-shadow:
            0 32px 64px -12px rgba(31, 26, 15, 0.45),
            0 14px 32px -8px rgba(139, 105, 20, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.55);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: sbSupportPanelIn 0.24s cubic-bezier(.4, .8, .3, 1.1) both;
        }
        @keyframes sbSupportPanelIn {
          from { opacity: 0; transform: translateY(10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        /* v156 — URL-bar overlap fix.
           Use top constraint + safe-area-inset-top so browser chrome
           (Chrome address bar on mobile) can NEVER cover the widget
           header. Was: pure bottom+height could push widget under URL bar
           when address bar was visible. */
        @media (max-width: 480px) {
          .sb-support-panel {
            right: 12px;
            left: 12px;
            top: calc(env(safe-area-inset-top, 0px) + 70px);
            bottom: calc(84px + env(safe-area-inset-bottom, 0px));
            width: auto;
            height: auto;
            border-radius: 20px;
          }
        }
        /* v153 — bigger widget on laptop / desktop. User reported window
           feels small on desktop. Now scales up with screen real estate. */
        @media (min-width: 1024px) {
          .sb-support-panel {
            width: 480px;
            height: 740px;
            max-height: calc(100vh - 80px);
            bottom: 80px;
            right: 22px;
          }
        }
        @media (min-width: 1440px) {
          .sb-support-panel {
            width: 540px;
            height: 800px;
            max-height: calc(100vh - 80px);
          }
        }

        .sb-support-header {
          flex: 0 0 auto;
          padding: 14px 14px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: linear-gradient(180deg, #FFFCF6 0%, #FAF5EB 100%);
          border-bottom: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          position: relative;
        }
        .sb-support-header::after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: -1px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(201, 166, 107, 0.45), transparent);
        }
        .sb-support-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }
        .sb-support-header-right {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
        }
        .sb-support-avatar {
          position: relative;
          width: 38px;
          height: 38px;
          flex: 0 0 auto;
          border-radius: 50%;
          background: linear-gradient(140deg, #E7CFA0, #C9A66B 60%, #8B6914);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px -2px rgba(139, 105, 20, 0.35), inset 0 1px 0 rgba(255,255,255,0.45);
        }
        .sb-support-avatar-emoji {
          font-size: 18px;
          line-height: 1;
          filter: drop-shadow(0 1px 1px rgba(0,0,0,0.15));
        }
        .sb-support-avatar-dot {
          position: absolute;
          right: -1px;
          bottom: -1px;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: #7F9269;
          border: 2px solid #FFFCF6;
          box-shadow: 0 0 0 0 rgba(127, 146, 105, 0.4);
          animation: sbSupportAvatarPulse 2s ease-in-out infinite;
        }
        @keyframes sbSupportAvatarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(127, 146, 105, 0.55); }
          50% { box-shadow: 0 0 0 4px rgba(127, 146, 105, 0); }
        }
        .sb-support-back {
          background: transparent;
          border: none;
          font-size: 18px;
          line-height: 1;
          padding: 6px 8px;
          cursor: pointer;
          color: var(--text-base, #1F1A0F);
          border-radius: 8px;
          flex: 0 0 auto;
        }
        .sb-support-back:hover { background: rgba(0, 0, 0, 0.04); }
        .sb-support-titleblock { min-width: 0; flex: 1; }
        .sb-support-title {
          font-family: "Cormorant Garamond", serif;
          font-style: italic;
          font-size: 19px;
          font-weight: 600;
          color: var(--text-base, #1F1A0F);
          line-height: 1.15;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sb-support-subtitle {
          font-size: 11px;
          color: var(--text-muted, #6E5430);
          margin-top: 1px;
        }
        .sb-support-lang-wrap {
          position: relative;
        }
        .sb-support-lang-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: rgba(201, 166, 107, 0.12);
          border: 1px solid rgba(201, 166, 107, 0.35);
          color: var(--text-base, #1F1A0F);
          padding: 5px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sb-support-lang-btn:hover {
          background: rgba(201, 166, 107, 0.22);
          border-color: rgba(201, 166, 107, 0.55);
        }
        .sb-support-lang-flag { font-size: 13px; line-height: 1; }
        .sb-support-lang-code { letter-spacing: 0.04em; }
        .sb-support-lang-arrow { font-size: 9px; opacity: 0.65; }
        .sb-support-lang-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          background: #FFFCF6;
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          border-radius: 10px;
          box-shadow: 0 12px 32px -6px rgba(31, 26, 15, 0.25);
          padding: 4px;
          z-index: 10;
          min-width: 160px;
          animation: sbSupportLangIn 0.16s ease-out both;
        }
        @keyframes sbSupportLangIn {
          from { opacity: 0; transform: translateY(-4px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sb-support-lang-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          background: transparent;
          border: none;
          font-size: 13px;
          color: var(--text-base, #1F1A0F);
          cursor: pointer;
          border-radius: 7px;
          text-align: left;
        }
        .sb-support-lang-item:hover { background: rgba(201, 166, 107, 0.10); }
        .sb-support-lang-item.is-active { background: rgba(201, 166, 107, 0.18); font-weight: 600; }
        .sb-support-lang-check { margin-left: auto; color: #8B6914; font-size: 13px; }
        /* v157 — Voice-out toggle button (header) */
        .sb-support-voice-btn {
          background: transparent;
          border: none;
          font-size: 16px;
          padding: 5px 9px;
          cursor: pointer;
          color: var(--text-muted, #6E5430);
          border-radius: 8px;
          line-height: 1;
        }
        .sb-support-voice-btn:hover { background: rgba(0,0,0,0.04); }
        /* v157 — Mic button (chat input) */
        .sb-support-mic-btn {
          flex: 0 0 auto;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 1px solid rgba(201, 166, 107, 0.4);
          background: rgba(201, 166, 107, 0.10);
          color: #8B6914;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.18s ease;
        }
        .sb-support-mic-btn:hover { background: rgba(201, 166, 107, 0.18); }
        .sb-support-mic-btn.is-listening {
          /* v158 — push-to-talk active state: bigger, redder, dramatic */
          background: linear-gradient(140deg, #FF5566, #D02030);
          color: #fff;
          border-color: rgba(255, 60, 80, 0.7);
          transform: scale(1.18);
          animation: sbMicPulse 1.1s ease-in-out infinite;
          z-index: 2;
        }
        @keyframes sbMicPulse {
          0%, 100% {
            box-shadow:
              0 0 0 0 rgba(255, 60, 80, 0.55),
              0 4px 12px rgba(208, 32, 48, 0.45);
          }
          50% {
            box-shadow:
              0 0 0 14px rgba(255, 60, 80, 0),
              0 4px 12px rgba(208, 32, 48, 0.45);
          }
        }
        .sb-support-mic-btn { user-select: none; -webkit-touch-callout: none; }
        .sb-support-close {
          background: transparent;
          border: none;
          font-size: 16px;
          padding: 6px 10px;
          cursor: pointer;
          color: var(--text-muted, #6E5430);
          border-radius: 6px;
          flex: 0 0 auto;
        }
        .sb-support-close:hover { background: rgba(0, 0, 0, 0.04); color: var(--text-base, #1F1A0F); }
      `}</style>
    </>
  );
}

// ─── v149 Subject picker (pre-chat) ────────────────────────
function SubjectPicker({
  onPick,
  onCancel,
  s,
}: {
  onPick: (cat: Category) => void;
  onCancel: () => void;
  s: ReturnType<typeof wstr>;
}) {
  return (
    <div className="sb-support-subjects">
      <div className="sb-support-subjects-title">{s.subjectTitle}</div>
      <div className="sb-support-subjects-sub">{s.subjectSub}</div>
      <div className="sb-support-subjects-grid">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => onPick(cat)}
            className="sb-support-subject-btn"
          >
            <span className="sb-support-subject-icon">{cat.icon}</span>
            <span className="sb-support-subject-label">{cat.label}</span>
            <span className="sb-support-subject-hint">{cat.hint}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel} className="sb-support-subject-cancel">
        {s.subjectBack}
      </button>
      <style jsx global>{`
        .sb-support-subjects {
          flex: 1 1 auto;
          overflow-y: auto;
          padding: 18px 16px 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sb-support-subjects-title {
          font-family: "Cormorant Garamond", serif;
          font-style: italic;
          font-size: 19px;
          font-weight: 600;
          color: var(--text-base, #1F1A0F);
        }
        .sb-support-subjects-sub {
          font-size: 12px;
          color: var(--text-muted, #6E5430);
          line-height: 1.5;
          margin-top: -6px;
        }
        .sb-support-subjects-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 6px;
        }
        @media (max-width: 380px) {
          .sb-support-subjects-grid { grid-template-columns: 1fr; }
        }
        .sb-support-subject-btn {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          background: linear-gradient(160deg, #FFFCF6 0%, #F8EFDA 100%);
          border: 1px solid rgba(201, 166, 107, 0.32);
          border-radius: 14px;
          padding: 14px 14px 12px;
          cursor: pointer;
          text-align: left;
          color: var(--text-base, #1F1A0F);
          transition: all 0.18s ease;
          position: relative;
          overflow: hidden;
        }
        .sb-support-subject-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 18px -6px rgba(139, 105, 20, 0.30);
          border-color: rgba(201, 166, 107, 0.55);
        }
        .sb-support-subject-icon {
          font-size: 24px;
          line-height: 1;
          margin-bottom: 4px;
        }
        .sb-support-subject-label {
          font-weight: 700;
          font-size: 13.5px;
          letter-spacing: 0.01em;
        }
        .sb-support-subject-hint {
          font-size: 11px;
          color: var(--text-muted, #6E5430);
          line-height: 1.35;
        }
        .sb-support-subject-cancel {
          margin-top: auto;
          align-self: flex-start;
          background: transparent;
          border: none;
          color: var(--text-muted, #6E5430);
          font-size: 12px;
          padding: 8px 4px;
          cursor: pointer;
        }
        .sb-support-subject-cancel:hover {
          color: var(--text-base, #1F1A0F);
        }
      `}</style>
    </div>
  );
}

// ─── Conversation list view ────────────────────────────────
function ConversationList({
  conversations,
  onOpen,
  onStartNew,
  signedIn,
  s,
}: {
  conversations: Conversation[];
  onOpen: (id: string) => void;
  onStartNew: () => void;
  signedIn: boolean;
  s: ReturnType<typeof wstr>;
}) {
  return (
    <div className="sb-support-list">
      <button type="button" onClick={onStartNew} className="sb-support-new-btn">
        {s.newChatBtn}
      </button>
      {!signedIn && (
        <div className="sb-support-anon-note">
          {s.anonNote}
        </div>
      )}
      {conversations.length === 0 ? (
        <div className="sb-support-empty">
          <div className="sb-support-empty-emoji">✨</div>
          <div>{s.emptyTitle}</div>
          <div className="sb-support-empty-sub">{s.emptySub}</div>
        </div>
      ) : (
        <>
          <div className="sb-support-list-heading">{s.pastChats}</div>
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className="sb-support-list-item"
              onClick={() => onOpen(c.id)}
            >
              <div className="sb-support-list-item-top">
                <span className={`sb-support-list-status sb-support-list-status-${c.status}`}>
                  {labelForStatusS(c.status, s)}
                </span>
                {c.user_unread_count > 0 && (
                  <span className="sb-support-list-badge">{c.user_unread_count}</span>
                )}
              </div>
              <div className="sb-support-list-subject">
                {c.subject || "(no subject)"}
              </div>
              <div className="sb-support-list-time">
                {timeAgoS(c.last_message_at, s)}
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
  lang,
  s,
  voiceOut,
  onClosed,
}: {
  conversationId: string;
  token: string | null;
  lang: LangKey;
  s: ReturnType<typeof wstr>;
  voiceOut: boolean;
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
  // v157 — voice recognition (speech-to-text). Uses browser-native
  // Web Speech API — free, no API key. Chrome/Safari/Edge supported.
  // Firefox doesn't support; mic button just hides there.
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Track last spoken message id so we don't repeat speak on poll.
  const lastSpokenIdRef = useRef<string | null>(null);

  // Map widget lang → BCP-47 locale tag for speech APIs.
  const speechLocale = (
    { hi: "hi-IN", en: "en-US", es: "es-ES", fr: "fr-FR", ar: "ar-SA" } as const
  )[lang];

  // v158 — Pick the BEST available voice for the locale.
  // Prefer "Natural" / "Neural" / "Premium" / "Google" / "Microsoft"
  // voices when available — these sound much less robotic than defaults.
  const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    function pickVoice() {
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) return;
      const langBase = speechLocale.toLowerCase().split("-")[0];
      const matches = voices.filter((v) =>
        v.lang.toLowerCase().startsWith(langBase)
      );
      if (matches.length === 0) {
        selectedVoiceRef.current = null;
        return;
      }
      const premium = matches.find((v) =>
        /natural|neural|premium|wavenet|enhanced/i.test(v.name)
      );
      const google = matches.find((v) => /google/i.test(v.name));
      const microsoft = matches.find((v) => /microsoft|aria|heera|ravi/i.test(v.name));
      selectedVoiceRef.current = premium || google || microsoft || matches[0];
    }
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = null;
    };
  }, [speechLocale]);

  // Speak new AI / agent / system messages when voiceOut is on.
  useEffect(() => {
    if (!voiceOut || messages.length === 0) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const last = messages[messages.length - 1];
    if (last.sender === "user") return; // don't echo user's own messages
    if (lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    try {
      const utter = new SpeechSynthesisUtterance(last.body);
      utter.lang = speechLocale;
      if (selectedVoiceRef.current) utter.voice = selectedVoiceRef.current;
      utter.rate = 1.02;
      utter.pitch = 1.0;
      // Cancel any in-flight speech before starting a new one
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    } catch {}
  }, [messages, voiceOut, speechLocale]);

  // v158 — Push-to-talk redesign.
  // Hold mic → recording starts. Release → final transcript captured →
  // auto-sends to AI. No manual send tap needed.
  // Refs survive across re-renders so onend can read the final text
  // even if React hasn't flushed the latest setInput yet.
  const pttFinalTextRef = useRef<string>("");
  const pttActiveRef = useRef<boolean>(false);

  function startPushToTalk() {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input not supported in this browser. Try Chrome / Safari / Edge.");
      return;
    }
    // Clear previous state
    pttFinalTextRef.current = "";
    pttActiveRef.current = true;
    setInput("");

    try {
      const r = new SR();
      r.lang = speechLocale;
      // continuous=true so the recognizer keeps listening for the whole
      // hold duration instead of stopping after the first sentence.
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onresult = (e: any) => {
        let final = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i += 1) {
          const piece = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += piece + " ";
          else interim += piece;
        }
        const composed = (final + interim).trim();
        pttFinalTextRef.current = composed;
        setInput(composed);
      };
      r.onerror = () => {
        pttActiveRef.current = false;
        setListening(false);
      };
      r.onend = () => {
        setListening(false);
        // Auto-send if we got text from this PTT session
        if (pttActiveRef.current && pttFinalTextRef.current.trim().length > 0) {
          pttActiveRef.current = false;
          const finalText = pttFinalTextRef.current.trim();
          // Slight delay so input state visibly clears + UI updates
          setTimeout(() => send(finalText), 80);
        } else {
          pttActiveRef.current = false;
        }
      };
      r.start();
      recognitionRef.current = r;
      setListening(true);
    } catch {
      pttActiveRef.current = false;
      setListening(false);
    }
  }

  function endPushToTalk() {
    // r.onend will fire and auto-send (if any text was captured)
    try {
      recognitionRef.current?.stop();
    } catch {}
  }

  function cancelPushToTalk() {
    // User dragged away → abort without sending
    pttActiveRef.current = false;
    pttFinalTextRef.current = "";
    try {
      recognitionRef.current?.abort();
    } catch {}
    setListening(false);
    setInput("");
  }
  const supportsMic =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
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

  async function send(overrideText?: string) {
    // v158 — accept explicit text (used by push-to-talk auto-send so we
    // don't race with React state). Falls back to input state.
    const text = (overrideText ?? input).trim();
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
          // v149 — send the picked language per message so server can
          // route to fallback bot / Claude in the right language even if
          // user changes the picker mid-conversation.
          body: JSON.stringify({
            body: text,
            lang: ({ hi: "hi-IN", en: "en-US", es: "es-ES", fr: "fr-FR", ar: "ar-SA" })[lang],
          }),
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
    if (!conv) return s.placeholderActive;
    if (conv.status === "closed" || conv.status === "resolved") return s.placeholderLocked;
    if (conv.status === "agent_active") return s.placeholderAgent(conv.assigned_agent_name || "Agent");
    return s.placeholderActive;
  }, [conv, s]);

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
              <span>{s.statusAI}</span>
              {showEscalate && (
                <button
                  type="button"
                  className="sb-support-banner-action"
                  onClick={escalate}
                  disabled={escalating}
                >
                  {s.talkToHuman}
                </button>
              )}
            </>
          )}
          {conv.status === "escalated" && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-esc" />
              <span>{s.statusEscalated}</span>
            </>
          )}
          {conv.status === "agent_active" && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-agent" />
              <span>{s.statusAgent(conv.assigned_agent_name || "Support")}</span>
            </>
          )}
          {(conv.status === "resolved" || conv.status === "closed") && (
            <>
              <span className="sb-support-banner-dot sb-support-banner-dot-closed" />
              <span>{s.statusClosed}</span>
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
          placeholder={listening ? "🎙 Bolo… (release to send)" : placeholder}
          disabled={!!isLocked || sending}
          maxLength={4000}
        />
        {/* v158 — Push-to-talk mic button.
            HOLD = record (pointerDown), RELEASE = send (pointerUp).
            Drag away = cancel (pointerLeave).
            Hidden when browser doesn't support SpeechRecognition (Firefox).
            Uses Pointer Events for unified touch + mouse handling. */}
        {supportsMic && (
          <button
            type="button"
            onPointerDown={(e) => {
              if (isLocked || sending) return;
              e.preventDefault(); // prevent text input focus stealing
              startPushToTalk();
            }}
            onPointerUp={() => {
              if (listening) endPushToTalk();
            }}
            onPointerLeave={() => {
              if (listening) endPushToTalk();
            }}
            onPointerCancel={() => {
              if (listening) cancelPushToTalk();
            }}
            // Context-menu disabled so long-press doesn't trigger native menu
            onContextMenu={(e) => e.preventDefault()}
            disabled={!!isLocked || sending}
            className={`sb-support-mic-btn ${listening ? "is-listening" : ""}`}
            aria-label={listening ? "Recording — release to send" : "Push to talk"}
            title={listening ? "Release to send" : "Hold to talk"}
          >
            {listening ? "🔴" : "🎤"}
          </button>
        )}
        <button
          type="button"
          onClick={() => send()}
          disabled={!input.trim() || sending || !!isLocked}
        >
          {sending ? "…" : "➤"}
        </button>
      </div>

      {!isLocked && (
        <button
          type="button"
          onClick={closeChat}
          className="sb-support-chat-close-btn"
        >
          {s.markResolved}
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
          max-width: 80%;
          padding: 10px 14px;
          border-radius: 18px;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
          animation: sbBubbleIn 0.22s ease-out both;
          box-shadow: 0 1px 2px rgba(31, 26, 15, 0.05);
        }
        @keyframes sbBubbleIn {
          from { opacity: 0; transform: translateY(4px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sb-support-bubble-user {
          background: linear-gradient(140deg, #D9BE82, #C9A66B 55%, #8B6914);
          color: #fff;
          border-bottom-right-radius: 6px;
          text-shadow: 0 1px 0 rgba(0,0,0,0.05);
        }
        .sb-support-bubble-ai {
          background: #fff;
          color: var(--text-base, #1F1A0F);
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          border-bottom-left-radius: 6px;
        }
        .sb-support-bubble-agent {
          background: linear-gradient(140deg, #F0F4E8, #E0EAD0);
          color: var(--text-base, #1F1A0F);
          border: 1px solid rgba(127, 146, 105, 0.32);
          border-bottom-left-radius: 6px;
        }
        .sb-support-bubble-system {
          background: linear-gradient(140deg, rgba(201, 166, 107, 0.16), rgba(201, 166, 107, 0.08));
          color: var(--text-muted, #6E5430);
          border: 1px solid rgba(201, 166, 107, 0.22);
          font-size: 12.5px;
          font-style: italic;
          text-align: center;
          max-width: 92%;
          margin: 0 auto;
          border-radius: 14px;
        }
        .sb-support-msg-sender {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
          opacity: 0.72;
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
          padding: 12px 14px;
          background: linear-gradient(180deg, #FFFCF6 0%, #FAF5EB 100%);
          border-top: 1px solid var(--border-soft, rgba(184, 134, 11, 0.18));
          align-items: center;
        }
        .sb-support-chat-input input {
          flex: 1;
          min-width: 0;
          padding: 11px 14px;
          border-radius: 24px;
          border: 1px solid var(--border-soft, rgba(184, 134, 11, 0.22));
          font-size: 14px;
          background: #fff;
          color: var(--text-base, #1F1A0F);
          outline: none;
          transition: all 0.18s ease;
        }
        .sb-support-chat-input input::placeholder {
          color: rgba(110, 84, 48, 0.55);
        }
        .sb-support-chat-input input:focus {
          border-color: #C9A66B;
          box-shadow: 0 0 0 3px rgba(201, 166, 107, 0.18), 0 0 14px rgba(201, 166, 107, 0.22);
        }
        .sb-support-chat-input button {
          flex: 0 0 auto;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(140deg, #D9BE82, #C9A66B 55%, #8B6914);
          color: #fff;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 10px -2px rgba(139, 105, 20, 0.35), inset 0 1px 0 rgba(255,255,255,0.4);
          transition: transform 0.15s ease;
        }
        .sb-support-chat-input button:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.04);
        }
        .sb-support-chat-input button:disabled {
          opacity: 0.35;
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

function labelForStatusS(status: SupportStatus, s: ReturnType<typeof wstr>): string {
  switch (status) {
    case "ai_active": return s.statusPillAI;
    case "escalated": return s.statusPillQueued;
    case "agent_active": return s.statusPillLive;
    case "resolved": return s.statusPillResolved;
    case "closed": return s.statusPillClosed;
  }
}

function timeAgoS(iso: string, s: ReturnType<typeof wstr>): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return s.justNow;
    if (diff < 3600) return s.minAgo(Math.floor(diff / 60));
    if (diff < 86400) return s.hourAgo(Math.floor(diff / 3600));
    return s.dayAgo(Math.floor(diff / 86400));
  } catch {
    return "";
  }
}
