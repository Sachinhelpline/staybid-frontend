// ============================================================================
// StayBid for Hosts — Managed Hospitality Portfolio Platform — shared catalog
// Single source of truth for the /host landing + every module sub-route.
// Reframed (v272) from "modules" to a budget-tier managed-ownership model:
// partner picks a budget tier, StayBid sets up + runs properties across cities,
// partner earns returns, StayBid handles operations for a platform cut.
// ============================================================================

export type HostModuleKey =
  | "list" | "studio" | "store" | "discovery" | "workforce" | "channels";

export interface HostModule {
  key: HostModuleKey;
  title: string;
  tagline: string;
  desc: string;
  icon: string;          // emoji
  href: string;
  cta: string;
  accent: string;        // hex for card accent
  live: boolean;         // false = "Coming soon" (built in later phases)
}

// Each module flips `live: true` in its own phase
// (P2 studio, P3 store, P4 discovery, P5 workforce, P6 channels).
export const HOST_MODULES: HostModule[] = [
  {
    key: "list",
    title: "List & Launch",
    tagline: "Go live on every OTA",
    desc: "AI-assisted listing, instant deployment to StayBid + all major OTAs.",
    icon: "🚀",
    href: "/onboard",
    cta: "List your property",
    accent: "#c9911a",
    live: true,
  },
  {
    key: "studio",
    title: "AI Setup & Design Studio",
    tagline: "Smart, real & budget-friendly",
    desc: "Upload your space, get 5–10 ready-to-shop setup options per style.",
    icon: "🎨",
    href: "/host/studio",
    cta: "Design my space",
    accent: "#7c3aed",
    live: true,
  },
  {
    key: "store",
    title: "StayBid Store",
    tagline: "Buy, Rent or EMI — your choice",
    desc: "Furniture, appliances & amenities. Genuine products, best prices, EMI.",
    icon: "🛋️",
    href: "/host/store",
    cta: "Shop the store",
    accent: "#0d9488",
    live: true,
  },
  {
    key: "discovery",
    title: "Smart Property Discovery",
    tagline: "Find the perfect BnB property",
    desc: "Compare, shortlist & rent the best property at the best price.",
    icon: "🔍",
    href: "/host/properties",
    cta: "Discover properties",
    accent: "#2563eb",
    live: true,
  },
  {
    key: "workforce",
    title: "Workforce on Demand",
    tagline: "India's hospitality staff network",
    desc: "Trained, verified, on-demand staff for your property — pay per job.",
    icon: "🧑‍🔧",
    href: "/host/workforce",
    cta: "Hire staff",
    accent: "#9a3412",
    live: true,
  },
  {
    key: "channels",
    title: "Channel Manager",
    tagline: "All channels. One dashboard.",
    desc: "Manage every OTA from one place — real-time sync, zero chaos.",
    icon: "🔗",
    href: "/host/channels",
    cta: "Connect channels",
    accent: "#1d4ed8",
    live: true,
  },
];

// ── Channel Manager — supported OTAs (P6) ───────────────────────────────────
// Shared by /host/channels (display) + /api/host/channels (validation).
export interface HostChannel {
  key: "booking" | "airbnb" | "mmt" | "goibibo" | "agoda" | "expedia" | "tripadvisor" | "other";
  name: string;
  icon: string;      // emoji
  accent: string;    // brand-ish hex
  blurb: string;
}

export const HOST_CHANNELS: HostChannel[] = [
  { key: "booking",     name: "Booking.com",  icon: "🛏️", accent: "#1d4ed8", blurb: "World's largest OTA — huge global reach" },
  { key: "airbnb",      name: "Airbnb",       icon: "🏠", accent: "#e11d48", blurb: "Top platform for homestays & unique stays" },
  { key: "mmt",         name: "MakeMyTrip",   icon: "✈️", accent: "#dc2626", blurb: "India's #1 travel platform" },
  { key: "goibibo",     name: "Goibibo",      icon: "🧳", accent: "#2563eb", blurb: "Big domestic demand, deal-hungry travellers" },
  { key: "agoda",       name: "Agoda",        icon: "🌏", accent: "#7c3aed", blurb: "Strong across Asia-Pacific" },
  { key: "expedia",     name: "Expedia",      icon: "🗺️", accent: "#f59e0b", blurb: "Global brand, package travellers" },
  { key: "tripadvisor", name: "Tripadvisor",  icon: "🦉", accent: "#0d9488", blurb: "Reviews + bookings in one place" },
  { key: "other",       name: "Other channel", icon: "🔗", accent: "#6b7280", blurb: "Any other OTA or direct channel" },
];

