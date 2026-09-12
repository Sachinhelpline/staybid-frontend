"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// VG-CREATE-UX-01 — Verified Guest CREATE flow UX contract (source-scan).
// No network, no DB, no React renderer (matches the repo's source-scan style,
// e.g. verified-guest-picker.test.js). Guards the UX WIRING + the frozen
// authority boundary across the three flow files.
//
// Contract guarded here:
//   1. Reel-force REMOVED — a bound Verified-Guest stay opens the SAME
//      Reel/Photo/Story chooser (CreateSheet), not a hardcoded Reel composer.
//   2. One chooser reused — no duplicate second Reel/Photo/Story card set.
//   3. Locked Verified-stay row in the Composer — non-editable, no HotelPicker,
//      no "Tag a hotel" for verified_guest; generic path keeps HotelPicker.
//   4. hotelName is PRESENTATION ONLY — never sent in the upload body; server
//      authority (hotelId + bookingId + /verified-guest endpoint) unchanged.
//   5. Same-hotel disambiguation — picker shows dates + source + short ref, no
//      dedupe/collapse of legitimate rows.
//   6. Copy truthfulness — "photos, reels & stories" (Story is supported).
//   7. Zero-eligible → honest terminal picker empty-state, no upload bypass.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0,
  fail = 0;
const failures = [];
function ok(cond, name) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name);
    console.error("FAIL " + name);
  }
}
const count = (s, re) => (s.match(re) || []).length;

// ── files under test ──────────────────────────────────────────────────────────
const createFlow = read("components/discover/CreateFlow.tsx");
const feed = read("components/discover/InstagramHotelFeed.tsx");
const sheet = read("components/tier/UpgradeChoiceSheet.tsx");
const uploadGate = read("app/api/social/posts/verified-guest/route.ts");

// ── 1. Reel-force removed; the SAME chooser is reused ───────────────────────────
ok(/chooserOpen\?:\s*boolean/.test(createFlow),
  "1.1 CreateFlow exposes a controlled `chooserOpen` prop (reuse CreateSheet after binding)");
ok(/const\s+chooserIsOpen\s*=\s*chooserOpen\s*\?\?\s*sheetOpen/.test(createFlow),
  "1.2 CreateFlow chooser is controlled-or-internal (chooserOpen ?? sheetOpen)");
ok(/setComposer\(\{\s*open:\s*true,\s*kind\s*\}\)/.test(createFlow),
  "1.3 picking a kind in the chooser opens the Composer with THAT kind (no reel hardcode)");
ok(/chooserOpen=\{pickedChooserOpen\s*\|\|\s*undefined\}/.test(feed),
  "1.4 feed opens the controlled chooser (chooserOpen={pickedChooserOpen || undefined})");
