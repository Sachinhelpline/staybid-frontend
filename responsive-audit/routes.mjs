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
  { path: "/admin/login", name: "admin-login", auth: false },
  // full admin tree enumerated when its phase begins
];

export const SURFACES = {
  customer: CUSTOMER_ROUTES,
  partner: PARTNER_ROUTES,
  admin: ADMIN_ROUTES,
};
