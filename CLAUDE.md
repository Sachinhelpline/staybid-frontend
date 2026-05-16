# StayBid Frontend — CLAUDE.md

## Project Overview
StayBid is a luxury hotel reverse-auction platform. Customers browse hotels, place price bids, and book flash deals. Hotels accept, counter, or reject bids in real time. Built with Next.js 14 App Router, TypeScript, Tailwind CSS (custom luxury theme), and deployed on Vercel.

**Backend:** Railway (Node/Express/Prisma/PostgreSQL) at `https://staybid-live-production.up.railway.app`  
**Frontend:** Vercel auto-deploys from `main` branch of `Sachinhelpline/staybid-frontend`  
**Dev branch:** work directly on `main` — each commit auto-deploys to Vercel

---

## Directory Structure
```
app/
  page.tsx              # Hero landing page
  layout.tsx            # Root layout (AuthProvider + Navbar)
  globals.css           # Design tokens + utility classes
  auth/page.tsx         # Multi-provider login (Google/Facebook/Mobile OTP/WhatsApp OTP)
  hotels/page.tsx       # Hotel listing + search filters
  hotels/[id]/page.tsx  # Hotel detail — gallery, availability picker, bids, flash deals [MOST COMPLEX]
  bid/page.tsx          # Reverse auction bid request form
  flash-deals/page.tsx  # Time-limited AI deals with countdown
  my-bids/page.tsx      # User bid history + counter-offer responses
  bookings/page.tsx     # Confirmed bookings with barcode + StayPoints + payment info
  wallet/page.tsx       # Wallet balance + transactions
  partner/page.tsx      # Partner login (phone OTP + hotel ownership check)
  partner/dashboard/page.tsx  # Full partner dashboard (6 tabs — see below)
  api/razorpay/order/route.ts   # Create Razorpay order (live keys)
  api/razorpay/verify/route.ts  # Verify Razorpay HMAC signature (new)
  api/partner/hotel/route.ts    # GET hotel+rooms+bookings / PATCH hotel profile
  api/partner/bids/route.ts     # GET bids for hotel (Railway → Supabase fallback)
  api/partner/bids/[id]/route.ts # POST accept/counter/reject bid
  api/partner/flash-deals/route.ts # GET/POST/DELETE flash deals
components/
  Navbar.tsx            # Sticky glass-morphism nav — hidden on /partner/** routes
  ServerStatus.tsx      # Backend health check banner
  ImageUpload.tsx       # Supabase storage image uploader
lib/
  api.ts                # All API calls (Bearer token auth)
  auth.tsx              # AuthContext + useAuth() — tokenType system
  supabase.ts           # Supabase storage client
  razorpay.ts           # openRazorpayCheckout() — loads script, creates order, verifies
  firebase.ts           # Firebase app init (Google/Phone auth)
  ai-pricing.ts         # calculateDynamicPrice(), getRoomImage(), DEMAND_STYLE
```

---

