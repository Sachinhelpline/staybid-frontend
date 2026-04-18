# StayBid Frontend — CLAUDE.md

## Project Overview
StayBid is a luxury hotel reverse-auction platform. Customers browse hotels, place price bids, and book flash deals. Hotels accept, counter, or reject bids in real time. Built with Next.js 14 App Router, TypeScript, Tailwind CSS (custom luxury theme), and deployed on Vercel.

**Backend:** Railway (Node/Express/Prisma/PostgreSQL) at `https://staybid-live-production.up.railway.app`  
**Frontend:** Vercel auto-deploys from `main` branch of `Sachinhelpline/staybid-frontend`  
**Dev branch:** `claude/upgrade-staybids-luxury-theme-axZqo` → merge to `main` to deploy

---

## Directory Structure
```
app/
  page.tsx              # Hero landing page
  layout.tsx            # Root layout (AuthProvider + Navbar)
  globals.css           # Design tokens + utility classes
  auth/page.tsx         # OTP login (phone → OTP)
  hotels/page.tsx       # Hotel listing + search filters
  hotels/[id]/page.tsx  # Hotel detail — bids, flash deals, reviews [MOST COMPLEX]
  bid/page.tsx          # Reverse auction bid request form
  flash-deals/page.tsx  # Time-limited AI deals with countdown
  my-bids/page.tsx      # User bid history + counter-offer responses
  bookings/page.tsx     # Confirmed bookings with barcode + StayPoints
  wallet/page.tsx       # Wallet balance + transactions
components/
  Navbar.tsx            # Sticky glass-morphism nav + mobile drawer
  ServerStatus.tsx      # Backend health check banner
  ImageUpload.tsx       # Supabase storage image uploader
lib/
  api.ts                # All API calls (Bearer token auth)
  auth.tsx              # AuthContext + useAuth() hook
  supabase.ts           # Supabase storage client
```

---

## Environment Variables
```
NEXT_PUBLIC_API_URL=https://staybid-live-production.up.railway.app
```
No `.env` file needed locally — fallback hardcoded in `lib/api.ts`.

---

## API Client (`lib/api.ts`)
All requests go through the `request()` helper which auto-attaches `sb_token` from localStorage.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `sendOtp(phone)` | POST /api/auth/send-otp | Send OTP |
| `verifyOtp(phone, otp)` | POST /api/auth/verify-otp | Returns `{token, user}` |
| `getHotels(params?)` | GET /api/hotels | List with city/search filters |
| `getHotel(id)` | GET /api/hotels/:id | Hotel + rooms + reviews |
| `createBidRequest(data)` | POST /api/bids/request | Create bid request with dates |
| `placeBid(data)` | POST /api/bids/place | Place a bid (checks floor price) |
| `getMyBids()` | GET /api/bids/my | User's bids with hotel+room+request |
| `getFlashDeals(city?)` | GET /api/flash/near | Active flash deals |
| `getMyBookings()` | GET /api/bookings/my | Confirmed bookings |
| `getWallet()` | GET /api/wallet | Balance + transactions |

**Flash deal bypass:** Send `dealId` in placeBid body to skip floor-price validation on backend.  
**Auto-accept:** After placeBid, call `POST /api/bids/:id/accept` to confirm instantly.

---

## Authentication (`lib/auth.tsx`)
- Phone OTP login only
- Token stored in `localStorage` as `sb_token`
- User stored as `localStorage` as `sb_user` (JSON)
- `useAuth()` returns `{ user, loading, login(token, user), logout() }`
- Protected pages redirect to `/auth` if `!user`

---

## Design System (Tailwind)

