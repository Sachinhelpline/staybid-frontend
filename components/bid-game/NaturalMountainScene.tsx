"use client";

/* ════════════════════════════════════════════════════════════════════
   v205 — NaturalMountainScene

   Replaces v204's Three.js cheap-looking procedural scene with REAL
   photographic mountain backdrops that cross-fade per step. Every
   image is a curl-verified Unsplash photo from the existing CITY_DATA
   pool (`app/bid/page.tsx`), so we get genuine natural color — sky
   blue, real mountains, real trees, real forest light — instead of
   procedural noise.

   Per Sachin's v204 reject ("cheap banaya hai... real natural sky-blue
   sky natural mountain natural tree natural sab kuch ek dum real feel"),
   the approach flipped to:

     1. Real Unsplash mountain photo as background (cover, no transform)
     2. Per-step cross-fade between 5 mood photos (dawn → twilight)
     3. SVG climber trail + animated marker overlay
     4. Optional: CSS bird silhouettes drifting across sky (top 30%)
     5. Subtle vignette gradient at bottom so the card content stays
        readable on top

   Two modes via `active` prop (same contract as v204):
     • active=true   — Live step scene with climber trail
     • active=false  — Static boot snapshot (no trail, no animations)

   CSS lives in app/globals.css under `.nms-*` (per v120 styled-jsx rule).
═══════════════════════════════════════════════════════════════════ */

import { useMemo } from "react";

interface Props {
  /** 0..totalSteps-1 — drives backdrop cross-fade + climber position */
  step: number;
  /** Total step count (typically 4) */
  totalSteps: number;
  /** true = live step scene + climber overlay; false = boot snapshot */
  active: boolean;
}

/* ── Per-step natural mountain backdrops ──────────────────────────
   Every URL below is a curl-verified Unsplash photo ID already used
   elsewhere in the codebase (CITY_DATA / hotel imagery). Per CLAUDE.md
   v131.5 rule we ONLY use verified IDs on customer surfaces — never
   Picsum / random stock that could surface walruses or dental machines.

   Picked for natural color progression matching the "climbing higher
   through the day" narrative:
     step 0 — dawn mist on first peak    (morning, soft pink-gold light)
     step 1 — clear forest mountain      (morning, bright green + blue)
     step 2 — high alpine vista          (midday, deep blue sky)
     step 3 — golden hour from summit    (evening, warm side-light)
     step 4 — twilight blue alpenglow    (dusk, deep blue + amber)
*/
const SCENE_PHOTOS = [
  // Mussoorie dawn — pink-orange mist on green slope
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1600&q=82&auto=format&fit=crop",
  // Dhanaulti forest — bright pines + blue sky
  "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1600&q=82&auto=format&fit=crop",
  // Alpine peak — clear deep-blue sky midday (curl-verified Unsplash ID;
  // replaced original Rishikesh `1545071677…` which returned 404 on the
  // image CDN at v205 ship time — picked a verified snow-cap+sky shot
  // matching the same "midday clear" mood).
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&q=82&auto=format&fit=crop",
  // Shimla winter peak — golden side-light on snow
  "https://images.unsplash.com/photo-1551582045-6ec9c11d8697?w=1600&q=82&auto=format&fit=crop",
  // Manali summit — twilight alpenglow
  "https://images.unsplash.com/photo-1605649487212-47bdab064df7?w=1600&q=82&auto=format&fit=crop",
];

