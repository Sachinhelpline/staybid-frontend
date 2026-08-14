# ARCHITECTURE-LOCKED — Durable Non-Negotiable Decisions

> **READ THIS FIRST.** This file documents the immutable architectural boundaries of
> StayBid. Every rule here has been battle-tested through 700+ commits. Changing any
> of these without explicit owner approval and a full security re-audit puts the
> platform at risk. Before proposing an architectural change, verify it is not listed
> here.

---

## Database & Schema

### No Foreign Key Constraints
- **Rule:** `NO FK constraints anywhere. Ever.` Use TEXT CUID ids.
- **Why:** Frontend (Supabase PostgREST) and backend (Railway Prisma) cannot share a
  single FK model. TextIds allow side-loads (`?id=in.(a,b,c)`) without join plumbing.
- **Enforcement:** `information_schema.table_constraints` audited per PR. New FKs
  must be rejected in review.

### Additive-Only Migrations
- **Rule:** Migrations are FORWARD-ONLY. Never `DROP COLUMN`, never `DROP TABLE`,
  never `TRUNCATE`. Deprecate unused columns instead (leave them nullable).
- **Why:** Zero-downtime deploys; rollback safety; audit trail for compliance.
- **Enforcement:** `git diff HEAD migrations/` must show only `ADD`/`ALTER` ops.

### TEXT IDs (CUIDs, never UUIDs)
- **Rule:** All user-facing ids are `TEXT` (`ks_…`, `inv_…`, `feed_…`, etc.).
- **Why:** Readable in logs; URL-safe; collision-free; lower cardinality than UUIDs
  in indexes. Firebase UIDs are TEXT natively.
- **Enforcement:** Schema audit; new tables must specify `TEXT PRIMARY KEY` explicitly.

### Immutable `auth_identities` (Supabase)
- **Rule:** `auth_identities` is create-once only (SELECT+INSERT only; no UPDATE/DELETE).
  Unique constraint on `(provider, provider_uid)`.
- **Why:** Provider mappings must be permanent once set; prevents accidental admin
  de-linking; audit trail for identity history.
- **Enforcement:** Store tests verify wire-level calls exclude UPDATE/DELETE/PATCH.

### Row-Level Security on Every Protected Table
- **Rule:** Every table storing user/hotel/financial data has RLS enabled + FORCE.
  Default DENY; explicit allow-list per role.
- **Why:** Supabase PostgREST is public-facing; RLS is the only gate when using
  the service-role key.
- **Enforcement:** `information_schema.tables` audit; deployment gates enforce RLS+FORCE.

---

## Money Layer

### Single Source of Truth Per Engine
- **Rule:** Every money calculation (`pricing`, `splits`, `fees`, `commissions`,
  `payouts`) has ONE pure function that backs both UI preview AND server charge.
  **preview == charge == settlement.**
- **Why:** Prevents silent rounding bugs, double-chargers, and settlement disputes.
- **Enforcement:** Shared library (`lib/pricing/*`, `lib/b2b/engine.ts`,
  `lib/circle/attribution.ts`, `lib/inventory/engine.ts`) proves preview == charge
  by construction.

### Tamper-Safe Checkouts (Frozen State at Charge Time)
- **Rule:** Every value used in pricing is FROZEN onto the order/trade/booking row AT
  the moment of charge. The row carries `*_frozen` columns (e.g., `price_multiplier`,
  `buyer_fee_pct`, `sell_per_night`). Settlement reads ONLY the frozen values, never
  current config.
- **Why:** A later admin price change cannot retroactively alter a settled transaction.
- **Enforcement:** Code audit; each `/checkout` route must freeze the exact inputs
  before mint order; each `/verify` route reads only frozen values.

### Idempotent Settlement (4-Key Pattern)
- **Rule:** Every settlement verify uses a 4-key atomic idempotent PATCH:
  `(orderId, rowId, status=pending, ownership=in.(userIds))`
  - 0 rows flip → already processed or not yours → re-fetch, return 200 + current state
  - ≥2 rows flip → impossible (constraint violation or race) → 503
  - 1 row flips → success; use its final state
- **Why:** Race-safe; concurrent web requests never double-charge.
- **Enforcement:** Every settlement route implements this pattern. Deployment gates
  verify via SQL round-trip: order+verify with 2 concurrent clients → both get `200
  alreadyProcessed`, 0 rows duplicated.

### No Money Moves Without Cryptographic Proof
- **Rule:** A customer/partner never receives money or credit without a verified
  Razorpay payment (HMAC verified), a verified Supabase admin action (signed JWT),
  or a verified cron job (Bearer token). UI never mints transactions; server-only.
- **Why:** Prevents the classic "customer calls API directly and gets free credit".
- **Enforcement:** Every `/checkout` route requires Bearer token or Razorpay order.
  Every `/verify` route re-verifies payment signature. No exceptions.

---

## Authentication & Authorization

### Four Separate Token Families (Zero Sharing)
- **Rule:** Customer (`sb_token`), Partner (`sb_partner_token`), Admin
  (`sb_admin_token`), Worker (`sb_worker_token`) are COMPLETELY SEPARATE. A token
  for one role never works for another. No token can be reused across domains.
