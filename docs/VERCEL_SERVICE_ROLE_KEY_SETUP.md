# 🔑 Vercel par `SUPABASE_SERVICE_ROLE_KEY` set karna — beginner guide

Yeh ek-baar ka manual step hai. Iske baad **automatically** kaam karega:
- Saare 100+ API routes service-role pe switch ho jayenge
- `/admin/rls` page mein 🔒 Lock buttons enable ho jayenge
- Aap sensitive tables ko ek-ek karke lock down kar sakte ho

**Total time:** 3-4 minutes. Koi code change nahi.

---

## STEP 1 — Supabase se `service_role` key copy karo

1. Browser mein open karo: https://supabase.com/dashboard/project/uxxhbdqedazpmvbvaosh
2. **Login** karo (Sachinhelpline GitHub account se ya jo bhi linked hai)
3. Left sidebar mein **Settings** (gear icon, bottom-left) → **API** click karo
4. Page pe scroll karo niche tak — **Project API keys** section
5. Yahan 2 keys dikhengi:
   - `anon` `public` — **YEH NAHI** (yeh already use ho rahi hai)
   - `service_role` `secret` — **YEH chahiye**

   ```
   service_role  secret    [Show]    ← click "Show", phir copy karo
   ```

6. **Reveal** ya **Show** button click karo, phir copy-icon click karke key ko clipboard mein copy karo.

   ⚠ Yeh secret hai. Kahin email, slack, screenshot mein paste mat karna. Sirf Vercel pe paste karna hai.

---

## STEP 2 — Vercel pe env var add karo

1. Browser mein open karo: https://vercel.com/sachinhelpline-3778s-projects/staybid-customer-frontend/settings/environment-variables

2. Login karo (same GitHub account).

3. Page mein **"Add new"** button dikhega top-right pe — click karo.

4. Form bharo:
   - **Key**: `SUPABASE_SERVICE_ROLE_KEY`
     (exact spelling, ALL CAPS, underscores — copy-paste karo agar shak hai)
   - **Value**: jo Step 1 mein copy kiya tha, woh paste karo
   - **Environment**: sirf **Production** ✅ tick karo
     (Preview / Development mein nahi chahiye — un environments mein anon fallback automatic)

5. Bottom mein **Save** button click karo.

6. Page refresh karo — env var list mein `SUPABASE_SERVICE_ROLE_KEY` `••• Production` dikhna chahiye.

---

## STEP 3 — Redeploy taaki naya env var pick ho

Env var sirf naye deployments pe lagti hai. Existing deployment ko redeploy karna zaroori hai.

**Option A — UI se (recommended):**

1. Vercel project page pe jao: https://vercel.com/sachinhelpline-3778s-projects/staybid-customer-frontend
2. Top tab **Deployments** click karo
3. Sabse upar wala deployment (latest production, state = `Ready`, green dot) — uske right side mein **`⋯`** (3 dots) menu hai
4. Menu mein **Redeploy** click karo
5. Confirm dialog mein **"Use existing Build Cache"** UNCHECKED rakho (taaki fresh build aaye env ke saath)
6. **Redeploy** button click karo
7. Build 60-120 second mein complete ho jayega.

**Option B — git push (alternative):**

Koi bhi small commit (e.g. README space change) main pe push karo. Vercel auto-deploy karega.

---

## STEP 4 — Verify karo ki env var actually live hai

1. https://staybids.in/admin pe jao
2. Apne admin OTP se login karo
3. Left sidebar mein **🛡️ RLS / Security** click karo
4. Top-right mein chip dekho:
   - **🟢 SERVICE-ROLE READY** = ✅ env var live hai, lockdown karne ke liye ready
   - **🟡 SERVICE-ROLE NOT SET** = ❌ env var abhi nahi pohncha — Step 3 redeploy fail hua, ya value paste karte time space/typo aaya tha

5. Kisi bhi sensitive table card pe scroll karo (16 tables 🔐 icon ke saath flag hain). Ab `🔒 Lock` button **clickable** hoga (pehle disabled tha).

---

## STEP 5 — Pehla table lock karo (otp_codes — safest)

1. `/admin/rls` page pe filter dropdown mein **"Sensitive"** select karo
2. List mein `otp_codes` find karo
3. Uska 🔒 **Lock** button click karo
4. Confirm prompt aayega — read karo carefully:
   ```
   🔒 LOCK DOWN "otp_codes"?
   This drops every permissive anon/authenticated policy.
   After this, ONLY service-role can read or write the table.
   ```
