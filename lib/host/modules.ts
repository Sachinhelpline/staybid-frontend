// ============================================================================
// StayBid for Hosts (Hospitality Business OS) — shared catalog
// Single source of truth for the /host landing + every module sub-route.
// Content mirrors the marketing surface; consumed by app/host/page.tsx.
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

// Phase 1 ships the landing + foundation. Each module flips `live: true`
// in its own phase (P2 studio, P3 store, P4 discovery, P5 workforce, P6 channels).
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
    live: false,
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
    live: false,
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
    live: false,
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
    live: false,
  },
];

export const HOW_IT_WORKS = [
  { n: 1, title: "Select & Setup", desc: "Find property, choose design, setup everything with StayBid.", time: "2–3 Days" },
  { n: 2, title: "Launch & List",  desc: "We list on all major OTAs, manage bookings & pricing for you.", time: "1–2 Days" },
  { n: 3, title: "Manage Easily",  desc: "We handle operations, housekeeping & guest support.",          time: "30 Mins/Day" },
  { n: 4, title: "Grow & Earn",    desc: "More bookings, higher revenue, zero stress.",                    time: "30 Mins/Day" },
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

export const HOST_STATS = [
  { value: "5000+",    label: "Active Hosts" },
  { value: "25+",      label: "Cities Covered" },
  { value: "10K+",     label: "Properties Managed" },
  { value: "₹500Cr+",  label: "Revenue Generated" },
  { value: "4.8★",     label: "Host Rating" },
];

export const HOST_BENEFITS = [
  { icon: "📈", title: "More Bookings",   sub: "Higher Occupancy" },
  { icon: "💰", title: "Increase Revenue", sub: "Maximize Profits" },
  { icon: "😌", title: "Zero Stress",      sub: "We Handle Everything" },
  { icon: "⏱️", title: "Time Saver",       sub: "1 Hour a Day Business" },
  { icon: "🛟", title: "Expert Support",   sub: "24/7 Assistance" },
  { icon: "🚀", title: "Business Growth",  sub: "Scale Multiple Properties" },
];

export const HOST_TRUST = [
  "100% Genuine Products", "Quality Checked", "Best Prices Guaranteed",
  "Pan India Delivery", "Installation Support",
];
