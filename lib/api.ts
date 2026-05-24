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

// Direct call to Next.js API route (Supabase-backed, bypasses Railway).
// On non-OK the thrown Error carries `status` + the parsed `body` so
// callers can branch on response shape (e.g. 409 conflict on placeBid).
export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}
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
  if (!res.ok) throw new ApiError(data?.error || "Something went wrong", res.status, data);
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
  // Wraps the underlying call so a stored sb_ref code (set by /r/[code]) is
  // auto-attributed to the new bid_request — closes the referral loop without
  // touching every booking handler.
  createBidRequest:  async (data: any) => {
    const result = await direct("/api/bids/request", { method: "POST", body: JSON.stringify(data) });
    try {
      const ref = typeof window !== "undefined"
        ? (localStorage.getItem("sb_ref") || (document.cookie.match(/(?:^|;\s*)sb_ref=([^;]+)/)?.[1] || ""))
        : "";
      const reqId = result?.request?.id || result?.id;
      if (ref && reqId) {
        await direct("/api/referrals/attribute", { method: "POST", body: JSON.stringify({ requestId: reqId, code: decodeURIComponent(ref) }) }).catch(() => {});
      }
    } catch {}
    return result;
  },
  placeBid:          (data: any)   => direct("/api/bids/place",   { method: "POST", body: JSON.stringify(data) }),
  // PATCH amount on an active bid (PENDING/COUNTER). Used by the "Update
  // Budget" slider in /my-bids and the 409-conflict sheet on /bid +
  // /hotels/[id] — one active bid per (customer × city), so re-bidding is
  // explicitly a budget update instead of a brand-new bid.
  updateBidBudget:   (id: string, amount: number, flow?: "place" | "negotiate") =>
    direct(`/api/bids/${id}/budget`, { method: "PATCH", body: JSON.stringify({ amount, flow }) }),
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
  // Influencer referrals (Session 3)
  resolveReferral:    (code: string) => fetch(`/api/referrals/resolve/${encodeURIComponent(code)}`).then(r => r.json()),
  trackReferral:      (code: string, opts: { eventType?: "click" | "signup" | "bid" | "booking"; targetType?: string; targetId?: string } = {}) =>
    direct("/api/referrals/track", { method: "POST", body: JSON.stringify({ code, ...opts }) }),
  attributeReferral:  (requestId: string, code: string) =>
    direct("/api/referrals/attribute", { method: "POST", body: JSON.stringify({ requestId, code }) }),
  listReferralCodes:  (influencerId: string) =>
    direct(`/api/influencer/${encodeURIComponent(influencerId)}/codes`),
  createReferralCode: (influencerId: string, data: { label?: string | null; hotelId?: string | null; code?: string } = {}) =>
    direct(`/api/influencer/${encodeURIComponent(influencerId)}/codes`, { method: "POST", body: JSON.stringify(data) }),

  // Loyalty points (Session 4)
  getPoints:        ()                                => direct("/api/points"),
  getPointsHistory: (limit = 50, offset = 0)          => direct(`/api/points/history?limit=${limit}&offset=${offset}`),
  redeemPoints:     (points: number, opts: { reason?: string; sourceType?: string; sourceId?: string } = {}) =>
    direct("/api/points/redeem", { method: "POST", body: JSON.stringify({ points, ...opts }) }),

  // v124 — StayPoints redemption system: catalog, code-issue, codes wallet,
  // validation, and apply-to-booking. Wallet credit + coupon + amenity kinds.
  getRedemptionRules: () => fetch("/api/redemption/rules").then(r => r.json()),
  redeemRule:         (ruleIdOrSlug: { ruleId?: string; slug?: string }) =>
    direct("/api/redemption/redeem", { method: "POST", body: JSON.stringify(ruleIdOrSlug) }),
  getMyRedemptionCodes: (status?: "active" | "used" | "expired") =>
    direct(`/api/redemption/codes${status ? `?status=${status}` : ""}`),
  validateRedemptionCode: (code: string, bookingTotal?: number) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    const qs = new URLSearchParams({ code });
    if (bookingTotal) qs.set("bookingTotal", String(bookingTotal));
    return fetch(`/api/redemption/validate?${qs.toString()}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    }).then((r) => r.json());
  },
  applyRedemption: (data: { bidId: string; couponCode?: string; walletCreditInr?: number }) =>
    direct("/api/redemption/apply", { method: "POST", body: JSON.stringify(data) }),
  // Partner-side
  partnerValidateCode: (code: string) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") : null;
    return fetch(`/api/partner/redemption?code=${encodeURIComponent(code)}`, {
      headers: t ? { "x-partner-token": t } : {},
    }).then((r) => r.json());
  },
  partnerFulfillCode: (data: { code: string; hotelId: string }) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") : null;
    return fetch(`/api/partner/redemption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { "x-partner-token": t } : {}) },
      body: JSON.stringify(data),
    }).then((r) => r.json());
  },
  // Admin-side
  adminGetRedemptionRules: () => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    return fetch("/api/admin/redemption-rules", {
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    }).then((r) => r.json());
  },
  adminUpsertRedemptionRule: (rule: any) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    return fetch("/api/admin/redemption-rules", {
      method: rule.id ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { "x-admin-token": t } : {}),
        ...(u?.id ? { "x-admin-id": u.id } : {}),
      },
      body: JSON.stringify(rule),
    }).then((r) => r.json());
  },
  adminDeleteRedemptionRule: (id: string) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    return fetch(`/api/admin/redemption-rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    }).then((r) => r.json());
  },
  adminGetRedemptionCodes: (params: Record<string, string> = {}) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    const qs = new URLSearchParams(params).toString();
    return fetch(`/api/admin/redemption-codes${qs ? "?" + qs : ""}`, {
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    }).then((r) => r.json());
  },
  adminRedemptionCodeAction: (id: string, action: "revoke" | "extend", days?: number) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    return fetch(`/api/admin/redemption-codes`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(t ? { "x-admin-token": t } : {}),
        ...(u?.id ? { "x-admin-id": u.id } : {}),
      },
      body: JSON.stringify({ id, action, days }),
    }).then((r) => r.json());
  },
  adminGetRedemptionAnalytics: (days = 30) => {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
    return fetch(`/api/admin/analytics/redemption?days=${days}`, {
      headers: { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) },
    }).then((r) => r.json());
  },
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

  // Social graph — likes, comments, follows
  toggleVideoLike:     (videoId: string) =>
    direct(`/api/videos/like/${encodeURIComponent(videoId)}`, { method: "POST" }),
  checkVideoLike:      (videoId: string) =>
    fetch(`/api/videos/like/${encodeURIComponent(videoId)}`, {
      headers: typeof window !== "undefined" && localStorage.getItem("sb_token")
        ? { Authorization: `Bearer ${localStorage.getItem("sb_token")}` }
        : {},
    }).then(r => r.json()),
  getVideoComments:    (videoId: string) =>
    fetch(`/api/videos/comments/${encodeURIComponent(videoId)}`).then(r => r.json()),
  postComment:         (videoId: string, body: string, parentId?: string) =>
    direct(`/api/videos/comments/${encodeURIComponent(videoId)}`, {
      method: "POST", body: JSON.stringify({ body, parentId }),
    }),
  deleteComment:       (videoId: string, commentId: string) =>
    direct(`/api/videos/comments/${encodeURIComponent(videoId)}`, {
      method: "DELETE", body: JSON.stringify({ commentId }),
    }),
  toggleFollow:        (influencerId: string) =>
    direct(`/api/influencer/follow/${encodeURIComponent(influencerId)}`, { method: "POST" }),
  checkFollow:         (influencerId: string) =>
    fetch(`/api/influencer/follow/${encodeURIComponent(influencerId)}`, {
      headers: typeof window !== "undefined" && localStorage.getItem("sb_token")
        ? { Authorization: `Bearer ${localStorage.getItem("sb_token")}` }
        : {},
    }).then(r => r.json()),
  getVideoFeed:        (limit = 20, offset = 0) =>
    fetch(`/api/videos/feed?limit=${limit}&offset=${offset}`).then(r => r.json()),
  getMyCreatorVideos:  () =>
    fetch("/api/influencer/my-videos", {
      headers: typeof window !== "undefined" && localStorage.getItem("sb_token")
        ? { Authorization: `Bearer ${localStorage.getItem("sb_token")}` }
        : {},
    }).then(r => r.json()),

  getMyInfluencer:           ()                      => direct("/api/influencer/me"),
  registerInfluencer:        (data: any)             => direct("/api/influencer/register", { method: "POST", body: JSON.stringify(data) }),
  verifyInfluencer:          (data: any)             => direct("/api/influencer/verify",   { method: "POST", body: JSON.stringify(data) }),
  getInfluencerProfile:      (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}`),
  updateInfluencerProfile:   (id: string, data: any) => direct(`/api/influencer/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  getInfluencerStats:        (id: string)            => direct(`/api/influencer/${encodeURIComponent(id)}/stats`),
  getInfluencerEarnings:     (id: string, status?: string) =>
    direct(`/api/influencer/${encodeURIComponent(id)}/earnings${status ? `?status=${encodeURIComponent(status)}` : ""}`),

  // ── Complaints + feedback (v98) ─────────────────────────────────────
  submitComplaint:  (data: {
    type: string;
    subject?: string;
    description: string;
    priority?: "low" | "medium" | "high";
    bookingId?: string;
    hotelId?: string;
    bidId?: string;
    paymentId?: string;
  }) => direct("/api/complaints/submit", { method: "POST", body: JSON.stringify(data) }),

  getMyComplaints:  () => direct("/api/complaints/my"),

  submitFeedback:   (data: { bookingId: string; rating: number; comments?: string }) =>
    direct("/api/feedback/submit", { method: "POST", body: JSON.stringify(data) }),

  getFeedbackState: (bookingId: string) =>
    fetch(`/api/feedback/submit?bookingId=${encodeURIComponent(bookingId)}`).then(r => r.json()),

  // 2-Tier System — Phase 2 endpoints (additive; never replaces existing api methods)
  getMyTier:               () => direct("/api/me/tier"),
  getEligibleBookings:     () => direct("/api/me/eligible-bookings"),

  uploadVerifiedGuestPost: (data: {
    bookingId: string;
    hotelId: string;
    mediaType: "PHOTO" | "REEL" | "STORY";
    mediaUrl: string;
    thumbnailUrl?: string;
    caption?: string;
    soundTrack?: string;
    soundUrl?: string;
    locationName?: string;
    locationLat?: number;
    locationLng?: number;
    clientPostId?: string;
    highlightKey?: string;
    filter?: string;
  }) =>
    direct("/api/social/posts/verified-guest", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  uploadCommunityPost: (data: {
    hotelId: string;
    locationVerificationId: string;
    mediaType: "PHOTO" | "REEL" | "STORY";
    mediaUrl: string;
    thumbnailUrl?: string;
    caption?: string;
    soundTrack?: string;
    soundUrl?: string;
    locationName?: string;
    locationLat?: number;
    locationLng?: number;
    clientPostId?: string;
    highlightKey?: string;
    filter?: string;
  }) =>
    direct("/api/social/posts/community", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  sendLocationOtp: (data: {
    hotelId: string;
    deviceLat: number;
    deviceLng: number;
    deviceAccuracyM?: number;
  }) =>
    direct("/api/verify/location/send-otp", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  verifyLocationOtp: (data: { verificationId: string; otp: string }) =>
    direct("/api/verify/location/verify-otp", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
