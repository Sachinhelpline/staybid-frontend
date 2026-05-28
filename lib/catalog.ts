// ════════════════════════════════════════════════════════════════
// v170 — StayBid platform catalog: the single source of truth for
// property types, room categories, meal plans, add-on services and
// amenities.
//
// Every surface that lets a hotel DECLARE what it offers (onboarding
// wizard, partner panel) and every surface that lets a customer ASK
// for it (/bid, hotel filters) imports these lists — so the option
// the hotel ticks and the option the customer picks are ALWAYS the
// same id. No more "customer wants a villa, sees a guest house".
//
// IDs are stable snake_case strings stored in the DB
// (hotels.property_type, hotels.meal_plans[], hotels.addon_services[],
// rooms.type). Labels/emojis are display-only and safe to retitle.
// ════════════════════════════════════════════════════════════════

/* ── Property types ──────────────────────────────────────────────
   Stored in `hotels.property_type`. The /bid page filters the
   auction to the property type the customer picked. */
export interface PropertyType { id: string; label: string; emoji: string }
export const PROPERTY_TYPES: PropertyType[] = [
  { id: "hotel",          label: "Hotel",            emoji: "🏨" },
  { id: "resort",         label: "Resort",           emoji: "🌴" },
  { id: "villa",          label: "Villa",            emoji: "🏡" },
  { id: "cottage",        label: "Cottage",          emoji: "🛖" },
  { id: "guest_house",    label: "Guest House",      emoji: "🏠" },
  { id: "homestay",       label: "Homestay",         emoji: "🏘️" },
  { id: "boutique_hotel", label: "Boutique Hotel",   emoji: "✨" },
  { id: "heritage",       label: "Heritage Stay",    emoji: "🏛️" },
  { id: "eco_resort",     label: "Eco Resort",       emoji: "🌲" },
  { id: "camp",           label: "Camp / Glamping",  emoji: "⛺" },
  { id: "lodge",          label: "Lodge",            emoji: "🪵" },
  { id: "apartment",      label: "Service Apartment",emoji: "🏢" },
  { id: "farmstay",       label: "Farmstay",         emoji: "🌾" },
  { id: "treehouse",      label: "Treehouse",        emoji: "🌳" },
  { id: "houseboat",      label: "Houseboat",        emoji: "🛥️" },
  { id: "bungalow",       label: "Bungalow",         emoji: "🏚️" },
  { id: "hostel",         label: "Hostel",           emoji: "🛏️" },
];

/* ── Room categories ─────────────────────────────────────────────
   Stored in `rooms.type`. `custom` lets a hotel type its own room
   name (the partner panel shows a free-text field for it). */
export interface RoomCategory { id: string; label: string; custom?: boolean }
export const ROOM_CATEGORIES: RoomCategory[] = [
  { id: "standard",            label: "Standard Room" },
  { id: "deluxe",              label: "Deluxe Room" },
  { id: "super_deluxe",        label: "Super Deluxe" },
  { id: "executive",           label: "Executive Room" },
  { id: "club",                label: "Club Room" },
  { id: "premium",             label: "Premium Room" },
  { id: "family",              label: "Family Room" },
  { id: "studio",              label: "Studio Room" },
  { id: "junior_suite",        label: "Junior Suite" },
  { id: "suite",               label: "Suite" },
  { id: "presidential_suite",  label: "Presidential Suite" },
  { id: "cottage",             label: "Cottage" },
  { id: "villa",               label: "Private Villa" },
  { id: "tent",                label: "Luxury Tent" },
  { id: "dormitory",           label: "Dormitory Bed" },
  { id: "custom",              label: "Custom (type room name)", custom: true },
];

// Price multiplier per room category — applied to the city/base rate
// so an upgraded category genuinely costs more on /bid.
export const ROOM_CATEGORY_MULT: Record<string, number> = {
  standard: 0.80, deluxe: 1.00, super_deluxe: 1.15, executive: 1.25,
  club: 1.30, premium: 1.35, family: 1.20, studio: 0.90,
  junior_suite: 1.45, suite: 1.60, presidential_suite: 2.20,
  cottage: 1.30, villa: 1.90, tent: 1.10, dormitory: 0.50, custom: 1.00,
};

