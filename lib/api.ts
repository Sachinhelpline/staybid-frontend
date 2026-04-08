const API = process.env.NEXT_PUBLIC_API_URL || "https://staybid-live-production.up.railway.app";

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
  // Auth
  sendOtp: (phone: string) => request("/api/auth/send-otp", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, otp: string) => request("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ phone, otp }) }),

  // Hotels
  getHotels: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/api/hotels${q}`);
  },
  getHotel: (id: string) => request(`/api/hotels/${id}`),

  // Bids
  createBidRequest: (data: any) => request("/api/bids/request", { method: "POST", body: JSON.stringify(data) }),
  placeBid: (data: any) => request("/api/bids", { method: "POST", body: JSON.stringify(data) }),
  getMyBids: () => request("/api/bids/my"),

  // Flash Deals
  getFlashDeals: (city?: string) => request(`/api/flash-deals${city ? `?city=${city}` : ""}`),

  // Bookings
  createBooking: (data: any) => request("/api/bookings", { method: "POST", body: JSON.stringify(data) }),
  getMyBookings: () => request("/api/bookings/my"),

  // Wallet
  getWallet: () => request("/api/wallet"),
};
