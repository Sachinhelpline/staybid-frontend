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

export type UserType = "PUBLIC" | "CREATOR" | "HOTEL";

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
export async function ensureForUser(user: { id: string; name?: string; email?: string; phone?: string }) {
  const existing = await getProfileByUserId(user.id);
  if (existing) return existing;
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
  canPost,
  canChangeSound,
  canDeletePost,
};
export default SocialProfileService;
