// ═══════════════════════════════════════════════════════════════════════════
// Route manifest for the responsive audit. Phase 1 = CUSTOMER surface, so
// those are listed first and audited by default. `auth` marks routes that
// normally need a logged-in session (they may redirect to /onboard — the
// auditor records the redirect and still audits whatever renders).
//
// Dynamic segments are filled with representative sample values; a 404/empty
// shell still exercises the layout chrome, which is what we audit in pass 1.
// ═══════════════════════════════════════════════════════════════════════════

export const CUSTOMER_ROUTES = [
  { path: "/",                 name: "home-reels",        auth: false },
  { path: "/discover",         name: "discover",          auth: false },
  { path: "/reels",            name: "reels",             auth: false },
  { path: "/hotels",           name: "hotels-catalog",    auth: false },
  { path: "/flash-deals",      name: "flash-deals",       auth: false },
  { path: "/bid",              name: "bid-pit",           auth: false },
  { path: "/my-bids",          name: "my-bids",           auth: true  },
  { path: "/wallet",           name: "wallet",            auth: true  },
  { path: "/points",           name: "points",            auth: true  },
  { path: "/points/redeem",    name: "points-redeem",     auth: true  },
  { path: "/my-codes",         name: "my-codes",          auth: true  },
  { path: "/saved",            name: "saved",             auth: true  },
  { path: "/saved/posts",      name: "saved-posts",       auth: true  },
  { path: "/bookings",         name: "bookings",          auth: true  },
  { path: "/complaints",       name: "complaints",        auth: true  },
  { path: "/upgrade",          name: "upgrade",           auth: false },
  { path: "/verification",     name: "verification",      auth: true  },
  { path: "/profile",          name: "profile",           auth: true  },
  { path: "/me",               name: "me-profile",        auth: true  },
  { path: "/me/posts",         name: "me-posts",          auth: true  },
  { path: "/social/feed",      name: "social-feed",       auth: false },
  { path: "/social/profile",   name: "social-profile",    auth: true  },
  { path: "/social/upload",    name: "social-upload",     auth: true  },
  { path: "/onboard",          name: "onboard",           auth: false },
  { path: "/onboard/signin",   name: "onboard-signin",    auth: false },
  { path: "/onboard/signup",   name: "onboard-signup",    auth: false },
  { path: "/passport",         name: "passport",          auth: true  },
  { path: "/trust",            name: "trust",             auth: false },
  { path: "/privacy-policy",   name: "privacy-policy",    auth: false },
  { path: "/verification/record", name: "verification-record", auth: true },
  // dynamic — representative sample values
  { path: "/hotels/sample",    name: "hotel-detail",      auth: false, dynamic: true },
  { path: "/hotels/sample/reviews",  name: "hotel-reviews",  auth: false, dynamic: true },
  { path: "/hotels/sample/feedback", name: "hotel-feedback", auth: false, dynamic: true },
  { path: "/u/staybid",        name: "user-public",       auth: false, dynamic: true },
  { path: "/tag/mussoorie",    name: "tag",               auth: false, dynamic: true },
  { path: "/r/SAMPLE",         name: "referral-code",     auth: false, dynamic: true },
];

// Other surfaces — audited in later phases (kept here so the harness is reusable).
export const PARTNER_ROUTES = [
  { path: "/partner",            name: "partner-home",     auth: true },
  { path: "/partner/dashboard",  name: "partner-dash",     auth: true },
  { path: "/partner/staff",      name: "partner-staff",    auth: true },
  { path: "/partner/verification", name: "partner-verify", auth: true },
];

