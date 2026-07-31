"use client";
// ── Global notification toaster ───────────────────────────────────────
// Mounted once in app/layout.tsx. Subscribes to "sb:notify" custom events
// (dispatched via lib/notifications.ts `notify()`) and renders a stack of
// dismissable toast cards.
//
// v176 — cozy theme + native-per-device placement:
//   · mobile  (<640px)   → bottom sheet stack, edge-to-edge, slides up,
//                          lifted clear of the BottomDock + safe-area.
//   · tablet  (640-1023) → top-right, 340px card, slides in from right,
//                          clears the notch via safe-area-inset-top.
//   · desktop (≥1024px)  → top-right, 380px card, slides in from right.
// Cards read cozy theme tokens so they render in light + dark mode.

import { useEffect, useState } from "react";
import { onNotify, type Notification, type NotificationKind } from "@/lib/notifications";

// Per-kind accent. Card surface is always var(--bg-card) — only the
// accent strip, icon bubble + primary button carry the colour. `onAccent`
// is the text colour that reads on top of a solid `accent` fill.
const KIND_STYLE: Record<NotificationKind, { accent: string; onAccent: string; icon: string }> = {
  bid_accepted:       { accent: "#7F9269", onAccent: "#fff",     icon: "🎉" },
  bid_countered:      { accent: "#C77B43", onAccent: "#fff",     icon: "🤝" },
  bid_rejected:       { accent: "#C77E6D", onAccent: "#fff",     icon: "✕"  },
  bid_auto_cancelled: { accent: "#8A7B5F", onAccent: "#fff",     icon: "⏰" },
  bid_expiring_soon:  { accent: "#5f7c98", onAccent: "#1a1205",  icon: "⏱"  },
  hold_expiring_soon: { accent: "#5f7c98", onAccent: "#1a1205",  icon: "🔒" },
  info:               { accent: "#8198ae", onAccent: "#fff",     icon: "ℹ️" },
  success:            { accent: "#7F9269", onAccent: "#fff",     icon: "✓"  },
  warning:            { accent: "#5f7c98", onAccent: "#1a1205",  icon: "⚠"  },
  error:              { accent: "#C77E6D", onAccent: "#fff",     icon: "✕"  },
};

export default function NotificationToast() {
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    const off = onNotify((n) => {
      setItems((prev) => {
        // Dedup by id
        if (prev.some((p) => p.id === n.id)) return prev;
        return [n, ...prev].slice(0, 4); // max 4 stacked
      });
      // Auto-dismiss after duration if not sticky
      if (n.duration && n.duration > 0) {
        setTimeout(() => {
          setItems((prev) => prev.filter((p) => p.id !== n.id));
        }, n.duration);
      }
    });
    return off;
  }, []);

  const dismiss = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));

  if (items.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes sbToastIn    { from{transform:translateX(120%);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes sbToastInBot { from{transform:translateY(120%);opacity:0} to{transform:translateY(0);opacity:1} }

        /* ── Desktop (≥1024px): top-right, 380px card ── */
        .sb-toast-wrap {
          position:fixed; right:16px; top:16px; z-index:9998;
          display:flex; flex-direction:column; gap:10px;
          pointer-events:none; width:380px; max-width:calc(100vw - 32px);
        }
        .sb-toast { animation: sbToastIn 0.38s cubic-bezier(.32,1.2,.36,1) both; }

        /* ── Tablet (641-1023px): top-right, narrower 340px card ── */
        @media (max-width: 1023px) and (min-width: 641px) {
          .sb-toast-wrap {
            width:340px; right:14px;
            top:calc(14px + env(safe-area-inset-top, 0px));
          }
        }

        /* ── Mobile (≤640px): bottom sheet stack, edge-to-edge, slides up,
              lifted clear of the BottomDock (~57px) + the home indicator. ── */
        @media (max-width: 640px) {
          .sb-toast-wrap {
            right:8px; left:8px; width:auto; max-width:none; top:auto;
            bottom:calc(76px + env(safe-area-inset-bottom, 0px));
            align-items:stretch;
          }
          .sb-toast { animation: sbToastInBot 0.40s cubic-bezier(.32,1.2,.36,1) both; }
        }

        .sb-toast {
          pointer-events:auto; position:relative; overflow:hidden;
          border-radius:18px; padding:13px 15px 13px 17px;
          background: var(--bg-card);
          border:1px solid var(--border-soft);
          box-shadow: 0 14px 36px -10px rgba(0,0,0,0.30);
        }
        /* coloured accent strip down the left edge */
        .sb-toast::before {
          content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
          background: var(--sb-accent);
        }
      `}</style>
      <div className="sb-toast-wrap">
        {items.map((n) => {
          const st = KIND_STYLE[n.kind] || KIND_STYLE.info;
          return (
            <div key={n.id} className="sb-toast"
              style={{ ["--sb-accent" as any]: st.accent }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: `${st.accent}22`, border: `1px solid ${st.accent}44` }}>
                  {st.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[0.92rem] leading-tight" style={{ color: "var(--text-base)" }}>{n.title}</p>
                  {n.body && (
                    <p className="text-[0.78rem] mt-1 leading-snug" style={{ color: "var(--text-soft)" }}>{n.body}</p>
                  )}
                  {n.actions && n.actions.length > 0 && (
                    <div className="flex gap-2 mt-2.5 flex-wrap">
                      {n.actions.map((a, i) => {
                        const c = a.primary
                          ? { background: st.accent, color: st.onAccent }
                          : { background: "var(--bg-pill)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" };
                        const cls = "text-[0.7rem] font-bold tracking-wide px-3 py-1.5 rounded-full transition-transform active:scale-[0.97]";
                        if (a.href) {
                          return (
                            <a key={i} href={a.href} className={cls} style={c}
                              onClick={() => dismiss(n.id)}>
                              {a.label}
                            </a>
                          );
                        }
                        return (
                          <button key={i} className={cls} style={c}
                            onClick={() => { a.onClick?.(); dismiss(n.id); }}>
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button onClick={() => dismiss(n.id)}
                  aria-label="Dismiss notification"
                  className="text-base opacity-50 hover:opacity-100 w-6 h-6 -mr-1 -mt-0.5 rounded-full shrink-0 transition-opacity"
                  style={{ color: "var(--text-muted)" }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
