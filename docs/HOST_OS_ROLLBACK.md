# StayBid for Hosts — Rollback Recipes

> **Purpose:** Per-phase emergency rollback for the host vertical. The whole vertical is **additive** — it adds new routes (`/host/*`, `/admin/host`), new API routes (`/api/host/*`, `/api/admin/host`), and new tables; it touches **no existing customer/admin/partner flow**. So in almost every case the safest "rollback" is to **hide the entry points**, not to revert code or drop tables.

## Rollback strategies (in order of preference)

### Strategy A — Hide the entry points (zero code revert, instant)
The host vertical is only reachable from a handful of nav surfaces. Removing them makes the whole vertical invisible while leaving the routes intact (and any in-flight data safe):

1. **Customer menu link** — remove the `/host` entry from `lib/user-links.ts` (`USER_LINKS_BASE`, the `🏠 StayBid for Hosts` row). Both desktop + mobile menus drop it in lock-step.
2. **Admin sidebar** — remove the `{ href: "/admin/host", … }` line from `components/admin/sidebar.tsx`.
3. **Landing CTAs** — any external surface linking to `/host` (if added later) — drop the link.

Result: `/host/*` and `/admin/host` still resolve if typed directly, but no user is routed there. This is the recommended first response to any UX/data concern — it's reversible in one commit and loses nothing.

### Strategy B — Targeted route disable (one handler)
If a single host API route misbehaves (e.g. the Razorpay checkout, or a slow studio generation), add an early-return at the top of that route's handler:
```ts
return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
```
Leaves every other host surface working. Use for `app/api/host/store/checkout`, `app/api/host/studio`, etc.

### Strategy C — Full code revert (last resort)
`git revert <merge-commit>` for the offending phase PR. Note the dependency order — later phases reference earlier ones:
- P1 foundation (landing + lead + `lib/host/modules.ts`) underpins everything.
- P2 studio · P3 store · P4 discovery · P5 workforce · P6 channels are mutually independent module routes — each can be reverted alone.
- **P7 admin hub** (`/admin/host` + `/api/admin/host`) is read-mostly over the other phases' tables — reverting it is safe and affects nothing else.

---

## Per-phase quick reference

| Phase | Adds | Quickest rollback |
|---|---|---|
| P1 landing | `/host`, `/api/host/lead`, `lib/host/modules.ts`, `host_leads` | Strategy A (remove menu link) |
| P2 studio | `/host/studio`, `/api/host/studio`, `host_design_projects/_options` | Strategy A or B (503 the studio route) |
| P3 store | `/host/store`, `/api/host/store/*`, `store_products/orders/order_items` | Strategy B (503 checkout) keeps catalog browse |
| P4 discovery | `/host/properties`, `/api/host/properties/*`, `discovery_properties/inquiries` | Strategy A |
| P5 workforce | `/host/workforce`, `/api/host/workforce/*`, `workforce_workers/jobs` | Strategy A |
| P6 channels | `/host/channels`, `/api/host/channels/*`, `host_channels` | Strategy A |
| P7 admin hub | `/admin/host`, `/api/admin/host` | Remove sidebar line (Strategy A) |

---

## Schema rollback — intentionally NOT recommended

Every host table is **additive** and isolated (no FK from any existing table points into them). Dropping them would:
- Lose any real leads / inquiries / orders / hire requests already captured.
- Break the seeded catalogs (`discovery_properties` 15, `store_products` 17, `workforce_workers` 24) that took curation.

If a table genuinely must be removed, do it **after** exporting its rows, and only the inbound tables — never the seeded catalogs. Forward-only is the house rule (no `DROP`/`TRUNCATE` in migrations).

## Things to remember
- The host vertical writes to its **own** tables only. No customer/partner/admin data is mutated by any host route except `admin_audit_log` (append-only) on admin status changes.
- Razorpay checkout amounts are **server-validated** — a rollback of the client never exposes a tamperable price.
- The `/host` chrome hide-gate lives in Navbar/DialerNav/ServerStatus/BottomDock; reverting P1 must also remove `/host` from those gate lists or the page double-renders chrome.
