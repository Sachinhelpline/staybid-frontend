// ─────────────────────────────────────────────────────────────────────────
// Icon — the ONE icon primitive. Wraps lucide-react with a consistent sizing
// grid (16 / 20 / 24) and `currentColor` stroke. Replaces emoji-as-chrome.
//
// Two ways to use:
//   <Icon name="search" />               ← curated app-icon map (codemod target)
//   <Icon icon={SomeLucideIcon} />       ← any lucide icon directly
//
// The curated `APP_ICONS` map is a static object of direct imports, so it
// tree-shakes to only the icons actually referenced. Names map app CONCEPTS to
// lucide glyphs — the top emoji found in the chrome audit (search, home, bolt,
// bid/tag, reels, user, heart, calendar, location, lock, check, close, star,
// warning, …). Add new entries here, never scatter raw lucide imports.
//
// Accessibility: pass `label` for a meaningful icon (role="img" + aria-label);
// omit it for a decorative icon (aria-hidden).
// ─────────────────────────────────────────────────────────────────────────
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Home, Search, Compass, Zap, Tag, Play, Film, User, Heart, Bookmark,
  Calendar, MapPin, Lock, Check, CheckCheck, X, Star, TriangleAlert, Bed,
  Flame, CreditCard, Camera, Link as LinkIcon, MessageCircle, Bell, Settings,
  ChevronRight, ChevronLeft, ChevronDown, Plus, Sparkles, Trophy, Wallet,
  Building2, Share2, Info, Clock, IndianRupee, ArrowRight,
} from "lucide-react";

export const APP_ICONS = {
  home: Home,
  search: Search,
  explore: Compass,
  bolt: Zap,
  bid: Tag,
  play: Play,
  reels: Film,
  user: User,
  heart: Heart,
  save: Bookmark,
  calendar: Calendar,
  location: MapPin,
  lock: Lock,
  check: Check,
  "check-done": CheckCheck,
  close: X,
  star: Star,
  warning: TriangleAlert,
  bed: Bed,
  flame: Flame,
  card: CreditCard,
  camera: Camera,
  link: LinkIcon,
  chat: MessageCircle,
  bell: Bell,
  settings: Settings,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-down": ChevronDown,
  plus: Plus,
  sparkles: Sparkles,
  trophy: Trophy,
  wallet: Wallet,
  hotel: Building2,
  share: Share2,
  info: Info,
  clock: Clock,
  rupee: IndianRupee,
  "arrow-right": ArrowRight,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof APP_ICONS;

type BaseProps = {
  size?: 16 | 20 | 24 | number;
  strokeWidth?: number;
  /** Meaningful icons: sets role="img" + aria-label. Omit for decorative. */
  label?: string;
  className?: string;
};
type ByName = BaseProps & { name: AppIconName; icon?: undefined };
type ByComponent = BaseProps & { icon: LucideIcon; name?: undefined };
export type IconProps = ByName | ByComponent;

export function Icon(props: IconProps) {
  const { size = 20, strokeWidth = 2, label, className } = props;
  const Glyph: LucideIcon = "name" in props && props.name ? APP_ICONS[props.name] : (props as ByComponent).icon;
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const, focusable: false as const };
  return (
    <Glyph
      className={["sbui-icon", className || ""].filter(Boolean).join(" ")}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      {...a11y}
    />
  );
}

export default Icon;
