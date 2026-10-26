"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Travel Buddy — SCREEN-FIRST UX PREVIEW (offline candidate 02:
// consolidated visual / interaction polish of candidate 01).
//
// The screen-first presentation of the EXISTING global Live-AI session. It is
// mounted next to LiveAiShell inside LiveAiProvider and renders ONLY when
// resolveTravelBuddyGate() holds: V=1, provider P OFF, and
// NEXT_PUBLIC_TRAVEL_BUDDY_UX_PREVIEW === "1" — in which case LiveAiShell renders
// NO orb (single voice owner). Default OFF everywhere: with the gate closed this
// component returns null and mounts no hooks, listeners, timers or audio.
//
//   • The real StayBid page stays the canvas: ONE small "Talk to StayBid" chip;
//     once active, ONE compact control capsule (primary voice control · ⋯ · End)
//     plus a ≤2-line Netflix-style caption that fades after it has been read.
//     Type / Mute live behind ⋯ (revealed on demand). NO popup, modal, sheet,
//     scrim, chat history or duplicate result list.
//   • Nothing happens before the guest taps: no audio, mic, timers or network.
//     The activation tap is the consent gesture: the greeting starts AND — only
//     where the browser offers SpeechRecognition — listening is started inside
//     that SAME tap (the browser shows its own permission prompt). While Buddy
//     speaks, recognised audio is ignored (self-capture guard). A visible
//     "Listening…" state is shown whenever the mic is on; one tap stops it.
//   • After a VOICE turn Buddy re-opens listening once, visibly; if the browser
//     refuses without a new tap, the control simply reads "Tap to talk". The one
//     silence follow-up never re-opens the mic; standby always turns it off.
//   • Page changes go ONLY through the existing typed runtime envelope path
//     (runtime.makeEnvelope + runtime.execute → the page bridges' own setters),
//     or ONE allow-listed navigation from the Stage home to /hotels?city=<City>.
//     No DOM scraping, no selectors, no free-form URLs, no new API routes.
//   • Bookings / bids / payments / messages / account changes are NEVER executed:
//     guidance captions only. No provider, no paid AI, no secrets.
//   • Integrated TEXT + VOICE (offline candidate): typed and voice turns share ONE
//     conversation (one log, one slot/context model, one planner via the
//     lib/travel-buddy/voice-io reasoning seam). A voice transcript is NEVER acted
//     on directly: it opens a review card (verbatim, editable) and low-confidence
//     critical fields (destination / budget / guests / nights / dates) must be
//     confirmed or edited before Send — nothing is silently corrected.
//   • Voice I/O is injected and FAIL-CLOSED: default "off". "Simulated" demo voice
//     (NEXT_PUBLIC_TRAVEL_BUDDY_DEMO_VOICE=1) uses NO microphone and plays NO audio —
//     sample phrases stand in for speech and every surface is labelled SIMULATED.
//     Browser SpeechRecognition (vendor speech service) only with
//     NEXT_PUBLIC_TRAVEL_BUDDY_BROWSER_STT=1; speechSynthesis only with on-device
//     voices and NEXT_PUBLIC_TRAVEL_BUDDY_DEVICE_TTS=1. Real provider STT / model /
//     TTS egress is not compiled at all. Typed input sends the typed words nowhere.
// ─────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLiveAi } from "./LiveAiProvider";
import { useFounderText } from "./useFounderText";
import { LAUNCH_ZONES } from "@/lib/launch/curation";
import type { LiveAiOperation, VisibleHotelSummary } from "@/lib/live-ai/contracts";
import type { ExecutionResult } from "@/lib/live-ai/runtime";
import {
  DEMO_NOTE,
  TYPED_PREVIEW_NOTE,
  captionChunks,
  detectLang,
  emptySlots,
  formatCompare,
  formatFact,
  formatRefusal,
  formatResults,
  formatRooms,
  greetingFor,
  hotelsHrefFor,
  isTextOnlyPreview,
  resolveTravelBuddyGate,
  resolveTravelBuddyLiveGate,
  silenceFollowUp,
  surfaceForPath,
  type BuddyLang,
  type BuddySlots,
  type PlannerContext,
  type PlanStep,
} from "@/lib/travel-buddy/conversation";
import {
  DEFAULT_PREFS,
  DRAG_THRESHOLD,
  MASCOTS,
  MASCOT_HIT,
  MASCOT_VISUAL,
  clampToBox,
  denormalize,
  footprintClear,
  mascotById,
  mascotRectAt,
  badgeHitRectAt,
  normalize,
  planPlacement,
  planTab,
  readPrefs,
  safeBox,
  writePrefs,
  type BuddyPrefs,
  type Insets,
  type PageTarget,
  type Rect,
  type SafeBox,
} from "@/lib/travel-buddy/mascots";
import {
  DEMO_VOICE_NOTE,
  LIVE_VOICE_NOTE,
  SIMULATED_FAILURES,
  SIMULATED_PHRASES,
  VOICE_OFF_NOTE,
  createSimulatedStt,
  resolveVoiceIo,
  selectReasoning,
  type SimulatedUtterance,
  type SttFailure,
  type SttResult,
  type VoiceIoConfig,
} from "@/lib/travel-buddy/voice-io";
import {
  appendEntry,
  criticalLabel,
  reviewTranscript,
  type ConversationEntry,
  type CriticalKey,
} from "@/lib/travel-buddy/session";
import { installTranscriptReview, type TranscriptReviewBridge } from "@/lib/travel-buddy/live-bridge";
import { getActiveTour, setBuddyEngaged, subscribeTour, tourOverlayPresent } from "@/lib/tutorial/buddy-coordination";

// The app's OWN launch destination list is the destination allow-list.
const CITIES: readonly string[] = Object.freeze(
  Array.from(new Set(LAUNCH_ZONES.reduce<string[]>((acc, z) => acc.concat(z.cities), []))),
);

const SILENCE_FOLLOW_UP_MS = 12_000; // ONE gentle nudge after this much post-activation silence
const STANDBY_MS = 10_000;           // then quiet standby
const VERIFY_POLL_MS = 80;
const VERIFY_MAX_MS = 12_000;
const MAX_INPUT = 160;
const CAPTION_CHUNK = 64;            // ≤2 caption lines even at 360 px
const CAPTION_LINGER_MS = 6_500;     // a finished caption stays this long, then fades (Netflix-style)
const SELF_CAPTURE_GUARD_MS = 450;   // ignore recognition results this long after Buddy stops speaking
const EXAMPLES = [
  "Family ke saath Mussoorie jana hai",
  "Budget 5000, parking chahiye",
  "Doosra option dikhao",
  "Breakfast hai?",
  "Hotels in Goa under 6000",
];

type Who = "buddy" | "you" | "note";
interface Caption { who: Who; text: string; ai?: boolean; live?: boolean } // ai: founder-only provider (PRODUCT-02); live: ORIGINAL controller answer
type ListenMode = "gesture" | "auto";

// ---- page geometry probe (UX finishing F1) -----------------------------------
// Buddy must never rest on a native control. To know where those are, it hit-tests
// a coarse 10 px grid ONLY inside the small area it is about to occupy (its own
// candidate rectangle + 10 px), using the browser's own hit-testing
// (elementsFromPoint). Per point it keeps the top-most element that is not Buddy,
// walks up to the nearest interactive ancestor, and reads ONLY geometry:
// getBoundingClientRect() and, for "is a native layer drawn above Buddy?",
// computed position/z-index. It never reads text, values, attributes, URLs or
// form state, never clicks or changes the page, and never scans the whole DOM.
// Computed style is read only for position / z-index (a native layer drawn above
// Buddy) and animation name / play-state (a control that is sliding, e.g. the
// auto-scrolling ticker, must not pass under a resting Buddy at all).
const INTERACTIVE_SEL = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="switch"],[role="menuitem"]';
const BUDDY_Z = 61;          // .tb-root z-index — a fixed/sticky page layer above this sits ON TOP of Buddy
const PROBE_GRID = 10;

interface PointInfo { target: Element | null; cover: Element | null }
interface StyleFlags { layer: Element | null; moving: boolean }
interface PageProbe { isClear: (rects: Rect[]) => boolean }

function makePageProbe(root: Element | null, vw: number, vh: number): PageProbe {
  const points = new Map<number, PointInfo>();
  const flagCache = new Map<Element, StyleFlags>();
  const rectCache = new Map<Element, Rect>();
  const box = (el: Element): Rect => {
    let r = rectCache.get(el);
    if (!r) { const b = el.getBoundingClientRect(); r = { x: b.left, y: b.top, w: b.width, h: b.height }; rectCache.set(el, r); }
    return r;
  };
  // Walk ≤ 8 ancestors once: the nearest fixed/sticky layer drawn above Buddy, and whether the
  // element sits inside a running CSS animation (a moving control).
  const flags = (el: Element): StyleFlags => {
    const hit = flagCache.get(el);
    if (hit) return hit;
    let layer: Element | null = null;
    let moving = false;
    let n: Element | null = el;
    for (let i = 0; n && i < 8; i++, n = n.parentElement) {
      const cs = window.getComputedStyle(n);
      if (!layer && (cs.position === "fixed" || cs.position === "sticky") && parseInt(cs.zIndex, 10) > BUDDY_Z) layer = n;
      if (!moving && cs.animationName && cs.animationName !== "none" && cs.animationPlayState !== "paused") moving = true;
    }
    const f = { layer, moving };
    flagCache.set(el, f);
    return f;
  };
  const at = (gx: number, gy: number): PointInfo => {
    const k = gx * 100000 + gy;
    const hit = points.get(k);
    if (hit) return hit;
    let info: PointInfo = { target: null, cover: null };
    try {
      const stack = document.elementsFromPoint(gx * PROBE_GRID + PROBE_GRID / 2, gy * PROBE_GRID + PROBE_GRID / 2);
      let top: Element | null = null;
      for (let i = 0; i < stack.length; i++) { if (!root || !root.contains(stack[i])) { top = stack[i]; break; } }
      if (top) {
        const t = top.closest(INTERACTIVE_SEL);
        info = { target: t && !(root && root.contains(t)) ? t : null, cover: flags(top).layer };
      }
    } catch { /* hit-testing unavailable: treat as empty */ }
    points.set(k, info);
    return info;
  };
  const isClear = (rects: Rect[]): boolean => {
    const targets: PageTarget[] = [];
    const covers: Rect[] = [];
    const seenT = new Set<Element>();
    const seenC = new Set<Element>();
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor((r.x - PROBE_GRID) / PROBE_GRID)), x1 = Math.min(Math.ceil(vw / PROBE_GRID) - 1, Math.floor((r.x + r.w + PROBE_GRID) / PROBE_GRID));
      const y0 = Math.max(0, Math.floor((r.y - PROBE_GRID) / PROBE_GRID)), y1 = Math.min(Math.ceil(vh / PROBE_GRID) - 1, Math.floor((r.y + r.h + PROBE_GRID) / PROBE_GRID));
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const p = at(gx, gy);
        if (p.target && !seenT.has(p.target)) {
          seenT.add(p.target);
          const f = box(p.target);
          const vx = Math.max(0, f.x), vy = Math.max(0, f.y);
          const v = { x: vx, y: vy, w: Math.min(vw, f.x + f.w) - vx, h: Math.min(vh, f.y + f.h) - vy };
          if (f.w >= 2 && f.h >= 2 && v.w > 0 && v.h > 0) targets.push({ full: f, visible: v, moving: flags(p.target).moving });
        }
        if (p.cover && !seenC.has(p.cover)) { seenC.add(p.cover); covers.push(box(p.cover)); }
      }
    }
    return footprintClear(rects, targets, covers);
  };
  return { isClear };
}

const getRecognition = (): any =>
  isTextOnlyPreview() ? null :
  voiceIoNow().stt !== "browser" ? null : // the vendor speech service is OFF unless explicitly flagged
  typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null) : null;

/** Voice I/O modes for THIS build (each flag exactly "1"; real provider egress is never compiled). */
function voiceIoNow(): VoiceIoConfig {
  return resolveVoiceIo(
    isTextOnlyPreview(),
    process.env.NEXT_PUBLIC_TRAVEL_BUDDY_DEMO_VOICE,
    process.env.NEXT_PUBLIC_TRAVEL_BUDDY_BROWSER_STT,
    process.env.NEXT_PUBLIC_TRAVEL_BUDDY_DEVICE_TTS,
    liveControllerBuild(),
  );
}

/** The live-controller presentation predicate from the BUILD flags (V, P, preview, live). */
function liveControllerBuild(): boolean {
  return resolveTravelBuddyLiveGate(
    process.env.NEXT_PUBLIC_VOICE_AI_BETA === "1",
    process.env.NEXT_PUBLIC_VOICE_AI_BETA === "1" && process.env.NEXT_PUBLIC_LIVE_AI_PROVIDER_BETA === "1",
  );
}

const LIVE_ANSWER_MAX_MS = 30_000; // a live turn with no verified answer by then ends honestly


const LIVE_POLL_MS = 150;

const SIM_STT = createSimulatedStt();          // no microphone, no audio, no network
const REASONING = selectReasoning(voiceIoNow()); // ONE shared core for typed + voice (scripted; provider disabled)

type VoicePanel = "consent" | "listening" | "hearing";
interface Review { result: SttResult; draft: string; confirmed: CriticalKey[] }

