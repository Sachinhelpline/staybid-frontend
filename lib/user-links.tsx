// v125.3 — Single source of truth for the customer-side "Menu" used by:
//   • Desktop nav dropdown (components/Navbar.tsx → "☰ Menu ▼")
//   • Mobile hamburger drawer (app/me/page.tsx → MoreDrawer)
//
// Why this exists
// ---------------
// Both menus used to maintain their own independent arrays. They drifted:
// the mobile drawer had Complaints & Help and a merged Wallet card; the
// desktop dropdown had Verification + a separate Points entry + no
// Complaints. Real-device QA caught it and the user asked for "same rules
// everywhere — bulletproof, future-proof".
//
// Going forward: edit THIS file and BOTH menus update in lock-step. Adding
// a new top-level menu item, removing one, renaming a label, swapping an
// icon — all happen in one place.

import type { ReactNode } from "react";
import { ClipboardList, Ticket, Bookmark, Star, BookUser, Flag, BadgeCheck, Sparkles, Building2, Settings } from "lucide-react";

// v646 — leading icons are lucide nodes (UI-upgrade program); the type stays
// open to strings for any legacy caller.
const ic = (I: any) => <I size={18} strokeWidth={2.2} aria-hidden />;

export type UserLink = {
  /** Internal app route or external URL. */
  href: string;
  /** Visible title in both menus. */
  label: string;
  /** Optional sub-line (rendered on mobile drawer; ignored on desktop chip). */
  sub?: string;
  /** Leading icon — lucide node (legacy emoji strings still render). */
  icon: ReactNode;
  /** Open in new tab + show external glyph when true. */
  external?: boolean;
  /** Gates: link only shows when the user's tier matches. Missing = always. */
  requires?: "creator" | "hotel";
};

/** v125.3 — canonical menu order. Mobile and desktop both render this list,
 *  with tier-gated entries appended automatically. */
export const USER_LINKS_BASE: UserLink[] = [
  { href: "/my-bids",      label: "My Bids",            sub: "Your active offers",            icon: ic(ClipboardList) },
  { href: "/bookings",     label: "Bookings",           sub: "Past + upcoming stays",         icon: ic(Ticket) },
  { href: "/saved",        label: "Saved",              sub: "Wishlist hotels & reels",       icon: ic(Bookmark) },
  // Trust & Reviews → dedicated reviews-first landing (/trust). Lists every
  // stay scored on real guest experience, each row linking straight into that
  // hotel's guest-review page. (Previously dropped users on /hotels, which
  // read as "it just opens a hotel page".)
  { href: "/trust",        label: "Trust & Reviews",    sub: "Scorecards · ranks · guest reviews", icon: ic(Star) },
  // v264 — Passport cum Wallet. The unified hub at /passport holds the
  // Explorer Passport (stamps/rank/XP/badges/rewards) AND every wallet
  // feature (balance, StayPoints, redeem, codes) as tabs. The old /wallet,
  // /points, /points/redeem, /my-codes routes redirect into it. DO NOT add a
  // separate /wallet or /points top-level entry — every prior split caused
  // user confusion.
  { href: "/passport",     label: "Passport & Wallet",  sub: "Stamps · rank · balance · points", icon: ic(BookUser) },
  { href: "/complaints",   label: "Complaints & Help",  sub: "Raise an issue · ~24 hr reply", icon: ic(Flag) },
  { href: "/verification", label: "Verify Stay",        sub: "Hotel verification",            icon: ic(BadgeCheck) },
  // v494 — StayBid for Hosts (/host) + StayCircle (/circle) were BOTH removed
  // from this flat menu. They are verticals, and every vertical (Circle, Hosts,
  // Hotel Partner, Creator, Onboard, Worker, Kiosk) is already listed in the
  // "Switch experience" sheet (lib/panels.ts → visiblePanels shows every
  // non-admin panel in join/joined state to ALL users). Listing them here AND
  // in Switch experience was a confusing duplicate. Discovery is unchanged —
  // Switch experience is the single, canonical entry into every vertical.
];

export const CREATOR_LINK: UserLink = {
  href: "/influencer",
  label: "Creator Hub",
  sub:   "Earnings + referrals",
  icon:  ic(Sparkles),
  requires: "creator",
};

export const HOTEL_LINK: UserLink = {
  href: "/partner",
  label: "Hotel Partner",
  sub:   "Open partner dashboard",
  icon:  ic(Building2),
  requires: "hotel",
};

/** Account settings always shown LAST, just above the theme/logout block on
 *  the mobile drawer. The desktop dropdown can choose to surface this or
 *  rely on the profile chip — both UX are valid. */
export const ACCOUNT_LINK: UserLink = {
  href: "/profile",
  label: "Account settings",
  sub:   "Email, phone, security",
  icon:  ic(Settings),
};

/** Helper: assembles the full ordered list for the current tier. */
export function userLinksForTier(opts: {
  isCreator: boolean;
  isHotelOwner: boolean;
  includeAccount?: boolean;
}): UserLink[] {
  // v494 — Creator Hub (/influencer) + Hotel Partner (/partner) are no longer
  // appended here. They are verticals, reachable via "Switch experience"
  // (lib/panels.ts) like Circle/Hosts — listing them in the flat menu too was a
  // duplicate. Kept the params + consts for back-compat; they're just not pushed.
  const out: UserLink[] = [...USER_LINKS_BASE];
  if (opts.includeAccount) out.push(ACCOUNT_LINK);
  return out;
}
