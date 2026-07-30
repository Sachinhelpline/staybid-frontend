"use client";
// Bottom row CTAs: From-price · Save · Book Now · Bid.
// Only renders when the post has a tagged hotel — public/creator posts
// without a hotel hide this row entirely.
type Props = {
  fromPrice?: number | null;
  onSave?: () => void;
  onBookNow?: () => void;
  onBid?: () => void;
  saved?: boolean;
};

export function BookingCTABar({ fromPrice, onSave, onBookNow, onBid, saved }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {typeof fromPrice === "number" && fromPrice > 0 && (
        <div className="flex flex-col leading-none px-2">
          <span className="text-white/55 text-[0.5rem] uppercase tracking-widest">From</span>
          <span className="text-white font-bold text-[0.92rem]">
            ₹{fromPrice.toLocaleString()}
            <span className="text-white/55 text-[0.55rem] font-normal ml-1">/n</span>
          </span>
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onSave?.(); }}
        className="px-3 py-2 rounded-xl text-[0.74rem] font-bold flex items-center gap-1"
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#fff",
        }}
      >
        🔖 {saved ? "Saved" : "Save"}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onBookNow?.(); }}
        className="flex-1 py-2 px-2 rounded-xl text-[0.78rem] font-bold flex items-center justify-center gap-1"
        style={{
          color: "#1a1208",
          background: "linear-gradient(160deg,#e6edf3 0%,#c9d4df 52%,#a4b5c6 100%)",
          border: "1px solid rgba(255,255,255,0.45)",
          boxShadow: "0 4px 12px rgba(140, 160, 182,0.4), inset 0 1px 0 rgba(255,255,255,0.5)",
        }}
      >
        🏷 Book Now
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onBid?.(); }}
        className="flex-1 py-2 px-2 rounded-xl text-[0.78rem] font-bold flex items-center justify-center gap-1"
        style={{
          color: "#fff",
          background: "linear-gradient(135deg, rgba(155,109,255,0.45), rgba(94,52,184,0.40))",
          border: "1px solid rgba(199,140,255,0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      >
        ⚡ Bid
      </button>
    </div>
  );
}