5. **OK** click karo
6. Bottom-right mein green toast aayega: `✓ otp_codes locked down — service-role only (0 policies remain)`

### Test login flow turant — 2 min

Naye browser tab mein:
1. https://staybids.in/auth open karo (Incognito best)
2. WhatsApp OTP login try karo — phone number daalo, OTP get karo, verify karo
3. Agar OTP send/verify dono kaam karte hain → ✅ otp_codes lockdown safe rahi

Agar OTP fail kare:
- `/admin/rls` jao
- `otp_codes` row pe **toggle** click karke RLS turant **OFF** karo (temporary fallback)
- Mujhe bolo — kaunsa route abhi tak anon-only path use kar raha hai woh debug karenge

---

## STEP 6 — Aage ki tables (ek-ek karke, har lock ke baad test)

| Order | Table | Test kya karo |
|---|---|---|
| 1 | otp_codes ✅ | OTP login |
| 2 | admin_action_logs | Admin login + koi 1 user ka tier change |
| 3 | complaints | /complaints page khol ke ek test complaint submit |
| 4 | vp_complaints | Verification page se "Report Issue" link |
| 5 | vp_videos | Hotel partner panel verification tab |
| 6 | bid_holds | Bookings page → Hold-pay flow |
| 7 | bid_paid_amounts | Booking pe paid amount dikhna |
| 8 | bid_acceptance_windows | Negotiate bid → 15-min countdown |
| 9 | booking_messages | /bookings card → "Message hotel" chat |
| — | **`users` table SKIP for now** | Sabse risky — separate hardening session mein |

Har lock ke baad 5 min wait karke matching flow exercise karo. Kuch break ho → toggle off temporarily, problem report karo.

---

## Troubleshooting

### "SERVICE-ROLE NOT SET" badge after redeploy

- Env var name mein typo? Check karo — exact `SUPABASE_SERVICE_ROLE_KEY` (case-sensitive)
- Value mein extra space? Re-copy from Supabase, re-paste without trim issues
- Production environment select kiya tha? Preview/Dev wala nahi chalega
- Deployment Ready hua hai? `Deployments` tab mein latest dpl green dot hona chahiye

### Lockdown ke baad route 401/empty return karta hai

- Matlab usi table ka koi route abhi bhi anon header use kar raha hai
- Toggle se RLS turant OFF karo (drawer mein per-table toggle)
- Mujhe specific route + error bolo — fix karke patch ship karunga

### Accidentally lock pressed on `users` table

- TURANT toggle se RLS off karo (drawer mein right side toggle)
- `users` table app ka core hai — banned/active status checks sab waha se aate hain
- Lock karne se pehle full session dedicated hai usko

---

## Important — yeh kabhi mat karna

- ❌ Service-role key kisi public file/repo/screenshot mein NEVER paste karna. Sirf Vercel env var.
- ❌ `NEXT_PUBLIC_*` prefix ke saath kabhi mat banana. Woh client bundle mein leak ho jayega.
- ❌ "Use existing Build Cache" checkmark **chhod ke** redeploy mat karna — fresh build chahiye taaki naya env var pick ho.
- ❌ Sabhi 16 tables ek saath lock mat karna. Ek-ek karke, har ek ke baad test.

---

## Summary table — exactly kya hua

| Layer | Status today |
|---|---|
| **Supabase migrations** (v98 + v99 ×2 + v100 + v103) | ✅ Live (`list_migrations` confirms) |
| **Frontend code** (v98 → v103.1) | ✅ Pushed `31e1958` to main |
| **Vercel deployment** | ⏳ Building right now (was failing before v103.1 fix) |
| **Vercel env var** | ❌ NOT set — yeh aapka manual step |
| **Lockdown buttons enabled** | ❌ Until env var lands |
| **Railway backend** | ✅ Untouched (no changes needed this session) |
| **Sensitive tables locked** | ❌ Until you follow Steps 5 + 6 |

Sirf manual step yeh hai: **env var set → redeploy → ek-ek table lock kar ke test**. Time ~30 minutes total agar slow chalein.

Koi step pe stuck ho → mujhe bata dena (error screenshot + step number).
