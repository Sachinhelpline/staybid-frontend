# MSG91 SMS OTP — Railway Backend Paste-Ready Code

> **Status:** Waiting on user to complete 3 manual steps in MSG91 + Railway dashboards. Once done, paste the code in Section 4 → done.
> **Repo:** `Sachinhelpline/staybid-Live` → `apps/api/src/index.ts`

---

## Step 1 — Create Authkey on MSG91 (5 minutes)

You're already on the right page: `control.msg91.com/app/m/l/settings/security/authkey`

1. Top-right blue button: **"+ Create Authkey"**
2. Form mein bhar:
   - **Name:** `Production Backend`
   - **Permissions:** Check both → ☑ Send SMS ☑ OTP
   - **IP whitelist:** Leave empty for now (Railway IPs are dynamic). Can lock down later.
3. Generate → **copy the authkey** (long alphanumeric string)
4. Save in a password manager — MSG91 won't show it again

---

## Step 2 — Register DLT-approved SMS template (1–2 days approval)

Indian carrier regulation. Carriers reject non-DLT messages.

1. MSG91 left sidebar → **SMS → Manage Templates**
2. **"+ Add Template"**
3. **Template name:** `StayBid OTP Verification`
4. **Template type:** `Transactional` (not Promotional)
5. **Sender ID (Header):** `STAYBD` (or any DLT-approved 6-char header you already own; ask MSG91 support if unsure)
6. **Template body** — paste exactly:
   ```
   Your StayBid verification code is ##OTP##. Valid for 10 minutes. Do not share this code with anyone. - StayBid
   ```
   - `##OTP##` is the variable that MSG91 will fill at send time
7. **DLT Entity ID + Template ID** — MSG91 will ask you for these. If you haven't registered on DLT portal yet:
   - Go to https://www.fast2sms.com/dlt-registration (or any DLT portal)
   - Register as principal entity → submit GST/PAN/company docs
   - 1–2 day approval window
8. Once approved → MSG91 gives you a **Template ID** (long number like `64a9...`). Copy it.

---

## Step 3 — Railway env vars (2 minutes)

Railway dashboard → your project → **Variables** tab → add:

| Key | Value |
|-----|-------|
| `MSG91_AUTHKEY` | (from Step 1) |
| `MSG91_TEMPLATE_ID` | (from Step 2) |
| `MSG91_SENDER_ID` | `STAYBD` (or your registered 6-char header) |
| `REDIS_URL` | Should already exist (Upstash). If not: `rediss://default:<password>@stirring-hog-94337.upstash.io:6379` |
| `JWT_SECRET` | Should already exist |

Save → Railway auto-redeploys.

---

## Step 4 — Paste this code in `apps/api/src/index.ts`

Find any existing `/auth/send-otp` and `/auth/verify-otp` handlers and **replace them** with this. Add the imports at the top of the file.

```ts
// ── Imports (add to top of index.ts if not already present) ──────────
import Redis from "ioredis";
import jwt from "jsonwebtoken";

// ── MSG91 SMS OTP — Indian carrier-compliant OTP flow ────────────────
// Routes: POST /auth/send-otp  → { phone }
//         POST /auth/verify-otp → { phone, otp } → { token, user }
// Storage: Upstash Redis with 10-min TTL.
// Throttle: 30s cooldown between sends, 5 wrong-attempt lockout.

const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
});

const MSG91_AUTHKEY     = process.env.MSG91_AUTHKEY!;
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID!;
const MSG91_SENDER_ID   = process.env.MSG91_SENDER_ID || "STAYBD";
const OTP_TTL_SECONDS   = 600;
const RESEND_COOLDOWN_S = 30;
const MAX_ATTEMPTS      = 5;
const JWT_SECRET        = process.env.JWT_SECRET!;
const JWT_EXPIRY        = "7d";

// Normalize: strip non-digits, take last 10, prepend "91"
function normalizePhone(input: string): string | null {
  const digits = String(input || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return null;
  return "91" + last10;
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const otpKey      = (p: string) => `otp:${p}`;
const cooldownKey = (p: string) => `otp:cooldown:${p}`;
const attemptsKey = (p: string) => `otp:attempts:${p}`;

// ── POST /auth/send-otp ──────────────────────────────────────────────
app.post("/auth/send-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Invalid phone — must be 10 digits" });

    const onCooldown = await redis.get(cooldownKey(phone));
    if (onCooldown) {
      return res.status(429).json({ error: "Please wait 30s before requesting another OTP" });
    }

    const otp = generateOtp();
    await redis.set(otpKey(phone), otp, "EX", OTP_TTL_SECONDS);
    await redis.set(cooldownKey(phone), "1", "EX", RESEND_COOLDOWN_S);
    await redis.del(attemptsKey(phone));

    const msg91Res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey: MSG91_AUTHKEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        template_id: MSG91_TEMPLATE_ID,
        short_url: "0",
        sender:    MSG91_SENDER_ID,
        recipients: [{ mobiles: phone, VAR1: otp }],
      }),
    });

    if (!msg91Res.ok) {
      const body = await msg91Res.text().catch(() => "");
      console.error("MSG91 send failed:", msg91Res.status, body);
      return res.status(502).json({ error: "Could not send OTP. Please try again." });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV] OTP for ${phone}: ${otp}`);
    }
    return res.json({ ok: true, phone });
  } catch (e: any) {
    console.error("send-otp error:", e);
    return res.status(500).json({ error: e.message || "Failed to send OTP" });
  }
});

