const RAILWAY = "https://staybid-live-production.up.railway.app";
// In the browser, route through the Vercel proxy so ISPs that block Railway
// (e.g. Jio) still work. On the server we call Railway directly.
const API =
  typeof window === "undefined"
    ? RAILWAY
    : "/api/proxy";

async function request(path: string, opts?: RequestInit) {
  const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
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
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
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
};