// UI primitives barrel — the shared design-system layer for the UI upgrade.
// Import from "@/components/ui" (or a relative path) in new/migrated surfaces.
// Every primitive reads the locked Direction A tokens (live pewter, verbatim)
// and is verified in light + dark. See docs/upgrade/02-FOUNDATION-SPEC.md and
// components/ui/README.md.
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { Badge } from "./Badge";
export type { BadgeProps } from "./Badge";
export { Skeleton } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";
export { Icon, APP_ICONS } from "./Icon";
export type { IconProps, AppIconName } from "./Icon";
