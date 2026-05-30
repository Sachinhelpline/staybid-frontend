# StayBid responsive audit harness

A device-matrix layout auditor used for the cross-device UI/UX overhaul. For
every route × every device profile it loads the page in headless Chromium and
runs an in-page detector for the things that make a page feel non-native on a
given screen:

- **horizontal overflow** — the #1 "content cut off" symptom
- **elements spilling past the viewport edges** (with the worst offenders named)
- **duplicate back affordances** (heuristic — see caveat below)
- **tap targets < 44px** (native-feel / accessibility)
- **content hidden behind fixed top/bottom bars** (safe-area overlap)
- redirects, HTTP status, and console/page errors

## Run

```bash
# dev server must be up first:  npm run dev   (port 3000)
node responsive-audit/audit.mjs --surface customer
node responsive-audit/audit.mjs --surface customer --only /bid,/wallet --devices iphone-se,desktop-1920
node responsive-audit/audit.mjs --surface partner --no-shots
```

Flags: `--base <url>` · `--surface customer|partner|admin` · `--only <csv routes>`
· `--devices <csv ids>` · `--no-shots`.

Output (git-ignored, regenerable): `artifacts/<surface>/<device>/<route>.png`,
`report.json`, `report.md`.

## Device matrix

See `devices.mjs` — narrow/large Android phones, every iPhone shape, foldable,
tablets in both orientations (incl. the 768/1024 breakpoint boundaries),
laptops, desktops, ultrawide.

## Caveats (read before trusting a metric)

- **Duplicate-back is noisy.** The glyph/label heuristic matches carousel `‹`
  arrows and content that contains the word "back" (e.g. a hotel named "Camels
  Back Retreat"). Always eyeball the `backEls` list before acting.
- **Console-error counts** are dominated by backend-unreachable fetches when run
  without a live API / session; they are not layout bugs by themselves.
- **Auth-gated routes** redirect to `/auth` unless a session is injected — use
  the authenticated pass for their real layouts.

The reliable, low-false-positive signal is **horizontal overflow + named spill
elements**. Treat the rest as leads to verify, not verdicts.
