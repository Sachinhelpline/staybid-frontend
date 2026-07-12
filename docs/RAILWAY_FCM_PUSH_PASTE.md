# Railway — FCM Web/Native Push sender (paste-ready)

> **Repo:** `Sachinhelpline/staybid-Live` → wherever your `notification_queue` drainer worker lives
> **Phase:** v321 — Web Push (Phase 1, on the existing PWA / Play-Store TWA — no Capacitor / native rebuild).
> **Status:** The frontend already ships everything on its side — a `push` + `notificationclick` service-worker handler, a `push_tokens` device-token table, an `/api/push/register` route, and a customer opt-in banner. Once a user taps **Enable**, their FCM token lands in `push_tokens`. **The only missing piece is the SENDER** — a small Firebase Admin SDK block that reads a `channel='push'` row from `notification_queue`, looks up the user's tokens, and calls FCM. Paste it into your drainer + redeploy and native/web push starts flowing. **`in_app` already works today** (the customer `<NotificationToast />` reads Supabase directly — no Railway involved).

---

## 0. Before the paste — one Firebase Console step + one Vercel env var (frontend side)

Web push needs a **VAPID key pair** (Firebase "Web Push certificate"). Without it, `pushSupported()` returns false on the client and the opt-in banner never shows (graceful no-op — zero risk, but also zero delivery).

1. Firebase Console → project **`staybid-6feb7`** → ⚙ Project settings → **Cloud Messaging** tab → **Web Push certificates** → **Generate key pair**. Copy the public key (starts with `B…`, ~87 chars).
2. Vercel (`staybid-customer-frontend`) → Settings → Environment Variables → add
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY = <that public key>` → **Redeploy**.

That is a frontend-only value (public, safe in client code). It does **not** go on Railway.

---

## 1. The data model (already live on Supabase)

`push_tokens` (migration `2026-07-12-v321-push-tokens.sql`, applied):

| column | type | note |
|---|---|---|
| `id` | TEXT PK | `pt_<uuid>` default |
| `user_id` | TEXT | matches `notification_queue.user_id` |
| `token` | TEXT | FCM registration token (UNIQUE) |
| `platform` | TEXT | `web` \| `android` \| `ios` (default `web`) |
| `user_agent` | TEXT | for debugging |
| `enabled` | BOOLEAN | `false` = user turned off OR token went stale |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

`notification_queue` (existing): the drainer already reads `channel` ∈ {email, sms, whatsapp, in_app}. **`push` is the new channel.** Same row shape: `{ user_id, channel, template, payload JSONB, status, ... }`.

---

## 2. Where the `channel='push'` rows come from (two options — pick one)

**Option A — Railway fans out (recommended, zero new frontend code).**
Your drainer already processes each pending row. When it sees a row it would send in-app/email, ALSO send a push to that same `user_id` (skip if the user has no enabled tokens). This is the least-work path: push mirrors whatever you already notify.

**Option B — Frontend enqueues explicit `channel='push'` rows.**
If you'd rather control exactly which events push, have the enqueue helper insert a second row with `channel='push'`. (Not shipped in v321 — say the word and I'll add it to the frontend's `queueNotification` server helper behind a flag.)

Either way, the SENDER below is identical — it just needs the `user_id`, a `title`, a `body`, and an optional `url`.

---

## 3. Install (Railway)

```bash
npm i firebase-admin
```

## 4. Init — Firebase Admin (once, at boot)

Use a **service account** (NOT the web `NEXT_PUBLIC_FIREBASE_*` keys — those are client-side). Firebase Console → Project settings → **Service accounts** → **Generate new private key** → download the JSON.

Add to Railway env (paste the whole JSON as one line, or the 3 fields):

```
FIREBASE_PROJECT_ID=staybid-6feb7
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@staybid-6feb7.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"
```

```ts
// lib/fcm.ts  (Railway backend)
import admin from "firebase-admin";

let app: admin.app.App | null = null;

export function fcm() {
  if (app) return admin.messaging(app);
  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Railway stores the \n literally — turn them back into real newlines.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FCM not configured (FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY)");
  }
  app = admin.initializeApp(
    { credential: admin.credential.cert({ projectId, clientEmail, privateKey }) },
    "staybid-fcm",
  );
  return admin.messaging(app);
}
```

## 5. The sender — call this for every push you want to deliver

```ts
// lib/sendPush.ts  (Railway backend)
import { fcm } from "./fcm";
import { createClient } from "@supabase/supabase-js";

// Service-role client so you can read + patch push_tokens regardless of RLS.
const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * Send one push to every enabled device of a user.
 * Returns { sent, pruned } — pruned = tokens FCM said are dead (we disable them).
 * DATA-ONLY payload: the StayBid service worker renders the notification itself
 * (see public/sw.js `push` handler), so Chrome does NOT show a duplicate.
 */
