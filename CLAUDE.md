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

---

## Database State (as of Apr 2026)
- **Hotels:** 3 (hotel-1 Grand Hyatt Mumbai, hotel-2 The Leela Palace Delhi, hotel-3 Taj Lake Palace Udaipur)
- **Rooms:** 6 (2 per hotel)
- **Flash Deals:** 3 (one per hotel)
- **Missing:** hotel-4 "Dhanaulti Village Resort by Woodora" — INSERT kept returning 0 rows (Railway query UI bug suspected)
  - To add hotel-4, run this SQL in Railway → Data → Query:
  ```sql
  INSERT INTO hotels (id, name, city, "starRating", description, images, amenities, "checkInTime", "checkOutTime", "createdAt", "updatedAt")
  VALUES (
    'hotel-4',
    'Dhanaulti Village Resort by Woodora',
    'Dhanaulti',
    4,
    'A serene mountain retreat nestled in the Garhwal Himalayas at 2,200m altitude, offering breathtaking views of snow-capped Himalayan peaks.',
    ARRAY['https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800','https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800'],
    ARRAY['Mountain View','Bonfire','Trekking','Organic Meals','Free WiFi','Yoga Deck','Stargazing','Helipad'],
    '12:00', '11:00', NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO rooms (id, "hotelId", type, price, "floorPrice", description, capacity, amenities, images, "createdAt", "updatedAt")
  VALUES
    ('room-7','hotel-4','Himalayan Cottage',4500,3800,'Cozy wooden cottage with panoramic mountain views and private sit-out',2,ARRAY['Mountain View','Fireplace','Hot Water','Room Heater'],ARRAY['https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800'],NOW(),NOW()),
    ('room-8','hotel-4','Forest Suite',7200,6000,'Luxurious suite surrounded by oak and rhododendron forests with jacuzzi',3,ARRAY['Forest View','Jacuzzi','Fireplace','Mini Bar','Balcony'],ARRAY['https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800'],NOW(),NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO flash_deals (id, "hotelId", "roomId", price, discount, title, description, "validUntil", "maxBookings", "currentBookings", "isActive", "createdAt", "updatedAt")
  VALUES (
    'deal-4','hotel-4','room-7',2999,33,'Himalayan Escape','Wake up to snow-capped Himalayan peaks — limited rooms at this price!',
    TO_CHAR(NOW() + INTERVAL '12 hours','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),10,0,true,NOW(),NOW()
  ) ON CONFLICT (id) DO NOTHING;
  ```

---

## localStorage Keys Used
| Key | Value | Purpose |
|-----|-------|---------|
| `sb_token` | JWT string | Auth token |
| `sb_user` | JSON string | User object |
| `bid_dates_{bidId}` | `{"checkIn":"...","checkOut":"..."}` | Booking dates fallback |
| `deal_price_{bidId}` | Price string e.g. "2999" | Actual flash deal price for display |

---

## Pending / Known Issues
- **Hotel-4 Woodora** not in DB — use SQL above in Railway Query tab
- **Wallet balance** only shows when user has actually spent (no fake seed data)
- **Socket.io real-time** bid updates work when backend is awake (Railway cold starts ~30s)

---

## How to Start a New Session with Full Memory

Run this command inside the project folder:
```bash
claude "Read CLAUDE.md fully, then ask me what to work on next for StayBid frontend"
```
