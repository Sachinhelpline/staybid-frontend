# Theme Unify Runbook — Admin/Partner → Cozy palette (AUTO-RUN READY)

> **Trigger:** tell a Claude session **"run the theme-unify runbook"** (or
> "cozy the admin panel"). It executes the steps below end-to-end. This is a
> mechanical find-replace + one token flip + a validation pass — no design
> decisions left open.

## Why this is safe to auto-run

The admin panel's colors are a **finite, consistent palette**. The shared tokens
live in `lib/admin/styles.ts` (`adminColors`), and the same ~15 hex values are
hardcoded inline across 42 admin files (`#8A8FA8` appears 221×, `#E8EAF0` 119×,
`#D4AF37` 111×, …) — always meaning the same thing. So flipping the theme =
replacing each dark hex with its cozy equivalent (scoped to `app/admin` +
`components/admin`) **plus** flipping `adminColors`. The hexes are distinctive
enough that a scoped find-replace has no false positives.

The **partner** dashboard is already warm (gold `#c9911a`, cream `#e6ddc8`) —
only a light champagne alignment, optional (Phase 4).

## Decision (locked): cozy-DARK, not light

Keep the admin **dark** (operators work with dense data; dark reduces eye strain)
but swap the cool slate + saturated gold for the brand's **warm walnut + cream +
champagne**. This "unifies with cozy" without a jarring flip to cream, and keeps
contrast/usability. Semantic status colors (green/red/blue/purple/amber) stay
recognizable.

## Phase 1 — Flip the shared tokens (`lib/admin/styles.ts`)

Replace the `adminColors` object body with:

```ts
export const adminColors = {
  bg: "#181410",            // was #07080C — warm deep walnut
  surface: "#211C13",       // was #0F1117 — warm surface
  card: "#2A2417",          // was #151820 — warm card
  border: "rgba(217,190,130,0.10)",        // was rgba(255,255,255,0.07)
  borderStrong: "rgba(217,190,130,0.16)",  // was rgba(255,255,255,0.12)
  text: "#F5EFE3",          // was #E8EAF0 — warm cream
  textDim: "#A8997D",       // was #8A8FA8 — warm muted taupe
  gold: "#C9A66B",          // was #D4AF37 — cozy champagne
  gold2: "#D9BE82",         // was #F0D060 — champagne-light
  green: "#7FB069",         // was #2ECC71 — softened (still clearly "good")
  red: "#E06B5A",           // was #FF4757 — cozy rose-red
  blue: "#5B9BD5",          // was #3D9CF5 — softened
  purple: "#A98FD0",        // was #A855F7 — softened
  amber: "#E0A94A",         // was #F59E0B — warm amber
};
```

## Phase 2 — Find-replace the hardcoded hexes (the bulk)

Run these scoped to admin only (`app/admin` + `components/admin`). Each maps a
dark hex → its cozy equivalent. Run case-insensitively for the 6-digit hexes.

```bash
cd /home/user/staybid-frontend
FILES=$(grep -rliE "#07080C|#0F1117|#151820|#E8EAF0|#8A8FA8|#D4AF37|#F0D060|#2ECC71|#FF4757|#3D9CF5|#A855F7|#F59E0B|#666876|rgba\(255,255,255" app/admin components/admin)
for f in $FILES; do
  sed -i -E \
    -e 's/#07080[Cc]/#181410/g' \
    -e 's/#0[Ff]1117/#211C13/g' \
    -e 's/#151820/#2A2417/g' \
    -e 's/#E8EAF0/#F5EFE3/Ig' \
    -e 's/#8A8FA8/#A8997D/Ig' \
    -e 's/#D4AF37/#C9A66B/Ig' \
    -e 's/#F0D060/#D9BE82/Ig' \
    -e 's/#2ECC71/#7FB069/Ig' \
    -e 's/#FF4757/#E06B5A/Ig' \
    -e 's/#3D9CF5/#5B9BD5/Ig' \
    -e 's/#A855F7/#A98FD0/Ig' \
    -e 's/#F59E0B/#E0A94A/Ig' \
    -e 's/#666876/#8A7D64/Ig' \
    -e 's/rgba\(255, ?255, ?255, ?0\.07\)/rgba(217,190,130,0.10)/g' \
    -e 's/rgba\(255, ?255, ?255, ?0\.1\)/rgba(217,190,130,0.14)/g' \
    -e 's/rgba\(255, ?255, ?255, ?0\.12\)/rgba(217,190,130,0.16)/g' \
    "$f"
done
```