// Channel-connection lifecycle (mirrors host_channels.status CHECK).
export const HOST_CHANNEL_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "Requested",  tone: "#b45309" },
  connected: { label: "Connected",  tone: "#15803d" },
  syncing:   { label: "Syncing…",   tone: "#1d4ed8" },
  error:     { label: "Needs attention", tone: "#b91c1c" },
  paused:    { label: "Paused",     tone: "#6b7280" },
};

// ── Budget tiers — the heart of the managed-portfolio model ─────────────────
export interface HostBudgetTier {
  key: "explorer" | "adventurer" | "trailblazer" | "elite";
  name: string;
  invest: string;          // headline investment
  investNote: string;      // small print
  rooms: string;           // what you get
  cities: string;
  expectedReturn: string;  // monthly / annual return band
  accent: string;
  perks: string[];
  popular?: boolean;
}

export const HOST_BUDGET_TIERS: HostBudgetTier[] = [
  {
    key: "explorer",
    name: "Explorer",
    invest: "₹20,000",
    investNote: "start small, learn the ropes",
    rooms: "1 managed room",
    cities: "1 city",
    expectedReturn: "8–12% p.a.",
    accent: "#0d9488",
    perks: [
      "1 room set up & listed for you",
      "Listed on StayBid + 2 OTAs",
      "Basic AI pricing",
      "Shared housekeeping pool",
    ],
  },
  {
    key: "adventurer",
    name: "Adventurer",
    invest: "₹50,000",
    investNote: "build a small footprint",
    rooms: "2–3 managed rooms",
    cities: "up to 2 cities",
    expectedReturn: "10–14% p.a.",
    accent: "#2563eb",
    perks: [
      "2–3 rooms set up & listed",
      "Listed on StayBid + all major OTAs",
      "Smart AI yield pricing",
      "Priority housekeeping",
      "Monthly performance report",
    ],
    popular: true,
  },
  {
    key: "trailblazer",
    name: "Trailblazer",
    invest: "₹1,00,000",
    investNote: "scale into a mini portfolio",
    rooms: "4–6 managed rooms",
    cities: "up to 3 cities",
    expectedReturn: "12–16% p.a.",
    accent: "#7c3aed",
    perks: [
      "4–6 rooms across multiple cities",
      "Full channel manager + flash deals",
      "Dedicated City Manager",
      "Verification video + Stay Score boost",
      "Quarterly portfolio review",
    ],
  },
  {
    key: "elite",
    name: "Elite",
    invest: "₹2,00,000+",
    investNote: "full managed portfolio",
    rooms: "7+ managed rooms",
    cities: "unlimited cities",
    expectedReturn: "14–20% p.a.",
    accent: "#c9911a",
    perks: [
      "7+ rooms, multi-city portfolio",
      "Dedicated Ops Manager + City Manager",
      "Premium design studio + custom branding",
      "Lowest platform commission",
      "White-glove concierge & priority payouts",
    ],
  },
];

// ── Traditional way vs StayBid way ──────────────────────────────────────────
export const TRADITIONAL_CHALLENGES = [
  { icon: "😰", title: "Find & vet property alone", sub: "weeks of legwork" },
  { icon: "💸", title: "Heavy upfront setup cost", sub: "furniture, design, deposits" },
  { icon: "📉", title: "Guesswork pricing", sub: "empty rooms, lost revenue" },
  { icon: "🧹", title: "Manage staff & ops yourself", sub: "daily headache" },
  { icon: "📵", title: "List on each OTA manually", sub: "double bookings, chaos" },
  { icon: "🤷", title: "No real support", sub: "you're on your own" },
];

export const STAYBID_HANDLES = [
  { icon: "🏠", title: "We find & vet the property", sub: "best location, best price" },
  { icon: "🎨", title: "We design & set it up", sub: "AI studio + StayBid Store" },
  { icon: "🤖", title: "We price it smartly", sub: "AI yield, always competitive" },
  { icon: "🧑‍🔧", title: "We run the operations", sub: "housekeeping, check-in, guests" },
  { icon: "🔗", title: "We list everywhere", sub: "one dashboard, all OTAs synced" },
  { icon: "🛟", title: "We support you 24/7", sub: "City + Ops Managers on call" },
];

// ── The managed operations system ───────────────────────────────────────────
export const HOST_OPERATIONS = [
  { icon: "🛎️", title: "Guest Management", sub: "Check-in to check-out, handled" },
  { icon: "🧹", title: "Housekeeping", sub: "Verified on-demand staff network" },
  { icon: "💰", title: "Dynamic Pricing", sub: "AI yield engine, 24×7" },
  { icon: "📊", title: "Revenue Reports", sub: "Transparent monthly payouts" },
  { icon: "🎥", title: "Quality Verification", sub: "Video + Stay Score system" },
  { icon: "📣", title: "Marketing & Reels", sub: "Reach 100K+ travellers" },
];

