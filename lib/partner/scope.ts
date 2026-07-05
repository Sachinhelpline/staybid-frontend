// v285 — Multi-property scope helper.
//
// Every hotel-scoped partner route resolves the owner's hotel id(s) then reads
// data for them. This helper narrows that set to a SINGLE property when the
// dashboard passes `?hotelId=<id>` (the property switcher), while defaulting to
// ALL owned hotels ("all properties" aggregate) when the param is absent or
// "all". Ownership is enforced by the caller: `ownedHotelIds` must already be
// the resolved list from resolveOwnerIdsCrossPool → hotels?ownerId=in.(...), so
// an un-owned id can never enter the scope.
//
// Single-hotel owners (every existing hotel_owner today) get a 1-element list
// regardless of the param → byte-identical to pre-v285.

function wantHotelId(req: Request): string {
  try {
    return (new URL(req.url).searchParams.get("hotelId") || "").trim();
  } catch {
    return "";
  }
}

/** Filtered id LIST — a single [id] when a valid owned hotelId is selected, else all owned. */
export function scopeHotelIds(req: Request, ownedHotelIds: string[]): string[] {
  const want = wantHotelId(req);
  if (want && want !== "all" && ownedHotelIds.includes(want)) return [want];
  return ownedHotelIds;
}

/** Single effective hotel id — the selected one (if owned) else the first owned. */
export function scopeHotelId(req: Request, ownedHotelIds: string[]): string | null {
  const ids = scopeHotelIds(req, ownedHotelIds);
  return ids[0] || null;
}
