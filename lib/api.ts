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
  // Loyalty points (Session 4)
  getPoints:        ()                                => direct("/api/points"),
  getPointsHistory: (limit = 50, offset = 0)          => direct(`/api/points/history?limit=${limit}&offset=${offset}`),
  redeemPoints:     (points: number, opts: { reason?: string; sourceType?: string; sourceId?: string } = {}) =>
    direct("/api/points/redeem", { method: "POST", body: JSON.stringify({ points, ...opts }) }),
  adminAdjustPoints: (userId: string, delta: number, reason?: string) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    return fetch("/api/admin/points/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ userId, delta, reason }),
    }).then(r => r.json());
  },
  getAdminRevenue:  () => fetch("/api/admin/revenue").then(r => r.json()),

  // Discovery & saves (Session 5)
  getDiscoverItems: (limit = 30) => fetch(`/api/discover/items?limit=${limit}`).then(r => r.json()),
  saveItem:    (targetType: "hotel" | "video" | "influencer" | "deal", targetId: string) =>
    direct("/api/discover/save",   { method: "POST",   body: JSON.stringify({ targetType, targetId }) }),
  unsaveItem:  (targetType: "hotel" | "video" | "influencer" | "deal", targetId: string) =>
    direct("/api/discover/save",   { method: "DELETE", body: JSON.stringify({ targetType, targetId }) }),
  getMySaves:  (type?: "hotel" | "video" | "influencer" | "deal") =>
    direct(`/api/discover/saves${type ? `?type=${type}` : ""}`),
  getPublicInfluencer: (id: string) =>
    fetch(`/api/influencer/public/${encodeURIComponent(id)}`).then(r => r.json()),

  // Notifications + admin overview (Session 6)
  enqueueNotification: (data: { channel: "email" | "sms" | "push" | "whatsapp"; template: string; payload?: any; userId?: string; scheduledAt?: string }) =>
    direct("/api/notifications/queue", { method: "POST", body: JSON.stringify(data) }),
  getAdminOverview:    () => fetch("/api/admin/overview").then(r => r.json()),
  getAdminNotifications: (status: "pending" | "sent" | "failed" | "all" = "pending") =>
    fetch(`/api/admin/notifications?status=${status}`).then(r => r.json()),

  // Hotel videos (Session 2) — room walkthroughs uploaded by hotels, moderated by admin
  uploadVideo: (data: {
    hotelId: string; videoUrl: string; roomType?: string; roomId?: string; title?: string;
    thumbnailUrl?: string; durationSeconds?: number; quality?: string; sizeBytes?: number;
  }) => direct("/api/videos/upload", { method: "POST", body: JSON.stringify(data) }),
  getHotelVideos:    (hotelId: string, status?: string) =>
    direct(`/api/videos/${encodeURIComponent(hotelId)}${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  deleteVideo:       (id: string) =>
    direct(`/api/videos/delete/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getAdminVideoQueue: (status: "pending" | "approved" | "rejected" | "all" = "pending") =>
    fetch(`/api/admin/videos/pending?status=${status}`).then(r => r.json()),
  approveVideo: (id: string) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    return fetch(`/api/admin/videos/${encodeURIComponent(id)}/approve`, {
      method: "POST", headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    }).then(r => r.json());
  },
  rejectVideo: (id: string, reason: string) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    return fetch(`/api/admin/videos/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({ reason }),
    }).then(r => r.json());
  },

  getMyInfluencer:           ()                      => direct("/api/influencer/me"),
  registerInfluencer:        (data: any)             => direct("/api/influencer/register", { method: "POST", body: JSON.stringify(data) }),
  verifyInfluencer:          (data: any)             => direct("/api/influencer/verify",   { method: "POST", body: JSON.stringify(data) }),
  getInfluencerProfile:      (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}`),
  updateInfluencerProfile:   (id: string, data: any) => direct(`/api/influencer/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  getInfluencerStats:        (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}/stats`),
  getInfluencerEarnings:     (id: string, status?: string) =>
    direct(`/api/influencer/${encodeURIComponent(id)}/earnings${status ? `?status=${encodeURIComponent(status)}` : ""}`),
};