// ── 6-step partner journey ──────────────────────────────────────────────────
export const HOW_IT_WORKS = [
  { n: 1, title: "Choose Your Budget", desc: "Pick a tier from ₹20K to ₹2L+. Your investment, your pace.", time: "5 Mins" },
  { n: 2, title: "Pick Your Cities",   desc: "Select from 15+ metros. We find the right properties for you.", time: "1 Day" },
  { n: 3, title: "Select Properties",  desc: "Compare, shortlist & lock the best BnB properties.",            time: "2–3 Days" },
  { n: 4, title: "Choose the Design",  desc: "AI Design Studio + StayBid Store set everything up.",           time: "3–5 Days" },
  { n: 5, title: "Launch & Earn",      desc: "We list on all OTAs, run ops & manage every booking.",          time: "1–2 Days" },
  { n: 6, title: "Grow Your Portfolio",desc: "Reinvest returns, add rooms & cities. Scale stress-free.",      time: "Ongoing" },
];

// ── Inventory structure / scale band ────────────────────────────────────────
export const HOST_INVENTORY = [
  { value: "15+", label: "Cities" },
  { value: "300+", label: "Properties" },
  { value: "50+", label: "Partners" },
  { value: "500+", label: "Rooms" },
];

// ── Technology + team that runs it ──────────────────────────────────────────
export const HOST_TEAM = [
  { icon: "👔", title: "City Manager", sub: "Your on-ground point of contact in each city" },
  { icon: "⚙️", title: "Ops Manager", sub: "Runs housekeeping, check-ins & guest support" },
  { icon: "🤖", title: "AI Pricing Engine", sub: "Sets the right price for every room, every night" },
  { icon: "📱", title: "Partner App", sub: "Track earnings, bookings & ops in real time" },
];

export const PROPERTY_TYPES = [
  { name: "Luxury Apartments", sub: "High Rise Living",      icon: "🏙️" },
  { name: "Service Apartments", sub: "Comfort & Convenience", icon: "🏢" },
  { name: "Villas & Bungalows", sub: "Premium Stays",         icon: "🏡" },
  { name: "Penthouses",        sub: "Skyline Experiences",    icon: "🌆" },
  { name: "Studio Apartments", sub: "Smart & Cozy",           icon: "🛏️" },
  { name: "Urban Homestays",   sub: "Local Experiences",      icon: "🏠" },
  { name: "Co-Living Spaces",  sub: "Community Living",        icon: "👥" },
  { name: "Commercial Spaces", sub: "Business Stays",         icon: "🏬" },
];

export const HOST_CITIES = [
  { name: "Mumbai",    sub: "The Financial Capital" },
  { name: "Delhi NCR", sub: "The Heart of India" },
  { name: "Bangalore", sub: "The Silicon Valley" },
  { name: "Hyderabad", sub: "The City of Pearls" },
  { name: "Pune",      sub: "The Oxford of the East" },
  { name: "Chennai",   sub: "The Detroit of India" },
  { name: "Kolkata",   sub: "The City of Joy" },
  { name: "Ahmedabad", sub: "The Manchester of India" },
];

// Bottom stats band (matches the richer infographic numbers).
export const HOST_STATS = [
  { value: "15+",   label: "Cities" },
  { value: "300+",  label: "Properties" },
  { value: "50+",   label: "Partners" },
  { value: "500+",  label: "Rooms" },
  { value: "10K+",  label: "Bookings" },
  { value: "100K+", label: "Travellers Reached" },
];

export const HOST_BENEFITS = [
  { icon: "📈", title: "Passive Returns",   sub: "8–20% p.a. on your investment" },
  { icon: "💰", title: "Zero Setup Hassle", sub: "We handle design to launch" },
  { icon: "😌", title: "Fully Managed",     sub: "We run every operation" },
  { icon: "⏱️", title: "Time Saver",        sub: "Earn while we do the work" },
  { icon: "🛟", title: "Expert Support",    sub: "City & Ops Managers on call" },
  { icon: "🚀", title: "Scale a Portfolio", sub: "Add rooms & cities anytime" },
];

export const HOST_TRUST = [
  "100% Transparent Payouts", "Verified Properties", "Best-Price Guarantee",
  "Pan-India Network", "Full Operations Support",
];
