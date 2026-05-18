"use client";
// v138.1 — Welcome Story SCENE posters.
//
// Five CSS-rendered "poster" scenes (one per welcome card). Each scene
// is a composed visual hero — gradients + emoji + decorative geometry
// + supporting elements (price chips, countdown pill, mini cards, etc).
//
// No external image / SVG assets — every visual is pure CSS so:
//   • Zero extra network requests
//   • Auto-themed via cozy palette CSS vars
//   • Reduced-motion safe (single shared @media block at the end)
//   • Smaller bundle than bitmap posters
//
// Scenes:
//   welcome   — "stay·bid" wordmark + sparkles + thin gold arc
//   bid       — 3 stacked price chips: ₹4999 (struck red) → ₹3999 (struck amber) → ₹2499 (green pulse) + savings caption
//   flash     — Lightning emoji + rotated "-42% OFF" stamp + live HH:MM:SS countdown pill
//   earn      — 3 mini cards in a fan (Stay/Refer/Create) each with +coin badge
//   explore   — Mini phone frame with 3 stacked reel cards + tap-finger animation
//
// Each scene renders into a fixed 240px tall area; the WelcomeStory body
// pulls it into the card above the headline + body text.

import { useEffect, useMemo, useState } from "react";

type SceneProps = { active: boolean; accent?: string };

// ── Scene 1: Welcome — brand wordmark + sparkles ────────────────────
function SceneWelcome({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-welcome" aria-hidden>
      {/* Outer halo gradient */}
      <div className="sb-scene-halo" />
      {/* Thin gold arc top */}
      <svg
        className="sb-scene-arc"
        viewBox="0 0 240 80"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M 10 60 Q 120 0 230 60"
          fill="none"
          stroke="url(#sb-arc-grad)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="sb-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(201,166,107,0)" />
            <stop offset="50%" stopColor="#C9A66B" />
            <stop offset="100%" stopColor="rgba(201,166,107,0)" />
          </linearGradient>
        </defs>
      </svg>
      {/* Brand wordmark */}
      <div className="sb-scene-wordmark">
        stay<span className="sb-scene-dot">·</span>bid
      </div>
      {/* Sparkle accents */}
      <span className="sb-spark sb-spark-1" />
      <span className="sb-spark sb-spark-2" />
      <span className="sb-spark sb-spark-3" />
      {/* Tiny tagline pill */}
      <div className="sb-scene-eyebrow">PREMIUM · INDIA</div>
    </div>
  );
}

// ── Scene 2: Bid — price stack with strikethroughs ──────────────────
function SceneBid({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-bid" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-bid" />
      <div className="sb-bid-stack">
        <div className="sb-bid-chip sb-bid-chip-other">
          <span className="sb-bid-label">MakeMyTrip</span>
          <span className="sb-bid-amt sb-bid-strike sb-bid-strike-red">₹4,999</span>
        </div>
        <div className="sb-bid-chip sb-bid-chip-other">
          <span className="sb-bid-label">Booking.com</span>
          <span className="sb-bid-amt sb-bid-strike sb-bid-strike-amber">₹3,999</span>
        </div>
        <div className="sb-bid-chip sb-bid-chip-win">
          <span className="sb-bid-label">stay·bid</span>
          <span className="sb-bid-amt sb-bid-win">₹2,499</span>
        </div>
      </div>
      <div className="sb-bid-savings">↓ 50% saved</div>
    </div>
  );
}

// ── Scene 3: Flash — lightning + countdown + stamp ──────────────────
function SceneFlash({ active }: SceneProps) {
  // Live countdown to midnight (display only — purely cosmetic)
  const [hms, setHms] = useState("--:--:--");
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const diff = Math.max(0, end.getTime() - now.getTime());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setHms(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="sb-scene sb-scene-flash" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-flash" />
      {/* Rotated discount stamp behind */}
      <div className="sb-flash-stamp">-42% OFF</div>
      {/* Lightning glyph */}
      <div className="sb-flash-bolt">⚡</div>
      {/* LIVE pulse pill */}
      <div className="sb-flash-live">
        <span className="sb-flash-livedot" />
        LIVE
      </div>
      {/* Countdown */}
      <div className="sb-flash-timer">
        <span className="sb-flash-timer-label">ENDS IN</span>
        <span className="sb-flash-timer-val">{hms}</span>
      </div>
    </div>
  );
}