export default function NaturalMountainScene({ step, totalSteps, active }: Props) {
  /* Trail markers + draw progress derived from step/totalSteps. */
  const progress = useMemo(() => {
    if (totalSteps <= 1) return 0;
    return Math.min(1, Math.max(0, step / (totalSteps - 1)));
  }, [step, totalSteps]);

  /* Zig-zag path going from bottom-left up to top-right peak. The path
     d-string matches the v204 trail so the climber position math stays
     consistent. SVG viewBox is 100x100 + preserveAspectRatio="none" so
     it stretches to fill the scene regardless of aspect ratio. */
  const trailPath =
    "M 18 92 C 24 80, 30 78, 36 70 C 42 62, 50 62, 56 52 C 62 42, 70 40, 76 30 C 82 22, 88 18, 92 10";
  const trailLen = 240;
  const drawn = Math.max(0, Math.min(1, progress));

  return (
    <div className="nms-stage" aria-hidden="true">
      {/* Layer 1 — Cross-fading real mountain photos. Each photo always
          stays in the DOM at opacity 0; only the active step's opacity
          ramps to 1. 1.2s ease-in-out gives a "scene shift" feeling
          instead of a hard cut. */}
      {SCENE_PHOTOS.map((url, i) => (
        <div
          key={i}
          className={`nms-photo ${i === step ? "is-active" : ""}`}
          style={{ backgroundImage: `url(${url})` }}
        />
      ))}

      {/* Layer 2 — Subtle dark vignette at bottom + sides so the card
          content above the scene stays readable on bright photos. Very
          light gradient — preserves the natural color of the photo. */}
      <div className="nms-vignette" />

      {/* v218.1 — atmosphere layers moved into ClimberMilestoneMap's
          .cmm-root since the climber's tall canvas (180vh) fully covers
          this scene during the playing phase. Layers here would have
          been invisible. Boot phase keeps the static photos + birds. */}

      {/* Layer 3 — Three SVG birds gliding across the sky with WING
          FLAP animation (v206). Each bird is a group with two path
          variants (wings-up + wings-down) toggled via opacity
          keyframes — gives a "flapping while flying" feel without
          the cost of SMIL or JS animation. Birds now ALSO render in
          boot mode (Sachin: "front page main animated birds thoda
          alive feel karwao") — they're cheap visual ornament. */}
      <svg className="nms-birds" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {/* Bird 1 — closest, darkest, slowest flap */}
        <g className="nms-bird nms-bird-1" fill="rgba(20,15,8,0.50)">
          <path className="nms-wing-up"   d="M -2 14 q 2 -2.4 4 0 q 2 2.4 4 0 q -1 1 -2 1.4 q -1 -0.4 -2 -0.4 q -1 0 -2 0.4 q -1 -0.4 -2 -1.4 z" />
          <path className="nms-wing-down" d="M -2 14 q 2 -0.5 4 0 q 2 0.5 4 0 q -1 1 -2 1.4 q -1 -0.4 -2 -0.4 q -1 0 -2 0.4 q -1 -0.4 -2 -1.4 z" />
        </g>
        {/* Bird 2 — middle distance, medium tint, medium flap */}
        <g className="nms-bird nms-bird-2" fill="rgba(20,15,8,0.40)">
          <path className="nms-wing-up"   d="M -2 14 q 1.4 -1.8 2.8 0 q 1.4 1.8 2.8 0 q -0.7 0.7 -1.4 1 q -0.7 -0.3 -1.4 -0.3 q -0.7 0 -1.4 0.3 q -0.7 -0.3 -1.4 -1 z" />
          <path className="nms-wing-down" d="M -2 14 q 1.4 -0.4 2.8 0 q 1.4 0.4 2.8 0 q -0.7 0.7 -1.4 1 q -0.7 -0.3 -1.4 -0.3 q -0.7 0 -1.4 0.3 q -0.7 -0.3 -1.4 -1 z" />
        </g>
        {/* Bird 3 — farthest, lightest, fastest flap (small + high) */}
        <g className="nms-bird nms-bird-3" fill="rgba(20,15,8,0.30)">
          <path className="nms-wing-up"   d="M -2 14 q 1.0 -1.4 2.0 0 q 1.0 1.4 2.0 0 q -0.5 0.5 -1.0 0.7 q -0.5 -0.2 -1.0 -0.2 q -0.5 0 -1.0 0.2 q -0.5 -0.2 -1.0 -0.7 z" />
          <path className="nms-wing-down" d="M -2 14 q 1.0 -0.3 2.0 0 q 1.0 0.3 2.0 0 q -0.5 0.5 -1.0 0.7 q -0.5 -0.2 -1.0 -0.2 q -0.5 0 -1.0 0.2 q -0.5 -0.2 -1.0 -0.7 z" />
        </g>
      </svg>

      {/* Layer 4 — Climber trail overlay. Only in active mode. Path
          draws itself in via stroke-dasharray, markers per step, the
          current-step marker pulses softly. */}
      {active && (
        <svg className="nms-trail-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Soft halo behind the trail for readability over varied
              backgrounds. */}
          <path
            d={trailPath}
            fill="none"
            stroke="rgba(176, 192, 209, 0.20)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray="2 1.6"
          />
          {/* Active drawn-in trail */}
          <path
            d={trailPath}
            fill="none"
            stroke="#f3f5f7"
            strokeWidth="0.75"
            strokeLinecap="round"
            strokeDasharray={trailLen}
            strokeDashoffset={trailLen * (1 - drawn)}
            style={{
              transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 0.9, 0.3, 1)",
              filter: "drop-shadow(0 0 3px rgba(176, 192, 209,0.6))",
            }}
          />
          {/* Step markers along the trail */}
          {Array.from({ length: totalSteps }).map((_, i) => {
            const p = i / Math.max(1, totalSteps - 1);
            const reached = i <= step;
            // Sampled point on the path — start/end + sine bulge
            const sx = 18 + (92 - 18) * p;
            const sy = 92 - (92 - 10) * p - Math.sin(p * Math.PI) * 4;
            return (
              <circle
                key={i}
                cx={sx}
                cy={sy}
                r={i === step ? 1.6 : 1.0}
                fill={reached ? "#fbfcfc" : "rgba(176, 192, 209, 0.32)"}
                stroke={i === step ? "#f3f5f7" : "transparent"}
                strokeWidth={0.4}
                className={i === step ? "nms-climber-active" : ""}
                style={{
                  filter: reached ? "drop-shadow(0 0 2px rgba(176, 192, 209,0.85))" : "none",
                }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
