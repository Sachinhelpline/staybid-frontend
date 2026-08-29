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
import { initialState, runTurn, createTurnGate, type DemoState } from "@/lib/voice-demo/controller";
import { demoDeps } from "@/lib/voice-demo/client-data";
import type { NormalizedHotel, NormalizedHotelDetails } from "@/lib/voice/contracts";

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
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [lang, setLang] = useState<LangMode>("auto");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cards, setCards] = useState<NormalizedHotel[]>([]);
  const [detail, setDetail] = useState<NormalizedHotelDetails | null>(null);
  const [textFallback, setTextFallback] = useState("");

  const stateRef = useRef<DemoState>(initialState());
  const recogRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // DEMO-REV-03 — turn-ownership gate; Reset bumps it to orphan in-flight work.
  const gateRef = useRef(createTurnGate());

  useEffect(() => {
    const SR = (typeof window !== "undefined") &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    setSupported(!!SR);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, interim]);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel(); // never stack overlapping responses
      const u = new SpeechSynthesisUtterance(text);
      u.lang = speakLang(text, lang);
      const voices = window.speechSynthesis.getVoices();
      const pref = voices.find((v) => v.lang === u.lang) || voices.find((v) => v.lang?.startsWith(u.lang.split("-")[0]));
      if (pref) u.voice = pref; // else browser default — never fail for a missing voice
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch { setSpeaking(false); }
  }, [lang]);

  const handleTranscript = useCallback(async (transcript: string, token?: number) => {
    const clean = transcript.trim();
    if (!clean) return;
    // capture ownership at the START of the turn (or reuse the recognition's token)
    const owned = token ?? gateRef.current.capture();
    // a transcript that arrived after a Reset must never enter the active session
    if (gateRef.current.isStale(owned)) return;
    setTurns((t) => [...t, { who: "you", text: clean }]);
    setBusy(true);
    setStatus("Soch raha hoon…");
    try {
      const out = await runTurn(stateRef.current, clean, demoDeps);
      // DEMO-REV-03 — after the await, discard entirely if Reset happened meanwhile:
      // no state, cards, details, transcript, conversation, or speech update.
      if (gateRef.current.isStale(owned)) return;
      stateRef.current = out.state;
      setCards(out.cards);
      setDetail(out.detail);
      setTurns((t) => [...t, { who: "sb", text: out.reply }]);
      speak(out.reply);
    } catch {
      if (gateRef.current.isStale(owned)) return;
      const msg = "Kuch technical dikkat aa gayi. Dobara try karein.";
      setTurns((t) => [...t, { who: "sb", text: msg }]);
    } finally {
      if (!gateRef.current.isStale(owned)) { setBusy(false); setStatus(""); }
    }
  }, [speak]);

  const startListening = useCallback(() => {
    setErrorMsg("");
    // barge: a new mic turn cancels any active speech immediately.
    stopSpeaking();
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    // if already listening, stop (toggle)
    if (recogRef.current) {
      try { recogRef.current.stop(); } catch { /* ignore */ }
      return;
    }
    let recog: any;
    try { recog = new SR(); } catch { setSupported(false); return; }
    recog.lang = recogLang(lang);
    recog.interimResults = true;
    recog.continuous = false; // single utterance / push-to-talk (iPhone-safe)
    recog.maxAlternatives = 1;
    let finalText = "";
    // capture the generation this recognition turn belongs to; a Reset mid-turn
    // bumps the gate so this turn's late onend is discarded.
    const recogToken = gateRef.current.capture();
    recog.onstart = () => { setListening(true); setInterim(""); setStatus("Sun raha hoon…"); };
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
      recogRef.current = null;
      // DEMO-REV-03 — a recognition that ended after Reset must not revive state/UI.
      if (gateRef.current.isStale(recogToken)) return;
      setListening(false);
      setStatus("");
      setInterim("");
      const t = finalText.trim();
      if (t) void handleTranscript(t, recogToken);
    };
    recogRef.current = recog;
    try { recog.start(); } catch { setListening(false); recogRef.current = null; }
  }, [lang, stopSpeaking, handleTranscript]);

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
    // (5) synchronous idle restore — busy/listening cleared here, NOT in the stale
    // callbacks (which stay discarded).
    setBusy(false);
    setListening(false);
    stateRef.current = initialState();
    setTurns([]);
    setCards([]);
    setDetail(null);
    setInterim("");
    setErrorMsg("");
    setStatus("");
  }, [stopSpeaking]);

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
            {cards.slice(0, 5).map((h) => (
              <div key={h.id} style={S.card}>
                <div style={S.cardName}>{h.name}</div>
                <div style={S.cardMeta}>
                  {h.city && <span>{h.city}</span>}
                  {h.avgRating != null && <span> · ⭐{h.avgRating}</span>}
                </div>
                <div style={S.cardPrice}>{money(h.minPrice)}<span style={S.perNight}>/night</span></div>
              </div>
            ))}
          </div>
        )}
        {detail && (
          <div style={{ ...S.card, borderColor: "#f2c650" }}>
            <div style={S.cardName}>{detail.name}</div>
            <div style={S.cardMeta}>{detail.city} {detail.avgRating != null ? `· ⭐${detail.avgRating}` : ""}</div>
            <div style={S.cardPrice}>{money(detail.minPrice)}<span style={S.perNight}>/night</span></div>
            {detail.amenities.length > 0 && (
              <div style={S.amenities}>{detail.amenities.slice(0, 8).map((a) => (
                <span key={a} style={S.amChip}>{a}</span>
              ))}</div>
            )}
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
            {listening ? "■ Sun raha hoon…" : "🎤 Tap to speak"}
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
  card: { border: "1px solid #2a2419", borderRadius: 12, padding: 12, background: "#181510" },
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