After running, re-scan for stragglers and decide each by hand:

```bash
grep -rhoE "#[0-9A-Fa-f]{6}" app/admin components/admin | sort | uniq -c | sort -rn | head -30
```

Common stragglers + their cozy targets (extend the sed above if present):
`#FF9AA8`→`#E8A89C` · `#FF8C42`→`#E0934A` · `#EF4444`→`#D9695A` · `#1a1205`/`#1a1407`→ keep (already warm) · `#fca5a5`/`#f59e0b` (lowercase variants — the `/Ig` flag catches them).

## Phase 3 — Admin charts + gradients

The recharts wrappers (`components/admin/charts/*`) pass colors as props from the
calling pages — those flip with Phase 2. Check any inline gradient stops
(`linear-gradient(... #D4AF37 ...)`) were caught; the sed handles them since it's
hex-based. Verify the dashboard's 3 charts render on a cozy-dark bg (champagne
lines on warm walnut).

## Phase 4 — Partner alignment (optional, light-touch)

Partner is already warm. Only align the gold to champagne if desired:

```bash
sed -i -E -e 's/#c9911a/#C9A66B/Ig' -e 's/#f0b429/#D9BE82/Ig' \
  app/partner/dashboard/page.tsx components/partner/*.tsx
```

Skip if the partner gold already reads fine — it's not the reported problem.

## Phase 5 — Validate

```bash
npx tsc --noEmit --skipLibCheck            # must be exit 0
npm run build                              # must be green
# Device-matrix audit for overflow / contrast regressions on the operator panels:
bash responsive-audit/run.sh --surface admin   --auth --no-shots
bash responsive-audit/run.sh --surface partner --auth --no-shots
```

Then eyeball a few admin pages (dashboard, users table, hold-config, login) at a
phone + laptop width — confirm text is readable (cream on warm walnut) and the
champagne accent reads as the brand.

## Phase 6 — Ship

Bump `SB_BUILD` + the badge in `app/layout.tsx` to the next version. Commit:
`feat(theme): unify admin (+partner) panels to the cozy walnut/champagne palette`.
Open a DRAFT PR, wait for Vercel green, squash-merge.

## Things to preserve (do NOT change)

- **Customer surfaces** — untouched. This runbook is scoped to `app/admin`,
  `components/admin`, and (Phase 4) `app/partner`. Never run the sed against
  `app/` root or customer files.
- **Semantic meaning** — green still reads "good/resolved", red "danger/failed".
  The softened values keep that; don't collapse them into champagne.
- **Contrast** — cream `#F5EFE3` on walnut `#181410`/`#2A2417` is ~12:1 (great).
  Don't darken the text or lighten the bg past readable contrast.
- **The dark mode itself** — admin stays dark. This is a warmth swap, not a
  light-mode conversion.
- **`adminColors` is the source of truth** — once Phase 1+2 are done, future
  tweaks are a one-file change in `lib/admin/styles.ts` for the 9 files that
  already import it. A nice follow-up (NOT required for the unify) is migrating
  the 34 hardcoded-hex files to import `adminColors` so the whole panel becomes
  a single-file theme flip forever after.

## Rollback

The whole change is one branch — close the PR / delete the branch. `main` admin
stays on the slate-dark palette untouched.

## Exact mapping table (reference)

| Role | Dark (current) | Cozy (target) |
|---|---|---|
| page bg | `#07080C` | `#181410` |
| surface | `#0F1117` | `#211C13` |
| card | `#151820` | `#2A2417` |
| text | `#E8EAF0` | `#F5EFE3` |
| text dim | `#8A8FA8` | `#A8997D` |
| accent gold | `#D4AF37` | `#C9A66B` |
| accent gold-2 | `#F0D060` | `#D9BE82` |
| border | `rgba(255,255,255,0.07)` | `rgba(217,190,130,0.10)` |
| border strong | `rgba(255,255,255,0.12)` | `rgba(217,190,130,0.16)` |
| green | `#2ECC71` | `#7FB069` |
| red | `#FF4757` | `#E06B5A` |
| blue | `#3D9CF5` | `#5B9BD5` |
| purple | `#A855F7` | `#A98FD0` |
| amber | `#F59E0B` | `#E0A94A` |
