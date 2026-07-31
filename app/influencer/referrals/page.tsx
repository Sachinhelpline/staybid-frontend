"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";

// v96 — Referrals page rebuild.
// Old version only had a "Copy link" button. Creators kept asking how to
// share to Instagram / WhatsApp. Now every code carries a row of one-tap
// share buttons: native share sheet (mobile), WhatsApp deep-link,
// Telegram, X (Twitter), and copy-caption (Instagram doesn't support
// outbound deep-link sharing, so we copy a ready-to-paste caption).

const SHARE_TEMPLATES = {
  whatsapp: (label: string, url: string) =>
    `🏨 Booked an incredible stay through StayBid${label ? ` (${label})` : ""}.\n\nBid your price, hotels compete, and you save up to 40%.\n👇 Try it with my link — first-time guests get bonus StayPoints:\n${url}`,
  generic: (url: string) =>
    `Get the best hotel deals in India on StayBid — bid your price, hotels respond in minutes. ${url}`,
  instagram: (label: string, url: string) =>
    `Tap link in bio 👆 or copy 👉 ${url}${label ? `\n\n${label}` : ""} #StayBid #travel #hotels #savings`,
};

export default function InfluencerReferralsPage() {
  const [inf, setInf] = useState<any>(null);
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [hotelId, setHotelId] = useState("");
  const [toast, setToast] = useState<string>("");

  async function load() {
    setLoading(true);
    const me = await api.getMyInfluencer().catch(() => null);
    const i = me?.influencer;
    setInf(i);
    if (i) {
      const r = await api.listReferralCodes(i.id).catch(() => null);
      setCodes(r?.codes || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!inf) return;
    setCreating(true);
    try {
      await api.createReferralCode(inf.id, { label: label.trim() || null, hotelId: hotelId.trim() || null });
      setLabel(""); setHotelId("");
      await load();
    } finally { setCreating(false); }
  }

  function shareUrl(code: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://staybids.in";
    return `${origin}/r/${code}`;
  }

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(code));
      flashToast("Link copied ✓");
    } catch {
      flashToast("Copy failed");
    }
  }

  async function copyInstagramCaption(code: string, lbl: string | null) {
    const text = SHARE_TEMPLATES.instagram(lbl || "", shareUrl(code));
    try {
      await navigator.clipboard.writeText(text);
      flashToast("Caption copied — paste in your Instagram post / story");
    } catch {
      flashToast("Copy failed");
    }
  }

  function shareWhatsapp(code: string, lbl: string | null) {
    const url = shareUrl(code);
    const text = SHARE_TEMPLATES.whatsapp(lbl || "", url);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function shareTelegram(code: string) {
    const url = shareUrl(code);
    const text = SHARE_TEMPLATES.generic(url);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function shareTwitter(code: string, lbl: string | null) {
    const url = shareUrl(code);
    const text = `${SHARE_TEMPLATES.generic(url)}${lbl ? ` #${lbl.replace(/\s+/g, "")}` : ""}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  async function nativeShare(code: string, lbl: string | null) {
    const url = shareUrl(code);
    const text = SHARE_TEMPLATES.generic(url);
    const data = { title: "StayBid — Bid your stay", text, url };
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share(data);
        flashToast("Shared ✓");
        return;
      } catch (e: any) {
        // user-cancelled is normal — don't surface as an error
        if (e?.name !== "AbortError") flashToast("Share failed");
        return;
      }
    }
    // Fallback for desktop browsers: copy + toast
    copyLink(code);
  }

  if (loading) return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Loading…</div>;
  if (!inf)    return <div className="card-luxury p-8 text-center text-luxury-500 text-sm">Not registered.</div>;

  const totalClicks      = codes.reduce((s, c) => s + (c.clicks_count || 0), 0);
  const totalConversions = codes.reduce((s, c) => s + (c.conversions_count || 0), 0);
  const cvr = totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) + "%" : "—";

  return (
    <div className="space-y-5 relative">
      <div className="grid grid-cols-3 gap-3 sb-stagger">
        <Stat label="Codes"           rawValue={codes.length} />
        <Stat label="Clicks"          rawValue={totalClicks} />
        <Stat label="Conversion"      formatted={cvr} />
      </div>

      <div className="card-luxury sb-card-lift sb-fade-in p-5" style={{ animationDelay: "0.1s" }}>
        <h2 className="font-bold text-luxury-900 mb-3 inline-flex items-center gap-2">
          <span className="sb-pulse-dot is-warn" />
          Create New Referral Link
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Instagram Story)" className="input-luxury w-full" />
          <input value={hotelId} onChange={(e) => setHotelId(e.target.value)}
            placeholder="Hotel ID (optional — leave blank for general)" className="input-luxury w-full" />
        </div>
        <button onClick={create} disabled={creating}
          className="btn-luxury sb-shimmer px-5 py-2.5 rounded-xl font-bold disabled:opacity-50 relative">
          <span className="relative" style={{ zIndex: 2 }}>{creating ? "Creating…" : "Generate Code"}</span>
        </button>
        <p className="text-xs text-luxury-500 mt-2">
          Anyone who clicks your link, visits a hotel page within 30 days, and makes a booking is attributed to you automatically.
          Commission is computed by your slab (5–12% + loyalty bonuses).
        </p>
      </div>

      <div className="space-y-3 sb-stagger">
        {codes.length === 0 ? (
          <div className="card-luxury sb-card-lift p-8 text-center text-luxury-500 text-sm">
            No referral codes yet. Generate one above and start sharing.
          </div>
        ) : (
          codes.map((c) => (
            <CodeCard
              key={c.id}
              code={c}
              shareUrl={shareUrl(c.code)}
              onCopy={() => copyLink(c.code)}
              onNative={() => nativeShare(c.code, c.label)}
              onWhatsapp={() => shareWhatsapp(c.code, c.label)}
              onTelegram={() => shareTelegram(c.code)}
              onTwitter={() => shareTwitter(c.code, c.label)}
              onInstagram={() => copyInstagramCaption(c.code, c.label)}
            />
          ))
        )}
      </div>

      <div className="card-luxury sb-card-lift sb-fade-in p-5 bg-linear-to-br from-luxury-50 to-white border-luxury-100" style={{ animationDelay: "0.2s" }}>
        <h3 className="font-bold text-luxury-900 mb-2">How to share</h3>
        <ul className="text-sm text-luxury-700 space-y-1.5 leading-relaxed sb-stagger">
          <li>📲 <b>Native</b> — opens your phone's share sheet (Instagram, WhatsApp, Messages, Mail, etc.)</li>
          <li>💬 <b>WhatsApp</b> — pre-fills a message you can forward to any contact or group</li>
          <li>📸 <b>Instagram</b> — copies a caption with your link; paste it in your post, story, or bio</li>
          <li>✈️ <b>Telegram</b> — pre-fills a message with your link</li>
          <li>𝕏 <b>X / Twitter</b> — pre-fills a tweet with your link and hashtag</li>
          <li>🔗 <b>Copy link</b> — just the URL, paste anywhere</li>
        </ul>
      </div>

      {/* Floating toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg"
          style={{ background: "linear-gradient(135deg, #1f1a0f, #2b2415)", color: "#f8fafb", border: "1px solid rgba(106,133,160,0.35)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function CodeCard({
  code, shareUrl, onCopy, onNative, onWhatsapp, onTelegram, onTwitter, onInstagram,
}: {
  code: any;
  shareUrl: string;
  onCopy: () => void;
  onNative: () => void;
  onWhatsapp: () => void;
  onTelegram: () => void;
  onTwitter: () => void;
  onInstagram: () => void;
}) {
  const supportsNative = useMemo(() => typeof navigator !== "undefined" && typeof (navigator as any).share === "function", []);

  return (
    <div className="card-luxury sb-card-lift p-4 md:p-5">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base md:text-lg font-bold text-gold-700">{code.code}</span>
            {code.label && <span className="text-xs text-luxury-500 truncate">· {code.label}</span>}
            {code.hotel_id && <span className="text-[0.6rem] uppercase tracking-wider font-bold text-luxury-500 px-2 py-0.5 rounded-full bg-luxury-100">hotel-locked</span>}
          </div>
          <p className="text-xs text-luxury-500 mt-1.5 truncate font-mono">{shareUrl}</p>
        </div>
        <div className="flex items-center gap-4 text-xs shrink-0">
          <div className="text-center">
            <p className="font-bold text-luxury-800 text-base">{code.clicks_count || 0}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-luxury-500">clicks</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-luxury-800 text-base">{code.conversions_count || 0}</p>
            <p className="text-[0.6rem] uppercase tracking-wider text-luxury-500">bookings</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {supportsNative && (
          <ShareBtn onClick={onNative} bg="linear-gradient(135deg, #8198ae, #a9b9c8)" color="#fff" border="rgba(106,133,160,0.6)" icon="📲" label="Share" />
        )}
        <ShareBtn onClick={onWhatsapp} bg="#25D366" color="#fff" border="#1FB855" icon="💬" label="WhatsApp" />
        <ShareBtn onClick={onInstagram} bg="linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)" color="#fff" border="rgba(220,39,67,0.6)" icon="📸" label="Instagram" />
        <ShareBtn onClick={onTelegram} bg="#0088cc" color="#fff" border="#006699" icon="✈️" label="Telegram" />
        <ShareBtn onClick={onTwitter} bg="#000" color="#fff" border="#333" icon="𝕏" label="Twitter" />
        <ShareBtn onClick={onCopy} bg="rgba(0,0,0,0.04)" color="#1f1a0f" border="rgba(106,133,160,0.4)" icon="🔗" label="Copy link" />
      </div>
    </div>
  );
}

function ShareBtn({ onClick, bg, color, border, icon, label }: { onClick: () => void; bg: string; color: string; border: string; icon: string; label: string }) {
  return (
    <button onClick={onClick}
      style={{
        background: bg, color, border: `1px solid ${border}`,
        borderRadius: 999, padding: "8px 14px", fontSize: 12, fontWeight: 700,
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}>
      <span>{icon}</span><span>{label}</span>
    </button>
  );
}

function Stat({ label, rawValue, formatted }: { label: string; rawValue?: number; formatted?: string }) {
  return (
    <div className="card-luxury sb-card-lift p-4 text-center">
      <p className="text-[0.6rem] uppercase tracking-widest font-bold text-luxury-500">{label}</p>
      <p className="font-display text-xl md:text-2xl font-bold text-luxury-900 mt-1 leading-none">
        {rawValue !== undefined
          ? <CountUp value={rawValue} duration={900} />
          : formatted}
      </p>
    </div>
  );
}