// v241 — Default guest capacity per category. Drives the auto-fit hook
// on /bid Step 3: `minRooms = ceil(guests / avg(capacity of selected
// categories))`. Per-hotel `rooms.capacity` (which partner sets via
// "Max guests" in RoomEditorModal, default 2) overrides at hotel-page
// time and at server resolve time inside /api/bids/place. So variance
// is automatic: Hotel A's Deluxe cap=3 (custom), Hotel B's Deluxe
// cap=2 — same /bid broadcast resolves different per-hotel numRooms.
export const ROOM_CATEGORY_CAPACITY: Record<string, number> = {
  standard: 2, deluxe: 2, super_deluxe: 2, executive: 2,
  club: 2, premium: 2, family: 4, studio: 2,
  junior_suite: 3, suite: 4, presidential_suite: 6,
  cottage: 3, villa: 6, tent: 2, dormitory: 1, custom: 2,
};

// v241 — Pure helpers used by /bid + hotel page to compute minimum
// rooms needed for a given guest count + room-category mix. Used by
// auto-fit + capacity-mismatch warning. avgCap defaults to 2 when no
// roomTypes are picked (matches the most common case).
export function capacityForCategories(roomTypeIds: string[]): number {
  if (!roomTypeIds || roomTypeIds.length === 0) return 2;
  let sum = 0;
  for (const id of roomTypeIds) sum += (ROOM_CATEGORY_CAPACITY[id] || 2);
  return sum / roomTypeIds.length;
}

export function minRoomsForGuests(guests: number, roomTypeIds: string[]): number {
  const cap = capacityForCategories(roomTypeIds);
  return Math.max(1, Math.ceil(Math.max(1, guests) / Math.max(1, cap)));
}

/* ── Meal plans ──────────────────────────────────────────────────
   Stored in `hotels.meal_plans[]`. `perGuestNight` is the platform-
   standard add-on cost shown transparently on /bid (₹100-friendly).
   Hotels confirm the final price on acceptance. */
export interface MealPlan {
  id: string; label: string; code: string; perGuestNight: number; desc: string;
}
export const MEAL_PLANS: MealPlan[] = [
  { id: "room_only",     label: "Room Only",     code: "EP",  perGuestNight: 0,    desc: "No meals" },
  { id: "breakfast",     label: "Breakfast",     code: "CP",  perGuestNight: 300,  desc: "Breakfast included" },
  { id: "half_board",    label: "Half Board",    code: "MAP", perGuestNight: 700,  desc: "Breakfast + dinner" },
  { id: "full_board",    label: "Full Board",    code: "AP",  perGuestNight: 1100, desc: "All 3 meals" },
  { id: "all_inclusive", label: "All Inclusive", code: "AI",  perGuestNight: 1600, desc: "All meals + snacks" },
];

/* ── Add-on services ─────────────────────────────────────────────
   Stored in `hotels.addon_services[]`. `charge`:
     "on_request" → free / subject to availability
     "paid"       → chargeable; billed by the hotel as per actuals */
export interface AddonService {
  id: string; label: string; emoji: string;
  charge: "on_request" | "paid"; note: string;
}
export const ADDON_SERVICES: AddonService[] = [
  { id: "early_checkin",     label: "Early Check-in",     emoji: "🌅", charge: "on_request", note: "Subject to availability" },
  { id: "late_checkout",     label: "Late Check-out",     emoji: "🌇", charge: "on_request", note: "Subject to availability" },
  { id: "pet_friendly",      label: "Pet-Friendly Room",  emoji: "🐾", charge: "on_request", note: "Subject to availability" },
  { id: "smoking_room",      label: "Smoking Room",       emoji: "🚬", charge: "on_request", note: "Subject to availability" },
  { id: "doctor_on_call",    label: "Doctor on Call",     emoji: "🩺", charge: "on_request", note: "On request" },
  { id: "airport_transfer",  label: "Airport Transfer",   emoji: "🚗", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "pickup_drop",       label: "Railway/Bus Pickup", emoji: "🚕", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "extra_bed",         label: "Extra Bed",          emoji: "🛏️", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "candlelight_dinner",label: "Candlelight Dinner", emoji: "🕯️", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "room_decoration",   label: "Room Decoration",    emoji: "🎈", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "spa_session",       label: "Spa Session",        emoji: "💆", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "local_sightseeing", label: "Local Sightseeing",  emoji: "🗺️", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "cab_rental",        label: "Cab Rental",         emoji: "🚙", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "trekking_guide",    label: "Trekking Guide",     emoji: "🥾", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "bonfire",           label: "Bonfire / Campfire", emoji: "🔥", charge: "paid", note: "Paid — billed by hotel as per actuals" },
  { id: "honeymoon_package", label: "Honeymoon Package",  emoji: "💑", charge: "paid", note: "Paid — billed by hotel as per actuals" },
];