ok(!/composerKind=\{pickedComposerOpen\s*\?\s*["']reel["']/.test(feed) &&
   !/composerKind=\{[^}]*["']reel["']/.test(feed),
  "1.5 feed NO LONGER force-opens the composer in Reel (composerKind=\"reel\" hardcode gone)");
ok(!/pickedComposerOpen/.test(feed),
  "1.6 the reel-forcing pickedComposerOpen state is gone (replaced by pickedChooserOpen)");
ok(count(feed, /setPickedChooserOpen\(true\)/g) >= 3,
  "1.7 all three hand-offs (auto-bind · picker · direct-share) open the chooser");

// ── 2. Exactly ONE Reel/Photo/Story card set (no duplicate chooser) ─────────────
// Scope to the CARD shape (`kind: "x", emoji:`) so the composer-state defaults
// (`{ open:false, kind:"reel" }`) are not miscounted as a second card set.
ok(count(createFlow, /kind:\s*["']reel["'],\s*emoji:/g) === 1 &&
   count(createFlow, /kind:\s*["']photo["'],\s*emoji:/g) === 1 &&
   count(createFlow, /kind:\s*["']story["'],\s*emoji:/g) === 1,
  "2.1 CreateSheet defines exactly one Reel/Photo/Story card set");
ok(!/title:\s*["']Reel["']/.test(feed) && !/title:\s*["']Reel["']/.test(sheet),
  "2.2 no duplicate Reel/Photo/Story card set in feed or UpgradeChoiceSheet");

// ── 3. Locked Verified-stay row in the Composer (Case 5) ───────────────────────
ok(/tierContext\?\.kind\s*===\s*["']verified_guest["']\s*\?/.test(createFlow),
  "3.1 Composer branches on tierContext.kind === 'verified_guest' for the hotel row");
ok(/data-sb-verified-stay=["']1["']/.test(createFlow),
  "3.2 Composer renders the locked Verified-stay row marker");
ok(/✓ Linked to your verified StayBid stay/.test(createFlow),
  "3.3 locked row states it is linked to the verified StayBid stay");
// The locked verified-stay row must be NON-editable: no HotelPicker opener, no
// Clear, inside that branch.
{
  const i = createFlow.indexOf('data-sb-verified-stay="1"');
  const j = createFlow.indexOf(") : (", i);
  const lockedBlock = i >= 0 && j > i ? createFlow.slice(i, j) : "";
  ok(lockedBlock.length > 0 && !/setHotelOpen/.test(lockedBlock),
    "3.4 the locked Verified-stay row NEVER opens the HotelPicker (no setHotelOpen)");
  ok(lockedBlock.length > 0 && !/onClick/.test(lockedBlock),
    "3.5 the locked Verified-stay row is non-interactive (no onClick to change the hotel)");
}
// Generic (non-tier / creator / hotel) path keeps the editable Tag-a-hotel control.
ok(/onClick=\{\(\)\s*=>\s*setHotelOpen\(true\)\}/.test(createFlow),
  "3.6 the generic 'Tag a hotel' HotelPicker control is preserved for non-tier posting");
ok(/<HotelPicker/.test(createFlow),
  "3.7 HotelPicker still mounted for the generic flow");

// ── 4. hotelName is PRESENTATION ONLY; server authority unchanged (Cases 7/8) ──
ok(/kind:\s*["']verified_guest["'];\s*hotelId:\s*string;\s*bookingId:\s*string;[\s\S]*?hotelName\?:\s*string;/.test(createFlow),
  "4.1 ComposerTierContext.verified_guest carries OPTIONAL hotelName (presentation)");
ok(/extraBody\.hotelId\s*=\s*tierContext\.hotelId;/.test(createFlow) &&
   /extraBody\.bookingId\s*=\s*tierContext\.bookingId;/.test(createFlow),
  "4.2 upload body forces hotelId + bookingId from tierContext (authority preserved)");
ok(!/extraBody\.hotelName/.test(createFlow) && !/hotelName\s*:\s*tierContext\.hotelName/.test(createFlow),
  "4.3 hotelName is NEVER placed in the upload body (never authority)");
ok(/["']\/api\/social\/posts\/verified-guest["']/.test(createFlow),
  "4.4 verified-guest posts still route to the secure /verified-guest endpoint");
ok(/tierContext=\{tierContext\}/.test(createFlow),
  "4.5 the bound tierContext is passed into the Composer (hotelId+bookingId survive kind-pick)");

// The server gate is untouched by this UX package (still strict authority).
ok(/resolveVerifiedMediaCustomer/.test(uploadGate) && !/socialUserFromReq/.test(uploadGate),
  "4.6 verified-guest upload gate still uses the strict media authority (unchanged)");

// ── 5. Same-hotel disambiguation in the picker (Section 4) ─────────────────────
ok(/formatDate\(b\.checkIn\)\}\s*→\s*\{formatDate\(b\.checkOut\)/.test(sheet),
  "5.1 picker shows check-in → check-out (distinguishes same-hotel stays)");
ok(/b\.source\s*===\s*["']bid["']\s*\?\s*["']Bid stay["']\s*:\s*["']Booking stay["']/.test(sheet),
  "5.2 picker shows the stay SOURCE (Bid stay / Booking stay)");
ok(/function shortRef\(/.test(sheet) && /shortRef\(b\.id\)/.test(sheet),
  "5.3 picker shows a SHORT friendly ref derived from the booking id (display only)");
ok(/\.slice\(-4\)/.test(sheet),
  "5.4 the ref is short (last 4), NOT the full internal identifier");
ok(/bookings\.map\(\(b\)\s*=>/.test(sheet) && !/bookings[\s\S]{0,40}\.filter\([^)]*hotel/i.test(sheet),
  "5.5 picker renders EVERY eligible row — no dedupe/collapse on hotel");
ok(/onPickedContext\(\{[\s\S]*?bookingId:\s*b\.id,/.test(sheet),
  "5.6 picking a row binds that row's EXACT bookingId (no collapse)");
ok(/hotelName:\s*b\.hotelName\s*\|\|\s*undefined/.test(sheet),
  "5.7 picker forwards optional hotelName (presentation) to the bound context");

// ── 6. Copy truthfulness (Section 5) ───────────────────────────────────────────
ok(!/reels\s*&(amp;)?\s*photos/i.test(sheet),
  "6.1 stale 'reels & photos' copy removed from the Verified-Guest flow");
ok(/photos,\s*reels\s*&(amp;)?\s*stories/i.test(sheet),
  "6.2 UpgradeChoiceSheet copy is truthful: photos, reels & stories");
ok(/Share photos, reels & stories from your verified StayBid stay\./.test(feed),
  "6.3 the Verified-Guest chooser subtitle is truthful (photos, reels & stories)");
ok(/subtitle=\{chooserOpen\s*\?\s*chooserSubtitle\s*:\s*undefined\}/.test(createFlow),
  "6.4 the truthful subtitle is shown ONLY on the Verified-Guest chooser, not the generic one");

// ── 7. Zero-eligible → honest terminal empty-state, NO upload bypass (Case 0) ──
ok(/No recent or current StayBid stays found/.test(sheet),
  "7.1 zero-eligible shows an honest terminal empty-state");
ok(/href="\/bookings"/.test(sheet),
  "7.2 empty-state primary CTA is /bookings (terminal path, not an upload bypass)");
ok(/setUpgradeStartPicker\(true\)/.test(feed) && /setUpgradeOpen\(true\)/.test(feed),
  "7.3 >1 or 0 stays routes to the picker (0 → its honest empty-state), never a direct upload");

// ── 8. Authority freeze — no decode-only / hint-header ownership introduced ────
ok(!/x-email/i.test(createFlow) && !/x-phone/i.test(createFlow),
  "8.1 CreateFlow introduces no x-email/x-phone ownership input");
ok(/setTierContext\(undefined\)/.test(feed),
  "8.2 feed clears a stale Verified-Guest binding on the fail-open path (no stale-context leak)");

// ── result ─────────────────────────────────────────────────────────────────────
console.log(`\nVG-CREATE-UX-01: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.error("\nFAILURES:\n  " + failures.join("\n  "));
}
process.exitCode = fail > 0 ? 1 : 0;
