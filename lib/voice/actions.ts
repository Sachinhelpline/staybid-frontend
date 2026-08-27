// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — typed UI action dispatcher (/hotels).
//
// makeVoiceActionDispatcher() turns a runtime-validated VoiceUiAction into calls
// on the /hotels page's OWN existing state setters + router. It NEVER:
//   • constructs an arbitrary router destination (OPEN_HOTEL routes ONLY to
//     /hotels/<id> and ONLY after re-checking the id is allowlisted)
//   • reads a model-supplied url / route / selector (the union has no such field)
//   • executes model-produced JS
//
// A malformed / unknown action is dropped (fail closed) and reported via the
// return value — no throw, no side effect.
//
// PREPARE_BID_DRAFT is LOCAL-ONLY draft/preview state: it performs zero network
// mutation, persists nothing, submits nothing. This dispatcher only hands it to
// an optional local callback.
//
// Pure factory: no React, no next/* imports. The page injects its setters + a
// minimal router shim ({ push }).
// ─────────────────────────────────────────────────────────────────────────
import { type VoiceUiAction, validateUiAction, isValidHotelId } from "./contracts";

export interface RouterShim {
  push: (path: string) => void;
}

export interface VoiceActionContext {
  setCity: (v: string) => void;
  setSearch: (v: string) => void;
  setSearchOpen: (v: boolean) => void;
  setSortBy: (v: "default" | "price-asc" | "price-desc" | "rating") => void;
  setSelectedStars: (v: Set<number>) => void;
  setFilterOpen?: (v: boolean) => void;
  router: RouterShim;
  /** True only for ids surfaced this session (search / page context). */
  isHotelAllowlisted: (id: string) => boolean;
  // Optional local presentation hooks (no network).
  onShowResults?: () => void;
  onShowFlashDeals?: (city: string | null) => void;
  onShowComparison?: (hotelIds: string[]) => void;
  onPrepareBidDraft?: (draft: { hotelId: string; pricePerNight: number | null }) => void;
}

export type DispatchOutcome =
  | { ok: true; action: VoiceUiAction["type"] }
  | { ok: false; reason: "invalid_action" | "hotel_id_not_allowlisted" };

export function makeVoiceActionDispatcher(ctx: VoiceActionContext) {
  return function dispatchVoiceAction(candidate: unknown): DispatchOutcome {
    const action = validateUiAction(candidate);
    if (!action) return { ok: false, reason: "invalid_action" };

    switch (action.type) {
      case "FOCUS_SEARCH":
        ctx.setSearchOpen(true);
        return { ok: true, action: action.type };

      case "APPLY_SEARCH":
        if (action.city != null) ctx.setCity(action.city);
        if (action.query != null) ctx.setSearch(action.query);
        return { ok: true, action: action.type };

      case "APPLY_FILTERS":
        if (action.sort) ctx.setSortBy(action.sort);
        if (action.stars) ctx.setSelectedStars(new Set(action.stars));
        return { ok: true, action: action.type };

      case "SHOW_RESULTS":
        ctx.setSearchOpen(false);
        ctx.setFilterOpen?.(false);
        ctx.onShowResults?.();
        return { ok: true, action: action.type };

      case "OPEN_HOTEL": {
        // Re-check id validity AND allowlist membership before ANY navigation.
        if (!isValidHotelId(action.hotelId) || !ctx.isHotelAllowlisted(action.hotelId)) {
          return { ok: false, reason: "hotel_id_not_allowlisted" };
        }
        // The ONLY destination this dispatcher can ever build.
        ctx.router.push(`/hotels/${encodeURIComponent(action.hotelId)}`);
        return { ok: true, action: action.type };
      }

      case "SHOW_FLASH_DEALS":
        ctx.onShowFlashDeals?.(action.city);
        return { ok: true, action: action.type };

      case "SHOW_COMPARISON": {
        // REV-05: fail CLOSED — if ANY supplied id is not allowlisted, reject the
        // ENTIRE action. No partial subset is ever executed and the callback is
        // not invoked. (Ids are already format-validated by validateUiAction.)
        if (action.hotelIds.some((id) => !ctx.isHotelAllowlisted(id))) {
          return { ok: false, reason: "hotel_id_not_allowlisted" };
        }
        ctx.onShowComparison?.(action.hotelIds);
        return { ok: true, action: action.type };
      }

      case "PREPARE_BID_DRAFT": {
        if (!ctx.isHotelAllowlisted(action.hotelId)) {
          return { ok: false, reason: "hotel_id_not_allowlisted" };
        }
        // LOCAL draft ONLY — no network, no persistence, no submission.
        ctx.onPrepareBidDraft?.({ hotelId: action.hotelId, pricePerNight: action.pricePerNight });
        return { ok: true, action: action.type };
      }

      default:
        return { ok: false, reason: "invalid_action" };
    }
  };
}
