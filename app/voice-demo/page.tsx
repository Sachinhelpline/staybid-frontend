"use client";
// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — PRESENTATION-DEMO-01 — hidden /voice-demo surface.
//
// VOICE-FIRST push-to-talk demo. Browser-native SpeechRecognition (input) +
// speechSynthesis (output). NO provider / OpenAI / external SDK / API key. All
// hotel actions go through the bounded deterministic controller over the EXISTING
// read-only /api/hotels routes. No writes anywhere.
//
// Not linked from any nav. Mobile-first (iPhone portrait).
// ─────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initialState,
  runTurn,
  createTurnGate,
  createOnceLatch,
  micButtonLabel,
  MIC_CAP_MS,
  MIC_NO_SPEECH_REPLY,
  MIC_RETRY_REPLY,
  type DemoState,
  type MicPhase,
  type OnceLatch,
} from "@/lib/voice-demo/controller";
import { demoDeps } from "@/lib/voice-demo/client-data";
import { isValidHotelId, type NormalizedHotel, type NormalizedHotelDetails } from "@/lib/voice/contracts";

type LangMode = "auto" | "hi" | "en";
type Turn = { who: "you" | "sb"; text: string };

// Pick a TTS language: English if the text is Latin-only ASCII words, else Hindi.
function speakLang(text: string, mode: LangMode): string {
  if (mode === "hi") return "hi-IN";
  if (mode === "en") return "en-IN";
  // auto: Devanagari or the common Hinglish reply copy → hi-IN; plain ASCII → en-IN
  return /[ऀ-ॿ]/.test(text) ? "hi-IN" : "hi-IN";
}
function recogLang(mode: LangMode): string {
  return mode === "en" ? "en-IN" : "hi-IN";
}

