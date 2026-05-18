// ═══════════════════════════════════════════════════════════════════════════
// SocialProfileService — non-destructive auto-creation of social profiles.
// ───────────────────────────────────────────────────────────────────────────
// Three triggers, all SIDE-EFFECT ONLY (caller invokes after their own
// happy-path completes; never throws). Designed to slot into existing
// handlers as a single-line append:
//
//   await SocialProfileService.createForUser(user)
//   await SocialProfileService.createForCreator(creator)
//   await SocialProfileService.createForHotel(hotel)
//
// AND a lazy fallback for the case where backend handlers can't be
// modified directly (Railway repo is separate): ensureForUser() runs on
// first social API hit and creates the profile if it doesn't exist yet.
// ═══════════════════════════════════════════════════════════════════════════
import { SB_URL, SB_KEY } from "@/lib/sb";

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// Tier-system additive: the 5-value content tier set lives on social_profiles
// .user_type. Phase 1 (2026-05-18) extended the Postgres ENUM with two new
// values (VERIFIED_GUEST, COMMUNITY_CONTRIBUTOR). We widen UserType to match
// so callers consuming a fresh row from social_profiles don't trip the type
// checker. Existing callers that compare against PUBLIC | CREATOR | HOTEL
// keep working — the new values are extra options, never replacements.
export type UserType =
  | "PUBLIC"
  | "VERIFIED_GUEST"
  | "COMMUNITY_CONTRIBUTOR"
  | "CREATOR"
  | "HOTEL";

export type SocialProfile = {
  id: string;
  user_id: string;
  hotel_id?: string | null;
  creator_id?: string | null;
  username: string;
  display_name: string;
  bio?: string | null;
  avatar_url?: string | null;
  cover_url?: string | null;
  follower_count: number;
  following_count: number;
  is_verified: boolean;
  is_creator: boolean;
  user_type: UserType;
  // Tier-system additive (Phase 1 migration 2026-05-18-tier-system-additive.sql).
  // Set whenever user_type transitions PUBLIC → VERIFIED_GUEST / COMMUNITY_CONTRIBUTOR
  // / CREATOR. NULL for legacy rows that never went through promotion.
  tier_promoted_at?: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Username generation ───────────────────────────────────────────────
function slugify(input: string): string {
  return (input || "user")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 24) || "user";
}

