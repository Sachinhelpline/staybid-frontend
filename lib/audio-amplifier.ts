// ═══════════════════════════════════════════════════════════════════════════
// Web Audio amplifier — boosts a video element's audio above the 1.0 cap
// imposed by HTMLMediaElement.volume. Uses createMediaElementSource() once
// per element (the API only allows one source node per media element) and
// reuses it on every gain change.
// ───────────────────────────────────────────────────────────────────────────
// Caveat: createMediaElementSource() requires the resource to be CORS-clean
// or same-origin. If the video CDN doesn't return Access-Control-Allow-
// Origin, calling this still "works" but the audio can be silenced for
// security reasons. Native HTMLMediaElement.volume keeps working in that
// case, so we just degrade gracefully.
// ═══════════════════════════════════════════════════════════════════════════

let _ctx: AudioContext | null = null;
const _entries = new WeakMap<HTMLMediaElement, { source: MediaElementAudioSourceNode; gain: GainNode }>();

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try { _ctx = new Ctor(); } catch { _ctx = null; }
  return _ctx;
}

/** Resume the audio context — must run inside a user gesture. */
export function resumeAudio(): void {
  const c = ctx();
  if (c && c.state === "suspended") {
    c.resume().catch(() => {});
  }
}

/**
 * Apply a gain multiplier to a media element's audio output. Safe to call
 * many times — the source/gain nodes are cached per element.
 */
export function applyGain(media: HTMLMediaElement, gainValue: number): void {
  const c = ctx();
  if (!c) return;
  try {
    let entry = _entries.get(media);
    if (!entry) {
      const source = c.createMediaElementSource(media);
      const gain = c.createGain();
      source.connect(gain);
      gain.connect(c.destination);
      entry = { source, gain };
      _entries.set(media, entry);
    }
    entry.gain.gain.value = Math.max(0, Math.min(4, gainValue));
  } catch {
    // Silently ignore — element may be tainted by CORS or already attached
    // to a different audio graph. Native volume continues to work.
  }
}
