# StayBid Unified Channel Manager — Deep Analysis + Phased Build Plan

> Created v315 (2026-07-11). Sachin's directive: "partner dashboard ka Channel
> Manager 100% production-level professional channel manager banao — jo jo
> features kisi bhi professional channel manager me hote hain (API key / URL /
> jo bhi OTA-connect possibilities hain) sab working. StayBid Circle ka channel
> manager bhi check karo aur possible ho to dono ko merge karo. Pehle deep
> analysis, fir phased plan, fir phase-by-phase build."

---

## PART 1 — Deep analysis: what already exists (verified against code + live DB)

Three separate, overlapping "channel manager" systems exist today:

| # | System | Table(s) | Real or stub? | Entry point |
|---|--------|----------|---------------|-------------|
| A | Partner Channels tab (`ChannelManagerTab`) — credential vault + iCal export list + readiness checklist | `channel_connections` (**table was NEVER applied live** — route returns `provisioned:false`), export needs no table | Credential vault = **stub** (stores keys, zero connectors). iCal EXPORT = **real** | `/partner/dashboard` → Channels tab (subscription-locked service) |
| B | OTA iCal feed IMPORT | `ota_feeds` → `room_blocks` (`source='ota_ical'`) | **Real** parse+import, but: manual-trigger only (NO cron), NO cancellation reconciliation (append-only → cancelled OTA bookings block rooms forever), weak auth (any JWT, no ownership check), no `ota_feeds` migration file, 0 rows live | "🌐 OTA Channel Sync" panel inside the **Availability** tab (NOT the Channels tab) |
| C | Host-vertical channel manager | `host_channels` (1 row live) | **Pure lead-capture stub** — "Connect" inserts a request row; "our team will set up your sync" | `/host/channels` |

**Load-bearing real pieces to KEEP:**
- `app/api/partner/ical/[roomId]/route.ts` — public token-gated `.ics` EXPORT
  feed (StayBid → OTA). Correct `text/calendar` content-type, `DTSTART;VALUE=DATE`,
  events from confirmed bids + `room_blocks`. This is genuine 2-way sync when an
  OTA polls it.
- `lib/partner/ical-token.ts` — deterministic per-room feed token.
- `lib/availability.ts` — `parseICal` (RFC 5545 unfolding, Booking/Airbnb
  format), `getOccupations`, `unitsFreeForRange`, `room_blocks` as the single
  inventory sink.
- `channel_connections` schema design (per-hotel-per-OTA credential row) — good
  model, just never provisioned.

**StayBid Circle finding (the "merge" question):** `lib/circle/provision.ts`
has ZERO channel-manager code. Circle/host-circle hotels already surface on
`/partner/dashboard` via unit-ownership (`resolveOperatedHotelIds` scope
union). **Conclusion: there is only ONE dashboard — so there should be only
ONE channel manager.** The Circle "channel manager" Sachin remembered is the
same partner-dashboard tab. `host_channels` (System C) is an intake funnel,
not an engine — it stays as intake and its fulfillment routes into the unified
system (Phase 5).

---

## PART 2 — How professional channel managers connect to OTAs (reality check)

Connection methods, in order of practicality for StayBid today:

1. **iCal two-way sync (universal, ZERO certification needed)** — the method
   every small/new channel manager starts with (Beds24, Lodgify, Smoobu all
   support it):
   - **Export:** we serve an `.ics` URL per room; the hotel pastes it into the
     OTA extranet (Airbnb → Availability → Calendar sync → Import; Booking.com
     → Rates & Availability → Calendar sync; Vrbo, Agoda Homes, TripAdvisor
     rentals similar). The OTA polls it on its own schedule (typically every
     2–4 h; Airbnb ~2 h) and blocks those dates.
   - **Import:** the hotel copies the OTA's export `.ics` URL into StayBid; we
     poll it every N minutes and convert VEVENTs into `room_blocks`.
   - **Carries availability ONLY** — no rates, no restrictions, no guest data
     beyond the SUMMARY line. Sync is eventually-consistent (minutes–hours).
   - **Critical mechanics:** `DTEND` is exclusive (= checkout date, matches our
     `toDate` semantics), values are `VALUE=DATE`, UIDs must be stable, and a
     **cancellation = the VEVENT disappears from the feed** → the importer MUST
     reconcile (delete blocks whose UID vanished) or cancelled bookings block
     inventory forever.