export const ADMIN_ROUTES = [
  { path: "/admin/login",            name: "admin-login",        auth: false },
  { path: "/admin",                  name: "admin-dashboard",    auth: true },
  { path: "/admin/users",            name: "admin-users",        auth: true },
  { path: "/admin/hotels",           name: "admin-hotels",       auth: true },
  { path: "/admin/bookings",         name: "admin-bookings",     auth: true },
  { path: "/admin/creators",         name: "admin-creators",     auth: true },
  { path: "/admin/content",          name: "admin-content",      auth: true },
  { path: "/admin/verification",     name: "admin-verification", auth: true },
  { path: "/admin/complaints",       name: "admin-complaints",   auth: true },
  { path: "/admin/feedback",         name: "admin-feedback",     auth: true },
  { path: "/admin/pricing",          name: "admin-pricing",      auth: true },
  { path: "/admin/fraud",            name: "admin-fraud",        auth: true },
  { path: "/admin/finance",          name: "admin-finance",      auth: true },
  { path: "/admin/revenue",          name: "admin-revenue",      auth: true },
  { path: "/admin/holds",            name: "admin-holds",        auth: true },
  { path: "/admin/hold-config",      name: "admin-hold-config",  auth: true },
  { path: "/admin/analytics",        name: "admin-analytics",    auth: true },
  { path: "/admin/messages",         name: "admin-messages",     auth: true },
  { path: "/admin/commission-rules", name: "admin-commission",   auth: true },
  { path: "/admin/hotel-commission-rules", name: "admin-hotel-commission", auth: true },
  { path: "/admin/services",         name: "admin-services",     auth: true },
  { path: "/admin/redemption-rules", name: "admin-redeem-rules", auth: true },
  { path: "/admin/redemption-codes", name: "admin-redeem-codes", auth: true },
  { path: "/admin/reports",          name: "admin-reports",      auth: true },
  { path: "/admin/notifications",    name: "admin-notifications",auth: true },
  { path: "/admin/support",          name: "admin-support",      auth: true },
  { path: "/admin/support/metrics",  name: "admin-support-metrics", auth: true },
  { path: "/admin/videos",           name: "admin-videos",       auth: true },
  { path: "/admin/settings",         name: "admin-settings",     auth: true },
  { path: "/admin/rls",              name: "admin-rls",          auth: true },
];

// Creator/influencer hub. The hub layout gates on /api/influencer/me; the
// auditor mocks that endpoint to {registered:true} under --auth so the real
// hub chrome renders instead of bouncing to /upgrade. The public profile skips
// the gate entirely.
export const CREATOR_ROUTES = [
  { path: "/influencer/dashboard", name: "creator-dashboard", auth: true },
  { path: "/influencer/earnings",  name: "creator-earnings",  auth: true },
  { path: "/influencer/referrals", name: "creator-referrals", auth: true },
  { path: "/influencer/bookings",  name: "creator-bookings",  auth: true },
  { path: "/influencer/upload",    name: "creator-upload",    auth: true },
  { path: "/influencer/profile",   name: "creator-profile",   auth: true },
  { path: "/influencer/public/sample", name: "creator-public", auth: false, dynamic: true },
];

// Hotel-owner self-onboarding funnel. signin/signup/verify render without a
// backend; the wizard gates on an sb_onboard_token (injected under --auth).
export const ONBOARD_ROUTES = [
  { path: "/onboard",         name: "onboard-landing", auth: false },
  { path: "/onboard/signin",  name: "onboard-signin",  auth: false },
  { path: "/onboard/signup",  name: "onboard-signup",  auth: false },
  { path: "/onboard/verify",  name: "onboard-verify",  auth: false },
  { path: "/onboard/wizard",  name: "onboard-wizard",  auth: true },
];

// StayBid Circle (multi-investor). Own chrome (CircleDock). Model2/3/4 legacy
// prototype routes stay in scope (owner decision #8 — nothing dropped).
export const CIRCLE_ROUTES = [
  { path: "/circle",              name: "circle-hub",       auth: false },
  { path: "/circle/discover",     name: "circle-discover",  auth: false },
  { path: "/circle/build",        name: "circle-build",     auth: true  },
  { path: "/circle/dashboard",    name: "circle-dashboard", auth: true  },
  { path: "/circle/me",           name: "circle-me",        auth: true  },
  { path: "/circle/earnings",     name: "circle-earnings",  auth: true  },
  { path: "/circle/kyc",          name: "circle-kyc",       auth: true  },
  { path: "/circle/onboard",      name: "circle-onboard",   auth: false },
  { path: "/circle/profile",      name: "circle-profile",   auth: true  },
  { path: "/circle/support",      name: "circle-support",   auth: false },
  { path: "/circle/model2",       name: "circle-model2",    auth: false },
  { path: "/circle/model2/browse",name: "circle-m2-browse", auth: false },
  { path: "/circle/model2/review",name: "circle-m2-review", auth: true  },
  { path: "/circle/model2/selling",name: "circle-m2-selling",auth: true },
  { path: "/circle/model3",       name: "circle-model3",    auth: false },
  { path: "/circle/model4",       name: "circle-model4",    auth: false },
  { path: "/circle/sample",       name: "circle-detail",    auth: false, dynamic: true },
  { path: "/circle/model2/sample",name: "circle-m2-detail", auth: false, dynamic: true },
];

