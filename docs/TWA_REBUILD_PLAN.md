# StayBid TWA Rebuild — Tomorrow's Plan (with future-proof CI/CD)

> Generated 2026-05-17 after diagnosing the "URL bar appearing in Play Store app" issue.
>
> **Status today:**
> - ✅ `staybids.in/.well-known/assetlinks.json` deployed, content correct (`com.staybid` + SHA `38:35:22:FE:97:A4:B4:CB:EA:C3:BD:C2:FF:CD:0C:01:47:F1:40:0F:DA:C9:7D:58:5B:D8:C4:32:9D:BD:C7:8C`)
> - ✅ Apex domain redirect removed via Vercel API → apex serves content directly
> - ✅ Google's Digital Asset Links verifier returns `{"linked": true}` for both apex + www
> - ⚠️ Current Play Store APK is **Chrome Custom Tabs (CCT)**, not TWA — confirmed by the "Running in Chrome" label in the 3-dot menu
> - 🎯 Tomorrow's goal: rebuild APK as **proper Trusted Web Activity (TWA)** so URL bar disappears permanently

---

## 1. Tool decision — which generator to use

### Comparison

| Tool | TWA correctness | Difficulty | Maintainability | Recommendation |
|---|---|---|---|---|
| **Bubblewrap CLI** (Google's official) | ✅ Always pure TWA | Medium (needs Node + Java) | ✅ Best — config file in repo | **🟢 RECOMMENDED — gold standard** |
| **PWA Builder** (web GUI) | ⚠️ Can mistakenly select CCT template | Easy (browser only) | ❌ One-off downloads, no config persistence | 🟡 Fallback if Bubblewrap is hard |
| **Android Studio** (manual TWA implementation) | ✅ Pure TWA | Hard (Java/Kotlin code) | 🟡 Full control but heavy maintenance | ❌ Overkill for a PWA wrapper |
| **Capacitor** (Ionic) | ❌ Hybrid app, not TWA — uses WebView, not browser | Medium | 🟡 Different model entirely | ❌ Not what we want |

### Final recommendation
**Use Bubblewrap CLI.** Reasons:
1. Always generates pure TWA (no template confusion like PWA Builder)
2. `twa-manifest.json` config file commits to repo → version-controlled, reproducible
3. Same tool Google uses internally and recommends for production TWAs
4. Future-proof: can be automated via GitHub Action

PWA Builder is fine as fallback if Bubblewrap setup has issues — but you'd repeat the "make sure to select Trusted Web Activity" step every time.

Android Studio is for cases where you're writing custom Android code — not for wrapping a PWA.

---

## 2. Pre-flight checklist — share these with me tomorrow

When you message me tomorrow, copy this list and reply with the values:

```
[ ] Existing keystore file (`.jks` or `.keystore`) — confirm you have it
    (You said it's saved on your end. We need the FILE itself.)
[ ] Keystore password
[ ] Key alias name (e.g. "android" or "staybid")
[ ] Key password (usually same as keystore password)
[ ] Current versionCode from Play Console
    (Play Console → StayBid → Production / Closed Testing → Release notes)
[ ] Confirm Play App Signing is enabled? (Setup → App integrity)
[ ] Vercel API token revoked yet? (security — should be done before tomorrow)
```

**⚠️ Don't paste the keystore password in chat publicly.** I'll suggest the safest way to share when we start. (Options: encrypted notes service like 1Password share, or you keep password locally and I guide you through commands.)

---

## 3. Tomorrow's step-by-step — Bubblewrap path (recommended)

### Step 0: Setup (one-time, ~5 min)

```bash
# Install Bubblewrap CLI globally
npm install -g @bubblewrap/cli

# Verify install
bubblewrap --version
# Expected: 1.x.x

# Bubblewrap needs Java SDK (will prompt to install JDK if missing)
# On Windows: download from https://adoptium.net/
# On Mac: brew install --cask temurin
# On Linux: apt install default-jdk
```

### Step 1: Initialize TWA project

```bash
# Create a folder OUTSIDE the staybid-frontend repo for the Android project
mkdir staybid-twa && cd staybid-twa

# Bootstrap from the deployed manifest
bubblewrap init --manifest=https://staybids.in/manifest.json
```

Bubblewrap will ask several questions. **Answer these EXACTLY:**

| Prompt | Answer |
|---|---|
| Domain | `staybids.in` |
| URL path | `/` |
| App name | `StayBid` |
| Short name | `StayBid` |
| App package name | `com.staybid` ← **MUST MATCH existing** |
| Display mode | `fullscreen` |
| Orientation | `default` (or `portrait`) |
| Status bar color | `#07060e` (matches our theme) |
| Splash color | `#07060e` |
| Icon URL | accept default (`https://staybids.in/icons/icon-512x512.png`) |
| Maskable icon URL | accept default |
| Monochrome icon URL | skip |
| Shortcuts | accept default (uses our manifest's shortcuts) |
| Signing key location | path to your existing `.jks` file |
| Key alias | from your saved keystore |
| Key password | from your saved keystore |

This generates `twa-manifest.json` in the folder — **THIS FILE WE COMMIT** to the staybid-frontend repo for future builds.

### Step 2: Bump versionCode

```bash
# Open twa-manifest.json and set:
#   "appVersionCode": <current Play Console version + 1>
#   "appVersionName": "1.0.1" (or whatever — display string)
```

### Step 3: Build the AAB

```bash
bubblewrap build
```

Output: `app-release-bundle.aab` (the file you upload to Play Console)

Bubblewrap will ALSO regenerate `assetlinks.json` based on your signing key. **Compare** with our deployed one at `https://staybids.in/.well-known/assetlinks.json` — SHA-256 should match. If different, send me the new SHA and I'll update the deployed file.

### Step 4: Upload to Play Console

1. https://play.google.com/console → StayBid
2. Testing → **Closed testing** → existing track → **Create new release**
3. Upload the `app-release-bundle.aab`
4. Release notes: "TWA mode for fullscreen experience"
5. Save → Review release → Start rollout

### Step 5: Verify on your phone

1. Wait 10-30 min for Play Store to push the update
2. Open Play Store → My apps → StayBid → tap **Update**
3. Open app → **NO URL bar** at top
4. 3-dot menu should NO longer show "Running in Chrome"

If URL bar still shows: send me a screenshot of the 3-dot menu. Three possible causes:
- Wrong signing key used (SHA mismatch with assetlinks.json) — fixable by updating assetlinks.json with new SHA
- Bubblewrap didn't generate as pure TWA (very rare with Bubblewrap)
- Android verification cache (clear Chrome storage)

---

## 4. PWA Builder fallback path (if Bubblewrap setup fails)

1. https://www.pwabuilder.com
2. URL: `https://staybids.in` → Start
3. Wait for manifest analysis
4. **"Package For Stores"** → **Android** tab
5. **CRITICAL:** In the dialog, expand "Advanced options" and ensure:
   - Package ID: `com.staybid` ← MUST MATCH
   - Display mode: `fullscreen`
   - **Generation type: select the option that says "Trusted Web Activity (TWA)"** — NOT "Custom Tabs" or "WebView"
6. **Signing key:** "Use my existing signing key" → upload your `.jks` file
7. Generate → download AAB → upload to Play Console (same as Step 4 above)

Risk: PWA Builder UI changes occasionally. The "select TWA template" option may be hidden in a sub-menu — that's why I prefer Bubblewrap (no menu confusion).

---

## 5. Future-proof — commit Bubblewrap config + auto-build

After tomorrow's manual build succeeds, we'll:

1. **Commit `twa-manifest.json`** to staybid-frontend repo at `android/twa-manifest.json`
2. **Add GitHub Action** that:
   - Runs on every push to main where `public/manifest.json` changes
   - Calls `bubblewrap update` → regenerates AAB
   - Uploads to a draft Play Console release (manual approval still required)
3. **Single-command rebuild** anytime: `bubblewrap build` from the committed config

This means: future PWA manifest updates → automated TWA rebuild → only signed approval needed. No more clicking through PWA Builder forms.

---

## 6. What I'll need from you tomorrow (in order)

Share these one by one as we go:

1. **Right at start:** Confirm pre-flight checklist (above) — which OS you're on (Windows/Mac/Linux), do you have Node + Java, do you have the keystore file
2. **After `bubblewrap init` finishes:** Send me the generated `twa-manifest.json` contents — I'll verify package name + signing key are correct
3. **After `bubblewrap build` finishes:** Send me the SHA-256 from the auto-generated `assetlinks.json` — I'll verify it matches our deployed one (and update if needed)
4. **After Play Console upload:** Screenshot of the release page (confirming version + status)
5. **After app install on phone:** Screenshot of the app open WITHOUT URL bar (success!) or WITH URL bar (failure — we debug from there)

---

## 7. Why this won't trigger Google's "14-day rule" again

The 14-day Closed Testing rule is **per Google account, per app, one-time** for production graduation. Once your existing app is past the rule (or you're still in the count-down), uploading new APKs as updates to the SAME package (`com.staybid`):

- ✅ Does NOT reset the count
- ✅ Does NOT require new testers
- ✅ Existing testers get the update via Play Store
- ✅ You stay on the same track (Closed Testing → eventually Production)

Detailed reasoning: Google identifies your app by `applicationId` (package name). A new APK with the same `applicationId` + higher `versionCode` is an UPDATE, not a new app. The 14-day rule is tied to the app entity, not to individual APK uploads.

---

## 8. Vercel changes — DON'T revoke, but DO revoke the token

| Action | Decision |
|---|---|
| Apex domain redirect removal | **KEEP** — Google verifier needs apex to serve directly |
| `public/.well-known/assetlinks.json` file | **KEEP** — TWA verification depends on it |
| `next.config.js` `.well-known/` headers | **KEEP** — bulletproof against CDN config drift |
| Vercel API token `vcp_884n...` | **🔴 REVOKE NOW** — already used its one job, security |

Token revoke link: https://vercel.com/account/tokens → find `staybid-domain-fix` → 3-dot → Delete

---

## 9. Quick reference — current production state

```
Domain config:
  staybids.in       → serves content directly (no redirect)
  www.staybids.in   → serves content directly
  Both verified by Google Digital Asset Links: linked=true

Assetlinks file:
  Path:    public/.well-known/assetlinks.json (committed)
  Served:  https://staybids.in/.well-known/assetlinks.json (HTTP 200)
  Content: package_name=com.staybid, sha256=38:35:22:FE:...
  Headers: application/json, max-age=300, CORS=*

Vercel project:    staybid-customer-frontend (prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD)
Team:              team_ulUk1IYy4DFl2C1rJ5WU3kUm
Latest deploy:     https://staybids.in
Latest SB_BUILD:   v132.15-me-signedout-hero-drawer-sign-in
```

---

## 10. If something goes wrong tomorrow

If the keystore file is lost or the build fails for any reason:

**Plan B — Play App Signing rescue:**
1. Enroll in Google Play App Signing (Play Console → Setup → App integrity)
2. Google generates a NEW app signing key on their servers
3. You upload with any new upload key (no need for the lost original)
4. New SHA-256 will be DIFFERENT — add it to `assetlinks.json` array (we documented this in the `_setup` field of the file)

**Plan C — Full reset:**
- Worst case: create new app on Play Console with package `com.staybids` or `app.staybid.in` (DIFFERENT package name)
- Triggers fresh 14-day rule — but uses fresh assetlinks entry
- Old `com.staybid` app stays as it is until you choose to retire

We try Plan A (existing keystore) first tomorrow.

---

**Bottom line:** Tomorrow we'll run `bubblewrap init` + `bubblewrap build` + upload AAB to Play Console. Existing testers get the update automatically. No 14-day reset. URL bar permanently gone.

Just message me "tomorrow's plan ready, kya share karu" and we'll start from Step 0.