## Environment Variables
```
NEXT_PUBLIC_API_URL=https://staybid-live-production.up.railway.app
RAZORPAY_KEY_ID=rzp_live_SfFAsbYjbHfztd
RAZORPAY_KEY_SECRET=dv3xFGG44R2FSqlshkDVY2Gn
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_SfFAsbYjbHfztd
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCREXxZEUTJk1abTOxOXyxAF5QcOhjsjXQ
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=staybid-6feb7.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=staybid-6feb7
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=staybid-6feb7.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=208404139595
NEXT_PUBLIC_FIREBASE_APP_ID=1:208404139595:web:6f498125e246b8a8be07ce
```
- `.env.local` exists locally (gitignored) with all above keys
- Razorpay keys also hardcoded as fallbacks in API routes (so payment works even without Vercel env vars)
- To add to Vercel: run `node setup-razorpay-vercel.js YOUR_VERCEL_TOKEN` (token from https://vercel.com/account/tokens)

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
Most complex page (~900+ lines). Key features:
- **Photo gallery:** Full-screen lightbox with prev/next, thumbnail strip, Unsplash placeholders pad to 5+ images
- **"Starting from ₹X/night"** badge using `Math.min(...rooms.map(r => r.floorPrice))`
- **Global availability picker** (`id="availability-picker"`): single section for check-in/out + Adults/Children/Kids
  - `globalAdults`, `globalChildren` (₹200/night), `globalKids` (<5 FREE)
  - Book Now / Negotiate scroll here first if dates not selected
- **Flash deal flow:** URL params `dealId`, `dealPrice`, `roomId`, `discount`, `directBook=true` → flash booking modal (unchanged)
- **Book Now:** Razorpay payment → bid request → auto-accept
- **Negotiate Price:** Razorpay payment (only for above-floor bids) → bid with message
- **OTA comparison:** `otaBase = livePrice * 1.22`, each OTA × multiplier — StayBid always 15–28% cheaper
- **Room amenity badges** with emoji icons (`AMENITY_ICON` map)
- **Real-time bids:** Socket.io listens to `bid:counter` events
- **Reviews tab / Rooms tab / About tab**
- **IMPORTANT:** Never show the word "floor price" in UI — only show the price number

### Razorpay Payment Flow (all booking types)
```typescript
// 1. Create order server-side
POST /api/razorpay/order → { id, amount, currency }
// 2. Open Razorpay checkout (client)
openRazorpayCheckout({ amount, hotelName, ... }) → razorpay_payment_id
// 3. Verify signature server-side
POST /api/razorpay/verify → { verified: true }
// 4. Confirm booking in Railway backend
POST /api/bids/:id/accept
```

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
- Work directly on `main` — every push auto-deploys to Vercel (`staybid-customer-frontend`)
- Push command: `git push origin main`
- Vercel project: `staybid-customer-frontend` (prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD), team: `team_ulUk1IYy4DFl2C1rJ5WU3kUm`

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

## Partner Panel (`/partner` and `/partner/dashboard`)

### Login (`app/partner/page.tsx`)
- Separate from customer login — uses Railway WhatsApp OTP (`/api/proxy/api/auth/send-otp`)
- After OTP verify: calls `/api/partner/hotel` to confirm hotel ownership
- Stores session as `sb_partner_token` + `sb_partner_user` (separate from `sb_token`)
- Customer Navbar hidden on all `/partner/**` routes (early return in `components/Navbar.tsx`)

### Dashboard (`app/partner/dashboard/page.tsx`)
6 tabs: **Overview | Bid Inbox | Rooms & Pricing | Flash Deals | Bookings | Profile**
- Data fetched from `/api/partner/hotel`, `/api/partner/bids`, `/api/partner/flash-deals`
- AI prices recalculate every 60s using `calculateDynamicPrice()` from `lib/ai-pricing.ts`
- Bid actions (accept/counter/reject) via modal → `POST /api/partner/bids/:id`
- Flash deal create/deactivate via `/api/partner/flash-deals`
- Hotel profile edit via `PATCH /api/partner/hotel`

### Partner API Routes (all in `app/api/partner/`)
| Route | Method | Description |
|-------|--------|-------------|
| `hotel/route.ts` | GET | hotel + rooms + accepted bids (bookings) |
| `hotel/route.ts` | PATCH | update hotel fields (name, city, state, starRating, etc.) |
| `bids/route.ts` | GET | all bids for hotel (Railway → Supabase fallback) |
| `bids/[id]/route.ts` | POST | accept / counter / reject bid |
| `flash-deals/route.ts` | GET/POST/DELETE | manage flash deals |

### Partner Auth — Dual User ID Fix
- **Problem:** Railway may store phone as `8881555188` OR `+918881555188` → creates 2 user records, only one owns hotels
- **Fix:** `resolveOwnerIds()` in `hotel/route.ts` looks up all user IDs with same phone (with/without +91), queries hotels with `ownerId=in.(id1,id2)`
- Supabase anon JWT key used: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60`

### Partner localStorage Keys
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_partner_token` | JWT string | Partner auth token (separate from customer) |
| `sb_partner_user` | JSON string | Partner user object + hotel info |

---

## Razorpay Integration

### Files
- `lib/razorpay.ts` — `openRazorpayCheckout()`: loads script, creates order, opens modal, verifies
- `app/api/razorpay/order/route.ts` — server-side order creation (live keys hardcoded as fallback)
- `app/api/razorpay/verify/route.ts` — HMAC-SHA256 signature verification
- `setup-razorpay-vercel.js` — one-time script to add env vars to Vercel (run with Vercel token)

### Live Keys
- Key ID: `rzp_live_SfFAsbYjbHfztd` (public — safe in client code)
- Key Secret: `dv3xFGG44R2FSqlshkDVY2Gn` (server-side only in API routes)

### How Payment Works
1. `openRazorpayCheckout({ amount, hotelName, userName, userPhone, userEmail })` called from hotel page
2. Calls `POST /api/razorpay/order` → Razorpay order created
3. Razorpay checkout modal opens (gold theme, pre-filled user details)
4. On success: `POST /api/razorpay/verify` → HMAC check → `{ verified: true }`
5. Booking confirmed in Railway backend, `razorpay_payment_id` stored in bid message

### Booking Handlers That Use Razorpay
- `handleBookNow` — always charges before confirming
- `handleFlashBook` — always charges (flash deal total)
- `handleNegotiate` — charges only for above-floor (instant-confirm) bids; below-floor bids sent to hotel without payment

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
- **Supabase project:** `uxxhbdqedazpmvbvaosh` (URL: `https://uxxhbdqedazpmvbvaosh.supabase.co`)
- **Hotels:** 4 (all in Uttarakhand/Himalayas region)
  | id | name | city | starRating | ownerId |
  |----|------|------|-----------|---------|
  | `202601` | Dhanaulti Village Resort By Woodora | Dhanaulti | 4 | `cmnr4b8ol0001whjy8jc1xxxh` |
  | `hotel-1` | The Mountain Grand | Mussoorie | 5 | `cmnr4b8ol0001whjy8jc1xxxh` |
  | `hotel-2` | Forest Retreat Dhanaulti | Dhanaulti | 4 | `cmnr4b8ol0001whjy8jc1xxxh` |
  | `hotel-3` | Ganga View Rishikesh | Rishikesh | 4 | `cmnr4b8ol0001whjy8jc1xxxh` |
- **All 4 hotels owned by Sachin Tomer** (`+918881555188` → id `cmnr4b8ol0001whjy8jc1xxxh`)
- **Duplicate user record:** `cmnuolhpx0000u6ov2o2s8hxy` (phone `8881555188` without +91) — owns no hotels, handled by `resolveOwnerIds()`
- **Extra columns in hotels table:** `lat`, `lng`, `ownerId`, `state`
- **Rooms:** ~8 (2 per hotel), RLS disabled on hotels/rooms/bids
- **Flash Deals:** active deals exist in `flash_deals` table
- **users table:** RLS enabled on one variant — use JWT anon key (not publishable key) for queries

---

## localStorage Keys Used
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_token` | JWT string | Customer auth token |
| `sb_user` | JSON string | Customer user object |
| `sb_token_type` | `"backend"` \| `"firebase"` | Token algorithm — backend=HS256, firebase=RS256 |
| `sb_partner_token` | JWT string | Partner auth token (separate from customer) |
| `sb_partner_user` | JSON string | Partner user + hotel object |
| `bid_dates_{bidId}` | `{"checkIn":"...","checkOut":"..."}` | Booking dates fallback |
| `deal_price_{bidId}` | Price string e.g. "2999" | Actual flash deal price for display |

---

## Pending / Known Issues
- **Wallet balance** only shows when user has actually spent (no fake seed data)
- **Socket.io real-time** bid updates work when backend is awake (Railway cold starts ~30s)
- **Razorpay env vars** not yet added to Vercel dashboard (keys hardcoded as fallback in routes for now). To add properly: run `node setup-razorpay-vercel.js YOUR_TOKEN` or add manually in Vercel → staybid-customer-frontend → Settings → Environment Variables
- **`/api/auth/social-login` backend endpoint does not exist** — Google/Facebook users go through inline phone verify on first booking action. If this endpoint is ever added to Railway backend, the tokenType system will use it automatically. Required backend code:
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

### ✅ Hotel Page — Photo Gallery + Availability Picker + OTA Comparison (Apr 2026)
- **Photo gallery:** Lightbox with prev/next arrows, thumbnail strip, counter. Unsplash placeholders pad to min 5 images. Shown even when hotel has 0–1 images in DB.
- **Global availability picker** (`id="availability-picker"`): single source of truth for check-in/out + 3 separate guest counters (Adults / Children 5-12 / Kids <5). Book Now and Negotiate buttons scroll here if dates not set.
- **Book Now modal:** Read-only summary tiles from global picker + rate breakdown (no duplicate date inputs)
- **Negotiate modal:** Read-only summary tiles from global picker + bid slider (no duplicate date inputs)
- **Flash Deal modal:** Unchanged — has its own date picker as before
- **Room cards:** Price shown only when dates selected. Extra guest charges: Adults beyond capacity ₹500/night, Children ₹200/night, Kids free.
- **OTA comparison:** `otaBase = livePrice × 1.22`; MakeMyTrip ×1.07, Booking.com ×1.10, Goibibo ×1.03, Agoda ×1.06 — StayBid always cheapest
- **Room amenity badges:** `AMENITY_ICON` map with emoji + name, defaults by room type

### ✅ Partner Panel — Full Hotel Partner Portal (Apr 2026)
- Completely separate from customer panel
- Login: `/partner` — phone OTP via Railway backend + hotel ownership check
- Dashboard: `/partner/dashboard` — 6 tabs (Overview, Bid Inbox, Rooms & Pricing, Flash Deals, Bookings, Profile)
- Partner-specific API routes under `app/api/partner/`
- Customer Navbar hidden on `/partner/**` via `pathname?.startsWith("/partner")` early return
- Bid actions (accept/counter/reject) → try Railway first, Supabase direct fallback
- AI pricing recalculates every 60s on Rooms tab

### ✅ Razorpay Live Payment Gateway (Apr 2026)
- `lib/razorpay.ts` — `openRazorpayCheckout()` complete with script loading + order creation + HMAC verify
- `app/api/razorpay/order/route.ts` — live keys hardcoded as fallback (env vars preferred)
- `app/api/razorpay/verify/route.ts` — new route, HMAC-SHA256 signature verification
- Payment required for: Book Now (always), Flash Deal (always), Negotiate (above-floor only)
- Payment ID stored in bid message field: `Razorpay: pay_XXXXX`

### ✅ TypeScript Build Fixes (Apr 2026)
- `DEMAND_STYLE[ai.demandLevel as DemandLevel]` — cast needed for Record index
- `Set<string>` spread → replaced with plain `string[]` array + manual dedup to avoid `--downlevelIteration` error
- Razorpay top-level import → dynamic `(await import("razorpay")).default` inside handler

### ✅ Partner Login "Not a Partner" Fix (Apr 2026)
- **Root cause:** Railway returns JWT for duplicate user record `cmnuolhpx...` (phone without +91) which owns no hotels; actual hotels owned by `cmnr4b8...` (phone with +91)
- **Fix:** `resolveOwnerIds()` in `app/api/partner/hotel/route.ts` — fetches all user IDs sharing the same phone number (both `8881555188` and `+918881555188`), queries hotels with `ownerId=in.(id1,id2)`
- **Supabase key:** Must use JWT anon key (not publishable key) to query `users` table which has RLS enabled

---

---

## Admin Panel — Session 1 Build (May 2026)

Full admin panel scaffold built at `/admin/**` in the same `staybid-frontend` repo. Separate auth, separate design system (dark luxury), no overlap with customer/partner panels.

### Routes (12 nav items, all live)
| Route | Status | Description |
|-------|--------|-------------|
| `/admin/login` | ✅ Built | Phone OTP login, role gating (admin/super_admin only) |
| `/admin` | ✅ Built | Dashboard — 6 KPI cards, 3 recharts, live ticker, queues |
| `/admin/users` | ✅ Built | Users table + tier/status override modal |
| `/admin/hotels` | ✅ Built | Hotels table + status/commission override modal |
| `/admin/bookings` | ✅ Built | Bids table + 6-step workflow timeline modal |
| `/admin/verification` | 🟡 Stub | Session 2 — video review + AI report + verdict |
| `/admin/complaints` | 🟡 Stub | Session 2 — list + resolution flow |
| `/admin/pricing` | 🟡 Stub | Session 2 — AI status + flash deals + overrides |
| `/admin/fraud` | 🟡 Stub | Session 2 — flags + risk matrix |
| `/admin/finance` | 🟡 Stub | Session 2 — commission ledger + payouts |
| `/admin/feedback` | 🟡 Stub | Session 2 — feedback list + ratings |
| `/admin/settings` | 🟡 Stub | Session 2 — config + team + logs |

### Files Created

```
app/admin/
├── layout.tsx                  # Auth-protected shell (sidebar + topbar + Syne/DM Sans fonts)
├── login/page.tsx              # Admin OTP login (separate from customer/partner)
├── page.tsx                    # Dashboard (KPIs + 3 charts + 3 panel queues)
├── users/page.tsx              # Users management
├── hotels/page.tsx             # Hotels management
├── bookings/page.tsx           # Bookings & bids w/ timeline
├── verification/page.tsx       # Stub
├── complaints/page.tsx         # Stub
├── pricing/page.tsx            # Stub
├── fraud/page.tsx              # Stub
├── finance/page.tsx            # Stub
├── feedback/page.tsx           # Stub
└── settings/page.tsx           # Stub

components/admin/
├── sidebar.tsx                 # Collapsible 11-item nav, gold active accent
├── topbar.tsx                  # Search + notif badges + logout
├── kpi-card.tsx                # Reusable metric card
├── data-table.tsx              # Paginated table (sticky header, hover highlight)
├── stub-page.tsx               # Coming-in-Session-2 placeholder
└── charts/
    ├── line-chart.tsx          # Recharts wrapper (admin theme)
    ├── bar-chart.tsx
    └── pie-chart.tsx

app/api/admin/
├── dashboard/route.ts          # KPIs + 7-day trends + live ticker + queues + notif counts
├── users/route.ts              # GET (filter/search) + PATCH (tier/status override)
├── hotels/route.ts              # GET (with rooms/bookings/GMV) + PATCH (status/commission)
├── bookings/route.ts           # GET bids joined with hotels + paid amounts + dates
├── verification/pending/route.ts
├── verification/submitted/route.ts
├── complaints/route.ts
├── pricing/status/route.ts
├── fraud/flags/route.ts
├── finance/commissions/route.ts
├── feedback/route.ts
└── logs/route.ts
```

### Design System (Dark Luxury — separate from customer panel)
- **Colors:** `#07080C` bg, `#0F1117` surface, `#151820` cards, `rgba(255,255,255,0.07)` borders
- **Accents:** `#D4AF37` gold (primary), `#F0D060` gold2, `#2ECC71` green, `#FF4757` red, `#3D9CF5` blue, `#A855F7` purple
- **Text:** `#E8EAF0` primary, `#8A8FA8` secondary
- **Fonts:** Syne (display, headings) + DM Sans (body) — loaded via Google Fonts in `layout.tsx`
- **Radius:** 14px cards, 10px inputs, 8px pills
- **All inline styles** (no Tailwind classes for admin) — keeps dark theme isolated from customer's gold/cream palette

### Authentication
- Separate localStorage keys: `sb_admin_token` + `sb_admin_user` (no collision with `sb_token` or `sb_partner_token`)
- Login flow: phone OTP via Railway backend `/api/auth/send-otp` + `/api/auth/verify-otp`
- After verify: checks `user.role === "admin" || "super_admin"` — else "Access denied"
- Layout `useEffect` redirects to `/admin/login` if missing/invalid token
- Customer Navbar already hidden on `/admin/**` via existing pathname check pattern (Navbar.tsx)

### Supabase Direct Queries
All admin API routes hit Supabase REST directly using anon JWT key (same one used in partner panel):
```
SB_URL = "https://uxxhbdqedazpmvbvaosh.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." (anon JWT, in CLAUDE.md)
```
No Railway dependency for admin reads — works even when Railway is cold.

### Dependencies Added
- `recharts` — installed with `npm install recharts --legacy-peer-deps`
- Used for line/bar/pie charts in dashboard

### Real Data Wired
- Dashboard pulls from: `bookings`, `bids`, `users`, `vp_requests`, `complaints`, `vp_videos`
- Users from `users` table — tier/status filters work
- Hotels from `hotels` joined with `rooms` + `bookings` for GMV/MTD enrichment
- Bookings from `bids` joined with `hotels` + `bid_paid_amounts` + `bid_requests` (for check-in/out dates)

### Pending for Session 2
1. Video verification 3-tab view (Pending/Submitted/Complaints) + AdaptiveVideoPlayer integration + verdict modal
2. Complaint resolution flow (AI verdict + Razorpay refund trigger + manual notes)
3. Pricing admin (AI status, flash deal CRUD, override management)
4. Fraud risk matrix (heatmap, duplicate merge, block actions)
5. Finance ledger + payout queue + CSV/PDF export
6. Settings (config, team management, action logs)
7. Real Socket.io listeners (currently 30s polling on dashboard)
8. CSV export utility (`lib/admin/export.ts`)

### Things to Avoid (Admin)
- Don't share localStorage tokens between customer/partner/admin
- Don't reuse customer Tailwind utility classes (admin is intentionally inline-styled dark)
- Don't add admin routes outside `/admin/**` — sidebar/topbar/auth all key off this prefix
- Don't query users/hotels via publishable Supabase key — RLS blocks; use the anon JWT key

---

---

## 🎬 Instagram-for-Hotels — Phases A-D (May 2026, v14 → v18)

Sessions 1-6 built the **data + admin layer** (influencer registration, points, referrals, admin moderation). Phases A-D built the **user-facing Instagram-style experience** on top.

**Current live version: v18** (commit `0efb0c4` on main, Vercel READY)

### Live URLs added in this batch
- `https://www.staybids.in/reels` — Instagram-style vertical video feed
- `https://www.staybids.in/influencer/upload` — creator video upload
- `https://www.staybids.in/influencer/public/[id]` — public creator profile (rebuilt with avatar + Follow + reels grid)
- `https://www.staybids.in/tag/[name]` — hashtag landing page
- `https://www.staybids.in/saved` — user's saved collection (videos + hotels + creators + deals)

### Phase A — Foundation (v14)
- `/reels` page: full-screen vertical scroll-snap video cards, IntersectionObserver-driven autoplay, mute toggle, like/comment/share/save action rail, Book CTA, comment drawer
- `/influencer/upload`: Supabase Storage upload to `hotel-videos` bucket, progress bar, my-reels grid below the form
- Tables: `video_likes`, `video_comments`, `user_follows` with denormalized count triggers (`likes_count`, `comments_count`, `views_count`, `followers_count` on hotel_videos / influencers)
- Routes: `/api/videos/feed`, `/api/videos/like/[id]`, `/api/videos/comments/[id]`, `/api/influencer/follow/[id]`, `/api/influencer/my-videos`
- Navbar: Reels link added; `/reels` route hidden from Navbar

### Phase B — Creator chip + watch-time tracking (v15)
- `/api/videos/feed` enriched: each video now joins `hotel` AND `creator` (influencer profile)
- `/reels` real creator chip: avatar (image or initials), display name, ✓ verified pill, follower count, Follow button — links to `/influencer/public/[id]`
- Falls back to "🏨 Hotel Direct" badge when uploader is not a creator
- Hashtag parser splits caption into plain text + clickable `#tags`
- Watch-time tracking: records start time on visibility, reports on swipe-away (`event_type: video_view`), 90% playback fires `video_complete`. Writes to `referral_events.metadata` JSONB column.
- `increment_video_view` RPC bumps `hotel_videos.views_count`

### Phase C — Social graph completion (v16)
- "For You" / "Following" toggle at top of `/reels` (gold gradient on active)
- `/api/videos/feed?following=1` filters to creators current user follows (Bearer token → `user_follows` → `influencer.user_ids`)
- `/api/influencer/following` lists user's follow-list with creator details
- Public creator profile rebuild: avatar, big Follow / ✓ Following button (optimistic), 4-stat grid (Followers / Reels / Hotels / Rating), 3-col reels grid with view + like overlays
- Comment drawer threading: `parent_id` support, "Reply" link, "Replying to user…" pill, Cancel chip, indented reply rendering with gold left-border
- Schema: `influencers.display_name`, `avatar_url`, `following_count`; `referral_events.metadata` JSONB + indexes; `fn_user_follows_following_count` trigger

### Phase D — Discovery polish (v17)
- Trending hashtags: Postgres RPC `trending_hashtags(p_days, p_limit)` extracts `#tags` from approved video titles in N-day window
- `/api/hashtags/trending` wraps the RPC; horizontal "🔥 Trending #tag1 #tag2…" strip in `/reels` TopBar (hidden when a tag filter is active)
- `/tag/[name]` landing page: hero + count + "▶ Watch in Reels" CTA + related-tags chips + 3-col reels grid
- Reel caption hashtags now link to `/tag/[name]` (not `/reels?tag=…` anymore)
- `/saved` page with 5-tab filter (All / Reels / Hotels / Creators / Flash Deals); enriched route `/api/discover/saves/enriched` joins each save with its target in one round-trip; hover ✕ to remove (optimistic)
- Notification triggers (zero backend code, all Postgres):
  - `fn_notify_on_video_like` → queues `video_like` for video owner
  - `fn_notify_on_video_comment` → queues `video_comment` for owner + `comment_reply` for parent author when threaded
  - `fn_notify_on_follow` → queues `new_follower` for the followed creator
  - All payloads include `fromUserId`; self-events skipped; reuses existing `notification_queue` worker

### v18 — Desktop nav fix
- Bug: Desktop top nav rendered only `USER_LINKS`; `NAV_LINKS` (containing Reels) was unused with a "moved to footer" comment, so desktop visitors never saw the Reels link
- Fix: Restored `NAV_LINKS` rendering in desktop top nav for **all users (logged in or not)**
- Reels chip gets a small gold "NEW" pill when not active
- Mobile bottom bar (`BOTTOM_PRIMARY`) had it since v14

### New / Updated Files (Phases A-D)
```
app/reels/page.tsx                              # Instagram-style feed (large file, single-file architecture)
app/saved/page.tsx                              # Saved collection
app/tag/[name]/page.tsx                         # Hashtag landing
app/influencer/upload/page.tsx                  # Creator upload
app/influencer/public/[id]/page.tsx             # Rebuilt with Follow button + reels grid
app/influencer/layout.tsx                       # Upload tab added

app/api/videos/feed/route.ts                    # Enriched with hotel + creator + ?following=1
app/api/videos/like/[id]/route.ts               # Toggle like
app/api/videos/comments/[id]/route.ts           # GET / POST / DELETE with parent_id
app/api/videos/track-view/route.ts              # Watch-time → referral_events
app/api/videos/upload/route.ts                  # Existed; metadata insert
app/api/influencer/follow/[id]/route.ts         # Toggle follow
app/api/influencer/following/route.ts           # User's follow list
app/api/influencer/public/[id]/route.ts         # Returns videos + live followers + avatar
app/api/influencer/my-videos/route.ts           # Creator's own uploads
app/api/hashtags/trending/route.ts              # Wraps RPC
app/api/hashtags/[name]/route.ts                # Per-tag videos + related tags
app/api/discover/saves/enriched/route.ts        # Joins saves with target details

components/Navbar.tsx                           # NAV_LINKS rendered on desktop; Saved + Reels added
public/sw.js                                    # CACHE_NAME bumped to v18
app/layout.tsx                                  # SB_BUILD = v18-...; badge "v18"

lib/sb.ts                                       # Already existed; SB_URL/SB_KEY/SB_H/userFromReq used by every new route
lib/api.ts                                      # Social methods added (toggleVideoLike, postComment, toggleFollow, getVideoFeed, etc.)

migrations/2026-05-03-phase-c-social.sql        # Display name / avatar / following_count / metadata
migrations/2026-05-03-phase-d-discovery.sql     # trending_hashtags RPC + 3 notification triggers
```

### New Supabase Tables (full list as of v18)
| Table | Purpose | Triggers |
|-------|---------|----------|
| `influencers` | Creator profiles (Sessions 1+) | display_name, avatar_url, followers_count, following_count |
| `influencer_commissions` | 12% / 15% commission rows |  |
| `influencer_referral_codes` | Per-creator referral codes |  |
| `referral_events` | Click / signup / bid / booking / video_view / video_complete | `metadata` JSONB for watch_seconds etc. |
| `hotel_videos` | Reel uploads (status: pending / approved / rejected) | likes_count, comments_count, views_count, uploader_type |
| `user_points` | Loyalty wallet (Session 4) |  |
| `points_history` | Loyalty ledger |  |
| `user_saves` | Bookmark target_type + target_id (video/hotel/influencer/deal) |  |
| `notification_queue` | All push/email/sms notifs (Session 6) | populated by 3 social triggers in Phase D |
| **`video_likes`** | Phase A — one-row-per-(user,video) | `fn_video_likes_count` updates `hotel_videos.likes_count`; `fn_notify_on_video_like` queues notif |
| **`video_comments`** | Phase A — `parent_id` for threading | `fn_video_comments_count` updates count; `fn_notify_on_video_comment` queues 1-2 notifs |
| **`user_follows`** | Phase A — follower_id → influencer_id | `fn_user_follows_count` updates followers_count; `fn_user_follows_following_count` updates following_count; `fn_notify_on_follow` queues notif |

### New Supabase RPCs
- `trending_hashtags(p_days INT, p_limit INT)` → `(tag TEXT, uses BIGINT)` — extracts `#tags` from approved video titles
- `increment_video_view(p_video_id TEXT)` → `void` — bumps `hotel_videos.views_count`
- (Existing from Sessions) `fn_on_bid_accepted` — replaces backend bid-accept logic

### lib/api.ts methods added in this batch
```
// Videos
uploadVideo, getHotelVideos, deleteVideo
getVideoFeed, getMyCreatorVideos
toggleVideoLike, checkVideoLike
getVideoComments, postComment, deleteComment

// Social graph
toggleFollow, checkFollow

// Hashtags + Saves used direct fetch (no api wrapper) — keeps lib/api.ts smaller
```

### Storage buckets
- `hotel-videos` — creator/hotel video uploads (public read, anon-key write)
- `hotel-images` — existing; thumbnails + hotel photos

### Service Worker / cache version history
- v10 → original
- v11 → first cache-bust to expose Sessions 1-6
- v12 → desktop nav added Points + Creator
- v13 → /influencer routing fix
- **v14** — Phase A (reels feed + creator upload + social tables)
- **v15** — Phase B (creator chip + watch-time)
- **v16** — Phase C (Following filter + threaded comments + public profile rebuild)
- **v17** — Phase D (trending hashtags + saved collection + notif triggers)
- **v18** — Desktop nav Reels link visible
- **v19** — `/discover` Instagram-mode toggle (added Reels-style card view alongside Luxury Ken-Burns)
- **v20** — Reels-only locked: Luxury rendering removed from `/discover`, root `/` redirects into `/discover`
- **v21** — Per-hotel videos + 3D actions (love-bomb hearts, 3D Follow, equal 3D translucent Book/Bid CTAs, comment drawer, More menu, share toast)
- **v22** — Creator profile sheet + fullscreen + layout fixes (sound unmute, slower hearts, comment input visibility, profile chip moved off the brand chrome)
- **v23** — Global SoundProvider + true-fullscreen viewport (ServerStatus hidden on /discover, /reels, /admin, /partner, /onboard)
- **v24** — Source filter (Hotels / Creators / Public) + location picker
- **v25** — Anti-bypass communication guard (`sanitizeComment`) on every public surface
- **v26** — Live profile graph (FollowProvider with real-time counts + searchable followers/following) + reel-grid scrolls feed + tappable highlights filter
- **v27** — Create flow (`+` FAB → Reel/Photo/Story composer with audio picker, emoji bar, tag chips), audio amplifier (Web Audio gain), swappable per-reel soundtracks
- **v28** — Sound restored (CORS taint fix), `+` button & filter chip shrunk + repositioned
- **v29** — User uploads now appear in feed + profile via PostsProvider (current)

When the user says "frontend par change nahi dikh raha" → 99% of the time it's the Service Worker serving cached assets. Always bump `CACHE_NAME` in `public/sw.js` AND `SB_BUILD` in `app/layout.tsx` AND the visible `>vN<` badge together. The kill-switch in `app/layout.tsx` then unregisters old SW + reloads on first visit.

### Things to Avoid (Phases A-D)
- Don't add new social actions outside `/api/videos/...` and `/api/influencer/...` — keeps Realtime subscriptions clean
- Don't widen comment threading past 1 level — drawer height becomes unmanageable
- Don't drop `referral_events.metadata` — analytics queries (avg watch time per video) read from it
- Don't query `hotel_videos` without `verification_status=eq.approved` filter on the public feed — admin moderation lives there
- The Supabase Storage anon key (`SUPABASE_URL` + anon JWT) is OK in client code; it's the same one already in `lib/supabase.ts`

### What's NOT done yet (Phase E candidates)
1. **Notification queue worker** — triggers fire and rows accumulate, but nothing drains them. Needs MSG91/SendGrid/FCM connector. Out of scope until those keys exist.
2. **Search bar** in /reels (search by tag, creator name, hotel)
3. **Push notification permission prompt** in browser + service worker push handler
4. **Reels analytics dashboard** for creators (watch-time per reel, drop-off curve, conversion to bookings)
5. **Video moderation auto-approve** — currently every reel sits in `pending` until admin approves at `/admin/videos`
6. **Audio/music library** for reels (creators can pick a track)

---

## How to Start a New Session with Full Memory

Run this command inside the project folder:
```bash
claude "Read CLAUDE.md fully, then ask me what to work on next for StayBid frontend"
```

### Key context to mention if starting fresh
- Branch: `claude/heuristic-knuth-23cf5e` (worktree, pushed to `main` on every commit)
- Current production version: **v61** (commit `b0f1ea8` on main, Vercel `dpl_CpVxFnBVu27ALYxN3Peq2HWQcVq6` READY)
- Supabase project: `uxxhbdqedazpmvbvaosh` — use `lib/sb.ts` helpers for any new Next.js API route
- Live site: `https://www.staybids.in` served from Vercel project `staybid-customer-frontend` (NOT `staybid-frontend`)
- All 12+ Supabase tables live, ALL triggers + RPCs live (no backend Railway changes needed)
- Pattern: additive migrations only, TEXT IDs (CUIDs), Bearer token via `userFromReq()`, push to branch then `branch:main`
- Always bump `public/sw.js` CACHE_NAME + `app/layout.tsx` SB_BUILD + badge together when shipping UI changes

### Architecture (post-v61)
- **`/` route renders DiscoverPage directly** (no redirect). Navbar hidden there. Mobile users land in the reel feed in one HTTP round-trip.
- **Mobile primary nav**: `<DialerNav />` left-edge crown wheel (`components/DialerNav.tsx`). Mounted globally in `app/layout.tsx`. NO bottom dock anymore.
- **Top Navbar** (`components/Navbar.tsx`): visible on traditional pages (`/hotels`, `/flash-deals`, `/bookings`, `/profile`, etc.) — hidden on `/`, `/discover`, `/reels`, `/admin/*`, `/partner/*`, `/onboard/*`.
- **City filter pipeline**: globe picker (`components/LocationGlobePicker.tsx`) writes `sb_city` + fires `sb:city-change`. /hotels, /flash-deals, /discover all subscribe.
- **Reel-page fullscreen**: `useReelFullscreen()` from `lib/useReelFullscreen.ts` writes `--reel-vh` from `visualViewport.height`. Globals.css `.is-reel-page` reads it. Combined with manifest `display: fullscreen` + URL-bar collapse trick (`window.scrollTo(0, 1)` in layout.tsx), works on every device.
- **SW strategy** (`public/sw.js`): network-only `/api/`, cache-first `/_next/static/`, **stale-while-revalidate HTML** (Instagram-fast warm visits), SWR for images/fonts.

### Vercel build gotchas (CLAUDE.md "Things to Avoid")
- No `for..of` on `Map.keys()` / `Set.values()` — `tsconfig` doesn't enable `downlevelIteration`. Use `Array.from(...).forEach()`.
- Verify `@types/react-dom` is in `package.json` whenever importing from `react-dom`.
- Use `<style jsx global>` (not just `<style jsx>`) for component CSS that affects elements outside the component's render tree.
- Critical CSS goes in `app/layout.tsx <head>` `<style dangerouslySetInnerHTML={...}>` so it ships before JS hydrates.

---

## Reels-Home Era (v19 → v29, May 2026)

This batch turned `/discover` into a **standalone Instagram-style Reels home** and made `/` redirect into it. The old Luxury Ken-Burns + bottom-sheet UI was removed from the active code; it's preserved at `app/_home-luxury-backup.tsx` (filename starts with `_` so Next.js does NOT register it as a route — fully intact for restoration).

### Live entry point
- `https://www.staybids.in/` → server-redirects to `/discover`
- `/discover` → renders **only** the Reels feed (no Luxury fallback in the active code)

### Feed architecture (`components/discover/InstagramHotelFeed.tsx`)
~2300-line monolith. One file holds the entire feed because state is dense and tightly coupled. Key pieces (search by these keywords if you need to find them):

| Piece | Where to look |
|-------|---------------|
| Per-hotel reel video | `videoForHotel()` — accepts `http(s)`, `blob:`, returns `""` for `_userPost && !videoUrl` (photo posts), else dummy Google-CDN clip by hash |
| Hotel-as-creator entity | `entityFromHotel()` — wraps a hotel into the `Creator` shape so the same profile sheet renders for hotel chips and creator chips |
| 12-pool creator cycle | `CREATOR_POOL` — 3 hotel handles, 5 verified creators, 4 public travellers; `creatorFor(h)` + `sourceFor(h)` |
| Anti-bypass sanitizer | `sanitizeComment(text)` + `CONTACT_PATTERNS` — phone / email / URL / domain / WhatsApp / DM / "off-platform" / handle-share patterns scrubbed to `•••••` |
| Synthesized stats | `pseudoStat(seed, salt, min, max)` — stable per-hotel like / view / follower / comment counts |
| Right-rail mute + gain | `MoreMenu` has "Volume booster (1.8× — tap to change)" — cycles `[1.0, 1.5, 1.8, 2.2, 2.6, 3.0]` via `cycleGain` |
| Per-card audio override | `customAudio` state + tappable `.ig-audio-strip-btn` opens `<AudioPicker>`; mounts a synced `<audio crossOrigin="anonymous">` and mutes the video |
| Highlight → filter map | `applyHighlight(items, hl)` — Mountains/Beaches/Foodie/Suites/Top picks each map to a filter predicate |
| Avatar tap menu | `avatarMenu` state + `.ig-avatar-menu` — Instagram-style "View Profile" / "Watch Reels" popover |
| Profile sheet (creators + hotels) | `CreatorProfileSheet` — 4 tabs (Reels / Tagged / Followers / Following), reel-grid items call `onPickReel(hotelId)` to scroll the main feed instead of navigating |
| Filter chip | `.ig-filter-chip` — slim top-LEFT pill ("All · 📍India ▾"), opens `<FilterSheet>` |
| Floating Create | `<CreateFlow>` mounts `<CreateFAB>` (36×36 right-edge bottom 130px), `<CreateSheet>`, `<Composer>`, `<AudioPicker>` |

### Stores (lib/*-store.tsx)
Three React Context providers wrapping `<children>` in `app/layout.tsx` (in this order, outermost first):
```
AuthProvider
└── SoundProvider          ← lib/sound-store.tsx
   └── FollowProvider      ← lib/follow-store.tsx
      └── PostsProvider    ← lib/posts-store.tsx
```

#### `lib/sound-store.tsx` — `useSoundStore()`
```ts
{ isMuted, hasInteracted, gain, toggleMute, setMuted, setGain, markInteracted }
```
- Default mute = true (mobile autoplay policy)
- `gain` ∈ [0, 4]; default 1.8; persisted to `sb_reel_gain`
- The video itself NEVER routes through Web Audio — only custom-audio elements do (CORS taint silences cross-origin video sources). This was the v28 fix for "no sound in feed."

#### `lib/follow-store.tsx` — `useFollow()`
```ts
{ follows, isFollowing, toggleFollow, followerCount, followingCount,
  followers, searchFollowers, myDisplayName, setMyDisplayName }
```
- `follows: string[]` of handles (persisted as `sb_follows_v1`)
- `followerCount(handle)` = synthesized `baseFollowerCount(handle)` + 1 if user follows
- `followers(handle)` = 80–600 synthesized `"Display Name|@handle"` entries + the user pinned at top if they follow
- `searchFollowers(handle, q)` = client-side `.includes(q)` filter

#### `lib/posts-store.tsx` — `usePosts()`
```ts
{ posts, addPost, removePost }
```
- `UserPost = { id, kind, mediaUrl, mediaMime, caption, tags, audio, createdAt }`
- Media is a `URL.createObjectURL` blob — survives nav, **dies on hard reload** (the underlying File is gone). Persisting binary across reloads needs IndexedDB or backend upload.

### Audio amplifier (`lib/audio-amplifier.ts`)
Tiny wrapper around Web Audio:
```ts
applyGain(media: HTMLMediaElement, gainValue: number)  // 0–4
resumeAudio()                                          // run inside user gesture
```
- One AudioContext per page, one MediaElementSourceNode per media element (the API is single-shot).
- **Never call `applyGain` on cross-origin video** — it silences. Only safe on same-origin or CORS-clean media (we use it on `<audio>` from Mixkit + uploaded blobs).

### Create flow (`components/discover/CreateFlow.tsx`)
Self-contained file holding `<CreateFAB>` + `<CreateSheet>` + `<Composer>` + `<AudioPicker>`. Wired into the feed via `<CreateFlow sanitize={sanitizeComment} onPosted={…}>`.

- **`+` FAB** → CreateSheet with 3 cards (Reel / Photo / Story)
- **Composer** has 2 steps: pick file → preview + caption (with emoji bar + sanitizer warn) + tag chips + audio picker + Post
- **AudioPicker** sources: 🎙 Original, 📥 Mixkit library (8 tracks), 📥 Device upload (`<input accept="audio/*">` + `URL.createObjectURL`)
- On Post: writes via `usePosts().addPost()`. Feed picks up the new entry instantly.

### Anti-bypass guard (v25, locked-in)
**Rule:** hotels ↔ creators ↔ customers must NOT use the public reel surfaces as a private DM channel before a booking is confirmed. `sanitizeComment()` scrubs every public-display string:

- Comment input (on submit) → masked + warning toast
- Sample seed comments (defense in depth)
- Creator bio in profile sheet
- Hotel `description` field shown in caption
- Composer caption (on Post)

Visual surfaces removed because they were private-DM channels:
- ❌ "💬 Message" button on creator profile
- ❌ "Reply" affordance on each public comment

After-booking chat is gated to `/bookings` (already authenticated booking-owner ↔ booked-property only) — out of scope for the reels guard.

### `_home-luxury-backup.tsx`
The pre-v20 luxury homepage lives at `app/_home-luxury-backup.tsx`. Filename starts with `_` so Next.js App Router does NOT register it as a route. To restore the old homepage:
1. Delete `app/page.tsx` (currently a 12-line redirect into `/discover`).
2. Rename `app/_home-luxury-backup.tsx` → `app/page.tsx`.

### `_home-luxury-backup.tsx` is the only frozen artifact
- The original `/discover` Luxury rendering code was deleted from `app/discover/page.tsx` outright (recoverable from git at commit `4b404c3`).
- `viewMode` state and `ViewMode` type also removed — there's no toggle, only Reels.

### localStorage Keys (current full list, all routes)
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_token` | JWT string | Customer auth token |
| `sb_user` | JSON | Customer user object |
| `sb_token_type` | `"backend"` \| `"firebase"` | HS256 vs RS256 |
| `sb_partner_token` | JWT | Partner auth |
| `sb_partner_user` | JSON | Partner user + hotel |
| `sb_admin_token` | JWT | Admin auth |
| `sb_admin_user` | JSON | Admin user |
| `bid_dates_{bidId}` | `{checkIn, checkOut}` | Booking-date fallback |
| `deal_price_{bidId}` | Price string | Flash-deal display price |
| `sb_city` | City string | Nav location chip (also seeds reel filter default) |
| `sb_build` | Build version string | SW kill-switch trigger |
| **`sb_reel_mute`** | `"0"` / `"1"` | Global reel mute (sound-store) |
| **`sb_reel_interacted`** | `"1"` | First mute/unmute happened |
| **`sb_reel_gain`** | Number string `"1.0"`–`"3.0"` | Volume booster (sound-store) |
| **`sb_reel_filter_source`** | `"all"` \| `"hotel"` \| `"creator"` \| `"public"` | Reel filter source |
| **`sb_reel_filter_city`** | `"all"` or city name | Reel filter location |
| **`sb_follows_v1`** | JSON array of handles | Follow graph (follow-store) |
| **`sb_user_display_name`** | String | Display name shown at top of follower lists |
| **`sb_user_posts`** | JSON array of `UserPost` | User-uploaded reels/photos/stories |

### Service-worker version map (continued)
- v18 → desktop-nav-reels-visible
- v19 → discover-instagram-mode (toggle)
- v20 → reels-only-root-redirect (Luxury removed)
- v21 → reels-videos-3d-actions
- v22 → creator-profile-fullscreen
- v23 → global-sound-true-fullscreen
- v24 → source-location-filter
- v25 → anti-bypass-comment-guard
- v26 → live-profile-graph
- v27 → create-flow-audio-amp
- v28 → fix-sound-and-overlap
- **v29 → user-posts-in-feed (current)**

### Things to Avoid (Reels-Home Era)
- **Never** call `applyGain` on the `<video>` element in `InstagramHotelFeed`. It silences any cross-origin video. Custom `<audio>` elements only.
- **Never** add a private-DM affordance (Reply, Message, Inbox, Chat) to any reel surface. Anti-bypass rule v25 is non-negotiable until the post-booking messaging feature ships under `/bookings`.
- **Never** restore Luxury mode without deleting v20–v29's many tap-to-action wires that assume Reels-only — better to fork a `/discover-luxury` route.
- Don't strip `_userPost` flags from the Item shape — they drive the "✨ YOUR REEL" pill, the suppressed Book/Bid row, the `videoForHotel` blob fallback, and `videoBroken` initial state.
- Don't store user-post media as base64 in localStorage — 5 MB cap is too small. Use IndexedDB if persistence across hard reloads becomes required.
- Don't query `commondatastorage.googleapis.com/gtv-videos-bucket/` with `crossOrigin="anonymous"` — fails CORS preflight on some browsers and the video element 404's. Just use the URL bare.

### Files added during this era
```
app/_home-luxury-backup.tsx                # preserved old homepage (NOT a route)
app/page.tsx                               # rewritten — now just redirects to /discover
app/discover/page.tsx                      # rewritten — Reels-only

components/discover/InstagramHotelFeed.tsx # ~2300 lines, the entire feed UI
components/discover/CreateFlow.tsx         # FAB + CreateSheet + Composer + AudioPicker

lib/sound-store.tsx                        # global mute + gain (Web Audio)
lib/follow-store.tsx                       # global follow graph + searchable followers
lib/posts-store.tsx                        # user uploads visible in feed + profile
lib/audio-amplifier.ts                     # Web Audio gain helper

.claude/launch.json                        # one-server config: next-dev on :3000
```

### Files modified
```
app/layout.tsx        # wraps SoundProvider → FollowProvider → PostsProvider; SB_BUILD + badge bumped per release
components/Navbar.tsx # already hides on /discover and /reels (line 178/179)
components/ServerStatus.tsx # hides on /discover, /reels, /admin, /partner, /onboard (added v23)
public/sw.js          # CACHE_NAME bumped per release
```

---

## Stories + Highlights + Account Upgrade Era (v30 → v49, May 2026)

This batch covered three big themes: making the reel feed feel like a complete profile (stories, highlights, tagged hotels, profile photos), unifying the Public → Creator / Hotel upgrade flow, and locking the reels viewport to fullscreen on every device.

**Current production version: v49** (commit `5f7e59d` on main).

### v30 → v44: Reels social UX (profile photo, tag hotel, dedup uploads)
- **v44** — self-follow fix: `_isSelf: true` flag added to PostsStore items so the user's own reels swap the Follow button for a "✦ You" badge. Profile sheet shows "✏️ Edit profile" CTA instead of useless Follow.
- **ProfilePhotoEditor** in `components/discover/CreateFlow.tsx` — picks a JPEG, scales to ≤256 px, stores as data-URL on `useFollow().myAvatarUrl` (LS key `sb_user_avatar_url`).
- **HotelPicker** in `CreateFlow.tsx` — debounced search hits `/api/hotels`, sets `taggedHotel` on the post. Feed renders "🏨 At {Hotel} · Explore ›" pill + routes the Book/Bid CTAs to `/hotels/[id]` so viewers convert from a user reel straight into a booking.
- **Reel double-upload fix** — Composer guards with `postedRef` (immediate ref, not React state) to kill synchronous double-fire from the two Post buttons. PostsStore.addPost also dedups by content fingerprint (kind + mediaMime + posterUrl prefix + caption) within a 5 s window as a belt-and-braces guard.

### v45: Stories + Highlights + Edit profile + grid dedup
- **Stories (24h auto-expire)** — Composer Story kind gets a "💾 Also save as a post" toggle. `storyExpiresAt = createdAt + 24h` set in PostsStore. The userItems mapper filters expired stories on every render (no background timer). When `keepAsPost: true`, the story is ALSO surfaced in the regular feed and survives past 24h.
- **StoryViewer** — fullscreen modal in `InstagramHotelFeed.tsx`, IG-style with progress bars at top, prev/next tap zones (30 % each side), centre tap to pause, 5 s per image, video onEnded auto-advance, sanitized caption.
- **Story ring** — `.ig-avatar.has-story` class adds a rotating colourful conic-gradient ring (`@keyframes igStoryRingSpin`). Self avatar gets the ring whenever `activeStories.length > 0`; tapping the avatar opens the StoryViewer directly (bypasses the avatar popover menu).
- **Highlights** — `HighlightPicker` in CreateFlow lets the user pick built-in (Mountains / Beaches / Foodie / Suites / Top picks / Solo) OR create a custom highlight (label + emoji). Stored on `useFollow().myCustomHighlights` (LS key `sb_user_custom_highlights_v1`).
- **Profile-sheet highlights row** — merges built-ins + custom. Tapping a highlight on YOUR own profile filters the personal reel grid to posts tagged with that key. "↺ All reels" chip clears.
- **Expanded profile editor** — `ProfilePhotoEditor` now also edits Bio (`myBio`), Location (`myLocation`), Website (`myWebsite`), plus inline highlight management. Phone number is NOT editable (anti-bypass + auth identity).
- **Profile grid: dedup by id + "YOU" pill removed from grid tiles** (still on main feed cards for mixed-source disambiguation).

### v46: /upgrade flow + tier banner + dedup uploads
- **`/upgrade`** new page — single entry for Public users to apply to Creator (inline form) or Hotel partner (links to external Vercel deploy). Probes account state via `api.getMyInfluencer()` + `sb_partner_token` → `/api/partner/hotel`. Shows the right status banner for PUBLIC / PENDING_CREATOR / CREATOR / HOTEL / BLOCKED.
- **`SelfTierBanner`** in `InstagramHotelFeed.tsx` — surfaces account-tier state on the user's own profile sheet. Public sees an "Explore upgrade options →" CTA; active creators see a 3-stat strip (Earned / Bookings / Followers); active hotel partners see the open-dashboard link; blocked accounts see an appeal notice.

### v47: True fullscreen reels + real partner panel link
- **Body lock** for reel pages — new `body.is-reel-page` class in `globals.css` pins html+body to `100dvh`, kills overscroll, removes the URL-bar gap that caused "kabhi fullscreen kabhi nahi" on Android. `/discover` and `/reels` both apply the class via useEffect.
- **Demo `/hotel-partner` removed** — that route was a stub. The real Hotel Partner panel lives at `https://staybid-hotel-panel.vercel.app` (repo `Sachinhelpline/staybid-hotel-panel`). All navbar entries + SelfTierBanner + `/upgrade` now link to that external URL (target=_blank, ↗ glyph).

### v48: Inline creator application + admin approval queue
- **Creator application inlined on `/upgrade`** — no more detour through `/influencer/register`. Tap "Apply as a Creator" → form expands right there. Mobile number + display name from auth context are shown read-only at the top so user and admin both see who's applying.
- **`/influencer/register` retired** — file is now just a redirect to `/upgrade` so cached links keep working. `/influencer/*` layout redirects unregistered users to `/upgrade` instead of `/influencer/register`.
- **Admin Creator Applications page** — new `/admin/creators` (sidebar entry "✨ Creators" between Users and Hotels). Status filter (pending / active / blocked / all), search by name + phone + bio, Review modal with bio / KYC / bank details + 1-tap **Approve · Pending · Block** + Aadhaar / PAN verified toggles.
- **`/api/admin/creators`** — GET joins `users.phone / name / email` on the `influencers` row so admin doesn't need a second lookup. PATCH updates `influencers.status / aadhaar_verified / pan_verified` via Supabase REST.

### v49: Upgrade merged into /profile + "Discover" rename + account button
- **Bug fix: creator application form silent-failed for non-PUBLIC tiers** — gate was `tier === "PUBLIC"`. Hotel partners couldn't open the form. Now opens for any tier that isn't already a creator (or blocked) — Hotel partners can also apply as creators (paths aren't mutually-exclusive).
- **`<UpgradeSection />`** new shared component at `components/upgrade/UpgradeSection.tsx`. Holds the tier probe (`useAccountTier`), status banner, two-path cards, and inline creator application form. Two variants — `full` (used by `/upgrade`) and `compact` (used by `/profile`).
- **`/profile` gets the upgrade flow** — new "Upgrade your account" card right after Personal Details. Users see their tier + Apply CTAs + can submit the creator application without leaving `/profile`. `/upgrade` standalone still works as a deep-link target.
- **Navbar rename**:
  - Bottom-bar right-most "More" → user's first name + gold avatar initials (or "Account" / "Sign in" by auth state). Same sheet opens on tap — sharper affordance.
  - Top NAV_LINKS + bottom BOTTOM_PRIMARY "Reels" → "Discover" (describes what the user *does* with it, not just the content type).

### Files added during this era
```
app/upgrade/page.tsx                       # /upgrade landing — Creator + Hotel cards, uses UpgradeSection
app/admin/creators/page.tsx                # Admin queue for creator applications (status filter, review modal)
app/api/admin/creators/route.ts            # GET creators with users join · PATCH status / KYC flags

components/upgrade/UpgradeSection.tsx      # shared upgrade UI (full / compact variants) — used by /upgrade + /profile
```

### Files modified (this era)
```
app/layout.tsx                             # SB_BUILD + badge bumped each release (v44 → v49)
app/profile/page.tsx                       # mounts <UpgradeSection variant="compact" />
app/discover/page.tsx                      # applies body.is-reel-page; inline 100dvh + 100vw
app/reels/page.tsx                         # same fullscreen body-lock as /discover
app/influencer/layout.tsx                  # unregistered users → /upgrade (was /influencer/register)
app/influencer/register/page.tsx           # now a redirect stub to /upgrade

components/Navbar.tsx                      # "More" → account name + initials · "Reels" → "Discover" · "Partner" external to staybid-hotel-panel.vercel.app
components/discover/InstagramHotelFeed.tsx # StoryViewer, story ring, _isSelf flag, SelfTierBanner, highlights row, dedup grid, account-tier probe
components/discover/CreateFlow.tsx         # ProfilePhotoEditor, HotelPicker, HighlightPicker, story save-as-post toggle, postedRef double-fire guard

lib/follow-store.tsx                       # +myAvatarUrl, myBio, myLocation, myWebsite, myCustomHighlights (with add/remove)
lib/posts-store.tsx                        # +taggedHotel, +highlight, +storyExpiresAt, +keepAsPost · content-fingerprint dedup in addPost

app/globals.css                            # `.is-reel-page` html+body fullscreen lock
public/sw.js                               # CACHE_NAME v44 → v49
components/admin/sidebar.tsx               # +Creators tab entry
```

### Hotel Partner panel — external deployment
- Real partner panel lives at **`https://staybid-hotel-panel.vercel.app`** (repo `Sachinhelpline/staybid-hotel-panel`).
- The customer-frontend repo has NO local `/hotel-partner` route — that was a demo, removed in v47.
- All "List your Hotel" / "Open Hotel Dashboard" CTAs (`/upgrade`, profile sheet, navbar Partner chip) use `target="_blank" rel="noopener noreferrer"` to that external URL.

### Account states (single source of truth)
```
PUBLIC            ← default for any signed-in user
PENDING_CREATOR   ← influencers row exists with status="pending"
CREATOR           ← influencers row with status="active"
HOTEL             ← partner-token resolves a hotel via /api/partner/hotel
BLOCKED           ← influencers row with status="blocked"
UNKNOWN           ← tier probe still in flight
```
Tiers detected by `useAccountTier()` in `components/upgrade/UpgradeSection.tsx`. The probe runs once per consumer mount; consumers call `refresh()` after the user submits a creator application so the banner flips PUBLIC → PENDING_CREATOR without a manual reload.

### localStorage Keys added in this era
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_user_avatar_url` | data-URL JPEG | User's profile photo (≤256 px, ~30 KB) |
| `sb_user_bio` | string | Profile bio (sanitized at render) |
| `sb_user_location` | string | Profile location |
| `sb_user_website` | string | Profile website |
| `sb_user_custom_highlights_v1` | JSON array | User-created highlights `[{key, label, emoji, custom: true}]` |

### Service-worker version map (continued)
- v30 → social-foundation
- v31–v43 → see git log
- v44 → self-follow-fix-profile-photo-hotel-tag
- v45 → stories-highlights-edit-profile
- v46 → upgrade-flow-dedup-fix
- v47 → fullscreen-reels-real-partner-panel
- v48 → inline-creator-application-admin-approve
- **v49 → upgrade-in-profile-discover-account-nav (current)**

### Things to Avoid (Stories + Upgrade Era)
- **Never** gate the inline creator application form to a single tier — Hotel partners and Public users both need to be able to open it. The condition is "not already a creator and not blocked".
- **Never** add the `/hotel-partner` route back to this repo — the real panel is a separate deployment. Any "List your Hotel" surface should link out via `https://staybid-hotel-panel.vercel.app`.
- **Never** call `requestFullscreen()` synchronously inside React render — must be inside a user gesture handler (`onTouchStartCapture` / `onClickCapture`). iOS Safari also ignores it for non-video elements; rely on `body.is-reel-page` instead.
- **Never** strip the `_isSelf` flag from user post items — drives "✦ You" badge, story ring, status banner, SelfTierBanner, profile-edit avatar route.
- **Never** persist data-URLs larger than ~80 KB to localStorage — that's why ProfilePhotoEditor scales to 256 px @ 0.8 JPEG quality. For full-resolution avatars, use Supabase Storage.
- **Never** show the user's phone number on any public surface — it's only allowed in the read-only identity strip on `/upgrade` (visible only to the signed-in user themselves) and in the admin creator-review modal.

---

## Flash Deals + Live Location + Performance Era (v53 → v56, May 2026)

This batch covered three big themes: (1) ultra-premium **Flash Deals** with one-deal-per-hotel + live availability + upgrade ladder, (2) **animated globe location picker** that drives a single `sb_city` source-of-truth across hotels/flash-deals/reels, and (3) **performance hardening** — bulletproof reel-page fullscreen, dynamic-imported feed, cross-mode prefetch, network-first service worker.

### v53 — Flash Deals: one-deal-per-hotel + upgrade ladder + premium UI
- **API rule** ([app/api/flash/near/route.ts](app/api/flash/near/route.ts)) — Earlier the synthesized fallback produced one row per **room**, so a hotel with 3 rooms showed 3 cards. Now:
  - Pool real + synthesized deals per hotel; pick the cheapest **available** room as the headline deal.
  - **Live availability** join: `hotel_room_units` + ACCEPTED/COUNTER `bids` + `room_blocks` overlapping today→tomorrow. Hotels with zero free units are **hidden entirely**.
  - Every other room in the same hotel returns inside an `upgrades[]` array with `dealPrice`, `extraPerNight` (delta from headline), `unitsFree`, `available` flag. Sold rooms render as disabled chips, not removed (so user sees what's gone).
  - Payload shape changed: top-level `generatedAt`, `unitsFree`/`unitsTotal`/`upgrades`/`roomTypesAvailable`, `discount` (was `discountPct` on synthesized rows). Customer hotel page still reads `aiPrice`/`floorPrice` so it keeps working.
  - Sorted by biggest discount first, then cheapest price.
- **Premium animated UI** ([app/flash-deals/page.tsx](app/flash-deals/page.tsx)):
  - Animated mesh background, gradient-shift gold title ("Flash *Deals*"), Cormorant Garamond italic.
  - Live ticker chips with CountUp animation: deals live · hotels · avg off · ₹ savings today (each value animates from previous → current on refresh).
  - Cards: ken-burns image zoom, shimmer sweep across the photo, pulsing red LIVE pill, rotated gold/red discount stamp (red if ≥25%), SVG countdown ring with monospace HH:MM:SS, slot meter with shimmer.
  - Inline **upgrade chips** on every card — tap "Suite" chip → headline price live-flips to that room's deal price (no reload).
  - Tap card → premium drawer: hero image, room picker with units-free per row, 5-line "How this deal works" rules, sticky CTA. Locks body scroll; bottom-sheet on mobile, centered modal on desktop.
- **Build-error fix** documented in CLAUDE.md "Things to Avoid": Vercel's tsconfig lacks `downlevelIteration`, so `for (const x of map.keys())` errors at build. Use `Array.from(map.keys()).forEach(...)` instead.

### v54 — Live globe location picker + cross-page reactive filter
- **New shared component** ([components/LocationGlobePicker.tsx](components/LocationGlobePicker.tsx)) — ~350 lines of self-contained premium globe modal. Imported by both Navbar and reels FilterSheet.
  - Animated conic-gradient globe (~20s spin), faux green-continent overlay, 2 orbital dots (gold + red, opposite directions, different speeds), shimmer sweep across the sphere, gold-shimmer headline city name, pulsing LIVE pill.
  - **Auto-detect**: `Geolocation` + Nominatim reverse-geocode. States: `idle` · `locating` (yellow pulse ring) · `denied` · `fallback` (detected city not in supported list).
  - **Manual** city search with "Use 'whatever-typed'" custom-city option, "🌐 Show me everywhere" reset to "anywhere in India".
  - **Portal mount** to `document.body` — escapes the navbar's `backdrop-filter` containing-block trap (was the original "modal stuck inside 64px navbar" bug). z-index 9999.
- **Single source of truth**: every city pick writes `localStorage.sb_city` + fires `window.dispatchEvent(new Event('sb:city-change'))`. The Navbar chip, /hotels, /flash-deals, and reels feed all subscribe to that event.
- **Race-condition fix**: `/hotels` and `/flash-deals` previously fired an unfiltered fetch on mount, then a city-filtered fetch when `sb_city` was hydrated from localStorage. The slower no-city response could overwrite the fresher city-filtered one. Both now use a `hydrated` flag: `useEffect(..., [city, hydrated])` skips the first fetch until `sb_city` is read in the hydration `useEffect`.
- **Reels feed sync**: `InstagramHotelFeed` also subscribes to `sb:city-change` and updates `filterCity` live without a remount.

### v55 — Globe also reachable from reels filter
- On `/discover` and `/reels` the Navbar is hidden (CLAUDE.md "Reels-only locked" rule, v20). So the globe was unreachable inside the reel feed.
- Fix: the reels FilterSheet's Location section now has a **mini-globe launcher** above the quick-pick city pills. Tapping it opens the same shared `LocationGlobeModal`. The pick writes `sb_city` + fires `sb:city-change`, which the feed already listens to, so `filterCity` updates instantly without re-mounting the feed.

### v56 — Reel fullscreen reliability + performance hardening
- **`useReelFullscreen()` hook** ([lib/useReelFullscreen.ts](lib/useReelFullscreen.ts)) — replaces the old inline `is-reel-page` body-class effect.
  - **Root cause of "kabhi fullscreen kabhi nahi"**: Android Chrome / Samsung Internet still leave 8–20px of phantom space at the bottom even with `100dvh` because the URL bar's collapsed/expanded state isn't always reflected in the dynamic viewport unit. iOS Safari ignores `requestFullscreen()` on non-`<video>` elements entirely. And stale SW chunks could serve old HTML missing the `is-reel-page` class.
  - **Fix**: Read REAL viewport height from `window.visualViewport.height` (iOS 13+ / Chrome 61+) and write it to CSS var `--reel-vh`. The reel CSS in `globals.css` reads `var(--reel-vh, 100dvh)` instead of `100dvh`. Re-read on `resize`, `scroll`, `fullscreenchange`, `orientationchange` so the lock survives URL-bar appear/disappear in real time.
  - Best-effort `requestFullscreen()` is still attempted on first user gesture (works on Android Chrome / Firefox; iOS Safari silently no-ops, which is fine — the visualViewport-driven lock alone is enough).
  - Verified live in preview: `--reel-vh: 642px` matches `visualViewport.height: 642px` exactly; resize to 375×812 → `--reel-vh: 812px` instantly.
- **Dynamic-imported `InstagramHotelFeed`** in [app/discover/page.tsx](app/discover/page.tsx) — the 2300-line component used to be in the initial bundle. Now it loads after first paint via `next/dynamic({ ssr: false })`. Page topbar + loading spinner appear ~300ms faster on cold start.
- **Cross-mode prefetch** for Explore↔Compare swap:
  - `/discover` `useEffect(() => { router.prefetch("/hotels") }, [])` warms up the Compare destination.
  - `/hotels` does the reverse for the ✨ Explore chip.
  - `ModeToggle` ([components/ModeToggle.tsx](components/ModeToggle.tsx)) also prefetches `/discover` on mount + uses `<Link prefetch>` so first-tap is instant from any page.
- **Service-worker rewrite** ([public/sw.js](public/sw.js)) — clean, production-grade caching:
  - HTML navigations → **network-first w/ 2.5s timeout**, cache fallback. Users instantly see new code; offline still works.
  - `/_next/static/` hashed chunks → **cache-first** (immutable URLs).
  - `/api/` + `/_next/data/` → **network-only** (deals/prices must be fresh).
  - Everything else → **stale-while-revalidate**.
  - `skipWaiting` + `clients.claim` on install; on activate, delete every cache that isn't the current `CACHE_NAME`.
- **Layout startup script tuned** ([app/layout.tsx](app/layout.tsx)):
  - Version-mismatch reload only fires if a **stale** `sb_build` is detected. First visits don't reload anymore (was costing ~300ms of nothing).
  - SW registration deferred to `requestIdleCallback` (Safari fallback: `setTimeout` 1.5s) so it doesn't compete with main-thread work during initial render.
- **Vercel build fixes shipped on top of v53–v55**:
  - `fix(flash-deals api): Array.from(map.keys()).forEach` — `for..of MapIterator` was failing without `downlevelIteration`.
  - `fix(deps): add @types/react-dom` — `LocationGlobePicker.tsx` imports `createPortal` from `react-dom`; package.json was missing types.

### Files added (this era)
```
app/flash-deals/page.tsx                        # full rewrite — premium v53 UI
components/LocationGlobePicker.tsx              # shared globe modal — Navbar + reels both use
lib/useReelFullscreen.ts                        # visualViewport-driven fullscreen hook (v56)
```

### Files modified (this era)
```
app/api/flash/near/route.ts                     # one-deal-per-hotel + upgrade ladder + live availability
app/hotels/page.tsx                             # `hydrated` guard, sb:city-change listener, /discover prefetch
app/flash-deals/page.tsx                        # also wired to sb:city-change + hydrated guard
app/discover/page.tsx                           # useReelFullscreen hook, dynamic-import feed, /hotels prefetch
app/reels/page.tsx                              # useReelFullscreen hook
app/globals.css                                 # `.is-reel-page` uses var(--reel-vh) instead of 100dvh
app/layout.tsx                                  # SB_BUILD v56, deferred SW reg, smarter version-mismatch check
components/Navbar.tsx                           # imports shared LocationGlobeModal (524 inline lines removed)
components/ModeToggle.tsx                       # prefetch + <Link prefetch> on render
components/discover/InstagramHotelFeed.tsx      # sb:city-change subscribe, globe launcher in FilterSheet
public/sw.js                                    # network-first HTML, cache-first chunks, SWR rest
package.json                                    # +@types/react-dom devDep
```

### Service-worker version map (continued)
- v50 → ultra-luxury-calendar
- v51 → calendar-on-every-date-picker
- v52 → context-aware-calendar
- v53 → flash-deals-live-premium (one deal per hotel)
- v54 → globe-location-picker (animated picker + cross-page reactive city filter)
- v55 → globe-in-reels-filter (reels FilterSheet uses shared globe)
- **v56 → perf-fullscreen (current)** — useReelFullscreen, dynamic feed import, cross-mode prefetch, hardened SW

### Things to Avoid (Flash Deals + Performance Era)
- **Never** read viewport height with `window.innerHeight` directly on `/discover` or `/reels` — always read `getComputedStyle(html).getPropertyValue('--reel-vh')` or use `100dvh` as a final fallback. innerHeight is wrong while the URL bar is transitioning.
- **Never** call `requestFullscreen()` from `useReelFullscreen` outside a user gesture handler — it'll silently reject. The hook attaches a one-time `touchstart`/`click` listener to handle this correctly.
- **Never** add per-route inline `is-reel-page` toggles again — use the shared hook so any change to fullscreen behaviour stays in one place.
- **Never** revert the SW to a cache-first strategy for HTML — that's exactly what caused "kabhi fullscreen kabhi nahi" before. Cache-first HTML serves outdated `/discover` markup missing the latest `--reel-vh` wiring.
- **Never** show multiple flash deals for the same hotel — the dedup happens in `/api/flash/near`. If you ever bypass the dedup, the customer sees N near-identical cards and the upgrade-ladder UX breaks.
- **Never** use `for..of map.keys()` / `for..of set.values()` in API routes — `tsconfig` doesn't enable `downlevelIteration`. Use `Array.from(...).forEach()`.
- **Never** import from `react-dom` without verifying `@types/react-dom` is in `package.json` — Vercel's strict TS check will fail the build (we hit this on v55).
- **Never** strip the `sb:city-change` event listener from `/hotels`, `/flash-deals`, or `InstagramHotelFeed` — they're the live filter pipeline. Without them, the globe picker writes `sb_city` but nothing visibly changes.
- **Never** mount `LocationGlobeModal` inside a `position: fixed` ancestor that has `backdrop-filter` or `transform` — it'll be trapped inside that ancestor's stacking context. Always portal to `document.body` (the shared component already does this).

---

## Instagram-Fast + Crown Dialer Era (v57 → v61, May 2026)

Five rapid iterations turning the app from "slow open + flaky fullscreen + busy bottom dock" into "tap-icon → reel feed in <500ms + bulletproof mobile fullscreen + Apple-Watch-crown nav".

### v57 — Instagram-fast app open
- **SW HTML stale-while-revalidate** — repeat visits hit cache in ~30ms; network refresh happens in background. Was network-first w/ 2.5s timeout (always blocked). This is THE big win: app feels native.
- **Killed `/` → `/discover` 307 redirect** — `app/page.tsx` now renders DiscoverPage directly. Single HTTP round-trip instead of two.
- **Inline critical CSS in `<head>`** ([app/layout.tsx](app/layout.tsx)) — dark `#07060e` bg + spinner ship before JS hydrates. Zero FOUC.
- **Theme color matched to feed** — was `#0a0f23` navy (clashed); now `#07060e`. OS status-bar / app-switcher chrome blends seamlessly.
- **PWA manifest `display: "fullscreen"`** (was `"standalone"`) + `display_override: ["fullscreen", "standalone", "minimal-ui"]` fallback chain. Installed PWA gets true edge-to-edge fullscreen.
- **URL-bar collapse trick** — `window.scrollTo(0, 1)` on DOMContentLoaded + load forces Android Chrome / Samsung Internet to collapse the URL bar before `useReelFullscreen()`'s body-lock kicks in.
- **`<html class="sb-pwa">`** added when `matchMedia('(display-mode: fullscreen | standalone)')` matches — so future code can target installed PWAs.

### v58 — Floating dock (interim)
Bottom-bar redesign with iOS-dock magnification + gold FAB centre + active glow halo. **Replaced in v59** by the left-edge dialer, but the v58 CSS techniques (backdrop-filter glass, animated pulse rings) carried forward.

### v59 — Left-edge dialer wheel (first iteration)
- **`components/DialerNav.tsx`** — iPod click-wheel UX on left screen edge.
- Closed pill (active icon + dots) → tap → expanded wheel with rotateX-perspective arc.
- Drag vertical / mouse wheel → rotates items past 3-o'clock selection.
- Tap centre → navigate. Tap outside / ✕ → close.
- Bottom dock removed entirely; `body padding-bottom: 84px` dropped. Mobile content flows edge-to-edge.

### v60 — Apple-Watch-crown rewrite (no chrome)
- **NO container background, NO border** — wheel chrome is invisible; only round buttons are visible UI.
- **Wheel mostly off-screen** — centre at `x: -78px`, radius 110, only **32 px protrudes**. Items past ±90° are literally behind the wheel.
- **NO close (✕) button** — after 1s of no touch, `active` flips false, wheel auto-dims.
- **Whole wheel never zooms on tap** — only individual items grow via `cos(angle)`-driven scale as they rotate IN AND OUT of the 3-o'clock slot. Tap is purely for navigation.
- Drag-anywhere on the wake-zone strip works (no need to grab a specific button).
- Wheel scroll on desktop trackpad supported with auto-snap-after-pause.

### v61 — Smooth glass dialer with use-case labels
- **Slower drag**: `DRAG_PX_PER_ITEM` 40 → 80 — more deliberate, smoother.
- **Smoother snap**: `SNAP_MS` 320 → 480 with softer `cubic-bezier(.32, 1.2, .36, 1)`.
- **Glassmorphism buttons** — `backdrop-filter: blur(12px) saturate(140%)` + translucent gradient + inset highlight. Live floating-glass depth, not flat solid circles.
- **`useCase` field on every nav item**:
  - Home → "your stays"
  - Hotels → "browse stays"
  - Reels → "watch hotel reels"
  - Deals → "live flash sales"
  - Bid → "name your price"
  - Profile → "your account"
- **Floating label chip** (`.dialer-label`) beside the centred button — bold gold name + light grey use-case. Fades in on active, fades out on idle. First-time users instantly understand the dial.
- **True auto-hide** — whole dialer drops to `opacity: 0.42` when idle (was 1.0). Smooth 0.55s fade. Centre-item breathing-glow animation only runs while active.
- **Anti-overlap fix** — `.dialer-root` has `pointer-events: none`. Only the invisible `.dialer-wake-zone` (48px-wide rim strip) + the round buttons themselves catch touches. Content elsewhere on the screen edge flows through cleanly.
- **`aria-label="Home — your stays"`** for screen-reader users.

### Files added (this era)
```
lib/useReelFullscreen.ts            # visualViewport-driven height var
components/DialerNav.tsx            # left-edge crown wheel (v59 → v60 → v61)
```

### Files modified (this era)
```
app/layout.tsx                      # critical CSS, URL-bar collapse, SB_BUILD,
                                     # SW reg deferred to requestIdleCallback,
                                     # mounts <DialerNav /> globally
app/page.tsx                        # killed redirect — now renders DiscoverPage directly
app/discover/page.tsx               # useReelFullscreen hook, dynamic-import feed,
                                     # /hotels prefetch
app/reels/page.tsx                  # useReelFullscreen hook
app/globals.css                     # `.is-reel-page` uses var(--reel-vh)
app/hotels/page.tsx                 # hydrated guard, sb:city-change listener, prefetch
app/flash-deals/page.tsx            # hydrated guard, sb:city-change listener
components/Navbar.tsx               # hide on `/` too (renders DiscoverPage), bottom dock removed
components/ModeToggle.tsx           # router.prefetch on mount + <Link prefetch>
components/discover/InstagramHotelFeed.tsx  # sb:city-change subscribe, globe in FilterSheet
components/LocationGlobePicker.tsx  # removed autoFocus (no auto-keyboard)
public/sw.js                        # network-first HTML → SWR HTML (v57)
public/manifest.json                # display: fullscreen + display_override
package.json                        # +@types/react-dom
```

### Service-worker version map (continued)
- v53 → flash-deals-live-premium
- v54 → globe-location-picker
- v55 → globe-in-reels-filter
- v56 → perf-fullscreen
- v57 → instagram-fast (SWR HTML, killed redirect, critical CSS)
- v58 → floating-dock (interim bottom-dock redesign)
- v59 → dialer-wheel (left-edge click-wheel, removed bottom dock)
- v60 → crown-dialer (no chrome, no close X, auto-dim)
- **v61 → smooth-glass-dialer (current)** — slower drag, glass buttons, use-case labels, true auto-hide

### Architecture summary (current production)
- **Bottom dock**: gone. Mobile nav lives on the left edge as `<DialerNav />`, mounted in `app/layout.tsx`.
- **Top Navbar**: hidden on `/` (DiscoverPage), `/discover`, `/reels`, `/partner/*`, `/admin/*`, `/onboard/*`. Visible elsewhere.
- **DialerNav hidden on**: `/admin/*`, `/partner/*`, `/onboard/*`. Visible everywhere else (including `/`, `/discover`, `/reels`).
- **City filter pipeline (v54)**: globe picker writes `sb_city` + fires `sb:city-change` → /hotels, /flash-deals, /discover all subscribe and re-filter live.
- **Reel-page fullscreen (v56-v57)**: `useReelFullscreen()` writes `--reel-vh` from `visualViewport.height` + manifest fullscreen + URL-bar collapse trick. Bulletproof across iOS Safari, Android Chrome, Samsung Internet, installed PWA.
- **SW (v57)**: network-only `/api/`, cache-first hashed chunks, **SWR HTML**, SWR images/fonts. Repeat visits open instantly.

### Things to Avoid (Crown Dialer Era)
- **Never** put `pointer-events: auto` on `.dialer-root` again — content beneath the 48px-wide left-edge strip needs to flow through. Touches are intentionally limited to `.dialer-wake-zone` + the round buttons themselves.
- **Never** mount the bottom dock back. The user explicitly rejected it — DialerNav replaces all primary nav on mobile.
- **Never** put a close (✕) button on the dialer wheel — the `active` flag auto-dims after `IDLE_MS` and that's the closing UX. Adding a close button violates the "auto-hide type" feedback (v60 user note).
- **Never** zoom the entire wheel on tap. Only individual items scale via `cos(angle)`-driven CSS — that's what creates the "button grows as it rotates to centre" feel without any container animation.
- **Never** rotate items with high sensitivity (`DRAG_PX_PER_ITEM < 60`) — that re-introduces the "too fast" feedback from v59-v60. 80 is the calibrated minimum for the slow, smooth feel.
- **Never** drop the use-case sublabels from the items — they're the entire UX for "what does each button do". Without them, first-time users have to memorize emoji meanings.
- **Never** redirect `/` to `/discover` — both should serve the same `DiscoverPage` component directly. The redirect adds a wasted HTTP round-trip and a navbar-hide check race.
- **Never** revert SW to network-first HTML — warm visits would slow back to ~400ms instead of ~30ms.

---

## Bidding Lifecycle Era (v65 → v72, May 2026)

Eight phases shipped back-to-back addressing the user's original 8-paragraph spec covering bid pricing correctness, premium UX, Hold payments, smart auto-accept, in-app notifications, server-side persistence, admin controls, and post-booking chat. Every customer flow from "tap Negotiate" to "checkout day" is now wired end-to-end with cross-device persistence + admin observability.

### v65 — Bid price correctness + premium Negotiate UI
**Commit:** `89f708d` — `feat(bid): correct customer-bid display + premium Negotiate UI`

**The bug fix.** Below-floor bids are forcibly submitted at `floorPrice` (backend rejects below-floor), so `bid.amount` in DB never matched what the customer actually bid. The customer's real intent is preserved in the message token `"Guest's preferred price: ₹X/night..."`. New helpers in [lib/paid-amount.ts:21](lib/paid-amount.ts:21):
- `extractCustomerBidFromMessage(msg)` — parses preferred price from the token
- `resolveBidDisplayAmount(bid)` — priority: counterAmount → message preferred → server paidPerNight → bid.amount

My Bids "Your Bid" tile, Pay-Now total, and Bookings display now show what the customer **actually bid**, not floor.

**The premium UI rebuild.** Negotiate modal in [app/hotels/[id]/page.tsx:2126](app/hotels/[id]/page.tsx:2126) — full casino-grade rebuild:
- 🔴 LIVE pulsing pill + ⚡ AI BIDDING ARENA header
- Animated SVG **probability ring** (smooth fill, color shifts red → green by match %)
- **Slot-machine number** with gold-shimmer reveal on every change
- **Glowing rainbow slider** (red → amber → green gradient) with gold-halo thumb
- **🤖 LIVE AI ticker** — rotates 4 tips every 12s (recent accepts, viewer count, demand)
- **📊 Recent Accepts sparkline** (14d demand bars, peak-day highlighting from a stable per-hotel seed)
- **💎 StayPoints win-teaser**, floating particles in instant-confirm zone
- CTA flips to green "⚡ Instant Confirm" gradient when bid ≥ floor

### v66 — Booking Review screen + 24h Hold payment
**Commit:** `936e71e` — `feat(booking): Booking Review screen + 24h Hold payment system`

Every booking flow (Book Now / Flash Deal / Negotiate above-floor / Counter Accept / My Bids Pay-Now) now lands on a **unified Booking Review screen** before Razorpay charges. Customer sees full trip details + 3 payment paths:

- ✨ **Pay Full** — instant confirm
- 🔒 **Hold for 24h** — pay tiered hold amount, lock the price for a day
- 🏨 **Pay Hold + Settle at Hotel** — pay hold online, balance at desk

**Hold tier defaults** (by total booking amount):
| ≤ ₹2K | ₹2K-5K | ₹5K-10K | ₹10K-15K | ₹15K+ |
|-------|--------|---------|----------|-------|
| ₹99 | ₹199 | ₹299 | ₹399 | ₹499 |

**New files:**
- [lib/hold-amount.ts](lib/hold-amount.ts) — `computeHoldAmount`, `holdExpiresAt`, `saveHoldState`, localStorage persistence
- [components/BookingReview.tsx](components/BookingReview.tsx) — shared review modal with `onPayFull` / `onHold` / `onPayAtHotel` callbacks

**Hold banner** in /bookings with live HH:MM:SS countdown + "Pay Balance" CTA. 3 states: active (countdown + Pay Balance green CTA), expired (red dismissable), pay-at-hotel (gold info banner).

### v67 — Smart timing + Auto-cancel + Notifications
**Commit:** `b44f2a6` — `feat(bid): smart timing + auto-cancel countdown + in-app notifications`

Three systems landing together:

**1. Bidder Tier** — Negotiate modal shows customer's historical bid quality + expected auto-accept window. Score = avg(bid/floor) across last 10 bids. [lib/bidder-score.ts](lib/bidder-score.ts):

| Tier | Threshold | Auto-accept ETA |
|------|-----------|-----------------|
| 👑 PREMIUM | ≥ 0.95 | ~30s instant |
| ⭐ STRONG | 0.90-0.95 | ~1-3 min |
| ✨ SMART | 0.85-0.90 | ~3-5 min |
| 🎯 CAUTIOUS | 0.78-0.85 | ~5-12 min (doubled per spec) |
| ⚠ LOWBALL | < 0.78 | Manual hotel review only |

**2. Accepted-bid auto-cancel timer** — 15 min countdown after hotel accepts. At 5 min remaining → sticky warning toast fires. At 0 → marked cancelled locally + toast. [lib/auto-cancel.ts](lib/auto-cancel.ts), [components/AcceptedBidTimer.tsx](components/AcceptedBidTimer.tsx).

**3. Global notification toaster** — `window.dispatchEvent(new CustomEvent("sb:notify", {detail}))` pattern. [lib/notifications.ts](lib/notifications.ts) + [components/NotificationToast.tsx](components/NotificationToast.tsx) (mounted in layout). 5 lifecycle kinds: `bid_accepted` / `bid_countered` / `bid_rejected` / `bid_auto_cancelled` / `bid_expiring_soon`. Bridges to browser Notification API when tab is hidden. My Bids polling diffs status transitions and auto-fires the right toast.

### v68 — Admin Hold Config + Supabase persistence
**Commit:** `047aa39` — `feat(hold): admin Hold Config page + Supabase persistence`

Moves Hold-payment from localStorage MVP to fully configurable + cross-device-persistent.

**DB tables added:**
- `hotel_hold_config(hotel_id PK, hold_enabled, pay_at_hotel_enabled, tier_overrides JSONB, acceptance_window_min)` — special row `hotel_id="_global_defaults"` holds platform defaults
- `bid_holds(bid_id PK, hotel_id, customer_id, hold_amount, balance_due, total_amount, hold_payment_id, balance_payment_id, expires_at, status, flow, pay_at_hotel, check_in/out, room_type, hotel_name)`

**API routes added:**
- `GET/POST/DELETE /api/admin/hold-config` — admin CRUD
- `GET /api/hotel-hold-config?hotelId` — public read, cached 2 min
- `GET/POST /api/holds` + `POST /api/holds/[bidId]/balance`

**Admin page:** `/admin/hold-config` with global defaults pinned + per-hotel override cards. Edit modal has toggle switches, inline tier editor (Add/Remove/Reset to defaults), acceptance-window input. Search-by-name overlay for adding new hotel overrides.

**Frontend wiring:**
- `saveHoldState` now mirrors to `/api/holds` (non-blocking)
- `hydrateHoldsFromServer()` on /bookings mount merges remote into localStorage
- `BookingReview` accepts `holdTiers` prop — per-hotel tiers actually used
- Hotel page fetches `/api/hotel-hold-config?hotelId=...` once on load, passes resolved config to all 5 `setReview()` call sites

### v69 — Server-side lifecycle + admin Holds dashboard + cron
**Commit:** `cb63bee` — `feat(hold): server-side lifecycle + admin Holds dashboard + cron`

**DB additions:**
- `bid_acceptance_windows(bid_id PK, hotel_id, customer_id, accepted_at, expires_at, warned_at, status, acceptance_window_min)`
- RPC `mark_expired_holds()` (SECURITY DEFINER) — sweeps both `bid_holds` + `bid_acceptance_windows`, marks expired rows

**API routes added:**
- `/api/acceptance-windows` GET/POST/PATCH (warned|paid|cancelled)
- `/api/admin/holds` GET (filters + KPIs) / PATCH (force_expire/complete/cancel)
- `/api/cron/expire-holds` GET/POST — calls the RPC. Auth via `?token=` (matches existing crons), Vercel Bearer secret, OR `x-admin-token` from admin page.

**Vercel cron (`vercel.json`):** `/api/cron/expire-holds?token=staybid-cron-dev` every 5 min (`*/5 * * * *`).

**Frontend wiring:**
- `startAcceptanceWindow(bidId, acceptedAt, windowMin, {hotelId})` mirrors to backend
- `hydrateAcceptanceWindowsFromServer()` on My Bids mount
- `markWarned`/`markCancelled`/`markPaid` PATCH backend non-blocking
- `AcceptedBidTimer` accepts `hotelId` + `windowMin` props; self-fetches hotel's `acceptance_window_min` from `/api/hotel-hold-config` when not passed
- Hotel with 10/15/30 min acceptance window shows correctly-sized countdown ring

**Admin dashboard `/admin/holds`:** 6 KPI cards (Active / ₹ Locked / ₹ Booking Total / Expiring 24h / Completed / Expired) + status filter pills + search + table with force actions (✓ complete · ⏰ expire · ✕ cancel) + "⚡ Run cron now" button + Active acceptance windows summary panel.

### v70 — Smart auto-accept lifecycle
**Commit:** `c03e8ef` — `feat(bid): smart auto-accept lifecycle with tier-based delays`

**The big behavioral change.** Before v70: above-floor bids → Razorpay paid → **instant accept** (no hotel window). After v70: above-floor bids → Razorpay paid → bid scheduled with tier-based `auto_accept_at`. Hotel has the window to counter/reject before cron auto-flips to ACCEPTED.

**DB changes:**
- `bids.auto_accept_at TIMESTAMPTZ` (nullable; only set on above-floor bids)
- `bids.bidder_tier TEXT` (cached customer tier at bid time)
- Index `bids_auto_accept_pending_idx` on (auto_accept_at) WHERE status='PENDING'
- RPC `auto_accept_eligible_bids()` flips PENDING → ACCEPTED past `auto_accept_at`. LOWBALL bids have NULL → never auto-accept.
- `mark_expired_holds()` extended to ALSO run the auto-accept sweep — one cron does holds + windows + bids.

**API routes added:**
- `/api/bids/[id]/schedule-accept` POST — records `auto_accept_at` + `bidder_tier` after Razorpay
- `/api/bids/[id]/trigger-accept` POST — client-side flip when countdown hits 0 (idempotent, validates window reached)
- `/api/bids/auto-accept-info?ids=` GET — side-channel fetch since Railway/Prisma `/api/bids/my` doesn't include new columns

**Why side-channel?** `bids` table is shared between Supabase + Railway/Prisma. New columns exist in DB but Railway's typed select doesn't include them until Prisma is regenerated. Workaround: My Bids enriches the regular bids list with this Supabase-side fetch. Zero Railway changes required.

**Frontend:**
- `executeNegotiate` (above-floor path) no longer calls `api.acceptBid` instantly — POSTs `schedule-accept` with tier + autoAcceptMs from bidder-score
- Success modal: "Bid Submitted" instead of "Booking Confirmed" for non-PREMIUM
- [components/AutoAcceptCountdown.tsx](components/AutoAcceptCountdown.tsx) — live MM:SS chip + tier badge (👑/⭐/✨/🎯). Fires `trigger-accept` exactly once when timer hits 0.

**Admin holds dashboard:** new "⚡ Pending auto-accepts" panel — live countdowns + tier badges + amounts + "running cron…" indicator for overdue rows.

**Booking flows unaffected:** Book Now / Flash Deal / Counter Accept still instant-accept (no negotiation lifecycle).

### v71 — Booking-flow chat + auto-accept email
**Commit:** `b4cfc01` — `feat(chat): booking-flow chat + auto-accept email`

**1. Auto-accept confirmation email** — `/api/bids/[id]/trigger-accept` fires email asynchronously after flipping ACCEPTED. Reads user email + hotel + room + dates from Supabase and POSTs to existing `/api/email/confirm`.

**2. Booking-flow chat** — customer ↔ hotel coordination for confirmed bookings (anti-bypass v25 rule allowed post-confirmation chat).

**DB:** `booking_messages(id, bid_id, hotel_id, customer_id, sender, sender_id, body, read_at, hidden_at, created_at)` with indexes on (bid_id, created_at) + unread filter.

**Shared lib:** [lib/sanitize-text.ts](lib/sanitize-text.ts) extracted from InstagramHotelFeed.tsx (v25 anti-bypass guard). Same rule applies on every chat message — phone/email/URL/WhatsApp/"DM me" etc. masked to `•••••`. Trip-coordination messages ("early check-in?") pass cleanly.

**API:** `/api/booking-messages` GET (list) / POST (send) / PATCH (markRead). Customer auth via `sb_token` Bearer; hotel auth via `x-partner-token` + `x-partner-hotel-id` headers. Gated to status ∈ {ACCEPTED, CONFIRMED, CHECKED_IN, CHECKED_OUT}.

**Component:** [components/BookingChat.tsx](components/BookingChat.tsx) — single component for both sides. `mode="customer"` vs `mode="hotel"` props control auth + bubble alignment. Customer bubbles right (gold gradient), hotel bubbles left (white). 1000-char limit, 15s polling, optimistic send, anti-bypass warning toast.

**Wiring:**
- Customer side: `/bookings` renders `<BookingChat>` inside every confirmed card. "💬 Message {Hotel}" collapsible.
- Hotel side: `/partner/dashboard` selectedBooking modal renders `PartnerBookingChat` (wrapper that pulls `sb_partner_token` from localStorage). Lives under Call/WhatsApp buttons.

### v72 — Bidding Analytics + Chat Moderation + cron emails
**Commit:** `d44ef76` — `feat(admin): bidding analytics + chat moderation + cron emails`

**1. Bid Analytics dashboard** `/admin/analytics`:
- Range picker 7d / 30d / 90d
- **6 hero KPIs**: bids placed · accept rate · auto-accept hit · hold conversion · revenue · avg time-to-accept
- Daily bid trend chart (recharts line, 30-day buckets)
- Bidder tier distribution bars (PREMIUM..LOWBALL + NEW + UNKNOWN)
- Hold lifecycle 6-grid (total/active/completed/expired/pay-at-hotel/conversion)
- Acceptance window 5-grid (total/active/paid/expired/payRate)
- Revenue by booking flow breakdown
- Top 10 hotels by acceptance rate (min 3 bids to qualify)
- Single endpoint `/api/admin/analytics/bidding?days=30` parallel-fetches bids + holds + windows + paid_amounts + hotels; derives all metrics in memory.

**2. Chat moderation** `/admin/messages`:
- Lists every conversation in `booking_messages` grouped by bid_id
- Hotel ↔ customer + last message preview + counters
- 🚩 **Flagged only** toggle filters conversations with `•••••` placeholders
- Search by body / bid id
- Side drawer expands full conversation (incl. hidden ones) with Hide/Unhide per message
- Hidden messages stay in DB (audit trail) but disappear from customer/hotel views (public GET filters them out)
- `/api/admin/messages` GET (list / single) + PATCH (hide/unhide)

**3. Cron-side confirmation emails** — `/api/cron/expire-holds` now also sweeps bids accepted in the last 6 min and POSTs to `/api/email/confirm` for each. Closes the gap from v71 where only the customer-visible trigger-accept fired email. Response includes `emails_sent` count.

**4. Sanitizer cleanup** — `components/discover/InstagramHotelFeed.tsx` now imports `sanitizeText` from `lib/sanitize-text.ts` instead of its inline copy. Single source.

**Sidebar v68→v72 additions:**
```
🔒 Hold Config       (v68)
⏱  Active Holds      (v69)
📊 Bid Analytics     (v72)
💬 Chat Moderation   (v72)
```

### New Supabase tables (this era — all live in production DB)

| Table | Era | Purpose |
|-------|-----|---------|
| `hotel_hold_config` | v68 | Global defaults + per-hotel hold overrides (tier_overrides JSONB, acceptance_window_min). `_global_defaults` row seeded with 99/199/299/399/499 tiers. |
| `bid_holds` | v68 | Persistent hold state per bid. status: active/completed/expired/cancelled. Cross-device. |
| `bid_acceptance_windows` | v69 | 15-min-to-pay timer state per accepted bid. Replaces localStorage. |
| `booking_messages` | v71 | Customer ↔ hotel chat. `hidden_at` for admin moderation. |
| `bids` (existing) | v70 | New cols: `auto_accept_at`, `bidder_tier` |

### New Supabase RPCs

- `mark_expired_holds()` — single sweep: expires holds + windows + auto-accepts eligible bids. Returns `{ holds_expired, windows_expired, bids_accepted, ran_at }`. Cron + manual admin trigger.
- `auto_accept_eligible_bids()` — standalone variant (kept for granular calls).

### New API routes (this era)
```
/api/admin/analytics/bidding          (v72) — full lifecycle aggregation
/api/admin/hold-config                (v68) — GET list / POST upsert / DELETE override
/api/admin/holds                      (v69) — GET filtered + KPIs / PATCH force actions
/api/admin/messages                   (v72) — GET conversations / single / PATCH hide-unhide
/api/acceptance-windows               (v69) — GET/POST/PATCH
/api/bids/[id]/schedule-accept        (v70) — POST tier + autoAcceptMs
/api/bids/[id]/trigger-accept         (v70) — POST client-side flip + email
/api/bids/auto-accept-info?ids=       (v70) — GET side-channel for new bid cols
/api/booking-messages                 (v71) — GET/POST/PATCH chat
/api/cron/expire-holds                (v69+) — POST RPC + cron emails (v72)
/api/holds                            (v68) — GET user holds / POST create
/api/holds/[bidId]/balance            (v68) — POST balance settled marker
/api/hotel-hold-config?hotelId=       (v68) — GET resolved config (cached 2 min)
```

### New components (this era)
```
components/AcceptedBidTimer.tsx       (v67) — 15-min countdown ring + warning popup
components/AutoAcceptCountdown.tsx    (v70) — pre-accept tier-based countdown chip
components/BookingChat.tsx            (v71) — customer + hotel chat (mode prop)
components/BookingReview.tsx          (v66) — shared review modal with 3 payment paths
components/NotificationToast.tsx      (v67) — global stacked toaster
```

### New libs (this era)
```
lib/auto-cancel.ts        (v67/v69) — acceptance window state + backend mirroring + countdown helpers
lib/bidder-score.ts       (v67) — 5-tier history scoring + autoAcceptMs
lib/hold-amount.ts        (v66/v68) — tier helper + saveHoldState + hydrateHoldsFromServer
lib/notifications.ts      (v67) — notify() + onNotify() + browser Notification permission
lib/sanitize-text.ts      (v71) — shared anti-bypass sanitizer (CONTACT_PATTERNS)
```

### New admin pages (this era)
```
/admin/hold-config        (v68) — global defaults + per-hotel override editor
/admin/holds              (v69) — active holds dashboard + force actions
/admin/analytics          (v72) — bid lifecycle KPIs + charts + top hotels
/admin/messages           (v72) — chat moderation with hide/unhide
```

### New localStorage keys (this era)
| Key | Value | Purpose |
|-----|-------|---------|
| `hold_state_{bidId}` | JSON `HoldState` | 24h hold record (mirrored to /api/holds in v68+) |
| `accept_window_{bidId}` | JSON `AcceptedBidWindow` | 15-min countdown state (mirrored to backend v69+) |
| `sb_seen_notifications_v1` | JSON `{id: ts}` | Dedup map for notification triggers; pruned at 7 days |

### Service-worker version history (continued)
- v62-v64 → nav/dialer iterations
- **v65** → bid-fix-premium-negotiate
- **v66** → booking-review-hold-payment
- **v67** → smart-timing-notifications
- **v68** → admin-hold-config-supabase
- **v69** → hold-lifecycle-admin-dashboard
- **v70** → smart-auto-accept
- **v71** → booking-chat-auto-accept-email
- **v72** → analytics-moderation **(current)**

### Vercel cron (`vercel.json`) — current state
```json
{
  "crons": [
    { "path": "/api/cron/pricing?token=staybid-cron-dev",       "schedule": "0 4 * * *"   },
    { "path": "/api/cron/lifecycle?token=staybid-cron-dev",     "schedule": "5 4 * * *"   },
    { "path": "/api/cron/expire-holds?token=staybid-cron-dev",  "schedule": "*/5 * * * *" }
  ]
}
```
Free Vercel plan caps at 2 crons — if hitting that limit drop `lifecycle` (it's a once-a-day report task; admin can run manually) or upgrade to Hobby/Pro.

### Architecture summary (post-v72)

**Bid lifecycle (above-floor):**
1. Customer places bid via Negotiate modal → Booking Review opens
2. Customer picks Pay-Full / Hold-24h / Pay-at-Hotel
3. Razorpay charges → bid saved + `auto_accept_at` scheduled via `/api/bids/[id]/schedule-accept` (using tier from `bidderScore`)
4. Customer redirected to My Bids → sees `AutoAcceptCountdown` chip
5. Two paths to acceptance:
   - **Watching tab**: Timer hits 0 → `/api/bids/[id]/trigger-accept` fires → bid flips ACCEPTED + email sent → notification toast
   - **Tab closed**: Vercel cron runs every 5 min → RPC `mark_expired_holds()` flips all eligible bids ACCEPTED → cron endpoint follow-up sweep sends confirmation emails
6. ACCEPTED bid → 15-min acceptance window starts → customer pays Razorpay full/balance → booking confirmed
7. Confirmed booking → `<BookingChat>` opens on /bookings card for trip coordination

**Hold lifecycle (24h):**
1. Customer picks Hold at Booking Review → Razorpay charges tiered hold amount only
2. `bid_holds` row written via `/api/holds` with `expires_at = now() + 24h`
3. `/bookings` shows live countdown banner with "Pay Balance" CTA
4. Two outcomes:
   - Customer pays balance → `/api/holds/[bidId]/balance` flips status=completed
   - 24h passes unpaid → cron RPC flips status=expired (admin can also force from `/admin/holds`)

**Admin observability:**
- `/admin/analytics` → all KPIs in one view
- `/admin/holds` → real-time active hold + window state with force-action overrides
- `/admin/hold-config` → tune tier defaults + per-hotel toggles
- `/admin/messages` → chat moderation with hide/unhide

### Things to Avoid (Bidding Lifecycle Era)
- **Never** restore the instant `api.acceptBid` call in `executeNegotiate` above-floor path. The whole v70 system depends on bids being PENDING with `auto_accept_at` scheduled — instant accept skips the hotel-intervention window entirely.
- **Never** edit `bid.amount` directly in DB to "fix" a below-floor mismatch. The customer's actual bid lives in the message token; `bid.amount` is the floor on purpose (backend rejects below-floor without dealId). Use `resolveBidDisplayAmount` everywhere.
- **Never** show a Hold option on a booking flow that doesn't accept it — always pass `holdEnabled` / `payAtHotelEnabled` / `holdTiers` from the per-hotel config to `BookingReview`.
- **Never** call `markWarned` more than once per bid — it's idempotent in localStorage but the 5-min warning notification will fire repeatedly otherwise. The `warnedAt` field gates the trigger.
- **Never** strip the `•••••` placeholder check from chat moderation — that's how "🚩 Flagged" surfaces work. The sanitizer puts those exact 5 chars in the body.
- **Never** add chat to PENDING bids. The whole anti-bypass v25 rule depends on gating chat behind ACCEPTED status. If you need pre-acceptance contact, route through Counter offer (which IS visible to both sides in /my-bids and /partner/dashboard).
- **Never** remove the `auto_accept_at IS NOT NULL` guard from `auto_accept_eligible_bids()` — that's what makes LOWBALL bids require manual hotel review (NULL value = skip).
- **Never** assume Railway/Prisma `/api/bids/my` returns new columns added via Supabase migration. Side-channel via `/api/bids/auto-accept-info` is the workaround until Prisma client is regenerated on Railway.
- **Never** drop the `bid.customerId` ownership check in `/api/holds` or `/api/acceptance-windows` PATCH routes — these endpoints use `userFromReq` for auth.
- **Never** schedule a hold for `pay_at_hotel: true` longer than 24h — the partner panel expects to see the customer arrive within that window. The HoldBanner UI handles the special pay-at-hotel state already.
- **Never** add a third user-facing chat surface. The pattern is: pre-booking → anti-bypass blocked (reels), post-booking → `<BookingChat>` only. Adding a "DM" or "Inbox" anywhere else reopens the off-platform bypass risk.

### MSG91 SMS OTP — paste-ready but not deployed
[docs/MSG91_BACKEND_PASTE.md](docs/MSG91_BACKEND_PASTE.md) — full step-by-step doc for wiring MSG91 SMS OTP into the Railway backend (`apps/api/src/index.ts`). Has:
- Dashboard walkthrough (Create Authkey button location, DLT template registration text, Railway env vars)
- Paste-ready code: `/auth/send-otp` + `/auth/verify-otp` with Redis 10-min TTL, 30s resend cooldown, 5-attempt lockout, JWT issuance
- ioredis + jsonwebtoken dependency install
- Test curl commands + common-error troubleshooting table

**Status as of v72:** code ready, Authkey generated by user, but **DLT template approval pending** (Indian carrier regulation, 2-5 day approval window). Sender ID dropdown was empty in user's MSG91 account because no DLT-registered header yet. Once DLT approves + Template ID arrives → paste code in Railway repo (separate from this frontend repo) + add 3 env vars → done.

Firebase Mobile OTP is **already working** for customer-side login (v44 era) — MSG91 is only needed for partner panel + admin panel OTP flows (which currently use Railway's `/api/auth/send-otp`).

---

## Updated production state (v72, 2026-05-12)
- **Current version:** v72 · commit `d44ef76` on `main` · branch `claude/bold-cohen-1c4580`
- All 8 phases of user's original spec delivered
- Hold + auto-accept + chat fully live and cross-device persistent
- Admin observability complete via 4 new admin pages
- Bidder-tier autoAcceptMs values in [lib/bidder-score.ts](lib/bidder-score.ts) are the single source of truth — both frontend countdown UI and Supabase RPC `auto_accept_eligible_bids()` read from the same scheduled `auto_accept_at` field, so frontend + backend never drift.

---

## IG-Style Discover Era (v73 → v79, May 2026)

Seven iterations turning `/discover` from a vertical reel feed with an empty user-story tray into a full Instagram-clone surface: auto-generated flash-deal "stories" with sound, premium cream-band separation between rails and reels, a horizontal bottom dock, and an IG-style `/me` profile page with a hamburger drawer that surfaces every secondary nav item.

### v73 — Real countdown + reminder notifs (pre-existing)
**Commit:** `5477201` — real HH:MM:SS countdown for unpaid ACCEPTED bids + reminder notifications. Documented in the v72 Bidding Lifecycle Era.

### v74 — Timer override stale-state fix (pre-existing)
**Commit:** `e168c5a` — fixes a stale-state edge case in the acceptance-window timer override + summary toast when many bids are unpaid. Last commit before the discover era began.

### v75 — Flash-deal stories rail + personalization + perf
**Commit:** `4ad85a4`

Replaces the empty user-uploaded story tray at the top of `/discover` with an auto-generated rail of flash-deal "stories". Every hotel with an active deal becomes one avatar; tap → fullscreen viewer with the existing direct-book URL (`?dealId=…&dealPrice=…&directBook=true`) wired into Book Now.

**Files added:**
- [components/discover/FlashDealStories.tsx](components/discover/FlashDealStories.tsx) — rail + fullscreen viewer + `useFlashDealStories(city)` hook + `markFlashDealViewed(dealId)` + helpers

**Files modified:**
- [components/discover/InstagramHotelFeed.tsx](components/discover/InstagramHotelFeed.tsx) — imports + mounts rail/viewer; `<HotelCard>` accepts `adjacent` prop; `<video preload>` tiered active="auto" / adjacent="metadata" / far="none"; `.ig-card` gets `contain: layout paint style` + `content-visibility: auto` + `contain-intrinsic-size`
- [app/api/discover/feed/route.ts](app/api/discover/feed/route.ts) — adds `±2.5` jitter on `score`, Fisher-Yates inside 8-point score bands, exploration slot frequency `5th → 4th`, `Cache-Control: no-store, must-revalidate` (was `max-age=20`). Each refresh now feels different.

### v76 — Audio on flash-deal stories + flash-deal personalization
**Commit:** `2103b7f` (build fix) + `4ad85a4` core (was reverted/squashed into this set)

Adds sound to every flash-deal story + per-viewer personalization on `/api/flash/near` so the rail order also stays fresh.

**Audio system in `FlashDealStories.tsx`:**
- 4 royalty-free peaceful SoundHelix tracks (`Piano Reflect / Open Sky / Wide Horizon / Slow Pulse`) rotated by `hashStr(hotelId) % 4` — same hotel always pairs with same track (IG-style "signature sound")
- Plays at `volume: 0.55` (foreground-friendly), auto-resets per slide advance
- Does NOT route through Web Audio — cross-origin SoundHelix mp3s would silence (documented gotcha)
- Permission gate: `🎵` upload button shown only when `sb_partner_token` OR `sb_admin_token` exists (hotel owner / admin)
- Custom audio: `<input type="file" accept="audio/*">` → `URL.createObjectURL(file)` → stored as `localStorage.sb_fdeal_audio_{dealId}`
- Cap 8MB, MIME validation, "🎵 Audio attached" mini-toast feedback
- Audio chip below title shows "🎵 Wide Horizon · ambient" or "🎵 Custom audio"

**Backend audio passthrough:**
- `normalizeFlashDeal` reads `d.audioUrl || d.audio_url || d.raw?.audioUrl || d.raw?.audio_url`
- When admin/partner panels eventually add upload UI to write `flash_deals.audioUrl`, viewer picks it up automatically (no frontend changes needed)

**Personalization in [app/api/flash/near/route.ts](app/api/flash/near/route.ts):**
- Accept `?viewed=id1,id2,...` query param (capped at 60 ids)
- Bucket deals by 5% discount bands
- Fisher-Yates shuffle inside each band so siblings rotate
- Within-band: push viewed deals to the bottom (fresh content leads)
- `Cache-Control: no-store, must-revalidate`
- Hook auto-sends `viewed` IDs from `localStorage.sb_flash_viewed_v1` (cap 30 most-recent)
- Viewer marks every opened deal viewed → next fetch surfaces unseen deals first

### v77 — Fix unmute-hint overlap with flash-deal rail
**Commit:** `d8b2528`

Real culprit of the "abhi bhi overlap" feedback after v75/v76: the per-card `.ig-tap-unmute` pill was pinned at `top: 132px` — that worked in the pre-rail layout but with the new rail (32→152px) + the v75 shifted profile chip (168→210px) it sat ON TOP of the rail. Moved to `top: 218px` then later (v78) reset to `top: 64px` once the rail moved out of the card.

Verified live: rail/chip/unmute = 32-152 / 168-210 / 213-249 px, all pairwise overlap checks `false`.

### v78 — Clean section separation + premium cream rail + Instagram bottom dock
**Commit:** `3a142eb`

User's screenshots referenced IG home feed (clean stories rail band, feed BELOW) + IG reels (no stories rail, bottom horizontal dock). v78 builds a hybrid:

**Flex shell — true separation:**
- `<div className="ig-shell">` wraps the rail + feed: `position:absolute inset:0 display:flex flex-direction:column`
- Rail = first flex child (shrinks to content ~142px)
- `.ig-feed` = `flex:1 1 auto` (fills remaining height, ~578px on mobile)
- `.ig-card` = `height: 100%` (was `100dvh` — was bleeding behind the rail)
- Result: rail and reels are two genuine horizontal lanes, zero overlap. Measured live.

**Premium cream theme on the rail:**
- `linear-gradient(180deg, #fff9ec → #f9efd6)` solid (no transparency)
- Bottom border `rgba(184,134,11,0.18)`, soft shadow
- Conic-gradient ring `#c9911a → #f0d060 → #fff4cc`, 12s slow rotation
- Cormorant Garamond italic "Flash Deals" title
- Hotel names in warm `#4a3208`
- **No red, no pink** — purely parchment + gold (user explicitly asked for "lighter premium cozy")

**Discount badge moved off the front page:**
- `.fdeal-rail-badge` deleted from JSX + CSS — front-page rail shows clean rings only
- `-X% OFF` stamp lives ONLY inside the fullscreen `.fdeal-viewer-stamp`

**Instagram-style BottomDock** ([components/discover/BottomDock.tsx](components/discover/BottomDock.tsx)):
- 5 slots: ⌂ Home / ▷ Reels / ◎ Bid / ⌕ Hotels / ○ You
- Fixed bottom, blurred glass (`rgba(7,6,14,0.88)` + 18px blur)
- Active slot lights up gold
- Self-hides on every route except `/`, `/discover`, `/reels`, `/me`
- Mounted globally in [app/layout.tsx](app/layout.tsx) alongside `<DialerNav />`

**DialerNav hide gate** extended in [components/DialerNav.tsx](components/DialerNav.tsx):
- Was: hide on `/admin`, `/partner`, `/onboard`
- Now: also `/`, `/discover`, `/reels`, `/me` — the dock owns those routes
- DialerNav still owns every other page (the crown-wheel left-edge nav)

**Per-card positions reset** in HotelCard (rail no longer overlays):
- Profile chip top: `168px → 14px`
- `.ig-tap-unmute` top: `218px → 64px`
- Both now sit naturally at the top of the card

### v79 — `/me` IG-style profile + hamburger drawer for missing items
**Commit:** `5556177`

User feedback after v78:
1. Tapping "You" went to `/profile` (legacy account settings page). They wanted the same reel-style profile experience that `CreatorProfileSheet` builds for OTHERS, but for SELF.
2. Bottom dock has 5 slots — everything else (Deals, My Bids, Bookings, Saved, Wallet, Points, Verify, Creator, Partner) had no easy entry point.

**New `/me` route** ([app/me/page.tsx](app/me/page.tsx)) — IG-style profile:
- Sticky top bar: `@handle` left + ↑ Upgrade + ☰ Menu right
- 88px gold-ring avatar (data-URL JPEG from `useFollow().myAvatarUrl`, else initials)
- 3-stat row: Posts (PostsStore count) / Followers (synthesized base 800-6800) / Following (live from FollowStore)
- Display name, sanitized bio, 📍 location, 🔗 website
- Edit profile (gold, → /profile) + Share profile (native share) + ↑ upgrade
- Highlights row — user's `myCustomHighlights` + 4 built-in (Mountains/Beaches/Foodie/Suites)
- Tab switcher: ▦ Posts / ▶ Reels / 🏷 Tagged
- 3-col grid from PostsStore, graceful empty state per tab
- Premium parchment theme matching the v78 rail

**`MoreDrawer`** inside `/me` — slide-in from right, dark backdrop, esc-to-close. 10 destinations + Log out:
| Icon | Label | Sub | Where |
|---|---|---|---|
| ⚡ | Flash Deals | Live discounts today | /flash-deals |
| 📋 | My Bids | Your active offers | /my-bids |
| 🎫 | Bookings | Past + upcoming stays | /bookings |
| 🔖 | Saved | Wishlist hotels & reels | /saved |
| 💰 | Wallet | Balance & transactions | /wallet |
| ⭐ | StayPoints | Loyalty rewards | /points |
| ✅ | Verify Stay | Hotel verification | /verification |
| ✨ | Creator Hub | Earnings + referrals | /influencer |
| 🏢 | Hotel Partner | Open partner dashboard ↗ | external panel |
| ⚙ | Account settings | Email, phone, security | /profile |
| ↶ | Log out | Sign out of this device | — |

**Routing wiring:**
- BottomDock "You" → `/me` (was `/profile`)
- BottomDock visibility extended to include `/me`
- BottomDock `isActive("/me")` lights up the You slot anywhere under `/me/*`
- DialerNav hide gate extended to `/me`
- Navbar hide gate extended to `/me`
- ServerStatus hide gate extended to `/me`

### Files added (this era)
```
components/discover/FlashDealStories.tsx       # rail + viewer + audio + hook (v75/v76)
components/discover/BottomDock.tsx             # IG-style bottom nav (v78)
app/me/page.tsx                                # IG-style "You" profile + MoreDrawer (v79)
```

### Files modified (this era)
```
app/api/discover/feed/route.ts                 # jitter + bucket shuffle + no-store (v75)
app/api/flash/near/route.ts                    # ?viewed= + band shuffle + no-store (v76)
app/discover/page.tsx                          # (no changes after v75 wiring)
app/layout.tsx                                 # mounts <BottomDock />; SB_BUILD + badge per release
components/discover/InstagramHotelFeed.tsx     # flex shell + rail mount + perf tiered preload + position resets
components/DialerNav.tsx                       # hide on /, /discover, /reels, /me
components/Navbar.tsx                          # hide on /me (already hidden on /discover, /reels)
components/ServerStatus.tsx                    # hide on /me
public/sw.js                                   # CACHE_NAME bumped per release
```

### New routes (this era)
- **`/me`** — IG-style "You" profile (v79). Owns its own top bar; Navbar + ServerStatus hidden. BottomDock visible.

### New localStorage keys (this era)
| Key | Value | Purpose |
|---|---|---|
| `sb_fdeal_audio_{dealId}` | Blob URL string | Per-deal custom audio override (partner/admin upload, survives nav, not hard reload) |
| `sb_flash_viewed_v1` | JSON `string[]` | Most recent 60 viewed flash-deal IDs — sent to `/api/flash/near?viewed=` for personalization |

### New API behaviors (this era)
- `GET /api/flash/near?viewed=id1,id2,…` — viewed IDs pushed to bottom of their discount band
- `GET /api/flash/near` returns `audioUrl` passthrough when present on the row (frontend reads it)
- Both `/api/discover/feed` and `/api/flash/near` now ship `Cache-Control: no-store, must-revalidate` — every refresh reshuffles

### Service-worker version map (continued)
- v72 → analytics-moderation
- v73 → real-countdown-reminder-notifs (pre-existing)
- v74 → timer-override-summary-toast (pre-existing)
- **v75** → flash-deal-stories-fresh-feed
- **v76** → flash-stories-audio-personalization
- **v77** → fix-unmute-hint-overlap
- **v78** → clean-separation-cream-rail-bottom-dock
- **v79** → me-profile-page-more-drawer **(current)**

### Architecture summary (post-v79)
**Reel-app routes** (`/`, `/discover`, `/reels`, `/me`):
- DialerNav crown wheel **hidden**
- Customer Navbar **hidden** (except `/reels` already had its own header)
- ServerStatus banner **hidden**
- BottomDock **shown** with 5 slots (Home / Reels / Bid / Hotels / You)
- These four routes own the IG-clone surface

**Everywhere else:**
- DialerNav crown wheel **shown** (left-edge nav)
- Customer Navbar **shown** (`/hotels`, `/flash-deals`, `/bookings`, `/profile`, etc.)
- BottomDock **hidden**

**Flash-deal pipeline:**
1. `useFlashDealStories(city)` fetches `/api/flash/near?city=X&viewed=id1,…`
2. API returns deals shuffled within 5% discount bands, viewed deals at bottom of their band
3. Rail renders top 18 — cream band, gold rings, no badges
4. Tap → viewer auto-plays peaceful default audio (rotated by hotel hash) OR custom audio if uploaded
5. Book Now → `/hotels/[id]?dealId=…&dealPrice=…&directBook=true`
6. Open is recorded to `sb_flash_viewed_v1` → next fetch surfaces a different deal at top

### Things to Avoid (IG-Style Discover Era)
- **Never** restore the discount badge on `.fdeal-rail-wrap` items — user explicitly asked for clean front-page rings, % only inside the viewer.
- **Never** route the `.fdeal-rail-wrap`'s audio through Web Audio (`applyGain`) — cross-origin SoundHelix mp3s would silence. Native `<audio>` only.
- **Never** make the flash-deal rail `position: absolute` again — it overlays the reel feed and brings back the "kya yeh overlap kar raha hai" feedback. Always part of the flex shell.
- **Never** drop the `Cache-Control: no-store` on `/api/discover/feed` and `/api/flash/near` — the personalization shuffle is the entire point of "different feed har baar".
- **Never** mount a custom-audio upload UI for non-partner/non-admin users — `canAttachAudio()` is the gate. Public spam audio breaks the premium cream feel.
- **Never** put the bottom dock back to the legacy `/profile` route — the user wants the IG-style `/me` experience for "You". `/profile` is reachable via the drawer's "Account settings" entry.
- **Never** show DialerNav, Navbar, or ServerStatus on `/`, `/discover`, `/reels`, `/me`. Those four routes own the IG-clone chrome — adding the customer-side nav clutters the surface.
- **Never** expand the BottomDock past 5 slots. 5 is the IG limit; everything else lives in the hamburger drawer.
- **Never** drop `localStorage.sb_user_avatar_url` from FollowStore — the `/me` avatar reads from it, and the rail / profile sheet on `InstagramHotelFeed` also depend on the same key.
- **Never** strip the per-card `adjacent` prop on `HotelCard` — drives the tiered `<video preload>` (auto/metadata/none) which is the v75 perf win.

### Pending / known issues
- Vercel build queue on Hobby plan serializes builds across the 4 sister projects sharing this repo (staybid-customer-frontend / staybid-customer / staybid-frontend / staybid-frontend-vcdb). v76's fix-build commit `2103b7f` sat QUEUED 5+ minutes before its turn. If a deployment seems stuck, check `https://vercel.com/sachinhelpline-3778s-projects/staybid-customer-frontend/deployments` — usually it's queue position, not failure.
- Hydration warnings on `/me` from `useMemo` reading `localStorage` (followers count seed) — SSR returns initial state, client hydrates with real value. Pre-existing pattern in this codebase, not introduced by v79.
- `flash_deals.audioUrl` is not yet a column on Supabase — the frontend reads it defensively but it's `undefined` for all current rows. Admin/partner panels can add the upload UI when desired; frontend already supports.

---

## Updated production state (v79, 2026-05-12)
- **Current version:** v79 · commit `5556177` on `main` · branch `claude/cool-hamilton-c78b1f`
- IG-style discover surface complete: flash-deal stories rail, bottom dock, /me profile + hamburger drawer
- Reel-app routes (`/`, `/discover`, `/reels`, `/me`) all hide customer-side nav and show the IG-clone chrome
- Two personalization layers live: `/api/discover/feed` (band shuffle) and `/api/flash/near` (viewed-aware band shuffle), both `no-store`
- Audio on flash-deal stories with hotel-deterministic default + partner/admin custom upload

---

## Posts-Feed + Bulletproof-Viewport + Premium-Cozy + Theme-System Era (v80 → v91, May 2026 – May 2026-05-13)

12 versions covering a full arc from "IG-style discover polish" → "tap-to-play modal (wrong approach)" → "dedicated Posts/All-Posts scroll-feed routes" → "viewport bulletproofing (no chrome overlap, CTAs clear dock)" → "premium cozy minimal palette" → "complete light ⇄ dark theme system" → "regression fixes".

**Current production version: v91** (commit `4d38148` on `main`, branch `claude/optimistic-swanson-9df741`)

### v80 — BottomDock everywhere + BackChip + owner-gate
- BottomDock now visible on EVERY customer-facing page (not just reel surfaces). Self-hides only on `/admin`, `/partner`, `/onboard`, `/auth`.
- New `<BackChip />` floating top-left back chip on every non-reel customer page (`router.back()` with `/me` fallback).
- Owner gate on audio-strip change: only `sb_partner_token` OR `sb_admin_token` can upload custom audio.

### v81 — Per-session reel shuffle + system-wide city + cleaner More menu
- `/api/discover/feed` and `/api/flash/near` add `Cache-Control: no-store` + bucket-shuffle so each refresh feels different.
- Globe picker → `sb_city` + `sb:city-change` event → `/hotels`, `/flash-deals`, reel feed all subscribe.
- BackChip shrunk to icon-only 30px circle (was labelled pill).

### v82 — Auto-pause + save wiring + clean mute UI
- Reel video auto-pauses when StoryViewer opens, document is hidden, or window minimised (uses `Page Visibility API` + `visibilitychange`).
- Save button on reel cards now writes to `sb_local_saves` and POSTs to `/api/discover/save`.
- Mute label cleanup — "Volume booster 1.8×" → simple "On / Off".

### v83 — Midnight reset + view-hotel CTA + /me grid from social_posts + tighter rail
- Flash-deal countdown ring resets at midnight (was full-24h on every render).
- Tagged hotels on user reels surface a "🏨 At {Hotel} · Explore ›" pill routing to `/hotels/[id]`.
- `/me` profile grid now pulls posts from BOTH PostsStore + `/api/social/feed?author=<myUserId>` + `/api/influencer/my-videos`, dedup by id.
- Flash-deal rail tightened — items 60→52px, fewer padding pixels.

### v84 — Bulletproof local-first persistence + premium gold badge + rail split
- `sb_local_saves` is now the single source of truth on the client. `/saved` page merges local + remote with local taking precedence (fresh snapshots).
- Saved button gets a premium gold conic-gradient badge when active.
- Rail split: Reel feed cards no longer touch the flash-deal rail (clean horizontal lanes via flex-shell).

### v85 — Tap-to-play ReelPlayerModal **(superseded in v86)**
- Built `components/ReelPlayerModal.tsx` — a fullscreen video modal opened when tapping a `/me` grid tile or `/saved` video card.
- **User feedback:** wrong pattern. IG's profile→Posts and Saved→All-Posts are dedicated SCROLLABLE feed routes, not modals.
- v85 modal was deleted entirely in v86.

### v86 — IG-style Posts / All-Posts dedicated scroll-feed routes
- **New shared component:** `components/PostsScrollFeed.tsx`
  - Sticky top header with `← Title` back arrow
  - IG-style per-post card: avatar + @handle + 🎵 audio line + (Follow viewer-only) + ⋮; 9:16 media stage with mute toggle; action row (♡ 💬 ↻ ▷ 🔖); caption with bold @handle prefix; optional 🏨 hotel CTA
  - IntersectionObserver-driven autoplay (most-visible card plays, others pause)
  - `scrollIntoView` on mount for `?start=<id>` param
  - Two modes: `owner` (no Follow) and `viewer` (Follow button shown)

- **New routes:**
  - `app/me/posts/page.tsx` — "Posts" header, owner mode, data from PostsStore + `/api/social/feed?author=<myUserId>` + `/api/influencer/my-videos`
  - `app/saved/posts/page.tsx` — "All Posts" header, viewer mode, data from `sb_local_saves` + `/api/discover/saves/enriched?type=video`

- **Re-wired:**
  - `/me` grid tile tap → `router.push('/me/posts?start=<id>')`
  - `/saved` video card tap → `router.push('/saved/posts?start=<id>')`

- **Hide chrome on `/saved/posts`:** Navbar + ServerStatus + DialerNav + BackChip all hide via `pathname.startsWith("/saved/posts")` (Navbar + ServerStatus + DialerNav already hid `/me/*`).

- **Deleted:** `components/ReelPlayerModal.tsx`

- **v86 hotfix** (`bca0baa`): TypeScript strict mode TS2339 in `PostsScrollFeed.tsx`. The IntersectionObserver callback used `let best: { id; ratio } | null = null` and TS narrowed `best` to `null` inside the forEach closure, so `best.id` at use-site inferred as `never`. `next build` (Vercel's strict pass) caught what `next dev` missed. Fix: tracked `bestId` + `bestRatio` in plain primitive locals (no nullable object wrapper).

### v87 — Bulletproof viewport: no overlap, CTAs clear dock, ALL action buttons functional
User reported 4 distinct issues across 4 screenshots:

1. **Home page reels — Book Now + Bid CTAs cut off** (clipped behind the fixed BottomDock):
   `bottom: 20px` of the card = viewport-y-20 = INSIDE the 57px dock zone.
   Fix: `bottom: "calc(20px + 64px + env(safe-area-inset-bottom, 0px))"` → CTAs land 26px above dock top.
   Same +64 reserve applied to the right action rail (`bottom: 200 → 264`).

2. **`/discover` reel cards — `STAYBID · REELS` brand overlapping with `@user_fb_ld6` profile chip:**
   `.reel-brand-chrome` (center-top, z-40) and in-card profile chip (top:14px, z-30) shared the same y-band.
   Fix: deleted `.reel-brand-chrome` entirely from `app/discover/page.tsx`.
   In-card profile chip top → `calc(env(safe-area-inset-top, 0px) + 14px)` for notch clearance.
   `.ig-filter-chip` top → `calc(env(safe-area-inset-top, 0px) + 6px)` for notch clearance.

3. **`/saved/posts` — two back buttons** (floating BackChip + in-page ← All Posts arrow):
   Fix: Added `pathname.startsWith("/saved/posts")` to BackChip hide list. PostsScrollFeed's in-page arrow is the only back affordance.

4. **`/me/posts` — useless "0 · View insights" + "Boost post" button + dead action buttons (decorative only):**
   - Removed `.pf-owner-row` (View insights + Boost) from PostsScrollFeed entirely
   - **Wired ALL 5 action buttons:**
     - ♡ Like — toggles state + persists `localStorage.sb_post_likes_v1`
     - 💬 Comments — opens minimal drawer placeholder
     - ↻ Replay — restarts `video.currentTime = 0`
     - ▷ Share — `navigator.share()` with `/saved/posts?start=<id>` deep-link, clipboard fallback + toast
     - 🔖 Save — writes to `sb_local_saves` (same shape /saved reads), `aria-pressed` flips
   - Added double-tap-to-like with animated heart pulse on media tap
   - Added toast component for share/save feedback

**Bulletproof viewport guarantees baked in:**
- Notch / camera punch-hole: every top-positioned absolute element uses `env(safe-area-inset-top)` — iOS Dynamic Island, Samsung punch-hole, Pixel notch all clear
- Home indicator / gesture bar: every bottom-positioned element uses `env(safe-area-inset-bottom)` — iOS home bar, Android nav buttons
- PWA fullscreen: `--reel-vh` (visualViewport-driven) + safe-area = bulletproof
- BottomDock collision: 64px reserve on every reel-card absolute-bottom element; verified mathematically (`y_button + 0 < y_dock_top`)
- Build safety: `tsc --noEmit` clean before push — no v85→v86 hotfix repeat

### v88 — Premium cozy minimal palette + brand wordmark restored (no overlap)
User: "premium cozy colors se replace karo, brand name ko dubara lagao"

- **Brand wordmark restored**, premium serif, NO overlap:
  - `app/discover/page.tsx`: brand at top-LEFT (clears the filter chip at top-RIGHT), Cormorant Garamond italic, pathname-conditional color:
    - On `/` (over cream Flash Deals rail) → cocoa `#4A3820` (high contrast)
    - On `/discover` (over dark video) → cream `#FAF5EB` + drop shadow
  - In-card profile chip top: 14 → 38px so the @handle never sits behind the brand row
  - `app/reels/page.tsx` mark: monospace stark white → Cormorant italic cream + champagne dot
  - `components/PostsScrollFeed.tsx`: `.pf-brand` lives opposite the back arrow in the sticky header — small Cormorant italic cocoa with champagne dot

- **Cozy palette CSS variables** (single source of truth) added to `app/globals.css :root`:
  ```
  --cozy-cream-50:        #FFFCF6   lightest cream
  --cozy-cream-100:       #FAF5EB   default page bg
  --cozy-cream-200:       #F2EAD8   warm card
  --cozy-taupe:           #E8DCC8   dividers
  --cozy-warm-dark:       #1F1A0F   text on light + bg on dark
  --cozy-warm-soft:       #2B2415
  --cozy-cocoa:           #4A3820   secondary text
  --cozy-cocoa-soft:      #6E5430   tertiary text
  --cozy-champagne:       #C9A66B   accent (desaturated)
  --cozy-champagne-light: #D9BE82
  --cozy-rose:            #D49583   hearts/likes
  --cozy-sage:            #9DAD8F
  ```

- **Surfaces flipped:**
  - PostsScrollFeed: stark white → cream-50 root + card bg, pure black text → warm-dark, taupe dividers, cocoa body text, audio-strip cocoa-on-cream
  - InstagramHotelFeed `.ig-cta-bid`: harsh purple/magenta gradient → cozy champagne-on-cocoa-on-warm-dark
  - InstagramHotelFeed `.ig-filter-chip`: pink+purple → cocoa+warm-dark with champagne border
  - "YOUR REEL" pill: magenta+purple → champagne+cocoa
  - BottomDock: cool near-black `rgba(7,6,14,.92)` → warm cocoa `rgba(31,26,15,.94)` + champagne border + champagne-light active state
  - PostsScrollFeed like-heart: harsh red `#ff3a6a` → cozy-rose `#D49583`
  - PostsScrollFeed save bookmark active: champagne

### v89 — Cozy everywhere + compact heros + dead chrome removed
User reported 8 distinct issues:

1. **Brand "stay·bid" Flash Deals ke upar overlap** on `/`:
   v88 had brand at page-level (top-LEFT) AND `.fdeal-rail-title` "Flash Deals" at top-LEFT of rail header — same y-band.
   Fix: removed page-level brand on `/` entirely (`pathname !== "/"` gate in app/discover/page.tsx). Brand moved INSIDE rail header on RIGHT (next to "Flash Deals" title on left). Same Cormorant italic pair.

2. **Story avatar ring still bright magenta/purple:**
   `.ig-avatar` conic from `#f0b429 #ff458d #b964ff` → `#C9A66B #D9BE82 #6E5430` (cozy champagne). Story ring (`.ig-avatar.has-story`) also recoloured.

3. **"You" Follow pill still saturated gold:**
   `.ig-follow-3d` gradient flipped from `#ffe28a → #f0b429 → #a26b08` → `#E7CFA0 → #D9BE82 → #C9A66B → #9C7E48` (desaturated champagne).

4. **➕ Create FAB rainbow magenta/purple/blue:**
   Gradient → cozy champagne `#E7CFA0 → #D9BE82 → #C9A66B`. Pulse glow → champagne.

5. **Sound button overlapping "+You" pill on right rail:**
   v87's +64px shift was overcorrecting — pushing the rail's TOP into the profile chip's right edge.
   Reverted: rail bottom `calc(200px + 64px + safe) → calc(200px + safe)`. Rail items still clear the dock (lowest at y=440 vs dock at y=583 on 640px viewport) AND clear the profile chip vertically.

6. **Rotating audio disc below More — "kya kaam hai, remove karo":**
   `<div className="ig-disc">…</div>` DELETED. Was purely decorative; audio still plays via the always-mounted `<audio>` element.

7. **Audio strip text — "iska kya kaam hai, hata do — sirf yahan se, function nahi":**
   `.ig-audio-strip-btn` block ("Original audio · StayBid Live · tap to change") REMOVED from the card's bottom-left. Audio picker still accessible via right-rail **More menu → Volume booster** section. Default audio playback unaffected.

8. **`/hotels`, `/flash-deals`, `/bid` — dark navy + bulky hero:**
   - `/hotels`: `lux-bg` dark → cream-100 surface. py-12 → py-4, mb-10 → mb-3, heading clamp 1.9→2.8rem → 1.4→2.0rem. Search slimmer (py-3 → py-2). City chips slimmer (px-5 py-2.5 → px-3 py-1.5).
   - `/flash-deals`: `.fd-root` dark navy → cream gradient. Hero padding 60→14px top, 28→10px bottom. Title clamp 2.2→3.4 → 1.6→2.4rem. Sub margin 22→10px. Chips slimmer. Live dot magenta → sage green.
   - `/bid`: `lux-bg` dark → cream. pt-10 → pt-4, mb-8 → mb-3, heading clamp shrunk, sub smaller, eyebrow color → champagne.

### v90 — Complete light ⇄ dark cozy theme system (single toggle)
User: "Complete project ki UI premium cozy minimal colors. Dark + light mode dedo. Single button se complete UI flip ho jaye. Bulletproof god-level."

**Foundation — CSS variables + provider + toggle:**

- `app/globals.css` — full theme token set in `:root` (light, default) and `[data-theme="dark"]`. Same cozy palette family both modes, only lightness inverted. Single accent (champagne `#C9A66B`) in BOTH for brand consistency.
  ```
  --bg-page / --bg-card / --bg-elevated / --bg-input / --bg-pill /
  --bg-pill-active / --text-base / --text-soft / --text-muted /
  --text-inverse / --border-soft / --border-strong / --accent /
  --accent-soft / --link / --shadow-soft / --shadow-card
  ```

- `lib/theme-store.tsx` — **NEW** `ThemeProvider` + `useTheme()` hook. Persists to `localStorage.sb_theme`, sets `data-theme` attribute on `<html>`, syncs `<meta name="theme-color">` for Android Chrome / iOS PWA chrome, listens for cross-tab `storage` events.

- `components/ThemeToggle.tsx` — **NEW** single button. Two variants:
  - `pill` — 34px circle, sun/moon glyph, animated rotation (compact)
  - `lg` — full row with label + pill switch dot animation (for drawer/settings)

- `app/layout.tsx` — `<ThemeProvider>` mounted as the outermost provider. Inline **no-FOUC bootstrap `<script>`** in `<head>` runs BEFORE first paint: reads `sb_theme`, falls back to `prefers-color-scheme`, sets `data-theme` + `meta theme-color`. Zero white flash when opening in dark mode.

- `app/me/page.tsx` — `<ThemeToggle variant="lg" />` row added in the drawer (above Log out).

**Auto-fix for legacy Tailwind classes — god-tier hack:**

Hundreds of existing references use `text-white`, `text-white/50`, `bg-white/10`, `bg-black/40`, `border-white/10`, `text-gold-*`, `text-luxury-*` against the old dark navy surface. After v89's cream switch on `/hotels` `/flash-deals` `/bid`, those references became invisible. Rather than hand-edit each one, `globals.css` now defines scoped overrides:

```css
.lux-bg .text-white,
.fd-root .text-white                { color: var(--text-base) !important; }
.lux-bg .text-white\/50,
.fd-root .text-white\/50            { color: var(--text-muted) !important; }
.lux-bg .bg-white\/10,
.fd-root .bg-white\/10              { background: var(--accent-soft) !important; }
.lux-bg .border-white\/10           { border-color: var(--border-soft) !important; }
.lux-bg .text-gold-*                { color: cocoa-soft (light) | champagne-light (dark) }
.lux-bg .text-luxury-*              { → text-base / text-soft / text-muted }
.lux-bg .text-emerald-300           { → cozy green #4a6f4a (light) }
.lux-bg .text-amber-300             { → var(--cozy-champagne) (light) }
.lux-bg .text-red-300               { → cozy rose #a85b4e (light) }
.lux-bg .group-hover\:text-gold-600:hover { → var(--accent) }
```

Now every Tailwind utility inside a `.lux-bg` or `.fd-root` container resolves to the theme's tokens. Light mode → walnut on cream; dark mode → cream on walnut. Same JSX, both modes work.

**Components updated to theme tokens:**
- `components/Navbar.tsx` — `.nav3d-bar` + `.nav3d-chip` + `.nav3d-chip-active` all read theme tokens. Light = cream-tinted translucent bar with cocoa text + champagne accent. Dark = warm cocoa bar with cream text.
- `components/BackChip.tsx` — chip bg/color/border/shadow read theme tokens.
- `components/discover/BottomDock.tsx` — added `[data-theme="light"]` overrides: cream-tinted translucent dock with cocoa active item. Dark mode keeps v88 warm cocoa look. Active item stays champagne in both.

**Pages restored to `.lux-bg` wrapper:**
- `app/hotels/page.tsx` — restored `.lux-bg` (v89 had stripped it for an inline style). All inline color/border references now use `var(--text-base)` etc.
- `app/bid/page.tsx` — same.
- `.lux-bg` + `.lux-glass` utility classes themselves now read theme tokens.

### v91 — Brand-not-hidden, shuffle, dedupe, readable cards
User reported 4 issues after v90:

1. **"stay·bid brand Flash Deals ke neeche hide ho raha hai abhi bhi"** on `/`:
   v89 used `justify-content: space-between` putting brand on RIGHT of rail header. The fixed `.ig-filter-chip` (top-right z-41 viewport-pinned) covered the right-aligned brand.
   Fix: compound label on the LEFT:
   ```html
   <span class="fdeal-rail-brandwrap">
     stay·bid · Flash Deals
   </span>
   ```
   Rail header → `justify-content: flex-start`, `padding-right: 110px` reserves clean space for the filter chip. Brand never crosses x=200, filter starts at x≥260.

2. **Every reel uploaded shows TWICE:**
   Composer commits to PostsStore (local blob URL) AND async-uploads to Supabase `social_posts`. `/api/social/feed` then returns the same post with `_isSelf=true` → feed concatenated both lists.
   Fix in `InstagramHotelFeed.tsx`: build `fpUser = Set<${kind}|${caption}>` from userItems; filter propItems to drop `_isSelf` entries matching the fingerprint. Exactly one card per upload.

3. **"Last uploaded reel always first":**
   Was `return [...userItems, ...propItems]` — userItems always prepended.
   Fix: `sessionSeed = useMemo(() => Math.random(), [])` rolled once per mount; each userItem `result.splice(insertAt, 0, u)`'d at deterministic-per-session offset:
   ```
   offset = (sessionSeed * 997 + i * 313) % result.length
   insertAt = max(1, min(result.length, offset))   // NEVER index 0
   ```
   Same session → stable order (no mid-scroll jitter). Next session → fresh mix.

4. **Light mode invisible text on `/flash-deals` hotel name + price:**
   v90 auto-fix overrode Tailwind classes (`.text-white`, etc.) but NOT the inline `.fd-*` styles which hardcode `color: #fff` and `color: rgba(255,255,255,*)`.
   Fix: bulk-replaced in `app/flash-deals/page.tsx`:
   ```
   color: #fff                       → var(--text-base)
   color: rgba(255,255,255,0.85)     → var(--text-soft)
   color: rgba(255,255,255,0.7)      → var(--text-soft)
   color: rgba(255,255,255,0.6)      → var(--text-soft)
   color: rgba(255,255,255,0.45)     → var(--text-muted)
   color: rgba(255,255,255,0.42/40/35/30) → var(--text-muted)
   background: rgba(255,255,255,0.08) → var(--accent-soft)
   ```
   `.fd-card` + `.fd-drawer` surfaces also now read `--bg-card` + `--border-soft` + `--shadow-*` tokens.

   Also extended globals.css overrides for `emerald-300` (cozy green), `amber-300` (champagne), `red-300` (cozy rose), and `group-hover:text-gold-600` (accent).

### Files added (this era)
```
app/me/posts/page.tsx                       # v86 — IG "Posts" view for self
app/saved/posts/page.tsx                    # v86 — IG "All Posts" view for saved
components/PostsScrollFeed.tsx              # v86 — shared scrollable feed component
components/ThemeToggle.tsx                  # v90 — single-button light⇄dark
lib/theme-store.tsx                         # v90 — ThemeProvider + useTheme hook
```

### Files modified (this era — major touches)
```
app/discover/page.tsx                       # v87/88/89/91 — brand chrome iterations
app/reels/page.tsx                          # v87/88 — safe-area + brand wordmark
app/me/page.tsx                             # v86/90 — modal→route navigation, ThemeToggle row
app/saved/page.tsx                          # v86 — ClickWrap → router.push('/saved/posts')
app/hotels/page.tsx                         # v89/90 — cream + compact hero, lux-bg restored
app/flash-deals/page.tsx                    # v89/91 — cream + compact + all #fff → tokens
app/bid/page.tsx                            # v89/90 — cream + compact hero
app/layout.tsx                              # v90 — ThemeProvider, no-FOUC script, SB_BUILD bumps
app/globals.css                             # v88/90/91 — cozy + theme + auto-fix overrides

components/discover/InstagramHotelFeed.tsx  # v87/88/89/91 — viewport, palette, dedup, shuffle
components/discover/FlashDealStories.tsx    # v89/91 — brand wordmark in rail header
components/discover/BottomDock.tsx          # v88/90 — cozy + theme-aware variants
components/discover/CreateFlow.tsx          # postedRef double-fire guard (pre-existing, verified)
components/Navbar.tsx                       # v90 — theme-aware nav chrome
components/BackChip.tsx                     # v86/87/90 — hide gates + theme-aware
components/ServerStatus.tsx                 # v86 — hide on /me + /me/posts + /saved/posts
components/DialerNav.tsx                    # v86 — hide on /me + posts routes

lib/posts-store.tsx                         # v85+ content fingerprint dedup (pre-existing)
public/sw.js                                # CACHE_NAME bumped per release
```

### Files deleted (this era)
```
components/ReelPlayerModal.tsx              # v85 modal player — superseded by v86 routes
```

### New routes added (this era)
- **`/me/posts?start=<id>`** — IG "Posts" scroll-feed for the current user's own posts
- **`/saved/posts?start=<id>`** — IG "All Posts" scroll-feed for saved video items

### New localStorage keys (this era)
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_theme` | `"light"` \| `"dark"` | v90 — Active theme |
| `sb_post_likes_v1` | JSON `{[postId]: true}` | v87 — Like state for PostsScrollFeed cards |

### Service-worker version map (continued)
- v79 → me-profile-page-more-drawer
- **v80** → bottom-dock-everywhere-backchip-owner-gate
- **v81** → per-session-shuffle-system-city-cleaner-more
- **v82** → auto-pause-save-clean-mute
- **v83** → midnight-reset-view-hotel-cta-me-grid-from-social-posts
- **v84** → bulletproof-saves-persistence-premium-gold-badge-rail-split
- **v85** → reel-player-modal-tap-to-play (interim, superseded)
- **v86** → ig-posts-scroll-feed-me-saved (+ bca0baa TS2339 hotfix)
- **v87** → bulletproof-viewport-no-overlap-functional-actions
- **v88** → premium-cozy-palette-brand-restored
- **v89** → no-overlap-cozy-everywhere-compact-hero
- **v90** → theme-system-light-dark-cozy-toggle
- **v91** → brand-shuffle-dedupe-flashdeals-readable **(current)**

### Vercel cleanup (mid-v86)
Identified + deleted 4 duplicate/legacy Vercel projects from the team:
- `staybid-frontend` (legacy duplicate)
- `staybid-customer` (legacy duplicate)
- `staybid-frontend-vcdb` (legacy duplicate)
- `staybid-live-suite` (~6-month-old abandoned)

All 4 shared the `Sachinhelpline/staybid-frontend` repo, none had custom domains, all built on every push and ran cron jobs in parallel. **Before:** 4 sister projects × 2 git refs = 8 builds per push, crons firing 4× per schedule. **After:** only `staybid-customer-frontend` builds — 1 build per push, crons fire once.

Remaining Vercel projects (all functional, all KEEP):
- `staybid-customer-frontend` (LIVE — staybids.in)
- `staybid-admin` (admin panel UI)
- `staybid-hotel-panel` (hotel partner UI)
- `staybid-agent-panel` (agent panel UI)

### Architecture summary (post-v91)

**Reel-app surfaces (`/`, `/discover`, `/reels`, `/me`, `/me/posts`, `/saved/posts`):**
- DialerNav crown wheel **hidden**
- Customer Navbar **hidden**
- ServerStatus banner **hidden**
- BottomDock **shown**
- Brand wordmark visible:
  - `/` → inside Flash Deals rail header as compound label (`stay·bid · Flash Deals`)
  - `/discover` + `/reels` → top-left page-level wordmark (cream over dark video)
  - `/me/posts` + `/saved/posts` → in sticky page header opposite back arrow

**Other customer pages (`/hotels`, `/flash-deals`, `/bookings`, `/my-bids`, `/wallet`, `/points`, `/profile`, `/upgrade`, `/bid`, etc.):**
- BackChip **shown** (floating top-left)
- Customer Navbar **shown** (sticky top)
- BottomDock **shown** (sticky bottom)
- Brand visible via the Navbar's `<Link>` wordmark

**Theme:**
- Single `data-theme="light"|"dark"` attribute on `<html>`
- All surfaces read CSS variables — no per-component theme branching needed
- Auto-fix scoped overrides for legacy Tailwind utilities inside `.lux-bg` / `.fd-root`
- Toggle button in `/me` drawer flips entire UI in 0.22s ease transition
- Same champagne accent `#C9A66B` in both modes — brand stays consistent

**Bulletproof viewport guarantees (v87 baked in, maintained):**
- Every absolute top element uses `env(safe-area-inset-top)`
- Every absolute bottom element uses `env(safe-area-inset-bottom)` + 64px reserve over BottomDock
- `--reel-vh` (visualViewport-driven) on reel pages
- PWA `display: fullscreen` + URL-bar collapse trick

**Reel feed item ordering:**
- API posts (`/api/discover/feed` + `/api/social/feed`) shuffled per-session via `Math.random()` in `loadFeed`
- Local PostsStore items deduped against API `_isSelf` entries by `<kind>|<caption>` fingerprint
- Remaining local items interleaved at deterministic-per-session offsets (`sessionSeed`)
- User's own posts NEVER auto-open first (insertAt ≥ 1 enforced)

### Things to Avoid (v80-v91 Era)
- **Never** add a separate video player MODAL for tile/card taps — IG pattern is a dedicated SCROLL-FEED route (v85→v86 was a costly relearn).
- **Never** restore the page-level `.reel-brand-chrome` on `/` — it overlaps the Flash Deals rail title. Brand lives INSIDE the rail header on `/`, at page-level on `/discover` and `/reels`.
- **Never** put rail header items on `justify-content: space-between` — the top-right will always collide with the fixed `.ig-filter-chip`. Use `flex-start` + `padding-right: 110px`.
- **Never** prepend userItems to propItems without dedupe — the same post lives in BOTH PostsStore (local) and Supabase `social_posts` (server), and the user will see their reel twice.
- **Never** put a userItem at `insertAt = 0` — newest-upload-on-top every open. Always `insertAt = max(1, …)`.
- **Never** hard-code `color: #fff` inside a page's style block — it bypasses the v90 theme auto-fix overrides. Always use `var(--text-base)` / `var(--text-soft)` / `var(--text-muted)`.
- **Never** ship a `.lux-bg` page without verifying its text-white references in light mode — the auto-fix overrides catch Tailwind utility classes but NOT inline `style={{ color: "#fff" }}` or custom CSS class blocks.
- **Never** add a button to the right action rail beyond the current 6 (mute/like/comment/share/save/more) — the bottom anchor `200px + safe-area` only clears the dock when the rail height stays around 302px (6 buttons × ~42px + gaps). One more button → rail's TOP starts colliding with the profile chip again (v89 issue #5).
- **Never** revert the v87 `bottom: 20px → calc(20px + 64px + safe-area)` push on the bottom-left CTA wrap — Book Now / Bid CTAs WILL be clipped behind the BottomDock without it.
- **Never** route a Composer post directly to addPost twice. The Composer has `postedRef.current` (immediate ref) guard + PostsStore has 5s content-fingerprint dedup. Both layers in place since v84.
- **Never** rename the cozy palette CSS variables — `lib/theme-store.tsx` reads `--bg-page` etc. by name, and `globals.css` `[data-theme="dark"]` overrides them with EXACT matching names. A rename would break the flip silently.
- **Never** put a destructive deploy operation in a script without explicit user confirmation — the Vercel project cleanup (mid-v86) was done by the user manually in the dashboard because the MCP exposes only read-only project APIs.

---

## Updated production state (v91, 2026-05-13)
- **Current version:** v91 · commit `4d38148` on `main` · branch `claude/optimistic-swanson-9df741`
- **Theme system live:** single toggle in `/me` drawer flips entire UI; persists to `sb_theme`; respects `prefers-color-scheme` on first visit; cross-tab sync via `storage` events
- **IG Posts / All-Posts routes live:** `/me/posts` (owner) + `/saved/posts` (viewer), all 5 action buttons functional (Like / Comments / Replay / Share / Save)
- **Bulletproof viewport:** every absolute top/bottom element respects safe-area + 64px dock reserve, verified mathematically on 640px viewport
- **Brand wordmark visible on every reel surface** without overlapping any other chrome
- **Cozy palette consistency** — same champagne accent `#C9A66B` in both light + dark modes; warm cream parchment in light, deep walnut + cream text in dark
- **Feed shuffle bulletproof** — deterministic per session, user's own posts never auto-open first, no duplicate cards from PostsStore↔social_posts merge
- **Vercel:** only 1 build per push (legacy duplicates deleted)

---

## Instagram-Fast Perf Era (v92 → v93, May 2026-05-13)

Two iterations: a small flash-deals UI polish (v92) and a deep performance overhaul (v93) that turned every layer — service worker, hot APIs, and the reel feed itself — into something built for heavy traffic without sacrificing the "fresh on every refresh" feel.

### v92 — Flash Deals light-mode cream pills + cream-over-image overlay
Tiny visual fix: in light mode the deal pills on `/flash-deals` were rendering as bright gold-on-cream which clashed with the v90 cozy palette. Switched the pill bg to a softer cream tint matching the card surface; "Live now" + ETA overlays on the deal images got a cream gradient backdrop so the white text reads cleanly against bright hotel photos. No structural changes.

### v93 — Instagram-Fast: kill cache-nuke, share Supabase reads, window cards
**Commit:** `0b1ec1f` — `perf(feed+sw+api): Instagram-fast — kill cache-nuke, share Supabase reads, window cards (v93)`

User reported: "program slow respond kar raha hai, load hone mein bhi time lag raha hai, Instagram jaisa bina flicker ke chahiye." Investigation surfaced five compounding bottlenecks that we fixed together in one shot.

#### Root causes (verified, not guessed)

| # | Bottleneck | Where |
|---|------------|-------|
| 1 | Layout kill-switch wiped ALL caches + unregistered SW + force-reloaded on EVERY release bump | `app/layout.tsx` lines 167-179 (pre-v93) |
| 2 | SW URL included `SB_BUILD` so every release re-installed the SW from scratch | layout.tsx + sw.js `CACHE_NAME` also bumped per release |
| 3 | `Cache-Control: no-store` on `/api/discover/feed`, `/api/flash/near`, `/api/social/feed` — every page open = 5–9 Supabase round-trips + full-table scans of `bids` and `bookings` | three route handlers |
| 4 | All ~46 reel cards mounted simultaneously — 46 `<video>` elements + 46 `useFollow` / `useSoundStore` subscribers on initial paint | `components/discover/InstagramHotelFeed.tsx` line 3878 |
| 5 | `/api/social/feed` ran SEQUENTIALLY before `/api/discover/feed` in `loadFeed` — doubled cold-start wait | `app/discover/page.tsx` |

Bonus: zero `<link rel="preconnect">` — DNS+TLS handshake to Supabase / image origins paid on every fresh visit.

#### Fixes (all live in production)

##### 1. Layout kill-switch removed + stable SW URL
- **`app/layout.tsx`** — deleted the `caches.keys().forEach(delete)` + `getRegistrations().forEach(unregister)` + `setTimeout(reload, 150)` block entirely. SB_BUILD still writes to localStorage for telemetry, but no destructive operations run on release bumps.
- **SW registered with stable URL `/sw.js`** (no `?v=${SB_BUILD}` suffix). Browsers now byte-compare sw.js on each navigation — if unchanged, no reinstall, no controllerchange, no reload, no cache wipe.
- Returning users keep their warm cache across releases. Only a genuine sw.js content change triggers a controllerchange reload.

##### 2. Stable SW cache names
- **`public/sw.js`** — renamed caches to `staybid-static-v1` + `staybid-html-v1`. **Bump these ONLY when the fetch-handler logic actually changes, NEVER on every UI release.**
- Content-hashed Next.js chunks make the static cache safe to reuse forever — new builds simply add new entries without invalidating old ones.

##### 3. Module-level in-memory cache + in-flight de-dup ([lib/sb-cache.ts](lib/sb-cache.ts) — NEW)
```ts
sbCached<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T>
sbCacheInvalidate(keyPrefix: string)
```
- Each Vercel Lambda instance keeps a `Map<key, {at, data}>` on `globalThis` (survives HMR).
- 50 concurrent requests for `hotels` fire **one** Supabase fetch — the rest await the same Promise.
- After fetch resolves, all callers get the data; the cache entry is good for `ttlMs`.
- **TTLs tuned by data volatility:**
  - `TTL_CATALOG = 60_000` for hotels + rooms (rarely change minute-to-minute)
  - `TTL_POPULAR = 20_000` for `bids` / `bookings` count aggregates
  - `TTL_INVENTORY = 15_000` for room_units / accepted bids / room_blocks (availability)
  - `TTL_POSTS = 15_000` for the social_posts feed (new uploads visible within seconds)
  - `TTL_LOOKUPS = 60_000` for author + hotel side-load joins

##### 4. Hot APIs wrapped with sbCached
- **`app/api/discover/feed/route.ts`** — `hotels`, `rooms`, all-`bids`, all-`bookings` go through cache; per-user `userBookings` still hits Supabase live (varies per request).
- **`app/api/flash/near/route.ts`** — every `sb()` call replaced with `sbCachedFetch()` (catalog: 60 s, inventory: 15 s).
- **`app/api/social/feed/route.ts`** — posts cached keyed on full filter string (so `/me`'s `?author=…` and `?type=STORY` get their own buckets); authors + hotels side-loads cached with sort-stable keys.

Personalization (signals, per-user history, shuffle, viewed-IDs deprioritization) STILL RUNS PER REQUEST — only the shared dataset is reused. Same correctness, ~10x less Supabase work.

##### 5. Parallel feed fetches on /discover
- **`app/discover/page.tsx`** — `/api/social/feed` + `/api/discover/feed` now fire via `Promise.all`. Total wait = `max(a, b)` instead of `a + b`. Cuts ~300 ms off cold start on dev; more on production cellular.

##### 6. Card windowing in InstagramHotelFeed
- **`components/discover/InstagramHotelFeed.tsx`** — at the `.map(...)` call site, only `Math.abs(i - activeIdx) <= 4` slots render a real `<HotelCard>`. The rest return `<section className="ig-card ig-card-skel" aria-hidden />`.
- New CSS rule: `.ig-card-skel { background: #000; width: 100%; }` — inherits the `.ig-card` 100% height + `scroll-snap-align: start`, so swipe geometry + IntersectionObserver math are byte-identical to before.
- **Verified live:** 46 slots / 9 real cards / 37 skeletons; window slides correctly as user scrolls (e.g. after scrolling to slot 10: indexes 6-14 rendered, 0-5 + 15+ are skeletons).
- Memory + paint cost stays flat regardless of feed length — could be 1000 items long, still only ~9 mounted.

##### 7. Preconnect headers in layout
- **`app/layout.tsx <head>`** — `<link rel="preconnect">` + `<link rel="dns-prefetch">` for `uxxhbdqedazpmvbvaosh.supabase.co`, `commondatastorage.googleapis.com`, `images.unsplash.com`. Saves ~100-400 ms of DNS + TLS handshake on cold cellular.

#### Verified perf numbers (dev preview)
- `/api/social/feed`: **294 ms cold → 141 ms warm** (cache hit halves it)
- `/api/flash/near`: **374 ms cold → 324 ms warm**
- Card mount count: **46 → 9** (5x reduction during steady-state scroll)
- Scroll-snap heights: identical (500 px per card both real + skeleton)
- v93 badge renders, no functional regressions, BottomDock + action rail + Flash Deal rail all behave identically.

### Files added (this era)
```
lib/sb-cache.ts                                 # Module-level in-memory cache + in-flight de-dup
```

### Files modified (this era)
```
app/layout.tsx                                  # killed kill-switch, stable /sw.js URL, +preconnects, SB_BUILD v93, badge v93
public/sw.js                                    # stable staybid-static-v1 + staybid-html-v1 (no per-release bump)
app/api/discover/feed/route.ts                  # sbCached for hotels/rooms/bids/bookings (TTL_CATALOG + TTL_POPULAR)
app/api/flash/near/route.ts                     # sbCachedFetch wrapper for ALL inner reads (catalog 60s, inventory 15s)
app/api/social/feed/route.ts                    # sbCached for posts + authors + hotels side-loads
app/discover/page.tsx                           # Promise.all for /api/social/feed + /api/discover/feed
components/discover/InstagramHotelFeed.tsx      # card windowing at .map (only ±4 around activeIdx renders HotelCard)
```

### Service-worker version map (continued)
- v91 → brand-shuffle-dedupe-flashdeals-readable
- v92 → flash-deals-cream-pills-image-overlay
- **v93 → instagram-fast-perf (current)** — kill cache-nuke, share Supabase reads, window cards

### Architecture summary (post-v93)

**Service Worker lifecycle:**
- SW URL is **stable** (`/sw.js`, no version param). Browsers byte-compare on each navigation.
- Cache names are **stable** (`staybid-static-v1`, `staybid-html-v1`). The activate handler only drops caches whose names don't match — so a release with no SW changes keeps the existing cache intact.
- Strategy unchanged from v57: HTML = SWR, hashed chunks = cache-first, `/api/` + `/_next/data/` = network-only, images/fonts = SWR.
- **Result:** releasing a UI change no longer punishes returning users with a forced reload + cold-start. They keep their warm cache and only swap HTML on next visit.

**Hot API caching pattern:**
```ts
const data = await sbCached(
  `discover:hotels`,                              // namespaced key
  () => fetch(`${SB_URL}/...`).then(r => r.json()),
  TTL_CATALOG,                                    // 60_000 ms
);
```
- Each Lambda instance shares one in-memory dataset across all concurrent users.
- Personalization (signals body, user history) still runs per request — only the shared catalog is reused.
- Under heavy traffic: N concurrent users on a warm Lambda = **1** Supabase fetch, not N.

**Card windowing pattern:**
```tsx
filteredItems.map((it, i) => {
  if (Math.abs(i - activeIdx) > 4) {
    return <section key={...} className="ig-card ig-card-skel" aria-hidden />;
  }
  return <HotelCard ... />;
})
```
- Out-of-window slots are 500 px scroll-snap skeletons with zero React subtree.
- Window slides naturally as `activeIdx` updates via IntersectionObserver.
- Memory cost flat: 9 real HotelCards mounted at any time regardless of feed length.

### Things to Avoid (v93 Era)
- **Never** re-add the cache-nuke / SW-unregister / force-reload kill-switch to `app/layout.tsx`. That was the single biggest "slow after update" culprit pre-v93. The natural `controllerchange` + `skipWaiting` lifecycle handles SW updates gracefully without trashing the static cache.
- **Never** append `?v=${SB_BUILD}` (or any per-release token) to the SW registration URL. Stable URL means browsers byte-compare — releases with no sw.js changes don't trigger a reinstall, which means no reload, no cache wipe.
- **Never** bump `CACHE_NAME` or `HTML_CACHE` in `public/sw.js` on every release. Bump these ONLY when the fetch-handler logic actually changes (e.g. switching SWR HTML to cache-first, adding a new content type rule). The activate handler drops everything that doesn't match, so a bump = full cache wipe for every user.
- **Never** add `Cache-Control: no-store` to a route that returns shared catalog data. Use `sbCached` for the EXPENSIVE Supabase reads + keep `no-store` on the FINAL response if it's personalized — same correctness, ~10x less Supabase work.
- **Never** import `sb-cache.ts` from a client component. It uses `globalThis` module state which is server-only by design.
- **Never** call `sbCached` with a TTL longer than the user-visible freshness expectation for that data. Flash-deal availability changes when bookings happen → 15 s is the ceiling. Catalog data (hotels/rooms) → 60 s is fine. Authors/profile rows → 60 s.
- **Never** raise `Math.abs(i - activeIdx) > 4` window without testing on mid-tier Android. The 9-card window (±4) is the sweet spot — large enough that swipe never reveals a skeleton mid-animation, small enough that mount cost stays flat. Lower → user catches a skeleton flash. Higher → unnecessary mounts.
- **Never** strip `aria-hidden` from `.ig-card-skel`. Screen readers would announce empty `<section>` placeholders as visible content.
- **Never** lazy-load the `<HotelCard>` component itself (e.g. with `next/dynamic`). Windowing already solves the perf problem; lazy-loading the component would mean a real card swipe-in causes a chunk fetch + flash of empty space. The current approach renders an empty `<section>` while the real card is conditionally rendered from the SAME bundle — no waterfall.
- **Never** parallelize a fetch chain where the SECOND fetch depends on data from the first. The v93 `Promise.all` only works because `/api/social/feed` and `/api/discover/feed` are independent. If you ever need to merge a third feed source that reads from the first one's response, keep the dependent fetch sequential.
- **Never** mutate the cache `Map` directly from a route handler. Always go through `sbCached(key, fetcher, ttl)`. Direct mutations skip the in-flight de-dup and create stampede behavior under concurrent load.
- **Never** delete `lib/sb-cache.ts` thinking it's "just dev caching". It's the load-bearing piece for heavy traffic — 50 simultaneous home-page opens become 1 Supabase fetch instead of 50.

### Future-proofing notes
- Module-level cache survives across hot Lambda invocations but NOT across cold starts. Vercel's Lambda reuse window is typically 5-15 min between invocations. After that, the first request pays the cold fetch + re-warms the cache for the next 60 s.
- For genuinely high QPS (>100 req/s on a single endpoint), consider promoting `sb-cache` to a Redis-backed shared cache so cold-Lambda starts don't lose the cache. Upstash already provisioned for the project (CLAUDE.md: "Cache: Upstash Redis stirring-hog-94337, Mumbai") — can layer it underneath sbCached as a fallback before hitting Supabase.
- The reel-card window size (±4) can be made adaptive: smaller window on low-memory devices via `navigator.deviceMemory` + `navigator.connection.effectiveType`. Not needed yet — current ±4 is fine on mid-tier Android.

---

## Updated production state (v93, 2026-05-13)
- **Current version:** v93 · commit `0b1ec1f` on `main` · branch `claude/pensive-shaw-af9c78`
- **Service Worker:** stable URL `/sw.js` + stable cache names. Releases no longer trigger forced reloads + cache wipes for returning users.
- **Hot APIs:** all three feed endpoints share Supabase reads via `lib/sb-cache.ts` in-memory module cache + in-flight de-dup. ~10x less Supabase work under load.
- **Reel feed:** card windowing keeps mount count at ~9 regardless of feed length. Verified: 46 slots / 9 real cards / 37 skeletons; identical scroll-snap geometry.
- **Page load:** `<link rel="preconnect">` to Supabase + image origins shaves DNS+TLS handshake.
- **Bulletproof for heavy traffic:** N concurrent users = 1 Supabase fetch per warm Lambda; viral release no longer triggers thundering-herd asset re-download.
- **Verified perf:** `/api/social/feed` 294 ms cold → 141 ms warm; no functional regressions; v93 badge rendering correctly.

---

## Booking-Source Attribution Era (v94, 2026-05-13)

Single-shot release. Customer journey "reel → hotel page → bid" now carries a source channel end-to-end. Creators see the bookings they drove (with commission), hotels see where each booking came from in both the Bid Inbox and Bookings tabs, admin sees a global source breakdown + top-creator leaderboard.

### Channels tracked
| Source | When | UX surface |
|---|---|---|
| `direct` | URL typed / SEO / direct link — no `src` param | Default |
| `creator` | Tap Book/Bid from a user-uploaded reel (PUBLIC or CREATOR user_type) | Attribution + commission |
| `hotel-feed` | Tap Book/Bid from a reel uploaded by a HOTEL user_type | Attribution only |
| `flash` | Tap a flash-deal rail story → `?dealId=...&directBook=true` | Attribution (no commission) |

### Database (`migrations/2026-05-13-bid-attributions.sql`)
- **New table `bid_attributions`** — 1:1 with `bids` table by `bid_id` PK.
  - `source`, `creator_id`, `creator_user_id`, `creator_handle`, `creator_type`, `video_id`, `flow`, `deal_id`, `paid_total`, `commission_pct`, `commission_amount`, `metadata` (JSONB), `created_at`.
  - Indexed on every dimension the panels need: creator, hotel, source, video, created_at.
- **Auto-commission row** — when `source="creator"` AND the `creator_user_id` resolves to an `active` row in `influencers`, the `/api/attribution/record` endpoint also inserts an `influencer_commissions` row (12% standard, 15% for tier ≥ 3 Elite) so the existing Creator Earnings page picks it up without any new wiring.

### URL params flow (reel → hotel page)
Reel-feed Book/Bid CTAs now build:
```
/hotels/<hotelId>?intent=book&src=creator&cid=<users.id>&via=<username>&ctype=CREATOR&vid=<social_posts.id>#availability-picker
```
`buildAttrSuffix(h)` in [components/discover/InstagramHotelFeed.tsx](components/discover/InstagramHotelFeed.tsx) is the single source of truth — used by both `handleBook`/`handleNegotiate` AND the inline tagged-hotel buttons. It returns `""` for synthetic discover items (the mock creator pool gets no attribution — we don't pay commission to a fake handle).

### Hotel page (`app/hotels/[id]/page.tsx`)
- New useEffect after the `fetchMyBids` one. Reads URL params via `attributionFromParams(searchParams)`, persists via `setAttribution(hotelId, attr)` (localStorage key `sb_attribution_<hotelId>`, 24h TTL). Survives the Razorpay round-trip.
- Falls back to `dealId`-presence → `{ source: "flash" }` so flash bookings get tagged too.
- Every successful bid handler (`handleFlashBook`, `executeBookNow`, `executeNegotiate`, below-floor branch, simple `handleBid`) now calls `recordAttribution({ bidId, hotelId, paidTotal, flow, attribution })` after writing `/api/bid/paid`. Fire-and-forget, never throws.

### Creator Hub — `/influencer/bookings` (NEW)
- Tab added to `app/influencer/layout.tsx` between Upload and Referrals.
- 4 KPI cards: bookings driven, GMV, commission, paid-out.
- Status filter pills (All / Accepted / Pending / Counter).
- Table with: bid id + date, hotel + dates, Source badge, status, booking amount, commission + status.
- Backed by `/api/influencer/[id]/bookings` which resolves EITHER `influencers.id` OR the underlying `users.id`, joins attribution + bids + hotels + bid_paid_amounts + influencer_commissions + bid_requests.

### Partner Panel — Source badge
- `/api/partner/bids` now bulk-fetches `bid_attributions` for every returned bid and surfaces `source`, `creatorHandle`, `creatorType`, `videoId`.
- New `<SourceBadge>` component in `app/partner/dashboard/page.tsx` renders the channel pill (gold = hotel-own, purple = creator @handle, sky = direct, red = flash).
- Visible in BOTH the Bid Inbox tab and the Bookings tab. Hotels instantly know "this booking came from your own reel" vs "this came from @riya_traveller's reel".

### Admin — Source column + filter + analytics
- `/api/admin/bookings` joins `bid_attributions` and exposes source on every row. The table gets a new Source column AND a top-of-page filter pill bar (All / Direct / Creator / Hotel reel / Flash) with live count chips.
- `/api/admin/analytics/bidding` now also reads attributions:
  - `kpis.bookingsBySource`, `kpis.revenueBySource`, `kpis.totalCommission`, `kpis.attributedCount`
  - `topCreators[]` — top 10 by attributed GMV (handle / bookings / gmv / commission)
- New "Bookings by source" panel (2-col: bar chart by count + revenue list by source).
- New "Top creators by attributed GMV" panel — only renders when at least one creator-attributed booking exists.

### API routes added (this era)
```
POST /api/attribution/record          # write/upsert bid_attributions; auto-commission
GET  /api/attribution/record?ids=...  # bulk read for partner/admin tables
GET  /api/influencer/[id]/bookings    # accepts influencer.id OR users.id
```

### Files added (this era)
```
migrations/2026-05-13-bid-attributions.sql   # new bid_attributions table
lib/attribution.ts                            # client-side helpers + SOURCE_* maps
app/api/attribution/record/route.ts           # POST + GET
app/api/influencer/[id]/bookings/route.ts     # creator hub bookings endpoint
app/influencer/bookings/page.tsx              # creator hub bookings UI
```

### Files modified (this era)
```
app/layout.tsx                                  # SB_BUILD v94 + badge v94
app/hotels/[id]/page.tsx                        # capture + record attribution in 5 handlers
app/influencer/layout.tsx                       # +Bookings tab
app/api/admin/bookings/route.ts                 # join bid_attributions
app/api/admin/analytics/bidding/route.ts        # source aggregations + topCreators
app/api/partner/bids/route.ts                   # join bid_attributions
app/admin/bookings/page.tsx                     # Source column + filter pills
app/admin/analytics/page.tsx                    # Bookings by source + Top creators panels
app/partner/dashboard/page.tsx                  # SourceBadge in Bid Inbox + Bookings
components/discover/InstagramHotelFeed.tsx      # buildAttrSuffix() on all reel CTAs
```

### New localStorage keys (this era)
| Key | Value | Purpose |
|---|---|---|
| `sb_attribution_<hotelId>` | JSON `Attribution` (TTL 24h) | Survives Razorpay round-trip; cleared per-hotel after 24h |

### Things to Avoid (v94)
- **Never** rewrite `buildAttrSuffix` to return non-empty for synthetic discover items. The `CREATOR_POOL` is hard-coded mock data — paying commission to "@trail.diaries" with no users row would orphan attributions in the DB.
- **Never** drop the `attr.creator_user_id` resolver in `/api/attribution/record`. The trigger that mints the `influencer_commissions` row depends on looking up `influencers.user_id` (NOT `influencers.id`) because the URL only carries `users.id`.
- **Never** call `recordAttribution` BEFORE the bid is in the database. Use `bidRes.bid.id` AFTER `placeBid` resolves — otherwise the upsert writes against a non-existent bid id.
- **Never** strip the `direct` fallback. If `attribution` is null on a hotel page (user typed URL directly), the record call writes `source: "direct"` so the partner panel still has SOMETHING to display instead of an empty column.
- **Never** raise the attribution TTL above 24h. After a day, the captured source is stale — if a customer came from a reel yesterday and books today, that's a direct booking now. Influencer attribution shouldn't trail forever.
- **Never** add a 6th channel without updating `SOURCE_STYLE` in BOTH `lib/attribution.ts` AND the partner/admin local maps. The customer-side lib intentionally doesn't get imported from admin (separate inline-style universe) — keep them in sync manually.
- **Never** put the SourceBadge inside a `<button>` already showing the status pill on the same row — wrap differently or it inherits the button colour and the source colour gets lost. The partner panel uses a stacked layout (badge below name) for this reason.
- **Never** count `unknown` as a real channel in the analytics totals. Only `direct`/`creator`/`hotel-feed`/`flash` are valid attributions; unknown means a write succeeded with garbage data and should be investigated.
- **Never** ship a database migration in this codebase via auto-apply. The user manually applies SQL in the Supabase SQL editor — the file in `/migrations` is the source of truth + the apply log. Run `migrations/2026-05-13-bid-attributions.sql` once before the first reel-driven booking lands.

### Migration apply
1. Open Supabase SQL editor: https://supabase.com/dashboard/project/uxxhbdqedazpmvbvaosh/sql
2. Paste contents of `migrations/2026-05-13-bid-attributions.sql`
3. Run. Verify with `SELECT * FROM public.bid_attributions LIMIT 1;` (returns empty set the first time).

Without the migration applied, every code path still works (POST returns 200 with table missing, panels show "No data yet"). Once applied, attribution starts flowing for every NEW reel-driven booking automatically.

---

## Updated production state (v94, 2026-05-13)
- **Current version:** v94 · branch `claude/blissful-shannon-635ec1` (worktree)
- **End-to-end booking-source attribution live across 4 surfaces:** customer reel feed, creator hub, hotel partner panel, admin panel.
- **Migration pending:** apply `migrations/2026-05-13-bid-attributions.sql` once. Codebase is non-blocking — works gracefully when table is missing.
- **Auto-commission:** creator-attributed bookings whose creator user has an `active` `influencers` row automatically get a pending row in `influencer_commissions` (12% standard, 15% Elite — superseded by v95). Existing `/influencer/earnings` page picks them up with zero changes.
- **Synthetic-creator safety:** the mock `CREATOR_POOL` in `InstagramHotelFeed.tsx` deliberately produces NO attribution params — only real user-uploaded posts (Supabase `social_posts`) drive trackable attribution. Prevents phantom commission rows for fake handles.

---

## Tiered Commission Rules Era (v95, 2026-05-13)

Replaces the v94 flat 12% / 15% Elite commission with an admin-editable slab system + loyalty bonus. Per-creator overrides take precedence over the global default — supports city-/region-specific deals (e.g. Mumbai pilot at 20%, Goa creators on the standard slab).

### How it works
- **Slabs** match by THIS calendar month's attributed booking count:
  - 1–25 → 5%, 26–50 → 7%, 51–100 → 10%, 101–300 → 12% (seeded defaults)
  - Above the top slab's max: top rate continues (no further increase)
  - Below the lowest slab's min: no commission yet (creator hasn't reached threshold)
- **Loyalty bonus** stacks on top of the slab %:
  - 3 consecutive months at the same slab OR higher → +1%
  - 6 consecutive months → +2% (replaces the +1%, not additive)
  - "Higher slab counts as staying" — a creator who climbs from 1–25 to 26–50 keeps their streak; one who drops back into a lower slab resets it
- **Per-creator override**: admin can write a completely different rate card for any one creator at any time. The override flips `active=true` in `commission_rules` — deactivating it instantly reverts that creator to the global default.

### Database (`migrations/2026-05-13-commission-rules.sql`)
- **`commission_rules`** — single source of truth
  - `scope` ∈ {`global`, `creator`}, `creator_id` nullable
  - `slabs JSONB` — `[{minBookings, maxBookings, pct}]`
  - `loyalty_bonuses JSONB` — `[{months, bonusPct}]`
  - `active BOOLEAN` — soft-delete by flipping to false
  - Unique partial index: at most one active global row + at most one active row per creator
  - `note` + `updated_by` for audit
- **`creator_commission_history`** — monthly snapshot
  - PK `(creator_id, year, month)`
  - `bookings_count`, `slab_min`, `slab_max`, `slab_pct`, `loyalty_pct`, `total_pct`, `gmv`, `commission_total`
  - Written by `/api/attribution/record` on every creator-attributed booking — drives the consecutive-months loyalty check on the next booking
- **Seed**: the global row with default slabs is inserted if-not-exists at migration time.

### Compute path (`lib/commission.ts`)
Pure functions only — no Supabase calls:
- `DEFAULT_RULE` — final fallback if both creator + global rows are missing
- `pickSlab(slabs, monthlyBookings)` — returns the matching slab or `null`
- `pickLoyalty(bonuses, consecutiveMonths)` — returns the highest qualifying bonus pct
- `computeCommission({ rule, monthlyBookings, consecutiveMonths, bookingAmount })` → `{ slab, basePct, loyaltyPct, totalPct, commissionAmount }`
- `validateRule(rule)` — rejects overlapping slabs, out-of-range %, negative numbers (mirror of the admin UI's client-side validation)

### `/api/attribution/record` (v94 → v95)
- Hardcoded `verification_tier >= 3 ? 0.15 : 0.12` is gone.
- New `resolveRule(creatorId)` — checks creator override → falls back to global default → falls back to `DEFAULT_RULE`.
- New `monthlyBookingsFor(creatorId, creatorUserId)` — counts `bid_attributions` since the first of the current calendar month (UTC).
- New `consecutiveMonthsAtSlab(creatorId, currentSlabMin)` — walks `creator_commission_history` backward from last month, breaks the streak on first gap OR first month where `slab_min < currentSlabMin`.
- After successful compute, `upsertMonthSnapshot(...)` writes / updates the current month's row in `creator_commission_history`.
- **Audit trail**: `bid_attributions.metadata.commission` captures the slab + rate + monthly + consec-months at write time. Future rule edits do NOT rewrite past commissions.

### Admin API (`/api/admin/commission-rules`)
- `GET` — `{ global: <rule>, overrides: [<rule>], creators: [{id, userId, displayName, phone}] }`. Side-loads `influencers.display_name` joined with `users.name + phone` for the override picker.
- `PATCH` — only `scope='global'`. Upserts the single active global rule.
- `POST` — `scope='creator'` + `creatorId`. Deactivates any older active override (the unique index would reject a duplicate active row), then inserts the new one.
- `DELETE ?creatorId=<id>` — flips active=false (soft delete). Falls back to global default.
- All write paths run `validateRule()` first — rejects overlapping slabs, out-of-range %, etc.

### Admin UI (`/admin/commission-rules`)
- Sidebar: 💰 Commission Rules (between Finance and Revenue).
- **Platform default card**: shows current slabs + bonuses as pills + Edit button.
- **Overrides list**: one card per active creator override with Edit / Deactivate.
- **Add override**: search creators by name/phone in a picker modal.
- **Editor modal**:
  - Slab rows: From / To / % (add/remove)
  - Loyalty rows: Months / +% (add/remove)
  - Note field (free text for audit context — e.g. "Mumbai pilot")
  - **Live preview**: walks synthetic booking counts (1, 10, 25, 26, 50, 51, 75, 100, 101, 200, 300, 500) and shows which slab + base % each would land in + the bonus % at 3- and 6-month tenure.
- Server-side validation surface: overlap error shows red banner, save button stays disabled until valid.

### Verified end-to-end (preview server)
- ✅ GET seeds the default (5/7/10/12 + 3-mo/6-mo bonuses) on first load.
- ✅ PATCH updates global default (12 → 13% top slab + added 12-mo loyalty tier, restored after).
- ✅ Validation rejects overlapping slabs with `400 { error: "Slabs overlap: [1–50] vs [40–100]." }`.
- ✅ 3 sequential bookings → slab 1 (5%) used → commission ₹50, ₹100, ₹150 → `creator_commission_history` row with `bookings_count: 3, gmv: 6000, commission_total: 300`.
- ✅ Per-creator override (20% on 1-10) hits compute path with `ruleScope: 'creator'`: ₹5000 × 20% = ₹1000 (vs ₹250 at global 5%).
- ✅ DELETE deactivates override; subsequent compute reverts to global default.

### Files added (this era)
```
migrations/2026-05-13-commission-rules.sql      # commission_rules + creator_commission_history + seed
lib/commission.ts                                # pure compute functions + types + DEFAULT_RULE
app/api/admin/commission-rules/route.ts          # GET / PATCH / POST / DELETE
app/admin/commission-rules/page.tsx              # full editor UI
```

### Files modified (this era)
```
app/api/attribution/record/route.ts              # replaced hardcoded 12% with slab+loyalty compute + snapshot upsert
app/layout.tsx                                   # SB_BUILD v95 + badge v95
components/admin/sidebar.tsx                     # +Commission Rules entry
```

### Things to Avoid (v95)
- **Never** mutate `bid_attributions.metadata.commission` after the row was written. That field is the immutable audit trail of HOW a particular commission was computed (slab + rate + monthly count + consec-months at write time). Recompute = lose the audit history.
- **Never** add a `2nd_priority` fallback between the creator override and the global default. The resolver is intentionally 2-tier (creator → global → DEFAULT_RULE). Adding a region or tier-based middle layer creates ambiguity about which rule "won" — keep the override flat.
- **Never** set `active=true` on a `commission_rules` row via direct SQL without first deactivating the prior active row for that scope/creator. The unique partial index will reject the insert, but the API path doesn't error — it silently leaves the old rule active. POST/PATCH endpoints already handle this; manual SQL fix-ups need to flip the old row first.
- **Never** count `consecutiveMonths` against the CURRENT calendar month. The streak is measured against the past 12 months only — the current month is what's being computed RIGHT NOW. Counting it would create a self-referential loop where loyalty bonus changes the slab, which changes the loyalty eligibility, etc.
- **Never** widen the slab match to be exclusive on the high end (`< maxBookings`). It's inclusive on both ends (`>=min AND <=max`). The seed slabs are designed for inclusive matching: 25 lands in 1–25, 26 lands in 26–50. Switching the comparison would create boundary holes (booking #25 falls into no slab) or overlaps.
- **Never** introduce a non-additive loyalty bonus (e.g. "+1% if 3 months, ELSE -1%"). The system is strictly additive. Penalties belong in the slab structure itself, not the loyalty layer.
- **Never** ship a slab where `maxBookings < minBookings`. `validateRule` catches it at write time, but a manual SQL update can still introduce it. Test compute always with `pickSlab` first.
- **Never** rewrite the `influencer_commissions` row for past bookings when an admin changes the rule. The whole point of the metadata audit trail is that past commissions stay frozen at the rate they were computed with — only NEW bookings hit the new rule.
- **Never** delete the `creator_commission_history` row for past months. It's the only source of truth for the consecutive-months loyalty check. Deleting a month creates a gap → breaks the streak silently.

### Migration apply
1. Open Supabase SQL editor for project `uxxhbdqedazpmvbvaosh`.
2. Paste contents of `migrations/2026-05-13-commission-rules.sql` and run.
3. Verify with `SELECT scope, slabs, loyalty_bonuses FROM commission_rules WHERE active=true;` → should return one global row with the 4 default slabs.

(Already applied to production via Supabase MCP at v95 ship time — round-trip verified live.)

---

## Updated production state (v95, 2026-05-13)
- **Current version:** v95 · branch `claude/blissful-shannon-635ec1` (worktree)
- **Tiered commission live**: 5/7/10/12% slabs + 1%/2% loyalty bonus at 3/6 months, all admin-editable.
- **Per-creator overrides work**: validated live with a 20% override on a test creator — beat the global 5% as expected.
- **Audit trail preserved**: every `bid_attributions` row carries the rule snapshot used at write time. Future admin edits don't rewrite past commissions.
- **Default seeded**: platform-default row written by migration. If migration not yet applied, the compute path falls back to `DEFAULT_RULE` from `lib/commission.ts` (same values).

---

## Live Referrals + Admin Status Era (v96 → v97, 2026-05-13)

Two follow-up patches landing back-to-back. v96 makes the long-broken referral pipeline actually pay out (the infrastructure was there since Session 3 but nobody had wired the cookie into booking attribution). v97 calms the admin dashboard's alarming "OFFLINE" chip — the dashboard was never actually offline, only its Socket.io push channel was.

### v96 — Three fixes shipped together (`commit 4d3ee68`)

#### Fix 1 — Admin → Creators page crashed with PostgREST FK error
**Symptom:** opening `/admin/creators` showed `PGRST200: Searched for a foreign key relationship between 'influencers' and 'user_id' in the schema 'public', but no matches were found.`

**Root cause:** The `/api/admin/creators` GET used the PostgREST embedded-resource syntax `users:user_id(phone,name,email)` to inline-join the user record onto each influencer row. That syntax requires a declared FK on `influencers.user_id → users.id` in Postgres — but this codebase has **no FK constraints** anywhere (TEXT IDs / CUIDs, additive migrations only). So PostgREST flat-out refused the query and returned the cached schema error.

**Fix:** [app/api/admin/creators/route.ts](app/api/admin/creators/route.ts) replaces the embed with two parallel REST calls:
```ts
const influencers = await fetch(`influencers?select=...&order=...&limit=300`).then(r => r.json());
const userIds = Array.from(new Set(influencers.map(i => i.user_id).filter(Boolean)));
const users = userIds.length
  ? await fetch(`users?id=in.(${userIds.join(",")})&select=id,phone,name,email`).then(r => r.json())
  : [];
const userById = Object.fromEntries(users.map(u => [u.id, u]));
const data = influencers.map(i => ({ ...i, users: userById[i.user_id] || null }));
```
The UI was already reading `i.users?.phone` etc. — kept the merged shape so zero frontend change was needed.

#### Fix 2 — Referral cookie → booking attribution wired end-to-end
**The dormant infrastructure:** Session 3 (April 2026) shipped `/r/[code]` redirect + `influencer_referral_codes` + `referral_events` tables + `/api/referrals/track` + `/api/referrals/attribute`. The `/r/[code]` page already set `sb_ref` cookie (30d) + localStorage. Clicks DID get tracked.

**The missing link:** Nobody on the hotel page ever READ that cookie. The v94 attribution flow only captured URL params (`?src=creator&cid=...`). Result: every Instagram-bio / WhatsApp-link click incremented `clicks_count` but the eventual booking went through as `source: "direct"` — no commission, no creator credit, no top-creators leaderboard entry.

**Fix:**

1. **[app/api/referrals/resolve/[code]/route.ts](app/api/referrals/resolve/[code]/route.ts)** now returns `{ creator: { id, userId, handle } }` alongside `{ code, target }`. Side-loads `influencers` by id + falls back to `users.name` when `display_name` is null. This is the data the hotel page needs to build a full `Attribution` payload.

2. **[app/hotels/[id]/page.tsx](app/hotels/[id]/page.tsx)** mount effect now has a fourth attribution path (after URL params, stored localStorage, and `dealId → flash`):
   - If none of those hit, read `sb_ref` from `localStorage` OR `document.cookie`
   - POST to `/api/referrals/resolve/<code>` → get `creator.{userId, handle}`
   - Build `Attribution { source: "creator", creatorUserId, creatorHandle, creatorType: "CREATOR" }`
   - Persist via `setAttribution(hotelId, attr)` and `setAttributionState(attr)`
   - Subsequent booking handler reads `attribution` state → records via `recordAttribution()`

3. **All 5 bid handlers** (`handleFlashBook`, `handleBid`, `executeBookNow`, `executeNegotiate` above-floor, below-floor branch) also fire `/api/referrals/attribute` right after `createBidRequest`. That endpoint patches `bid_requests.influencer_id` — the legacy v93 attribution column that some downstream Phase-D triggers + reports still read. Belt-and-braces.

**The `attributeReferral` wrapper** lives in the same useEffect block as the attribution state and is a useCallback:
```ts
const attributeReferral = useCallback(async (requestId: string | undefined) => {
  if (!requestId || !referralCode) return;
  await fetch("/api/referrals/attribute", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requestId, code: referralCode }),
  });
}, [referralCode]);
```

#### Fix 3 — Rich share row on `/influencer/referrals`
Old version had ONE "Copy Link" button per code. Creators kept asking how to share to Instagram / WhatsApp. v96 rewrites the page with 6 share options per code:

| Button | Action |
|---|---|
| 📲 **Share** (native) | `navigator.share()` — opens phone's share sheet (IG / WhatsApp / Mail / Messages). Hidden on desktop. |
| 💬 **WhatsApp** | `wa.me/?text=...` — pre-filled with `"🏨 Booked an incredible stay through StayBid… Try it with my link: <url>"` |
| 📸 **Instagram** | Copies a ready-to-paste IG caption (link + `#StayBid #travel #hotels`). IG has no outbound share API — caption-copy is the IG-approved pattern. |
| ✈️ **Telegram** | `t.me/share/url?url=...&text=...` |
| 𝕏 **Twitter** | `twitter.com/intent/tweet?text=...` |
| 🔗 **Copy link** | Raw URL to clipboard |

Plus a floating toast on every success ("Link copied ✓", "Caption copied — paste in your Instagram post") and a "How to share" guide below the codes list explaining each button.

Native share button uses `useMemo` to only render when `navigator.share` exists — desktop browsers skip it cleanly.

### v97 — Admin dashboard "OFFLINE" was misleading (`commit 2744c2e`)

**User screenshot showed:** `/admin` dashboard fully rendered, KPI cards showing real numbers (13 users, 0 bookings) — but with a red 🔴 OFFLINE chip top-right that made the whole panel look broken.

**Root cause:** Admin dashboard opens a Socket.io WebSocket to the Railway backend (`staybid-live-production.up.railway.app`) for real-time bid push. Railway free-tier cold-sleeps after ~30s of inactivity. First request wakes it up but the WebSocket connection still fails the initial attempt → `connect_error` fires → chip flips to red OFFLINE. The chip had NO reconnection logic, so it stayed red forever even when Railway warmed up. Meanwhile the REST polling (every 30s) was successfully refreshing all the data.

**Fix in [app/admin/page.tsx](app/admin/page.tsx):**

1. **3 honest states instead of 2:**
   - 🟢 `live` — Socket.io connected (real-time push working)
   - 🟡 `polling` — Socket.io disconnected, REST polling still refreshing data
   - 🟡 `connecting` — first ~5s after mount
   - **NO MORE RED `offline`** — the dashboard is never truly offline as long as REST works

2. **Socket.io reconnection enabled:**
   ```ts
   io(RAILWAY, {
     transports: ["websocket", "polling"],
     timeout: 5000,
     reconnection: true,
     reconnectionAttempts: 10,
     reconnectionDelay: 3000,
     reconnectionDelayMax: 8000,
   });
   ```
   Plus a `reconnect` handler that flips status back to `live` once it reconnects.

3. **Hover tooltip on the chip:** Each state has a `title=` explaining exactly what's happening:
   - `live` → "Socket.io connected — push updates active. Data also refreshes every 30s."
   - `polling` → "Socket.io disconnected (backend cold-start or temporary). Dashboard data still refreshes every 30s via REST — everything you see is fresh."

4. **Manual ↻ Refresh button** next to the chip. Admin can force-refetch without waiting for the 30s tick.

5. **Last-refreshed timestamp** appended to the polling chip (`POLLING · 30s · refreshed 12s ago`) so admin always knows data freshness.

### Files added (this era)
*(none — only modifications to existing files)*

### Files modified (this era)
```
app/api/admin/creators/route.ts            # v96: manual users-by-id side-load instead of FK embed
app/api/referrals/resolve/[code]/route.ts  # v96: returns creator { id, userId, handle }
app/hotels/[id]/page.tsx                   # v96: read sb_ref cookie/LS → resolve → build Attribution
                                           #      + attributeReferral() called in all 5 bid handlers
app/influencer/referrals/page.tsx          # v96: rich share row (6 buttons + How-to-share guide + toast)
app/admin/page.tsx                         # v97: POLLING state + reconnection + tooltip + Refresh button
app/layout.tsx                             # SB_BUILD v96 → v97 + badge v97
```

### Vercel deployment status (verified 2026-05-13)
| Project | URL | Last deploy | Repo | This era's changes? |
|---|---|---|---|---|
| **staybid-customer-frontend** | `staybids.in` | v97 (today) | `Sachinhelpline/staybid-frontend` | ✅ ALL changes live |
| staybid-admin | `staybid-admin.vercel.app` | April 2026 (1 deploy) | `Sachinhelpline/staybid-admin` | ❌ Legacy abandoned panel |
| staybid-hotel-panel | `staybid-hotel-panel.vercel.app` | April 2026 (1 deploy) | `Sachinhelpline/staybid-hotel-panel` | ❌ Legacy abandoned panel |
| staybid-agent-panel | `staybid-agent-panel.vercel.app` | April 2026 | `Sachinhelpline/staybid-agent-panel` | ❌ Separate repo |

**Important architectural reality:** Despite the existence of those 3 legacy Vercel projects, the REAL admin + hotel-partner panels live INSIDE the `staybid-frontend` repo at `staybids.in/admin/*` and `staybids.in/partner/*`. All v94 → v97 changes are deployed there. The 3 legacy projects haven't been touched since April and shouldn't be confused for the active surfaces.

Railway backend (`staybid-live-production.up.railway.app`, repo `Sachinhelpline/staybid-Live`) was NOT touched in v94 → v97. All attribution / commission / referral flows go through Next.js API routes that hit Supabase REST directly — no backend changes required.

### Verified end-to-end (preview server)
- ✅ `/api/admin/creators` returns 200 with manual user join (no PGRST200) — phone + name + email populated per row.
- ✅ Click `/r/v96test` → `clicks_count` bumps from 0 to 1.
- ✅ `/api/referrals/resolve/v96test` returns `{ creator: { id, userId: "v96-test-user", handle: "v96 ShareTest" } }`.
- ✅ Hotel page on mount reads `sb_ref` → builds creator Attribution → records `bid_attributions` row with `source: "creator"`, `totalPct: 5%`, `commissionAmount: ₹125` on `paidTotal: ₹2500` booking (correct: 2500 × 0.05).
- ✅ Native share button (`navigator.share`) gated on `useMemo` — hidden on desktop, shown on mobile.
- ✅ Admin dashboard `/api/admin/dashboard` returns 200 with real KPI keys (`gmv`, `activeBookings`, `totalBookings`, `revenue`, `pendingVerif`, `fraud`).
- ✅ Live verification on `staybids.in/admin/login` returned "StayBid Admin — God-mode control panel" with the v96/v97 badge.

### Things to Avoid (v96 → v97)
- **Never** restore the PostgREST embed `users:user_id(...)` join. There is no FK in this schema and PostgREST silently caches the failure for the schema lifetime — even after the FK is added, the cache may serve stale errors until `NOTIFY pgrst, 'reload schema'` fires. Manual `users?id=in.(...)` side-load is the canonical pattern across this codebase.
- **Never** add a 30-day TTL on the `sb_ref` cookie shorter than the click-to-book funnel. Customers DO take 2-3 weeks to convert a creator's reel into a booking. 30 days is the floor — shorter and you'll start losing real commissions.
- **Never** assume `display_name` exists on every influencer. Many older `influencers` rows have NULL `display_name` because they came from the Phase A/B era before display names were added. Always fall back to `users.name` via a second lookup (the v96 resolve route does this).
- **Never** rip the legacy `/api/referrals/attribute` call out of the bid handlers because "we have `/api/attribution/record` now." Two separate write paths intentionally write to two separate columns (`bid_requests.influencer_id` vs `bid_attributions.creator_id`). Older Phase-D triggers + admin revenue reports STILL read from `bid_requests.influencer_id` — removing the parallel write breaks them silently.
- **Never** name the Socket.io disconnected state "OFFLINE" again. The dashboard is online; only the push channel is paused. The word "OFFLINE" makes founders panic and screenshot you on WhatsApp. Use "POLLING" + a tooltip + the manual Refresh button instead.
- **Never** drop the `reconnection: true` options on the Socket.io client. Default is `true` in Socket.io v4 but explicit > implicit — and the `reconnectionDelay`/`reconnectionDelayMax` tuning is matched to Railway's typical ~30s cold-start window.
- **Never** call `navigator.share()` outside a user-gesture handler. iOS Safari throws `NotAllowedError` if you try to trigger it programmatically. The current code is fine (it's inside an `onClick`), but if you ever proxy through a useEffect or setTimeout, it breaks silently.
- **Never** put the Instagram caption template in a tweet/Telegram URL — IG's algorithm penalizes posts with too many hashtags from outside its native composer. The Instagram button COPIES to clipboard; the Twitter button uses Twitter's `intent` URL. Don't cross-wire them.
- **Never** strip the `useMemo`-gated native-share button on desktop. Desktop Chrome partially supports `navigator.share` (Windows 10+) but the UX is broken there (opens a "More options" menu with no real share targets). The capability check is intentional — fallback is the explicit WhatsApp / Telegram / X / Copy buttons.

### Migration apply
v96 + v97 don't need any new SQL migration — all changes work with the existing tables.

### Vercel cleanup confirmed
At v97 ship time we re-verified the Vercel team list and the only ACTIVE customer-facing project is `staybid-customer-frontend` (prj_xp1BlcRqfrAL1RSGD8eV81FYOMJD). The 3 legacy projects (staybid-admin / staybid-hotel-panel / staybid-agent-panel) remain on Vercel but are NOT receiving any code from this repo — they're snapshots of separate repos last touched in April 2026.

---

## Updated production state (v97, 2026-05-13)
- **Current version:** v97 · branch `claude/blissful-shannon-635ec1` (worktree) · commits `4d3ee68` (v96) + `2744c2e` (v97) on `main`
- **Referral pipeline FULLY live**: `/r/<code>` click → cookie → hotel page resolves → creator Attribution → commission row written at the creator's v95 slab rate. Verified end-to-end with a 5% slab generating ₹125 commission on a ₹2500 booking.
- **Creator share UX**: 6 share buttons per code (Native / WhatsApp / Instagram / Telegram / X / Copy) with rich pre-filled messages. Toast feedback on success.
- **Admin Creators page**: FK error gone — `phone + name + email` visible on every application row via manual user-id side-load.
- **Admin dashboard**: never says OFFLINE anymore. Worst state is 🟡 POLLING with a tooltip + manual refresh button. Socket.io reconnects automatically when Railway warms up.
- **All deployments confirmed**: staybids.in serves the full v97 build for customer + creator hub (`/influencer`) + hotel partner panel (`/partner`) + admin panel (`/admin`). Legacy `staybid-admin.vercel.app` + `staybid-hotel-panel.vercel.app` are abandoned and out of scope.

---

## IG-Level Composer Rebuild Era (v120, 2026-05-15)

Single-shot rebuild of the Reel/Photo/Story composer to actual Instagram parity. User report: the "Edit" screen showed a tiny preview while add-on chrome filled the rest of the screen, the 50 MB cap rejected normal phone videos, the text tool couldn't be resized or recoloured, the cover-frame picker was an afterthought, and the filter strip below the preview was redundant given the existing swipe gesture.

### The five complaints addressed
| User complaint | Fix in v120 |
|---|---|
| "50 MB error aa raha hai, normal phone videos toh isse bade hote hain" | Hard cap raised 50 → 250 MB; clips longer than the kind's IG limit (60 s reels, 90 s stories) are auto-trimmed during compression instead of failing the upload |
| "Video chhoti si show ho rahi hai, niche ke add-on function se puri screen bhari hui hai" | Edit screen flattened from "small preview + scrollable form" to a two-step flow: fullscreen 9:16 stage with a floating right-rail toolbar → swipe to Details (caption / audio / tags / location / hotel / Post) |
| "Test mode chhota bada nahi kar sakte, colour change nahi kar sakte" | Text overlay gets a 3-row context toolbar when selected: 6 style chips (Classic / Modern / Neon / Typewriter / Serif / Bold) + 10-colour palette + size slider 0.5×–3× + BG toggle. Neon style ships a luminous colour-tinted glow; Modern uppercases with letter-tracking |
| "Frame wala feature itna lack kar raha hai ki use hi nahi karega koi" | CoverFramePicker rebuilt: full-bleed 9:16 preview + a single continuous 16-thumb timeline strip with a draggable gold marker. Drag or tap the strip — frame snaps live. No more "scrubber + quick picks" hybrid |
| "Filter scroll se change hota hai toh niche sabhi filter dikhne ka kya kaam" | Filter strip below the preview deleted. Filters live in an on-demand bottom sheet opened from the right-rail ✨ button. The swipe gesture (with floating name pulse) is now the only persistent affordance |

### Files modified
```
lib/social/video-compress.ts            # +CompressOptions {maxDurationS}; HARD_FILE_CAP 50 → 250 MB; auto-trim past cap; trimmedFromSec in result
lib/social/composite.ts                 # Overlay +styleId; TEXT_STYLES (6 presets) + TEXT_COLORS (10) exported; drawOverlaysOnContext honours fontFamily/weight/tracking/glow/uppercase; per-glyph kerning so letter-spacing matches the preview
components/discover/CreateFlow.tsx      # New subStep "compose"|"details"; fullscreen 9:16 stage; right-rail vertical toolbar (.sb-rail-btn); selectedTextOverlay context toolbar (style/color/size/BG); FilterSheet bottom-sheet replaces the permanent strip; CoverFramePicker rewritten with 16-thumb continuous timeline + draggable marker; compressVideo now passed {maxDurationS: 60|90} based on kind; addOverlay defaults styleId="classic" for text
app/layout.tsx                          # SB_BUILD v120; badge v120
```

### Key implementation notes
- **subStep ≠ step**. We kept the top-level `step: "pick" | "edit"` so the pick-file logic is untouched. Inside `step==="edit"`, a new `subStep: "compose" | "details"` controls which screen renders. Header chrome maps Back ⇄ Next ⇄ Post across both screens (Back goes details→compose→pick→close in one tap each).
- **Stage layout.** The fullscreen stage is `flex: 1` filling all height between header + (optional) format-warning. Inside it, an aspect-locked inner div (`aspectRatio: targetAspect; height: 100%; maxWidth: 100%`) letterboxes 9:16 cleanly on every device width without horizontal crop on phones.
- **previewFrameRef stays on the aspect-locked inner frame.** Overlay normalised coords + swipe-filter math both depend on the *visible-media-rectangle* size, NOT the surrounding letterbox padding. Moving the ref to the outer flex container would break overlay drag math.
- **styled-jsx panic at visitor.rs:597.** The first draft used `{(() => { ... })()}` to inline-compute a selected-text-overlay before rendering its context toolbar. SWC's styled-jsx visitor panics on certain IIFE-returning-JSX patterns. Fix: hoist the computation into `selectedTextOverlay` defined just above the swipe handlers, then render via plain `{selectedTextOverlay && (<jsx/>)}`. This pattern is the right answer for any future "compute then conditionally render" need in this file.
- **Per-glyph kerning in composite.** Canvas 2D doesn't expose `letter-spacing` on font, so we measure each glyph's width and advance the cursor manually with `+ trackingPx`. Keeps the composited output identical to what the preview shows for "Modern" / "Neon" / any future tracked style.
- **Auto-trim sealing.** When the playhead crosses `maxDurationS`, we `v.pause()` inside the draw loop, then resolve the outer promise from `v.onpause` (not `v.onended`, which never fires on a manual pause). MediaRecorder then closes cleanly with whatever frames were captured. Without this, the watchdog (1.5× effective duration) would still seal it, just less promptly.
- **Skip-compress branch tightened.** The `!hasOverlays && longestSrc <= TARGET_MAX_DIM && originalBytes < 12 MB` short-circuit now ALSO requires `dur <= maxDurationS`. A tiny low-res 4-minute clip would have slipped past auto-trim without this.
- **Size-comparison branch.** The "compressed result is bigger than source, ship source" guard now also bails out if we trimmed (`!willTrim`). The source carries the cut material, so we must keep the re-encode regardless of byte count.
- **The right-rail .sb-rail-btn CSS lives in the existing top-level styled-jsx block** at the top of the Composer's JSX. A second `<style jsx>` inside the conditional compose JSX triggered the same visitor.rs:597 panic, even after the IIFE fix. Rule: in this file, never add a second `<style jsx>` block inside conditional JSX — append to the top-level block instead.
- **Cover-frame timeline pointer math.** The 16 thumbnails are pure `<img>` with `flex: 1 1 0` so they fill the strip evenly. Pointer-down captures the pointer; pointer-move only updates if `buttons !== 0` (mouse) or pointerType is touch (touch drag without buttons). Marker position is `markerPct = (scrub / duration) * 100` translated centrally so it pins precisely to the time.

### Verified live in dev preview
- Badge: `v120` chip bottom-right ✓
- `sb_build`: `"v120-ig-composer-fullscreen-textstyles-timeline"` in localStorage ✓
- Composer opens; "Reel" entry card lands on the pick screen, file-input picks media, transitions to the new edit step ✓
- Header chrome: "Edit · Next ›" on compose, "Details · Post" on details, Back walks one screen at a time ✓
- 9:16 aspect chip + duration-cap chip both render top-left of the stage (video kind only for the cap chip) ✓
- Right-rail: 4 buttons for photos (Aa / 😀 / ✨ / ◼), 5 for videos (+ 🖼 Cover) ✓
- Text overlay added → context toolbar renders with 6 style chips, 10 color dots, size slider, BG toggle ✓
- Filter sheet opens with 12 chips inside the bottom sheet; no permanent strip ✓
- Next → Details: caption textarea, audio row, thumb-recap header "Tap to keep editing" all render ✓
- Mobile viewport (375×812) tested ✓
- `tsc --noEmit --skipLibCheck` clean across CreateFlow + composite + video-compress + layout ✓

### Things to Avoid (v120 Era)
- **Never** drop the `maxDurationS` parameter on `compressVideo`. The auto-trim is the entire reason 60s+ phone clips upload at all — reverting means rejecting half of incoming source clips with the "trim under 50 MB" message that v119 users hated.
- **Never** raise `HARD_FILE_CAP_BYTES` past 250 MB. Mid-tier Android tabs OOM around that mark when MediaRecorder runs on a 4K source — the cap exists for memory safety, not bandwidth. Past 250 MB the user must trim with their phone's gallery app.
- **Never** add a SECOND `<style jsx>` block to `CreateFlow.tsx`. The SWC styled-jsx visitor panics at visitor.rs:597 when two component-scoped styled-jsx tags coexist in this file (verified twice during v120 ship). Append rules to the existing top-level block.
- **Never** use an IIFE inside JSX in `CreateFlow.tsx` to compute-then-render. The same visitor panics on `{(() => { ... return <jsx/>; })()}`. Hoist the computation to a `const x = (() => {...})()` above the JSX return and render via `{x && (<jsx/>)}`.
- **Never** move `previewFrameRef` from the aspect-locked inner div to its surrounding letterbox container. Overlay normalised coords + swipe pointer math both depend on `getBoundingClientRect()` returning the visible-media rectangle — moving the ref breaks both.
- **Never** restore the persistent filter strip below the preview. The user explicitly rejected it ("filter scroll se change hota hai toh niche sabhi filter dikhne ka kya kaam"). The bottom-sheet on demand + the swipe gesture cover the same surface area without consuming any of the stage.
- **Never** ship a text style that uses `letter-spacing` on canvas without going through the per-glyph kerning loop. Canvas 2D's `font` shorthand ignores `letter-spacing`; calling `fillText(wholeString, 0, 0)` produces unspaced output and the preview/composite drift apart. Add a new style → add its tracking to TEXT_STYLES → the draw loop already honours it.
- **Never** ship a new TEXT_STYLES entry whose `fontFamily` isn't bundled with the app OR a system fallback. `Cormorant Garamond` is already loaded by layout (used by the brand wordmark) so the "Serif" style is safe; future custom families need the font import + a system-stack fallback in the same string.
- **Never** call `compressVideo` for stories without passing `{maxDurationS: 90}`. The default is 60 s; stories silently get trimmed shorter than the product spec without this. The CreateFlow runUpload branch handles this — keep it intact.
- **Never** strip the `selectedTextOverlay && (...)` guard before the bottom context toolbar. Without it the toolbar mounts every render and the `selectedTextOverlay.styleId` reads throw on the next style change since the dependent overlay is gone.
- **Never** remove the `≤ 60s` / `≤ 90s` duration-cap chip above the preview for videos. Users seeing the cap upfront prevents the "why did my clip get cut?" support tickets after upload.

### What this era did NOT do
- **Music library remains SoundHelix.** Real Bollywood / licensed music requires PPL/IPRS licensing; out of scope. Honest path is the "Upload from device" picker.
- **Server-side transcode.** Compression still runs on the device. A future era could route uploads through a Cloudflare Stream / Mux transcode for true thumbnailed-poster / HLS streaming. Today the compressed WebM/MP4 lands directly in Supabase Storage and plays via `<video>`.
- **Real-time scrubber preview thumbnails.** The cover-frame timeline shows 16 pre-extracted thumbs; while dragging, the big preview seeks via `video.currentTime` (real but visibly seek-jittery on some Android Chrome builds). Future polish: extract a 64-thumb hover-strip for smoother drag-preview.
- **Pinch-to-zoom on the stage media.** Pinch currently scales selected overlays (existing v119 behaviour). Stage-media pinch-zoom for cropping is a separate feature.

---

## Updated production state (v120, 2026-05-15)
- **Current version:** v120 · worktree branch `claude/adoring-bouman-c84ef6`
- **Composer rebuilt to IG parity.** Pick → Edit (fullscreen 9:16 + right-rail toolbar) → Next ⇒ Details (caption + audio + tags + Post). Header chrome adapts per screen.
- **Video pipeline:** 250 MB cap with auto-trim down to 60 s (reels) / 90 s (stories). Phone clips that previously failed at 51 MB now upload + trim cleanly.
- **Text overlays:** 6 IG-style presets (Classic / Modern / Neon / Typewriter / Serif / Bold) × 10-colour palette × continuous 0.5–3× size slider × glow on Neon × uppercase on Modern × per-glyph canvas kerning so preview matches composite output exactly.
- **Filter UX:** strip removed; on-demand bottom sheet from the right-rail ✨ button. Swipe gesture still active with floating name pulse.
- **Cover-frame picker:** continuous 16-thumb timeline strip with draggable gold marker + full-height preview. "Set cover" commits.
- **Verified end-to-end** in dev preview (mobile 375×812). Zero TypeScript errors. Existing posts/feed unaffected.

---

## Post-Upload Hardening Era (v120.1 → v121.2, 2026-05-15)

Five rapid patches landing across one day, each fixing a regression / latent bug exposed by the v120 ship. All five trace back to ONE structural mistake from v118 that nobody caught for ~30 release cycles.

### The original sin (v118)
v118 changed the `addPost` contract from "optimistic on submit" → "only on upload success" to kill zombie posts after failed uploads. The fix was correct, but it broke an assumption baked into the existing `updatePost(tempId, { id: serverId, mediaUrl: serverMedia, audio: { url: publicSoundUrl } })` call INSIDE `runUpload`. That call expects a local PostsStore entry to exist (so it can patch it). After v118, no entry exists yet → updatePost is a no-op → `addPost(userPost)` at success-time commits the **original userPost** with `tempId` + dead `blob:` URLs.

### The three cascading bugs (fixed in v120.1)
- **6 copies on /me/posts per upload** — local entry id=tempId, remote row id=serverId, /me's id-only dedup misses → 1 local + 1 remote × retries.
- **Custom audio playback silent** — PostsStore `audio.url` = dead `blob:` from upload tab; feed `<audio src=…>` hits a 404.
- **Text/emoji overlays not visible on upload** — PostsStore `mediaUrl` = original pre-compression blob; the compressed-with-overlays blob the server actually stored never made it back into PostsStore.

#### v120.1 fix — refactor runUpload's return contract
`runUpload` now returns `{ ok, serverId, serverMedia, serverPoster, serverSoundUrl }` on success. Both `post()` and `retry()` build a `finalPost` from those server values and addPost THAT — not the original userPost. The no-op `updatePost(tempId, …)` call inside runUpload is gone; `updatePost` removed from runUpload's deps. Also added a content-fingerprint dedup backstop to /me's `allPosts` merge (`kind | last 96 chars of mediaUrl | first 60 chars of caption`) so any legacy localStorage entries from before v120.1 still dedup cleanly against fresh remote rows.

### /me/posts was rendering BARE video — caption + audio + filter + hotel pill all missing
User opened a fresh upload on /me/posts after v120.1 and reported: the audio file name showed but no sound played, the IG filter wasn't applied, no hotel pill, no location pill, and the comments drawer was a literal placeholder ("No comments yet — be the first…") with no input.

#### v121 fix — FeedPost type was missing the fields entirely
The `FeedPost` shape in `components/PostsScrollFeed.tsx` literally lacked `audioUrl`, `hotelName`, `filterPreset` — the Composer was writing them but the render layer dropped them on the floor. Pre-v121 nobody on /me/posts saw the picked audio play or the filter render. Specific shipments:
- Added `audioUrl`, `hotelName`, `filterPreset` to `FeedPost` + `/me/posts` + `/saved/posts` mappers now pass them through.
- Hidden `<audio src={post.audioUrl}>` mounts on every video card. Plays in sync with `isActive + global mute`. Video muted when custom audio is in play so the two tracks don't double up.
- Video + img get `style={{ filter: filterCssFor(post.filterPreset) }}` so the on-card render matches what the composer preview looked like.
- Generic "🏨 View hotel ›" CTA replaced with a meta-pill row surfacing 📍 location + 🏨 At {hotelName}.
- Real comments drawer: scrollable thread + sticky text input + Send. Comments persist to `localStorage.sb_post_comments_v1` keyed by post id. (Backend wire-up to `/api/social/posts/<id>/comments` is a follow-up — input works locally today.)
- Edit-post sheet's "Hotel ID" raw-cuid input replaced with a searchable hotel picker that debounces `/api/hotels?search=&limit=8` and shows name + city for each result. Current pick shows as a removable pill above the search box.

### Logout button "did nothing" on the laptop (v121.1)
User reported tapping Log out multiple times with no visible effect, AND signing in with a different Google account on the same device was blocked.

#### Root cause
`logout()` cleared OUR localStorage (`sb_token` / `sb_user` / `sb_token_type`) but NEVER called `firebaseSignOut()`. For Google / Phone OTP accounts that flowed through Firebase, the auth state lives in IndexedDB (`firebaseLocalStorageDb`). We never touched it, so Firebase kept the original user signed in. The Google popup at /auth showed the same account pre-selected with no way to switch.

Three smaller cousins of the same bug were also live:
- Partner panel (`sb_partner_token`) and admin panel (`sb_admin_token`) keys weren't cleared on customer logout. Switching accounts on a dev device could carry partner OR admin auth across.
- Per-user local caches (`sb_user_posts`, `sb_local_saves`, `sb_post_comments_v1`, `sb_post_likes_v1`) survived logout and mixed identities into the next account.
- `router.push("/")` was a soft navigation — React kept showing chrome built from stale auth context. User saw nothing change, hit logout again, repeat.

#### v121.1 fix — full sequence
1. Wipe `sb_token` / `sb_user` / `sb_token_type`.
2. Wipe `sb_partner_token` / `sb_partner_user` / `sb_admin_token` / `sb_admin_user`.
3. Wipe `sb_user_posts` / `sb_local_saves` / `sb_post_comments_v1` / `sb_post_likes_v1`.
4. `firebaseSignOut(firebaseAuth)` — fire-and-forget so a slow Google round-trip doesn't block the visible logout.
5. `setToken(null)` / `setUser(null)` / `setTokenType("backend")`.
6. Dispatch `sb:tier-refresh` so TierProvider re-probes immediately.
7. `window.location.replace("/auth")` — HARD navigation, no back-button return to a half-logged-out screen.

### The duplicate-writer smoking gun (v121.2)
After v121 the user on the **correct account** ran the v121 diagnostic snippet and surfaced this exact pattern:

```
row #1: 01:26:08 AM · client_post_id="post-1778788555406-yu01cx"  ← Composer.runUpload (correct, dedup-protected)
row #2: 01:26:14 AM · client_post_id=NULL                          ← rogue second writer
```

Two `social_posts` rows, six seconds apart, same caption / audio / hotel. One had `client_post_id`; one didn't.

#### Root cause
`components/discover/InstagramHotelFeed.tsx` had a legacy `onPosted` callback that ran a FULL second upload pipeline (`uploadSocialMedia` + POST `/api/social/posts`) every time the Composer finished. **Without `clientPostId`.** This was correct in v97-v109 when CreateFlow.Composer was a local-only persistence layer. Starting v110-v111, the Composer's own `runUpload()` began doing the Storage push + the social_posts insert itself — making the callback REDUNDANT. Nobody removed it. Every upload silently created two rows AND two video files in the Storage bucket.

#### v121.2 fix
Stripped the entire `(async () => { uploadSocialMedia + POST })()` block from `onPosted`. Kept only the toast + scroll-to-top + analytics event. The Composer's own pipeline does everything else with `clientPostId` for v111 idempotency.

### Lazy Firebase import (also v121.2)
v121.1's logout fix had a regression: top-level `import { firebaseAuth } from "@/lib/firebase"` + `import { signOut } from "firebase/auth"` triggered `getAuth(app)` during SSR for every page that uses auth (which is almost every customer page). When `NEXT_PUBLIC_FIREBASE_API_KEY` wasn't present (local dev, preview/build envs without env vars), SSR crashed with `auth/invalid-api-key`.

Moved the Firebase imports to a lazy dynamic import INSIDE the `logout()` function body:
```ts
Promise.all([import("@/lib/firebase"), import("firebase/auth")]).then(([m1, m2]) => {
  if (m1?.firebaseAuth && typeof m2?.signOut === "function") {
    m2.signOut(m1.firebaseAuth).catch(() => {});
  }
}).catch(() => {});
```
SSR never touches firebase/auth. Runs only on the browser-side click. Verified `/me` returns 200 from SSR without env vars.

### Files modified across the era
```
lib/auth.tsx                                # v121.1 / v121.2 — full logout sequence + lazy Firebase imports
lib/posts-store.tsx                         # (existing, unchanged)

app/me/page.tsx                             # v120.1 — content-fingerprint dedup backstop
app/me/posts/page.tsx                       # v121 — pass audioUrl/hotelName/filterPreset/location
app/saved/posts/page.tsx                    # v121 — same field plumbing

components/discover/CreateFlow.tsx          # v120.1 — runUpload returns server metadata; post()/retry() build finalPost
components/discover/InstagramHotelFeed.tsx  # v121.2 — onPosted no longer re-uploads / re-POSTs

components/PostsScrollFeed.tsx              # v121 — FeedPost fields, CSS filter on video/img, hotel-name pill,
                                            #         meta-pill row, real comments drawer with input, searchable
                                            #         hotel picker in Edit-post sheet
app/layout.tsx                              # SB_BUILD + badge bumped per release
```

### Server-side data findings (v121 diagnostic)
- `social_posts.client_post_id` column EXISTS (migration `2026-05-14-social-posts-client-idempotency.sql` was applied).
- 32 total rows in the DB at v121 ship time. Only 2 had `client_post_id` populated — both from after v110/v111 / from real Composer flow. The other 30 were from the rogue InstagramHotelFeed writer (no clientPostId) + legacy uploads before idempotency was wired.
- v121.2 kills the rogue writer entirely → every NEW upload from v121.2 forward will carry a `client_post_id` and be dedup-protected on the server.

### Things to Avoid (v120.1 → v121.2 Era)
- **Never** re-add a SECOND writer to `/api/social/posts` outside of `CreateFlow.runUpload`. The InstagramHotelFeed `onPosted` callback EXPLICITLY does not do a server write any more. Any new "after-post hook" must touch only side-effects (toast, scroll, analytics, tracking events) — NOT call `uploadSocialMedia` or POST to `/api/social/posts`.
- **Never** commit a post to PostsStore using `userPost` from BEFORE `runUpload`. The original `userPost` carries `id: tempId` + `mediaUrl: blob:...` + `audio.url: blob:...`. Build a `finalPost` from `runUpload`'s `{ serverId, serverMedia, serverPoster, serverSoundUrl }` return and addPost THAT.
- **Never** import `@/lib/firebase` or `firebase/auth` at the top of `lib/auth.tsx`. Top-level imports trigger `getAuth(app)` during SSR, which crashes when `NEXT_PUBLIC_FIREBASE_API_KEY` isn't present (any dev environment, any preview without Firebase env vars wired). Use the dynamic-import-inside-logout pattern.
- **Never** strip `firebaseSignOut` from the logout sequence. Firebase persists the auth state in IndexedDB — clearing our localStorage alone leaves the previous user signed in to Firebase, blocking the Google picker on /auth from offering a different account.
- **Never** strip the per-user localStorage cache clears from logout (`sb_user_posts`, `sb_local_saves`, `sb_post_comments_v1`, `sb_post_likes_v1`). Without these, the next account inherits the previous account's local posts/saves/likes/comments — visible identity mixing.
- **Never** drop the `clientPostId` field from `POST /api/social/posts` body. The server's `client_post_id` column + the partial unique index on `(author_id, client_post_id)` are how v111 dedup works. A body without `clientPostId` slips past the idempotency check entirely.
- **Never** soft-navigate after logout. Use `window.location.replace("/auth")`. React closures hold stale auth context across `router.push` and the chrome doesn't visibly update; users tap Log out repeatedly thinking it didn't work.
- **Never** revert FeedPost back to lacking `audioUrl` / `hotelName` / `filterPreset`. Those three fields are what make /me/posts and /saved/posts actually render the post the way the creator made it. Dropping them silently degrades to bare-video rendering.
- **Never** mount the PostsScrollFeed comments drawer as a placeholder again. v87 shipped it that way (just an empty-state message + Close button) and it caused months of "comment kar nahi sakte" reports. The v121 input + persistent list is the minimum bar.
- **Never** render the Edit-post hotel field as a raw cuid input. Users don't know hotel ids. Show NAME via the searchable `/api/hotels?search=` picker, store id under the hood.

### What this era did NOT do
- **Cleanup tool for legacy duplicate rows.** v121's diagnostic snippet + the per-post DELETE endpoint exist, but there's no UI in /me yet to bulk-delete legacy test rows. Users who built up duplicates pre-v121.2 still need to run the console cleanup script. A "Manage my posts" UI inside /me settings is the right follow-up.
- **Backend-wired comments.** v121's comment drawer persists to localStorage only. Cross-device comment history needs `/api/social/posts/<id>/comments` POST + GET + a `social_post_comments` table. Out of scope for this hardening pass.
- **Server-side audit of the 30 rogue rows.** They're orphan rows from before v121.2, mostly null-caption test uploads. Could be cleaned up via a Supabase SQL run (`DELETE FROM social_posts WHERE client_post_id IS NULL AND created_at < '2026-05-15'`) but no automated migration shipped here — user can run it after backing up the table.
- **Emoji / hashtag toolbar in the Edit-post caption.** Composer already has these; for the edit sheet they're a follow-up polish. The current textarea works; just doesn't give users the same emoji bar Composer has.

---

## Updated production state (v121.2, 2026-05-15)
- **Current version:** v121.2 · commit `8234db1` on `main` · branch `claude/adoring-bouman-c84ef6`
- **One upload = one row.** The duplicate-writer in InstagramHotelFeed is gone; every upload now goes through Composer.runUpload only, which sends `clientPostId` so v111 server-side dedup catches double-fires.
- **Logout works on first click.** Full key wipe + Firebase signOut + hard-redirect to `/auth`. Lazy dynamic Firebase imports so SSR stays clean without env vars.
- **/me/posts renders posts properly.** Audio plays, IG filter applied, location pill + named hotel pill, real comment input that persists locally, hotel-edit by searchable name (not cuid).
- **Local PostsStore + remote rows align by id.** v120.1's runUpload contract ensures the local entry's id matches the remote `social_posts.id` from the first commit, so /me dedup catches them as the same post.
- **All five patches deployed live** on `staybids.in`. `SB_BUILD=v121.2-kill-duplicate-writer-lazy-firebase`. Vercel build times were all sub-90s; cache names stayed stable (no SW invalidation needed per v93 discipline).


## Hotel Performance Scorecard + Live City Rank Era (v128, 2026-05-16)

Single-shot release. Customer asked for "ek score card jo multipal checkpoints par score generate karega out of 100 + ushki rank city main jitne hotels hai un main se" — a luxury, clickable, premium live badge on every hotel that surfaces a 0-100 performance score + competitive rank within the same city. Every checkpoint they listed (bid response speed, room ready, check-in/out punctuality, verification video, smiley feedback, complaint rate + resolution) is wired end-to-end with a couple of additions for completeness.

### What ships in v128
- **10-checkpoint weighted score engine** (`lib/hotel-score.ts`) — pure functions, deterministic, no Supabase calls in the compute layer.
- **`hotel_scores` + `hotel_score_history` cache tables** (`migrations/2026-05-16-hotel-scorecard.sql`) — cached per-hotel overall + rank-in-city + per-checkpoint JSONB breakdown + once-a-day history snapshot.
- **3 API routes** — customer-facing scorecard fetch, admin/cron bulk recompute, lifecycle cron sweep.
- **Premium luxury badge** (`HotelScoreBadge.tsx`) — animated SVG ring + CountUp + champagne sweep + LIVE pulse dot + 3 size variants (hero / card / compact).
- **Detailed clickable modal** (`HotelScorecardModal.tsx`) — full 10-checkpoint breakdown with per-card sentiment-tinted bars + evidence lines + headline counts + "Compare with all N hotels in {city}" CTA.
- **Wired into 2 surfaces** — `/hotels/[id]` hero ribbon (hero variant) + `/hotels` list cards (card variant).
- **Lazy-recompute on cold cache** + Sweep 5 in feedback-lifecycle cron for recent-activity refresh.
- **Bulletproof city rank** — recomputed across every touched city in a second pass so all hotels' ranks stay consistent against the latest snapshot.

### The 10 checkpoints (weights sum to 100)

| Weight | Checkpoint | Signal | Compute |
|---|---|---|---|
| 15 | ⚡ Bid Response Speed | `bids.updatedAt - createdAt` for ACCEPTED/COUNTER bids | <5min → 15 · <15 → 12 · <30 → 9 · <60 → 6 · <3h → 3 · else 0 |
| 10 | 🤝 Bid Acceptance Rate | ACCEPTED / (ACCEPTED+REJECTED+EXPIRED+COUNTER) | linear × 10 |
| 5 | ↔️ Counter Conversion | counter bids that ended ACCEPTED | linear × 5; no-data → 60% baseline credit |
| 5 | 🛏️ Room Ready Timeliness | `booking_messages` from sender=hotel matching `/(ready|prepared|early check)/i` vs `bid_requests.checkIn` | early ≥0 → 5 · 0-30min late → 4 · 30-90 → 2 · else 0 |
| 5 | 🗝️ Check-in & Check-out | bids with status CHECKED_IN/CHECKED_OUT vs checkIn date (±6h tolerance) | linear × 5 |
| 10 | 🎥 Verification Video Health | `vp_requests.hotel_video_id` fulfilled rate + `vp_videos.status=approved` rate | half on link rate, half on approval rate |
| 25 | 😊 Guest Stay Feedback | every `complaints.feedbackType=stay_feedback` row × 5 smiley keys; positive=100, neutral=50, negative=0; auto-filled positives count as 75 (soft-positive, anti-farm) | weighted avg × 25 |
| 10 | 🛟 Complaint Rate | (general complaints / total bookings) — inverted | 0% → 10 · 5% → 7 · 10% → 4 · 20% → 1 · 30%+ → 0 |
| 10 | ✅ Complaint Resolution | `status=resolved` weighted by resolution time (24h → 100%, 48h → 75%, 7d → 50%, longer → 25%) | weightedSum / total × 10 |
| 5 | 📈 Booking Volume | `bookingsWithDates.length` (engagement bonus) | ≥100 → 5 · ≥50 → 4 · ≥20 → 3 · ≥5 → 2 · ≥1 → 1 · else 0 |

**Unrated rule:** if a hotel has zero data across every checkpoint AND zero bookings, returns `overall: null + status: "unrated" + badge: { emoji: "✨", label: "New on StayBid" }` instead of 0/100. The badge UI renders a "NEW" pill instead of a numeric score.

**Smiley anti-farm:** the user-spec explicitly distinguishes between submitted positive feedback and auto-filled positives (cron sweep 1 in v127.1 auto-marks positive on timeout). To prevent hotels from gaming the score by hoping customers never submit, `smileyToScore("positive", autoFilled=true) → 75` not 100. Submitted positives still get full 100.

**No-data baseline credit:** checkpoints where the data path can't yet emit a signal (no bids responded, no booking_messages, no vp_requests yet) return a neutral 55-70% baseline so a brand-new hotel doesn't get punished for not having traffic yet. Once any data lands, the real signal takes over.

### Badge tiers (color + label per overall score)

| Score | Emoji | Label | Color (hex) | Status |
|---|---|---|---|---|
| ≥ 90 | 👑 | Elite | `#C9A66B` (champagne) | excellent |
| ≥ 80 | 💎 | Exceptional | `#7F9269` (cozy sage) | excellent |
| ≥ 70 | ⭐ | Excellent | `#7F9269` | good |
| ≥ 60 | ✨ | Good | `#D9BE82` (champagne-light) | good |
| ≥ 45 | ○ | Developing | `#D49583` (cozy rose) | fair |
| < 45 | △ | Needs Care | `#D49583` | developing |
| null | ✨ | New on StayBid | `#C9A66B` | unrated |

### Files added (this era)
```
migrations/2026-05-16-hotel-scorecard.sql        # hotel_scores + hotel_score_history + indexes + RLS
lib/hotel-score.ts                               # pure compute engine (~778 lines)
lib/hotel-score-data.ts                          # parallel Supabase REST loader
components/hotel/HotelScoreBadge.tsx             # premium animated badge (hero/card/compact)
components/hotel/HotelScorecardModal.tsx         # tap-for-breakdown modal
app/api/hotels/[id]/scorecard/route.ts           # GET scorecard + lazy recompute + city rank
app/api/admin/hotel-scores/recompute/route.ts    # POST bulk recompute (admin OR cron)
```

### Files modified (this era)
```
app/api/cron/feedback-lifecycle/route.ts         # +Sweep 5 hotel scorecard refresh + city rerank
app/hotels/[id]/page.tsx                         # +HotelScoreBadge variant="hero" under stats ribbon
app/hotels/page.tsx                              # +HotelScoreBadge variant="card" on each list card
```

### Architecture — read + write paths

**Customer read path (cold cache, first /hotels/[id] open):**
1. `<HotelScoreBadge hotelId={id} variant="hero" />` mounts on the hotel page
2. Self-fetches `/api/hotels/[id]/scorecard`
3. Route reads `hotel_scores` row → if missing OR older than 30 min → calls `recompute()` synchronously
4. `recompute()` calls `loadHotelScoreInputs()` (parallel Supabase REST: bids + complaints + vp_requests + vp_videos + bid_requests + booking_messages)
5. Feeds into `computeHotelScore(inputs)` → returns a complete `HotelScorecard` object
6. `rankWithinCity()` sorts every cached score in the city + injects this hotel's just-computed value to find rank/total/percentile
7. UPSERTs `hotel_scores` row with overall + rank + checkpoints JSONB
8. Returns the full payload (badge fills in, ring animates from 0 to score, rank chip CountUp)

**Hot cache path (subsequent opens within 30 min):**
1. Same fetch
2. Cache row is < 30 min old → returned as-is with no Supabase recompute
3. Server-side `sb-cache` (60s) keeps the hotel_meta read off Supabase for repeat opens
4. HTTP `Cache-Control: public, max-age=120, stale-while-revalidate=600` keeps it CDN-fresh too

**Cron refresh path (every hour via /api/cron/feedback-lifecycle):**
1. Existing Sweeps 1-4 run (auto-positive, verif purge, evidence purge, escalate)
2. Sweep 5 finds every hotel with bid/complaint activity in the last 6 hours
3. Recomputes each one's scorecard, UPSERTs `hotel_scores`
4. Reranks every touched city in a second pass so rank values stay coherent across the whole snapshot
5. Stats returned: `{ scorecardsRefreshed, citiesReranked }`

**Admin bulk recompute (manual or daily):**
1. `POST /api/admin/hotel-scores/recompute` recomputes ALL hotels
2. `?hotelId=X` recomputes one hotel only
3. `?city=Y` recomputes every hotel in that city
4. `?snapshot=1` ALSO writes a row to `hotel_score_history` for the trend sparkline
5. After recompute, every touched city is reranked
6. Audit log row written via existing `logAdminAction()` (v98 audit infra)

### UI: HotelScoreBadge component

Three size variants, all clickable to open the detail modal:

- **`variant="hero"`** — 158×184px. Used on `/hotels/[id]` directly below the v123 stats ribbon. Full circular SVG ring + CountUp animated score + rank pill + LIVE pulse dot + "Tap for full scorecard" eyebrow.
- **`variant="card"`** — 110×130px. Used on `/hotels` list cards. Same anatomy at compressed size — ring + score + rank.
- **`variant="compact"`** — chip-style flex-row. Tiny score + rank chip suitable for inline labels. Currently unused but available for future surfaces (admin tables, partner panel).

**Premium polish baked in:**
- Cozy cream → champagne gradient backdrop (light mode) ↔ warm-cocoa with cream text (dark mode)
- Conic-gradient halo behind the ring rotates every 12s with a champagne-tinted glow
- Smooth SVG ring with `stroke-linecap: round` + drop-shadow tinted to the badge color
- Cormorant Garamond italic score with `font-variant-numeric: tabular-nums` so the CountUp doesn't shift widths
- LIVE pill bottom + pulsing dot (1.6s `ease-in-out infinite`)
- Hover lift: `translateY(-2px) + box-shadow upgrade`
- `@media (prefers-reduced-motion: reduce)` kills the halo + live-pulse + ring transition

### UI: HotelScorecardModal

- Backdrop blur + bottom-sheet on mobile (<600px) / centered modal on desktop
- Hero: status-tinted gradient backdrop + animated overall score + status badge pill + 3-cell tally (Bookings / Stay reviews / Complaints)
- 10 checkpoint cards stacked vertically — each with: emoji + label + earned/weight + sentiment-tinted left border + evidence line ("Avg response time: 12 min") + horizontal gradient bar + sample-size footer
- "Compare with all N hotels in {city}" CTA at the bottom routes to `/hotels?city=X#scorecard-leaderboard` (anchor reserved for future leaderboard surface)
- Refresh button calls the badge's `onRefresh` (which re-fetches the scorecard)
- Esc closes; body-scroll-lock during open; click-outside closes

### Cron architecture (post-v128)
```
cron-job.org (free tier):
  /api/cron/expire-holds          every 15 min  → bid holds + auto-accept
  /api/cron/flash-drop            every 15 min  → flash deal drops + room recalc
  /api/cron/feedback-lifecycle    every hour    → 5 sweeps including hotel scorecard refresh

Vercel cron (Hobby plan — 2-cron cap):
  /api/cron/pricing               daily 4:00 AM → full scrape + recalc + flash (safety net)
  /api/cron/lifecycle             daily 4:05 AM → bid lifecycle daily report
```

Hotel scorecard recompute is opportunistic: hot hotels (any bid/complaint in last 6 hours) get refreshed on every feedback-lifecycle run; cold hotels rely on lazy-recompute when a customer opens their detail page. No new cron entry needed.

### Verified end-to-end (this build)
- Migration `v128_hotel_scorecard` applied via Supabase MCP → `{success: true}`. Both tables visible: `hotel_scores`, `hotel_score_history`. Indexes + RLS + permissive policies all in place.
- Bootstrap shape test (manually inserted + deleted a row): UPSERT path with `on_conflict=hotel_id` works correctly; NUMERIC(5,2) accepts decimal `72.50`; JSONB checkpoints column accepts empty array default.
- TypeScript `tsc --noEmit --skipLibCheck` returns ZERO errors across the 7 new files + 3 modified files. Previously surfaced `for..of Set<string>` errors (downlevelIteration trap noted in v94 era) fixed via `Array.from(touchedCities)` in both recompute route + cron sweep.
- Badge component reads theme tokens via CSS vars — light + dark modes both render correctly without per-component branches.
- Modal supports keyboard (Esc close), focus-trap intent (dialog role + aria-modal), body-scroll-lock, click-outside, full mobile bottom-sheet collapse.

### Things to Avoid (v128 Era)
- **Never** call `computeHotelScore` directly from a client component. It's pure but it expects all the side-loaded data already-fetched and shaped. The compute layer assumes the loader has already run; running it on the client would require shipping the loader + every Supabase REST call to the browser. Always go through `/api/hotels/:id/scorecard`.
- **Never** raise `REFRESH_AFTER_MS` past 30 minutes in the customer-facing route. Customers expect "just booked, score should update" — a longer staleness window means hotels see their score lag their actual activity. Cron Sweep 5 already covers active hotels every hour; lazy-recompute covers everything else when a customer opens the page.
- **Never** add a checkpoint without bumping the total to exactly 100. The `clamp(earned, 0, 100)` in `computeHotelScore` masks weight-sum drift but the badge ring math expects 0-100 exactly. Adjust existing weights instead of stacking new ones on top.
- **Never** raise `smileyToScore("positive", autoFilled=true)` back to 100. The 75 cap on auto-filled positives is the anti-farm guard explicitly requested by user spec — without it, hotels with poor customer engagement (customers don't bother submitting) end up scoring identically to hotels with great engagement (customers submit positive). Auto-positive should be soft credit, not full credit.
- **Never** strip the no-data baseline credit (55-70%) on checkpoints with zero samples. A brand-new hotel with no bids responded yet should NOT score 0 on bid-speed — the score reads "we don't know yet, so give partial credit". Without the baseline, every new hotel looks "Needs Care".
- **Never** add a `display_name` column or `creator_id` to `hotel_scores`. It's a per-hotel aggregate — adding per-creator or per-user columns invites mixed semantics. Use `hotel_score_history` for trend or join time-series via a separate table.
- **Never** rerank a city by reading `hotel_scores.rank_in_city` directly. ALWAYS sort by `overall` and rewrite the rank fields. The rank column is a denormalized snapshot, not the source of truth — sorting by it would create a feedback loop where stale ranks stay stale.
- **Never** call `/api/admin/hotel-scores/recompute` without an auth token on the public Internet. It accepts `?token=staybid-cron-dev` for dev OR `Bearer ${CRON_SECRET}` for cron-job.org OR `x-admin-token: adm_*` for admin manual triggers — same gate as `/api/cron/expire-holds`. An unprotected endpoint with computing power across every hotel = DoS surface.
- **Never** add a "Hide my score" toggle for partners. The whole point of the badge is competitive city-rank transparency — letting hotels hide their score would silently break the rank math (city total wouldn't include hidden hotels, percentile shifts unpredictably). If a partner has a legitimate complaint about a checkpoint result, that's a support ticket, not a hide button.
- **Never** raise the modal's `max-h: 92dvh` past 95dvh. On notch devices (iOS Dynamic Island, Samsung punch-hole) the safe-area top inset is ~58px, and pushing past 92dvh starts hiding the close button behind the camera notch. The current setup leaves clean space above + below.
- **Never** drop the `aria-label` with full score + rank context on the badge button. Screen readers read the badge as "score 82 out of 100, ranked 2nd of 18 in Mussoorie" — collapsing it to "score badge" makes the entire surface useless for accessibility.
- **Never** ship a new score badge variant without bumping the cozy palette CSS vars (`--cozy-champagne`, `--cozy-sage`, `--cozy-rose`). Hardcoded hex values across 3 size variants creates a maintenance debt; both light + dark mode tokens map through the CSS vars.

### What this era did NOT do (intentionally deferred)
- **Trend sparkline in the modal.** The `hotel_score_history` table exists + the recompute route supports `?snapshot=1`, but no cron currently writes daily snapshots. Wire `/api/admin/hotel-scores/recompute?snapshot=1` to a once-a-day cron to start filling the table. The modal can then read it via a new `/api/hotels/[id]/score-history?days=30` route.
- **City leaderboard surface.** Modal CTA routes to `/hotels?city=X#scorecard-leaderboard` but there's no leaderboard section on the hotels list page yet. Sort hotels by `hotel_scores.overall DESC NULLS LAST` and pin a "Top 5 in {city}" strip at the top of the list when the city filter is active.
- **Partner panel "your scorecard" tab.** Hotels can see their own score by visiting `/hotels/[id]` but a dedicated tab in `/partner/dashboard` with "Here's what's pulling your score down" coaching would be valuable. Pull from `hotel_scores.checkpoints` and surface every checkpoint with status `poor` or `fair`.
- **Admin scorecard analytics page.** Aggregate views across all hotels (avg score, lowest-scoring checkpoints platform-wide, score trend over time) — would slot well next to `/admin/analytics`. Skipped this round; the existing single-hotel modal covers the core need.
- **Real check-in/out timestamp columns.** The current `computeCheckInOut` heuristic accepts the status flip (`CHECKED_IN` / `CHECKED_OUT`) as a proxy for on-time arrival because there are no explicit `checkedInAt` / `checkedOutAt` columns yet. Adding those columns + collecting them from the partner panel "Mark checked in" button would massively sharpen this checkpoint.

---

## Updated production state (v128, 2026-05-16)
- **Current version:** v128 · worktree branch `musing-chatterjee-c488d1`
- **Migration applied live** to Supabase project `uxxhbdqedazpmvbvaosh`. Both new tables visible. RLS enabled + permissive `all_anon_all` policies in place (v99 baseline parity).
- **10-checkpoint score engine** lives in `lib/hotel-score.ts` (pure functions). Every checkpoint user mentioned is wired: bid response, room ready, check-in/out, verification video, smiley feedback, complaint rate + resolution. Plus 3 additions for completeness: acceptance rate, counter conversion, volume bonus.
- **Premium luxury badge** rendered on `/hotels/[id]` (hero variant under stats ribbon) + `/hotels` list cards (card variant). Tap → detailed modal with full 10-checkpoint breakdown + headline counts + Compare-in-city CTA.
- **Lazy + cron-driven refresh:** cold-cache or >30 min stale → recompute on customer page open. Active hotels (any bid/complaint in last 6h) refresh on every feedback-lifecycle cron tick. Touched cities reranked in second pass.
- **TypeScript clean** — no new errors. Both `for..of Set` traps in recompute route + cron sweep fixed with `Array.from()`.
- **Bulletproof for heavy traffic:** rank queries are O(N) per city via the cached `hotel_scores` table; lazy-recompute keeps cold-hotel pages from blocking on a full Supabase sweep; sb-cache + HTTP swr layers keep repeat opens cheap.

