// ═══════════════════════════════════════════════════════════════════════════
// lib/hotel/photo-categories.ts — v511 (Phase B)
//
// The single source of truth for hotel gallery photo CATEGORIES (Airbnb-style
// "browse by space"). Shared by the partner tagger (partner dashboard Profile
// tab) and the guest gallery rail (components/hotel/PhotoGallery). One list ⇒
// the two surfaces can never drift.
//
// Stored on `hotels.image_categories` as { "<image-url>": "<slug>" }. A photo
// with no entry is untagged (shows only under "All").
// ═══════════════════════════════════════════════════════════════════════════

export type PhotoCategory = { id: string; label: string; emoji: string };

// Order = display order of the chips. Kept intentionally small + recognisable.
export const PHOTO_CATEGORIES: PhotoCategory[] = [
  { id: "bedroom",   label: "Bedroom",     emoji: "🛏️" },
  { id: "bathroom",  label: "Bathroom",    emoji: "🛁" },
  { id: "living",    label: "Living area", emoji: "🛋️" },
  { id: "dining",    label: "Dining",      emoji: "🍽️" },
  { id: "exterior",  label: "Exterior",    emoji: "🏡" },
  { id: "views",     label: "Views",       emoji: "🌄" },
  { id: "amenities", label: "Amenities",   emoji: "✨" },
];

export const PHOTO_CATEGORY_IDS: string[] = PHOTO_CATEGORIES.map((c) => c.id);

const BY_ID: Record<string, PhotoCategory> = PHOTO_CATEGORIES.reduce(
  (acc, c) => { acc[c.id] = c; return acc; },
  {} as Record<string, PhotoCategory>
);

/** Look up a category's display meta by slug (undefined for an unknown slug). */
export function categoryMeta(id?: string | null): PhotoCategory | undefined {
  return id ? BY_ID[id] : undefined;
}

/** Is this a valid category slug? (guards the partner save + guest read). */
export function isPhotoCategory(id?: string | null): boolean {
  return !!id && Object.prototype.hasOwnProperty.call(BY_ID, id);
}
