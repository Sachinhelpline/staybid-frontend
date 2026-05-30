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

export type UserLink = {
  /** Internal app route or external URL. */
  href: string;
  /** Visible title in both menus. */
  label: string;
  /** Optional sub-line (rendered on mobile drawer; ignored on desktop chip). */
  sub?: string;
  /** Emoji/glyph rendered as the leading icon. */
  icon: string;
  /** Open in new tab + show external glyph when true. */
  external?: boolean;
  /** Gates: link only shows when the user's tier matches. Missing = always. */
  requires?: "creator" | "hotel";
};

/** v125.3 — canonical menu order. Mobile and desktop both render this list,
 *  with tier-gated entries appended automatically. */
export const USER_LINKS_BASE: UserLink[] = [
  { href: "/my-bids",      label: "My Bids",            sub: "Your active offers",            icon: "📋" },
  { href: "/bookings",     label: "Bookings",           sub: "Past + upcoming stays",         icon: "🎫" },
  { href: "/saved",        label: "Saved",              sub: "Wishlist hotels & reels",       icon: "🔖" },
  // Trust & Reviews → dedicated reviews-first landing (/trust). Lists every
  // stay scored on real guest experience, each row linking straight into that
  // hotel's guest-review page. (Previously dropped users on /hotels, which
  // read as "it just opens a hotel page".)
  { href: "/trust",        label: "Trust & Reviews",    sub: "Scorecards · ranks · guest reviews", icon: "⭐" },
  // Wallet is the unified entry: it shows balance + StayPoints. The /points
  // page is still reachable from inside the wallet (the StayPoints column
  // is a tappable link). DO NOT add a separate /points top-level entry —
  // every prior split caused user confusion.
  { href: "/wallet",       label: "Wallet",             sub: "Balance + StayPoints",          icon: "💰" },
  { href: "/complaints",   label: "Complaints & Help",  sub: "Raise an issue · ~24 hr reply", icon: "🚩" },
  { href: "/verification", label: "Verify Stay",        sub: "Hotel verification",            icon: "✅" },
];

export const CREATOR_LINK: UserLink = {
  href: "/influencer",
  label: "Creator Hub",
  sub:   "Earnings + referrals",
  icon:  "✨",
  requires: "creator",
};

export const HOTEL_LINK: UserLink = {
  href: "/partner",
  label: "Hotel Partner",
  sub:   "Open partner dashboard",
  icon:  "🏢",
  requires: "hotel",
};

/** Account settings always shown LAST, just above the theme/logout block on
 *  the mobile drawer. The desktop dropdown can choose to surface this or
 *  rely on the profile chip — both UX are valid. */
export const ACCOUNT_LINK: UserLink = {
  href: "/profile",
  label: "Account settings",
  sub:   "Email, phone, security",
  icon:  "⚙",
};

/** Helper: assembles the full ordered list for the current tier. */
export function userLinksForTier(opts: {
  isCreator: boolean;
  isHotelOwner: boolean;
  includeAccount?: boolean;
}): UserLink[] {
  const out: UserLink[] = [...USER_LINKS_BASE];
  if (opts.isCreator)    out.push(CREATOR_LINK);
  if (opts.isHotelOwner) out.push(HOTEL_LINK);
  if (opts.includeAccount) out.push(ACCOUNT_LINK);
  return out;
}
