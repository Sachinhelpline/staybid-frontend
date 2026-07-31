"use client";
// v138.2 — Welcome Story SCENE posters.
//
// 6 CSS-rendered "poster" scenes (one per welcome card). Each scene
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
//   welcome — "stay·bid" wordmark + sparkles + thin gold arc
//   flash   — Lightning + rotated "-42% OFF" stamp + live HH:MM:SS
//   bid     — 3 step pills (📍 city → 📅 dates → 💰 budget) + AI chip
//             + "Hotels competing" pulse strip
//   compare — Stacked OTA price bars (MMT / Booking / Agoda / stay·bid)
//             + "-20% best" badge on the winner
//   score   — 3D-style medal disc with rank ribbon "RANK 2" + city
//             total pill + 5 checkpoint sentiment dots
//   earn    — 3 mini cards in a fan (Stay/Refer/Create) each with badge

import { useEffect, useMemo, useState } from "react";

type SceneProps = { active: boolean; accent?: string };

// ── Scene 1: Welcome — brand wordmark + sparkles ────────────────────
function SceneWelcome({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-welcome" aria-hidden>
      <div className="sb-scene-halo" />
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
            <stop offset="0%" stopColor="rgba(106,133,160,0)" />
            <stop offset="50%" stopColor="#5f7c98" />
            <stop offset="100%" stopColor="rgba(106,133,160,0)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="sb-scene-wordmark">
        stay<span className="sb-scene-dot">·</span>bid
      </div>
      <span className="sb-spark sb-spark-1" />
      <span className="sb-spark sb-spark-2" />
      <span className="sb-spark sb-spark-3" />
      <div className="sb-scene-eyebrow">PREMIUM · INDIA</div>
    </div>
  );
}

// ── Scene 2: Flash — lightning + countdown + stamp ──────────────────
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
      <div className="sb-flash-stamp">-42% OFF</div>
      <div className="sb-flash-bolt">⚡</div>
      <div className="sb-flash-live">
        <span className="sb-flash-livedot" />
        LIVE
      </div>
      <div className="sb-flash-timer">
        <span className="sb-flash-timer-label">ENDS IN</span>
        <span className="sb-flash-timer-val">{hms}</span>
      </div>
    </div>
  );
}

// ── Scene 3: Bid — 3-step process + AI chip ─────────────────────────
function SceneBid({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-bid" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-bid" />
      {/* Step pills row */}
      <div className="sb-bid3-steps">
        <div className="sb-bid3-step sb-bid3-s1">
          <span className="sb-bid3-emoji">📍</span>
          <span className="sb-bid3-label">City</span>
          <span className="sb-bid3-val">Mussoorie</span>
        </div>
        <span className="sb-bid3-arrow" />
        <div className="sb-bid3-step sb-bid3-s2">
          <span className="sb-bid3-emoji">📅</span>
          <span className="sb-bid3-label">Dates</span>
          <span className="sb-bid3-val">15-17 Dec</span>
        </div>
        <span className="sb-bid3-arrow" />
        <div className="sb-bid3-step sb-bid3-s3">
          <span className="sb-bid3-emoji">💰</span>
          <span className="sb-bid3-label">Budget</span>
          <span className="sb-bid3-val">₹2,499</span>
        </div>
      </div>
      {/* AI smart-price chip */}
      <div className="sb-bid3-ai">
        <span className="sb-bid3-ai-dot" />
        AI · Smart Price suggested
      </div>
      {/* Bottom strip: hotels competing */}
      <div className="sb-bid3-compete">
        <span>🏨 4 hotels competing</span>
        <span className="sb-bid3-dots">
          <i /><i /><i />
        </span>
      </div>
    </div>
  );
}

