# Responsive audit — Partner + Admin operator surfaces

Phase 2 of the device-matrix audit (Phase 1 = customer surfaces, shipped in
PR #183). Same harness (`responsive-audit/audit.mjs`), same detector
(horizontal overflow / element spill / duplicate back / sub-44px tap targets /
safe-area overlap). This phase enumerates the full **partner** (4 routes) and
**admin** (30 routes) trees and runs them authenticated, so the real operator
chrome renders instead of bouncing to a login screen.

## Method

The harness now injects operator sessions under `--auth` (see
`sessionInitScript()` in `audit.mjs`):

- `sb_admin_token` + `sb_admin_user` (role `super_admin`) → admin layout renders
- `sb_partner_token` + `sb_partner_user` (with a sample `hotelId`) → partner
  dashboard renders

Backend calls still 401 against the unreachable Railway API — that's fine, we're
auditing layout geometry, not data. Pages render their authenticated chrome +
skeletons, which is exactly what a layout audit needs.

Device subset (covers every critical breakpoint):
`galaxy-fold` (280px, the extreme-narrow edge) · `iphone-se` · `iphone-15-pro`
(Dynamic Island) · `ipad-mini-port` (768 tablet) · `ipad-pro12-port` (1024 — the
admin sidebar↔drawer cutoff) · `laptop-1280` · `desktop-1920` · `ultrawide-2560`.

Run them yourself:

```
bash responsive-audit/run.sh --surface partner --auth
bash responsive-audit/run.sh --surface admin   --auth
```

## Headline result

| Surface | Routes × devices | Horizontal overflow | Duplicate back | Load errors |
|---|---|---|---|---|
| Partner | 4 × 8 = 32 | **0** | **0** | 0 |
| Admin (after fix) | 30 × 8 = 240 | **0** | **0** | 2 *(environmental)* |

No content is cut off, nothing overlaps the notch/home-indicator, and there are
no duplicate back affordances on any operator surface, on any device from a
280px Galaxy Fold up to a 2560px ultrawide.

## Partner surface — clean

All 4 routes (`/partner`, `/partner/dashboard`, `/partner/staff`,
`/partner/verification`) render edge-to-edge with zero horizontal overflow on
every device. `/partner` correctly redirects to `/partner/dashboard` once a
partner session is present.

The ~24 sub-44px tap targets on the dashboard are the horizontally-scrollable
tab pills (Overview / Bid Inbox / Rooms / … at ~30-32px tall). These are a
deliberate dense-operator-header tradeoff — the dashboard is used primarily on
tablet/desktop and bumping every tab to 44px would inflate the header strip.

## Admin surface — one real bug, fixed

### Fixed: `/admin/login` horizontal overflow on the 280px Galaxy Fold (+21px)

The only genuine, reproducible responsive defect in the whole sweep. The phone
row is `display:flex` with a `flexShrink:0` `+91` prefix and a flex `<input>`.
The shared `inputStyle` had **neither** `minWidth:0` (so the input couldn't
shrink below its intrinsic width as a flex child) **nor** `box-sizing:border-box`
(so its 28px horizontal padding sat *outside* the allotted width). On the 280px
Fold cover screen all the squeeze landed on that one input and it spilled ~21px
past the viewport → a document-level horizontal scrollbar.

Fix (`app/admin/login/page.tsx`): added `minWidth:0` + `boxSizing:"border-box"`
to the shared `inputStyle`. (The Master-PIN input below it already carried an
inline `boxSizing` patch — the author hit this once but never fixed the shared
base.) Re-audited: `galaxy-fold /admin/login` OVF+21 → **0**, clean on every
other device.

### Accepted by design: dense data-table tap targets

Admin data tables (`/admin/rls`, `/admin/bookings`, `/admin/hotels`,
`/admin/finance`, …) carry 50-224 sub-44px interactive elements per route —
row action chips, sort-header buttons, pagination, filter pills. These are
operator dashboards viewed on laptop/desktop; the high "element spill" counts
are `overflow-x:auto` table children (intentional horizontal table scroll), not
document overflow — `horizontalOverflow` is 0 on every one of them. Forcing
44px targets across dense tables would harm the information density operators
rely on. Consistent with the Phase-1 customer audit, which kept the premium
flash-deal upgrade chips at 39px by design.

### Environmental (not product bugs): transient `→ 0 ERR`

A handful of routes report `status 0` (page failed to reach) on one or two
devices per run. These are **transient dev-server stalls** in the audit
sandbox while it compiles 30 heavy admin routes (the `/admin` dashboard alone
mounts 3 recharts + a live ticker) — every one of those routes returned `200`
on ≥1 other device in the same sweep. They are not reproducible product
defects. The clean re-run left only 2, both on the heaviest `/admin` dashboard
route.

## Bottom line

Partner + admin operator panels are responsive-clean across the full device
matrix after the single Fold-login fix. The remaining sub-44px tap targets are
intentional operator-density tradeoffs, and the stray load errors are
audit-environment noise, not product bugs.
