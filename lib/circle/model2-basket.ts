// v357 — Circle Model 2 basket (client-only, localStorage).
//
// The picked room-nights the buyer is building into a bundle. Shared across the
// three Model-2 journey routes (browse → property tour → review) exactly like
// Model 1's `sb_circle_room_sel_v1` contract, so the review page reads what the
// tour page wrote. A `sbc:m2-basket-change` event fires on every mutation so the
// bottom step-dock + any open page re-render live. Pure client util — no fetch.

export type M2Item = {
  key: string;          // = listingId — one bundle line per room (its picked nights)
  listingId: string; hotelId: string; roomId: string;
  title: string; city: string; room: string; image: string;
  dates: string[];      // v358 — the individual nights the buyer picked (may be non-contiguous, across months)
  nights: number;
  buyPerNight: number; buyerPays: number; marketAdr: number;
};

const addDays = (s: string, n: number) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

/** Group a set of night-dates into CONTIGUOUS runs [from, to). Each run is one
 *  stay the checkout can reserve; non-adjacent nights become separate runs. */
export function groupRuns(dates: string[]): { from: string; to: string; nights: number }[] {
  const sorted = Array.from(new Set(dates)).sort();
  const runs: { from: string; to: string; nights: number }[] = [];
  let i = 0;
  while (i < sorted.length) {
    const from = sorted[i];
    let n = 1;
    while (i + n < sorted.length && sorted[i + n] === addDays(from, n)) n++;
    runs.push({ from, to: addDays(from, n), nights: n });
    i += n;
  }
  return runs;
}

/** Price a picked set of nights EXACTLY as the server will (per-run b2bTradeSplit
 *  rounding): buy = buyPerNight × nights; fee = Σ round(runSubtotal × feePct/100). */
export function priceNights(buyPerNight: number, feePct: number, dates: string[]): { nights: number; subtotal: number; fee: number; buyerPays: number } {
  const runs = groupRuns(dates);
  let subtotal = 0, fee = 0;
  for (const r of runs) {
    const st = Math.round(buyPerNight) * r.nights;
    subtotal += st;
    fee += Math.round((st * (Number(feePct) || 0)) / 100);
  }
  return { nights: dates.length, subtotal, fee, buyerPays: subtotal + fee };
}

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
