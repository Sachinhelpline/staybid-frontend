# StayBid for Hosts — Manual Smoke Test Checklist

> **Purpose:** Step-by-step verification of every flow the StayBid-for-Hosts vertical ships (Phases 1–7). Run this before a wider soft launch. Clickable on `staybids.in` (or a Vercel preview); a few checkpoints need browser DevTools or admin-panel access.
>
> **Coverage:** `/host` landing + lead capture · AI Design Studio · StayBid Store (catalog + Razorpay checkout) · Smart Property Discovery + inquiry · Workforce on Demand + hire · Channel Manager + connect · Admin Host Hub · cross-panel nav · existing-flow regression checks.
>
> **Time:** ~25 minutes full suite. ~8 minutes for the abridged "smoke" pass (the ⭐ items only).

---

## Test prerequisites

- [ ] **2 accounts ready:**
  - **Customer** — any signed-in user (`sb_token` in localStorage).
  - **Admin** — `users.role='admin'` (admin panel access via `sb_admin_token`).
- [ ] Browser DevTools open (Network tab) to read API responses.
- [ ] Latest `main` deployment is `READY` on Vercel (`SB_BUILD=v276-host-os-admin-hub`; the `v276` badge shows bottom-right).

### Seeded data state (verified 2026-06-28, Supabase `uxxhbdqedazpmvbvaosh`)
| Catalog (browse) | Rows | Inbound (created by users) | Rows |
|---|---|---|---|
| `discovery_properties` | 15 | `host_leads` | 0 |
| `store_products` | 17 | `discovery_inquiries` | 0 |
| `workforce_workers` | 24 | `store_orders` | 0 |
| | | `workforce_jobs` | 0 |
| | | `host_design_projects` | 0 |
| | | `host_channels` | 0 |

So the **browse** surfaces show real data immediately; the **admin hub** shows empty-state sections until users start interacting — both are expected pre-launch.

---

## Section 1 — `/host` landing + lead capture

### 1.1 ⭐ Landing renders, chrome hidden
- [ ] Navigate to `/host`.
- [ ] **Expect:** the managed-portfolio landing renders — budget tiers (Explorer ₹20K → Elite ₹2L+), Traditional-vs-StayBid, 6-step "How it works", 6 module cards, stats band.
- [ ] **Expect:** customer Navbar / DialerNav / BottomDock / ServerStatus are all **hidden** (the `/host` chrome hide-gate). No double headers.

### 1.2 ⭐ Lead capture writes a row
- [ ] Tap any "Apply" / "Talk to us" CTA → fill name + phone (+ optional email/city/message), submit.
- [ ] DevTools: `POST /api/host/lead` → `200 { ok: true, id }`.
- [ ] **Expect:** success confirmation in the UI.
- [ ] Validation: submit with a <8-digit phone → `400 "Name and a valid phone are required."`

### 1.3 Module cards route correctly
- [ ] Each of the 6 module cards (List & Launch · Design Studio · Store · Discovery · Workforce · Channels) opens its respective route (`/onboard`, `/host/studio`, `/host/store`, `/host/properties`, `/host/workforce`, `/host/channels`).

---

## Section 2 — AI Design Studio (`/host/studio`)

### 2.1 Generate design options
- [ ] Open `/host/studio`, sign in if prompted.
- [ ] Upload a room photo (or use the prompt path), pick a style + budget, generate.
- [ ] DevTools: `POST /api/host/studio` → returns a `project` + `options[]`.
- [ ] **Expect:** 5–10 style options render with est. cost + product lists.
- [ ] A `host_design_projects` row + `host_design_options` rows are written (verify later in the admin hub Design Studio tab).

> Note: design generation depends on the AI provider env (`lib/host/design-ai.ts`). If no provider key is set it falls back to a deterministic mock — options still render.

---

## Section 3 — StayBid Store (`/host/store`)

### 3.1 ⭐ Catalog browse
- [ ] Open `/host/store`.
- [ ] DevTools: `GET /api/host/store` → returns products.
- [ ] **Expect:** the 17 seeded products render with Buy / Rent / EMI modes, prices, categories.

### 3.2 Cart + Razorpay checkout
- [ ] Add items → cart total updates (subtotal + delivery fee).
- [ ] Proceed to checkout → `POST /api/host/store/checkout` creates a **server-validated** Razorpay order (the client never sets the amount).
- [ ] Complete a test payment → `POST /api/host/store/verify` → HMAC check → order marked paid; `razorpay_payment_id` stored.
- [ ] **Expect:** a `store_orders` row + `store_order_items` rows; visible under `/api/host/store/orders` for the user and in the admin hub Store Orders tab (with "paid ✓").

---

## Section 4 — Smart Property Discovery (`/host/properties`)

