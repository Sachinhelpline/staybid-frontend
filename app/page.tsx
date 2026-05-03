// ═══════════════════════════════════════════════════════════════════════════
// Root URL — redirects every visitor straight into the Reels feed.
// ───────────────────────────────────────────────────────────────────────────
// The previous luxury-themed homepage is preserved at
//   app/_home-luxury-backup.tsx
// (filename starts with `_` so Next.js App Router ignores it and it is NOT
// registered as a route). To restore the old homepage:
//   1. Delete this file.
//   2. Rename _home-luxury-backup.tsx → page.tsx.
// ═══════════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";

export default function RootPage(): never {
  redirect("/discover");
}
