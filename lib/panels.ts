// ═══════════════════════════════════════════════════════════════════════════
// Panel registry — the single source of truth for the global "Switch
// experience" switcher (Airbnb-style, v322).
//
// StayBid is one app with many panels that share (or separate) auth:
//   • Traveling      — the customer app (sb_token)          → /
//   • List Your Hotel— hotel property onboarding wizard     → /onboard
//   • Hotel Partner  — property owner dashboard             → /partner
//   • StayCircle     — room-level investing                 → /circle
//   • StayBid Hosts  — managed portfolio ownership          → /host
//   • Creator Hub    — creator earnings + referrals         → /influencer
//   • Worker         — on-demand hospitality staff          → /worker
//   • Admin          — god-mode control panel               → /admin
//
// Only panels that are LINKED from the customer frontend belong here (the
// Host vertical links to /onboard + /worker; user-links links to /partner
// /circle /host /influencer). Standalone internal tools with no frontend
// link (e.g. the /agent support inbox) are intentionally NOT listed.
//
// LOCKED RULES (Sachin, v322):
//   1. Each panel's OWN sign-in / authorization rule is UNCHANGED. The
//      switcher never bypasses a panel's login — for a not-yet-joined panel
//      it routes the user to that panel's own entry (joinRoute) where the
//      panel enforces its own auth.
//   2. Once a user is signed up for a panel, the switcher AUTO-SWITCHES
//      (hard nav to `home`, no re-login) because the credential already
//      lives in localStorage and each panel re-reads it on boot.
//   3. Admin is only advertised when an admin credential is present — we
//      never surface the admin door to a random signed-in user.
//
// This module is PURE (no React, no side effects) so it can be unit-reasoned
// and shared by the switcher UI + any future deep-link builder.
// ═══════════════════════════════════════════════════════════════════════════

export type PanelKey =
  | "travel" | "onboard" | "partner" | "circle" | "host"
  | "creator" | "worker" | "admin";

/** here = the panel the user is currently viewing.
 *  joined = the user already has access → tapping auto-switches (no re-login).
 *  join = the user is not in this panel yet → tapping routes to its own entry. */
export type PanelState = "here" | "joined" | "join";

export type Panel = {
  key: PanelKey;
  label: string;
  tagline: string;
  icon: string;
  /** Subtle per-panel accent (used for the card ring + icon tile). */
  accent: string;
  /** Where a JOINED user lands (auto-switch target). */
  home: string;
  /** Where a NOT-joined user goes — the panel's OWN sign-in / onboarding.
   *  The panel enforces its own auth there; the switcher never bypasses it. */
  joinRoute: string;
  /** CTA text shown when state === "join". */
  joinCta: string;
  /** Route prefix that means "the user is currently inside this panel".
   *  null → the Traveling (customer) surface, matched by exclusion. */
  prefix: string | null;
};

export const PANELS: Panel[] = [
  {
    key: "travel",
    label: "Travelling",
    tagline: "Bid & book luxury stays",
    icon: "🧳",
    accent: "#C9A66B",
    home: "/",
    joinRoute: "/auth",
    joinCta: "Sign in",
    prefix: null,
  },
  {
    key: "onboard",
    label: "List Your Hotel",
    tagline: "Onboard your property in minutes",
    icon: "🪧",
    accent: "#B8894B",
    home: "/onboard/wizard",
    joinRoute: "/onboard",
    joinCta: "List your hotel",
    prefix: "/onboard",
  },
  {
    key: "partner",
    label: "Hotel Partner",
    tagline: "Manage your hotel, rooms & bids",
    icon: "🏨",
    accent: "#7F9269",
    home: "/partner/dashboard",
    joinRoute: "/partner",
    joinCta: "List your hotel",
    prefix: "/partner",
  },
  {
    key: "circle",
    label: "StayCircle",
    tagline: "Invest in rooms · earn monthly",
    icon: "◎",
    accent: "#D49583",
    home: "/circle",
    joinRoute: "/circle",
    joinCta: "Explore",
    prefix: "/circle",
  },
  {
    key: "host",
    label: "StayBid for Hosts",
    tagline: "Own a managed BnB portfolio",
    icon: "🏠",
    accent: "#D9BE82",
    home: "/host",
    joinRoute: "/host",
    joinCta: "Explore",
    prefix: "/host",
  },
  {
    key: "creator",
    label: "Creator Hub",
    tagline: "Earn from your hotel reels",
    icon: "✨",
    accent: "#C9A66B",
    home: "/influencer",
    joinRoute: "/upgrade",
    joinCta: "Become a creator",
    prefix: "/influencer",
  },
  {
    key: "worker",
    label: "Worker",
    tagline: "On-demand hospitality jobs",
    icon: "🧰",
    accent: "#9DAD8F",
    home: "/worker/dashboard",
    joinRoute: "/worker",
    joinCta: "Join as a worker",
    prefix: "/worker",
  },
  {
    key: "admin",
    label: "Admin",
    tagline: "God-mode control panel",
    icon: "🛡️",
    accent: "#F0D060",
    home: "/admin",
    joinRoute: "/admin/login",
    joinCta: "Sign in",
    prefix: "/admin",
  },
];

export type SwitchCtx = {
  pathname: string;
  signedIn: boolean;         // sb_token present (customer auth)
  isCreator: boolean;        // useTier — CREATOR or PENDING_CREATOR
  isHotelOwner: boolean;     // useTier — /api/partner/hotel resolved a hotel
  hasPartnerToken: boolean;  // sb_partner_token in localStorage
  hasWorkerToken: boolean;   // sb_worker_token in localStorage
  hasOnboardToken: boolean;  // sb_onboard_token in localStorage
  hasAdminToken: boolean;    // sb_admin_token in localStorage
};

/** Is the current pathname inside this panel? */
export function isCurrentPanel(p: Panel, pathname: string): boolean {
  if (p.prefix === null) {
    // Traveling = anything NOT owned by another panel.
    return !PANELS.some(
      (o) => o.prefix !== null && (pathname === o.prefix || pathname.startsWith(o.prefix + "/")),
    );
  }
  return pathname === p.prefix || pathname.startsWith(p.prefix + "/");
}

/** Resolve here / joined / join for a panel given the auth context. */
export function panelState(p: Panel, ctx: SwitchCtx): PanelState {
  if (isCurrentPanel(p, ctx.pathname)) return "here";

  switch (p.key) {
    case "travel":
      // The customer app is joined the moment the user is signed in.
      return ctx.signedIn ? "joined" : "join";
    case "onboard":
      // A returning onboarder resumes the wizard; else start the flow.
      return ctx.hasOnboardToken ? "joined" : "join";
    case "partner":
      // A returning owner has a partner token OR resolves a hotel via useTier.
      return ctx.hasPartnerToken || ctx.isHotelOwner ? "joined" : "join";
    case "circle":
    case "host":
      // Open verticals — any visitor can enter; the panel gates internally.
      return "joined";
    case "creator":
      return ctx.isCreator ? "joined" : "join";
    case "worker":
      return ctx.hasWorkerToken ? "joined" : "join";
    case "admin":
      // Only ever reached when the admin card is visible (has token).
      return "joined";
    default:
      return "join";
  }
}

/** The panels to show in the switcher for this context.
 *  Admin is hidden unless an admin credential is present — we never surface
 *  the god-mode door to a random signed-in user. */
export function visiblePanels(ctx: SwitchCtx): Panel[] {
  return PANELS.filter((p) => (p.key === "admin" ? ctx.hasAdminToken : true));
}