// ── Scene 4: Compare — OTA price bar stack ──────────────────────────
function SceneCompare({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-compare" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-compare" />
      <div className="sb-cmp-strip">
        <div className="sb-cmp-eyebrow">LIVE COMPARE · per night</div>
        <div className="sb-cmp-row sb-cmp-row-other">
          <span className="sb-cmp-label">MakeMyTrip</span>
          <span className="sb-cmp-bar" style={{ width: "100%" }} />
          <span className="sb-cmp-price">₹4,999</span>
        </div>
        <div className="sb-cmp-row sb-cmp-row-other">
          <span className="sb-cmp-label">Booking</span>
          <span className="sb-cmp-bar" style={{ width: "94%" }} />
          <span className="sb-cmp-price">₹4,699</span>
        </div>
        <div className="sb-cmp-row sb-cmp-row-other">
          <span className="sb-cmp-label">Agoda</span>
          <span className="sb-cmp-bar" style={{ width: "90%" }} />
          <span className="sb-cmp-price">₹4,499</span>
        </div>
        <div className="sb-cmp-row sb-cmp-row-win">
          <span className="sb-cmp-label">stay·bid</span>
          <span className="sb-cmp-bar sb-cmp-bar-win" style={{ width: "76%" }} />
          <span className="sb-cmp-price sb-cmp-price-win">₹3,799</span>
        </div>
      </div>
      <div className="sb-cmp-badge">−24% · cheapest</div>
    </div>
  );
}

// ── Scene 5: Score — medal disc + rank ribbon + checkpoint dots ─────
function SceneScore({ active }: SceneProps) {
  return (
    <div className="sb-scene sb-scene-score" aria-hidden>
      <div className="sb-scene-halo sb-scene-halo-score" />
      {/* Trophy ribbon */}
      <div className="sb-score-ribbon">🥈 RANK 2</div>
      {/* Medal disc */}
      <div className="sb-score-medal">
        <div className="sb-score-medal-sheen" />
        <div className="sb-score-medal-num">92</div>
        <div className="sb-score-medal-den">/100</div>
      </div>
      {/* City pill */}
      <div className="sb-score-pill">of 18 hotels in Mussoorie</div>
      {/* Checkpoint sentiment dots */}
      <div className="sb-score-dots" aria-hidden>
        <span className="sb-score-dot sb-score-dot-g" title="Bid speed" />
        <span className="sb-score-dot sb-score-dot-g" title="Stay feedback" />
        <span className="sb-score-dot sb-score-dot-g" title="Resolution" />
        <span className="sb-score-dot sb-score-dot-y" title="Volume" />
        <span className="sb-score-dot sb-score-dot-g" title="Verified video" />
      </div>
    </div>
  );
}

// ── Scene 6: Earn — fan of 3 mini cards + coin badge ────────────────
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
          <div className="sb-earn-emoji">🎬</div>
          <div className="sb-earn-label">Create</div>
          <div className="sb-earn-badge">12%</div>
        </div>
        <div className="sb-earn-card sb-earn-card-r">
          <div className="sb-earn-emoji">🤝</div>
          <div className="sb-earn-label">Refer</div>
          <div className="sb-earn-badge">+₹</div>
        </div>
      </div>
      <div className="sb-earn-foot">Everyone earns on StayBid</div>
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────
type Props = {
  scene: "welcome" | "flash" | "bid" | "compare" | "score" | "earn";
  active: boolean;
  accent?: string;
};