// ── POST /auth/verify-otp ────────────────────────────────────────────
app.post("/auth/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || "").trim();
    if (!phone) return res.status(400).json({ error: "Invalid phone" });
    if (!/^\d{4,6}$/.test(otp)) return res.status(400).json({ error: "Invalid OTP format" });

    const attempts = Number((await redis.get(attemptsKey(phone))) || 0);
    if (attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many wrong attempts. Request a new OTP." });
    }

    const stored = await redis.get(otpKey(phone));
    if (!stored) {
      return res.status(410).json({ error: "OTP expired. Request a new one." });
    }
    if (stored !== otp) {
      await redis.incr(attemptsKey(phone));
      await redis.expire(attemptsKey(phone), OTP_TTL_SECONDS);
      return res.status(401).json({ error: "Wrong OTP. Try again." });
    }

    await redis.del(otpKey(phone), attemptsKey(phone), cooldownKey(phone));

    // Phone normalization variants — CLAUDE.md flags both "+91X" and "X" exist
    const phoneWithPlus = "+" + phone;
    const phoneNoCountry = phone.slice(2);
    let user = await prisma.user.findFirst({
      where: { OR: [{ phone: phoneWithPlus }, { phone: phoneNoCountry }] },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: phoneWithPlus,
          role: "customer",
        },
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, phone: user.phone },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e: any) {
    console.error("verify-otp error:", e);
    return res.status(500).json({ error: e.message || "Verification failed" });
  }
});
```

## Step 5 — Install dependencies in Railway repo

In your local `staybid-Live` repo:
```bash
cd apps/api
npm install ioredis jsonwebtoken
npm install -D @types/jsonwebtoken
git add package.json package-lock.json
git commit -m "feat(auth): add ioredis + jsonwebtoken for MSG91 OTP"
git push origin main
```

Railway auto-deploys.

## Step 6 — Test (after Railway redeploys, ~2 min)

```bash
# Send
curl -X POST https://staybid-live-production.up.railway.app/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+918881555188"}'

# Expected: {"ok":true,"phone":"918881555188"}
# Check your phone — SMS should arrive in 5-30 seconds

# Verify (with the OTP from SMS)
curl -X POST https://staybid-live-production.up.railway.app/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+918881555188","otp":"123456"}'

# Expected: {"token":"eyJ...","user":{...}}
```

## Frontend — kuch nahi badalna

Frontend already calls these endpoints via `lib/api.ts` (`api.sendOtp()` + `api.verifyOtp()`). When MSG91 backend is live, all 4 login flows automatically start using it:
- Customer auth page (`/auth`)
- Partner login (`/partner`)
- Admin login (`/admin/login`)
- Inline phone-verify modal on hotel page (for Firebase users)

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Could not send OTP` (502) | Wrong authkey | Re-copy from MSG91 dashboard, update Railway env |
| `Could not send OTP` (502) | Template not approved yet | Wait for DLT approval; check MSG91 Templates page |
| `Could not send OTP` (502) | Template ID mismatch | Make sure you used the **approved** template's ID, not a draft |
| No SMS arrives but API returns ok | Sender ID not registered | Use a DLT-registered 6-char header in MSG91_SENDER_ID |
| `Wrong OTP` even with correct code | Phone normalization mismatch | Frontend must send phone with `+91` prefix |

## Cost reality check

- MSG91 charges ~₹0.15-0.25 per SMS in India
- 1000 OTPs/month ≈ ₹150-250
- Add ₹1000 wallet → covers ~5000 OTPs

Add via MSG91 dashboard → **Wallet → Add Funds**.

---

**TL;DR:** When the 3 manual steps are done (Authkey + Template + Env vars), Step 4's code is paste-and-go. Frontend already supports it.