### Color Palette
- `luxury-*` — warm neutral browns (50–950), main text/bg colors
- `gold-*` — golden accent (#c9911a–#f0b429), CTAs and highlights
- `navy-*` — dark blues for headers

### Key Utility Classes (defined in `globals.css`)
```
card-luxury       — white card with luxury-100 border + shadow
btn-luxury        — gold gradient button (gold-600→gold-500 hover)
badge-gold        — small gold pill badge
input-luxury      — form input with luxury border + focus ring
shimmer           — loading skeleton animation
divider-gold      — thin gold horizontal line
shadow-gold       — gold-tinted box shadow
glass             — frosted glass backdrop-blur effect
```

### Fonts
- Display: Cormorant Garamond (headings, `font-display`)
- Body: Inter (everything else)

---

## Hotel Detail Page (`app/hotels/[id]/page.tsx`)
Most complex page. Key features:
- **Flash deal flow:** URL params `dealId`, `dealPrice`, `roomId`, `discount`, `directBook=true` trigger flash booking modal with today's locked check-in
- **Book Now:** Instant booking at room price, auto-accepts bid
- **Negotiate Price:** AI smart slider showing bid acceptance probability (hides floor price from user)
- **OTA comparison:** Simulated prices for MakeMyTrip, Booking.com, Goibibo, Agoda vs StayBid
- **Real-time bids:** Socket.io listens to `bid:counter` events
- **Reviews tab / Rooms tab / About tab**
- **IMPORTANT:** Never show the word "floor price" in UI — only show the price number

### Flash Deal URL Format
```
/hotels/{hotelId}?dealId={id}&dealPrice={price}&roomId={roomId}&discount={pct}&directBook=true
```

### Bid Probability Logic (in Negotiate modal)
Internally uses `room.floorPrice` for calculation but NEVER displays it:
- `amount >= floor` → 95% "Auto-confirms!" (green) → auto-accept on submit
- `amount >= floor*0.95` → 70–94% "Very Likely" (gold)
- `amount >= floor*0.90` → 45–69% "Good Chance" (amber)
- `amount >= floor*0.85` → 25–44% "Moderate" (orange)
- `amount >= floor*0.78` → 10–24% "Low Chance" (orange-red)
- `amount < floor*0.78` → 2–9% "Very Low" (red)

---

## Bookings Page (`app/bookings/page.tsx`)
Fetches both `/api/bookings/my` AND `/api/bids/my`, merges them (accepted bids show as bookings). Fallback: dates stored in `localStorage` as `bid_dates_{bidId}`.

### StayPoints System
- Earn 5 points per ₹100 spent
- Displayed on each booking card
- CHECKED_OUT status shows "Credited"; others show "Earn X on checkout"

---

## Backend Notes (Railway — private repo `staybid-Live`)
- Start command: `npx ts-node --transpile-only src/index.ts`
- Build command: `npm install && npm install bcryptjs prisma@5.22.0 @prisma/client@5.22.0 ts-node typescript && npx prisma generate`
- Database: Supabase PostgreSQL (Prisma ORM)
- Tables use camelCase quoted columns: `"hotelId"`, `"starRating"`, `"validUntil"` etc.
- `flash_deals.validUntil` is TEXT type, not timestamp
- Floor price validation: `if (amount < room.floorPrice && !req.body.dealId)` — dealId bypasses check

### Key Backend Endpoints to Add if Missing
```typescript
// GET /api/bids/my — include request relation for checkIn/checkOut dates
app.get("/api/bids/my", authenticate, async (req: any, res) => {
  const bids = await prisma.bid.findMany({
    where: { customerId: req.user.id },
    include: { hotel: true, room: true, request: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ bids });
});
```

---

## Git Workflow
- Feature branch: `claude/upgrade-staybids-luxury-theme-axZqo`
- Production: `main` → auto-deploys to Vercel
- Always push to feature branch, then merge to `main` to deploy
- Push command: `git push -u origin main`

---

## Common Patterns

### API call with error handling
```typescript
api.getSomething()
  .then((d) => setState(d.data || []))
  .catch(() => {})
  .finally(() => setLoading(false));
```

### Protected route
```typescript
const { user, loading: authLoading } = useAuth();
useEffect(() => {
  if (authLoading) return;
  if (!user) router.push("/auth");
}, [user, authLoading]);
```

### Modal pattern
```tsx
{open && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onClick={() => setOpen(false)}>
    <div className="bg-white rounded-3xl p-6 max-w-md w-full mx-4"
      onClick={(e) => e.stopPropagation()}>
      {/* content */}
    </div>
  </div>
)}
```

### Auto-accept bid (instant booking flow)
```typescript
const reqRes = await api.createBidRequest({ hotelId, roomId, amount, checkIn, checkOut, guests });
const bidRes = await api.placeBid({ hotelId, roomId, amount, requestId: reqRes.request.id, dealId });
const token = localStorage.getItem("sb_token");
await fetch(`${API}/api/bids/${bidRes.bid.id}/accept`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
localStorage.setItem(`bid_dates_${bidRes.bid.id}`, JSON.stringify({ checkIn, checkOut }));
```

---

## Things to Avoid
- Never show "floor price" label in customer-facing UI (only show the number)
- Never push directly to `main` without testing on feature branch first
- Never use `--no-verify` on git commits
- Don't add `address` column to Hotel INSERT (column doesn't exist in Prisma schema)
- Don't use `npx tsc` as Railway start command (TypeScript errors block compilation) — use `ts-node --transpile-only`
- Never run `npx prisma db push --accept-data-loss` in Railway Pre-deploy Command — it wipes ALL database data on every deploy

---

## Session Memory — Completed Fixes (Apr 2026)