2. **Official OTA connectivity APIs (certification required)** — the "full ARI"
   path: Booking.com Connectivity API (availability/rates/inventory push +
   reservations pull), Expedia EQC/Rapid, Agoda YCS, InGo-MMT (MakeMyTrip +
   Goibibo), Airbnb API (invite-only partner program), Hostelworld API. Each
   requires a business partnership + certification process (test hotels,
   compliance checks, usually weeks–months). Credentials vary: machine
   accounts, API keys, property IDs. **Architecture must reserve adapter slots
   + credential storage now; actual certified connectors are future scope
   (Phase 6) because they gate on business sign-ups, not code.**

3. **Extranet-assist / manual mode** — for OTAs with neither: the channel
   manager tracks the connection as `manual`, surfaces reminders and a task
   queue ("update rates on X extranet"), and logs what was done.

**Feature set of a professional channel manager** (the checklist this plan
builds toward):
- Per-OTA connection dashboard with live health status + last-sync + errors
- Room/rate-plan mapping (local room ↔ OTA room/listing/rate-plan ref)
- Pooled inventory model + overbooking protection (one pool, any booking
  decrements everywhere) — StayBid already has the pool (`room_blocks` +
  `hotel_room_units` + occupation engine); the CM connects it outward
- ARI push: availability, rates, min/max-stay, stop-sell (API channels);
  availability-only via iCal
- Reservation delivery: OTA bookings appear inside StayBid (guest, dates,
  channel), modifications + cancellations handled
- Channel-specific markups (+X% on OTA Y)
- Scheduled sync worker + retry/backoff + auto-pause on repeated failure
- Full sync audit log per channel + error alerts to the partner
- Bulk date-range updates; production-by-channel reporting

---

## PART 3 — Locked architecture decisions

1. **ONE channel manager.** Engine + UI live in the partner dashboard
   (`ChannelManagerTab`). Circle / host-circle operated hotels inherit it
   automatically because they already reach `/partner/dashboard` via the
   unit-ownership scope union — every new channel route resolves scope as
   `hotels.ownerId ∪ resolveOperatedHotelIds()` (new shared helper
   `lib/partner/hotel-scope.ts`).
2. **`host_channels` stays as INTAKE only.** `/host/channels` "Connect" keeps
   creating request rows; Phase 5 gives admin a "Set up sync" action that
   creates the real `channel_connections` + `ota_feeds` rows for the
   provisioned hotel and flips the request to `connected`. No second engine.
3. **Unified data model:**
   - `channel_connections` — master per-(hotel, OTA) connection row (mode:
     `ical` | `api` | `manual`), credentials, health.
   - `ota_feeds` — per-room iCal IMPORT feeds, linked to a connection via
     `connectionId` (nullable for legacy/standalone feeds).
   - `room_blocks` — unchanged; stays the single inventory sink
     (`source='ota_ical'`, `feedId`, `externalRef`=VEVENT UID).
   - `channel_room_mappings` — local room ↔ OTA room/rate-plan ref + per-channel
     markup (consumed from Phase 3).
   - `channel_sync_logs` — audit trail for every import/export/push run.
4. **iCal first, APIs by adapter.** `lib/channels/` hosts the engine; each
   future API connector is an adapter implementing the same interface
   (`testConnection` / `pushAri` / `pullReservations`). iCal is the first,
   fully-working adapter.
5. **Subscription gating unchanged.** "Channels" remains a `hotel_services`
   subscription service. (Phase 5 option: auto-grant `channels` to
   StayBid-operated hotels.)

---

## PART 4 — Phased build plan

### ✅ Phase 1 (v315, THIS SHIP) — Sync engine foundation
The invisible-but-critical layer everything else stands on.
- Migration: provision `channel_connections` live (it never was) + health
  columns; formalize `ota_feeds` + engine columns (`connectionId`, `autoSync`,
  `syncIntervalMin`, `consecutiveFailures`, counters); NEW `channel_sync_logs`;
  NEW `channel_room_mappings` (schema locked now, consumed Phase 3).
