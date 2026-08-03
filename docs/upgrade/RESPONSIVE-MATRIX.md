# Responsive Coverage Matrix — full device matrix (program memory) — 139 routes · ICON 44/139 · RESP 3/139

> **The anti-memory-loss ledger for the responsive/fluid retrofit.** Every route in the app is
> listed here. A route is **RESP ✓** only after it PASSES the reusable harness
> (`docs/upgrade/responsive-audit.mjs`) at ALL 13 widths **× 2 themes** with zero overflow,
> zero WCAG-AA text/icon-contrast fail, zero decorative-emoji, no ultra-wide line-stretch, and no
> sub-floor font. Until then it is **pending** — "not measured = not verified".

**Device matrix (px):** 280 (Fold cover) · 320 · 360 · 390 · 414 · 768 · 834 (iPad) · 1024 · 1280 · 1440 · 1536 · 1920 · 2560.
**Themes:** light + dark (where the surface supports both; admin = dark-only).
**Wide-screen philosophy:** Hybrid — fluid `clamp()` type/space + content capped/centred at a premium max-width so 2560 never reads thin or gutter-heavy.

Legend: **ICON** = lucide/emoji-hybrid sweep done · **RESP** = full-matrix responsive pass.


### /admin  (42)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/admin` | ✓ | ⏳ |
| `/admin/analytics` | ✓ | ⏳ |
| `/admin/auction` | ✓ | ⏳ |
| `/admin/bookings` | ✓ | ⏳ |
| `/admin/channels` | ✓ | ⏳ |
| `/admin/circle` | ✓ | ⏳ |
| `/admin/circle-inventory` | ✓ | ⏳ |
| `/admin/circle-supply` | ✓ | ⏳ |
| `/admin/commission-rules` | ✓ | ⏳ |
| `/admin/complaints` | ✓ | ⏳ |
| `/admin/content` | ✓ | ⏳ |
| `/admin/creators` | ✓ | ⏳ |
| `/admin/feedback` | ✓ | ⏳ |
| `/admin/finance` | ✓ | ⏳ |
| `/admin/fraud` | ✓ | ⏳ |
| `/admin/hold-config` | ✓ | ⏳ |
| `/admin/holds` | ✓ | ⏳ |
| `/admin/host` | ✓ | ✓ v685 |
| `/admin/host/catalog` | ✓ | ⏳ |
| `/admin/host/pricing` | ✓ | ⏳ |
| `/admin/hotel-commission-rules` | ✓ | ⏳ |
| `/admin/hotels` | ✓ | ⏳ |
| `/admin/kpi` | ✓ | ⏳ |
| `/admin/login` | ✓ | ⏳ |
| `/admin/messages` | ✓ | ⏳ |
| `/admin/moderation` | ✓ | ⏳ |
| `/admin/notifications` | ✓ | ⏳ |
| `/admin/passport` | ✓ | ⏳ |
| `/admin/pricing` | ✓ | ⏳ |
| `/admin/redemption-codes` | ✓ | ⏳ |
| `/admin/redemption-rules` | ✓ | ⏳ |
| `/admin/reports` | ✓ | ✓ v685 |
| `/admin/revenue` | ✓ | ⏳ |
| `/admin/rls` | ✓ | ✓ v685 |
| `/admin/services` | ✓ | ⏳ |
| `/admin/settings` | ✓ | ⏳ |
| `/admin/support` | ✓ | ⏳ |
| `/admin/support/[id]` | ✓ | ⏳ |
| `/admin/support/metrics` | ✓ | ⏳ |
| `/admin/users` | ✓ | ⏳ |
| `/admin/verification` | ✓ | ⏳ |
| `/admin/videos` | ✓ | ⏳ |

### /agent  (4)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/agent` | — | ⏳ |
| `/agent/[id]` | — | ⏳ |
| `/agent/login` | — | ⏳ |
| `/agent/metrics` | — | ⏳ |

### /auth  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/auth` | — | ⏳ |

### /bid  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/bid` | — | ⏳ |

### /bookings  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/bookings` | — | ⏳ |

