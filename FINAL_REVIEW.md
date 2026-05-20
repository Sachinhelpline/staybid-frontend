# StayBid — Final Review / Audit Notes

> Living checklist of code-review findings to revisit before any final
> review, release, or audit. Update the **Status** column as items get
> fixed. Covers BOTH repos: `staybid-frontend` and `staybid-live`.
>
> Last reviewed: 2026-05-20

---

## 0. Repo / panel map (read this first)

There are **two different "agent" panels** — do not confuse them:

| Panel | URL | Frontend | Backend |
|---|---|---|---|
| **Support agent inbox** | `staybids.in/agent` | `staybid-frontend/app/agent/` (`SupportInbox`) | Next.js routes `app/api/admin/support/*`, `app/api/agent/check-role` → Supabase REST |
| **Hotel-onboarding field agent** | (separate / legacy) | NOT in `staybid-frontend` — separate/old repo | `staybid-live` Express API `/api/agent/*` in `apps/api/src/index.ts` |

The latest active work is the **support agent inbox**. The hotel-onboarding
agent code in `staybid-live` may be an old dump — confirm before touching it.

---

## 1. CRITICAL

### 1.1 Support API auth is fully bypassable — `staybid-frontend`
- **File:** `lib/support/agent-auth.ts` (`agentFromReq`), `lib/sb-server.ts` (`decodeJwt`)
- **Status:** OPEN
- `decodeJwt()` only base64-decodes the JWT payload — **no signature verification**.
- `agentFromReq()` guards every `/api/admin/support/*` route. Three bypasses:
  1. **Forged JWT** — send `Authorization: Bearer xxx.<base64 {"id":"x","role":"admin"}>.xxx`. Privileged role claim is trusted directly; DB check is skipped.
  2. **`x-admin-id` header alone** — no token needed; server does `fetchUserRole(headerId)` and trusts it. Set it to any admin's user id → access.
  3. **`adm_` opaque token** — `Authorization: Bearer adm_aaaaaaaa` + any `x-admin-id` → returns `role: "admin"` with zero verification.
- **Impact:** Anyone on the internet can read/write all support conversations and customer PII (phone, email, bookings, bids, wallet). `sb-server.ts` uses the service-role key (RLS bypassed), so RLS will not save us.
- **Fix direction:** verify the OTP-issued JWT signature server-side (shared secret with the Railway/`staybid-live` issuer), OR re-fetch role from DB on every request and drop the `role` claim entirely; remove the blind-trust `x-admin-id` and `adm_` paths (or gate them behind a real verification).

### 1.2 `/api/agent/hotels` route does not compile — `staybid-live`
- **File:** `staybid-live/apps/api/src/index.ts` (Agent Hotels List route)
- **Status:** OPEN (only relevant if the onboarding-agent panel is still used)
- Duplicate `const agentId` declaration ("Cannot redeclare block-scoped variable").
- Route handler is never closed (no `res.json`, no `catch`, no closing braces) — the next `app.post(...)` is swallowed. `tsc` build fails; the file cannot parse.
- Implies the deployed app is running a different/older version than `master`.

---

## 2. HIGH

### 2.1 Schema vs code mismatch — `staybid-live`
- **Files:** `staybid-live/apps/api/src/index.ts` vs `packages/db/prisma/schema.prisma`
- **Status:** OPEN
- Code references fields/relations that do not exist in `schema.prisma` — every agent route throws at runtime:
  - `User.password` (create-agent, agent/login)
  - `Hotel.agentId` (all agent routes)
  - `Hotel.address`, `Hotel.phone`, `Hotel.email` (onboard)
  - `Room.description` (agent room create)
  - `Hotel.reviews` relation (`routes/hotels.ts`)
- **Fix direction:** add the missing fields + migration, or remove the dead code.

### 2.2 `check-role` leaks data without auth — `staybid-frontend`
- **File:** `app/api/agent/check-role/route.ts` (MODE 2, phone-only)
- **Status:** OPEN
- Unauthenticated POST `{ phone }` reveals whether an account exists, its `role`, and prints the user's `id` in the error string. Enables phone enumeration → harvest admin/agent user ids → chain into 1.1 bypass #2. No rate limiting.