- `lib/channels/sync.ts` — ONE shared import engine (manual route + cron):
  - **Cancellation reconciliation** — VEVENT vanished from feed → its imported
    future-dated `room_blocks` row is DELETED (inventory released). The single
    biggest correctness gap in the old importer.
  - Idempotent by (feedId, UID); per-fetch 8s timeout; SSRF guard on feed URLs;
    `consecutiveFailures` counter with auto-pause at 10; `channel_sync_logs`
    row per run; graceful degrade if new columns aren't applied yet.
- `lib/partner/hotel-scope.ts` — owned ∪ operated hotel scope (the merge).
- `/api/partner/ota-feeds` rewritten: real ownership auth (was: any JWT),
  provider whitelist, URL safety check, room-belongs-to-hotel check, `id`
  always set server-side, immediate first sync on create, NEW PATCH
  (pause/resume/interval/label).
- `/api/partner/ota-feeds/sync` rewritten on the shared engine (same response
  contract + `removed` count).
- NEW `/api/cron/channel-sync` — scheduled sync every 15 min via cron-job.org
  (auth: `?token=` / Bearer CRON_SECRET / `adm_` token; ≤24s budget per
  v241.27 discipline; batches of 5; 40 feeds/run cap; due = `lastSyncAt`
  older than per-feed `syncIntervalMin`).

### Phase 2 (v316) — Unified Channel Manager console (UI)
- Rebuild `ChannelManagerTab` as the single console: per-OTA connection cards
  with live health/status/last-sync/error, iCal import feed management moved IN
  from the Availability tab (kept there as a link), per-OTA step-by-step
  connect instructions (exact extranet paths for Airbnb / Booking.com / MMT /
  Goibibo / Agoda / Expedia), copy-ready export URLs, manual "Sync now",
  sync-log viewer, connection health rollup.
- Auto-create/patch the `channel_connections` row (mode=`ical`,
  status=`active`) when a feed is added, so connections + feeds stay linked.

### ✅ Phase 3 (v317, SHIPPED) — Room mapping + rates layer (ARI foundation)
- Room-mapping UI (local room ↔ OTA room/listing ref) per connection, inside
  the console — `RoomMappingSection` in `ChannelManagerTab`. Channel selector +
  per-room OTA-ref + markup% + live channel-rate preview.
- Per-channel markup% on `channel_room_mappings`; "channel rate preview" =
  spine `live_price` × (1 + markup%). `/api/partner/channel-rate-preview`
  returns per-mapping previews + `roomPrices` (every room's spine live price so
  the editor previews before the first save). Rate ← `resolveSpinePrices`.
