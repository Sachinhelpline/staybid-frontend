"use client";
// ═══════════════════════════════════════════════════════════════════════════
// CreateFlow — Instagram-style "+" upload flow on the Reels home.
// Three entry types: Reel · Photo · Story. Each runs the same composer:
//   1. Pick media file (input type=file)
//   2. Preview + caption + emoji bar + tags + audio picker
//   3. Post → saved to localStorage `sb_user_posts` + toast confirmation
// Audio picker has 3 sources:
//   • Original (use the media file's own audio)
//   • Library  (8 royalty-free tracks)
//   • Upload   (audio file from device — uses createObjectURL, never leaves
//                 the browser; no backend storage)
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Sample music library (royalty-free / Mixkit) ─────────────────────────
export const AUDIO_LIBRARY: AudioTrack[] = [
  { id: "mk-tech",    name: "Tech House Vibes",    artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3",         emoji: "🎧" },
  { id: "mk-deep",    name: "Deep Urban",          artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-deep-urban-623.mp3",                emoji: "🌃" },
  { id: "mk-driving", name: "Driving Ambition",    artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-driving-ambition-32.mp3",           emoji: "🏎" },
  { id: "mk-serene",  name: "Serene View",         artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-serene-view-443.mp3",               emoji: "🌅" },
  { id: "mk-tropical",name: "Tropical Vibes",      artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-tropical-vibes-music-pack-122.mp3", emoji: "🏝" },
  { id: "mk-piano",   name: "Uplifting Piano Pop", artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-uplifting-piano-pop-3045.mp3",      emoji: "🎹" },
  { id: "mk-hiphop",  name: "Hip Hop 02",          artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-hip-hop-02-738.mp3",                emoji: "🎤" },
  { id: "mk-paradise",name: "Relaxing in Paradise",artist: "Mixkit",  url: "https://assets.mixkit.co/music/preview/mixkit-relaxing-in-paradise-533.mp3",      emoji: "🌴" },
];

export type AudioTrack = {
  id: string;
  name: string;
  artist: string;
  url: string;
  emoji?: string;
};

export type ContentKind = "reel" | "photo" | "story";

export type UserPost = {
  id: string;
  kind: ContentKind;
  mediaUrl: string;
  mediaMime: string;
  caption: string;
  tags: string[];
  audio: { name: string; url: string } | null;
  createdAt: number;
};

// Common emoji set used across the composer
const EMOJI_BAR = ["❤️", "🔥", "✨", "😍", "🥳", "🌄", "🛏", "🍴", "📍", "🌟", "🌊", "☀️", "🌙", "🎵", "🙏"];

const TAG_PRESETS = ["TravelDiaries", "LuxuryStay", "BudgetTrip", "Foodie", "Mountains", "Beaches", "Solo", "Couple", "Family", "WeekendGetaway", "StayBidLife", "VerifiedStay"];

// ─── Plus FAB (entry button) ─────────────────────────────────────────────
export function CreateFAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Create new post"
      className="ig-create-fab"
    >
      <span className="ig-create-fab-plus">＋</span>
      <span className="ig-create-fab-glow" aria-hidden />
    </button>
  );
}

// ─── Main Create entry sheet (3 cards: Reel / Photo / Story) ─────────────
export function CreateSheet({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: ContentKind) => void;
}) {
  if (!open) return null;
  const cards: { kind: ContentKind; emoji: string; title: string; sub: string; gradient: string }[] = [
    { kind: "reel",  emoji: "🎬", title: "Reel",  sub: "Up to 60s vertical video · with audio, tags & emojis",  gradient: "linear-gradient(135deg,#ff458d,#b964ff)" },
    { kind: "photo", emoji: "📷", title: "Photo", sub: "Single image post · caption · tag a hotel · emojis",     gradient: "linear-gradient(135deg,#ffd76b,#f0b429)" },
    { kind: "story", emoji: "📖", title: "Story", sub: "24h disappearing photo or video · audio overlay",        gradient: "linear-gradient(135deg,#3ea0ff,#1a78d6)" },
  ];
  return (
    <div className="fixed inset-0 z-[90] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
        }}
      >
        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">Create</p>
          <button onClick={onClose} className="text-white/55 text-xl">✕</button>
        </div>
        <div className="px-4 pt-2 space-y-2.5">
          {cards.map((c) => (
            <button
              key={c.kind}
              onClick={() => onPick(c.kind)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: c.gradient, boxShadow: "0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)" }}
              >
                {c.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-[0.92rem]">{c.title}</p>
                <p className="text-white/55 text-[0.66rem] mt-0.5">{c.sub}</p>
              </div>
              <span className="text-white/45 text-xl">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Audio Picker (Original / Library / Upload) ───────────────────────────
export function AudioPicker({
  open, onClose, current, onPick, allowOriginal = true,
}: {
  open: boolean;
  onClose: () => void;
  current: AudioTrack | null;
  onPick: (track: AudioTrack | null) => void;  // null = original
  allowOriginal?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Stop preview audio whenever the picker closes
  useEffect(() => { if (!open && previewRef.current) previewRef.current.pause(); }, [open]);
  useEffect(() => () => { if (previewRef.current) previewRef.current.pause(); }, []);

  if (!open) return null;
  const list = AUDIO_LIBRARY.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
  });

  const handlePreview = (t: AudioTrack) => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current.src = t.url;
      previewRef.current.play().catch(() => {});
      setPreviewing(t.id);
    }
  };
  const handleStopPreview = () => {
    if (previewRef.current) previewRef.current.pause();
    setPreviewing(null);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onPick({ id: `upload-${Date.now()}`, name: file.name, artist: "Your device", url, emoji: "📥" });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[92] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "78vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.7)",
          display: "flex", flexDirection: "column",
        }}
      >
        <audio ref={previewRef} onEnded={() => setPreviewing(null)} />

        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-2">
          <p className="text-white font-semibold text-[0.92rem]">🎵 Choose audio</p>
          <button onClick={onClose} className="text-white/55 text-xl">✕</button>
        </div>

        <div className="px-5 pb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search music…"
            className="ig-comment-input w-full rounded-full px-4 py-2 text-[0.82rem] outline-none"
            style={{ color: "#fff", caretColor: "#ffd76b", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)" }}
          />
        </div>

        {/* Top actions: Original + Upload */}
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          {allowOriginal && (
            <button
              onClick={() => { onPick(null); onClose(); }}
              className="ig-create-card-btn"
            >
              <span className="text-xl">🎙</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-[0.82rem]">Use original audio</span>
                <span className="block text-white/55 text-[0.62rem]">Whatever the video already has</span>
              </span>
              {current === null && <span className="text-gold-300">✓</span>}
            </button>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="ig-create-card-btn"
          >
            <span className="text-xl">📥</span>
            <span className="flex-1 text-left">
              <span className="block font-semibold text-[0.82rem]">Upload from device</span>
              <span className="block text-white/55 text-[0.62rem]">.mp3 / .m4a / .wav from your phone</span>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5">
          <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1 mt-1">Library</p>
          {list.map((t) => {
            const active = current?.id === t.id;
            const isPreviewing = previewing === t.id;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-2.5 py-2 rounded-xl"
                style={{
                  background: active ? "rgba(240,180,41,0.14)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${active ? "rgba(240,180,41,0.45)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-xl"
                  style={{ background: "linear-gradient(135deg,#1a1530,#0d1a2e)", border: "1px solid rgba(255,255,255,0.10)" }}>
                  {t.emoji || "🎵"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-[0.82rem] truncate">{t.name}</p>
                  <p className="text-white/55 text-[0.62rem] truncate">{t.artist}</p>
                </div>
                <button
                  onClick={() => isPreviewing ? handleStopPreview() : handlePreview(t)}
                  className="px-2.5 py-1.5 rounded-full text-[0.7rem] text-white"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)" }}
                  aria-label={isPreviewing ? "Stop preview" : "Preview"}
                >
                  {isPreviewing ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => { handleStopPreview(); onPick(t); onClose(); }}
                  className="px-3 py-1.5 rounded-full text-[0.72rem] font-bold text-black"
                  style={{ background: "linear-gradient(135deg,#ffd76b,#f0b429)", border: "1px solid rgba(255,255,255,0.45)", boxShadow: "0 2px 6px rgba(240,180,41,0.45)" }}
                >
                  Use
                </button>
              </div>
            );
          })}
          {list.length === 0 && (
            <p className="py-10 text-center text-white/45 text-sm">No matches.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Composer (the multi-step compose modal) ─────────────────────────────
export function Composer({
  open, kind, onClose, onPosted, sanitize,
}: {
  open: boolean;
  kind: ContentKind;
  onClose: () => void;
  onPosted: (post: UserPost) => void;
  /**
   * Caption sanitizer hook — caller supplies the same anti-bypass guard
   * used elsewhere so phone/email/social-handle leaks are scrubbed before
   * posting. Returns the masked caption + whether anything was blocked.
   */
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [step, setStep] = useState<"pick" | "edit">("pick");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [warnedSanitize, setWarnedSanitize] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Reset when reopened
  useEffect(() => {
    if (open) {
      setStep("pick");
      setMediaFile(null);
      setMediaUrl("");
      setCaption("");
      setTags([]);
      setAudio(null);
      setPosting(false);
      setWarnedSanitize(false);
    }
  }, [open, kind]);

  // Revoke object URL when modal unmounts to avoid leaks
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);

  if (!open) return null;

  const accept = kind === "photo" ? "image/*" : kind === "story" ? "image/*,video/*" : "video/*";
  const isVideo = mediaFile?.type.startsWith("video/");

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMediaFile(file);
    setMediaUrl(url);
    setStep("edit");
  };

  const toggleTag = (t: string) => {
    setTags((prev) => prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t]);
  };

  const insertEmoji = (e: string) => setCaption((c) => c + e);

  const post = () => {
    if (!mediaFile || !mediaUrl) return;
    const sanitizedCaption = sanitize ? sanitize(caption).clean : caption;
    setPosting(true);
    const userPost: UserPost = {
      id: `post-${Date.now()}`,
      kind,
      mediaUrl,                          // local object URL — survives session
      mediaMime: mediaFile.type,
      caption: sanitizedCaption,
      tags,
      audio: audio ? { name: audio.name, url: audio.url } : null,
      createdAt: Date.now(),
    };
    try {
      const raw = localStorage.getItem("sb_user_posts");
      const arr = raw ? JSON.parse(raw) : [];
      arr.unshift(userPost);
      localStorage.setItem("sb_user_posts", JSON.stringify(arr.slice(0, 100)));
    } catch {}
    setTimeout(() => {
      setPosting(false);
      onPosted(userPost);
      onClose();
    }, 600);
  };

  const captionPreview = (() => {
    if (!sanitize || !caption) return null;
    const { blocked } = sanitize(caption);
    return blocked;
  })();

  return (
    <div className="fixed inset-0 z-[91] flex items-end" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.78)", backdropFilter: "blur(8px)" }} />
      <div
        className="relative w-full ig-drawer-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "94vh",
          background: "linear-gradient(180deg,#15101e 0%,#0a0612 100%)",
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.75)",
          display: "flex", flexDirection: "column",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
      >
        <audio ref={audioPreviewRef} src={audio?.url || ""} loop />

        <div className="flex justify-center pt-2.5 pb-1.5"><div className="w-10 h-[3px] rounded-full bg-white/30" /></div>
        <div className="flex items-center justify-between px-5 pb-3 border-b border-white/8">
          <button onClick={step === "edit" ? () => setStep("pick") : onClose} className="text-white/85 text-[0.84rem]">
            {step === "edit" ? "‹ Back" : "Cancel"}
          </button>
          <p className="text-white font-semibold text-[0.92rem]">
            {step === "pick" ? `New ${kind === "reel" ? "Reel" : kind === "photo" ? "Photo" : "Story"}` : "Edit"}
          </p>
          <button
            onClick={post}
            disabled={!mediaFile || posting}
            className="text-gold-300 font-bold text-[0.84rem] disabled:opacity-30"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>

        {/* Step 1: pick a file */}
        {step === "pick" && (
          <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
            <div
              onClick={() => fileRef.current?.click()}
              className="w-full max-w-xs aspect-[4/5] rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
              style={{
                background: "linear-gradient(135deg, rgba(255,69,141,0.18), rgba(185,100,255,0.10))",
                border: "1.5px dashed rgba(255,255,255,0.25)",
              }}
            >
              <span className="text-5xl">{kind === "reel" ? "🎬" : kind === "photo" ? "📷" : "📖"}</span>
              <p className="text-white font-semibold text-[0.92rem]">Tap to choose {kind === "photo" ? "a photo" : kind === "story" ? "a photo or video" : "a video"}</p>
              <p className="text-white/55 text-[0.66rem] px-6">From your camera roll or files. Stays on your device until you tap Post.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              onChange={onFile}
              className="hidden"
            />
            <p className="text-white/45 text-[0.66rem] mt-5 max-w-xs">
              🛡️ Captions, tags & bios are auto-scrubbed of phone numbers, emails, and off-platform links to keep bookings on StayBid.
            </p>
          </div>
        )}

        {/* Step 2: edit / caption / audio / tags */}
        {step === "edit" && mediaFile && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview */}
            <div className="px-4 pt-3 pb-2">
              <div
                className="w-full rounded-2xl overflow-hidden bg-black mx-auto"
                style={{ maxHeight: "44vh", aspectRatio: "9/14" }}
              >
                {isVideo ? (
                  <video src={mediaUrl} className="w-full h-full object-cover" autoPlay loop muted={!!audio} playsInline />
                ) : (
                  <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
              {/* Audio row */}
              <button
                type="button"
                onClick={() => setAudioOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span className="text-xl">{audio?.emoji || "🎵"}</span>
                <span className="flex-1 text-left min-w-0">
                  <span className="block text-white text-[0.82rem] font-semibold truncate">
                    {audio ? audio.name : "Original audio"}
                  </span>
                  <span className="block text-white/55 text-[0.62rem] truncate">
                    {audio ? audio.artist : "Tap to choose music"}
                  </span>
                </span>
                <span className="text-white/45 text-base">›</span>
              </button>

              {/* Caption */}
              <div>
                <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Caption</p>
                <textarea
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    if (sanitize && !warnedSanitize) {
                      const { blocked } = sanitize(e.target.value);
                      if (blocked) setWarnedSanitize(true);
                    }
                  }}
                  rows={3}
                  maxLength={500}
                  placeholder="Write a caption…"
                  className="ig-comment-input w-full rounded-xl px-3 py-2 text-[0.82rem] outline-none resize-none"
                  style={{
                    color: "#fff",
                    caretColor: "#ffd76b",
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.20)",
                    minHeight: 70,
                  }}
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {EMOJI_BAR.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => insertEmoji(e)}
                      className="px-2 py-1 rounded-full text-base"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                {captionPreview && (
                  <p className="mt-2 text-amber-300 text-[0.68rem]">
                    🛡️ Personal contact info will be hidden when posted.
                  </p>
                )}
              </div>

              {/* Tags */}
              <div>
                <p className="text-white/55 text-[0.6rem] uppercase tracking-widest mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_PRESETS.map((t) => {
                    const active = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleTag(t)}
                        className="px-3 py-1 rounded-full text-[0.7rem] font-bold transition-all"
                        style={{
                          background: active ? "linear-gradient(135deg,#ffd76b,#f0b429)" : "rgba(255,255,255,0.05)",
                          color: active ? "#1a1208" : "rgba(255,255,255,0.85)",
                          border: active ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.10)",
                          boxShadow: active ? "0 2px 6px rgba(240,180,41,0.45), inset 0 1px 0 rgba(255,255,255,0.5)" : "none",
                        }}
                      >
                        #{t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Confirm post (extra safety) */}
              <button
                onClick={post}
                disabled={posting}
                className="ig-cta-3d ig-cta-book w-full"
                style={{ padding: "12px", fontSize: "0.86rem" }}
              >
                <span className="ig-cta-icon">⚡</span>
                <span className="ig-cta-text">{posting ? "Posting…" : `Post to your profile`}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <AudioPicker
        open={audioOpen}
        onClose={() => setAudioOpen(false)}
        current={audio}
        onPick={(t) => setAudio(t)}
      />
    </div>
  );
}

// ─── Combined controller — hosts FAB + sheets together ───────────────────
export function CreateFlow({
  onPosted, sanitize,
}: {
  onPosted?: (post: UserPost) => void;
  sanitize?: (s: string) => { clean: string; blocked: boolean };
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; kind: ContentKind }>({ open: false, kind: "reel" });

  return (
    <>
      <CreateFAB onClick={() => setSheetOpen(true)} />
      <CreateSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onPick={(kind) => { setSheetOpen(false); setComposer({ open: true, kind }); }}
      />
      <Composer
        open={composer.open}
        kind={composer.kind}
        onClose={() => setComposer({ open: false, kind: "reel" })}
        onPosted={(p) => { setComposer({ open: false, kind: "reel" }); onPosted?.(p); }}
        sanitize={sanitize}
      />
    </>
  );
}
