// v357 — Circle Model 2 basket (client-only, localStorage).
//
// The picked room-nights the buyer is building into a bundle. Shared across the
// three Model-2 journey routes (browse → property tour → review) exactly like
// Model 1's `sb_circle_room_sel_v1` contract, so the review page reads what the
// tour page wrote. A `sbc:m2-basket-change` event fires on every mutation so the
// bottom step-dock + any open page re-render live. Pure client util — no fetch.

export type M2Item = {
  key: string;          // `${listingId}|${from}|${to}` — unique per room-night set
  listingId: string; hotelId: string; roomId: string;
  title: string; city: string; room: string; image: string;
  from: string; to: string; nights: number;
  buyPerNight: number; buyerPays: number; marketAdr: number;
};

const KEY = "sb_m2_basket_v1";
const EVT = "sbc:m2-basket-change";

export function readBasket(): Record<string, M2Item> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

function write(b: Record<string, M2Item>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
    window.dispatchEvent(new Event(EVT));
  } catch { /* quota / private mode — non-fatal */ }
}

export function addItem(it: M2Item): void {
  const b = readBasket(); b[it.key] = it; write(b);
}
export function removeItem(key: string): void {
  const b = readBasket(); delete b[key]; write(b);
}
export function clearBasket(): void { write({}); }

export function basketList(): M2Item[] { return Object.values(readBasket()); }
export function basketCount(): number { return Object.keys(readBasket()).length; }

/** Subscribe to basket changes (mutations, cross-tab storage, focus). Returns an unsubscribe. */
export function onBasketChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", cb);
  };
}

export const M2_BASKET_KEY = KEY;
export const M2_BASKET_EVENT = EVT;
