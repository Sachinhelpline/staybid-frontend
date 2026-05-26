/* ════════════════════════════════════════════════════════════════════
   v203 — BidGameZone synth engine (Web Audio API, zero files)

   Every sound the bid game makes is synthesized on the fly:
   - tap        short 880Hz sine click
   - select     600→1400Hz triangle pitch sweep
   - whoosh     filtered-noise band-pass sweep (card transitions)
   - complete   C-E-G-C arpeggio (4 triangles, 60ms stagger)
   - error      220→110Hz square (downward growl)
   - ambient    continuous A2 + E3 sine drone with slow LFO

   Browser autoplay policy requires a user gesture before any audio can
   play. `unlockSound()` MUST be called from the first user gesture; the
   internal AudioContext stays suspended otherwise. The boot screen tap
   is what unlocks it.

   Master gain reads `localStorage.bgz_mute` on first init so the user's
   mute preference survives reloads.
════════════════════════════════════════════════════════════════════ */

type AC = AudioContext | null;

let ctx: AC = null;
let masterGain: GainNode | null = null;
let muted = false;
let initialised = false;

function getCtx(): AC {
  if (initialised) return ctx;
  if (typeof window === "undefined") return null;
  const Win = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const ACClass = Win.AudioContext || Win.webkitAudioContext;
  if (!ACClass) {
    initialised = true;
    return null;
  }
  try {
    ctx = new ACClass();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.32;
    masterGain.connect(ctx.destination);
    try {
      muted = localStorage.getItem("bgz_mute") === "1";
      if (muted) masterGain.gain.value = 0;
    } catch {
      /* localStorage blocked — fall through */
    }
  } catch {
    ctx = null;
  }
  initialised = true;
  return ctx;
}

/** Call from a user gesture. Resumes the context if suspended. */
export function unlockSound(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.32;
  try {
    localStorage.setItem("bgz_mute", m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  return muted;
}

/* ── Cue helpers ─────────────────────────────────────────────────── */

function envelope(c: AudioContext, gain: GainNode, peak: number, attack: number, hold: number, release: number): void {
  const t = c.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.setValueAtTime(peak, t + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.001, t + attack + hold + release);
}

export function playTap(): void {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  envelope(c, gain, 0.18, 0.005, 0, 0.07);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(c.currentTime + 0.09);
}

export function playSelect(): void {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(600, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1400, c.currentTime + 0.18);
  envelope(c, gain, 0.22, 0.02, 0, 0.2);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(c.currentTime + 0.25);
}

export function playWhoosh(): void {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.3), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 8;
  filter.frequency.setValueAtTime(400, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.25);
  const gain = c.createGain();
  envelope(c, gain, 0.15, 0.05, 0, 0.25);
  src.connect(filter).connect(gain).connect(masterGain);
  src.start();
}

export function playComplete(): void {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const start = c.currentTime + i * 0.06;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
    osc.connect(gain).connect(masterGain!);
    osc.start(start);
    osc.stop(start + 0.42);
  });
}

export function playError(): void {
  const c = getCtx();
  if (!c || muted || !masterGain) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(220, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, c.currentTime + 0.15);
  envelope(c, gain, 0.12, 0.02, 0, 0.18);
  osc.connect(gain).connect(masterGain);
  osc.start();
  osc.stop(c.currentTime + 0.22);
}

/* ── Ambient bed ─────────────────────────────────────────────────── */

type AmbientHandle = { stop: () => void };
let ambient: AmbientHandle | null = null;

export function startAmbient(): void {
  const c = getCtx();
  if (!c || ambient || !masterGain) return;
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o1.type = "sine";
  o2.type = "sine";
  o1.frequency.value = 110; // A2
  o2.frequency.value = 164.81; // E3
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.045, c.currentTime + 2.0);
  // Slow LFO modulating master amb gain so it breathes
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 0.18;
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain).connect(g.gain);
  o1.connect(g);
  o2.connect(g);
  g.connect(masterGain);
  o1.start();
  o2.start();
  lfo.start();
  ambient = {
    stop: () => {
      const t = c.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 1.2);
      o1.stop(t + 1.3);
      o2.stop(t + 1.3);
      lfo.stop(t + 1.3);
      ambient = null;
    },
  };
}

export function stopAmbient(): void {
  ambient?.stop();
}

/* ── Haptics ─────────────────────────────────────────────────────── */

export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore — some browsers block it */
  }
}
