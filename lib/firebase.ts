import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { configuredBrokerOrigin } from "@/lib/auth-broker";

// v620 — SAME-ORIGIN AUTH DOMAIN (env-gated, default OFF).
// ─────────────────────────────────────────────────────────────────────────
// The Google/Facebook popup flow routes its handshake through an iframe +
// popup on `authDomain`. With the default cross-origin authDomain
// (staybid-6feb7.firebaseapp.com), Chrome's third-party-storage rules
// (a) show users a confusing cookies permission prompt and (b) make the
// first sign-in attempt flaky (the "fails once, works on retry" reports).
// Firebase's officially documented fix is to serve the auth helper from the
// APP'S OWN origin: next.config.js proxies /__/auth/* + /__/firebase/* to
// firebaseapp.com, and authDomain points at staybids.in → no third-party
// iframe at all → no cookies prompt, no partitioned-storage failures.
//
// ⚠ INERT until BOTH steps in docs/PENDING-GOOGLE-AUTH-SAME-ORIGIN.md are
// done (Google OAuth redirect-URI + the Vercel env flag). Guarded to the
// production host only, so preview deployments keep the stock domain.
const SAME_ORIGIN_AUTH =
  process.env.NEXT_PUBLIC_FB_AUTH_SAME_ORIGIN === "1" &&
  typeof window !== "undefined" &&
  window.location.hostname === "staybids.in";

// P0.1-F — inert dedicated-host proof. The broker is accepted only when the
// public env name contains the exact audited origin. On that host the Firebase
// helper remains same-origin, while the installed Android app (whose compiled
// manifest matches only staybids.in) cannot claim the auth subdomain.
const BROKER_ORIGIN = configuredBrokerOrigin(process.env.NEXT_PUBLIC_AUTH_BROKER_ORIGIN);
const BROKER_AUTH =
  typeof window !== "undefined" &&
  BROKER_ORIGIN !== null &&
  window.location.origin === BROKER_ORIGIN;

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: BROKER_AUTH
    ? new URL(BROKER_ORIGIN).hostname
    : SAME_ORIGIN_AUTH
      ? "staybids.in"
      : process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const firebaseAuth = getAuth(app);