- **Why:** Compartmentalization; if one compromised, the others stay safe.
- **Enforcement:** `lib/auth.tsx` logout wipes all four separately. Each route explicitly
  checks its own token family. Tokens carry role in the JWT; mismatched role+token
  → 403.

### Admin Authority is Supabase Only (v622+)
- **Rule:** Admin identity (whether someone IS an admin, whether they are blocked,
  whether their role changed) comes ONLY from Supabase `public.users`, verified on
  EVERY request. Railway `admin`/`super_admin` rows grant NOTHING. A Railway row that
  tries to claim admin role → 403 `admin_link_denied`.
- **Why:** Single canonical source; instant revocation (block a Supabase admin and
  they lose access on next request).
- **Enforcement:** `/api/admin/*` gates re-read Supabase per request. Security suite
  tests both the happy path and the denial case (Railway admin row rejected).

### Customer Identity Resolution (Cross-Pool)
- **Rule:** A customer may have up to 4 rows in Railway `users` (Google UID, Facebook
  UID, phone+OTP, legacy). Callers MUST resolve identities via `resolveUserIds()` or
  `resolveOwnerIdsCrossPool()` (walk 3 axes: Firebase prefix-twin, phone variants,
  case-insensitive email). Never use `users.id` alone without a 3-axis resolve.
- **Why:** Prevents silent siloing of a customer's bookings/wallet across multiple rows.
- **Enforcement:** Code search: any `WHERE users.id=` without a resolve call → audit
  flag. `resolveOwnerIdsCrossPool` tests with real case-variant + phone variant rows.

### No Secrets in URLs, Ever
- **Rule:** Secrets travel ONLY in HTTP headers (`Authorization: Bearer ...`) or secure
  cookies (`httpOnly`, `Secure`). NEVER in query strings. URLs are logged by proxies
  and cached in browser history.
- **Why:** Prevents credential leakage to CDNs, proxies, browsers, and log aggregators.
- **Enforcement:** Cron routes reject `?token=` (will return 401); only Bearer header
  accepted. Security suite scans codebase for `?token=`, `?secret=`, `?key=`.

---

## Circle (Multi-Investor Model)

### Owned vs Operated Distinction (SEBI-Safe)
- **Rule:** `hotel_room_units.owner_user_id` (who BOUGHT the unit; NEVER transfers
  between investors) is DISTINCT from `inventory_blocks.investor_user_id` (current
  holder; TRANSFERS on resale). A resale moves ONLY the investor user id; guest
  attribution always uses the original owner id.
- **Why:** SEBI regulation: a unit's ownership is immutable; only the commercial right
  (the resale investor id) transfers. Guest payouts must track the ORIGINAL owner.
- **Enforcement:** Every B2B verify/resale flow explicitly stamps both ids. Settlement
  reads `owner_user_id` for payout routing. Code audit enforces no cross-wiring.

### Model-1/2/3 Boundaries Are Fixed
- **Rule:** Model 1 = platform-provisioned; Model 2 = B2B resale of M1 inventory;
  Model 3 = agent auction. Each has its own `circle_model1/2/3` service keys, distinct
  journeys, and distinct money paths. Cross-model code-sharing must NOT share business
  logic (separate `lib/circle/model1-*.ts`, `lib/circle/model2-*.ts`, etc.).
- **Why:** Compliance-clear; a pivot to one model does not break the others; auditable
  per-model revenue.
- **Enforcement:** `/circle/model{1,2,3}` routes are walled. Money engines have explicit
  `modelVersion` params. PR diffs visually separate per-model changes.

### No Auto Payouts (Manual Admin Rail Only)
- **Rule:** Circle owner payouts are NEVER automatic. An admin must explicitly review
  and approve each payout via `mark_guest_booking_paid` or `payout_owner_batch`. A
  refund on a paid row is flagged for re-review.
- **Why:** Prevents runaway auto-transfers in case of bugs; keeps ops in the loop.
- **Enforcement:** `/api/cron/circle-settlement` records owed rows; no automatic flip
  to `paid`. Manual admin action required. Regression suite verifies no auto-pay path.

---

## Pricing & Inventory

### Spine as the Wholesale Base (NOT a Markup)
- **Rule:** `room_date_price.live_price` (Spine ADR) is the WHOLESALE floor, not a
  base to markup. Flash floor ≤ Spine floor. Bid floor ≤ flash floor. Customer bid
  floor ≤ 50% of the bid floor (but server rejects below the true floor at charge).
- **Why:** Prevents inventory at a net loss; keeps the no-overpay guarantee (guests
  never pay above OTA equivalent).
- **Enforcement:** `/api/pricing/*` audits every booking; Spine data is real, not
  fabricated. Flash floor validation in checkout. Bid acceptance server-side clamps
  to the real floor.

### No "Yield Optimizer" (Market Pricing OFF)
- **Rule:** The code contains a `yieldOptimizer` function for dynamic bid floors, but
  it is SHIPPED DISABLED (never called by any route). An owner may decide to enable it
  later, but today: bid floor = static `floorPrice`, never dynamic.
