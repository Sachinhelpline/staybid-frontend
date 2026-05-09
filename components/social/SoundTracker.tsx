"use client";
// 🎵 Sound name + mute toggle (everyone) + Change-sound (sound owner only).
// Visibility rule:
//   - Sound name + mute → visible to ALL viewers
//   - "Change sound" → only when canChange=true (sound_owner_id matches viewer)
type Props = {
  trackName: string;
  authorHandle: string;
  muted: boolean;
  onToggleMute: () => void;
  canChange?: boolean;
  onChange?: () => void;
};

export function SoundTracker({ trackName, authorHandle, muted, onToggleMute, canChange, onChange }: Props) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full"
      style={{
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <span className="text-[0.78rem]" style={{ animation: "spin 6s linear infinite" }}>🎵</span>
      <span className="flex-1 min-w-0 text-white/90 text-[0.66rem] truncate">
        <span className="font-semibold">{trackName || "Original Audio"}</span>
        {authorHandle && <span className="text-white/55"> · @{authorHandle}</span>}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
        className="text-white text-[0.78rem]"
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? "🔇" : "🔊"}
      </button>
      {canChange && (
        <button
          onClick={(e) => { e.stopPropagation(); onChange?.(); }}
          className="text-gold-300 text-[0.6rem] font-bold uppercase tracking-wide pl-1 border-l border-white/15"
          style={{ marginLeft: 4, paddingLeft: 8 }}
        >
          Change
        </button>
      )}
    </div>
  );
}
