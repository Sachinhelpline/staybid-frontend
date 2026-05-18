# Railway — Location OTP dispatcher paste-ready code

> **Repo:** `Sachinhelpline/staybid-Live` → `apps/api/src/index.ts` (or wherever existing `/api/auth/send-otp` lives)
> **Phase:** Phase 3 of the 2-Tier System.
> **Status:** Frontend Phase 2 already calls this endpoint (with graceful dev_otp fallback if it doesn't exist). Once you paste below + redeploy Railway, real SMS dispatch begins.
> **No new env vars required** — reuses your existing MSG91 / WhatsApp credentials.

---

## What this endpoint does (and what it does NOT do)

Unlike the existing `/api/auth/send-otp` (which generates + stores OTPs in Redis), this endpoint is purely a **dispatcher**. The frontend has already:

1. Validated the user is signed in
2. Verified the device is within 250m of the hotel (haversine)
3. Generated a 6-digit OTP
4. Stored a **SHA-256 hash** of the OTP in Supabase `location_verifications`

Railway's only job: take `{ phone, otp, hotelName }` from the request body and SMS/WhatsApp it to the user. No DB writes, no Redis, no JWT. Stateless.

Verify-OTP doesn't even touch Railway — frontend compares the user's typed OTP against the stored hash directly.

---

## Step 1 — Paste this handler

Find the section in `apps/api/src/index.ts` where `/api/auth/send-otp` is registered. Add this BELOW it. Reuses whatever MSG91 / WhatsApp helper functions are already in scope.

```ts
// ─── Location OTP dispatcher — Community Contributor flow (Phase 3) ──────
// Stateless: frontend already stored the OTP hash in Supabase. We just
// ship the human-readable code via SMS / WhatsApp.
//
// Body: { phone: "+91XXXXXXXXXX", otp: "123456", hotelName: "Mountain Grand" }
// Response: { ok: true }  on dispatch success
//           { error: "..." } on dispatch failure (frontend will surface
//                              dev_otp fallback in non-production)
app.post("/api/auth/send-location-otp", async (req, res) => {
  try {
    const { phone, otp, hotelName } = req.body || {};
    if (!phone || !otp) {
      return res.status(400).json({ error: "phone + otp required" });
    }

    // Normalize phone — same helper as /api/auth/send-otp uses.
    // Adjust the function name if your codebase calls it differently.
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    // Build the message body. The 5-min validity window matches the
    // 15-min Supabase location_verifications.expires_at default (gives
    // buffer for slow SMS delivery + user typing time).
    const safeHotel = String(hotelName || "your hotel").slice(0, 60);
    const message =
      `Your StayBid verification code for ${safeHotel} is ${otp}. ` +
      `Valid 15 min. Do not share. - StayBid`;

    // Dispatch via your existing helper. Two common patterns:
    //
    // (a) MSG91 SMS:
    //     await sendMsg91Sms(normalizedPhone, otp, MSG91_LOCATION_TEMPLATE_ID);
    //
    // (b) WhatsApp (Gupshup / Twilio / MSG91 WA):
    //     await sendWhatsApp(normalizedPhone, message);
    //
    // (c) If you have a unified helper, just call it:
    //     await sendOtpMessage(normalizedPhone, otp, { context: "location", hotelName: safeHotel });

    // Until DLT template for "location verification" is approved, the
    // safest path is WhatsApp (no DLT requirement):
    await sendWhatsApp(normalizedPhone, message);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[send-location-otp] dispatch failed", err);
    return res.status(500).json({
      error: "Dispatch failed",
      detail: err?.message || "unknown",
    });
  }
});
```

If your `sendWhatsApp` / `sendMsg91Sms` helpers use different names, swap them in. The endpoint signature (body shape + response shape) is what the frontend expects — don't change that.

---

## Step 2 — Optional: register a DLT template for SMS fallback

If you want SMS (not WhatsApp) for this flow, register a new DLT template on MSG91:

- **Template name:** `StayBid Location Verification`
- **Type:** Transactional
- **Sender ID:** Same `STAYBD` header you use for `/api/auth/send-otp`
- **Body:**
  ```
  Your StayBid verification code for ##VAR1## is ##VAR2##. Valid 15 min. Do not share. - StayBid
  ```
  - `##VAR1##` = hotel name
  - `##VAR2##` = OTP
- Approval window: 1-2 days (same DLT process as the login OTP)

Add the resulting template ID as a NEW env var on Railway:
```
MSG91_LOCATION_TEMPLATE_ID=<approved template id>
```

Then swap the `sendWhatsApp` line in the handler for the MSG91 call:
```ts
await sendMsg91Sms(normalizedPhone, otp, MSG91_LOCATION_TEMPLATE_ID, {
  VAR1: safeHotel,
  VAR2: otp,
});
```

WhatsApp-only (Step 1's default) ships immediately. SMS is a nice-to-have follow-up.

---

## Step 3 — Test path

After paste + redeploy, test from the deployed Railway URL:

```bash
curl -X POST https://staybid-live-production.up.railway.app/api/auth/send-location-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+91XXXXXXXXXX","otp":"987654","hotelName":"Test Hotel"}'
```

Expected: `{ "ok": true }`. WhatsApp / SMS arrives within 30 seconds.

---

## Step 4 — Verify frontend hand-off

Frontend route `/api/verify/location/send-otp` (already deployed) forwards to this endpoint as a fire-and-forget call. If Railway returns 200, the response includes `"dispatched": true`. If Railway is unreachable or returns non-200, the response includes `"dispatched": false` + `"dispatch_error": "..."` AND (in non-production only) `"dev_otp": "123456"` so the developer can still test end-to-end.

After Railway paste lands, the response should always include `"dispatched": true` (no more `dev_otp`).

---

## Things to avoid

- **Don't store the OTP on Railway.** The Supabase `location_verifications` row already has the SHA-256 hash. Storing it twice creates a sync risk.
- **Don't re-verify the user's auth on Railway.** Frontend has already validated the customer Bearer token + the device geofence. Railway just dispatches.
- **Don't add a JWT response.** This is a dispatcher, not a login endpoint. The 6-digit OTP returned to the user via SMS is the only credential.
- **Don't add a `phone-already-has-pending-otp` throttle on Railway.** Frontend's `location_verifications` table already enforces uniqueness via the partial index `idx_locv_pending` — a second `/send-otp` for the same `(user, hotel)` will simply create a second row in Supabase (intentional; allows resends).

---

## What happens before this is pasted

The frontend ships TODAY. Calls to `/api/verify/location/send-otp` will:

1. Validate the customer + geofence successfully
2. Store the OTP hash in Supabase
3. Attempt to forward to `/api/auth/send-location-otp` → get 404 from Railway
4. Return JSON with `"dispatched": false`, `"dispatch_error": "Railway endpoint not yet live (status 404)"`, and `"dev_otp": "123456"` (only in non-production)

The frontend tier UI can use `dev_otp` to test the full Community Contributor flow before this paste lands. In production, the response simply lacks `dev_otp` and the user has no path forward until you paste + redeploy.

---

## Once Railway redeploys

No frontend redeploy needed. The next time a user requests a location OTP:
- Frontend calls Railway → 200
- Response: `{ verification_id, distance_m, expires_at, dispatched: true }`
- WhatsApp arrives on user's phone
- User types OTP → frontend `/api/verify/location/verify-otp` validates hash → unlocks Community Contributor upload

**Done.**