export function WelcomeScene({ scene, active, accent }: Props) {
  const Comp = useMemo(() => {
    switch (scene) {
      case "welcome": return SceneWelcome;
      case "flash":   return SceneFlash;
      case "bid":     return SceneBid;
      case "compare": return SceneCompare;
      case "score":   return SceneScore;
      case "earn":    return SceneEarn;
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
        box-shadow:inset 0 0 0 1px rgba(106,133,160,0.18), 0 16px 36px -18px rgba(31,26,15,0.22);
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .sb-scene-halo{
        position:absolute;
        inset:-30%;
        background:radial-gradient(circle at 50% 50%, rgba(106,133,160,0.22) 0%, transparent 60%);
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
        text-shadow:0 2px 8px rgba(106,133,160,0.25);
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
        background:radial-gradient(circle, #f1f4f6 0%, #b4c1cf 60%, transparent 100%);
        border-radius:50%;
        filter:drop-shadow(0 0 6px #5f7c98);
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
        background:rgba(106,133,160,0.10);
        border:1px solid rgba(106,133,160,0.22);
        z-index:2;
      }

      /* ── 2. Flash ────────────────────────────────────────────────── */
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
        filter:drop-shadow(0 4px 18px rgba(176, 192, 209,0.55));
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
        color:rgba(176, 192, 209,0.78);
      }
      .sb-flash-timer-val{
        font-family:'Inter', system-ui, sans-serif;
        font-feature-settings:"tnum" 1;
        font-variant-numeric:tabular-nums;
        font-size:13px;
        font-weight:700;
        color:#f1f4f6;
        letter-spacing:0.02em;
      }

      /* ── 3. Bid — 3-step process ─────────────────────────────────── */
      .sb-scene-halo-bid{
        background:radial-gradient(circle at 50% 50%, rgba(176, 192, 209,0.28) 0%, transparent 60%);
      }
      .sb-bid3-steps{
        position:relative;
        display:flex;
        align-items:center;
        gap:4px;
        z-index:2;
        padding:0 8px;
        width:100%;
        max-width:340px;
        justify-content:space-between;
      }
      .sb-bid3-step{
        flex:0 0 auto;
        display:flex;
        flex-direction:column;
        align-items:center;
        gap:2px;
        padding:8px 10px;
        border-radius:12px;
        background:rgba(176, 192, 209,0.92);
        border:1px solid rgba(106,133,160,0.28);
        box-shadow:0 6px 14px -4px rgba(31,26,15,0.16);
        min-width:78px;
      }
      .sb-bid3-s1{ animation:sbBid3Pop 0.5s cubic-bezier(.16,.84,.32,1) -0.0s both; }
      .sb-bid3-s2{ animation:sbBid3Pop 0.5s cubic-bezier(.16,.84,.32,1) -0.12s both; }
      .sb-bid3-s3{
        animation:sbBid3Pop 0.5s cubic-bezier(.16,.84,.32,1) -0.24s both;
        border:1.5px solid rgba(157,173,143,0.55);
        background:linear-gradient(135deg, rgba(157,173,143,0.15), rgba(176, 192, 209,0.92));
      }
      .sb-bid3-emoji{ font-size:18px; line-height:1; }
      .sb-bid3-label{
        font-size:9px;
        font-weight:700;
        letter-spacing:0.10em;
        color:var(--cozy-cocoa-soft);
        text-transform:uppercase;
      }
      .sb-bid3-val{
        font-size:11px;
        font-weight:700;
        color:var(--cozy-warm-dark);
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        line-height:1;
      }
      .sb-bid3-arrow{
        display:inline-block;
        width:14px;
        height:1.5px;
        background:linear-gradient(90deg, rgba(106,133,160,0.18), rgba(106,133,160,0.55), rgba(106,133,160,0.18));
        position:relative;
      }
      .sb-bid3-arrow::after{
        content:"›";
        position:absolute;
        right:-7px;
        top:-9px;
        font-size:13px;
        color:rgba(106,133,160,0.55);
      }
      .sb-bid3-ai{
        position:absolute;
        top:32px;
        left:50%;
        transform:translateX(-50%);
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:4px 10px;
        border-radius:999px;
        background:rgba(106,133,160,0.12);
        border:1px solid rgba(106,133,160,0.38);
        font-size:10px;
        font-weight:600;
        letter-spacing:0.04em;
        color:var(--cozy-cocoa);
        z-index:2;
      }
      .sb-bid3-ai-dot{
        width:5px;
        height:5px;
        border-radius:50%;
        background:linear-gradient(135deg, #c8d2dc, #5f7c98);
        box-shadow:0 0 5px #5f7c98;
        animation:sbScenePulse 1.6s ease-in-out infinite;
      }
      .sb-bid3-compete{
        position:absolute;
        bottom:20px;
        left:50%;
        transform:translateX(-50%);
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding:6px 12px;
        border-radius:999px;
        background:rgba(157,173,143,0.18);
        border:1px solid rgba(157,173,143,0.45);
        font-size:10px;
        font-weight:700;
        letter-spacing:0.04em;
        color:#5E7A4F;
        z-index:2;
      }
      .sb-bid3-dots{ display:inline-flex; gap:3px; align-items:center; }
      .sb-bid3-dots i{
        width:4px;
        height:4px;
        border-radius:50%;
        background:#5E7A4F;
        display:inline-block;
      }
      .sb-bid3-dots i:nth-child(1){ animation:sbBid3Wave 1.2s ease-in-out infinite; }
      .sb-bid3-dots i:nth-child(2){ animation:sbBid3Wave 1.2s ease-in-out -0.2s infinite; }
      .sb-bid3-dots i:nth-child(3){ animation:sbBid3Wave 1.2s ease-in-out -0.4s infinite; }

      /* ── 4. Compare — OTA bar stack ──────────────────────────────── */
      .sb-scene-halo-compare{
        background:radial-gradient(circle at 50% 50%, rgba(106,133,160,0.22) 0%, transparent 60%);
      }
      .sb-cmp-strip{
        position:relative;
        z-index:2;
        width:88%;
        max-width:300px;
        display:flex;
        flex-direction:column;
        gap:7px;
      }
      .sb-cmp-eyebrow{
        font-size:9px;
        font-weight:700;
        letter-spacing:0.14em;
        color:var(--cozy-cocoa-soft);
        text-transform:uppercase;
        text-align:center;
        margin-bottom:2px;
      }
      .sb-cmp-row{
        display:grid;
        grid-template-columns:64px 1fr auto;
        align-items:center;
        gap:8px;
      }
      .sb-cmp-label{
        font-size:10px;
        font-weight:600;
        letter-spacing:0.02em;
        color:var(--cozy-cocoa);
        text-align:right;
      }
      .sb-cmp-bar{
        display:inline-block;
        height:8px;
        border-radius:999px;
        background:linear-gradient(90deg, rgba(106,133,160,0.55), rgba(106,133,160,0.22));
        box-shadow:inset 0 1px 0 rgba(255,255,255,0.4);
      }
      .sb-cmp-row-other{ opacity:0.78; }
      .sb-cmp-row-win .sb-cmp-label{
        color:var(--cozy-warm-dark);
        font-weight:800;
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        font-size:12px;
      }
      .sb-cmp-bar-win{
        height:11px !important;
        background:linear-gradient(90deg, #5f7c98 0%, #c8d2dc 100%) !important;
        box-shadow:0 4px 12px -3px rgba(106,133,160,0.55), inset 0 1px 0 rgba(255,255,255,0.55) !important;
        animation:sbCmpBarPulse 2.4s ease-in-out infinite;
      }
      .sb-cmp-price{
        font-size:10px;
        font-weight:600;
        color:var(--cozy-cocoa-soft);
        font-variant-numeric:tabular-nums;
      }
      .sb-cmp-price-win{
        color:var(--cozy-warm-dark);
        font-size:13px;
        font-weight:800;
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
      }
      .sb-cmp-badge{
        position:absolute;
        bottom:14px;
        left:50%;
        transform:translateX(-50%);
        padding:5px 12px;
        border-radius:999px;
        background:linear-gradient(135deg, #c8d2dc, #5f7c98);
        color:#1F1A0F;
        font-size:10px;
        font-weight:800;
        letter-spacing:0.08em;
        box-shadow:0 6px 14px -4px rgba(106,133,160,0.55);
        z-index:3;
      }

      /* ── 5. Score — medal disc + ribbon + dots ───────────────────── */
      .sb-scene-halo-score{
        background:radial-gradient(circle at 50% 50%, rgba(176, 192, 209,0.32) 0%, transparent 60%);
      }
      .sb-score-ribbon{
        position:absolute;
        top:30px;
        left:50%;
        transform:translateX(-50%);
        z-index:3;
        padding:5px 14px;
        border-radius:8px;
        background:linear-gradient(135deg, #F0F0EC, #C8C9C2 50%, #6B7565);
        color:#1F1A0F;
        font-size:10px;
        font-weight:800;
        letter-spacing:0.10em;
        box-shadow:0 6px 14px -4px rgba(31,26,15,0.30);
        text-transform:uppercase;
        clip-path:polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%);
      }
      .sb-score-medal{
        position:relative;
        width:96px;
        height:96px;
        border-radius:50%;
        background:
          radial-gradient(circle at 32% 28%, #e3e8ed 0%, #b4c1cf 50%, #3f5369 100%);
        box-shadow:
          0 14px 28px -10px rgba(31,26,15,0.45),
          0 5px 10px -3px rgba(31,26,15,0.25),
          inset 0 3px 5px rgba(255,255,255,0.55),
          inset 0 -4px 7px rgba(31,26,15,0.25),
          inset 0 0 0 1px rgba(255,255,255,0.20);
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        z-index:2;
        margin-top:8px;
      }
      .sb-score-medal-sheen{
        position:absolute;
        inset:4px;
        border-radius:50%;
        background:conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.30) 20%, transparent 40%, transparent 60%, rgba(255,255,255,0.18) 80%, transparent 100%);
        mix-blend-mode:screen;
        animation:sbScoreSheen 8s linear infinite;
        pointer-events:none;
      }
      .sb-score-medal-num{
        font-family:'Cormorant Garamond', Georgia, serif;
        font-style:italic;
        font-weight:700;
        font-size:34px;
        line-height:1;
        color:#1F1A0F;
        text-shadow:0 1px 0 rgba(255,255,255,0.45), 0 -1px 0 rgba(31,26,15,0.20);
        z-index:1;
        font-variant-numeric:tabular-nums;
      }
      .sb-score-medal-den{
        font-family:'Inter', system-ui, sans-serif;
        font-size:9px;
        font-weight:700;
        letter-spacing:0.10em;
        color:rgba(31,26,15,0.62);
        margin-top:2px;
        z-index:1;
      }
      .sb-score-pill{
        position:absolute;
        bottom:42px;
        left:50%;
        transform:translateX(-50%);
        padding:5px 12px;
        border-radius:999px;
        background:rgba(106,133,160,0.14);
        border:1px solid rgba(106,133,160,0.40);
        color:var(--cozy-cocoa);
        font-size:10px;
        font-weight:600;
        letter-spacing:0.04em;
        z-index:3;
      }
      .sb-score-dots{
        position:absolute;
        bottom:20px;
        left:50%;
        transform:translateX(-50%);
        display:inline-flex;
        gap:5px;
        align-items:center;
        z-index:3;
      }
      .sb-score-dot{
        width:8px;
        height:8px;
        border-radius:50%;
        box-shadow:0 0 0 1px rgba(255,255,255,0.55), 0 2px 4px rgba(31,26,15,0.18);
      }
      .sb-score-dot-g{ background:radial-gradient(circle at 30% 30%, #B5CDA0, #5E7A4F); }
      .sb-score-dot-y{ background:radial-gradient(circle at 30% 30%, #cfd8e1, #5f7c98); }

      /* ── 6. Earn ─────────────────────────────────────────────────── */
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
        background:rgba(176, 192, 209,0.92);
        border:1px solid rgba(106,133,160,0.28);
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
        background:linear-gradient(135deg, #c8d2dc, #5f7c98);
        color:#1F1A0F;
        font-size:9px;
        font-weight:800;
        letter-spacing:0.04em;
        box-shadow:0 4px 10px -3px rgba(106,133,160,0.55);
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
      @keyframes sbFlashBolt {
        0%, 100% { transform:scale(1)    rotate(-4deg); filter:drop-shadow(0 4px 18px rgba(176, 192, 209,0.55)); }
        50%      { transform:scale(1.08) rotate( 4deg); filter:drop-shadow(0 6px 26px rgba(176, 192, 209,0.85)); }
      }
      @keyframes sbBid3Pop {
        0%   { opacity:0; transform:translateY(8px) scale(0.92); }
        100% { opacity:1; transform:translateY(0) scale(1); }
      }
      @keyframes sbBid3Wave {
        0%, 100% { opacity:0.3; transform:scale(1); }
        50%      { opacity:1;   transform:scale(1.5); }
      }
      @keyframes sbCmpBarPulse {
        0%, 100% { box-shadow:0 4px 12px -3px rgba(106,133,160,0.55), inset 0 1px 0 rgba(255,255,255,0.55); }
        50%      { box-shadow:0 6px 18px -3px rgba(106,133,160,0.75), inset 0 1px 0 rgba(255,255,255,0.6); }
      }
      @keyframes sbScoreSheen {
        0%   { transform:rotate(0); }
        100% { transform:rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .sb-scene-halo,
        .sb-spark, .sb-scene-dot,
        .sb-flash-bolt, .sb-flash-livedot,
        .sb-bid3-s1, .sb-bid3-s2, .sb-bid3-s3,
        .sb-bid3-dots i, .sb-bid3-ai-dot,
        .sb-cmp-bar-win,
        .sb-score-medal-sheen {
          animation: none !important;
        }
      }
    `}</style>
  );
}
