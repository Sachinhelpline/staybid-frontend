# 04 — Locked Visual Direction (owner decision, 2026-08-02)

**Owner picked Direction A (Refined Pewter) — with the ACCENT/BRAND COLOUR kept
EXACTLY as the current live (Vercel) site. Do not change the current colour.**

So the direction = Direction A's DISCIPLINE (one type scale, calm spacing,
container-less cards, depth on media only, Airbnb-clean + Apple-restraint) applied
on top of the **existing live pewter/steel-blue palette, verbatim**. This is a
polish-and-systematise pass, NOT a re-colour.

## Locked colour contract — copied verbatim from the live tokens (do not "refine")

### Light (from `app/globals.css :root`)
| Token | Value |
|---|---|
| `--bg-page` | `#f9fafb` (cozy-cream-100) |
| `--bg-card` | `#fefefe` (cozy-cream-50) |
| `--text-base` | `#1f1a0f` (cozy-warm-dark) |
| `--text-soft` | `#4a3820` (cozy-cocoa) |
| `--text-muted` | `color-mix(cozy-cocoa-soft 55%, cozy-cocoa)` ≈ `#574430` |
| `--border-soft` | `#e8dcc8` (cozy-taupe) |
| `--border-strong` | `rgba(110,84,48,0.3)` |
| `--accent` | `#4f6d8a` |
| `--accent-soft` | `rgba(79,109,138,0.14)` |
| `--shadow-card` | `0 6px 22px rgba(31,26,15,0.1)` |
| Stage `--sbh-gold` | `#5f7c98` |
| Stage `--sbh-gold-lt` | `#b4c1cf` (mobile) / `#96a9bc` (desktop) |
| Primary button | `radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%), linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)` |

### Dark (from `[data-theme="dark"]`)
| Token | Value |
|---|---|
| `--bg-page` | `#13171c` |
| `--bg-card` | `#1b212a` |
| `--text-base` | `#dbe3ea` |
| `--text-soft` | `#aab6c4` |
| `--text-muted` | `rgba(178,193,210,0.82)` |
| `--border-soft` | `rgba(170,190,214,0.12)` |
| `--border-strong` | `rgba(170,190,214,0.30)` |
| `--accent` | `#9db8d2` |
| `--accent-soft` | `rgba(157,184,210,0.18)` |

## What Phase 0 does with this
- The palette tokens above are the SOURCE OF TRUTH — Phase 0 does NOT change their
  VALUES; it makes every component READ them (the 620 raw-hex problem) so light+dark
  and future tweaks are one-file changes. Colour stays; adoption is the work.
- Type scale, spacing, primitives, icons — all built around this exact palette.
- The 3 PWA theme-colour sources (`manifest.json`, `viewport.themeColor`,
  `StatusBarColor.tsx`) get reconciled to THESE values (gap G19).

## Still open (round-2 will show, owner confirms)
- Full home screen rendered in this exact palette (round-2 board).
- Whether the flash "% OFF" stamp keeps the current steel tint or the documented
  gold (CLAUDE.md "one deal one colour" — currently the stage repainted it steel;
  owner to confirm in round-2).
