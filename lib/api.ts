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

export const api = {
  sendOtp: (phone: string) => request("/api/auth/send-otp", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, otp: string) => request("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp }) }),
  getHotels: (params?: Record<string, string>) => {
    const merged = { limit: "50", ...params };
    const q = "?" + new URLSearchParams(merged).toString();
    return request(`/api/hotels${q}`);
  },
  getHotel: (id: string) => request(`/api/hotels/${id}`),
  createBidRequest: (data: any) => request("/api/bids/request", { method: "POST", body: JSON.stringify(data) }),
  placeBid: (data: any) => request("/api/bids/place", { method: "POST", body: JSON.stringify(data) }),
  getMyBids: () => request("/api/bids/my"),
  getFlashDeals: (city?: string) => request(`/api/flash/near${city ? `?city=${city}` : ""}`),
  getMyBookings: () => request("/api/bookings/my"),
  getWallet: () => request("/api/wallet"),
  updateProfile: (data: any) => request("/api/auth/profile", { method: "PUT", body: JSON.stringify(data) }),
  // Hotel owner — Next.js routes (Supabase direct, no Railway proxy)
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
};