- **Why:** Owner decision; complexity tradeoff. If enabled later, requires owner
  smoke-test.
- **Enforcement:** Search: `yieldOptimizer` appears in code but never invoked. The
  `bidFloor` is always `snap100(floorPrice)`.

---

## Reel Feed (5-Hop Dedup Chain)

### Exact `client_post_id` Dedup (NOT Fingerprints)
- **Rule:** Every new social post includes a unique `clientPostId` (generated by
  Composer on upload). Server saves it to `social_posts.client_post_id` (unique
  partial index). InstagramHotelFeed dedup by EXACT `_clientPostId` match (not
  caption fingerprint). Legacy fingerprint dedup is only a FALLBACK.
- **Why:** Prevents accidental re-posts of the same photo/caption combo from appearing
  twice. Exact match avoids false positives.
- **Enforcement:** No `clientPostId` → 400 on create. Every post MUST tag a hotel.
  Dedup test covers both exact + legacy fingerprint branches.

### Feed Filters on `moderation_status` (NOT Deleted)
- **Rule:** The feed filters `moderation_status=in.(APPROVED,AUTO_APPROVED)`. Posts
  with `PENDING_ADMIN_REVIEW` or `REJECTED` stay in the table (never deleted; audit
  trail) but don't render in feeds.
- **Why:** Compliance; a rejected post is still a record of what was submitted.
- **Enforcement:** Feed routes carry the filter. Code audit ensures the filter is
  never removed. Moderation status transitions are logged.

---

## Deployment & Secrets

### No Hardcoded Secrets Anywhere (Code Audit Mandatory)
- **Rule:** Razorpay key IDs / secrets, JWT secrets, Firebase credentials, Supabase
  keys, database passwords, admin tokens, OTP codes — NONE of these appear in code.
  They live ONLY in environment variables, and only the NAMES appear in code.
- **Why:** Repos are public-readable; a secret in code is a breach. Even if later
  rotated, the git history is permanent.
- **Enforcement:** `npm run test:security` + `git diff` scan for key patterns
  (`rzp_`, `sk-`, `BEGIN RSA`, etc.). Deployment gates block PRs with suspected
  secrets. Pre-commit hook encouraged (user-configured).

### `SB_BUILD` Version Badge (User-Facing)
- **Rule:** Every UI-visible release bumps `SB_BUILD` and the `vN` chip in
  `app/layout.tsx`. Visible to users; used for cache-busting + issue tracking.
- **Why:** Users can report "broken on v733" and the team knows exactly what code
  is deployed.
- **Enforcement:** Each PR updates both. No PR ships without a badge bump.

### Service-Worker Stability (`/sw.js`, stable HTML_CACHE name)
- **Rule:** The service worker URL is always `/sw.js` (never `/sw-v2.js` or other
  versioning). The static cache name (`staybid-static-v2`) is stable. ONLY the
  `HTML_CACHE` name bumps when UI/HTML changes. The sw.js fetch handler logic
  bumps the cache ONLY if the sw.js itself changes.
- **Why:** Prevents accidental cache-nuke or missed updates from misconfigured cache
  names. Clients always get `/sw.js` and check for updates on each load.
- **Enforcement:** Cache-name audit per PR. Build gate verifies stable name. No "set
  cache version to random string" patterns.

---

## Things That Are NOT Changeable

- The Stage home `/.sbh-*` layer contract (globals unlayered, desktop.css layered +
  @media guard)
- The scoring engine weights (`lib/hotel-score.ts`)
- The 5-hop reel-dedup chain (all 5 hops must stay in sync)
- Circle legal framing (SEBI-safe disclosure language; no "guaranteed" claims)
- The 24h bid grace window (`filterUserVisibleBids`)
- The .sbh-* scrollbar invariant (CSS alone cannot guarantee a classic scrollbar; the
  ScrollRail component is the workaround)
- The three-email resolution order (exact lowercase → case-insensitive → phone-stored)
- The `parseDbTime()` UTC-parse rule (timestamps are `without time zone` in Supabase)
- The "one bid per hotel" policy (customer + agent both have this rule enforced)

If you need to change ANY of these, read CLAUDE-HISTORY.md to understand the TRADEOFF
that locked it, then bring it to the owner for approval and a full security audit.

---

## Session Handoff

When a new agent starts work (Claude, ChatGPT, or any other):

1. **Read this file first** (you are here).
2. **Read the latest ledger entry** (`docs/upgrade/99-PROGRESS-LEDGER.md`, the newest
   date).
3. **Verify git state:** `git branch`, `git log --oneline -5`, `git status`. Confirm
   local branch aligns with the ledger.
4. **Confirm deployed state:** Check that the version badge (`SB_BUILD` in code) and
   the ledger agree on what is live.
5. **If anything looks stale**, ask the user OR check the commit history for the truth.

**Golden rule:** If CLAUDE.md says "v621 is current" and the ledger says "v733", the
ledger is the source of truth. Stale docs are OK; outdated state vectors are not.
