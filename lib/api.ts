const RAILWAY = "https://staybid-live-production.up.railway.app";
// In the browser, route through the Vercel proxy so ISPs that block Railway
// (e.g. Jio) still work. On the server we call Railway directly.
const API =
  typeof window === "undefined"
    ? RAILWAY
    : "/api/proxy";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Retry on 500/503 (connection pool exhausted) with exponential backoff
async function request(path: string, opts?: RequestInit, retries = 3): Promise<any> {
  const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });

  // Connection pool timeout → retry with backoff
  if ((res.status === 500 || res.status === 503) && retries > 0) {
    const body = await res.text();
    if (body.toLowerCase().includes("connection pool") || body.toLowerCase().includes("timeout")) {
      await sleep((4 - retries) * 1500); // 1.5s, 3s, 4.5s
      return request(path, opts, retries - 1);
    }
    const err = (() => { try { return JSON.parse(body); } catch { return { error: res.statusText }; } })();
    throw new Error(err.error || "Something went wrong");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Something went wrong");
  }
  return res.json();
}

// Direct call to Next.js API route (Supabase-backed, bypasses Railway)
async function direct(path: string, opts?: RequestInit): Promise<any> {
  const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  const text = await res.text();
  const data = (() => { try { return JSON.parse(text); } catch { return { error: text }; } })();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

export const api = {
  // Auth — still via Railway (OTP provider lives there)
  sendOtp:   (phone: string) => request("/api/auth/send-otp",   { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, otp: string) => request("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp }) }),

  // Hotels, bids, flash deals, bookings — Supabase direct via Next.js routes
  getHotels: (params?: Record<string, string>) => {
    const q = params && Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
    return direct(`/api/hotels${q}`);
  },
  getHotel:          (id: string)  => direct(`/api/hotels/${id}`),
  createBidRequest:  (data: any)   => direct("/api/bids/request", { method: "POST", body: JSON.stringify(data) }),
  placeBid:          (data: any)   => direct("/api/bids/place",   { method: "POST", body: JSON.stringify(data) }),
  acceptBid:         (id: string)  => direct(`/api/bids/${id}/accept`, { method: "POST" }),
  getMyBids:         ()            => direct("/api/bids/my"),
  getFlashDeals:     (city?: string) => direct(`/api/flash/near${city ? `?city=${encodeURIComponent(city)}` : ""}`),
  getMyBookings:     ()            => direct("/api/bookings/my"),

  // Wallet — Supabase-backed Next.js route (Railway cold-starts too often).
  // Derives totals from accepted bids + real bookings.
  getWallet:     () => direct("/api/wallet"),
  updateProfile: (data: any) => request("/api/auth/profile", { method: "PUT", body: JSON.stringify(data) }),

  // Hotel owner — existing Next.js routes
  getOwnerHotel: () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    return fetch("/api/owner/hotel", {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then((r) => r.json());
  },
  updateRoomPricing: (roomId: string, data: { floorPrice?: number; flashFloorPrice?: number }) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    return fetch(`/api/rooms/${roomId}/pricing`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    }).then((r) => r.json());
  },

  // Influencer system — Supabase-backed Next.js routes (no Railway dependency).
  // `id` accepts either the influencer row id (`inf_...`) or the underlying user_id.
  getMyInfluencer:           ()                      => direct("/api/influencer/me"),
  registerInfluencer:        (data: any)             => direct("/api/influencer/register", { method: "POST", body: JSON.stringify(data) }),
  verifyInfluencer:          (data: any)             => direct("/api/influencer/verify",   { method: "POST", body: JSON.stringify(data) }),
  getInfluencerProfile:      (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}`),
  updateInfluencerProfile:   (id: string, data: any) => direct(`/api/influencer/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  getInfluencerStats:        (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}/stats`),
  getInfluencerEarnings:     (id: string, status?: string) =>
    direct(`/api/influencer/${encodeURIComponent(id)}/earnings${status ? `?status=${encodeURIComponent(status)}` : ""}`),
};
