// ═══════════════════════════════════════════════════════════════════════════
// Overlay composite — DOM-positioned text/emoji/sticker overlays burned
// into the final media (photo or video) at upload time.
// ───────────────────────────────────────────────────────────────────────────
// The Composer edits overlays as DOM nodes (absolute-positioned + CSS
// transforms = silky drag on mobile). At Post-time we composite them
// onto a canvas so they live INSIDE the media file (one-time re-encode,
// no client-side overlay needed at playback time anywhere).
//
// Why this and not Konva/Fabric:
//   • Konva = ~280 KB extra bundle for what is essentially absolute
//     positioning + CSS transform. We already own the canvas +
//     MediaRecorder pipeline in lib/social/video-compress.ts; this file
//     piggybacks on it and reuses the same proven path.
//   • Konva's value is interactive layer hit-testing, transformer
//     handles, vector shapes. We use single-tap selection + drag-only.
//
// Coordinate model
//   Every overlay stores `x`, `y` as 0-1 NORMALISED to the preview
//   frame's content box (NOT the wrapper, NOT the viewport). At
//   composite time we map them to the output canvas:
//       cx = x * canvasW,    cy = y * canvasH
//   This makes overlays portable across the edit preview (~36dvh tall)
//   and the final output (up to 1080×1920) without any per-render
//   recalc inside the Composer.
//
//   `scale` is a multiplier on the BASE size (defined per-kind in px
//   normalised to a 1000-px wide reference frame). Default 1.0 = the
//   base size. Pinch / desktop slider clamp 0.3 – 3.0.
//
//   `rotation` is degrees.
// ═══════════════════════════════════════════════════════════════════════════
"use client";

export type OverlayKind = "text" | "emoji";

export type Overlay = {
  id: string;
  kind: OverlayKind;
  /** For "text": the user-typed body. For "emoji": the picked emoji character. */
  text: string;
  /** Centre x, normalised 0-1 to the preview frame. */
  x: number;
  /** Centre y, normalised 0-1. */
  y: number;
  /** Size multiplier. 1.0 = base size; clamp 0.3 - 3.0 in the UI. */
  scale: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Text colour (hex). Ignored for emoji. */
  color?: string;
  /** Background fill behind text — null = transparent. */
  bgFill?: string | null;
  /**
   * v120 — IG-style text style preset. Maps to a font family / weight /
   * tracking + an optional glow flag. Stored as an id (e.g. "classic",
   * "neon", "typewriter") so the preview and the composite both pull
   * from the same TEXT_STYLES table.
   */
  styleId?: string;
};

// ─── v120 IG-style text presets ────────────────────────────────────────
// These run in TWO places — the preview DOM (Composer renders inline CSS)
// and the canvas composite (drawOverlaysOnContext sets ctx.font). Keep the
// shape in sync.
export type TextStyle = {
  id: string;
  label: string;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number; // px on a 1000-px reference frame
  /** If true, draws a soft luminous glow around the text on composite + preview. */
  glow?: boolean;
  /** Uppercase the text for this style only — display effect; the stored body stays unchanged. */
  uppercase?: boolean;
};

