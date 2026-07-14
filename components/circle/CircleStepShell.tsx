"use client";

// ═══════════════════════════════════════════════════════════════════════════
// CircleStepShell — the shared 3-step marketplace shell (v339 · Phase M0).
//
// Model 1 (/circle/discover → /circle/build), Model 3 (/circle/model3) and
// Model 4 (/circle/model4) all wrap their body in THIS so the three investor
// journeys look IDENTICAL: a premium dark-walnut page (.sbc-home) with a
// back link, a model eyebrow, a "1 Choose · 2 Select · 3 Build & Pay" step
// rail with the active step highlighted, a title + subtitle, and a body slot.
//
// M0 renders only the shell + an honest supply state at Step 1. The real
// browse → yearly-calendar → build flow is filled into `children` by M1 (M3)
// and M3 (M4). Nothing here fetches or charges.
// ═══════════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import Link from "next/link";

const STEPS = ["Choose", "Select", "Build & Pay"] as const;

export default function CircleStepShell({
  model,
  tag,
  title,
  subtitle,
  activeStep = 1,
  children,
}: {
  model: string;             // e.g. "Model 3"
  tag?: string;              // e.g. "Pre-Buy Marketplace"
  title: string;
  subtitle?: string;
  activeStep?: 1 | 2 | 3;
  children: ReactNode;
}) {
  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap">
        <Link href="/circle" className="sbc-ms-back">← StayCircle</Link>

        <div className="sbc-ms-eyebrow">
          <span className="sbc-ms-model">{model}</span>
          {tag ? <span className="sbc-ms-tag">{tag}</span> : null}
        </div>

        <h1 className="sbc-ms-title">{title}</h1>
        {subtitle ? <p className="sbc-ms-sub">{subtitle}</p> : null}

        {/* 3-step rail — identical across all three investor journeys */}
        <div className="sbc-ms-steps" role="list" aria-label="3-step journey">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < activeStep ? "done" : n === activeStep ? "active" : "";
            return (
              <div key={label} className="sbc-ms-stepwrap" role="listitem">
                <div className={`sbc-ms-step ${state}`}>
                  <span className="sbc-ms-stepnum">{n < activeStep ? "✓" : n}</span>
                  <span className="sbc-ms-steplabel">{label}</span>
                </div>
                {n < STEPS.length ? <span className="sbc-ms-sep" aria-hidden /> : null}
              </div>
            );
          })}
        </div>

        <div className="sbc-ms-body">{children}</div>
      </div>
    </div>
  );
}