- `lib/channels/adapters/` — `ChannelAdapter` interface (`types.ts`) + iCal
  adapter (availability-only; `testConnection` validates a feed URL /
  BEGIN:VCALENDAR) + API-stub adapter (honest "configured · awaiting
  connector") + manual adapter + `getAdapter(ota, mode)` registry.
  `/api/partner/channel-test` runs the adapter's testConnection + best-effort
  updates `channel_connections.health_status`.
- `/api/partner/channel-mappings` GET/POST(upsert on conflict)/PATCH/DELETE —
  owner∪operated scoped, room-belongs-to-hotel checked, markup clamped
  −50…+200%.
- Restrictions data model (stop-sell / min-stay / max-stay per room-date) added
  as `"stopSell"`/`"minStay"`/`"maxStay"` columns on `room_date_overrides`
  (`migrations/2026-07-11-v317-channel-manager-restrictions.sql`, applied live).
  Locked for the Phase 6 ARI push; `AriCell` already carries them.

### ✅ Phase 4 (v318, SHIPPED) — Reservation intelligence + alerts
- **OTA reservations inbox** — `/api/partner/channel-reservations` (owner∪operated
  scoped, read-only): `room_blocks(source=ota_ical)` surfaced as channel bookings
  (guest name from SUMMARY, dates, nights, status in_house/upcoming/checked_out)
  + per-channel production stats (count/nights/upcoming). Rendered in
  `ChannelManagerTab` under the import feeds (channel chips + reservation list +
  show-all). Cancelled OTA bookings vanish automatically (the reconciling sync
  engine deletes the block).
- **Overbooking guard** — `/api/partner/overbooking-check`: for the nearest
  future OTA blocks (cap 40, 180-day horizon) it runs the SAME `unitsFreeForRange`
  the booking flow uses; flags every window where `occupied > capacity`
  (fail-open on no-capacity-signal). Surfaced as a red urgent banner high in the
  console (room, dates, provider, occupied/capacity). Same math verified live
  (capacity 1, occupied 2 → conflict).
- **Partner notifications** (`lib/channels/sync.ts` → `notify-server`
  `queueNotification`, in_app-always + env-flagged sms/whatsapp/email) fired to
  owner∪operator user ids on a REAL change only (idempotent imports = naturally
  debounced): `channel_reservation_imported`, `channel_reservation_cancelled`,
  `channel_feed_paused` (on auto-pause after 10 failures), and
  `channel_overbooking` (bounded check over just-imported blocks, cap 8).

### Phase 4 — Things to Avoid
- **Never** fire a channel notification unconditionally in the sync engine —
  only when `base.imported > 0` / `base.removed > 0` / an auto-pause happens.
  Idempotent-by-UID imports mean a steady feed changes nothing on repeat syncs;
  that natural debounce is what keeps the 15-min cron from spamming.
- **Never** raise the overbooking `MAX_BLOCKS` (40) / `OVERBOOK_CHECK_CAP` (8)
  without a per-item timeout — `unitsFreeForRange` does 1–3 fetches each; the caps
  bound both the on-demand endpoint and the sync hot path.
- **Never** flag an overbooking when `unitsFreeForRange` returns null (no
  capacity signal) — fail open, or you raise false alarms on hotels that haven't
  configured units/quantity.
- **Never** notify only `hotels.ownerId` — resolve owner ∪ `hotel_room_units.
  owner_user_id` so Circle/host-circle operators get channel alerts too.

### ✅ Phase 5 (v319, SHIPPED) — Circle/Host merge completion + admin console
- `/admin/host` Channels tab gets **"⚡ Set up sync"** → `/api/admin/host/channel-setup`
  resolves the requester's hotel (owner ∪ operated; hotel-picker modal when >1),
  creates a `channel_connections` row (mode=ical if the listing URL is a safe
  iCal http(s) feed, else mode=api "awaiting connector"), creates an `ota_feeds`
  row + runs first sync for iCal, **auto-grants the `channels` subscription
  service** (access_type=free) so the partner's Channel Manager unlocks, and
  flips `host_channels.status` → `connected`. `adminFromReq` + `logAdminAction`;
  best-effort per step.
- **Admin channel-health console** `/admin/channels` (sidebar "📡 Channel
  Health") — `/api/admin/channels` GET returns every `ota_feeds` + `channel_connections`
  row across all hotels (hotel names manually side-loaded, no FK embed) + a
  health rollup (ok / error / paused / stale / idle; stale = active but no sync
  in > 90 min). Per-feed **"↻ Re-sync"** POSTs `{feedId}` → the SAME shared
  `syncFeed` engine the partner + cron use. Audit-logged.
- Verified live: channel_connections/hotel_services/ota_feeds write shapes
  accepted, `uniq_channel`/`uniq_hotel_service` upsert targets confirmed, round
  trip cleaned. `tsc` clean, `next build` green.

### Phase 6 (future, business-gated) — Certified API connectors
- Booking.com Connectivity, InGo-MMT, Agoda YCS, Expedia — each lands as an
  adapter once the corresponding partner certification exists. Code slots are
  ready from Phase 3; this phase is gated on business sign-ups, not code.

---

## Things to Avoid (locked for all phases)
- **Never** import OTA events without the reconciliation pass — append-only
  import = cancelled OTA bookings block inventory forever (the pre-v315 bug).
- **Never** delete past-dated imported blocks during reconciliation — only
  `toDate >= today` rows; history stays.
- **Never** fetch a partner-supplied feed URL without the SSRF guard + timeout.
- **Never** scope a channel route by `ownerId` alone — always
  `lib/partner/hotel-scope.ts` (owned ∪ operated) or Circle partners lose the
  channel manager.
- **Never** add a second sync engine — `lib/channels/sync.ts` is the single
  code path for manual + cron + future adapters.
- **Never** let the cron exceed ~24s wall time (cron-job.org 30s client
  timeout — v241.27 discipline).
- **Never** show fake "connected" status for API-mode channels until a real
  certified adapter exists — honest status: `configured` (credentials saved,
  awaiting connector) vs `active` (iCal live).