// ── Scene 4: Earn — fan of 3 mini cards + coin badge ────────────────
function SceneEarn({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-earn" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-earn" />
      <div className="sb-earn-fan">
        <div className="sb-earn-card sb-earn-card-l">
          <div className="sb-earn-emoji">🏨</div>
          <div className="sb-earn-label">Stay</div>
          <div className="sb-earn-badge">+5pt</div>
        </div>
        <div className="sb-earn-card sb-earn-card-c">
          <div className="sb-earn-emoji">🤝</div>
          <div className="sb-earn-label">Refer</div>
          <div className="sb-earn-badge">+₹</div>
        </div>
        <div className="sb-earn-card sb-earn-card-r">
          <div className="sb-earn-emoji">🎬</div>
          <div className="sb-earn-label">Create</div>
          <div className="sb-earn-badge">12%</div>
        </div>
      </div>
      <div className="sb-earn-foot">3 ways to earn on StayBid</div>
    </div>
  );
}

// ── Scene 5: Explore — phone frame with reel cards + tap finger ─────
function SceneExplore({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-explore" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-explore" />
      <div className="sb-phone">
        <div className="sb-phone-notch" />
        <div className="sb-phone-screen">
          {/* Stacked reel cards peeking from top + bottom */}
          <div className="sb-reel-mini sb-reel-mini-top">
            <span className="sb-reel-mini-tag">Mussoorie</span>
          </div>
          <div className="sb-reel-mini sb-reel-mini-mid">
            <div className="sb-reel-mini-row">
              <span className="sb-reel-mini-tag">Rishikesh</span>
              <span className="sb-reel-mini-price">₹1.8k</span>
            </div>
            <div className="sb-reel-mini-actions">
              <span>♡</span>
              <span>🔖</span>
              <span className="sb-reel-mini-book">Book</span>
            </div>
          </div>
          <div className="sb-reel-mini sb-reel-mini-bot">
            <span className="sb-reel-mini-tag">Shimla</span>
          </div>
        </div>
      </div>
      {/* Tap finger */}
      <div className="sb-tap-finger">👆</div>
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────
type Props = {
  scene: "welcome" | "bid" | "flash" | "earn" | "explore";
  active: boolean;
  accent?: string;
};

export function WelcomeScene({ scene, active, accent }: Props) {
  const Comp = useMemo(() => {
    switch (scene) {
      case "welcome": return SceneWelcome;
      case "bid":     return SceneBid;
      case "flash":   return SceneFlash;
      case "earn":    return SceneEarn;
      case "explore": return SceneExplore;
    }
  }, [scene]);

  return (
    <>
      <Comp active={active} accent={accent} />
      <SceneStyles />
    </>
  );
}

// ── Shared inline styles + keyframes ────────────────────────────────
function SceneStyles() {
  return (
    <style>{`
      /* ── Shared scene shell ──────────────────────────────────────── */
      .sb-scene{
        position:relative;
        width:100%;
        height:240px;
        margin:0 auto;
        border-radius:24px;
        overflow:hidden;
        background:linear-gradient(160deg, var(--cozy-cream-50) 0%, var(--cozy-cream-100) 100%);
        box-shadow:inset 0 0 0 1px rgba(201,166,107,0.18), 0 16px 36px -18px rgba(31,26,15,0.22);
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .sb-scene-halo{
        position:absolute;
        inset:-30%;
        background:radial-gradient(circle at 50% 50%, rgba(201,166,107,0.22) 0%, transparent 60%);
        animation:sbSceneHalo 4.4s ease-in-out infinite;
        pointer-events:none;
      }

      /* ── 1. Welcome ──────────────────────────────────────────────── */
      .sb-scene-arc{
        position:absolute;
        top:18px;
        left:0;
        width:100%;
        height:60px;
        opacity:0.85;
      }
      .sb-scene-wordmark{
        position:relative;
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        font-weight:600;
        font-size:clamp(2.4rem, 9vw, 3rem);
        color:var(--cozy-warm-dark, #1F1A0F);
        letter-spacing:-0.02em;
        z-index:2;
        text-shadow:0 2px 8px rgba(201,166,107,0.25);
      }
      .sb-scene-dot{
        display:inline-block;
        color:var(--cozy-champagne);
        margin:0 4px;
        animation:sbScenePulse 1.8s ease-in-out infinite;
      }
      .sb-spark{
        position:absolute;
        width:8px;
        height:8px;
        background:radial-gradient(circle, #FFF4CC 0%, #D9BE82 60%, transparent 100%);
        border-radius:50%;
        filter:drop-shadow(0 0 6px #C9A66B);
        pointer-events:none;
      }
      .sb-spark-1{ top:30%; left:22%; animation:sbSparkFloat 3.4s ease-in-out infinite; }
      .sb-spark-2{ top:62%; right:18%; animation:sbSparkFloat 2.8s ease-in-out -1.2s infinite; }
      .sb-spark-3{ top:78%; left:40%; animation:sbSparkFloat 3.6s ease-in-out -2s infinite; width:6px; height:6px; }
      .sb-scene-eyebrow{
        position:absolute;
        bottom:18px;
        left:50%;
        transform:translateX(-50%);
        font-size:10px;
        font-weight:700;
        letter-spacing:0.18em;
        color:var(--cozy-cocoa-soft);
        padding:5px 12px;
        border-radius:999px;
        background:rgba(201,166,107,0.10);
        border:1px solid rgba(201,166,107,0.22);
        z-index:2;
      }

      /* ── 2. Bid stack ────────────────────────────────────────────── */
      .sb-scene-halo-bid{
        background:radial-gradient(circle at 50% 50%, rgba(217,190,130,0.28) 0%, transparent 60%);
      }
      .sb-bid-stack{
        position:relative;
        display:flex;
        flex-direction:column;
        gap:8px;
        z-index:2;
        width:78%;
        max-width:240px;
      }
      .sb-bid-chip{
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:10px 14px;
        border-radius:14px;
        background:rgba(255,252,246,0.85);
        backdrop-filter:blur(6px);
        box-shadow:0 4px 12px -4px rgba(31,26,15,0.10);
        border:1px solid rgba(201,166,107,0.18);
      }
      .sb-bid-chip-other{
        opacity:0.78;
        transform:scale(0.93);
      }
      .sb-bid-chip-win{
        background:linear-gradient(135deg, rgba(157,173,143,0.18), rgba(157,173,143,0.10));
        border:1.5px solid rgba(157,173,143,0.55);
        box-shadow:0 8px 22px -6px rgba(157,173,143,0.45);
        animation:sbBidWinPulse 2.4s ease-in-out infinite;
      }
      .sb-bid-label{
        font-size:11px;
        font-weight:600;
        letter-spacing:0.04em;
        color:var(--cozy-cocoa);
        text-transform:uppercase;
      }
      .sb-bid-amt{
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        font-weight:700;
        font-size:18px;
        color:var(--cozy-warm-dark);
        position:relative;
      }
      .sb-bid-strike::after{
        content:"";
        position:absolute;
        left:-2px;
        right:-2px;
        top:50%;
        height:1.5px;
        transform:rotate(-6deg);
      }
      .sb-bid-strike-red::after{ background:#D49583; }
      .sb-bid-strike-amber::after{ background:#C9A66B; }
      .sb-bid-win{
        color:#5E7A4F;
        font-size:22px;
      }
      .sb-bid-savings{
        position:absolute;
        bottom:18px;
        left:50%;
        transform:translateX(-50%);
        font-size:11px;
        font-weight:700;
        letter-spacing:0.10em;
        color:#5E7A4F;
        padding:5px 14px;
        border-radius:999px;
        background:rgba(157,173,143,0.18);
        border:1px solid rgba(157,173,143,0.40);
        z-index:2;
      }

      /* ── 3. Flash ────────────────────────────────────────────────── */
      .sb-scene-halo-flash{
        background:radial-gradient(circle at 50% 50%, rgba(212,149,131,0.28) 0%, transparent 60%);
        animation:sbSceneHaloFast 2.6s ease-in-out infinite;
      }
      .sb-flash-stamp{
        position:absolute;
        top:30%;
        right:14%;
        transform:rotate(-14deg);
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        font-weight:700;
        font-size:32px;
        color:rgba(212,149,131,0.65);
        letter-spacing:-0.01em;
        z-index:1;
        text-shadow:0 2px 6px rgba(212,149,131,0.30);
      }
      .sb-flash-bolt{
        position:relative;
        font-size:96px;
        line-height:1;
        z-index:2;
        filter:drop-shadow(0 4px 18px rgba(217,190,130,0.55));
        animation:sbFlashBolt 1.6s ease-in-out infinite;
      }
      .sb-flash-live{
        position:absolute;
        top:18px;
        left:18px;
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:5px 10px;
        border-radius:999px;
        background:rgba(212,149,131,0.18);
        border:1px solid rgba(212,149,131,0.45);
        font-size:10px;
        font-weight:800;
        letter-spacing:0.10em;
        color:#A85F4E;
        z-index:3;
      }
      .sb-flash-livedot{
        width:6px;
        height:6px;
        border-radius:50%;
        background:#D49583;
        box-shadow:0 0 6px #D49583;
        animation:sbScenePulse 1.2s ease-in-out infinite;
      }
      .sb-flash-timer{
        position:absolute;
        bottom:18px;
        left:50%;
        transform:translateX(-50%);
        display:flex;
        align-items:center;
        gap:8px;
        padding:7px 14px;
        border-radius:999px;
        background:linear-gradient(135deg, rgba(31,26,15,0.92), rgba(74,56,32,0.88));
        z-index:3;
      }
      .sb-flash-timer-label{
        font-size:9px;
        font-weight:700;
        letter-spacing:0.16em;
        color:rgba(255,244,204,0.78);
      }
      .sb-flash-timer-val{
        font-family:'Inter', system-ui, sans-serif;
        font-feature-settings:"tnum" 1;
        font-variant-numeric:tabular-nums;
        font-size:13px;
        font-weight:700;
        color:#FFF4CC;
        letter-spacing:0.02em;
      }

      /* ── 4. Earn ─────────────────────────────────────────────────── */
      .sb-scene-halo-earn{
        background:radial-gradient(circle at 50% 50%, rgba(157,173,143,0.28) 0%, transparent 60%);
      }
      .sb-earn-fan{
        position:relative;
        display:flex;
        align-items:flex-end;
        gap:8px;
        z-index:2;
      }
      .sb-earn-card{
        position:relative;
        width:74px;
        height:96px;
        border-radius:14px;
        background:rgba(255,252,246,0.92);
        border:1px solid rgba(201,166,107,0.28);
        box-shadow:0 8px 18px -6px rgba(31,26,15,0.18);
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        gap:4px;
        padding:8px;
      }
      .sb-earn-card-l{ transform:rotate(-7deg) translateY(6px); }
      .sb-earn-card-c{ transform:translateY(-8px) scale(1.06); z-index:2; box-shadow:0 14px 28px -8px rgba(157,173,143,0.45); }
      .sb-earn-card-r{ transform:rotate(7deg)  translateY(6px); }
      .sb-earn-emoji{ font-size:28px; line-height:1; }
      .sb-earn-label{
        font-size:10px;
        font-weight:700;
        letter-spacing:0.06em;
        color:var(--cozy-cocoa);
        text-transform:uppercase;
      }
      .sb-earn-badge{
        position:absolute;
        top:-6px;
        right:-4px;
        padding:3px 7px;
        border-radius:999px;
        background:linear-gradient(135deg, #E7CFA0, #C9A66B);
        color:#1F1A0F;
        font-size:9px;
        font-weight:800;
        letter-spacing:0.04em;
        box-shadow:0 4px 10px -3px rgba(201,166,107,0.55);
      }
      .sb-earn-foot{
        position:absolute;
        bottom:18px;
        left:50%;
        transform:translateX(-50%);
        font-size:10px;
        font-weight:600;
        letter-spacing:0.08em;
        color:var(--cozy-cocoa-soft);
        text-transform:uppercase;
        z-index:2;
      }

      /* ── 5. Explore ──────────────────────────────────────────────── */
      .sb-scene-halo-explore{
        background:radial-gradient(circle at 50% 50%, rgba(201,166,107,0.24) 0%, transparent 60%);
      }
      .sb-phone{
        position:relative;
        width:118px;
        height:200px;
        border-radius:24px;
        background:linear-gradient(160deg, #1F1A0F, #2B2415);
        box-shadow:0 24px 40px -14px rgba(31,26,15,0.55), inset 0 0 0 2px rgba(201,166,107,0.28);
        overflow:hidden;
        z-index:2;
      }
      .sb-phone-notch{
        position:absolute;
        top:0;
        left:50%;
        transform:translateX(-50%);
        width:40px;
        height:10px;
        background:#0F0C08;
        border-radius:0 0 8px 8px;
      }
      .sb-phone-screen{
        position:absolute;
        inset:6px;
        border-radius:18px;
        background:linear-gradient(180deg, #2B2415, #1F1A0F);
        overflow:hidden;
        display:flex;
        flex-direction:column;
        justify-content:center;
        padding:8px;
        animation:sbReelSwipe 4.2s ease-in-out infinite;
      }
      .sb-reel-mini{
        position:relative;
        width:100%;
        flex-shrink:0;
        border-radius:10px;
        margin-bottom:5px;
        padding:6px 7px;
        background:linear-gradient(135deg, rgba(255,244,204,0.10), rgba(217,190,130,0.05));
        border:1px solid rgba(201,166,107,0.18);
      }
      .sb-reel-mini-top{ height:32px; opacity:0.55; }
      .sb-reel-mini-mid{ height:84px; padding:9px 10px; background:linear-gradient(135deg, rgba(255,244,204,0.22), rgba(217,190,130,0.10)); border:1px solid rgba(217,190,130,0.35); }
      .sb-reel-mini-bot{ height:32px; opacity:0.55; }
      .sb-reel-mini-row{ display:flex; align-items:center; justify-content:space-between; }
      .sb-reel-mini-tag{
        font-size:8px;
        font-weight:700;
        letter-spacing:0.05em;
        color:#FFF4CC;
        text-transform:uppercase;
      }
      .sb-reel-mini-price{
        font-size:9px;
        font-weight:700;
        color:#D9BE82;
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
      }
      .sb-reel-mini-actions{
        position:absolute;
        bottom:7px;
        left:10px;
        right:10px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        font-size:9px;
        color:rgba(255,244,204,0.78);
      }
      .sb-reel-mini-actions span{ display:inline-block; }
      .sb-reel-mini-book{
        padding:2px 7px;
        border-radius:999px;
        background:linear-gradient(135deg, #E7CFA0, #C9A66B);
        color:#1F1A0F;
        font-weight:800;
        font-size:8px;
        letter-spacing:0.04em;
      }
      .sb-tap-finger{
        position:absolute;
        right:24px;
        bottom:32px;
        font-size:32px;
        z-index:3;
        animation:sbTapFinger 1.6s ease-in-out infinite;
        filter:drop-shadow(0 4px 8px rgba(31,26,15,0.35));
      }

      /* ── Keyframes ───────────────────────────────────────────────── */
      @keyframes sbSceneHalo {
        0%, 100% { opacity:0.78; transform:scale(1); }
        50%      { opacity:1;    transform:scale(1.08); }
      }
      @keyframes sbSceneHaloFast {
        0%, 100% { opacity:0.78; transform:scale(1); }
        50%      { opacity:1;    transform:scale(1.10); }
      }
      @keyframes sbScenePulse {
        0%, 100% { opacity:1;    transform:scale(1); }
        50%      { opacity:0.55; transform:scale(0.85); }
      }
      @keyframes sbSparkFloat {
        0%, 100% { transform:translateY(0)    scale(1);   opacity:0.7; }
        50%      { transform:translateY(-10px) scale(1.18); opacity:1; }
      }
      @keyframes sbBidWinPulse {
        0%, 100% { box-shadow:0 8px 22px -6px rgba(157,173,143,0.45); }
        50%      { box-shadow:0 10px 28px -4px rgba(157,173,143,0.65); }
      }
      @keyframes sbFlashBolt {
        0%, 100% { transform:scale(1)    rotate(-4deg); filter:drop-shadow(0 4px 18px rgba(217,190,130,0.55)); }
        50%      { transform:scale(1.08) rotate( 4deg); filter:drop-shadow(0 6px 26px rgba(217,190,130,0.85)); }
      }
      @keyframes sbReelSwipe {
        0%, 100% { transform:translateY(0); }
        50%      { transform:translateY(-6px); }
      }
      @keyframes sbTapFinger {
        0%, 100% { transform:translateY(0)   rotate(-4deg); }
        50%      { transform:translateY(-8px) rotate( 4deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .sb-scene-halo,
        .sb-spark, .sb-scene-dot,
        .sb-bid-chip-win, .sb-flash-bolt,
        .sb-phone-screen, .sb-tap-finger,
        .sb-flash-livedot {
          animation: none !important;
        }
      }
    `}</style>
  );
}