// StayBid for Hosts vertical. Own chrome (host layout + SwitchExperienceButton).
export const HOST_ROUTES = [
  { path: "/host",                name: "host-home",        auth: false },
  { path: "/host/build",          name: "host-build",       auth: true  },
  { path: "/host/properties",     name: "host-properties",  auth: true  },
  { path: "/host/list-property",  name: "host-list",        auth: true  },
  { path: "/host/store",          name: "host-store",       auth: true  },
  { path: "/host/studio",         name: "host-studio",      auth: true  },
  { path: "/host/channels",       name: "host-channels",    auth: true  },
  { path: "/host/workforce",      name: "host-workforce",   auth: true  },
  { path: "/host/workforce/join", name: "host-wf-join",     auth: false },
  { path: "/host/me",             name: "host-me",          auth: true  },
  { path: "/host/property/sample",name: "host-property",    auth: true, dynamic: true },
];

// Model-3 travel-agent auction. Own chrome (.trd-root). Google-auth agents.
export const TRADE_ROUTES = [
  { path: "/trade",           name: "trade-browse",  auth: false },
  { path: "/trade/my-bids",   name: "trade-my-bids", auth: true  },
  { path: "/trade/review",    name: "trade-review",  auth: true  },
  { path: "/trade/sample",    name: "trade-lot",     auth: false, dynamic: true },
];

// Workforce panel (separate sb_worker session).
export const WORKER_ROUTES = [
  { path: "/worker",           name: "worker-login",     auth: false },
  { path: "/worker/dashboard", name: "worker-dashboard", auth: true  },
];

// Support-agent console (customer support — NOT the auction /trade agents).
// Admin's dark-slate palette. Gates on an agent session.
export const AGENT_ROUTES = [
  { path: "/agent",         name: "agent-console", auth: true  },
  { path: "/agent/login",   name: "agent-login",   auth: false },
  { path: "/agent/metrics", name: "agent-metrics", auth: true  },
  { path: "/agent/sample",  name: "agent-ticket",  auth: true, dynamic: true },
];

// Offline kiosk — own fullscreen surface.
export const KIOSK_ROUTES = [
  { path: "/kiosk",         name: "kiosk-home",    auth: false },
  { path: "/kiosk/book",    name: "kiosk-book",    auth: false },
  { path: "/kiosk/display", name: "kiosk-display", auth: false },
];

// Public QR food-ordering page — own chrome + own font import.
export const ORDER_ROUTES = [
  { path: "/order/sample",  name: "order-outlet",  auth: false, dynamic: true },
];

export const SURFACES = {
  customer: CUSTOMER_ROUTES,
  partner: PARTNER_ROUTES,
  admin: ADMIN_ROUTES,
  creator: CREATOR_ROUTES,
  onboard: ONBOARD_ROUTES,
  circle: CIRCLE_ROUTES,
  host: HOST_ROUTES,
  trade: TRADE_ROUTES,
  worker: WORKER_ROUTES,
  agent: AGENT_ROUTES,
  kiosk: KIOSK_ROUTES,
  order: ORDER_ROUTES,
};

// Convenience: every surface, in phase order (worker/trade/agent/influencer
// first = cheapest, admin/partner last = XL). Used by `--surface all`.
export const ALL_SURFACES = Object.keys(SURFACES);
