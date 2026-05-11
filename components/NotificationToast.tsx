"use client";
// ── Global notification toaster ───────────────────────────────────────
// Mounted once in app/layout.tsx. Subscribes to "sb:notify" custom events
// (dispatched via lib/notifications.ts `notify()`) and renders a stack of
// dismissable toast cards in the top-right corner. Mobile: bottom + edge-
// to-edge sheet stack. Premium dark luxury look.

import { useEffect, useState } from "react";
import { onNotify, type Notification, type NotificationKind } from "@/lib/notifications";

const KIND_STYLE: Record<NotificationKind, { bg: string; border: string; icon: string; iconBg: string; titleColor: string }> = {
  bid_accepted:       { bg: "linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,150,105,0.95))", border: "rgba(167,243,208,0.6)",  icon: "🎉", iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
  bid_countered:      { bg: "linear-gradient(135deg,rgba(234,88,12,0.95),rgba(194,65,12,0.95))", border: "rgba(254,215,170,0.6)", icon: "🤝", iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
  bid_rejected:       { bg: "linear-gradient(135deg,rgba(220,38,38,0.95),rgba(185,28,28,0.95))", border: "rgba(252,165,165,0.6)", icon: "✕",  iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
  bid_auto_cancelled: { bg: "linear-gradient(135deg,rgba(75,85,99,0.95),rgba(55,65,81,0.95))",   border: "rgba(209,213,219,0.45)",icon: "⏰", iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
  bid_expiring_soon:  { bg: "linear-gradient(135deg,rgba(245,158,11,0.96),rgba(217,119,6,0.96))",border: "rgba(254,215,170,0.7)", icon: "⏱",  iconBg: "rgba(255,255,255,0.22)", titleColor: "#1c1208" },
  hold_expiring_soon: { bg: "linear-gradient(135deg,rgba(245,158,11,0.96),rgba(217,119,6,0.96))",border: "rgba(254,215,170,0.7)", icon: "🔒", iconBg: "rgba(255,255,255,0.22)", titleColor: "#1c1208" },
  info:               { bg: "linear-gradient(135deg,rgba(30,41,59,0.96),rgba(15,23,42,0.96))",   border: "rgba(240,180,41,0.35)", icon: "ℹ️", iconBg: "rgba(240,180,41,0.18)",  titleColor: "#fff" },
  success:            { bg: "linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,150,105,0.95))",border: "rgba(167,243,208,0.6)", icon: "✓",  iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
  warning:            { bg: "linear-gradient(135deg,rgba(245,158,11,0.96),rgba(217,119,6,0.96))",border: "rgba(254,215,170,0.7)", icon: "⚠",  iconBg: "rgba(255,255,255,0.22)", titleColor: "#1c1208" },
  error:              { bg: "linear-gradient(135deg,rgba(220,38,38,0.95),rgba(185,28,28,0.95))", border: "rgba(252,165,165,0.6)", icon: "✕",  iconBg: "rgba(255,255,255,0.18)", titleColor: "#fff" },
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
        @keyframes sbToastIn  { from{transform:translateX(120%);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes sbToastInBot { from{transform:translateY(120%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes sbToastPulse{ 0%,100%{box-shadow:0 12px 32px -8px rgba(0,0,0,0.35), 0 0 0 0 var(--ring,rgba(240,180,41,0.4))} 50%{box-shadow:0 12px 32px -8px rgba(0,0,0,0.35), 0 0 0 8px transparent} }
        .sb-toast-wrap { position:fixed; right:14px; top:14px; z-index:[9998]; display:flex; flex-direction:column; gap:10px; pointer-events:none; max-width:380px; width:calc(100vw - 28px); }
        @media (max-width: 640px) {
          .sb-toast-wrap { right:8px; left:8px; bottom:14px; top:auto; width:auto; max-width:none; align-items:stretch; }
          .sb-toast { animation: sbToastInBot 0.36s cubic-bezier(.32,1.2,.36,1) both; }
        }
        .sb-toast { pointer-events:auto; border-radius:18px; padding:14px 16px; color:#fff; font-family:inherit; backdrop-filter:blur(20px); border:1px solid; animation: sbToastIn 0.36s cubic-bezier(.32,1.2,.36,1) both; }
      `}</style>
      <div className="sb-toast-wrap" style={{ zIndex: 9998 }}>
        {items.map((n) => {
          const st = KIND_STYLE[n.kind] || KIND_STYLE.info;
          return (
            <div key={n.id} className="sb-toast"
              style={{ background: st.bg, borderColor: st.border, color: st.titleColor,
                ["--ring" as any]: st.border, animation: "sbToastIn 0.36s cubic-bezier(.32,1.2,.36,1) both, sbToastPulse 2.6s ease-in-out infinite" }}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                  style={{ background: st.iconBg }}>
                  {st.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[0.92rem] leading-tight">{n.title}</p>
                  {n.body && (
                    <p className="text-[0.78rem] mt-1 opacity-90 leading-snug">{n.body}</p>
                  )}
                  {n.actions && n.actions.length > 0 && (
                    <div className="flex gap-2 mt-2.5 flex-wrap">
                      {n.actions.map((a, i) => {
                        const c = a.primary
                          ? { background: "rgba(255,255,255,0.95)", color: "#1c1208" }
                          : { background: "rgba(255,255,255,0.12)", color: st.titleColor, border: "1px solid rgba(255,255,255,0.25)" };
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
                  className="text-base opacity-60 hover:opacity-100 w-6 h-6 -mr-1 -mt-0.5 rounded-full shrink-0"
                  style={{ color: st.titleColor }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