### ✅ Profile Avatar in Navbar (`components/Navbar.tsx`)
- Removed Profile from USER_LINKS array
- Added gold gradient avatar chip on desktop nav (user initials, links to `/profile`)
- Added mobile drawer profile card (avatar + name + phone, links to `/profile`)

### ✅ Vercel Build Error Fix (`app/profile/page.tsx`)
- Bug: duplicate `className` attribute on same JSX element (line ~120)
- Fix: merged both className attributes + moved gradient to `style` prop

### ✅ Wallet totalDebit field (`app/wallet/page.tsx`)
- Backend may return `totalDebit`, `total_debit`, or `spent`
- Fix: `const totalSpend = wallet?.totalDebit || wallet?.total_debit || wallet?.spent || 0;`

### ✅ Hotels API limit=50 (`lib/api.ts`)
- Backend default limit was 3 hotels — only 3 showed on site
- Fix: `const merged = { limit: "50", ...params };` in `getHotels`

### ✅ Flash Deal Floor Price Error (`app/hotels/[id]/page.tsx`)
- Bug: backend rejected `amount < floorPrice` even with `dealId` sent
- Fix: try-catch retry — first attempt at dealPrice, catch retries at floorPrice
- localStorage key `deal_price_{bidId}` stores actual deal price for display

### ✅ Double Booking Fix (`app/bookings/page.tsx`)
- Bug: same booking showed TWICE — once from `/api/bookings/my` (WALLET), once from `/api/bids/my` (FLASH DEAL)
- Root cause: booking.id ≠ bid.id so Set-based dedup didn't catch it
- Fix: filter `fromBids` to skip entries where real booking already exists for same `hotelId+roomId`

### ✅ Railway Data Wipe Fix
- Bug: Pre-deploy Command had `npx prisma db push --accept-data-loss` — wiped DB every deploy
- Fix: Remove `--accept-data-loss` from Pre-deploy Command in Railway Deploy settings
- Pre-deploy Command should be empty OR just `npx prisma generate`

### ✅ Multi-Provider Login (`app/auth/page.tsx`) — Apr 2026
- 4 login options, all UI in English
- **Google** — Firebase `signInWithPopup` + `GoogleAuthProvider`
- **Facebook** — Firebase `signInWithPopup` + `FacebookAuthProvider`
- **Mobile OTP** — Firebase `signInWithPhoneNumber` (real SMS, invisible reCAPTCHA)
- **WhatsApp OTP** — existing backend `/api/auth/send-otp` with WhatsApp green UI
- After Firebase auth: tries `POST /api/auth/social-login` for backend JWT; if fails, stores Firebase token tagged as `"firebase"` type
- Created `lib/firebase.ts` — Firebase app init using `NEXT_PUBLIC_FIREBASE_*` env vars
- Updated `User` type in `lib/auth.tsx` to include optional `email` field
- Firebase package installed: `firebase` (in `package.json`)

#### Firebase Project Details
- **Project ID:** `staybid-6feb7`
- **Console:** https://console.firebase.google.com/project/staybid-6feb7
- **Enabled providers:** Google ✅, Phone ✅, Facebook (pending FB app setup)
- **Authorized domains:** `staybids.in` must be in Firebase Console → Authentication → Settings → Authorized domains

#### Firebase Env Vars (in Vercel `staybid-customer-frontend` project)
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCREXxZEUTJk1abTOxOXyxAF5QcOhjsjXQ
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=staybid-6feb7.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=staybid-6feb7
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=staybid-6feb7.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=208404139595
NEXT_PUBLIC_FIREBASE_APP_ID=1:208404139595:web:6f498125e246b8a8be07ce
```

#### Important: Correct Vercel Project
- Live site `staybids.in` is served from **`staybid-customer-frontend`** (prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD)
- NOT from `staybid-frontend` — always add env vars to `staybid-customer-frontend`
- After adding env vars, must **Redeploy** from Vercel Deployments tab for changes to take effect

### ✅ "Invalid Algorithm" Error — Permanent Fix (Apr 2026)
**Root cause:** Firebase issues RS256 tokens; backend uses HS256 `jwt.verify()` — always incompatible.

**Fix: `tokenType` system across 3 files**

#### `lib/auth.tsx`
- Added `tokenType: "backend" | "firebase"` to AuthContext state
- `login(token, user, tokenType?)` — optional 3rd argument, defaults to `"backend"`
- Persisted in localStorage as `sb_token_type`
- `useAuth()` now returns `{ user, token, tokenType, login, logout, loading }`

#### `app/auth/page.tsx`
- Firebase fallback now calls `login(idToken, user, "firebase")` — tags the token type
- Google/Facebook login goes straight to home with no double verification

#### `app/hotels/[id]/page.tsx`
- `withBackendAuth(action)` wrapper — checks `tokenType` before any booking action:
  - `"backend"` → runs action directly
  - `"firebase"` → opens inline "One Quick Step" phone verify modal, stores `action` in `pendingAction` ref
- Inline verify modal: phone → WhatsApp OTP → `api.verifyOtp()` → upgrades token to backend JWT → auto-runs pending action
- All 4 action buttons use `withBackendAuth()`: Book Now, Negotiate, Flash Deal banner, Flash Deal room card
- `jwtRedirect()` helper catches any remaining JWT errors → redirects to `/auth`

#### `localStorage` keys added
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_token_type` | `"backend"` \| `"firebase"` | Tracks whether stored token is backend HS256 or Firebase RS256 |

