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
  // dynamic — representative sample values
  { path: "/hotels/sample",    name: "hotel-detail",      auth: false, dynamic: true },
  { path: "/u/staybid",        name: "user-public",       auth: false, dynamic: true },
  { path: "/tag/mussoorie",    name: "tag",               auth: false, dynamic: true },
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

export const SURFACES = {
  customer: CUSTOMER_ROUTES,
  partner: PARTNER_ROUTES,
  admin: ADMIN_ROUTES,
  creator: CREATOR_ROUTES,
  onboard: ONBOARD_ROUTES,
};
