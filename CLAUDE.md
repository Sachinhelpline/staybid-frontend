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
- **v18** — Desktop nav Reels link visible (current)

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
- Branch: `claude/frosty-khorana-a44bd9` (also pushed to `main`, both auto-deploy)
- Current production version: **v18** (commit `0efb0c4`)
- Supabase project: `uxxhbdqedazpmvbvaosh` — use `lib/sb.ts` helpers for any new Next.js API route
- Live site: `https://www.staybids.in` served from Vercel project `staybid-customer-frontend` (NOT `staybid-frontend`)
- All 12+ Supabase tables live, ALL triggers + RPCs live (no backend Railway changes needed)
- Pattern: additive migrations only, TEXT IDs (CUIDs), Bearer token via `userFromReq()`, push to branch then `branch:main`
- Always bump `public/sw.js` CACHE_NAME + `app/layout.tsx` SB_BUILD + badge together when shipping UI changes
