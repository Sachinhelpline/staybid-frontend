// Tier-driven duration + step requirements (v3 — 4 mandatory + 1 optional).
// Step ids match the spec for AI-guided structured recording. Each step
// carries its ai_checks + min_pass_score for per-step server validation,
// plus Hindi prompts for staff that prefer them.

export type Tier = "silver" | "gold" | "platinum";

export type Step = {
  id: string;
  title: string;
  title_hi: string;
  prompt: string;          // shown as overlay during recording
  prompt_hi: string;
  durationTarget: [number, number]; // [min, max] seconds for this step
  minSecs: number;         // legacy field; equals durationTarget[0]
  required: boolean;
  optional?: boolean;
  ai_checks: string[];     // labels the per-step analyser must detect
  min_pass_score: number;  // 0..1
  guidance_prompts: string[];
};

// ---------------------------------------------------------------------------
// Step library (4 mandatory + 1 optional). Tier doesn't change steps; tier
// only changes total recording duration target + SLA.
// ---------------------------------------------------------------------------
export const STEPS: Step[] = [
  {
    id: "room",
    title: "Room & Amenities",
    title_hi: "कमरा और सुविधाएं",
    prompt: "Show bed, AC, TV, sofa and lights",
    prompt_hi: "बेड, AC, TV, सोफा और लाइट दिखाएं",
    durationTarget: [15, 25],
    minSecs: 15,
    required: true,
    ai_checks: ["bed_detected", "ac_detected", "good_lighting", "room_area_covered"],
    min_pass_score: 0.75,
    guidance_prompts: [
      "Bed clearly in frame? ✓",
      "AC unit visible? ✓",
      "TV on or visible? ✓",
      "Lights ON for visibility ✓",
    ],
  },
  {
    id: "washroom",
    title: "Washroom & Cleanliness",
    title_hi: "वाशरूम और सफाई",
    prompt: "Show toilet, washbasin, shower and clean towels",
    prompt_hi: "टॉयलेट, वॉशबेसिन, शावर और साफ टॉवल दिखाएं",
    durationTarget: [10, 20],
    minSecs: 10,
    required: true,
    ai_checks: ["washbasin_detected", "towel_detected", "clutter_absent"],
    min_pass_score: 0.70,
    guidance_prompts: [
      "Show toilet clearly ✓",
      "Washbasin in frame ✓",
      "Fresh towels visible ✓",
      "No garbage / clutter ✓",
    ],
  },
  {
    id: "view",
    title: "View & Window",
    title_hi: "व्यू और खिड़की",
    prompt: "Open the curtains and show the window or balcony view",
    prompt_hi: "पर्दे खोलें और खिड़की या बालकनी का व्यू दिखाएं",
    durationTarget: [8, 15],
    minSecs: 8,
    required: true,
    ai_checks: ["window_detected", "outdoor_view_present"],
    min_pass_score: 0.65,
    guidance_prompts: [
      "Open curtains fully ✓",
      "Show window / balcony ✓",
      "Daylight or clear view ✓",
    ],
  },
  {
    id: "code",
    title: "Booking Confirmation",
    title_hi: "बुकिंग कन्फर्मेशन",
    prompt: "Speak: Room number + Booking ID + the code {{code}}",
    prompt_hi: "बोलें: रूम नंबर + बुकिंग ID + कोड {{code}}",
    durationTarget: [5, 10],
    minSecs: 5,
    required: true,
    ai_checks: ["spoken_room_number", "spoken_booking_id", "spoken_dynamic_code"],
    min_pass_score: 0.90,    // anti-fraud step — high threshold
    guidance_prompts: [
      "Say: Room Number ✓",
      "Say: Booking ID ✓",
      "Say: Dynamic Code ✓",
    ],
  },
  {
    id: "extras",
    title: "Extra Amenities",
    title_hi: "अतिरिक्त सुविधाएं",
    prompt: "Show any bonus amenities — minibar, pool view, gym card",
    prompt_hi: "बोनस सुविधाएं दिखाएं — मिनीबार, पूल व्यू, जिम कार्ड",
    durationTarget: [10, 20],
    minSecs: 10,
    required: false,
    optional: true,
    ai_checks: ["extra_amenity_detected"],
    min_pass_score: 0.50,
    guidance_prompts: [
      "Minibar / fridge ✓",
      "Gym / pool access ✓",
      "Complimentary items ✓",
    ],
  },
];

export const TIER_DURATION: Record<Tier, number> = {
  silver:   60,
  gold:     120,
  platinum: 180,
};

// Step set is the same across tiers (consistent dispute-proof structure).
// Tier just controls SLA + total duration target. Platinum is encouraged to
// hit step 5 (extras) but it remains optional.
export function stepsForTier(_tier: Tier): Step[] {
  return STEPS;
}

export function durationForTier(tier: Tier): number {
  return TIER_DURATION[tier] || 60;
}

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

// Room-type → required objects (for booking-linked AI validation)
export const ROOM_TYPE_REQUIREMENTS: Record<string, string[]> = {
  Standard: ["bed", "ac", "tv", "washbasin"],
  Deluxe:   ["bed", "ac", "tv", "washbasin", "bathtub_or_shower"],
  Suite:    ["bed", "ac", "tv", "washbasin", "bathtub", "sofa", "minibar"],
  Premium:  ["bed", "ac", "tv", "washbasin", "bathtub", "sofa", "minibar", "balcony"],
};