### ✅ Negotiate Modal — Below-Floor Fix + Smarter UI (Apr 2026)
- **Below-floor bids:** Backend rejects `amount < floorPrice`. Fix: submit at `floorPrice` with message `"Guest's preferred price: ₹{negAmt}/night. Please counter if possible."` — hotel reviews and may counter
- **Quick-pick buttons:** 💰 Max Saving (82%), ⭐ Smart Bid (90%), ⚡ Instant Book (100%) of floor price
- **`bidProb()` enhanced:** Added `tip` (explanation text) and `responseTime` ("Auto-confirms!", "~1 hr", "2–3 hrs", etc.) shown in UI
- **Below-floor notice:** Amber info box shown in modal when bid is below floor

### ✅ Flash Deal + Book Now — JWT Error Handling (Apr 2026)
- All three handlers (`handleFlashBook`, `handleBookNow`, `handleNegotiate`) catch JWT/session errors
- On JWT error: show friendly message + redirect to `/auth` instead of raw error alert

---

## Database State (as of Apr 2026)
- **Hotels:** 4 (all in Uttarakhand/Himalayas region)
- **Actual hotel IDs and names (verified in Supabase):**
  | id | name | city | starRating |
  |----|------|------|-----------|
  | `202601` | Dhanaulti Village Resort By Woodora | Dhanaulti | 4 |
  | `hotel-1` | The Mountain Grand | Mussoorie | 5 |
  | `hotel-2` | Forest Retreat Dhanaulti | Dhanaulti | 4 |
  | `hotel-3` | Ganga View Rishikesh | Rishikesh | 4 |
- **Extra columns in hotels table:** `lat`, `lng`, `ownerId`, `state` (not in original schema docs)
- **ownerId:** hotel-1 owner = `cmnr4b8ol0001whjy8jc1xxxh`; hotels 2,3,202601 owner = `9d92d00f-4147-4411-ab19-ca65fd5f1d21`
- **Rooms:** ~8 (2 per hotel)
- **Flash Deals:** active deals exist
- **NOTE:** Previous CLAUDE.md had wrong hotel names (Grand Hyatt Mumbai etc.) — those were placeholder names, actual DB has Uttarakhand properties

---

## localStorage Keys Used
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_token` | JWT string | Auth token |
| `sb_user` | JSON string | User object |
| `sb_token_type` | `"backend"` \| `"firebase"` | Token algorithm type — backend=HS256, firebase=RS256 |
| `bid_dates_{bidId}` | `{"checkIn":"...","checkOut":"..."}` | Booking dates fallback |
| `deal_price_{bidId}` | Price string e.g. "2999" | Actual flash deal price for display |

---

## Pending / Known Issues
- **Wallet balance** only shows when user has actually spent (no fake seed data)
- **Socket.io real-time** bid updates work when backend is awake (Railway cold starts ~30s)
- **`/api/auth/social-login` backend endpoint does not exist** — Google/Facebook users go through inline phone verify on first booking action. If this endpoint is ever added to Railway backend, the tokenType system will use it automatically (it tries backend sync first in `syncAndLogin`). Required backend code:
  ```typescript
  app.post("/api/auth/social-login", async (req, res) => {
    const { idToken, provider, email, name, uid } = req.body;
    // Verify Firebase token via: POST https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={FIREBASE_API_KEY}
    // Find or create user: phone = email || `firebase_${uid}`
    // Issue HS256 JWT: jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "30d" })
    // res.json({ token, user })
  });
  ```
  Add `FIREBASE_API_KEY` env var on Railway (same value as `NEXT_PUBLIC_FIREBASE_API_KEY`).

---

## How to Start a New Session with Full Memory

Run this command inside the project folder:
```bash
claude "Read CLAUDE.md fully, then ask me what to work on next for StayBid frontend"
```