/* ── Amenities ───────────────────────────────────────────────────
   Stored in `hotels.amenities[]` / `rooms.amenities[]`. The
   onboarding + partner panel show this as a checklist. */
export interface Amenity { id: string; label: string; emoji: string }
export const AMENITIES: Amenity[] = [
  { id: "wifi",                 label: "Free Wi-Fi",            emoji: "📶" },
  { id: "parking",              label: "Parking",               emoji: "🅿️" },
  { id: "restaurant",           label: "Restaurant",            emoji: "🍽️" },
  { id: "room_service",         label: "Room Service",          emoji: "🛎️" },
  { id: "swimming_pool",        label: "Swimming Pool",         emoji: "🏊" },
  { id: "spa",                  label: "Spa",                   emoji: "💆" },
  { id: "gym",                  label: "Gym / Fitness",         emoji: "🏋️" },
  { id: "bar",                  label: "Bar / Lounge",          emoji: "🍷" },
  { id: "ac",                   label: "Air Conditioning",      emoji: "❄️" },
  { id: "heater",               label: "Room Heater",           emoji: "🔥" },
  { id: "power_backup",         label: "Power Backup",          emoji: "🔌" },
  { id: "hot_water",            label: "24h Hot Water",         emoji: "🚿" },
  { id: "tv",                   label: "Television",            emoji: "📺" },
  { id: "kitchenette",          label: "Kitchenette",           emoji: "🍳" },
  { id: "balcony",              label: "Balcony",               emoji: "🪟" },
  { id: "garden",               label: "Garden / Lawn",         emoji: "🌷" },
  { id: "mountain_view",        label: "Mountain View",         emoji: "🏔️" },
  { id: "river_view",           label: "River View",            emoji: "🏞️" },
  { id: "lake_view",            label: "Lake View",             emoji: "🌊" },
  { id: "bonfire_pit",          label: "Bonfire Pit",           emoji: "🔥" },
  { id: "kids_play_area",       label: "Kids Play Area",        emoji: "🧸" },
  { id: "conference_room",      label: "Conference Room",       emoji: "📊" },
  { id: "banquet_hall",         label: "Banquet / Event Hall",  emoji: "🎪" },
  { id: "elevator",             label: "Elevator / Lift",       emoji: "🛗" },
  { id: "cctv",                 label: "CCTV Security",         emoji: "📹" },
  { id: "travel_desk",          label: "Travel Desk",           emoji: "🧳" },
  { id: "laundry_service",      label: "Laundry Service",       emoji: "🧺" },
  { id: "library",              label: "Library / Reading",     emoji: "📚" },
  { id: "indoor_games",         label: "Indoor Games",          emoji: "🎲" },
  { id: "terrace",              label: "Terrace / Rooftop",     emoji: "🏙️" },
  { id: "ev_charging",          label: "EV Charging",           emoji: "⚡" },
  { id: "airport_shuttle",      label: "Airport Shuttle",       emoji: "🚐" },
  { id: "wheelchair_accessible",label: "Wheelchair Accessible", emoji: "♿" },
  { id: "caretaker",            label: "On-site Caretaker",     emoji: "👨‍🔧" },
  { id: "pet_friendly",         label: "Pet Friendly",          emoji: "🐾" },
];

/* ── Lookup helpers ──────────────────────────────────────────────── */
const _map = <T extends { id: string }>(arr: T[]) =>
  Object.fromEntries(arr.map((x) => [x.id, x])) as Record<string, T>;

export const PROPERTY_TYPE_MAP = _map(PROPERTY_TYPES);
export const ROOM_CATEGORY_MAP = _map(ROOM_CATEGORIES);
export const MEAL_PLAN_MAP     = _map(MEAL_PLANS);
export const ADDON_SERVICE_MAP = _map(ADDON_SERVICES);
export const AMENITY_MAP       = _map(AMENITIES);

export const propertyTypeLabel = (id?: string | null) =>
  (id && PROPERTY_TYPE_MAP[id]?.label) || "Hotel";
export const roomCategoryMult = (id?: string | null) =>
  (id && ROOM_CATEGORY_MULT[id]) || 1.0;
export const mealPlanCost = (id?: string | null) =>
  (id && MEAL_PLAN_MAP[id]?.perGuestNight) || 0;