export default function VoiceDemoPage() {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  // DEMO-REV-06 — single lifecycle phase (IDLE→LISTENING→PROCESSING→SPEAKING→IDLE).
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [lang, setLang] = useState<LangMode>("auto");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cards, setCards] = useState<NormalizedHotel[]>([]);
  const [detail, setDetail] = useState<NormalizedHotelDetails | null>(null);
  const [textFallback, setTextFallback] = useState("");

  const listening = phase === "listening";
  const speaking = phase === "speaking";
  const busy = phase === "processing";

  const stateRef = useRef<DemoState>(initialState());
  const recogRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // DEMO-REV-03 — turn-ownership gate; Reset bumps it to orphan in-flight work.
  const gateRef = useRef(createTurnGate());
  // DEMO-REV-06 — hard 7s cap timer, exactly-once latch, and capped flag. Each is
  // owned by the CURRENT recognition generation and cleared on end/stop/reset.
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latchRef = useRef<OnceLatch | null>(null);
  const cappedRef = useRef(false);

  const clearCapTimer = useCallback(() => {
    if (capTimerRef.current != null) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const SR = (typeof window !== "undefined") &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setSupported(!!SR);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, interim]);

  // DEMO-REV-06 (G) — leaving SPEAKING returns to IDLE, but never clobbers a newer
  // phase (a fresh LISTENING/PROCESSING started meanwhile), mirroring generation safety.
  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setPhase((p) => (p === "speaking" ? "idle" : p));
  }, []);

  /** Speak a reply. Returns true if TTS will run (→ SPEAKING), false if unavailable. */
  const speak = useCallback((text: string): boolean => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    try {
      window.speechSynthesis.cancel(); // never stack overlapping responses
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speakLang(text, lang);
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find((v) => v.lang === u.lang) || voices.find((v) => v.lang?.startsWith(u.lang.split("-")[0]));
      if (pref) u.voice = pref; // else browser default — never fail for a missing voice
      u.onstart = () => setPhase((p) => (p === "listening" ? p : "speaking"));
      u.onend = () => setPhase((p) => (p === "speaking" ? "idle" : p));
      u.onerror = () => setPhase((p) => (p === "speaking" ? "idle" : p));
      window.speechSynthesis.speak(u);
      return true;
    } catch { setPhase((p) => (p === "speaking" ? "idle" : p)); return false; }
  }, [lang]);

  // DEMO-REV-05 — navigate ONLY to a validated hotel id from the displayed set.
  // Never accepts an arbitrary route/id (the id is validated again here, and the
  // route is a fixed /hotels/<id> template — read-only, no booking/bid/payment).
  const openHotel = useCallback((id: string | null | undefined) => {
    if (!id || !isValidHotelId(id)) return;
    router.push(`/hotels/${id}`);
  }, [router]);

  const handleTranscript = useCallback(async (transcript: string, token?: number) => {
    const clean = transcript.trim();
    if (!clean) return;
    // capture ownership at the START of the turn (or reuse the recognition's token)
    const owned = token ?? gateRef.current.capture();
    // a transcript that arrived after a Reset must never enter the active session
    if (gateRef.current.isStale(owned)) return;
    setTurns((t) => [...t, { who: "you", text: clean }]);
    // DEMO-REV-06 (F) — PROCESSING state; exactly ONE controller turn per interaction
    // (the mic latch guarantees onend calls this at most once; the text box is a
    // separate typed interaction).
    setPhase("processing");
    setStatus("Processing…");
    try {
      const out = await runTurn(stateRef.current, clean, demoDeps);
      // DEMO-REV-03 — after the await, discard entirely if Reset happened meanwhile:
      // no state, cards, details, transcript, conversation, or speech update.
      if (gateRef.current.isStale(owned)) return;
      stateRef.current = out.state;
      setCards(out.cards);
      setDetail(out.detail);
      setTurns((t) => [...t, { who: "sb", text: out.reply }]);
      setStatus("");
      const willSpeak = speak(out.reply);
      if (!willSpeak) setPhase("idle");
      // DEMO-REV-05 — navigate ONLY when the controller emits a validated displayed-set id.
      if (out.openHotelId) openHotel(out.openHotelId);
    } catch {
      if (gateRef.current.isStale(owned)) return;
      const msg = "Kuch technical dikkat aa gayi. Dobara try karein.";
      setTurns((t) => [...t, { who: "sb", text: msg }]);
      setPhase("idle");
      setStatus("");
    }
  }, [speak, openHotel]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    // DEMO-REV-06 (H) — unsupported browser is a visible state, never a silent no-op.
    if (!SR) { setSupported(false); return; }
    // DEMO-REV-06 (B) — a SECOND tap while listening is a MANUAL STOP (→ onend finalizes).
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch { /* ignore */ }
      return;
    }
    setErrorMsg("");
    // DEMO-REV-06 (A)/(G) — a fresh mic turn cancels any active speech FIRST.
    stopSpeaking();
    let recog: any;
    try { recog = new SR(); } catch { setSupported(false); return; }
    recog.lang = recogLang(lang);
    recog.interimResults = true;
    recog.continuous = false; // (C) MANDATORY — single utterance, no always-listening
    recog.maxAlternatives = 1;
    let finalText = "";
    // Ownership token + a fresh once-latch + capped flag for THIS interaction.
    const recogToken = gateRef.current.capture();
    const latch = createOnceLatch();
    latchRef.current = latch;
    cappedRef.current = false;

    // DEMO-REV-06 (D)(E) — finalize on no usable transcript, exactly once.
    const finalizeNoText = () => {
      if (!latch.claim()) return;
      const msg = cappedRef.current ? MIC_NO_SPEECH_REPLY : MIC_RETRY_REPLY;
      setPhase("idle");
      setStatus("");
      setInterim("");
      setTurns((t) => [...t, { who: "sb", text: msg }]);
      speak(msg);
    };

    recog.onstart = () => {
      setPhase("listening");
      setInterim("");
      setStatus("");
      // (D)(E) — arm the hard 7s cap, owned by THIS generation.
      clearCapTimer();
      capTimerRef.current = setTimeout(() => {
        capTimerRef.current = null;
        // a cap from an older generation (Reset / newer turn) has NO effect.
        if (gateRef.current.isStale(recogToken)) return;
        cappedRef.current = true;
        // stop recognition → onend runs the single finalize path.
        try { recogRef.current?.stop(); } catch { /* ignore */ }
      }, MIC_CAP_MS);
    };
    recog.onresult = (e: any) => {
      let interimStr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimStr += res[0].transcript;
      }
      setInterim(interimStr);
    };
    recog.onerror = (e: any) => {
      const err = e?.error || "unknown";
      // (H) — every failure mode is a VISIBLE state, never silent.
      if (err === "not-allowed" || err === "service-not-allowed") {
        setErrorMsg("Microphone permission denied. Browser settings mein StayBid ke liye mic allow karein, phir dobara try karein.");
      } else if (err === "no-speech") {
        setErrorMsg("Kuch sunai nahi diya. Mic tap karke dobara boliye.");
      } else if (err === "audio-capture") {
        setErrorMsg("Microphone nahi mila. Device ka mic check karein.");
      } else {
        setErrorMsg("Voice recognition error. Dobara try karein.");
      }
      // recognition/network error must NEVER trigger writes or fake results.
    };
    recog.onend = () => {
      clearCapTimer();                 // (E) — cap timer is cleared on completion
      recogRef.current = null;         // (C) — NO auto-restart; recognition is done
      // DEMO-REV-03 — a recognition that ended after Reset must not revive state/UI.
      if (gateRef.current.isStale(recogToken)) return;
      setInterim("");
      const t = finalText.trim();
      if (t) {
        // (F) — usable transcript → exactly ONE controller turn.
        if (latch.claim()) { setPhase("processing"); setStatus("Processing…"); void handleTranscript(t, recogToken); }
      } else {
        // (B) manual stop / (D) cap with no usable transcript → concise retry.
        finalizeNoText();
      }
    };
    recogRef.current = recog;
    try { recog.start(); } catch { setPhase("idle"); recogRef.current = null; clearCapTimer(); }
  }, [lang, stopSpeaking, handleTranscript, speak, clearCapTimer]);

  const reset = useCallback(() => {
    // DEMO-REV-03-R1-01 — Reset establishes the authoritative idle state ITSELF,
    // synchronously, so a stale callback that (correctly) returns early can never
    // leave the UI stuck. Order: (1) invalidate ownership first, (2) cancel speech,
    // (3) stop recognition safely, (4) clear the recognition ref, (5) restore
    // lifecycle/UI state synchronously.
    gateRef.current.bump();                                    // (1)
    stopSpeaking();                                            // (2)
    try { recogRef.current?.stop(); } catch { /* ignore */ }  // (3)
    recogRef.current = null;                                   // (4)
    // DEMO-REV-06 (E) — clear the 7s cap timer + retire the interaction latch so a
    // stale timeout/onend can never affect a newer turn.
    clearCapTimer();
    latchRef.current = null;
    cappedRef.current = false;
    // (5) synchronous idle restore — phase cleared here, NOT in the stale callbacks
    // (which stay discarded).
    setPhase("idle");
    stateRef.current = initialState();
    setTurns([]);
    setCards([]);
    setDetail(null);
    setInterim("");
    setErrorMsg("");
    setStatus("");
  }, [stopSpeaking, clearCapTimer]);

  // DEMO-REV-06 — clear any armed cap timer on unmount (cleanup).
  useEffect(() => () => clearCapTimer(), [clearCapTimer]);

  const submitText = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const t = textFallback.trim();
    if (!t || busy) return;
    setTextFallback("");
    void handleTranscript(t);
  }, [textFallback, busy, handleTranscript]);

  const money = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={S.brandRow}>
          <span style={S.brand}>StayBid <span style={{ color: "#f2c650" }}>Voice AI</span></span>
          <span style={S.beta}>Presentation Beta</span>
        </div>
        <div style={S.langRow}>
          {(["auto", "hi", "en"] as LangMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setLang(m)}
              style={{ ...S.langChip, ...(lang === m ? S.langChipOn : {}) }}
            >
              {m === "auto" ? "Auto" : m === "hi" ? "हिंदी" : "English"}
            </button>
          ))}
        </div>
      </header>

      <div ref={scrollRef} style={S.convo}>
        {turns.length === 0 && (
          <div style={S.hint}>
            🎙️ Mic tap karein aur boliye — jaise<br />
            <em>“Dhanaulti ke hotel dikhao”</em> · <em>“5000 ke andar parking wala”</em> · <em>“Top do compare karo”</em>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ ...S.bubble, ...(t.who === "you" ? S.you : S.sb) }}>
            {t.text.split("\n").map((ln, j) => <div key={j}>{ln}</div>)}
          </div>
        ))}
        {interim && <div style={{ ...S.bubble, ...S.you, opacity: 0.6 }}>{interim}</div>}
        {cards.length > 0 && (
          <div style={S.cards}>
            {cards.slice(0, 5).map((h, i) => (
              // DEMO-REV-05 — the whole card is a real, keyboard-accessible link to
              // /hotels/<validated id> from the AUTHORITATIVE displayed set.
              <div
                key={h.id}
                style={{ ...S.card, ...S.cardClickable }}
                role="button"
                tabIndex={0}
                onClick={() => openHotel(h.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHotel(h.id); } }}
                aria-label={`Open ${h.name}`}
              >
                <div style={S.cardIndex}>{i + 1}</div>
                <div style={S.cardName}>{h.name}</div>
                <div style={S.cardMeta}>
                  {h.city && <span>{h.city}</span>}
                  {h.avgRating != null && <span> · ⭐{h.avgRating}</span>}
                </div>
                <div style={S.cardPrice}>{money(h.minPrice)}<span style={S.perNight}>/night</span></div>
                <div style={S.viewHotel}>View Hotel →</div>
              </div>
            ))}
          </div>
        )}
        {detail && (
          <div
            style={{ ...S.card, ...S.cardClickable, borderColor: "#f2c650" }}
            role="button"
            tabIndex={0}
            onClick={() => openHotel(detail.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHotel(detail.id); } }}
            aria-label={`Open ${detail.name}`}
          >
            <div style={S.cardName}>{detail.name}</div>
            <div style={S.cardMeta}>{detail.city} {detail.avgRating != null ? `· ⭐${detail.avgRating}` : ""}</div>
            <div style={S.cardPrice}>{money(detail.minPrice)}<span style={S.perNight}>/night</span></div>
            {detail.amenities.length > 0 && (
              <div style={S.amenities}>{detail.amenities.slice(0, 8).map((a) => (
                <span key={a} style={S.amChip}>{a}</span>
              ))}</div>
            )}
            <div style={S.viewHotel}>View Hotel →</div>
          </div>
        )}
      </div>

      {(status || speaking) && (
        <div style={S.statusBar}>
          {listening && <span style={S.pulse}>● </span>}
          {speaking ? "🔊 Bol raha hoon…" : status}
        </div>
      )}
      {errorMsg && <div style={S.error}>{errorMsg}</div>}

      <div style={S.controls}>
        {supported === false ? (
          <div style={S.unsupported}>
            Voice recognition is not supported in this browser. Use an emergency text box below.
          </div>
        ) : (
          <button
            onClick={startListening}
            style={{ ...S.mic, ...(listening ? S.micOn : {}) }}
            aria-label="Microphone"
            disabled={busy}
          >
            {micButtonLabel(phase)}
          </button>
        )}
        <div style={S.btnRow}>
          <button onClick={stopSpeaking} style={S.secBtn} disabled={!speaking}>Stop speaking</button>
          <button onClick={reset} style={S.secBtn}>Reset</button>
        </div>
        <form onSubmit={submitText} style={S.textForm}>
          <input
            value={textFallback}
            onChange={(e) => setTextFallback(e.target.value)}
            placeholder="Emergency text backup…"
            style={S.textInput}
          />
          <button type="submit" style={S.sendBtn} disabled={busy || !textFallback.trim()}>Send</button>
        </form>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 480, margin: "0 auto", background: "#12100c", color: "#f4ecdd", fontFamily: "system-ui, -apple-system, sans-serif" },
  header: { padding: "12px 16px 8px", borderBottom: "1px solid #2a2419" },
  brandRow: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brand: { fontSize: 18, fontWeight: 700 },
  beta: { fontSize: 10, fontWeight: 700, color: "#12100c", background: "#f2c650", borderRadius: 999, padding: "2px 8px" },
  langRow: { display: "flex", gap: 6, marginTop: 8 },
  langChip: { fontSize: 12, padding: "4px 12px", borderRadius: 999, border: "1px solid #3a3222", background: "transparent", color: "#c9bfa8", cursor: "pointer" },
  langChipOn: { background: "#f2c650", color: "#12100c", borderColor: "#f2c650", fontWeight: 700 },
  convo: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  hint: { textAlign: "center", color: "#9c917a", fontSize: 13, lineHeight: 1.7 },
  bubble: { maxWidth: "85%", padding: "10px 14px", borderRadius: 16, fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap" },
  you: { alignSelf: "flex-end", background: "#2f2717", borderBottomRightRadius: 4 },
  sb: { alignSelf: "flex-start", background: "#1d1a12", border: "1px solid #2a2419", borderBottomLeftRadius: 4 },
  cards: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4 },
  card: { border: "1px solid #2a2419", borderRadius: 12, padding: 12, background: "#181510", position: "relative" },
  cardClickable: { cursor: "pointer" },
  cardIndex: { position: "absolute", top: 10, right: 12, fontSize: 12, fontWeight: 700, color: "#6f6551" },
  viewHotel: { marginTop: 8, fontSize: 12, fontWeight: 700, color: "#f2c650" },
  cardName: { fontWeight: 600, fontSize: 15 },
  cardMeta: { fontSize: 12, color: "#b7ad95", marginTop: 2 },
  cardPrice: { fontSize: 18, fontWeight: 700, color: "#f2c650", marginTop: 6 },
  perNight: { fontSize: 12, fontWeight: 400, color: "#b7ad95" },
  amenities: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  amChip: { fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#241f15", color: "#d8cdb2" },
  statusBar: { padding: "6px 16px", fontSize: 13, color: "#f2c650", textAlign: "center" },
  pulse: { color: "#ff5a5a" },
  error: { padding: "8px 16px", fontSize: 13, color: "#ffb4b4", background: "#2a1414", margin: "0 12px", borderRadius: 8 },
  controls: { padding: 16, borderTop: "1px solid #2a2419", display: "flex", flexDirection: "column", gap: 10 },
  mic: { width: "100%", padding: "16px", fontSize: 17, fontWeight: 700, borderRadius: 14, border: "none", background: "#f2c650", color: "#12100c", cursor: "pointer" },
  micOn: { background: "#ff5a5a", color: "#fff" },
  unsupported: { fontSize: 13, color: "#ffb4b4", textAlign: "center", padding: 8 },
  btnRow: { display: "flex", gap: 8 },
  secBtn: { flex: 1, padding: "10px", fontSize: 13, borderRadius: 10, border: "1px solid #3a3222", background: "transparent", color: "#d8cdb2", cursor: "pointer" },
  textForm: { display: "flex", gap: 8 },
  textInput: { flex: 1, padding: "10px 12px", fontSize: 14, borderRadius: 10, border: "1px solid #3a3222", background: "#181510", color: "#f4ecdd" },
  sendBtn: { padding: "10px 16px", fontSize: 14, borderRadius: 10, border: "none", background: "#3a3222", color: "#f4ecdd", cursor: "pointer" },
};
