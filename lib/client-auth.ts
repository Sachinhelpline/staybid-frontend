// ═══════════════════════════════════════════════════════════════════════════
// lib/client-auth.ts — tiny client-side helpers for reading the JWT in the
// browser. Keeps the SAME normalisation logic as the server's
// `normalizeAuthId` so /me + /me/posts never end up querying with a
// pre-merge user id that doesn't exist in social_profiles anymore.
// ═══════════════════════════════════════════════════════════════════════════
"use client";

/** Strip the legacy "fb_" / "firebase_" prefix that older auth code
    paths used to add to Firebase uids. The server's
    `lib/social/auth-helper.ts` normalizeAuthId does the same — keep
    these two implementations identical or both forms might resolve to
    different profile rows. */
export function normalizeClientAuthId(id: string): string {
  if (!id) return id;
  if (id.startsWith("fb_"))       return id.slice(3);
  if (id.startsWith("firebase_")) return id.slice(9);
  return id;
}

/** Read the canonical auth user id from localStorage.sb_token (or "").
    Returns the normalised form so it lines up with the v112.2 merged
    social_profiles row. */
export function getClientUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    const t = localStorage.getItem("sb_token") || "";
    if (!t) return "";
    const parts = t.split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const raw = payload?.id || payload?.user_id || payload?.sub || "";
    return normalizeClientAuthId(String(raw || ""));
  } catch { return ""; }
}