export async function sendPushToUser(
  userId: string,
  msg: { title: string; body: string; url?: string; icon?: string; tag?: string },
): Promise<{ sent: number; pruned: number }> {
  const { data: rows } = await sb
    .from("push_tokens")
    .select("token")
    .eq("user_id", userId)
    .eq("enabled", true);

  const tokens = (rows || []).map((r: any) => r.token).filter(Boolean);
  if (tokens.length === 0) return { sent: 0, pruned: 0 };

  // Data-only so the SW's own showNotification runs (no double bubble on web).
  const data: Record<string, string> = {
    title: msg.title,
    body: msg.body,
    url: msg.url || "/",
  };
  if (msg.icon) data.icon = msg.icon;
  if (msg.tag)  data.tag  = msg.tag;

  const res = await fcm().sendEachForMulticast({
    tokens,
    data,
    // Android app (TWA / future native) shows a system notification via `notification`;
    // web is driven by the SW `push` handler above. Keeping both is safe.
    android: { priority: "high" },
    webpush: {
      headers: { Urgency: "high" },
      fcmOptions: msg.url ? { link: msg.url } : undefined,
    },
  });

  // Prune dead tokens so we don't keep hammering them.
  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      dead.push(tokens[i]);
    }
  });
  if (dead.length) {
    await sb.from("push_tokens")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .in("token", dead);
  }

  return { sent: res.successCount, pruned: dead.length };
}
```

## 6. Wire into the drainer (Option A — fan-out)

Inside your existing per-row loop, after you've resolved the human-readable `title`/`body` for a `notification_queue` row (you already do this for in-app/SMS), add:

```ts
// Fan every notification out to push too (best-effort, never blocks the row).
try {
  await sendPushToUser(row.user_id, {
    title,                       // same title you use for the toast
    body,                        // same body
    url: row.payload?.url || deepLinkFor(row.template, row.payload),  // e.g. "/my-bids"
    tag: row.template,           // same-template pushes replace, not stack
  });
} catch (e) {
  console.error("[push]", row.id, e);   // swallow — push is additive, not critical
}
```

If you go with a dedicated `channel='push'` row instead (Option B), process it in the same loop:

```ts
if (row.channel === "push") {
  const { sent } = await sendPushToUser(row.user_id, {
    title: row.payload?.title || "StayBid",
    body:  row.payload?.body  || "",
    url:   row.payload?.url,
    tag:   row.template,
  });
  await markRow(row.id, sent > 0 ? "sent" : "failed");
  continue;
}
```

---

## 7. Test end-to-end

1. On the phone: open `staybids.in`, sign in, tap **Enable** on the notification banner (grant permission). A row appears in `push_tokens`.
2. From Railway (or a quick script): `await sendPushToUser("<that users.id>", { title: "Test", body: "StayBid push works 🎉", url: "/my-bids" })`.
3. Notification appears (foreground → in-app toast via `onMessage`; background/closed → the SW `push` handler renders it). Tapping it opens/focuses StayBid at `/my-bids`.

---

## 8. Things to avoid (documented so a future paste doesn't regress)

- **Never** send BOTH a top-level `notification` block AND expect the web SW to render — on web you'd get a double bubble. The sender above sends **data-only** (`data: {...}`) precisely so the SW's `showNotification` is the single source. Keep `android.notification` off for web-first delivery, or accept that Android may show its own.
- **Never** put the **service account** private key in any `NEXT_PUBLIC_*` var or ship it to the client. It lives only on Railway (`FIREBASE_PRIVATE_KEY`). The client only ever uses the public `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
- **Never** skip the dead-token prune. FCM returns `registration-token-not-registered` for uninstalled/expired devices; if you don't `enabled=false` them, every send keeps retrying dead tokens.
- **Never** block the drainer row on the push send — wrap in try/catch. Push is additive; a Firebase hiccup must not stall SMS/email/in-app.
- **Never** hardcode the icon path to something that isn't in `public/icons/` — the SW defaults to `/icons/icon-192x192.png` (verified present) + badge `/icons/icon-96x96.png`.

---

## Summary of what's already done vs what you paste

| Piece | Where | Status |
|---|---|---|
| SW `push` + `notificationclick` handlers | `public/sw.js` (v321) | ✅ shipped |
| `push_tokens` table | Supabase (migration applied) | ✅ shipped |
| `/api/push/register` (POST upsert / DELETE disable) | frontend | ✅ shipped |
| Client token helper (`enablePush` / `refreshPushOnLoad`) | `lib/push.ts` | ✅ shipped |
| Opt-in banner | `components/PushOptIn.tsx` | ✅ shipped |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Vercel env | ⏳ **Sachin — Step 0** |
| FCM Admin sender + drainer wire-up | Railway | ⏳ **Sachin — this doc** |
