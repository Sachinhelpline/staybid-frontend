// ── Web Push (FCM) — client helper ────────────────────────────────────
// Phase-1 web push for the existing PWA / Play-Store TWA. Uses Firebase
// Cloud Messaging over the browser Push API. The device's installed
// Chrome engine (TWA) delivers the notification with the StayBid icon —
// no Capacitor / native rebuild needed.
//
// Everything is dynamic-imported INSIDE the functions + fully try/catch
// guarded so:
//   • SSR never touches firebase/messaging (no invalid-api-key crash —
//     same lazy discipline as lib/auth.tsx logout, v121.2).
//   • Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY → graceful no-op (the whole
//     feature stays dormant until the key is set in Vercel env).
//   • Unsupported browser (no Notification / PushManager) → no-op.
//
// Actual SENDING is server-side (Railway FCM Admin SDK draining
// notification_queue) — see docs/RAILWAY_FCM_PUSH_PASTE.md.

import { notify } from "@/lib/notifications";

const VAPID = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";
const FLAG = "sb_push_enabled";

const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export type PushResult = { ok: boolean; reason?: string; token?: string };

/** Is web push even possible on this device/browser + configured? */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    !!VAPID &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

/** Current permission state without prompting. */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function loadMessaging() {
  const [{ initializeApp, getApps, getApp }, msg] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  const supported = await msg.isSupported().catch(() => false);
  if (!supported) return null;
  const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  return { messaging: msg.getMessaging(app), msg };
}

async function saveToken(token: string): Promise<boolean> {
  try {
    const authToken = localStorage.getItem("sb_token");
    if (!authToken) return false; // only bind tokens to a signed-in user
    const r = await fetch("/api/push/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, platform: "web", userAgent: navigator.userAgent }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Ask permission (if needed), get an FCM token, register it, and wire the
 * foreground message handler. MUST be called from a user gesture handler
 * (button/tap) — browsers reject Notification.requestPermission otherwise.
 */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  try {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: perm };

    const loaded = await loadMessaging();
    if (!loaded) return { ok: false, reason: "messaging_unsupported" };

    const reg = await navigator.serviceWorker.ready;
    const token = await loaded.msg.getToken(loaded.messaging, {
      vapidKey: VAPID,
      serviceWorkerRegistration: reg,
    });
    if (!token) return { ok: false, reason: "no_token" };

    await saveToken(token);
    attachForeground(loaded.messaging, loaded.msg);
    try { localStorage.setItem(FLAG, "1"); } catch {}
    return { ok: true, token };
  } catch (e: unknown) {
    return { ok: false, reason: (e as Error)?.message || "error" };
  }
}

let foregroundAttached = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachForeground(messaging: unknown, msg: { onMessage: (m: any, cb: (p: any) => void) => unknown }) {
  if (foregroundAttached) return;
  foregroundAttached = true;
  try {
    msg.onMessage(messaging, (payload: unknown) => {
      const p = payload as { notification?: { title?: string; body?: string }; data?: Record<string, string> };
      const title = p?.notification?.title || p?.data?.title || "StayBid";
      const body = p?.notification?.body || p?.data?.body || "";
      const url = p?.data?.url;
      notify({
        kind: "info",
        title,
        body,
        duration: 6000,
        actions: url ? [{ label: "Open", href: url, primary: true }] : undefined,
      });
    });
  } catch {
    foregroundAttached = false;
  }
}

/**
 * Called on app load for already-opted-in users: re-attach the foreground
 * handler + refresh the token (FCM rotates tokens). No permission prompt.
 */
export async function refreshPushOnLoad(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    if (localStorage.getItem(FLAG) !== "1") return;
    const loaded = await loadMessaging();
    if (!loaded) return;
    const reg = await navigator.serviceWorker.ready;
    const token = await loaded.msg.getToken(loaded.messaging, {
      vapidKey: VAPID,
      serviceWorkerRegistration: reg,
    }).catch(() => "");
    if (token) await saveToken(token);
    attachForeground(loaded.messaging, loaded.msg);
  } catch {
    /* silent */
  }
}
