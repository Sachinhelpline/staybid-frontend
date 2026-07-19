// Circle investor → partner-dashboard bridge.
//
// A pure Circle investor (users.role = "customer") is blocked from
// /partner/dashboard by partner/google-login (it only admits registered
// hotel owners). But the partner routes themselves never verify the token
// signature — they decodeJwt and scope by owner_user_id. So an investor who
// OPERATES units (Model 1 provision + Model 2 buy both stamp
// hotel_room_units.owner_user_id = investor) already has the correct operator
// scope; they just need a partner session token to reach the dashboard tabs.
//
// This reuses their existing Circle customer/Google token (sb_token) as the
// partner session — exactly the pattern a Model 3 auction winner already uses
// (app/trade/my-bids enable-selling). It ADDS the sb_partner_* keys and never
// touches the customer sb_token, so both sessions coexist.
//
// Once bridged, the dashboard resolves their operated hotel(s) via
// partnerHotelScope/partnerUnitScope and exposes:
//   • "My Rooms" (myrooms)      → list on the Model 2 B2B exchange + StayBid feed
//   • "Sell to Agents" (agentauction) → publish a Model 3 travel-agent auction lot
//   • "Channel Manager" (channels)    → OTA distribution

export function bridgeToPartnerDashboard(
  user: { id?: string; name?: string; email?: string } | null | undefined,
  tab?: string,
): void {
  try {
    const tok = localStorage.getItem("sb_token") || "";
    if (tok) {
      localStorage.setItem("sb_partner_token", tok);
      localStorage.setItem(
        "sb_partner_user",
        JSON.stringify({ id: user?.id, name: user?.name || "Circle Investor", email: user?.email || "" }),
      );
    }
  } catch { /* localStorage unavailable — the dashboard will re-gate normally */ }
  const q = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  window.location.href = `/partner/dashboard${q}`;
}