### /circle  (19)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/circle` | ✓ | ⏳ dock |
| `/circle/[id]` | — | ⏳ |
| `/circle/build` | — | ⏳ |
| `/circle/dashboard` | ✓ | ⏳ dock |
| `/circle/demand-cycle` | — | ⏳ |
| `/circle/discover` | — | ⏳ |
| `/circle/earnings` | — | ⏳ |
| `/circle/kyc` | — | ⏳ |
| `/circle/me` | — | ⏳ |
| `/circle/model2` | — | ⏳ |
| `/circle/model2/[id]` | — | ⏳ |
| `/circle/model2/browse` | — | ⏳ |
| `/circle/model2/review` | — | ⏳ |
| `/circle/model2/selling` | — | ⏳ |
| `/circle/model3` | ✓ | ⏳ dock |
| `/circle/model4` | ✓ | ⏳ dock |
| `/circle/onboard` | — | ⏳ |
| `/circle/profile` | — | ⏳ |
| `/circle/support` | — | ⏳ |

### /complaints  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/complaints` | — | ⏳ |

### /discover  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/discover` | — | ⏳ |

### /flash-deals  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/flash-deals` | — | ⏳ |

### /host  (11)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/host` | — | ⏳ |
| `/host/build` | — | ⏳ |
| `/host/channels` | — | ⏳ |
| `/host/list-property` | — | ⏳ |
| `/host/me` | — | ⏳ |
| `/host/properties` | — | ⏳ |
| `/host/property/[id]` | — | ⏳ |
| `/host/store` | — | ⏳ |
| `/host/studio` | — | ⏳ |
| `/host/workforce` | — | ⏳ |
| `/host/workforce/join` | — | ⏳ |

### /hotels  (4)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/hotels` | — | ⏳ |
| `/hotels/[id]` | — | ⏳ |
| `/hotels/[id]/feedback` | — | ⏳ |
| `/hotels/[id]/reviews` | — | ⏳ |

### /influencer  (9)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/influencer` | — | ⏳ |
| `/influencer/bookings` | — | ⏳ |
| `/influencer/dashboard` | — | ⏳ |
| `/influencer/earnings` | — | ⏳ |
| `/influencer/profile` | — | ⏳ |
| `/influencer/public/[id]` | — | ⏳ |
| `/influencer/referrals` | — | ⏳ |
| `/influencer/register` | — | ⏳ |
| `/influencer/upload` | — | ⏳ |

### /kiosk  (3)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/kiosk` | — | ⏳ |
| `/kiosk/book` | — | ⏳ |
| `/kiosk/display` | — | ⏳ |

### /me  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/me` | — | ⏳ |
| `/me/posts` | — | ⏳ |

### /my-bids  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/my-bids` | — | ⏳ |

### /my-codes  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/my-codes` | — | ⏳ |

### /onboard  (5)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/onboard` | — | ⏳ |
| `/onboard/signin` | — | ⏳ |
| `/onboard/signup` | — | ⏳ |
| `/onboard/verify` | — | ⏳ |
| `/onboard/wizard` | — | ⏳ |

### /order  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/order/[outlet]` | — | ⏳ |

### /partner  (4)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/partner` | — | ⏳ |
| `/partner/dashboard` | — | ⏳ |
| `/partner/staff` | — | ⏳ |
| `/partner/verification` | — | ⏳ |

### /passport  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/passport` | — | ⏳ |

### /points  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/points` | — | ⏳ |
| `/points/redeem` | — | ⏳ |

### /privacy-policy  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/privacy-policy` | — | ⏳ |

### /profile  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/profile` | — | ⏳ |

### /r  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/r/[code]` | — | ⏳ |

### /reels  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/reels` | — | ⏳ |

### /root  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/` | — | ⏳ |

### /saved  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/saved` | — | ⏳ |
| `/saved/posts` | — | ⏳ |

### /social  (3)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/social/feed` | — | ⏳ |
| `/social/profile/[username]` | — | ⏳ |
| `/social/upload` | — | ⏳ |

### /tag  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/tag/[name]` | — | ⏳ |

### /trade  (4)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/trade` | — | ⏳ |
| `/trade/[id]` | — | ⏳ |
| `/trade/my-bids` | — | ⏳ |
| `/trade/review` | — | ⏳ |

### /trust  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/trust` | — | ⏳ |

### /u  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/u/[username]` | — | ⏳ |
| `/u/[username]/posts` | — | ⏳ |

### /upgrade  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/upgrade` | — | ⏳ |

### /verification  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/verification` | — | ⏳ |
| `/verification/record` | — | ⏳ |

### /wallet  (1)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/wallet` | — | ⏳ |

### /worker  (2)

| Route | ICON | RESP |
| :--- | :--: | :--: |
| `/worker` | — | ⏳ |
| `/worker/dashboard` | — | ⏳ |


---
_RESP retrofit started v685 (Foundation). Update a row to ✓ only after a green full-matrix harness run; note the version in the commit._