export const TEXT_STYLES: TextStyle[] = [
  { id: "classic",    label: "Classic",    fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif', fontWeight: 700, letterSpacing: 0 },
  { id: "modern",     label: "Modern",     fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif', fontWeight: 600, letterSpacing: 0.6, uppercase: true },
  { id: "neon",       label: "Neon",       fontFamily: '"Segoe UI", system-ui, sans-serif',          fontWeight: 800, letterSpacing: 0.4, glow: true },
  { id: "typewriter", label: "Typewriter", fontFamily: '"Courier New", "Menlo", monospace',          fontWeight: 700, letterSpacing: 0 },
  { id: "serif",      label: "Serif",      fontFamily: '"Cormorant Garamond", Georgia, serif',       fontWeight: 700, letterSpacing: 0 },
  { id: "bold",       label: "Bold",       fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif', fontWeight: 900, letterSpacing: -0.2 },
];

export function getTextStyle(id?: string | null): TextStyle {
  if (!id) return TEXT_STYLES[0];
  return TEXT_STYLES.find((s) => s.id === id) || TEXT_STYLES[0];
}

// v120 — IG-style text colour palette. Kept short + high-contrast.
export const TEXT_COLORS: string[] = [
  "#FFFFFF", "#000000", "#FFD76B", "#FF458D", "#FF6B6B",
  "#5B8DFF", "#2ECC71", "#B964FF", "#FF8A65", "#1ABC9C",
];

// ─── Base sizes — tuned to feel like IG (W ≈ 1000-px reference frame) ──
const TEXT_BASE_PX  = 56;   // px @ scale 1.0 on a 1000-px-wide canvas
const EMOJI_BASE_PX = 96;
const TEXT_PADDING_X = 14;  // background pill horizontal padding @ scale 1.0
const TEXT_PADDING_Y = 8;
const TEXT_RADIUS    = 10;
const SHADOW_BLUR    = 6;

/**
 * Draw every overlay in `overlays` onto `ctx`, anchored to a `(canvasW,
 * canvasH)` output frame. Pure function — no state, no DOM read. Safe to
 * call inside a per-frame loop (video composite) or once (photo composite).
 */
export function drawOverlaysOnContext(
  ctx: CanvasRenderingContext2D,
  overlays: Overlay[],
  canvasW: number,
  canvasH: number,
) {
  if (!overlays || overlays.length === 0) return;
  // The base sizes are tuned to a 1000-px-wide reference; rescale so
  // the look stays consistent on 720p and 1080p exports alike.
  const sizeRef = Math.max(canvasW, 720) / 1000;
  for (const o of overlays) {
    const cx = o.x * canvasW;
    const cy = o.y * canvasH;
    ctx.save();
    ctx.translate(cx, cy);
    if (o.rotation) ctx.rotate((o.rotation * Math.PI) / 180);
    if (o.kind === "text") {
      // v120 — honour styleId (font family / weight / tracking / glow / uppercase).
      const style = getTextStyle(o.styleId);
      const fontPx = Math.max(14, TEXT_BASE_PX * o.scale * sizeRef);
      // Canvas 2D doesn't expose letter-spacing as a font property; we
      // emulate it by drawing letters in a single pass with offset.
      ctx.font = `${style.fontWeight} ${Math.round(fontPx)}px ${style.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const rawText = (o.text || "").slice(0, 200);
      const text = style.uppercase ? rawText.toUpperCase() : rawText;
      // Per-letter spacing: build the run width by summing each glyph's
      // measured width plus the configured tracking.
      const trackingPx = style.letterSpacing * o.scale * sizeRef;
      let runW = 0;
      const glyphs: { ch: string; w: number }[] = [];
      for (const ch of text) {
        const m = ctx.measureText(ch);
        glyphs.push({ ch, w: m.width });
        runW += m.width + trackingPx;
      }
      runW = Math.max(0, runW - trackingPx);
      const textH = fontPx * 1.16;
      if (o.bgFill) {
        const padX = TEXT_PADDING_X * o.scale * sizeRef;
        const padY = TEXT_PADDING_Y * o.scale * sizeRef;
        const radius = TEXT_RADIUS * o.scale * sizeRef;
        ctx.fillStyle = o.bgFill;
        roundedRect(ctx, -runW / 2 - padX, -textH / 2 - padY, runW + padX * 2, textH + padY * 2, radius);
        ctx.fill();
      } else if (style.glow) {
        // Neon-style luminous glow — colour-tinted, larger blur.
        ctx.shadowColor = o.color || "#FFD76B";
        ctx.shadowBlur  = SHADOW_BLUR * 3.4 * o.scale * sizeRef;
      } else {
        // Drop shadow ONLY for transparent-bg text (matches IG's white-on-image look).
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur  = SHADOW_BLUR * o.scale * sizeRef;
      }
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = o.color || "#FFFFFF";
      // Draw each glyph at its run-relative x. Single pass; no setTransform.
      let cursor = -runW / 2;
      for (const g of glyphs) {
        ctx.fillText(g.ch, cursor + g.w / 2, 0);
        cursor += g.w + trackingPx;
      }
      ctx.shadowBlur = 0;
    } else if (o.kind === "emoji") {
      const fontPx = Math.max(16, EMOJI_BASE_PX * o.scale * sizeRef);
      ctx.font = `${Math.round(fontPx)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.text || "✨", 0, 0);
    }
    ctx.restore();
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ─── Photo composite ───────────────────────────────────────────────────
// Renders `imageBlob` plus the overlays into a single output blob. Used
// at Post-time before the upload step so the JPEG that lands in Storage
// already has the overlays baked in.
//
// Target size = the source's native dimensions (we don't resize photos
// for compression; the Composer already enforces 4:5 framing).
export async function compositeImageWithOverlays(
  imageBlob: Blob,
  overlays: Overlay[],
  opts?: { maxDim?: number; quality?: number },
): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const maxDim = opts?.maxDim ?? 1440; // cap exports at 1440 longest side
  const quality = opts?.quality ?? 0.88;
  const url = URL.createObjectURL(imageBlob);
  try {
    const img = await loadImage(url);
    const srcW = img.naturalWidth  || (img as any).width  || 1080;
    const srcH = img.naturalHeight || (img as any).height || 1350;
    const longest = Math.max(srcW, srcH);
    const scale = Math.min(1, maxDim / longest);
    const outW = Math.max(2, Math.round(srcW * scale / 2) * 2);
    const outH = Math.max(2, Math.round(srcH * scale / 2) * 2);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't open a 2D canvas for photo composite.");
    ctx.drawImage(img, 0, 0, outW, outH);
    drawOverlaysOnContext(ctx, overlays, outW, outH);
    const blob: Blob = await new Promise((res, rej) => {
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Photo composite encode failed."))), "image/jpeg", quality);
    });
    return { blob, mime: "image/jpeg", width: outW, height: outH };
  } finally {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Image decode failed."));
    img.src = url;
  });
}

/**
 * For mention storage — extract every `@<handle>` substring from a
 * caption so the post payload can ship the matched mention list to
 * the API. Handles are 2-30 chars of [a-zA-Z0-9._-]. Idempotent; safe
 * to call multiple times on the same caption.
 */
export function extractMentionHandles(caption: string): string[] {
  if (!caption) return [];
  const out = new Set<string>();
  const re = /(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9._-]{2,30})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption))) {
    out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}
