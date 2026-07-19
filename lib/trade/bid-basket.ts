// v361 — Model 3 agent BID BASKET (client-only, localStorage).
// The bundle of bids an agent is building across lots/segments before paying the
// single EMD deposit. Shared between the browse page and the review page; a
// `sbt:bid-basket-change` event fires on every mutation so open pages re-render.
// One line per (lot + segment) — an agent may bid different segments of one lot.

export type BidItem = {
  key: string;            // `${lotId}:${segmentType}:${weekIndex ?? ''}`
  lotId: string;
  hotelName: string; roomName: string; city: string; image: string;
  monthKey: string;
  segmentType: "full_month" | "week" | "weekend";
  weekIndex?: number;
  segmentLabel: string;
  nights: number;
  minBid: number;         // lot floor per room-night (for client-side guard/display)
  perRoomPerNight: number;
  roomsWanted: number;
};

const KEY = "sb_trade_bidbasket_v1";
const EVT = "sbt:bid-basket-change";

export function readBidBasket(): Record<string, BidItem> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

function write(obj: Record<string, BidItem>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch { /* ignore quota */ }
}

export function bidItemKey(lotId: string, segmentType: string, weekIndex?: number): string {
  return `${lotId}:${segmentType}:${weekIndex ?? ""}`;
}

export function addBid(item: BidItem) {
  const obj = readBidBasket();
  obj[item.key] = item;
  write(obj);
}

export function removeBid(key: string) {
  const obj = readBidBasket();
  delete obj[key];
  write(obj);
}

export function clearBidBasket() {
  write({});
}

export function bidBasketList(): BidItem[] {
  return Object.values(readBidBasket());
}

export function onBidBasketChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = () => cb();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener(EVT, h); window.removeEventListener("storage", h); };
}