### 4.1 ⭐ Browse + filter
- [ ] Open `/host/properties`.
- [ ] DevTools: `GET /api/host/properties` → returns the 15 seeded `discovery_properties` (available only), ordered featured → score.
- [ ] City / type / max-rent filters narrow the list.

### 4.2 Inquiry
- [ ] Open a property → "I'm interested" → fill name + phone, submit.
- [ ] DevTools: `POST /api/host/properties/inquiry` → `200 { ok: true }`.
- [ ] **Expect:** a `discovery_inquiries` row referencing the `property_id`; visible in the admin hub Property Inquiries tab with the property **title** (not a raw id — fixed in v276 to side-load `discovery_properties`).

---

## Section 5 — Workforce on Demand (`/host/workforce`)

### 5.1 ⭐ Worker catalog + filters
- [ ] Open `/host/workforce`.
- [ ] DevTools: `GET /api/host/workforce` → returns active+available workers + distinct cities + skills.
- [ ] **Expect:** the 24 seeded workers render with ✅ verified / 🛡️ bg-checked / ⭐ rating / rate + unit / language pills. Skill + city chips filter.

### 5.2 Hire request
- [ ] Tap a worker → "Hire" → fill name + phone (+ when/duration/notes), submit.
- [ ] DevTools: `POST /api/host/workforce/hire` → `200 { ok: true, id }`. Worker `skill` + `rate` snapshotted onto the job.
- [ ] **Expect:** a `workforce_jobs` row (status `requested`); visible in the admin hub Workforce Jobs tab with the worker name.

---

## Section 6 — Channel Manager (`/host/channels`)

### 6.1 ⭐ Supported channels + connect request
- [ ] Open `/host/channels`.
- [ ] DevTools: `GET /api/host/channels` → returns the 8 supported OTAs (+ the user's existing connections, if any).
- [ ] Tap "Connect {channel}" → fill name + phone (+ optional property/listing URL), submit.
- [ ] DevTools: `POST /api/host/channels/connect` → `200 { ok: true, id }`. Invalid channel key → `400`.
- [ ] **Expect:** a `host_channels` row (status `requested`); the "Your channels" grid shows it as **Requested**; visible in the admin hub Channel Requests tab.

---

## Section 7 — Admin Host Hub (`/admin/host`)  ⭐

### 7.1 Dashboard loads
- [ ] Sign in to `/admin` as an admin, open **🏠 StayBid for Hosts** in the sidebar (between Bookings & Bids and Verification).
- [ ] DevTools: `GET /api/admin/host` → `200` with `kpis` + the 6 arrays.
- [ ] **Expect:** 6 KPI cards (Leads · Property inquiries · Design projects · Store orders+GMV · Workforce jobs+revenue · Channel requests).
- [ ] **Expect:** 6 tabs each showing the rows you created in Sections 1–6 (or a clean empty-state if none yet).

### 7.2 Status management
- [ ] On Leads / Inquiries / Orders / Jobs / Channels, change a row's status via the inline picker.
- [ ] DevTools: `PATCH /api/admin/host` → `200 { ok: true }`; the list re-loads with the new status colour.
- [ ] **Expect:** the change persists on refresh; an `admin_audit_log` row (`host_status_update`) is written.

### 7.3 Auth gate
- [ ] Hit `/api/admin/host` with no/invalid `x-admin-token` → `401 Unauthorized`.

---

## Section 8 — Cross-panel nav

### 8.1 Discoverable entry into `/host`
- [ ] As a signed-in customer, open the Menu (desktop Navbar dropdown OR mobile `/me` drawer).
- [ ] **Expect:** a **"StayBid for Hosts"** row (🏠, "Invest in a managed BnB portfolio") — both menus render it from `lib/user-links.ts` in lock-step. Tapping it opens `/host`.

---

## Section 9 — Regression checks (existing flows unaffected)

- [ ] ⭐ Customer reel feed `/discover` loads + plays as before.
- [ ] ⭐ Hotel detail `/hotels/[id]` Book Now / Negotiate / bid still work.
- [ ] ⭐ `/my-bids`, `/bookings`, `/passport` load normally.
- [ ] Admin panel: every pre-existing sidebar page still loads (the new Host entry didn't shift any routing).
- [ ] Partner dashboard `/partner/dashboard` tabs unaffected.

---

## Abridged smoke pass (⭐ only, ~8 min)
1.1 · 1.2 · 3.1 · 4.1 · 5.1 · 6.1 · 7.1 · 8.1 · 9 (the four ⭐ rows).

## Definition of a successful smoke run
- [ ] Every browse surface (store / properties / workforce / channels) shows seeded data.
- [ ] At least one lead + one inbound row (inquiry / hire / connect) created end-to-end.
- [ ] Admin hub shows those rows + a status change persists + is audit-logged.
- [ ] No regression in `/discover`, `/hotels/[id]`, `/my-bids`, `/bookings`, admin, partner.