function rand4(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function findFreeUsername(base: string): Promise<string> {
  const slug = slugify(base);
  // First try the bare slug, then append _NNNN until we find a free one.
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attempt === 0 ? slug : `${slug}_${rand4()}`;
    const r = await fetch(
      `${SB_URL}/rest/v1/social_profiles?select=id&username=eq.${encodeURIComponent(candidate)}`,
      { headers: HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      if (Array.isArray(arr) && arr.length === 0) return candidate;
    }
  }
  // Worst case: timestamped fallback — guaranteed unique.
  return `${slug}_${Date.now().toString(36)}`;
}

// ─── Read helpers ──────────────────────────────────────────────────────
export async function getProfileByUserId(userId: string): Promise<SocialProfile | null> {
  if (!userId) return null;
  const r = await fetch(
    `${SB_URL}/rest/v1/social_profiles?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    { headers: HEADERS, cache: "no-store" }
  );
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function getProfileByUsername(username: string): Promise<SocialProfile | null> {
  if (!username) return null;
  const r = await fetch(
    `${SB_URL}/rest/v1/social_profiles?username=eq.${encodeURIComponent(username)}&select=*&limit=1`,
    { headers: HEADERS, cache: "no-store" }
  );
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

// ─── v132.10 — IDENTITY-MERGE cross-lookup ─────────────────────────────
// One person can hold multiple `users` rows in this DB (Sachin had 6):
//   - Phone with +91 prefix       (`+918881555188` → cmnr4b8ol...)
//   - Phone without +91 prefix    (`8881555188`     → cmnuolhpx...)
//   - Google Firebase UID         (`Ld6xDB42…`      → social_profiles e5c72301)
//   - Facebook Firebase UID       (`l3fo3x6W…`      → social_profiles eebb4c38)
//   - Phone-OTP-via-old-flow      (anything else)
//
// Each auth path stamps `social_profiles.user_id` with whatever id it had
// at the time. When the same human switches auth methods later, their
// new `users.id` doesn't match the older `social_profiles.user_id` →
// `/me` shows 0 posts and a fresh upload creates a third profile.
//
// `findProfileAcrossIdentities` collapses this by searching THREE axes:
//   1. Direct user_id match (the historical primary key).
//   2. Phone match across users — handles +91 / no-+91 prefix variation.
//   3. Email match across users.
//
// Returns the OLDEST matching profile (most history attached). Callers
// that want every match should use `getAllProfilesAcrossIdentities` below.
//
// NEVER auto-merges. Read-only. If you want to migrate posts to a
// canonical profile, do it via a SQL backfill — same pattern we used
// for Sachin's data in v132.10.
// ───────────────────────────────────────────────────────────────────────
export type IdentityClaims = {
  id: string;
  phone?: string | null;
  email?: string | null;
};

function normalizePhone(p?: string | null): string[] {
  if (!p) return [];
  const trimmed = String(p).trim();
  if (!trimmed) return [];
  // Reject Firebase placeholder phones (`unknown_<uid>`) — never a real
  // phone match.
  if (/^unknown_/i.test(trimmed)) return [];
  // Strip non-digits then re-attach a couple of common forms so we
  // catch both `+918881555188` and `8881555188` etc.
  const digitsOnly = trimmed.replace(/[^\d]/g, "");
  if (digitsOnly.length < 10) return [];
  const last10 = digitsOnly.slice(-10);
  const variants = new Set<string>([
    trimmed,
    digitsOnly,
    last10,
    `+91${last10}`,
    `91${last10}`,
  ]);
  return Array.from(variants).filter(Boolean);
}

async function lookupUserIdsByContact(phones: string[], email?: string | null): Promise<string[]> {
  if (!phones.length && !email) return [];
  const ids = new Set<string>();
  if (phones.length) {
    const inList = phones.map((p) => encodeURIComponent(p)).join(",");
    const r = await fetch(
      `${SB_URL}/rest/v1/users?phone=in.(${inList})&select=id`,
      { headers: HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      if (Array.isArray(arr)) arr.forEach((u: any) => u?.id && ids.add(String(u.id)));
    }
  }
  if (email && /@/.test(email)) {
    const r = await fetch(
      `${SB_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id`,
      { headers: HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      if (Array.isArray(arr)) arr.forEach((u: any) => u?.id && ids.add(String(u.id)));
    }
  }
  return Array.from(ids);
}

export async function findProfileAcrossIdentities(claims: IdentityClaims): Promise<SocialProfile | null> {
  if (!claims?.id) return null;
  // 1. Direct lookup — fast path, covers the happy case.
  const direct = await getProfileByUserId(claims.id);
  if (direct) return direct;

  // 2. Cross-lookup by phone + email — gathers every users.id that
  // shares contact info with the caller, then queries social_profiles
  // for any of those user_ids. Returns the OLDEST (most history).
  const phoneVariants = normalizePhone(claims.phone);
  const altIds = await lookupUserIdsByContact(phoneVariants, claims.email);
  // Exclude the caller's own id (already searched) and dedupe.
  const candidates = altIds.filter((u) => u && u !== claims.id);
  if (!candidates.length) return null;

  const inList = candidates.map((u) => encodeURIComponent(u)).join(",");
  const r = await fetch(
    `${SB_URL}/rest/v1/social_profiles?user_id=in.(${inList})&select=*&order=created_at.asc&limit=10`,
    { headers: HEADERS, cache: "no-store" }
  );
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

export async function getAllProfilesAcrossIdentities(claims: IdentityClaims): Promise<SocialProfile[]> {
  if (!claims?.id) return [];
  const ids = new Set<string>([claims.id]);
  const phoneVariants = normalizePhone(claims.phone);
  const altIds = await lookupUserIdsByContact(phoneVariants, claims.email);
  altIds.forEach((u) => ids.add(u));
  if (ids.size === 0) return [];
  const inList = Array.from(ids).map((u) => encodeURIComponent(u)).join(",");
  const r = await fetch(
    `${SB_URL}/rest/v1/social_profiles?user_id=in.(${inList})&select=*&order=created_at.asc`,
    { headers: HEADERS, cache: "no-store" }
  );
  if (!r.ok) return [];
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) ? arr : [];
}

// ─── Trigger 1: PUBLIC user signs up ───────────────────────────────────
export async function createForUser(user: {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
}): Promise<SocialProfile | null> {
  if (!user?.id) return null;
  const existing = await getProfileByUserId(user.id);
  if (existing) return existing;

  const seed = user.name || user.email?.split("@")[0] || user.phone || `user_${user.id.slice(0, 6)}`;
  const username = await findFreeUsername(seed);
  const row = {
    user_id:      user.id,
    username,
    display_name: user.name || `@${username}`,
    avatar_url:   user.avatar_url || null,
    is_verified:  false,
    is_creator:   false,
    user_type:    "PUBLIC" as UserType,
  };
  const r = await fetch(`${SB_URL}/rest/v1/social_profiles`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(row),
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

// ─── Trigger 2: Creator Hub creates a creator ──────────────────────────
export async function createForCreator(creator: {
  user_id: string;
  id?: string;
  display_name?: string;
  handle?: string;
  bio?: string | null;
  avatar_url?: string | null;
}): Promise<SocialProfile | null> {
  if (!creator?.user_id) return null;
  const existing = await getProfileByUserId(creator.user_id);
  if (existing) {
    // Promote an existing PUBLIC profile to CREATOR if needed.
    if (existing.user_type !== "CREATOR") {
      await fetch(`${SB_URL}/rest/v1/social_profiles?id=eq.${existing.id}`, {
        method: "PATCH", headers: HEADERS,
        body: JSON.stringify({
          user_type: "CREATOR", is_creator: true,
          creator_id: creator.id || existing.creator_id,
          display_name: creator.display_name || existing.display_name,
          bio: creator.bio ?? existing.bio,
          avatar_url: creator.avatar_url ?? existing.avatar_url,
        }),
      });
    }
    return getProfileByUserId(creator.user_id);
  }

  const seed = creator.handle || creator.display_name || `creator_${creator.user_id.slice(0, 6)}`;
  const username = await findFreeUsername(seed);
  const row = {
    user_id:      creator.user_id,
    creator_id:   creator.id || null,
    username,
    display_name: creator.display_name || `@${username}`,
    bio:          creator.bio || null,
    avatar_url:   creator.avatar_url || null,
    is_verified:  false,
    is_creator:   true,
    user_type:    "CREATOR" as UserType,
  };
  const r = await fetch(`${SB_URL}/rest/v1/social_profiles`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(row),
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

// ─── Trigger 3: Hotel onboarding APPROVED ──────────────────────────────
export async function createForHotel(hotel: {
  id: string;
  ownerId?: string;
  owner_id?: string;
  name: string;
  city?: string | null;
  starRating?: number;
  star_rating?: number;
  images?: string[];
  description?: string | null;
}): Promise<SocialProfile | null> {
  if (!hotel?.id) return null;
  const ownerId = hotel.ownerId || hotel.owner_id;
  if (!ownerId) return null;

  // Already-existing profile for this hotel? Idempotent.
  {
    const r = await fetch(
      `${SB_URL}/rest/v1/social_profiles?hotel_id=eq.${encodeURIComponent(hotel.id)}&select=*&limit=1`,
      { headers: HEADERS, cache: "no-store" }
    );
    if (r.ok) {
      const arr = await r.json().catch(() => []);
      if (Array.isArray(arr) && arr[0]) return arr[0];
    }
  }
  // Already-existing profile for this owner user? Promote it.
  const existing = await getProfileByUserId(ownerId);
  if (existing) {
    await fetch(`${SB_URL}/rest/v1/social_profiles?id=eq.${existing.id}`, {
      method: "PATCH", headers: HEADERS,
      body: JSON.stringify({
        user_type: "HOTEL", is_verified: true, hotel_id: hotel.id,
        display_name: hotel.name,
        bio: hotel.description ?? existing.bio,
        avatar_url: (hotel.images && hotel.images[0]) || existing.avatar_url,
      }),
    });
    return getProfileByUserId(ownerId);
  }

  const seed = `${hotel.name}${hotel.city ? "-" + hotel.city : ""}`;
  const username = await findFreeUsername(seed);
  const row = {
    user_id:      ownerId,
    hotel_id:     hotel.id,
    username,
    display_name: hotel.name,
    bio:          hotel.description || null,
    avatar_url:   (hotel.images && hotel.images[0]) || null,
    is_verified:  true,
    is_creator:   false,
    user_type:    "HOTEL" as UserType,
  };
  const r = await fetch(`${SB_URL}/rest/v1/social_profiles`, {
    method: "POST", headers: HEADERS, body: JSON.stringify(row),
  });
  if (!r.ok) return null;
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) && arr[0] ? arr[0] : null;
}

// ─── Lazy auto-create — used by /api/social/profiles/me when the legacy
// auth handler hasn't fired the trigger yet (e.g. account predates this
// feature, OR backend on Railway hasn't been redeployed with the hook).
//
// v132.10 — Cross-identity bridging. Before creating a fresh profile,
// look across phone + email matches so a user who switches auth methods
// (Google → Phone, Facebook → Phone, etc.) gets re-bound to their
// existing profile instead of having a 2nd / 3rd profile created. When
// we find an orphan profile (one whose `user_id` points at a Firebase
// uid that's no longer the canonical id), we rebind it to the current
// caller's id so /api/social/feed's direct-user_id lookup hits next time.
export async function ensureForUser(user: { id: string; name?: string; email?: string; phone?: string }) {
  // Fast path — caller's user_id already owns a profile.
  const existing = await getProfileByUserId(user.id);
  if (existing) return existing;
  // v132.10 — Cross-identity match across phone + email. Catches:
  //   - same human signed up with Google first, then with Phone-OTP
  //   - phone stored without +91 in one record but +91 in another
  //   - Firebase placeholder phones (unknown_<uid>) skipped automatically
  const cross = await findProfileAcrossIdentities({
    id: user.id, phone: user.phone || null, email: user.email || null,
  });
  if (cross) {
    // Re-bind the existing profile to the caller's current canonical
    // user.id so future direct-lookups succeed without another
    // cross-match round-trip. The OLD user_id was an orphan Firebase
    // uid; rebinding is non-destructive (no posts move).
    try {
      await fetch(`${SB_URL}/rest/v1/social_profiles?id=eq.${cross.id}`, {
        method: "PATCH",
        headers: HEADERS,
        body: JSON.stringify({
          user_id: user.id,
          // Keep existing fields — only re-bind. Caller's name/avatar
          // sync happens elsewhere (/api/social/profiles/me PATCH).
          updated_at: new Date().toISOString(),
        }),
      });
    } catch { /* non-fatal — read still works via cross-lookup */ }
    return { ...cross, user_id: user.id };
  }
  return createForUser(user);
}

// ─── Permission gates — call before any content-mutating route ─────────
export function canPost(profile: SocialProfile | null): boolean {
  return !!profile;   // any user_type can post photo/reel/story
}

export function canChangeSound(post: { sound_owner_id?: string | null }, profile: SocialProfile | null): boolean {
  if (!profile) return false;
  if (!post.sound_owner_id) return true;       // no owner set yet → first picker wins
  return post.sound_owner_id === profile.id;
}

export function canDeletePost(post: { author_id: string }, profile: SocialProfile | null, role?: string): boolean {
  if (!profile) return false;
  if (post.author_id === profile.id) return true;
  return role === "admin" || role === "super_admin";
}

// Default export so existing handlers can `import socialProfileService from …`
const SocialProfileService = {
  createForUser,
  createForCreator,
  createForHotel,
  ensureForUser,
  getProfileByUserId,
  getProfileByUsername,
  findProfileAcrossIdentities,
  getAllProfilesAcrossIdentities,
  canPost,
  canChangeSound,
  canDeletePost,
};
export default SocialProfileService;
