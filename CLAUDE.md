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
