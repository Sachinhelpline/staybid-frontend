// Tier-driven duration + step requirements for the StayBid Video Verification
// system. Each tier dictates the recording length and which guided prompts the
// hotel partner (and customer for complaints) must complete in a single take.

export type Tier = "silver" | "gold" | "platinum";

export type Step = {
  id: string;
  prompt: string;          // shown as overlay during recording
  minSecs: number;         // minimum dwell time on this step
  required: boolean;
};

export const TIER_DURATION: Record<Tier, number> = {
  silver:   60,
  gold:     120,
  platinum: 180,
};

// Step library (ordered). Hotel must hit each non-disabled step in sequence.
const SHARED_STEPS: Step[] = [
  { id: "code",      prompt: "Speak this code clearly: {{code}}", minSecs: 4, required: true },
  { id: "room_no",   prompt: "Show the room number plate clearly", minSecs: 4, required: true },
  { id: "beds",      prompt: "Pan across the beds", minSecs: 5, required: true },
  { id: "amenities", prompt: "Show AC, TV and WiFi router", minSecs: 8, required: true },
  { id: "washroom",  prompt: "Walk into the washroom and show fixtures", minSecs: 8, required: true },
  { id: "view",      prompt: "Show the view from the window or balcony", minSecs: 6, required: true },
];

const GOLD_EXTRA: Step[] = [
  { id: "booking_id", prompt: "Speak the Booking ID and today's date", minSecs: 6, required: true },
];

const PLATINUM_EXTRA: Step[] = [
  { id: "geo_capture", prompt: "Hold steady — geo & timestamp lock", minSecs: 4, required: true },
  { id: "wide_walk",   prompt: "Slow 360° walkthrough of the room", minSecs: 12, required: true },
];

export function stepsForTier(tier: Tier): Step[] {
  if (tier === "platinum") return [...SHARED_STEPS, ...GOLD_EXTRA, ...PLATINUM_EXTRA];
  if (tier === "gold")     return [...SHARED_STEPS, ...GOLD_EXTRA];
  return SHARED_STEPS;
}

export function durationForTier(tier: Tier): number {
  return TIER_DURATION[tier] || 60;
}

// SLA — how long after a request the hotel has to upload (in hours).
export const SLA_HOURS: Record<Tier, number> = {
  silver:   24,
  gold:     12,
  platinum: 4,
};

export function isValidTier(t: any): t is Tier {
  return t === "silver" || t === "gold" || t === "platinum";
}

export function normaliseTier(t: any): Tier {
  return isValidTier(t) ? t : "silver";
}
