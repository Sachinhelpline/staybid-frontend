# `components/ui/` — shared design-system primitives

The single primitive layer for the StayBid UI upgrade (Phase 0a). Before this
existed, every surface re-implemented its own buttons/cards/chips — ~30 button
styles, 47 CTA gradients, 620 raw hex colours in TSX. These primitives replace
that with one token-driven set.

## Rules

1. **Use tokens, never raw hex.** Primitives read the locked Direction A tokens
   (the live production pewter, verbatim — see `docs/upgrade/04-DIRECTION-LOCKED.md`).
   New surfaces must do the same: `var(--accent)`, `var(--bg-card)`, `var(--text-*)`,
   `var(--fs-*)`, `--sbui-*`. A palette change is then one file, and light↔dark is free.
2. **One button.** `<Button variant="primary|secondary|ghost|danger|success" size sm|md|lg />`.
   Primary is the exact live brushed-pewter gradient. Renders `<a>` when given `href`.
3. **One chip.** `<Badge tone="neutral|accent|success|warning|danger" pill dot />`.
4. **Icons, not emoji, for chrome.** `<Icon name="search" />` (curated map in `Icon.tsx`)
   or `<Icon icon={SomeLucideIcon} />`. Add new concepts to `APP_ICONS`. Emoji stay
   ONLY for personality/celebration (🎉 success, season badges) per owner decision #3.
5. **Type scale.** Use `--fs-display … --fs-micro` (9 steps). `--fs-micro` (0.68rem)
   is the floor — nothing smaller. Never introduce a new ad-hoc font-size.
6. **Light + dark.** Every primitive is verified in both themes. Never hard-code a
   colour that only works in one.

## Adoption

Phase 0a ships these UNUSED (invisible). Surfaces migrate to them per-phase
(customer core → panels). Do not mass-replace in one PR; migrate a surface,
verify light+dark on the device matrix, then the next.

## Files

| File | Exports |
|---|---|
| `Button.tsx` | `Button` |
| `Card.tsx` | `Card` (flat / elevated / media) |
| `Badge.tsx` | `Badge` |
| `Skeleton.tsx` | `Skeleton` (reduced-motion safe) |
| `Icon.tsx` | `Icon`, `APP_ICONS` |
| `index.ts` | barrel |

Styles live in `app/globals.css` under the "UI UPGRADE — FOUNDATION LAYER"
banner (`.sbui-*` classes, `--fs-*` / `--sbui-*` tokens). That block is
additive and touches no existing selector.
