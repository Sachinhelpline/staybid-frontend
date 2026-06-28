# StayBid for Hosts — Soft Launch Prep

> **Status at v276 (2026-06-28):** Phases 1–7 are **live in production** on `main` (`SB_BUILD=v276-host-os-admin-hub`). The entire vertical is reachable today via the customer Menu → "StayBid for Hosts" and the admin sidebar → "🏠 StayBid for Hosts". This doc is the go/no-go checklist + Day 1–30 monitoring for widening exposure.

---

## What is live right now

| Surface | Route | State |
|---|---|---|
| Managed-portfolio landing + lead capture | `/host` | ✅ live, seeded copy |
| AI Design Studio | `/host/studio` | ✅ live (AI provider env-gated; mock fallback) |
| StayBid Store (17 products) | `/host/store` | ✅ live, Razorpay checkout (live keys) |
| Smart Property Discovery (15 properties) | `/host/properties` | ✅ live |
| Workforce on Demand (24 workers) | `/host/workforce` | ✅ live |
| Channel Manager (8 OTAs) | `/host/channels` | ✅ live (connect = request → admin sets up) |
| Admin Host Hub | `/admin/host` | ✅ live, 6 KPIs + 6 tabs + status mgmt |
| Customer menu entry | `lib/user-links.ts` | ✅ live, both menus |

---

## Go / no-go decision points

1. **Razorpay store checkout — real money.** The store uses **live** Razorpay keys (server-validated amounts). Decide: (a) keep it live for genuine purchases, or (b) 503 the checkout route (Rollback Strategy B) and run store as catalog-only until fulfilment ops are staffed. Browse + cart work either way.
2. **AI Design Studio provider.** Confirm whether a real AI provider key is set (`lib/host/design-ai.ts`) or it should stay on the deterministic mock for the soft launch. Mock still returns usable options.
3. **Channel-connect fulfilment.** A "Connect" is a **request**, not an automated OTA sync — it lands in `host_channels` (status `requested`) for the team to action via `/admin/host`. Confirm someone owns that queue before promoting the Channel Manager.
4. **Workforce hire fulfilment.** Same model — a hire is a `workforce_jobs` request (status `requested`) for ops to dispatch. Confirm the dispatch owner.
5. **Lead routing.** `host_leads` accumulate in `/admin/host`. Confirm who works that queue (sales) + their SLA.
6. **Announcement.** Silent rollout (link already in the menu) vs. an explicit push/banner. Recommend silent first, monitor a week, then announce.

---

## Pre-launch checklist

- [ ] Run `docs/HOST_OS_SMOKE_TESTS.md` abridged (⭐) pass on production — all green.
- [ ] One real end-to-end per inbound type: a lead, an inquiry, a hire request, a channel-connect request — each visible + status-changeable in `/admin/host`.
- [ ] Razorpay store decision made (live vs catalog-only) and applied.
- [ ] Each inbound queue (leads / inquiries / store orders / workforce jobs / channels) has a named owner + SLA.
- [ ] Admin team knows where the hub is (`/admin/host`).
- [ ] Rollback plan understood (`docs/HOST_OS_ROLLBACK.md` — Strategy A hides everything in one commit).

---

## Day 1–30 monitoring (Supabase `uxxhbdqedazpmvbvaosh`)

### First 24h — is anything flowing in?
```sql
SELECT 'leads' k, count(*) FROM host_leads WHERE created_at > now() - interval '24 hours'
UNION ALL SELECT 'inquiries', count(*) FROM discovery_inquiries WHERE created_at > now() - interval '24 hours'
UNION ALL SELECT 'store_orders', count(*) FROM store_orders WHERE created_at > now() - interval '24 hours'
UNION ALL SELECT 'workforce_jobs', count(*) FROM workforce_jobs WHERE created_at > now() - interval '24 hours'
UNION ALL SELECT 'design_projects', count(*) FROM host_design_projects WHERE created_at > now() - interval '24 hours'
UNION ALL SELECT 'channels', count(*) FROM host_channels WHERE created_at > now() - interval '24 hours';
```

### First 7 days — queue health (anything stuck in the intake status?)
```sql
SELECT 'leads' k, status, count(*) FROM host_leads GROUP BY status
UNION ALL SELECT 'inquiries', status, count(*) FROM discovery_inquiries GROUP BY status
UNION ALL SELECT 'jobs', status, count(*) FROM workforce_jobs GROUP BY status
UNION ALL SELECT 'channels', status, count(*) FROM host_channels GROUP BY status
ORDER BY 1, 3 DESC;
```
Watch for rows aging in `new` / `requested` — that means a queue has no owner working it.

### First 30 days — store conversion + GMV
```sql
SELECT count(*) FILTER (WHERE razorpay_payment_id IS NOT NULL) paid_orders,
       count(*) total_orders,
       coalesce(sum(total) FILTER (WHERE razorpay_payment_id IS NOT NULL), 0) gmv
FROM store_orders;
```

---

## Definition of a successful soft launch (7-day window)
- [ ] Zero unrecovered 500s on `/api/host/*` or `/api/admin/host`.
- [ ] At least one real inbound of each type captured + actioned in `/admin/host`.
- [ ] No inbound queue aging unworked past its SLA.
- [ ] No regression report on `/discover`, `/hotels/[id]`, bidding, bookings, admin, partner.
- [ ] If store checkout is live: ≥1 real paid order verified (HMAC) end-to-end.

---

## What's NOT in scope (future work)
- **Automated OTA sync** — Channel Manager is request-based; real Booking.com/Airbnb API sync is a later build.
- **Workforce live dispatch / tracking** — hire is request-based today.
- **Design Studio real renders** — depends on a production AI image provider key.
- **Partner-side host portfolio dashboard** — hosts track returns via the existing partner panel; a dedicated investor dashboard is future scope.