/** Gate wrapper: nothing at all (no hooks/listeners) unless the preview gate holds. */
export default function TravelBuddy() {
  const { enabled, providerEnabled } = useLiveAi();
  // Scripted preview (provider P OFF) OR live-controller presentation (P ON + live flag).
  const live = resolveTravelBuddyLiveGate(enabled, providerEnabled);
  if (!resolveTravelBuddyGate(enabled, providerEnabled) && !live) return null;
  return <TravelBuddyPreview live={live} />;
}

function TravelBuddyPreview({ live = false }: { live?: boolean }) {
  const { runtime, activated, activate, deactivate, startProvider, submitText: liveSubmitText, bargeIn, conversation, orbState, setVoiceOutput, getLastTurnError, publicAdmission, hasCustomerBearer, ensureCustomerBearer } = useLiveAi();
  // LIVE controller mode: every turn goes to the ORIGINAL controller (no scripted reply).
  const liveRef = useRef(live);
  liveRef.current = live;
  const liveMicRef = useRef(false);                    // the ORIGINAL controller owns a live mic right now
  const bargeInRef = useRef(bargeIn);
  bargeInRef.current = bargeIn;
  const convRef = useRef(conversation);
  convRef.current = conversation;
  const bridgeRef = useRef<TranscriptReviewBridge | null>(null);
  const [tourActive, setTourActiveState] = useState<string | null>(null);
  const pathname = usePathname() || "/";
  const router = useRouter();
  const surface = surfaceForPath(pathname);

  const [caption, setCaption] = useState<Caption | null>(null);
  const [muted, setMuted] = useState(false);
  // G-PUBLIC — the real AI is for SIGNED-IN guests when the public-admission build gate is on (the broker
  // enforces it server-side; this only explains it and offers the existing sign-in-then-resume flow).
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [standby, setStandby] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);   // the guest/browser denied the mic (this session)
  const [voiceMissing, setVoiceMissing] = useState(false); // no SpeechRecognition in this browser
  const [hadTurn, setHadTurn] = useState(false); // example chips only until the first guest turn
  // Integrated TEXT + VOICE: simulated voice panel, transcript review, ONE shared conversation log.
  const [voicePanel, setVoicePanel] = useState<VoicePanel | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [log, setLog] = useState<ConversationEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [panelH, setPanelH] = useState(0);
  // PRODUCT-02 — founder-only REAL AI TEXT (inert unless its build flag + server eligibility + explicit opt-in).
  const founder = useFounderText(runtime);
  const founderRef = useRef(founder);
  founderRef.current = founder;

  // Generation: bumped by every new turn, stop, end and foreign route change. Any
  // async continuation (speech, verification, deferred apply, recognition result)
  // captured under an older generation is discarded.
  const genRef = useRef(0);
  const expectNavRef = useRef<{ gen: number; match: (p: string) => boolean } | null>(null);
  const slotsRef = useRef<BuddySlots>(emptySlots());
  const langRef = useRef<BuddyLang>("hinglish");
  const followUpUsedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const recogRef = useRef<any>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const activeRef = useRef(false);
  activeRef.current = activated;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusInputRef = useRef(false);        // focus the input only when the guest asked to type
  const speakingRef = useRef(false);          // browser TTS is audibly speaking right now
  const ignoreUntilRef = useRef(0);           // self-capture guard window end (ms epoch)
  const endedDuringSpeechRef = useRef(false); // recognition ended while Buddy was speaking (single-shot engines)
  const turnFromVoiceRef = useRef(false);     // the current turn came from the mic
  const micBlockedRef = useRef(false);
  micBlockedRef.current = micBlocked;
  const listenNoteShownRef = useRef(false);
  const demoNoteShownRef = useRef(false);     // the small DEMO-inventory disclosure, once per session
  const announcedCountRef = useRef<number | null>(null); // result count announced in THIS turn (null = none)
  const captionSeqRef = useRef(0);
  const fadeTimerRef = useRef<number | null>(null);
  const handleUserTextRef = useRef<(raw: string, fromVoice?: boolean, voiceSource?: SttResult["source"]) => Promise<void>>(async () => {});
  const openReviewRef = useRef<(result: SttResult) => void>(() => {});
  const simConsentRef = useRef(false);          // simulated-mic "permission" granted this session
  const simAbortRef = useRef<AbortController | null>(null);
  const reviewRef = useRef<Review | null>(null);
  reviewRef.current = review;
  const bottomPanelRef = useRef<HTMLDivElement | null>(null);
  const logListRef = useRef<HTMLOListElement | null>(null);
  const seqRef = useRef<Promise<unknown>>(Promise.resolve()); // the greeting sequence; async notes queue behind it

  // ---- timers / speech primitives -------------------------------------------
  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => { try { window.clearTimeout(t); } catch { /* no-op */ } });
    timersRef.current = [];
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  }, []);

  const sleep = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms); });

  const cancelSpeech = useCallback(() => {
    // Typed-only preview never touches speechSynthesis at all (not even cancel()).
    try { const tts = voiceIoNow().tts; if ((tts === "device" || tts === "browser") && !isTextOnlyPreview() && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); } catch { /* no-op */ }
    if (speakingRef.current) ignoreUntilRef.current = Date.now() + SELF_CAPTURE_GUARD_MS;
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const stopListening = useCallback(() => {
    const r = recogRef.current;
    recogRef.current = null;
    if (r) { try { r.onresult = null; r.onerror = null; r.onend = null; r.abort(); } catch { /* no-op */ } }
    const sim = simAbortRef.current;            // simulated "hearing…" in flight → cancelled
    simAbortRef.current = null;
    if (sim) { try { sim.abort(); } catch { /* no-op */ } }
    // LIVE: the ORIGINAL controller owns the mic — stopping listening is its capture-closing
    // barge-in (closes media + lease). Only when a live mic was actually started by Teddy.
    if (liveMicRef.current) { liveMicRef.current = false; try { bargeInRef.current(); } catch { /* no-op */ } }
    setVoicePanel(null);
    setListening(false);
  }, []);

  // Captions fade after they have been read (no persistent bubble / history).
  const showCaption = useCallback((c: Caption | null) => {
    captionSeqRef.current += 1;
    if (fadeTimerRef.current != null) { try { window.clearTimeout(fadeTimerRef.current); } catch { /* no-op */ } fadeTimerRef.current = null; }
    setCaption(c);
  }, []);

  const scheduleFade = useCallback(() => {
    const seq = captionSeqRef.current;
    if (fadeTimerRef.current != null) { try { window.clearTimeout(fadeTimerRef.current); } catch { /* no-op */ } }
    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      if (captionSeqRef.current === seq) setCaption(null);
    }, CAPTION_LINGER_MS);
  }, []);

  // A caption chunk stays up at least long enough to read, even if the browser's
  // speech engine finishes instantly (no voice installed) or speech is muted.
  const speakChunk = useCallback((text: string, lang: BuddyLang): Promise<void> => {
    const readable = new Promise<void>((r) => { window.setTimeout(r, Math.max(1800, text.length * 50)); });
    const spoken = new Promise<void>((resolve) => {
      const fallbackMs = Math.max(2200, text.length * 62);
      const tts = voiceIoNow().tts;
      if (mutedRef.current || isTextOnlyPreview() || (tts !== "device" && tts !== "browser") || typeof window === "undefined" || !("speechSynthesis" in window)) {
        window.setTimeout(resolve, fallbackMs); // simulated / controller-owned playback: the caption is the output here
        return;
      }
      // Device TTS: ON-DEVICE voices only (localService) — a remote/network voice is never used.
      // Legacy "browser" TTS (R1, no voice flag set): the pre-Candidate01 behaviour, default voice.
      let local: SpeechSynthesisVoice | undefined;
      if (tts === "device") {
        try { local = window.speechSynthesis.getVoices().find((v) => v.localService && v.lang.toLowerCase().startsWith(lang === "en" ? "en" : "hi")); } catch { local = undefined; }
        if (!local) { window.setTimeout(resolve, fallbackMs); return; }
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speakingRef.current = false;
        ignoreUntilRef.current = Date.now() + SELF_CAPTURE_GUARD_MS; // room echo tail
        resolve();
      };
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "en" ? "en-IN" : "hi-IN";
        if (local) u.voice = local;
        u.rate = 1;
        u.onend = finish;
        u.onerror = finish;
        speakingRef.current = true;
        window.speechSynthesis.speak(u);
        // Never hang on a missing voice/engine: bounded fallback.
        window.setTimeout(finish, fallbackMs + 4000);
      } catch { window.setTimeout(finish, fallbackMs); }
    });
    return Promise.all([readable, spoken]).then(() => undefined);
  }, []);

  /** Show a caption as ≤2-line chunks (spoken when not muted). Returns false if superseded. */
  const say = useCallback(async (text: string, gen: number, who: Who = "buddy"): Promise<boolean> => {
    const chunks = captionChunks(text, CAPTION_CHUNK);
    if (gen === genRef.current && who !== "you") setLog((l) => appendEntry(l, { who, text }));
    for (const c of chunks) {
      if (gen !== genRef.current) return false;
      setStandby(false);
      showCaption({ who, text: c });
      if (who === "buddy") {
        setSpeaking(true);
        await speakChunk(c, langRef.current);
        if (gen === genRef.current) setSpeaking(false);
      } else {
        await sleep(Math.max(1600, c.length * 45));
      }
    }
    if (gen !== genRef.current) return false;
    scheduleFade();
    return true;
  }, [scheduleFade, showCaption, speakChunk]);

  /** An asynchronous note (e.g. a recognition error) waits for the current spoken sequence — captions never interleave. */
  const sayAfter = useCallback((text: string, gen: number, who: Who = "note"): Promise<unknown> => {
    const run = seqRef.current.then(() => (gen === genRef.current ? say(text, gen, who) : false));
    seqRef.current = run.catch(() => undefined);
    return run;
  }, [say]);

  /** The small DEMO-inventory disclosure — once per session, right after the first grounded listing caption. */
  const noteDemoOnce = useCallback(async (gen: number): Promise<void> => {
    if (demoNoteShownRef.current || gen !== genRef.current) return;
    demoNoteShownRef.current = true;
    await say(DEMO_NOTE[langRef.current], gen, "note");
  }, [say]);

  /** Is a guest-applied list filter (budget / parking) active in the page's OWN snapshot? */
  const listFiltered = useCallback((): boolean => {
    const pub = runtime ? runtime.publishedContext() : null;
    return !!pub && pub.pageId === "hotels" && (pub.refinement?.maxPrice != null || !!pub.refinement?.parking);
  }, [runtime]);

  const enterStandby = useCallback((gen: number) => {
    if (gen !== genRef.current) return;
    stopListening();
    setOptionsOpen(false);
    setTyping(false);
    showCaption(null);
    setStandby(true);
  }, [showCaption, stopListening]);

  // ---- silence follow-up (max ONE per activation) then standby --------------
  const armSilence = useCallback((gen: number) => {
    clearTimers();
    if (!activeRef.current) return;
    if (!followUpUsedRef.current) {
      later(async () => {
        if (gen !== genRef.current || !activeRef.current || surfaceRef.current === "other") return;
        followUpUsedRef.current = true;
        const pub = runtime ? runtime.publishedContext() : null;
        const visibleNow = pub && pub.pageId === "hotels" && pub.loadState === "ready" ? pub.visibleHotels.length : null;
        const ok = await say(silenceFollowUp(surfaceRef.current, slotsRef.current, langRef.current, visibleNow), gen);
        // The follow-up never re-opens the mic; standby always switches it off.
        if (ok) later(() => enterStandby(gen), STANDBY_MS);
      }, SILENCE_FOLLOW_UP_MS);
    } else {
      later(() => enterStandby(gen), STANDBY_MS);
    }
  }, [clearTimers, enterStandby, later, runtime, say]);

  // ---- browser speech recognition -------------------------------------------
  // Returns true if listening started. MUST be called synchronously inside the
  // guest's tap for mode "gesture" (that is what lets the browser bind its mic
  // permission prompt to a deliberate gesture). Mode "auto" is the single bounded
  // re-open after a VOICE turn; any refusal there is silent ("Tap to talk").
  const startRecognition = useCallback((gen: number, mode: ListenMode): boolean => {
    if (!activeRef.current) return false;
    if (mode === "auto" && micBlockedRef.current) return false;
    if (voiceIoNow().stt === "provider") {
      // LIVE: the ORIGINAL controller is the single mic owner (startProvider → transport media).
      // It is started ONLY by an explicit gesture and never re-opened automatically.
      if (mode === "auto") return false;
      // G-PUBLIC — the broker admits only a signed-in guest's backend session; a Firebase-only session is
      // upgraded in the background (tap again once it is ready). No token ⇒ explain + offer sign-in.
      if (publicAdmission && !hasCustomerBearer()) {
        setSignInNeeded(true);
        void ensureCustomerBearer();
        void say(langRef.current === "en" ? "Please sign in to talk with Teddy's real AI, then tap the mic again." : "Teddy ke real AI ke liye sign in kariye, phir mic dobara dabaiye.", gen, "note");
        return true;
      }
      stopListening();
      setTyping(false);
      setStandby(false);
      // A microphone needs a FRESH start (the original transport's single-start owner): end a
      // live text session first — exactly what the provider's own beginStart does for ERROR.
      const c = convRef.current;
      const st = c ? c.getState() : "DISCONNECTED";
      if (c && st !== "DISCONNECTED" && st !== "ERROR" && st !== "OFFLINE") { try { c.end("user"); } catch { /* no-op */ } }
      liveMicRef.current = true;
      startProvider("microphone");
      setVoicePanel("listening");
      setListening(true);
      return true;
    }
    if (voiceIoNow().stt === "simulated") {
      // Simulated demo voice: NO microphone. The panel stands in for the mic; the first use
      // asks a simulated permission (honest copy), mirroring the browser's own prompt.
      stopListening();
      if (mode === "auto" && !simConsentRef.current) return false;
      if (mode === "gesture") setTyping(false); // the guest chose to talk: the voice panel takes the bottom band
      setStandby(false);
      if (!simConsentRef.current) { setVoicePanel("consent"); return true; }
      setVoicePanel("listening");
      setListening(true);
      return true;
    }
    const SR = getRecognition();
    if (!SR) { setVoiceMissing(true); return false; }
    stopListening();
    endedDuringSpeechRef.current = false;
    let r: any;
    try {
      r = new SR();
      r.lang = langRef.current === "en" ? "en-IN" : "hi-IN";
      r.interimResults = false;
      r.maxAlternatives = 1;
      r.continuous = true; // engines that ignore this end after one phrase (handled in onend)
      r.onresult = (e: any) => {
        if (recogRef.current !== r || gen !== genRef.current) return;
        const list = e?.results;
        if (!list) return;
        for (let i = typeof e.resultIndex === "number" ? e.resultIndex : 0; i < list.length; i++) {
          const res = list[i];
          if (!res || res.isFinal === false) continue;
          // Self-capture guard: never treat Buddy's own voice as the guest.
          if (speakingRef.current || Date.now() < ignoreUntilRef.current) continue;
          const t = res[0]?.transcript;
          if (typeof t === "string" && t.trim()) {
            stopListening();
            // Never acted on directly: the transcript opens the review card (verbatim, editable).
            const conf = typeof res[0]?.confidence === "number" ? res[0].confidence : 0;
            openReviewRef.current({ transcript: t.slice(0, MAX_INPUT), confidence: conf, alternatives: [], source: "browser" });
            return;
          }
        }
      };
      r.onerror = (e: any) => {
        if (recogRef.current !== r) return;
        const code = String(e?.error || "");
        stopListening();
        if (gen !== genRef.current || code === "aborted") return;
        const denied = code === "not-allowed" || code === "service-not-allowed";
        if (mode === "auto") {
          if (denied) setMicBlocked(true);
          return; // silent: the control simply reads "Tap to talk"/"Type"
        }
        if (code === "no-speech") return; // quiet; the single silence follow-up covers it
        if (denied) setMicBlocked(true);
        void sayAfter(
          denied
            ? (langRef.current === "en" ? "Microphone permission wasn't given — tap Type to write instead." : "Mic permission nahi mili — Type dabakar likh sakte hain.")
            : (langRef.current === "en" ? "Voice didn't work this time — tap the mic to retry, or type." : "Voice abhi nahi chala — mic dabakar phir try kariye, ya type kariye."),
          gen);
      };
      r.onend = () => {
        if (recogRef.current !== r) return;
        if (speakingRef.current || Date.now() < ignoreUntilRef.current) endedDuringSpeechRef.current = true;
        recogRef.current = null;
        setListening(false);
      };
      recogRef.current = r;
      setListening(true);
      setStandby(false);
      r.start();
      return true;
    } catch {
      if (recogRef.current === r) recogRef.current = null;
      setListening(false);
      if (mode === "gesture") {
        void sayAfter(langRef.current === "en" ? "Voice didn't start — tap the mic again, or type." : "Voice shuru nahi hua — mic phir dabaiye, ya type kariye.", gen);
      }
      return false;
    }
  }, [sayAfter, stopListening, say, publicAdmission, hasCustomerBearer, ensureCustomerBearer, startProvider]);

  /** After Buddy finished speaking: keep (or once restore) listening, visibly. */
  const continueListening = useCallback((gen: number, reason: "greeting" | "turn") => {
    if (gen !== genRef.current || !activeRef.current) return;
    if (document.visibilityState === "hidden") return;
    if (recogRef.current) return; // still listening (continuous engines)
    if (reason === "greeting" && !endedDuringSpeechRef.current) return; // never started / ended by error
    void startRecognition(gen, "auto");
  }, [startRecognition]);

  // ---- typed runtime path (the ONLY way page state changes) -----------------
  const execOp = useCallback((op: LiveAiOperation): ExecutionResult => {
    if (!runtime) return { ok: false, status: "disabled" };
    const env = runtime.makeEnvelope(op);
    if (!env) return { ok: false, status: "no_registration" };
    return runtime.execute(env);
  }, [runtime]);

  const plannerContext = useCallback((): PlannerContext => {
    const pub = runtime ? runtime.publishedContext() : null;
    const onList = !!pub && pub.pageId === "hotels";
    return {
      surface: surfaceRef.current,
      listDestination: onList ? pub!.destination : null,
      listMaxPrice: onList ? (pub!.refinement?.maxPrice ?? null) : null,
      listParking: onList ? !!pub!.refinement?.parking : false,
      listReady: onList && pub!.loadState === "ready",
      visibleCount: onList ? pub!.visibleHotels.length : 0,
      detailValidated: !!pub && pub.pageId === "hotel-detail" && pub.validated,
    };
  }, [runtime]);

  /** Wait until the page's OWN snapshot reflects the target (never trust a setter call). */
  const waitForList = useCallback(async (gen: number, target: { destination?: string | null; maxPrice?: number; parking?: boolean }): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < VERIFY_MAX_MS) {
      if (gen !== genRef.current || !runtime) return false;
      try { runtime.reconcile(); } catch { /* no-op */ }
      const pub = runtime.publishedContext();
      if (pub && pub.pageId === "hotels" && pub.loadState === "ready") {
        const okDest = target.destination === undefined || pub.destination === target.destination;
        const okPrice = target.maxPrice === undefined || pub.refinement?.maxPrice === target.maxPrice;
        const okPark = target.parking === undefined || !!pub.refinement?.parking === target.parking;
        if (okDest && okPrice && okPark) return true;
      }
      await sleep(VERIFY_POLL_MS);
    }
    return false;
  }, [runtime]);

  const announceResults = useCallback(async (gen: number) => {
    const res = execOp({ op: "READ_CURRENT_RESULTS" });
    const pub = runtime ? runtime.publishedContext() : null;
    if (res.ok && res.results) {
      announcedCountRef.current = res.results.length;
      if (await say(formatResults(langRef.current, res.results as VisibleHotelSummary[], pub?.destination ?? null, { filtered: listFiltered() }), gen)) await noteDemoOnce(gen);
    } else {
      await say(formatRefusal(langRef.current, res.status), gen);
    }
  }, [execOp, listFiltered, noteDemoOnce, runtime, say]);

  const applyRefinement = useCallback(async (gen: number, op: LiveAiOperation): Promise<boolean> => {
    if (op.op !== "APPLY_HOTEL_REFINEMENT") return false;
    let res = execOp(op);
    let applied: LiveAiOperation = op;
    if (!res.ok && res.status === "unsupported_filter" && op.parking) {
      await say(formatRefusal(langRef.current, "unsupported_filter"), gen);
      const { parking: _drop, ...rest } = op;
      if (Object.keys(rest).length > 1) { applied = rest as LiveAiOperation; res = execOp(applied); } else return false;
    }
    if (!res.ok) { await say(formatRefusal(langRef.current, res.status), gen); return false; }
    const a = applied as Extract<LiveAiOperation, { op: "APPLY_HOTEL_REFINEMENT" }>;
    const verified = await waitForList(gen, {
      destination: "destination" in a ? a.destination ?? null : undefined,
      maxPrice: a.maxPrice ?? undefined,
      parking: a.parking,
    });
    if (gen !== genRef.current) return false;
    if (!verified) {
      await say(langRef.current === "en" ? "The results haven't confirmed yet — I won't guess." : "Results abhi confirm nahi hue — main andaza nahi lagaunga.", gen);
      return false;
    }
    await announceResults(gen);
    return true;
  }, [announceResults, execOp, say, waitForList]);

  const endSession = useCallback(() => {
    genRef.current += 1;
    clearTimers();
    cancelSpeech();
    stopListening();
    expectNavRef.current = null;
    slotsRef.current = emptySlots();
    turnFromVoiceRef.current = false;
    showCaption(null);
    setTyping(false);
    setOptionsOpen(false);
    setDraft("");
    setStandby(false);
    setBusy(false);
    setReview(null);
    setLogOpen(false);
    setLog([]);               // the conversation lives in memory only for this session
    deactivate();             // existing teardown (ends the ORIGINAL controller session when P is on)
    activeRef.current = false;
    setBuddyEngaged(false);   // R2 — page tours may auto-fire again
  }, [cancelSpeech, clearTimers, deactivate, showCaption, stopListening]);

  /** The ONLY allow-listed navigation (home → /hotels?city=<City>); shared by scripted + live turns. */
  const navigateToCity = useCallback(async (gen: number, city: string): Promise<"nohref" | boolean> => {
    const href = hotelsHrefFor(city, CITIES);
    if (!href) return "nohref";
    expectNavRef.current = { gen, match: (p) => p === "/hotels" };
    router.push(href);
    return waitForList(gen, { destination: city });
  }, [router, waitForList]);

  /**
   * LIVE turn: ONE submit to the ORIGINAL controller (LiveAiProvider.submitText → conversation →
   * gateway transport). The answer shown is ONLY what the controller itself accepted into its
   * memory — i.e. a browser-verified compiled answer (or its own bounded downgrade). Nothing is
   * composed by Teddy; a missing / failed answer is reported honestly, never guessed.
   */
  const runLiveTurn = useCallback(async (text: string, gen: number): Promise<void> => {
    langRef.current = detectLang(text, langRef.current);
    const en = () => langRef.current === "en";
    if (publicAdmission && !(await ensureCustomerBearer())) {
      if (gen !== genRef.current) return;
      setSignInNeeded(true);
      await say(en() ? "Please sign in to talk with Teddy's real AI — tap \"Sign in\" below." : "Teddy ke real AI se baat karne ke liye sign in kariye — neeche \"Sign in\" dabaiye.", gen, "note");
      return;
    }
    if (publicAdmission) setSignInNeeded(false);
    if (surfaceRef.current === "home") {
      // The controller works on the Hotels list / hotel pages only: first the allow-listed navigation.
      const { plan } = REASONING.plan({ text, context: plannerContext(), slots: slotsRef.current, cities: CITIES, lang: langRef.current });
      slotsRef.current = plan.slots;
      const nav = plan.steps.find((st) => st.kind === "navigate_hotels") as Extract<PlanStep, { kind: "navigate_hotels" }> | undefined;
      if (!nav) {
        await say(en() ? "Tell me a city, e.g. \"Mussoorie\" — the AI answers about the stays on the Hotels list and hotel pages." : "City bataiye, jaise \"Mussoorie\" — AI Hotels list aur hotel page ke stays ke baare mein jawab deta hai.", gen, "note");
        return;
      }
      const ready = await navigateToCity(gen, nav.city);
      if (gen !== genRef.current) return;
      if (ready !== true) { await say(en() ? "The stays didn't load yet — please try again." : "Stays abhi load nahi hue — dobara try kariye.", gen, "note"); return; }
    }
    const t0 = Date.now();
    const surf0 = surfaceRef.current;
    bridgeRef.current?.allow(text);                                        // a typed / reviewed turn passes the transcript gate
    expectNavRef.current = { gen, match: (p) => surfaceForPath(p) !== "other" }; // an AI-proposed open may navigate
    liveSubmitText(text);
    while (Date.now() - t0 < LIVE_ANSWER_MAX_MS) {
      if (gen !== genRef.current) return;
      const conv = convRef.current;
      let answer: { text: string } | null = null;
      if (conv) for (const m of conv.getMemory()) if (m.role === "assistant" && m.at >= t0) answer = m;
      if (answer) {
        const g = gen;
        for (const c of captionChunks(answer.text, CAPTION_CHUNK)) {
          if (g !== genRef.current) return;
          setStandby(false);
          showCaption({ who: "buddy", text: c, live: true });
          // the SAME verified text, spoken ONLY with on-device voices when the device-TTS flag is on
          // (speakChunk is caption-paced otherwise); never a provider/network voice.
          setSpeaking(true);
          await speakChunk(c, langRef.current);
          if (g === genRef.current) setSpeaking(false);
        }
        if (g !== genRef.current) return;
        setLog((l) => appendEntry(l, { who: "buddy", text: answer!.text, source: "ai" }));
        scheduleFade();
        await noteDemoOnce(g);
        return;
      }
      if (surfaceRef.current !== surf0) {
        // The AI's own validated proposal moved the page (e.g. opened a stay): the route itself is the outcome.
        await say(en() ? "The page changed — ask about this stay's rooms or facilities." : "Page badal gaya — is stay ke rooms ya facilities ke baare mein poochiye.", gen, "note");
        return;
      }
      // G-REBIND — an explicit turn error from the controller is reported as such (never a silent stall).
      const terr = getLastTurnError();
      if (terr && terr.at >= t0) {
        if (terr.code === "stale") { await say(en() ? "The page changed while I was checking — please ask again." : "Check karte waqt page badal gaya — kripya dobara poochiye.", gen, "note"); return; }
        if (terr.code === "budget_exceeded") { await say(en() ? "Teddy's AI limit is reached for now — please browse the list yourself or try later." : "Abhi Teddy ki AI limit poori ho gayi — list khud dekhiye ya baad mein try kariye.", gen, "note"); return; }
        if (terr.code === "timeout") { await say(en() ? "That took too long — please ask again." : "Isme bahut der lagi — kripya dobara poochiye.", gen, "note"); return; }
      }
      const st = conv ? conv.getState() : "DISCONNECTED";
      if (st === "ERROR" || st === "OFFLINE") {
        await say(en() ? "The AI couldn't answer right now — please try again, or browse the list yourself." : "AI abhi jawab nahi de paaya — dobara try kariye, ya list khud dekhiye.", gen, "note");
        return;
      }
      await sleep(LIVE_POLL_MS);
    }
    await say(en() ? "No verified answer arrived — I won't guess." : "Verified jawab nahi aaya — main andaza nahi lagaunga.", gen, "note");
  }, [liveSubmitText, navigateToCity, noteDemoOnce, plannerContext, say, scheduleFade, showCaption, speakChunk, publicAdmission, getLastTurnError, ensureCustomerBearer]);

  // ---- one user turn ----------------------------------------------------------
  const handleUserText = useCallback(async (raw: string, fromVoice = false, voiceSource: SttResult["source"] = "browser") => {
    const text = String(raw || "").slice(0, MAX_INPUT).trim();
    if (!text || !activeRef.current) return;
    const gen = ++genRef.current;
    turnFromVoiceRef.current = fromVoice;
    clearTimers();
    cancelSpeech();
    stopListening();
    setStandby(false);
    setBusy(true);
    setHadTurn(true);
    announcedCountRef.current = null;
    try {
      showCaption({ who: "you", text });
      setLog((l) => appendEntry(l, fromVoice ? { who: "you", text, modality: "voice", voiceSource } : { who: "you", text, modality: "typed" }));
      await sleep(Math.min(1400, 500 + text.length * 18));
      if (gen !== genRef.current) return;
      // LIVE controller mode: typed AND reviewed-voice turns both go to the ORIGINAL controller.
      // The scripted planner below is never used as a reply in this mode.
      if (liveRef.current) {
        await runLiveTurn(text, gen);
        if (gen === genRef.current) { setBusy(false); armSilence(gen); }
        return;
      }
      // PRODUCT-02 — founder-only REAL AI TEXT: TYPED turns only (voice stays scripted), shown as
      // captions and never spoken. Any failure falls back to the scripted Buddy below.
      const founderNow = founderRef.current;
      if (founderNow.active && !fromVoice) {
        const r = await founderNow.ask(text);
        if (gen !== genRef.current) return;
        if (r.ok) {
          for (const c of captionChunks(r.text, CAPTION_CHUNK)) {
            if (gen !== genRef.current) return;
            setStandby(false);
            showCaption({ who: "buddy", text: c, ai: true });
            await sleep(Math.max(1600, c.length * 45));
          }
          if (gen !== genRef.current) return;
          scheduleFade();
          setBusy(false);
          armSilence(gen);
          return;
        }
        if (!(await say(langRef.current === "en" ? "Real AI is unavailable right now — Buddy will answer instead." : "Real AI abhi available nahi hai — Buddy jawab dega.", gen, "note"))) return;
      }
      // ONE shared core for typed AND voice turns (scripted reasoning seam; provider disabled).
      const { parsed, plan } = REASONING.plan({ text, context: plannerContext(), slots: slotsRef.current, cities: CITIES, lang: langRef.current });
      langRef.current = parsed.lang;
      slotsRef.current = plan.slots;
      try { runtime?.beginTurn(text); } catch { /* no-op */ }
      for (const step of plan.steps) {
        if (gen !== genRef.current) return;
        if (step.kind === "say") { if (!(await say(step.text, gen))) return; continue; }
        if (step.kind === "end") { endSession(); return; }
        if (step.kind === "navigate_hotels") {
          const ready = await navigateToCity(gen, step.city);
          if (ready === "nohref") continue;
          if (gen !== genRef.current) return;
          if (!ready) { await say(langRef.current === "en" ? "The stays didn't load yet — please try again." : "Stays abhi load nahi hue — dobara try kariye.", gen); continue; }
          if (plan.deferred) {
            const d: Record<string, unknown> = { op: "APPLY_HOTEL_REFINEMENT" };
            if (plan.deferred.maxPrice != null) d.maxPrice = plan.deferred.maxPrice;
            if (plan.deferred.parking) d.parking = true;
            await applyRefinement(gen, d as LiveAiOperation);
          } else {
            await announceResults(gen);
          }
          continue;
        }
        // typed operation
        const o = step.op;
        if (step.purpose === "refine") { await applyRefinement(gen, o); continue; }
        const res = execOp(o);
        if (!res.ok) { await say(formatRefusal(langRef.current, res.status), gen); continue; }
        if (step.purpose === "results" && res.results) { announcedCountRef.current = res.results.length; if (await say(formatResults(langRef.current, res.results, plannerContext().listDestination, { filtered: listFiltered() }), gen)) await noteDemoOnce(gen); }
        else if (step.purpose === "compare" && res.comparison) { if (await say(formatCompare(langRef.current, res.comparison.rows, res.comparison.cheapestPosition, res.comparison.topRatedPosition), gen)) await noteDemoOnce(gen); }
        else if (step.purpose === "facts" && res.facts && plan.factTopic) { if (await say(formatFact(langRef.current, plan.factTopic, res.facts[plan.factTopic], res.facts.hotel?.name ?? null), gen)) await noteDemoOnce(gen); }
        else if (step.purpose === "rooms" && res.facts) { if (await say(formatRooms(langRef.current, res.facts.roomTypes, res.facts.hotel?.name ?? null), gen)) await noteDemoOnce(gen); }
        else if (step.purpose === "section") await say(langRef.current === "en" ? "Showing the rooms and prices on this page." : "Is page par rooms aur prices dikha raha hoon.", gen);
        else if (step.purpose === "open" && res.resolvedHotelId) {
          const id = res.resolvedHotelId;
          expectNavRef.current = { gen, match: (p) => p === `/hotels/${encodeURIComponent(id)}` || p === `/hotels/${id}` };
          const nm = (res.companion?.speech || "").replace(/^Opening\s+/, "").replace(/\.$/, "");
          await say(langRef.current === "en" ? `Opening ${nm}. Ask about rooms, breakfast or parking.` : `${nm} khol raha hoon. Rooms, breakfast ya parking ke baare mein poochiye.`, gen);
        }
      }
      if (gen !== genRef.current) return;
      // A follow-up about narrowing / opening options is incoherent after "none listed" or a single
      // stay (whose caption already says how to open it) — skip it then.
      const fewAnnounced = announcedCountRef.current != null && announcedCountRef.current <= 1;
      if (plan.followUp && !fewAnnounced) { if (!(await say(plan.followUp, gen))) return; }
      if (gen !== genRef.current) return;
      setBusy(false);
      // Two-way voice: after a VOICE turn, re-open listening once (visible state).
      // A browser that needs a fresh tap refuses silently → "Tap to talk".
      if (fromVoice) continueListening(gen, "turn");
      armSilence(gen);
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }, [announceResults, applyRefinement, armSilence, cancelSpeech, clearTimers, continueListening, endSession, execOp, navigateToCity, plannerContext, runLiveTurn, runtime, say, scheduleFade, showCaption, stopListening]);
  handleUserTextRef.current = handleUserText;

  // ---- activation / end ------------------------------------------------------
  // The activation tap is the consent gesture. Everything that needs the gesture
  // (runtime activation, recognition start → browser permission prompt) runs
  // SYNCHRONOUSLY here, before any await.
  const startSession = useCallback(() => {
    if (activeRef.current) return;
    activate();               // existing Live-AI runtime activation (explicit user gesture)
    activeRef.current = true;
    followUpUsedRef.current = false;
    slotsRef.current = emptySlots();
    langRef.current = "hinglish";
    turnFromVoiceRef.current = false;
    setStandby(false);
    setOptionsOpen(false);
    demoNoteShownRef.current = false;
    setBuddyEngaged(true);   // R2 — no page tour auto-fires over an active Buddy session
    setLog([]);
    setReview(null);
    const gen = ++genRef.current;
    seqRef.current = Promise.resolve();
    // LIVE: activation never opens the mic (original contract: mic only on its own explicit gesture).
    const listeningNow = liveRef.current ? false : micBlockedRef.current ? false : startRecognition(gen, "gesture");
    const typedOnlyPreview = isTextOnlyPreview();
    const io = voiceIoNow();
    if (typedOnlyPreview) { focusInputRef.current = true; setTyping(true); } // typed preview: the keyboard IS the input (same tap)
    else if (io.stt === "off") { focusInputRef.current = true; setTyping(true); } // voice switched off in this build: typed fallback
    else if (io.stt === "provider") { focusInputRef.current = true; setTyping(true); } // live: typed first, mic on the next explicit tap
    seqRef.current = (async () => {
      const ok = await say(greetingFor(surfaceRef.current, langRef.current), gen);
      if (!ok) return;
      if (typedOnlyPreview) {
        await say(TYPED_PREVIEW_NOTE[langRef.current], gen, "note");
      } else if (io.stt === "provider") {
        await say(LIVE_VOICE_NOTE[langRef.current], gen, "note");
      } else if (io.stt === "simulated") {
        await say(DEMO_VOICE_NOTE[langRef.current], gen, "note");
      } else if (!getRecognition()) {
        await say(io.stt === "off" ? VOICE_OFF_NOTE[langRef.current] : (langRef.current === "en" ? "Voice input isn't available in this browser — tap Type to write." : "Is browser mein voice input nahi hai — Type dabakar likhiye."), gen, "note");
      } else if (listeningNow) {
        continueListening(gen, "greeting");
        if (recogRef.current && !listenNoteShownRef.current) {
          listenNoteShownRef.current = true;
          await say(langRef.current === "en" ? "Mic on — speak now. Your browser's speech service recognises it." : "Mic on hai — boliye. Voice aapke browser ki speech service samajhti hai.", gen, "note");
        }
      }
      if (gen === genRef.current) armSilence(gen);
    })();
  }, [activate, armSilence, continueListening, say, startRecognition]);

  const openTyping = useCallback(() => {
    stopListening();
    setReview(null);
    clearTimers();            // the guest chose to type: no silence nudge / standby while they write
    focusInputRef.current = true;
    setOptionsOpen(false);
    setTyping(true);
  }, [clearTimers, stopListening]);

  // The ONE primary control. Synchronous on purpose (recognition must start in the tap).
  const onPrimary = useCallback(() => {
    if (!activeRef.current) return;
    setOptionsOpen(false);
    if (listening) { stopListening(); armSilence(genRef.current); return; }   // stop listening only
    const SR = getRecognition();
    const sttNow = voiceIoNow().stt;
    if ((!SR && sttNow !== "simulated" && sttNow !== "provider") || micBlocked) { openTyping(); return; } // honest typed path
    clearTimers();
    cancelSpeech();                                                           // barge-in
    const gen = ++genRef.current;
    const wasStandby = standby;
    setStandby(false);
    const ok = startRecognition(gen, "gesture");
    if (ok && wasStandby) {
      void (async () => { if (await say(langRef.current === "en" ? "I'm listening." : "Boliye, main sun raha hoon.", gen)) armSilence(gen); })();
    } else if (ok) {
      armSilence(gen);
    }
  }, [armSilence, cancelSpeech, clearTimers, listening, micBlocked, openTyping, say, standby, startRecognition, stopListening]);

  const retryMic = useCallback(() => {
    setMicBlocked(false);
    micBlockedRef.current = false;
    setOptionsOpen(false);
    clearTimers();
    cancelSpeech();
    const gen = ++genRef.current;
    if (startRecognition(gen, "gesture")) armSilence(gen);
  }, [armSilence, cancelSpeech, clearTimers, startRecognition]);

  // ---- integrated voice: simulated mic, review / confirm, stop -----------------
  /** A voice transcript is NEVER acted on directly: it opens the review card with the verbatim text. */
  const openReview = useCallback((result: SttResult) => {
    genRef.current += 1;      // the review owns the turn: older captions / timers are superseded
    clearTimers();
    cancelSpeech();
    stopListening();
    setTyping(false);
    setStandby(false);
    setReview({ result, draft: result.transcript, confirmed: [] });
  }, [cancelSpeech, clearTimers, stopListening]);
  openReviewRef.current = openReview;

  const sttFailed = useCallback((error: SttFailure, gen: number) => {
    if (error === "cancelled") { armSilence(gen); return; }
    const en = langRef.current === "en";
    const denied = error === "permission-denied" || error === "permission-dismissed";
    if (denied) { setMicBlocked(true); micBlockedRef.current = true; }
    const text = denied
      ? (en ? "Microphone permission wasn't given — tap Type to write instead." : "Mic permission nahi mili — Type dabakar likh sakte hain.")
      : error === "no-speech"
        ? (en ? "I didn't hear anything (simulated) — pick a phrase again, or type." : "Kuch sunai nahi diya (simulated) — phrase phir chuniye, ya type kariye.")
        : (en ? "Voice didn't work this time (simulated error) — tap the mic to retry, or type." : "Voice abhi nahi chala (simulated error) — mic dabakar phir try kariye, ya type kariye.");
    void sayAfter(text, gen).then(() => { if (gen === genRef.current) armSilence(gen); });
  }, [armSilence, sayAfter]);

  /** Simulated recognition of one sample phrase (no microphone, no audio, cancellable). */
  const simulateUtterance = useCallback(async (u: SimulatedUtterance) => {
    if (!activeRef.current) return;
    const gen = genRef.current;
    clearTimers();
    cancelSpeech();
    const prev = simAbortRef.current;
    if (prev) { try { prev.abort(); } catch { /* no-op */ } }
    const ctl = new AbortController();
    simAbortRef.current = ctl;
    setVoicePanel("hearing");
    setListening(true);
    const out = await SIM_STT.recognize(u, ctl.signal);
    if (simAbortRef.current !== ctl || ctl.signal.aborted) return; // cancelled / superseded
    simAbortRef.current = null;
    if (gen !== genRef.current) return;
    if (out.ok) { openReview(out.result); return; }
    stopListening();
    sttFailed(out.error, gen);
  }, [cancelSpeech, clearTimers, openReview, stopListening, sttFailed]);

  const answerConsent = useCallback((allow: boolean) => {
    const gen = genRef.current;
    if (!allow) {
      setMicBlocked(true);
      micBlockedRef.current = true;
      openTyping();           // honest typed fallback (closes the panel)
      void sayAfter(langRef.current === "en" ? "No problem — no microphone. Type below instead." : "Theek hai — mic nahi. Neeche type kariye.", gen);
      return;
    }
    simConsentRef.current = true;
    setVoicePanel("listening");
    setListening(true);
    armSilence(gen);
  }, [armSilence, openTyping, sayAfter]);

  const cancelVoice = useCallback(() => {
    stopListening();
    armSilence(genRef.current);
  }, [armSilence, stopListening]);

  const sendReview = useCallback(() => {
    const r = reviewRef.current;
    if (!r) return;
    if (!reviewTranscript(r.result, r.draft, r.confirmed, CITIES, langRef.current).canSend) return;
    setReview(null);
    void handleUserTextRef.current(r.draft, true, r.result.source); // the SAME shared turn path as typing
  }, []);

  const rerecord = useCallback(() => {
    setReview(null);
    clearTimers();
    const gen = ++genRef.current;
    startRecognition(gen, "gesture");   // synchronous inside the tap
  }, [clearTimers, startRecognition]);

  const cancelReview = useCallback(() => {
    setReview(null);
    armSilence(genRef.current);
  }, [armSilence]);

  const toggleConfirm = useCallback((key: CriticalKey) => {
    setReview((r) => (r ? { ...r, confirmed: r.confirmed.includes(key) ? r.confirmed.filter((k) => k !== key) : r.confirmed.concat([key]) } : r));
  }, []);

  /** Explicit Stop: cancel speech, recognition, pending verification and the in-flight turn. */
  const stopNow = useCallback(() => {
    const gen = ++genRef.current;
    const hadLiveMic = liveMicRef.current;
    clearTimers();
    cancelSpeech();
    stopListening();
    // LIVE: Stop also interrupts the ORIGINAL controller's turn (inert-ing late answers); never auto-restarts.
    if (liveRef.current && !hadLiveMic) { try { bargeInRef.current(); } catch { /* no-op */ } }
    setBusy(false);
    void say(langRef.current === "en" ? "Stopped." : "Ruk gaya.", gen, "note").then((ok) => { if (ok) armSilence(gen); });
  }, [armSilence, cancelSpeech, clearTimers, say, stopListening]);

  // ---- route epoch: a foreign navigation cancels pending work ---------------
  useEffect(() => {
    const exp = expectNavRef.current;
    if (exp && exp.gen === genRef.current && exp.match(pathname)) {
      expectNavRef.current = null; // the navigation Buddy itself requested — keep going
      return;
    }
    if (!activeRef.current) return;
    genRef.current += 1;           // stale: cancel in-flight verification / speech / recognition
    expectNavRef.current = null;
    clearTimers();
    cancelSpeech();
    stopListening();
    setBusy(false);
    if (surfaceForPath(pathname) !== "other") {
      showCaption(null);
      setOptionsOpen(false);
      setTyping(false);
      setReview(null);
      setStandby(true);            // quiet: the guest navigated themselves; no re-greeting
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Page hidden → stop speaking / listening (never continue in the background).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        genRef.current += 1; clearTimers(); cancelSpeech(); stopListening(); setBusy(false);
        if (activeRef.current) { setOptionsOpen(false); setStandby(true); }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cancelSpeech, clearTimers, stopListening]);

  const reviewOpen = review !== null;
  // Keyboard-aware placement while typing (visual viewport shrinks under the OSK).
  useEffect(() => {
    if (!(typing || reviewOpen) || typeof window === "undefined" || !window.visualViewport) { setKbOffset(0); return; }
    const vv = window.visualViewport;
    const apply = () => setKbOffset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); };
  }, [typing, reviewOpen]);

  useEffect(() => {
    if (typing && focusInputRef.current) { focusInputRef.current = false; try { inputRef.current?.focus(); } catch { /* no-op */ } }
  }, [typing]);

  // Escape: stop listening / speech, close the options or the typed box (keyboard users).
  useEffect(() => {
    if (!activated) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (listening) stopListening();
      cancelSpeech();
      setOptionsOpen(false);
      if (typing) setTyping(false);
      setVoicePanel(null);
      setReview(null);
      setLogOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activated, cancelSpeech, listening, stopListening, typing]);

  // LIVE — mediate raw microphone transcripts at the ORIGINAL controller's submitText boundary:
  // a final transcript from the provider's media adapter opens the review card instead of
  // becoming a turn (deferred one task so capture teardown never runs inside the media handler).
  useEffect(() => {
    if (!live || !conversation) return;
    const b = installTranscriptReview(conversation, (text) => {
      const t = String(text || "").slice(0, MAX_INPUT);
      if (!t.trim()) return;
      window.setTimeout(() => { openReviewRef.current({ transcript: t, confidence: 0, alternatives: [], source: "provider" }); }, 0);
    });
    bridgeRef.current = b;
    return () => { b.uninstall(); if (bridgeRef.current === b) bridgeRef.current = null; };
  }, [live, conversation]);

  // R2 — a running page tour owns the screen: Buddy steps aside (and goes quiet) until it ends.
  useEffect(() => {
    setTourActiveState(getActiveTour());
    return subscribeTour((k) => {
      setTourActiveState(k);
      if (k && activeRef.current) { genRef.current += 1; clearTimers(); cancelSpeech(); stopListening(); setBusy(false); setOptionsOpen(false); setStandby(true); }
    });
  }, [cancelSpeech, clearTimers, stopListening]);

  // R2 watchdog — a tour flag with NO tour/story overlay in the DOM for ~2 s is stale (e.g. a tour
  // engine that never started): Buddy comes back instead of staying hidden.
  useEffect(() => {
    if (!tourActive || typeof window === "undefined") return;
    let misses = 0;
    const id = window.setInterval(() => {
      const shown = tourOverlayPresent();
      misses = shown ? 0 : misses + 1;
      if (misses >= 5) setTourActiveState(null);
    }, 400);
    return () => window.clearInterval(id);
  }, [tourActive]);

  // LIVE — the original controller failed while it owned the mic: release + offer typing.
  useEffect(() => {
    if (!live || !liveMicRef.current || orbState !== "error") return;
    liveMicRef.current = false;
    setListening(false);
    setVoicePanel(null);
    const gen = ++genRef.current;
    void say(langRef.current === "en" ? "The live mic couldn't start — you can type instead." : "Live mic start nahi hua — aap type kar sakte hain.", gen, "note").then(() => { if (gen === genRef.current) openTyping(); });
  }, [live, orbState, openTyping, say]);

  // G-TTS — the controller voices a verified answer ONLY while voice output is on (muted ⇒ no approval, no TTS).
  useEffect(() => { if (live) { try { setVoiceOutput(!muted); } catch { /* no-op */ } } }, [live, muted, setVoiceOutput]);

  // LIVE — mute also silences the controller's own answer audio (barge-in flushes playback).
  useEffect(() => {
    if (live && muted && orbState === "speaking") { try { bargeInRef.current(); } catch { /* no-op */ } }
  }, [live, muted, orbState]);

  // R2 — unmount ONLY (empty deps): an unmounted Buddy is no longer engaged.
  useEffect(() => () => { setBuddyEngaged(false); }, []);

  // Unmount: never leave speech/recognition/timers running.
  useEffect(() => () => {
    genRef.current += 1; clearTimers(); cancelSpeech(); stopListening();
    if (fadeTimerRef.current != null) { try { window.clearTimeout(fadeTimerRef.current); } catch { /* no-op */ } }
  }, [cancelSpeech, clearTimers, stopListening]);

  // ---- tiny draggable mascot: local preference + placement --------------------
  const [prefs, setPrefs] = useState<BuddyPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [vp, setVp] = useState<{ w: number; h: number } | null>(null);
  const [insets, setInsets] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Runtime-only placement state (never persisted): parked = no clear mascot spot right now, so
  // Buddy waits as a slim edge tab; tab = where the edge tab sits (null = nowhere clear: fail closed).
  const [parked, setParked] = useState(false);
  const [tab, setTab] = useState<{ side: "left" | "right"; y: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const forceShowRef = useRef(false);
  const optionsOpenRef = useRef(false);
  optionsOpenRef.current = optionsOpen;
  const [dragging, setDragging] = useState(false);
  const [bump, setBump] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mascotFocus, setMascotFocus] = useState(false);
  const insetProbeRef = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const prefsRef = useRef<BuddyPrefs>(DEFAULT_PREFS);
  prefsRef.current = prefs;

  const updatePrefs = useCallback((patch: Partial<BuddyPrefs>) => {
    setPrefs((p) => { const n = { ...p, ...patch }; writePrefs(n); return n; });
  }, []);

  // Read the device-local preference once on the client (SSR renders defaults).
  useEffect(() => { setPrefs(readPrefs()); setPrefsLoaded(true); }, []);

  // Viewport + safe-area insets (read from our OWN probe element, never the page DOM).
  useEffect(() => {
    const measure = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      const el = insetProbeRef.current;
      if (el) {
        const cs = window.getComputedStyle(el);
        const n = (v: string) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
        setInsets({ top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, []);

  // Protected bottom band per surface: mobile bottom dock (64) or dock + sticky
  // "Check availability" CTA on hotel detail (128); while typing, also the input row.
  const sidePanelOpen = !typing && (voicePanel !== null || review !== null); // voice panel / review card use the same bottom band
  const reservedBottom = (vp && vp.w < 1024 ? (surface === "hotel-detail" ? 128 : 64) : 8) + (typing ? (kbOffset > 0 ? kbOffset : 0) + 64 : 0)
    + (sidePanelOpen ? (kbOffset > 0 ? kbOffset : 0) + Math.max(64, panelH) + 8 : 0);

  // The conversation view always shows the newest turn.
  useEffect(() => {
    if (!logOpen) return;
    const el = logListRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logOpen, log]);

  // Measure the voice panel / review card so Buddy and captions never sit on it.
  useEffect(() => {
    if (!sidePanelOpen) { setPanelH(0); return; }
    const el = bottomPanelRef.current;
    if (!el) return;
    const apply = () => setPanelH(Math.round(el.getBoundingClientRect().height));
    apply();
    let ro: ResizeObserver | null = null;
    try { if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(apply); ro.observe(el); } } catch { ro = null; }
    return () => { if (ro) ro.disconnect(); };
  }, [sidePanelOpen, voicePanel, review]);
  // Protected top band: the desktop navbar is fixed above Buddy's layer (z ~1100) — a mascot
  // dragged under it could not be grabbed again, so it can never go there.
  const reservedTop = vp && vp.w >= 1024 ? 96 : 0;
  const box = useCallback((): SafeBox | null => (vp ? safeBox(vp.w, vp.h, { ...insets, top: insets.top + reservedTop }, reservedBottom) : null), [insets, reservedBottom, reservedTop, vp]);

  // Footprint that must stay clear: the mascot, plus its options badge whenever the badge shows.
  const showBadgeRef = useRef(false);
  const clearSpot = useCallback((p: { x: number; y: number }, b: SafeBox): { x: number; y: number } | null => {
    if (!vp) return p;
    const probe = makePageProbe(rootRef.current, vp.w, vp.h);
    const r = planPlacement(p, b, vp.w, showBadgeRef.current, probe.isClear);
    return r.kind === "mascot" ? { x: r.x, y: r.y } : null;
  }, [vp]);

  // Placement: the remembered spot (or default bottom-right) when it is clear of every native
  // control; otherwise the nearest clear spot (runtime only — the saved preference is NOT
  // rewritten, so the remembered spot comes back wherever it is clear again); otherwise a slim
  // parked edge tab; otherwise nothing (fail closed — native actions always win).
  const placeNow = useCallback((reason: "reflow" | "route" | "scroll" | "observe") => {
    if (!prefsLoaded || !vp) return;
    if (dragRef.current && dragRef.current.moved) return;
    if ((reason === "scroll" || reason === "observe") && optionsOpenRef.current) return; // keep an open menu anchored
    const b = box();
    if (!b) return;
    const d = denormalize(prefs.nx, prefs.ny, b);
    const desired = clampToBox(d.x, d.y, b);
    const want = { x: desired.x, y: desired.y };
    const probe = makePageProbe(rootRef.current, vp.w, vp.h);
    if (prefs.hidden) {
      setPos(want);
      setParked(false);
      setTab(planTab(want.y, want.x + MASCOT_HIT / 2 < vp.w / 2, b, vp.w, probe.isClear));
      return;
    }
    if (forceShowRef.current) {
      if (reason === "scroll" || reason === "observe") return; // the guest asked to see Buddy here
      forceShowRef.current = false;
    }
    const r = planPlacement(want, b, vp.w, showBadgeRef.current, probe.isClear);
    if (r.kind === "mascot") { setPos({ x: r.x, y: r.y }); setParked(false); setTab(null); }
    else { setPos(want); setParked(true); setTab(r.kind === "parked" ? { side: r.side, y: r.y } : null); }
  }, [box, prefs.hidden, prefs.nx, prefs.ny, prefsLoaded, vp]);
  const placeRef = useRef(placeNow);
  placeRef.current = placeNow;

  // Reconcile on resize / rotation / keyboard / prefs load / hide-restore.
  useEffect(() => {
    if (dragging) return;
    placeRef.current("reflow");
  }, [box, dragging, prefs.nx, prefs.ny, prefs.hidden, prefsLoaded]);

  // Route change (and first mount): page content arrives asynchronously, so re-check shortly after.
  // The mascot stays invisible until its first settled placement (never flashes over a control).
  useEffect(() => {
    const t1 = window.setTimeout(() => { placeRef.current("route"); setRevealed(true); }, 350);
    const t2 = window.setTimeout(() => placeRef.current("route"), 1200);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [pathname]);

  // Page scroll settles / page layout changes → re-check (debounced, passive, geometry only).
  useEffect(() => {
    let t: number | null = null;
    const debounced = (reason: "scroll" | "observe", ms: number) => () => {
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => { t = null; placeRef.current(reason); }, ms);
    };
    const onScroll = debounced("scroll", 220);
    window.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | null = null;
    try { if (typeof ResizeObserver !== "undefined" && document.body) { ro = new ResizeObserver(debounced("observe", 300)); ro.observe(document.body); } } catch { ro = null; }
    return () => { window.removeEventListener("scroll", onScroll); if (ro) ro.disconnect(); if (t != null) window.clearTimeout(t); };
  }, []);

  const savePosition = useCallback((x: number, y: number) => {
    const b = box();
    if (!b) return;
    const { nx, ny } = normalize(x, y, b);
    updatePrefs({ nx, ny });
  }, [box, updatePrefs]);

  const flashBump = useCallback(() => { setBump(true); window.setTimeout(() => setBump(false), 260); }, []);

  // ---- pointer: tap vs drag (a drag NEVER activates the microphone) ------------
  const onMascotPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!pos) return;
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
    if (longPressRef.current != null) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {   // long-press → options (no mic)
      longPressRef.current = null;
      const d = dragRef.current;
      if (d && !d.moved) { suppressClickRef.current = true; setOptionsOpen(true); setPickerOpen(false); }
    }, 550);
  };
  const onMascotPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      if (longPressRef.current != null) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
      setDragging(true);
      setOptionsOpen(false);
    }
    const b = box();
    if (!b) return;
    const c = clampToBox(d.ox + dx, d.oy + dy, b);
    setPos({ x: c.x, y: c.y });
    if (c.clamped && !bump) flashBump();
  };
  const endPointer = (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (longPressRef.current != null) { window.clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) {
      suppressClickRef.current = true; // the click that follows a drag must not start a conversation
      setDragging(false);
      const b = box();
      if (b) {
        const c = clampToBox(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy), b);
        const s = clearSpot({ x: c.x, y: c.y }, b) || { x: c.x, y: c.y }; // dropped on a native control → nearest clear spot
        if (s.x !== c.x || s.y !== c.y) flashBump();
        setPos(s); savePosition(s.x, s.y);
      }
    } else if (cancelled) {
      suppressClickRef.current = false;
    }
  };
  const onMascotClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (optionsOpen) { setOptionsOpen(false); setPickerOpen(false); }
    if (!activated) startSession(); // consent gesture: greeting + same-tap listening (C02)
    else onPrimary();
  };
  const onMascotKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const d = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
    if (!d || !pos) return;
    e.preventDefault();
    const b = box();
    if (!b) return;
    // Step in the pressed direction, skipping spots that would cover a native control.
    const probe = vp ? makePageProbe(rootRef.current, vp.w, vp.h) : null;
    const rectsAt = (q: { x: number; y: number }) => (showBadgeRef.current && vp ? [mascotRectAt(q), badgeHitRectAt(q, vp.w)] : [mascotRectAt(q)]);
    let c = clampToBox(pos.x + d[0], pos.y + d[1], b);
    for (let i = 0; probe && i < 12 && !probe.isClear(rectsAt(c)); i++) {
      const n = clampToBox(c.x + d[0], c.y + d[1], b);
      if (n.x === c.x && n.y === c.y) break;
      c = n;
    }
    if (probe && !probe.isClear(rectsAt(c))) { flashBump(); return; } // nothing clear that way: stay put
    setPos({ x: c.x, y: c.y });
    savePosition(c.x, c.y);
    if (c.clamped) flashBump();
  };

  const hideBuddy = useCallback(() => {
    if (activeRef.current) endSession(); // never leave a hidden listener running
    setOptionsOpen(false);
    setPickerOpen(false);
    updatePrefs({ hidden: true });
  }, [endSession, updatePrefs]);

  const resetPosition = useCallback(() => {
    updatePrefs({ nx: null, ny: null });
    setOptionsOpen(false);
  }, [updatePrefs]);

  // A press anywhere outside Buddy closes the options (no preventDefault — the same tap still
  // reaches the native control underneath, so an open menu never costs the guest a tap).
  useEffect(() => {
    if (!optionsOpen) return;
    const onDown = (e: PointerEvent) => {
      const r = rootRef.current;
      const t = e.target as Node | null;
      if (r && t && r.contains(t)) return;
      setOptionsOpen(false);
      setPickerOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [optionsOpen]);

  // Escape also closes the picker / options (keyboard users).
  useEffect(() => {
    if (!optionsOpen && !pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPickerOpen(false); setOptionsOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [optionsOpen, pickerOpen]);

  const submitDraft = () => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    setOptionsOpen(false);
    setPickerOpen(false);
    void handleUserText(t, false);
  };

  if (surface === "other" || tourActive) return null;

  const en = langRef.current === "en";
  const whoLabel = (w: Who) => (w === "buddy" ? "Buddy" : w === "you" ? (en ? "You" : "Aap") : "Note");
  const mascot = mascotById(prefs.buddyId);
  const isTemp = mascot.final === null;
  const textOnlyPreview = isTextOnlyPreview();
  const typedOnly = voiceMissing || micBlocked || textOnlyPreview;
  const state = !activated ? "idle" : standby ? "standby" : listening ? "listening" : speaking ? "speaking" : busy ? "busy" : typedOnly ? "type" : "ready";
  const stateText = {
    idle: "tap to talk",
    standby: en ? "resting — tap to continue" : "ruka hai — tap to continue",
    listening: en ? "listening — tap to stop" : "sun raha hoon — tap to stop",
    speaking: en ? "speaking — tap to interrupt and talk" : "bol raha hoon — tap karke boliye",
    busy: en ? "working — tap to interrupt" : "dekh raha hoon — tap karke boliye",
    type: textOnlyPreview
      ? (en ? "typed preview — tap to type" : "typed preview — tap karke type kariye")
      : (en ? "voice unavailable — tap to type" : "voice nahi — tap karke type kariye"),
    ready: en ? "tap to talk" : "tap karke boliye",
  }[state];
  const mascotAria = `${mascot.name} Travel Buddy${isTemp ? " (temporary placeholder art)" : ""}, ${live ? "live AI preview" : "scripted preview"} — ${activated ? stateText : "Talk to StayBid"}. Drag or use arrow keys to move.`;
  const captionVisible = activated && caption && !standby && !optionsOpen && !logOpen && (prefs.captions || caption.who === "note"); // options / log yield the same spot
  const vw = vp?.w ?? 390;
  const vh = vp?.h ?? 844;
  const capW = Math.min(320, vw - 24);
  const anchorX = pos ? pos.x + MASCOT_HIT / 2 : vw - 12 - MASCOT_HIT / 2;
  const anchorTop = pos ? pos.y : vh - 120;
  // Captions / options open on whichever side of the mascot has more room, and never extend into
  // the protected top band (desktop navbar) or bottom band (dock / sticky CTA / typing row).
  const floatTop = insets.top + reservedTop + 8;
  const floatBottom = vh - Math.max(0, insets.bottom) - reservedBottom - 8;
  const spaceAbove = anchorTop - 10 - floatTop;
  const spaceBelow = floatBottom - (anchorTop + MASCOT_HIT + 10);
  const above = spaceAbove >= spaceBelow;
  const floatStyle = (w: number): React.CSSProperties => ({
    left: Math.round(Math.min(vw - 12 - w, Math.max(12, anchorX - w / 2))),
    width: w,
    ...(above
      ? { bottom: Math.round(vh - anchorTop + 10), maxHeight: Math.max(88, Math.round(spaceAbove)) }
      : { top: Math.round(anchorTop + MASCOT_HIT + 10), maxHeight: Math.max(88, Math.round(spaceBelow)) }),
  });
  const mascotStyle: React.CSSProperties | undefined = pos ? { left: pos.x, top: pos.y } : undefined;
  const moreOnLeft = pos ? pos.x + MASCOT_HIT / 2 > vw / 2 : true;
  const moreStyle: React.CSSProperties | undefined = pos ? { left: moreOnLeft ? pos.x - 34 : pos.x + MASCOT_HIT + 8, top: pos.y + (MASCOT_HIT - 26) / 2 } : undefined;
  const showMore = !prefs.hidden && (activated || mascotFocus || optionsOpen);
  showBadgeRef.current = showMore;
  const typeBottom = kbOffset > 0 ? kbOffset + 8 : (vp && vp.w < 1024 ? (surface === "hotel-detail" ? 128 : 64) : 16) + 8;
  const voiceIo = voiceIoNow();
  const lang: BuddyLang = en ? "en" : "hinglish";
  const reviewState = review ? reviewTranscript(review.result, review.draft, review.confirmed, CITIES, lang) : null;
  const pendingLabels = reviewState ? reviewState.pending.map((k) => criticalLabel(k, lang)).join(", ") : "";
  const simulatedTag = en
    ? "SIMULATED VOICE · demo · no microphone, no audio leaves this browser · not real AI"
    : "SIMULATED VOICE · demo · mic nahi, koi audio bahar nahi jaata · real AI nahi";
  const logWho = (e: ConversationEntry) => (e.who === "you"
    ? `${whoLabel("you")} · ${e.modality === "voice" ? (e.voiceSource === "simulated" ? "voice (simulated)" : "voice") : "typed"}`
    : e.who === "buddy" ? (e.source === "ai" ? "Buddy · AI" : live ? "Buddy" : "Buddy · demo") : "Note");
  const liveTag = en
    ? "LIVE AI MIC · your words are shown for review before anything is sent"
    : "LIVE AI MIC · bhejne se pehle aapke shabd review ke liye dikhte hain";
  // the ORIGINAL controller sits in IDLE once the mic session is connected (LISTENING only follows a
  // gateway turn.state), so read its state directly: CONNECTING ⇒ connecting, connected ⇒ listening.
  const convState = conversation ? conversation.getState() : null;
  const liveHear = orbState === "error" || convState === "ERROR"
    ? (en ? "The mic hit a problem." : "Mic mein dikkat aayi.")
    : convState === "IDLE" || convState === "LISTENING" || convState === "TRANSCRIBING"
      ? (en ? "Listening… speak now." : "Sun raha hoon… boliye.")
      : (en ? "Connecting the mic…" : "Mic connect ho raha hai…");

  return (
    <div ref={rootRef} className={`tb-root${surface === "hotel-detail" ? " tb-on-detail" : ""}`} data-travel-buddy-preview="1">
      <span ref={insetProbeRef} className="tb-inset-probe" aria-hidden="true" />
      <span className="tb-sr" aria-live="polite">
        {activated && caption ? `${whoLabel(caption.who)}: ${caption.text}` : ""}
      </span>

      {prefs.hidden || parked ? (
        tab && revealed ? (
          <button type="button" className={`tb-edge-tab${tab.side === "left" ? " on-left" : ""}${parked && !prefs.hidden ? " is-parked" : ""}`}
            aria-label={prefs.hidden ? "Show Travel Buddy" : "Show Travel Buddy (moved aside so the page's buttons stay tappable)"}
            style={{ top: tab.y }}
            onClick={() => {
              if (prefs.hidden) { updatePrefs({ hidden: false }); return; }
              forceShowRef.current = true; setParked(false); setTab(null); // the guest asked for Buddy here
            }}>
            <span aria-hidden="true" className="tb-edge-grip" />
          </button>
        ) : null
      ) : (
        <>
          <button type="button" className={`tb-mascot is-${state}${dragging ? " is-dragging" : ""}${bump ? " is-bump" : ""}${pos && revealed ? "" : " is-default"}`}
            style={mascotStyle} aria-label={mascotAria} aria-pressed={activated ? listening : undefined}
            onPointerDown={onMascotPointerDown} onPointerMove={onMascotPointerMove}
            onPointerUp={(e) => endPointer(e, false)} onPointerCancel={(e) => endPointer(e, true)}
            onClick={onMascotClick} onKeyDown={onMascotKeyDown}
            onContextMenu={(e) => { e.preventDefault(); setOptionsOpen(true); setPickerOpen(false); }}
            onFocus={(e) => { let kb = false; try { kb = e.currentTarget.matches(":focus-visible"); } catch { /* no-op */ } if (kb) setMascotFocus(true); }}
            onBlur={() => window.setTimeout(() => setMascotFocus(false), 150)}>
            <span className="tb-ring" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="tb-sprite" src={mascot.final ? mascot.final.src : mascot.placeholder}
              srcSet={mascot.final ? `${mascot.final.src} 1x, ${mascot.final.src2x} 2x` : undefined}
              width={MASCOT_VISUAL} height={MASCOT_VISUAL} alt="" draggable={false} />
            {(state === "listening" || state === "speaking" || state === "busy") && (
              <span className="tb-wave-badge" aria-hidden="true"><i /><i /><i /></span>
            )}
          </button>
          {showMore && (
            <button type="button" className={`tb-more${optionsOpen ? " is-open" : ""}${pos && revealed ? "" : " is-default"}`} style={moreStyle}
              aria-label="Travel Buddy options: change buddy, captions, type, mute, hide, end"
              aria-expanded={optionsOpen} aria-controls="tb-options"
              onFocus={() => setMascotFocus(true)} onBlur={() => window.setTimeout(() => setMascotFocus(false), 150)}
              onClick={() => { setOptionsOpen((v) => !v); setPickerOpen(false); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" /></svg>
            </button>
          )}
        </>
      )}

      {captionVisible && caption && (
        <p className={`tb-caption tb-who-${caption.who}`} style={floatStyle(capW)}>
          <span className="tb-who">{whoLabel(caption.who)}{caption.ai ? " · Real AI" : caption.live ? " · AI" : caption.who === "buddy" && !live ? " · demo" : ""}:</span> {caption.text}
        </p>
      )}

      {typing && !standby && !prefs.hidden && (
        <div className="tb-type" style={{ bottom: typeBottom }}>
          <div className="tb-type-row">
            <input
              ref={inputRef}
              className="tb-input"
              type="text"
              inputMode="text"
              enterKeyHint="send"
              maxLength={MAX_INPUT}
              placeholder={en ? "Type where, budget, parking…" : "Kahan, budget, parking… type kariye"}
              aria-label="Type a message to Travel Buddy"
              value={draft}
              onChange={(e) => { clearTimers(); setDraft(e.target.value.slice(0, MAX_INPUT)); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitDraft(); } }}
            />
            {(busy || speaking) && (
              <button type="button" className="tb-stop" aria-label={en ? "Stop Buddy" : "Buddy ko roko"} onClick={stopNow}>Stop</button>
            )}
            <button type="button" className="tb-send" aria-label="Send" onClick={submitDraft} disabled={!draft.trim()}>Send</button>
            <button type="button" className="tb-close-type" aria-label="Close typing" onClick={() => setTyping(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
            </button>
          </div>
          {!hadTurn && (
            <div className="tb-examples" aria-label="Example phrases">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="tb-example" onClick={() => { void handleUserText(x, false); }}>{x}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {voicePanel && live && !typing && !review && !standby && !prefs.hidden && (
        <div className="tb-voice tb-voice-live" ref={bottomPanelRef} style={{ bottom: typeBottom }} role="group" aria-label="Live AI microphone">
          <p className="tb-panel-tag">{liveTag}</p>
          <div className="tb-panel-row">
            <p className="tb-panel-text" aria-live="polite">{liveHear}</p>
            <button type="button" className="tb-ghost" onClick={cancelVoice}>Stop</button>
          </div>
        </div>
      )}

      {voicePanel && !live && !typing && !review && !standby && !prefs.hidden && (
        <div className="tb-voice" ref={bottomPanelRef} style={{ bottom: typeBottom }} role="group" aria-label="Simulated voice input">
          <p className="tb-panel-tag">{simulatedTag}</p>
          {voicePanel === "consent" ? (
            <>
              <p className="tb-panel-text">{en ? "Use demo voice? This build only simulates the microphone — nothing is recorded or sent." : "Demo voice use karein? Yeh build sirf mic simulate karta hai — kuch record ya bheja nahi jaata."}</p>
              <div className="tb-panel-row">
                <button type="button" className="tb-send" onClick={() => answerConsent(true)}>{en ? "Allow demo mic" : "Demo mic allow karein"}</button>
                <button type="button" className="tb-ghost" onClick={() => answerConsent(false)}>{en ? "Not now" : "Abhi nahi"}</button>
              </div>
            </>
          ) : voicePanel === "hearing" ? (
            <div className="tb-panel-row">
              <p className="tb-panel-text" aria-live="polite">{en ? "Hearing… (simulated)" : "Sun raha hoon… (simulated)"}</p>
              <button type="button" className="tb-ghost" onClick={cancelVoice}>Cancel</button>
            </div>
          ) : (
            <>
              <p className="tb-panel-text">{en ? "Listening (simulated) — tap what you would say:" : "Sun raha hoon (simulated) — jo bolna hai woh tap kariye:"}</p>
              <div className="tb-examples tb-phrases" aria-label="Simulated phrases">
                {SIMULATED_PHRASES.map((ph) => (
                  <button key={ph.id} type="button" className="tb-example tb-phrase" onClick={() => { void simulateUtterance(ph); }}>{ph.said}</button>
                ))}
              </div>
              <div className="tb-panel-row">
                {SIMULATED_FAILURES.map((ph) => (
                  <button key={ph.id} type="button" className="tb-ghost tb-test" onClick={() => { void simulateUtterance(ph); }}>
                    {ph.fail === "no-speech" ? (en ? "Test: no speech" : "Test: awaaz nahi") : (en ? "Test: voice error" : "Test: voice error")}
                  </button>
                ))}
                <button type="button" className="tb-ghost" onClick={cancelVoice}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {review && reviewState && !standby && !prefs.hidden && (
        <div className="tb-review" ref={bottomPanelRef} style={{ bottom: typeBottom }} role="group" aria-label="Review what Buddy heard before sending">
          <p className="tb-panel-tag">
            {review.result.source === "simulated" ? "SIMULATED TRANSCRIPT · demo" : review.result.source === "provider" ? "MIC TRANSCRIPT" : "BROWSER TRANSCRIPT"}
            {en ? " · check or edit before sending" : " · bhejne se pehle check ya edit kariye"}
          </p>
          <div className="tb-type-row">
            <input
              className="tb-input-review"
              type="text"
              inputMode="text"
              enterKeyHint="send"
              maxLength={MAX_INPUT}
              aria-label="Edit what Buddy heard"
              value={review.draft}
              onChange={(e) => { const v = e.target.value.slice(0, MAX_INPUT); setReview((r) => (r ? { ...r, draft: v } : r)); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReview(); } }}
            />
            <button type="button" className="tb-send" aria-label="Send what Buddy heard" onClick={sendReview} disabled={!reviewState.canSend}>Send</button>
          </div>
          {reviewState.fields.length > 0 && (
            <ul className="tb-fields" aria-label="Important details">
              {reviewState.fields.map((f) => (
                <li key={f.key} className={`tb-field${f.flagged && !f.edited && !f.confirmed ? " is-pending" : ""}`}>
                  <span>{criticalLabel(f.key, lang)}: <b>{f.value}</b>{f.edited && f.heard ? <em>{en ? ` (heard ${f.heard})` : ` (suna: ${f.heard})`}</em> : null}</span>
                  {f.flagged && !f.edited ? (
                    <button type="button" className="tb-confirm" aria-pressed={f.confirmed} onClick={() => toggleConfirm(f.key)}>
                      {f.confirmed ? (en ? "Confirmed" : "Confirm hua") : (en ? "Confirm" : "Confirm kariye")}
                    </button>
                  ) : f.edited ? <span className="tb-edited">{en ? "edited by you" : "aapne badla"}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {reviewState.pending.length > 0 && (
            <p className="tb-panel-text tb-warn" role="status">
              {en
                ? `Not sure I heard right — please confirm ${pendingLabels} (or edit the text) before sending. Nothing is corrected automatically.`
                : `Shayad theek se nahi suna — bhejne se pehle ${pendingLabels} confirm kariye (ya text edit kariye). Kuch apne aap nahi badla jaata.`}
            </p>
          )}
          <div className="tb-panel-row">
            <button type="button" className="tb-ghost" onClick={rerecord}>{en ? "Speak again" : "Phir boliye"}</button>
            <button type="button" className="tb-ghost" onClick={cancelReview}>Cancel</button>
          </div>
        </div>
      )}

      {logOpen && !prefs.hidden && (
        <div className="tb-log" id="tb-log" role="region" aria-label="Conversation, typed and voice" style={floatStyle(Math.min(340, vw - 24))}>
          <div className="tb-log-head">
            <span>{en ? `Conversation · typed + voice · ${live ? "live AI" : "demo"}` : `Baatcheet · typed + voice · ${live ? "live AI" : "demo"}`}</span>
            <button type="button" className="tb-close-type" aria-label="Close conversation" onClick={() => setLogOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
            </button>
          </div>
          {log.length === 0 ? (
            <p className="tb-panel-text">{en ? "Nothing yet." : "Abhi kuch nahi."}</p>
          ) : (
            <ol className="tb-log-list" ref={logListRef}>
              {log.slice(-16).map((e) => (
                <li key={e.id} className={`tb-log-item tb-log-${e.who}`}><span className="tb-who">{logWho(e)}:</span> {e.text}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {optionsOpen && !prefs.hidden && (
        <div className="tb-options" id="tb-options" role="group" aria-label="Travel Buddy options" style={floatStyle(Math.min(318, vw - 24))}>
          {pickerOpen ? (
            <>
              <p className="tb-opt-title">Choose your Travel Buddy</p>
              <div className="tb-picker" role="radiogroup" aria-label="Choose your Travel Buddy">
                {MASCOTS.map((m) => (
                  <button key={m.id} type="button" role="radio" aria-checked={m.id === mascot.id} className={`tb-pick${m.id === mascot.id ? " is-on" : ""}`}
                    onClick={() => { updatePrefs({ buddyId: m.id }); setPickerOpen(false); setOptionsOpen(false); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.final ? m.final.src : m.placeholder}
                      srcSet={m.final ? `${m.final.src} ${m.final.width}w, ${m.final.src2x} ${m.final.width * 2}w` : undefined}
                      sizes={m.final ? "40px" : undefined}
                      width={40} height={40} alt="" draggable={false} />
                    <span>{m.name}</span>
                  </button>
                ))}
              </div>
              <p className="tb-disclose">{isTemp ? "Placeholder art only — final plush buddies are pending approval." : ""}</p>
            </>
          ) : (
            <>
              <div className="tb-opt-grid">
                <button type="button" className="tb-chip" onClick={() => setPickerOpen(true)}>Change buddy</button>
                <button type="button" className="tb-chip" aria-pressed={prefs.captions} onClick={() => { updatePrefs({ captions: !prefs.captions }); setOptionsOpen(false); }}>
                  {prefs.captions ? "Hide captions" : "Show captions"}
                </button>
                <button type="button" className="tb-chip" aria-pressed={typing}
                  onClick={() => { if (!activated) { setOptionsOpen(false); return; } if (typing) { setTyping(false); setOptionsOpen(false); } else openTyping(); }}
                  disabled={!activated} title={activated ? undefined : "Tap the buddy first"}>
                  {typing ? "Hide keyboard" : "Type instead"}
                </button>
                {!textOnlyPreview && (
                  <button type="button" className="tb-chip" aria-pressed={muted}
                    onClick={() => { setMuted((m) => { const n = !m; if (n) cancelSpeech(); return n; }); setOptionsOpen(false); }}>
                    {muted ? "Sound on" : "Mute voice"}
                  </button>
                )}
                {micBlocked && !voiceMissing && activated && (
                  <button type="button" className="tb-chip" onClick={retryMic}>Try mic again</button>
                )}
                {publicAdmission && signInNeeded && (
                  <button type="button" className="tb-chip" onClick={() => { setOptionsOpen(false); void import("@/lib/auth-intent").then((m) => m.redirectToSignIn(router, { route: pathname })).catch(() => { /* no-op */ }); }}>Sign in</button>
                )}
                {founder.available && (
                  <button type="button" className="tb-chip" aria-pressed={founder.active}
                    onClick={() => { founder.setActive(!founder.active); setOptionsOpen(false); }}>
                    {founder.active ? "Real AI text: on" : "Real AI text: off"}
                  </button>
                )}
                {activated && (
                  <button type="button" className="tb-chip" aria-expanded={logOpen} aria-controls="tb-log" onClick={() => { setLogOpen(true); setOptionsOpen(false); }}>Conversation</button>
                )}
                <button type="button" className="tb-chip" onClick={resetPosition}>Reset position</button>
                <button type="button" className="tb-chip" onClick={hideBuddy}>Hide Buddy</button>
                {activated && <button type="button" className="tb-chip tb-chip-end" onClick={() => { setOptionsOpen(false); endSession(); }}>End</button>}
              </div>
              <p className="tb-disclose">
                {founder.active
                  ? "Founder-only Real AI text: typed turns go to the StayBid staging AI; voice stays scripted. Never books, bids or pays."
                  : textOnlyPreview
                    ? "Typed scripted preview — not live AI; no microphone or voice. Typed words stay in this browser. Listings are StayBid demo inventory: prices and availability are not confirmed. Never books, bids or pays."
                    : `${live
                      ? "Live AI preview: typed words, and spoken words only after you review them, go to the StayBid AI controller; only its verified answers are shown. The microphone opens only when you tap the mic."
                      : `Scripted preview — not live AI. ${voiceIo.stt === "simulated" ? "Voice is SIMULATED: no microphone, no audio recorded or sent; sample phrases stand in for speech." : voiceIo.stt === "browser" ? "Voice uses your browser's speech service." : "Voice is off in this build."}${voiceIo.tts === "device" ? " Spoken replies use on-device voices only." : voiceIo.tts === "browser" ? " Spoken replies use your browser's voice." : voiceIo.tts === "simulated" ? " Spoken replies are simulated (no audio)." : ""} Typed words stay in this browser.`} Listings are StayBid demo inventory: prices and availability are not confirmed. Never books, bids or pays.`}
                {isTemp ? " Placeholder buddy art (final plush pending)." : ""}
              </p>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        .tb-root { position: fixed; inset: auto 0 0 0; z-index: 61; pointer-events: none; }
        .tb-inset-probe { position: fixed; top: 0; left: 0; width: 0; height: 0; visibility: hidden; pointer-events: none;
          padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
        .tb-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        .tb-mascot {
          pointer-events: auto; position: fixed; width: 52px; height: 52px; padding: 2px; border: 0; border-radius: 999px;
          background: transparent; cursor: grab; touch-action: none; -webkit-tap-highlight-color: transparent;
          -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
          filter: drop-shadow(0 4px 8px rgba(40, 28, 10, .28)); transition: transform .16s ease, left .2s ease, top .2s ease;
        }
        .tb-mascot.is-default { right: 12px; bottom: calc(76px + env(safe-area-inset-bottom, 0px)); visibility: hidden; } /* until first settled, collision-checked placement */
        .tb-mascot.is-dragging { cursor: grabbing; transform: scale(1.08); transition: none; }
        .tb-mascot.is-bump { transform: scale(.94); }
        .tb-mascot:focus-visible, .tb-more:focus-visible, .tb-edge-tab:focus-visible, .tb-chip:focus-visible, .tb-pick:focus-visible, .tb-send:focus-visible, .tb-example:focus-visible, .tb-close-type:focus-visible { outline: 2px solid #f2c650; outline-offset: 2px; }
        .tb-sprite { position: relative; display: block; width: 48px; height: 48px; pointer-events: none; }
        .tb-ring { position: absolute; inset: 0; border-radius: 999px; pointer-events: none; }
        .tb-mascot.is-listening .tb-ring { box-shadow: 0 0 0 3px rgba(242, 198, 80, .95); animation: tb-pulse 1.4s ease-out infinite; }
        .tb-mascot.is-speaking .tb-ring, .tb-mascot.is-busy .tb-ring { box-shadow: 0 0 0 2px rgba(242, 198, 80, .6); animation: tb-halo 1.8s ease-in-out infinite; }
        .tb-mascot.is-standby { opacity: .82; }
        .tb-wave-badge { position: absolute; left: -2px; bottom: -2px; display: inline-flex; align-items: center; gap: 2px; height: 16px; padding: 0 4px;
          border-radius: 999px; background: rgba(18, 14, 9, .86); pointer-events: none; }
        .tb-wave-badge i { display: block; width: 2px; height: 9px; border-radius: 2px; background: #f2c650; animation: tb-bar 1s ease-in-out infinite; }
        .tb-wave-badge i:nth-child(2) { animation-delay: .15s; } .tb-wave-badge i:nth-child(3) { animation-delay: .3s; }
        .tb-more {
          pointer-events: auto; position: fixed; width: 26px; height: 26px; border: 0; border-radius: 999px; padding: 0;
          background: rgba(18, 14, 9, .82); color: #f6e7bf; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,.25); -webkit-tap-highlight-color: transparent;
        }
        .tb-more.is-default { right: 70px; bottom: calc(89px + env(safe-area-inset-bottom, 0px)); visibility: hidden; }
        .tb-more::after { content: ""; position: absolute; inset: -9px; } /* 44×44 hit area, 26 px visual */
        .tb-more.is-open { background: #f2c650; color: #2a1e08; }
        .tb-more svg { width: 16px; height: 16px; } .tb-more circle { fill: currentColor; }
        .tb-edge-tab {
          pointer-events: auto; position: fixed; right: 0; top: 60%; width: 22px; height: 52px; border: 0; padding: 0;
          border-radius: 12px 0 0 12px; background: rgba(18, 14, 9, .55); cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: top .2s ease;
        }
        .tb-edge-tab::after { content: ""; position: absolute; inset: 0 0 0 -22px; } /* 44 px wide hit area, 22 px visual */
        .tb-edge-tab.on-left { right: auto; left: 0; border-radius: 0 12px 12px 0; }
        .tb-edge-tab.on-left::after { inset: 0 -22px 0 0; }
        .tb-edge-grip { width: 4px; height: 22px; border-radius: 2px; background: rgba(246, 231, 191, .9); }
        .tb-caption {
          pointer-events: none; position: fixed; margin: 0; padding: 6px 11px; border-radius: 10px; box-sizing: border-box;
          background: rgba(18, 14, 9, 0.8); color: #fff8e8; font-size: 14px; line-height: 1.35; font-weight: 560;
          text-align: center; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: tb-in .18s ease-out;
        }
        .tb-who { color: #f2c650; font-weight: 750; letter-spacing: .02em; }
        .tb-who-you .tb-who { color: #cfe3c8; }
        .tb-who-note .tb-who { color: #f5d3a3; }
        .tb-type { pointer-events: auto; position: fixed; left: 12px; right: 12px; max-width: 520px; margin: 0 auto; display: flex; flex-direction: column; gap: 6px; }
        .tb-type-row { display: flex; gap: 6px; padding: 4px; border-radius: 999px; background: rgba(255, 251, 240, 0.97); border: 1px solid rgba(214, 175, 90, 0.5); box-shadow: 0 4px 14px rgba(60, 44, 12, 0.16); }
        .tb-input { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; padding: 6px 10px; font-size: 16px; color: #3c2c0c; }
        .tb-send { min-width: 60px; min-height: 44px; border: 0; border-radius: 999px; background: #3c2c0c; color: #fff8e8; font-weight: 700; font-size: 13px; cursor: pointer; }
        .tb-send:disabled { opacity: .45; cursor: default; }
        .tb-close-type { width: 44px; height: 44px; border: 0; border-radius: 999px; background: transparent; color: #6b4f15; cursor: pointer; }
        .tb-close-type svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
        .tb-examples { display: flex; gap: 6px; overflow-x: auto; padding: 0 2px 2px; scrollbar-width: none; }
        .tb-examples::-webkit-scrollbar { display: none; }
        .tb-example { flex: 0 0 auto; min-height: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(214, 175, 90, 0.45); background: rgba(255, 251, 240, 0.95); color: #5a4214; font-size: 12px; white-space: nowrap; cursor: pointer; }
        .tb-stop { min-width: 56px; min-height: 44px; border: 1px solid rgba(160, 60, 30, .45); border-radius: 999px; background: #fff1ea; color: #8a2f12; font-weight: 700; font-size: 13px; cursor: pointer; }
        .tb-voice, .tb-review {
          pointer-events: auto; position: fixed; left: 12px; right: 12px; max-width: 520px; margin: 0 auto; box-sizing: border-box;
          display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 16px;
          background: rgba(255, 251, 240, 0.98); border: 1px solid rgba(214, 175, 90, 0.55); box-shadow: 0 6px 18px rgba(60, 44, 12, 0.18);
          max-height: 60vh; overflow-y: auto; overscroll-behavior: contain;
        }
        .tb-panel-tag { margin: 0; font-size: 10.5px; font-weight: 800; letter-spacing: .03em; color: #8a5a00; text-transform: none; }
        .tb-panel-text { margin: 0; font-size: 13px; line-height: 1.35; color: #3c2c0c; }
        .tb-warn { color: #8a2f12; font-weight: 650; }
        .tb-panel-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .tb-ghost { min-height: 44px; padding: 0 12px; border-radius: 999px; border: 1px solid rgba(214, 175, 90, 0.55); background: transparent; color: #5a4214; font-size: 12.5px; font-weight: 650; cursor: pointer; }
        .tb-test { min-height: 36px; font-size: 11.5px; color: #7a6a4a; }
        .tb-phrases { flex-wrap: wrap; overflow-x: visible; }
        .tb-phrase { min-height: 40px; white-space: normal; text-align: left; }
        .tb-input-review { flex: 1 1 auto; min-width: 0; border: 0; outline: none; background: transparent; padding: 6px 10px; font-size: 16px; color: #3c2c0c; }
        .tb-fields { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
        .tb-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 10px; background: rgba(214, 175, 90, 0.12); font-size: 13px; color: #3c2c0c; }
        .tb-field em { font-style: normal; color: #7a6a4a; font-size: 12px; }
        .tb-field.is-pending { background: rgba(242, 160, 80, 0.22); outline: 1px solid rgba(190, 100, 30, .45); }
        .tb-confirm { min-height: 36px; min-width: 44px; padding: 0 10px; border-radius: 999px; border: 1px solid #b06a1e; background: #fff; color: #8a4a0e; font-weight: 700; font-size: 12px; cursor: pointer; }
        .tb-confirm[aria-pressed="true"] { background: #2f6b2f; border-color: #2f6b2f; color: #fff; }
        .tb-edited { font-size: 11.5px; color: #2f6b2f; font-weight: 650; }
        .tb-log {
          pointer-events: auto; position: fixed; box-sizing: border-box; padding: 8px; border-radius: 16px; overflow-y: auto; overscroll-behavior: contain;
          background: rgba(18, 14, 9, 0.97); color: #fff8e8; box-shadow: 0 8px 22px rgba(0, 0, 0, .25);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        }
        .tb-log .tb-panel-text { color: #fff8e8; }
        .tb-log-head { position: sticky; top: -8px; z-index: 1; margin: -8px -8px 0; padding: 8px 8px 4px; background: #15110b; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; font-weight: 750; color: #f6e7bf; }
        .tb-log-head .tb-close-type { color: #f6e7bf; }
        .tb-log-list { margin: 4px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.35; }
        .tb-log-you .tb-who { color: #cfe3c8; } .tb-log-note .tb-who { color: #f5d3a3; }
        .tb-ghost:focus-visible, .tb-confirm:focus-visible, .tb-stop:focus-visible, .tb-phrase:focus-visible { outline: 2px solid #b07a10; outline-offset: 2px; }
        .tb-options {
          pointer-events: auto; position: fixed; box-sizing: border-box; padding: 8px; border-radius: 16px; overflow-y: auto; overscroll-behavior: contain;
          background: rgba(18, 14, 9, 0.9); box-shadow: 0 8px 22px rgba(0, 0, 0, .25);
          backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: tb-in .16s ease-out;
        }
        .tb-opt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .tb-opt-title { margin: 2px 4px 8px; color: #f6e7bf; font-size: 12.5px; font-weight: 700; }
        .tb-chip {
          min-height: 44px; padding: 0 10px; border-radius: 12px; border: 1px solid rgba(242, 198, 80, 0.32);
          background: rgba(255, 248, 232, 0.07); color: #fff8e8; font-size: 12.5px; font-weight: 650; cursor: pointer; text-align: center;
        }
        .tb-chip[aria-pressed="true"] { background: rgba(242, 198, 80, 0.2); border-color: rgba(242, 198, 80, 0.65); }
        .tb-chip:disabled { opacity: .45; cursor: default; }
        .tb-chip-end { color: #ffc9b3; }
        .tb-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .tb-pick {
          display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 76px; padding: 6px 4px; border-radius: 12px;
          border: 1px solid rgba(242, 198, 80, 0.25); background: rgba(255, 248, 232, 0.06); color: #fff8e8; font-size: 11px; font-weight: 650; cursor: pointer;
        }
        .tb-pick img { width: 40px; height: 40px; pointer-events: none; }
        .tb-pick.is-on { border-color: #f2c650; background: rgba(242, 198, 80, 0.18); }
        .tb-disclose { margin: 8px 2px 0; color: rgba(255, 248, 232, .75); font-size: 10.5px; line-height: 1.35; text-align: center; }
        .tb-disclose:empty { display: none; }
        @keyframes tb-pulse { 0% { box-shadow: 0 0 0 2px rgba(242,198,80,.95), 0 0 0 0 rgba(242,198,80,.5); } 100% { box-shadow: 0 0 0 2px rgba(242,198,80,.95), 0 0 0 12px rgba(242,198,80,0); } }
        @keyframes tb-halo { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes tb-bar { 0%, 100% { transform: scaleY(.55); } 50% { transform: scaleY(1.15); } }
        @keyframes tb-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @media (min-width: 1024px) {
          .tb-mascot.is-default { right: 24px; bottom: 24px; }
        }
        @media (max-width: 1023px) {
          .tb-on-detail .tb-mascot.is-default { bottom: calc(140px + env(safe-area-inset-bottom, 0px)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tb-mascot, .tb-mascot .tb-ring, .tb-wave-badge i, .tb-caption, .tb-options, .tb-edge-tab { animation: none !important; transition: none !important; }
          .tb-mascot.is-dragging { transform: none; }
        }
      `}</style>
    </div>
  );
}