### 2.3 Leaked secrets committed to git
- **Files:** `staybid-live/apps/api/.env`, `staybid-live/packages/db/.env`; hardcoded anon key in `staybid-frontend/lib/sb-server.ts`
- **Status:** OPEN — **rotate later (user asked to defer; do not forget)**
- Committed: real DB password, Supabase service key, JWT secrets, Redis password.
- **Action:** rotate DB password, Supabase keys, JWT secrets, Redis password; add `.env` to `.gitignore`; scrub from git history.

### 2.4 JWT fallback secret — `staybid-live`
- **File:** `apps/api/src/index.ts` — `JWT_ACCESS = process.env.JWT_ACCESS_SECRET || "staybid-access-fallback"`
- **Status:** OPEN
- If the env var is missing in prod, the app silently uses a public weak secret → token forgery. Fail-fast instead of falling back.

---

## 3. MEDIUM

### 3.1 Error messages too leaky — `staybid-frontend`
- `app/api/agent/check-role/route.ts` returns SQL (`UPDATE users SET role=...`), table and column names to the client. Use generic messages.

### 3.2 Counter race condition — `staybid-frontend`
- `app/api/admin/support/conversations/[id]/messages/route.ts` — `agent_message_count: conv.agent_message_count + 1` is a read-modify-write. Two concurrent agent replies corrupt the count. Low traffic, so minor — prefer an atomic DB increment.

### 3.3 Wallet balance computed two different ways — `staybid-frontend`
- `app/api/admin/support/conversations/[id]/route.ts` uses `wallet_credits` (DEBIT/CREDIT) sum; `lib/support/repo.ts` `fetchUserContextForAI` does not fetch wallet at all. Confirm the canonical source.

### 3.4 Long-lived access tokens — `staybid-live`
- `index.ts` issues 7-day access tokens; `social-login` issues 30-day. `Lib/jwt.ts` says 15m. Access tokens should be short; use refresh tokens for longevity.

### 3.5 `bcryptjs` vs `bcrypt` mismatch — `staybid-live`
- `index.ts` imports `bcryptjs`; `package.json` lists `bcrypt` (native). Possible module-not-found at runtime.

### 3.6 No rate limiting — `staybid-live`
- `express-rate-limit` is a dependency but never used. OTP throttle is Redis-only — if Redis is down, throttle is fully bypassed.

### 3.7 Socket.io CORS — `staybid-live`
- `origin: "*"` with `credentials: true` is an invalid combination and wide open.

---

## 4. LOW / cleanup

- **`staybid-live`:** duplicate `/api/bids/my` route (second is dead); `routes/*`, `services/*`, `Lib/prisma.ts`, `Lib/redis.ts`, `socket.ts`, `broadcast.ts`, `cron.ts` are not imported by `index.ts` (dead code — monolith holds everything); `services/razotpay.ts` is misspelled and empty; `packages/db/packages.json` should be `package.json`; committed `.env` has `connection_limit=1` (serializes all queries); role casing inconsistent (`"CUSTOMER"` vs `"customer"`).
- **`staybid-live` original log error:** `prisma.bid.update()` "Record to update not found" — `/bids/:id/accept` etc. call `update` directly; bad/expired id throws P2025 (caught, but noisy). Prefer `updateMany` or a pre-check.

---

## 5. Known infra notes
- Postgres crash (around 2026-05-20) was traced to Railway-side server slowness — not a code bug. Connection-pool timeout (`connection limit: 33, pool timeout: 10`) recovered on its own. If the pool-timeout error recurs while Railway is healthy, revisit `connection_limit` + `pool_timeout` tuning for the Supabase pooler.

---

## 6. Verified OK
- Support inbox UI/UX, polling, scroll handling, role-rank logic for multi-row phone variants, AI suggest fallback, conversation state machine (take/release/resolve/ai_handoff).
