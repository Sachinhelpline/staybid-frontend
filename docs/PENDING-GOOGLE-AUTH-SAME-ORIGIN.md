# PENDING OWNER OPS — Kill the sign-in "cookies popup" 100% (same-origin auth)

**Status: code shipped v620, INERT until you do the 2 steps below (≈5 minutes).**

## What this fixes
Customer reports on Gmail login: a browser **cookies permission popup** keeps
appearing, and sign-in **fails on the first attempt but works on the second**.

Root cause: the Google sign-in handshake runs through
`staybid-6feb7.firebaseapp.com` (a *different* domain than staybids.in).
Chrome treats it as a third party → shows the cookies prompt and sometimes
loses the sign-in result on the first attempt.

v620 already shipped the code fix (Firebase's officially documented solution):
staybids.in now serves the auth handler itself via a proxy
(`/__/auth/*` + `/__/firebase/*` → firebaseapp.com), and `lib/firebase.ts`
can point the sign-in flow at staybids.in — **no third-party domain in the
loop at all** → no cookies popup, no first-attempt flakiness.

(Independent of this, v620 also made the sign-in page self-healing — popup
timeout, one automatic retry, redirect fallback — those are live already and
need no ops.)

## Activation steps (do IN ORDER)

### Step 1 — Google Cloud console (2 min)
1. Open https://console.cloud.google.com/apis/credentials?project=staybid-6feb7
2. Under **OAuth 2.0 Client IDs**, open the client named
   **"Web client (auto created by Google Service)"**.
3. Under **Authorized JavaScript origins**, ensure this entry exists (add if missing):
   - `https://staybids.in`
4. Under **Authorized redirect URIs**, ADD:
   - `https://staybids.in/__/auth/handler`
5. Save. (Existing `https://staybid-6feb7.firebaseapp.com/__/auth/handler`
   entry MUST stay — previews and the partner panel still use it.)

Also verify (usually already true): Firebase console → Authentication →
Settings → **Authorized domains** contains `staybids.in`.

### Step 2 — Vercel env var (1 min)
1. Vercel → project `staybid-customer-frontend` → Settings → Environment Variables.
2. Add for **Production only**: `NEXT_PUBLIC_FB_AUTH_SAME_ORIGIN` = `1`
   (do NOT add to Preview — previews keep the stock firebaseapp.com domain).
3. Redeploy production (any deploy picks it up).

### Step 3 — Verify (1 min)
On a phone where the cookies popup used to appear: open staybids.in →
sign out → Continue with Google. Expect: account chooser opens, **no cookies
prompt**, signed in on the FIRST attempt.

## Rollback
Delete the `NEXT_PUBLIC_FB_AUTH_SAME_ORIGIN` env var and redeploy — the flow
reverts to the stock firebaseapp.com domain instantly. The console entries
from Step 1 are harmless to leave in place.

## Scope notes
- The flag is host-guarded in code: only `staybids.in` ever uses the
  same-origin domain; previews/localhost are unaffected even if the env var
  leaks to them.
- Partner (`/partner`), onboarding and trade Google logins import the same
  `lib/firebase.ts`, so they get the same benefit automatically on
  staybids.in once the flag is on.
