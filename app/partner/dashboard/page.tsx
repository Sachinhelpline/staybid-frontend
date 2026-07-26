"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { calculateDynamicPrice, getRoomImage, DEMAND_STYLE, type DemandLevel } from "@/lib/ai-pricing";
import { ImageUpload } from "@/components/ImageUpload";
import { PHOTO_CATEGORIES } from "@/lib/hotel/photo-categories";
import BookingChat from "@/components/BookingChat";
import SwitchExperienceButton from "@/components/SwitchExperienceButton";
import { AppTourButton, HelpSupportButton } from "@/components/HelpLauncher";
import { api } from "@/lib/api";
// v113 — premium availability calendar + bulk block-dates sheet.
import AvailabilityCalendar, { BlockDatesSheet } from "@/components/partner/AvailabilityCalendar";
// Phase 5 tier-system — Pending content reviews queue (auth: x-partner-token)
import PartnerContentTab from "@/components/partner/PartnerContentTab";
import PartnerPassportTab from "@/components/partner/PartnerPassportTab";
// v288 — StayCircle investments linked to this hotel (read-only live view)
import PartnerCircleTab from "@/components/partner/PartnerCircleTab";
// v170 — camera QR / barcode scanner for the Redeem Codes tab.
import CodeScanner from "@/components/partner/CodeScanner";
// v170 — create / fully edit a room category from the dashboard.
import RoomEditorModal from "@/components/partner/RoomEditorModal";
// v170 — front-desk reservations module (Phase 1).
import ReservationsTab from "@/components/partner/ReservationsTab";
// v170 — housekeeping room-status board (Phase 1).
import HousekeepingTab from "@/components/partner/HousekeepingTab";
// v170 — reports & analytics (Phase 2).
import ReportsTab from "@/components/partner/ReportsTab";
// v170 — guest billing / folio / invoicing (Phase 2).
import BillingTab from "@/components/partner/BillingTab";
// v172 — F&B digital menu builder.
import MenuBuilderTab from "@/components/partner/MenuBuilderTab";
// v173 — F&B QR ordering — outlets & QR codes.
import FnbOrdersTab from "@/components/partner/FnbOrdersTab";
// v176 — service entitlements (locked subscription services).
import ServiceLockModal from "@/components/partner/ServiceLockModal";
import ServiceRenewBanner from "@/components/partner/ServiceRenewBanner";
import SubscriptionBillingModal from "@/components/partner/SubscriptionBillingModal";
import CircleUnitsTab from "@/components/partner/CircleUnitsTab";
import CircleInventoryTab from "@/components/partner/CircleInventoryTab";
import AgentAuctionTab from "@/components/partner/AgentAuctionTab";
import { isSubscriptionService } from "@/lib/partner/services";
// v170 — shared platform catalog: property types, meal plans, add-on
// services. The hotel declares here what the /bid auction targets.
import { PROPERTY_TYPES, MEAL_PLANS as CAT_MEAL_PLANS, ADDON_SERVICES } from "@/lib/catalog";
// v170 — guest CRM (Phase 3).
import GuestsTab from "@/components/partner/GuestsTab";
// v170 — staff & roles (Phase 3).
import StaffTab from "@/components/partner/StaffTab";
// v170 — channel manager / OTA connections (Phase 3).
import ChannelManagerTab from "@/components/partner/ChannelManagerTab";
import OtaFeedManager from "@/components/partner/OtaFeedManager";
// v129 — every counter price is a ₹100 multiple (matches the customer
// Negotiate slider step). Same source of truth as /bid + /flash-deals.
import { snap100, floor100, ceil100, snapClamp100, PRICE_STEP, PRICE_MIN } from "@/lib/price-snap";
// v177 — auto-cleanup of stale bids in the Bid Inbox. Same rule the
// customer /my-bids + admin /admin/bookings views use.
import { filterActiveBids } from "@/lib/bid-expiry";
// v129 — structured complimentary-amenity catalog replaces the free-text
// "Message to Guest" textarea (anti-bypass: phone/email/WhatsApp could slip
// through that box). See lib/counter-addons.ts for the rationale.
import { COUNTER_ADDONS, serializeAddons } from "@/lib/counter-addons";
// v145 — guest's actual preferred bid (below-floor cases) lives in the
// message token "Guest's preferred price: ₹X/night…", not in bid.amount.
// Partner panel was showing floor (b.amount) as the bid → "price clashing".
import { extractCustomerBidFromMessage } from "@/lib/paid-amount";
// v130 — Hybrid AI Autopilot (Option 2). Partner picks how aggressive the
// AI is on their inventory: auto / hybrid / manual. See lib/autopilot.ts
// for the customer-side resolver + lib/bidder-score.ts for the tier rules.
import { AUTOPILOT_MODE_LABEL, AUTOPILOT_MODE_DESC, type AutopilotMode, invalidateAutopilotCache } from "@/lib/autopilot";

// Tiny wrapper that pulls partner-side auth from localStorage. Keeps the
// shared BookingChat component agnostic of which session keys we use.
function PartnerBookingChat({ bidId, hotelId, guestName }: { bidId: string; hotelId: string; guestName?: string }) {
  const [tok, setTok] = useState<string>("");
  useEffect(() => { setTok(getToken()); }, []);
  if (!tok || !hotelId) return null;
  return (
    <BookingChat
      bidId={bidId}
      mode="hotel"
      hotelId={hotelId}
      partnerToken={tok}
      customerName={guestName}
    />
  );
}

const today     = new Date().toISOString().split("T")[0];
const tomorrow  = new Date(Date.now() + 86400000).toISOString().split("T")[0];

// ── helpers ────────────────────────────────────────────────────────────────
function getToken() { return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : ""; }
function getPartnerUser() {
  try { return JSON.parse(localStorage.getItem("sb_partner_user") || "null"); } catch { return null; }
}
function fmtCur(n: number) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
// v145 — Customer's ACTUAL preferred bid. Below-floor bids are stored in DB
// at floorPrice (Railway rejects below-floor inserts) so bid.amount === floor;
// the customer's real wish lives in bid.message as "Guest's preferred price: ₹X".
// Use this everywhere we display "what the guest bid".
function customerBidOf(b: any): number {
  const fromMsg = extractCustomerBidFromMessage(b?.message);
  return Math.round(fromMsg || b?.amount || 0);
}
// The system floor (what the bid is stored at). Same as bid.amount on
// below-floor cases; equals the room's floorPrice otherwise.
function floorOf(b: any): number {
  return Math.round(b?.amount || 0);
}
function fmtDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function daysUntil(s: string) {
  const diff = new Date(s).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}
function hoursLeft(s: string) {
  const diff = new Date(s).getTime() - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const STATUS_STYLE: Record<string, { bg: string; text: string; border: string; label: string }> = {
  PENDING:  { bg:"bg-amber-50",   text:"text-amber-700",   border:"border-amber-200",   label:"Pending"  },
  COUNTER:  { bg:"bg-orange-50",  text:"text-orange-700",  border:"border-orange-200",  label:"Countered"},
  ACCEPTED: { bg:"bg-emerald-50", text:"text-emerald-700", border:"border-emerald-200", label:"Accepted" },
  REJECTED: { bg:"bg-red-50",     text:"text-red-600",     border:"border-red-200",     label:"Declined" },
};

// v94 — Source badge (Direct / Creator / Hotel-feed / Flash). Maps the
// bid.source field surfaced by the new /api/partner/bids attribution join.
const SOURCE_STYLE: Record<string, { icon: string; label: string; bg: string; text: string }> = {
  "direct":      { icon: "🔗", label: "Direct",      bg: "bg-sky-50",     text: "text-sky-700"     },
  "creator":     { icon: "✨", label: "Creator",     bg: "bg-purple-50",  text: "text-purple-700"  },
  "hotel-feed":  { icon: "🏨", label: "Your reel",   bg: "bg-amber-50",   text: "text-amber-700"   },
  "flash":       { icon: "⚡", label: "Flash deal",  bg: "bg-red-50",     text: "text-red-700"     },
  "unknown":     { icon: "•",  label: "Unknown",     bg: "bg-luxury-50",  text: "text-luxury-600"  },
};
function SourceBadge({ source, creatorHandle }: { source?: string; creatorHandle?: string | null }) {
  const s = SOURCE_STYLE[source || "direct"] || SOURCE_STYLE.direct;
  const label = source === "creator" && creatorHandle ? `via @${creatorHandle}` : s.label;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.62rem] font-bold ${s.bg} ${s.text}`} title={`Booking source: ${s.label}`}>
      <span>{s.icon}</span>
      <span className="truncate max-w-[100px]">{label}</span>
    </span>
  );
}

// v170 — role-based tab visibility. The owner sees everything; staff
// roles get a scoped subset. "staff" + "profile" stay owner-only.
const STAFF_TAB_ALLOW: Record<string, Set<string>> = {
  manager:      new Set(["overview","bids","rooms","flash","bookings","reservations","availability","housekeeping","billing","menu","fnbqr","guests","passport","reports","complaints","redeem","content","verification"]),
  front_desk:   new Set(["overview","bids","bookings","reservations","availability","redeem","guests","passport"]),
  housekeeping: new Set(["overview","housekeeping"]),
};
function tabAllowed(role: string, id: string): boolean {
  if (role === "owner") return true;
  return !!STAFF_TAB_ALLOW[role]?.has(id);
}

// ── main component ─────────────────────────────────────────────────────────
export default function PartnerDashboard() {
  const router = useRouter();
  const [pUser, setPUser]         = useState<any>(null);
  const [hotel, setHotel]         = useState<any>(null);
  const [rooms, setRooms]         = useState<any[]>([]);
  const [bids, setBids]           = useState<any[]>([]);
  const [bookings, setBookings]   = useState<any[]>([]);
  const [flashDeals, setFlashDeals] = useState<any[]>([]);
  // v285 — Multi-property: every hotel this partner owns + the active selection.
  const [hotelList, setHotelList]   = useState<any[]>([]);
  const [activeHotelId, setActiveHotelId] = useState<string>("");
  const [switcherOpen, setSwitcherOpen]   = useState(false);
  // v324.3 — account menu behind the avatar (holds Switch experience + Sign out
  // so the mobile header never overflows past the right edge).
  const [acctOpen, setAcctOpen]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"overview"|"bids"|"rooms"|"flash"|"bookings"|"reservations"|"availability"|"housekeeping"|"billing"|"menu"|"fnbqr"|"guests"|"passport"|"circle"|"reports"|"complaints"|"redeem"|"content"|"channels"|"staff"|"profile"|"myrooms"|"agentauction">("overview");

  // Deep-link support: honour a ?tab= query on first load so external surfaces
  // (e.g. a Circle investor bridging in to "Sell to Agents" / "My Rooms" / OTA)
  // land on the right tab instead of always Overview. Runs once on mount.
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t) setTab(t as any);
    } catch { /* ignore */ }
  }, []);

  // v98 — Guest complaints raised against this hotel (general + video)
  const [complaints, setComplaints]   = useState<any[]>([]);
  const [vpComplaints, setVpComplaints] = useState<any[]>([]);
  const [complaintStats, setComplaintStats] = useState<any>({ open: 0, total: 0 });
  const [complaintsLoading, setComplaintsLoading] = useState(false);

  // ── Booking detail modal ─────────────────────────────────────────────────
  const [selectedBooking, setSelectedBooking] = useState<any>(null);

  // ── Room units (numbered rooms inventory) ────────────────────────────────
  const [roomUnits, setRoomUnits]       = useState<any[]>([]);
  const [unitDraft, setUnitDraft]       = useState<Record<string, string>>({}); // roomId -> "101,102,103"
  const [unitSaving, setUnitSaving]     = useState<string>("");
  // Quick Walk-in widget (on overview)
  const [quickWalkInOpen, setQuickWalkInOpen] = useState(false);

  // ── Availability / PMS state ─────────────────────────────────────────────
  const [calendar, setCalendar]       = useState<Record<string, Record<string, any>>>({});
  const [calLoading, setCalLoading]   = useState(false);
  const [calMonth, setCalMonth]       = useState<Date>(new Date());
  const [otaFeeds, setOtaFeeds]       = useState<any[]>([]);
  // v132.2 — per-date pricing maps (powers the inline price editor)
  const [roomPrices,    setRoomPrices]    = useState<Record<string, any>>({});
  const [priceOverrides, setPriceOverrides] = useState<Record<string, any>>({});
  // v132.3 — active flash deals for the calendar (autopilotMode already
  // exists below, sourced from /api/partner/hotel; we let the calendar
  // API refresh that value too via setAutopilotMode in loadCalendar).
  const [flashByRoom, setFlashByRoom] = useState<Record<string, any[]>>({});
  const [walkInOpen, setWalkInOpen]   = useState<{ roomId: string; date: string } | null>(null);
  const [walkIn, setWalkIn]           = useState({ fromDate:"", toDate:"", guestName:"", guestPhone:"", amount:"", note:"", assignedUnitId:"", assignedUnitNumber:"" });
  const [walkInSaving, setWalkInSaving] = useState(false);
  const [newFeed, setNewFeed]         = useState({ roomId:"", provider:"booking", icalUrl:"", label:"" });
  const [feedSaving, setFeedSaving]   = useState(false);
  const [syncing, setSyncing]         = useState<string>("");
  // v113 — bulk-block "📌 Block dates" sheet — opens from AvailabilityCalendar.
  const [blockSheetOpen, setBlockSheetOpen] = useState(false);

  // Bid action
  const [selectedBid, setSelectedBid]   = useState<any>(null);
  const [bidFilter, setBidFilter]       = useState<"PENDING"|"COUNTER"|"ACCEPTED"|"REJECTED"|"ALL">("PENDING");
  const [bidAction, setBidAction]       = useState<"accept"|"counter"|"reject">("accept");
  const [counterAmt, setCounterAmt]     = useState("");
  // v129 — selected complimentary amenities the partner is bundling with
  // this counter offer. Serialized into the message field on submit.
  const [counterAddons, setCounterAddons] = useState<string[]>([]);
  const [bidActLoading, setBidActLoading] = useState(false);
  const [bidActDone, setBidActDone]     = useState(false);

  // Room pricing
  const [editPrices, setEditPrices]   = useState<Record<string, { floor?: string; flash?: string }>>({});
  const [savingRoom, setSavingRoom]   = useState("");
  const [savedRoom, setSavedRoom]     = useState("");
  const [aiPrices, setAiPrices]       = useState<Record<string, any>>({});
  // v170 — room category create / edit modal
  const [roomEditor, setRoomEditor]   = useState<{ mode: "create"|"edit"; room?: any } | null>(null);
  // v176 — service entitlements: which subscription services are unlocked
  const [svcEnt, setSvcEnt]     = useState<Record<string, any>>({});
  const [svcReqs, setSvcReqs]   = useState<any[]>([]);
  const [svcLoaded, setSvcLoaded] = useState(false);
  const [lockModal, setLockModal] = useState<string | null>(null);
  // v178 — subscription billing history modal
  const [billingOpen, setBillingOpen] = useState(false);
  // v177 — subscription pricing + bundles (for the "Show charges" view)
  const [svcPricing, setSvcPricing] = useState<any[]>([]);
  const [svcBundles, setSvcBundles] = useState<any[]>([]);

  // Flash deal creation
  const [newDeal, setNewDeal]         = useState({ roomId:"", dealPrice:"", discount:"", durationHours:"24", maxRooms:"1" });
  const [dealLoading, setDealLoading] = useState(false);
  const [dealMsg, setDealMsg]         = useState("");

  // Hotel profile edit
  const [editHotel, setEditHotel]     = useState<any>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg]   = useState("");

  // v130 — Autopilot mode. Loaded once on dashboard mount + on profile-tab
  // open. Defaults to 'auto' if migration not yet applied (column missing).
  const [autopilotMode, setAutopilotMode] = useState<AutopilotMode>("auto");
  const [autopilotSaving, setAutopilotSaving] = useState(false);
  const [autopilotMsg, setAutopilotMsg] = useState("");

  // ── Auth guard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    const user  = getPartnerUser();
    if (!token || !user) { router.replace("/partner"); return; }
    setPUser(user);
    // v285 — resolve owned-property list FIRST so the correct hotel loads.
    (async () => {
      const hid = await loadHotelList(token);
      loadAll(token, user, hid);
      loadAutopilot();
    })();
  }, []);

  // v285 — fetch every hotel this partner owns; pick the persisted active id
  // (or the first owned) and return it so the initial load uses it.
  async function loadHotelList(token: string): Promise<string> {
    try {
      const r = await fetch("/api/partner/hotels", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      const list: any[] = Array.isArray(d?.hotels) ? d.hotels : [];
      setHotelList(list);
      if (!list.length) return "";
      const saved = typeof window !== "undefined" ? localStorage.getItem("sb_partner_active_hotel") || "" : "";
      const active = list.find((h) => h.id === saved) ? saved : list[0].id;
      setActiveHotelId(active);
      return active;
    } catch { return ""; }
  }

  // v285 — switch the active property: persist + reload everything for it.
  function switchHotel(hid: string) {
    if (!hid || hid === activeHotelId) { setSwitcherOpen(false); return; }
    setActiveHotelId(hid);
    if (typeof window !== "undefined") localStorage.setItem("sb_partner_active_hotel", hid);
    setSwitcherOpen(false);
    const token = getToken();
    const user  = getPartnerUser();
    if (token && user) loadAll(token, user, hid);
  }

  // ── Live auto-refresh every 20s + on focus (silent, no spinner) ────────
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const t = setInterval(() => {
      refreshLive(token);
      // Also refresh calendar so today's check-ins / new bookings surface
      // even if the partner is on a different tab.
      if (hotel?.id) loadCalendar();
    }, 20_000);
    const onFocus = () => { refreshLive(token); if (hotel?.id) loadCalendar(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [hotel?.id]);

  // ── AI prices recalculate every 60s ────────────────────────────────────
  useEffect(() => {
    if (!rooms.length || !hotel) return;
    const calc = () => {
      const next: Record<string, any> = {};
      rooms.forEach(r => { next[r.id] = calculateDynamicPrice(r.floorPrice || 1000, today, hotel.city || "Mussoorie"); });
      setAiPrices(next);
    };
    calc();
    const t = setInterval(calc, 60_000);
    return () => clearInterval(t);
  }, [rooms, hotel]);

  async function loadAll(token: string, user: any, hid?: string) {
    setLoading(true);
    // v285 — multi-property scope suffix (empty for single-hotel owners).
    const s = (hid ?? activeHotelId) ? `?hotelId=${encodeURIComponent(hid ?? activeHotelId)}` : "";
    try {
      const [hotelRes, bidsRes, flashRes, svcRes] = await Promise.all([
        fetch(`/api/partner/hotel${s}`,        { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/partner/bids${s}`,         { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/partner/flash-deals${s}`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/partner/services${s}`,     { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [hotelData, bidsData, flashData, svcData] = await Promise.all([
        hotelRes.json(), bidsRes.json(), flashRes.json(), svcRes.json().catch(() => ({})),
      ]);
      if (hotelData.hotel)  { setHotel(hotelData.hotel); setRooms(hotelData.hotel.rooms || []); setEditHotel(hotelData.hotel); }
      if (hotelData.bookings) setBookings(hotelData.bookings);
      if (bidsData.bids)    setBids(bidsData.bids);
      if (flashData.deals)  setFlashDeals(flashData.deals);
      setSvcEnt(svcData?.entitlements || {});
      setSvcReqs(svcData?.requests || []);
      setSvcPricing(svcData?.pricing || []);
      setSvcBundles(svcData?.bundles || []);
      setSvcLoaded(true);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function refreshLive(token: string) {
    const s = activeHotelId ? `?hotelId=${encodeURIComponent(activeHotelId)}` : "";
    try {
      const [hotelRes, bidsRes, flashRes, svcRes] = await Promise.all([
        fetch(`/api/partner/hotel${s}`,       { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`/api/partner/bids${s}`,        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`/api/partner/flash-deals${s}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`/api/partner/services${s}`,    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const [hotelData, bidsData, flashData, svcData] = await Promise.all([
        hotelRes.json(), bidsRes.json(), flashRes.json(), svcRes.json().catch(() => ({})),
      ]);
      if (hotelData?.hotel)   { setHotel(hotelData.hotel); setRooms(hotelData.hotel.rooms || []); }
      if (hotelData?.bookings) setBookings(hotelData.bookings);
      if (bidsData?.bids)      setBids(bidsData.bids);
      if (flashData?.deals)    setFlashDeals(flashData.deals);
      if (svcData?.entitlements) {
        setSvcEnt(svcData.entitlements); setSvcReqs(svcData.requests || []);
        setSvcPricing(svcData.pricing || []); setSvcBundles(svcData.bundles || []);
        setSvcLoaded(true);
      }
    } catch { /* silent */ }
  }

  function logout() {
    localStorage.removeItem("sb_partner_token");
    localStorage.removeItem("sb_partner_user");
    // v109 — tell the customer-side TierProvider that hotel status
    // is gone so the menu / /upgrade banner stop showing the Hotel
    // Partner entry immediately.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("sb:tier-refresh"));
    router.replace("/partner");
  }

  // v130 — load + save autopilot mode for this partner's hotel.
  async function loadAutopilot() {
    const token = getToken();
    if (!token) return;
    try {
      const r = await fetch("/api/partner/autopilot", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = await r.json().catch(() => ({} as any));
      const m = (d?.mode as AutopilotMode) || "auto";
      if (m === "auto" || m === "hybrid" || m === "manual") setAutopilotMode(m);
    } catch { /* default 'auto' stays */ }
  }
  async function saveAutopilot(mode: AutopilotMode) {
    const token = getToken();
    if (!token) return;
    setAutopilotSaving(true);
    setAutopilotMsg("");
    try {
      const r = await fetch("/api/partner/autopilot", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) {
        if (r.status === 412) {
          setAutopilotMsg("⚠ Autopilot table not yet provisioned — your admin needs to apply the v130 migration.");
        } else {
          setAutopilotMsg(`❌ ${d?.error || "Could not save"}`);
        }
        return;
      }
      setAutopilotMode(mode);
      // Bust the customer-side cache so subsequent bids on this hotel pick
      // up the new mode immediately (without waiting for the 60s TTL).
      if (hotel?.id) invalidateAutopilotCache(hotel.id);
      setAutopilotMsg(`✓ Mode saved · ${AUTOPILOT_MODE_LABEL[mode]}`);
      setTimeout(() => setAutopilotMsg(""), 2500);
    } catch (e: any) {
      setAutopilotMsg(`❌ ${e?.message || "Network error"}`);
    } finally {
      setAutopilotSaving(false);
    }
  }

  // ── Bid action ──────────────────────────────────────────────────────────
  async function submitBidAction() {
    if (!selectedBid) return;
    setBidActLoading(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/partner/bids/${selectedBid.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // v129 — counter amount snapped to ₹100 multiple; "message" carries
        // ONLY the serialized structured-amenity catalog (sentinel-prefixed)
        // so the customer's my-bids view can parse chip pills. Free-text
        // partner-to-guest input was removed as an anti-bypass surface.
        body: JSON.stringify({
          action: bidAction,
          counterAmount: bidAction === "counter" ? snap100(counterAmt) : counterAmt,
          message: bidAction === "counter" ? serializeAddons(counterAddons) : "",
          addons: bidAction === "counter" ? counterAddons : [],
        }),
      });
      if (!res.ok) {
        // v145.1 — surface the actual backend error. Supabase reason first
        // (most diagnostic), then generic error/message, then HTTP status.
        const errBody = await res.json().catch(() => ({}));
        const sb = errBody.supabase || "";
        const errMsg =
          (sb && (() => {
            try { const j = JSON.parse(sb); return j.message || j.error || sb; }
            catch { return sb; }
          })()) ||
          errBody.error ||
          errBody.message ||
          `Server error (${res.status})`;
        throw new Error(errMsg);
      }
      setBidActDone(true);
      // Refresh bids
      const bRes = await fetch("/api/partner/bids", { headers: { Authorization: `Bearer ${token}` } });
      const bd = await bRes.json();
      if (bd.bids) setBids(bd.bids);
      setTimeout(() => { setSelectedBid(null); setBidActDone(false); setCounterAddons([]); setCounterAmt(""); setBidAction("accept"); }, 1500);
    } catch(e: any) { alert(e.message || "Action failed"); }
    finally { setBidActLoading(false); }
  }

  // ── Room pricing save ────────────────────────────────────────────────────
  async function saveRoomPricing(roomId: string) {
    setSavingRoom(roomId);
    const token = getToken();
    const prices = editPrices[roomId] || {};
    try {
      const res = await fetch(`/api/rooms/${roomId}/pricing`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          floorPrice:      prices.floor ? parseFloat(prices.floor) : undefined,
          flashFloorPrice: prices.flash ? parseFloat(prices.flash) : undefined,
        }),
      });
      const d = await res.json();
      if (d.saved) {
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, ...d.room } : r));
        setSavedRoom(roomId);
        setTimeout(() => setSavedRoom(""), 2500);
      }
    } catch(e: any) { alert(e.message || "Save failed"); }
    finally { setSavingRoom(""); }
  }

  // ── Room images (add / remove via partner self-serve) ────────────────────
  async function saveRoomImages(roomId: string, images: string[]) {
    const token = getToken();
    try {
      const res = await fetch(`/api/rooms/${roomId}/images`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      setRooms(prev => prev.map(r => r.id === roomId ? { ...r, images: d.room?.images || images } : r));
    } catch (e: any) { alert(e.message || "Image save failed"); }
  }

  // ── v170 — room category create / edit / delete ──────────────────────────
  function onRoomSaved(room: any, mode: "create" | "edit") {
    if (room) {
      setRooms(prev =>
        mode === "create"
          ? [...prev, room]
          : prev.map(r => (r.id === room.id ? { ...r, ...room } : r))
      );
    }
    setRoomEditor(null);
  }
  async function deleteRoomCategory(roomId: string) {
    if (!confirm("Is room category ko delete karein? Iske room numbers bhi hat jayenge.")) return;
    const token = getToken();
    try {
      const res = await fetch(`/api/partner/rooms?id=${encodeURIComponent(roomId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Delete failed");
      setRooms(prev => prev.filter(r => r.id !== roomId));
    } catch (e: any) {
      alert("❌ " + (e?.message || "Delete failed"));
    }
  }

  // ── Create flash deal ────────────────────────────────────────────────────
  async function createFlashDeal() {
    if (!newDeal.roomId || !newDeal.dealPrice) return setDealMsg("Select a room and enter deal price.");
    setDealLoading(true); setDealMsg("");
    const token = getToken();
    try {
      const res = await fetch("/api/partner/flash-deals", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...newDeal, hotelId: hotel.id, dealPrice: parseFloat(newDeal.dealPrice), discount: parseFloat(newDeal.discount || "0") }),
      });
      const d = await res.json();
      if (d.created) {
        setDealMsg("✓ Flash deal created!");
        setNewDeal({ roomId:"", dealPrice:"", discount:"", durationHours:"24", maxRooms:"1" });
        const fRes = await fetch("/api/partner/flash-deals", { headers: { Authorization: `Bearer ${token}` } });
        const fd = await fRes.json();
        if (fd.deals) setFlashDeals(fd.deals);
      } else throw new Error(d.error || "Creation failed");
    } catch(e: any) { setDealMsg("❌ " + (e.message || "Failed")); }
    finally { setDealLoading(false); }
  }

  async function deactivateDeal(id: string) {
    const token = getToken();
    await fetch("/api/partner/flash-deals", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setFlashDeals(prev => prev.map(d => d.id === id ? { ...d, isActive: false } : d));
  }

  // ── Save hotel profile ───────────────────────────────────────────────────
  async function saveHotelProfile() {
    setProfileSaving(true); setProfileMsg("");
    const token = getToken();
    try {
      const res = await fetch("/api/partner/hotel", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(editHotel),
      });
      const d = await res.json();
      if (d.saved) { setHotel(d.hotel); setProfileMsg("✓ Profile saved!"); }
      else throw new Error(d.error || "Failed");
    } catch(e: any) { setProfileMsg("❌ " + e.message); }
    finally { setProfileSaving(false); }
  }

  // ── Room units (numbered rooms) handlers ─────────────────────────────────
  async function loadRoomUnits() {
    if (!hotel?.id) return;
    const token = getToken();
    try {
      const r = await fetch(`/api/partner/room-units?hotelId=${hotel.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      setRoomUnits(d.units || []);
    } catch {}
  }

  async function saveRoomUnitsBulk(roomId: string) {
    const raw = (unitDraft[roomId] || "").trim();
    if (!raw) return;
    // Accept "101, 102, 103" or "101 102 103" or ranges "101-105"
    const tokens = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const numbers: string[] = [];
    for (const t of tokens) {
      const m = t.match(/^(\d+)-(\d+)$/);
      if (m) {
        const a = parseInt(m[1]), b = parseInt(m[2]);
        if (b - a >= 0 && b - a <= 50) for (let i = a; i <= b; i++) numbers.push(String(i));
      } else numbers.push(t);
    }
    if (!numbers.length) return;
    setUnitSaving(roomId);
    const token = getToken();
    try {
      const r = await fetch("/api/partner/room-units", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.id, roomId,
          bulk: numbers.map(n => ({ roomNumber: n })),
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Failed");
      setUnitDraft(p => ({ ...p, [roomId]: "" }));
      loadRoomUnits();
    } catch(e: any) { alert("❌ " + e.message); }
    finally { setUnitSaving(""); }
  }

  async function deleteRoomUnit(id: string) {
    const token = getToken();
    try {
      await fetch(`/api/partner/room-units?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      loadRoomUnits();
    } catch {}
  }

  async function toggleUnitStatus(unit: any) {
    const next = unit.status === "active" ? "maintenance" : "active";
    const token = getToken();
    try {
      await fetch("/api/partner/room-units", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: unit.id, status: next }),
      });
      loadRoomUnits();
    } catch {}
  }

  // Helper: which units are free for a given room+date range?
  function freeUnitsForRoom(roomId: string, fromDate: string, toDate: string): any[] {
    const allUnits = roomUnits.filter(u => u.roomId === roomId && u.status === "active");
    if (!fromDate || !toDate) return allUnits;
    // A unit is free if no calendar entry maps to it in the range
    const occupiedUnitIds = new Set<string>();
    const cal = calendar[roomId] || {};
    for (let d = new Date(fromDate); d < new Date(toDate); d.setDate(d.getDate()+1)) {
      const key = d.toISOString().slice(0,10);
      const cell = cal[key];
      if (cell?.assignedUnitId) occupiedUnitIds.add(cell.assignedUnitId);
    }
    return allUnits.filter(u => !occupiedUnitIds.has(u.id));
  }

  useEffect(() => {
    if (hotel?.id) loadRoomUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel?.id]);

  // v176 — if the open tab got locked (trial expired / revoked), fall back.
  useEffect(() => {
    if (svcLoaded && isSubscriptionService(tab) && !svcEnt[tab]?.unlocked) setTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svcLoaded, svcEnt, tab]);

  // ── Availability / PMS handlers ──────────────────────────────────────────
  async function loadCalendar() {
    if (!hotel?.id) return;
    setCalLoading(true);
    const token = getToken();
    try {
      const from = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).toISOString().slice(0,10);
      const to   = new Date(calMonth.getFullYear(), calMonth.getMonth()+3, 0).toISOString().slice(0,10);
      const r = await fetch(`/api/partner/calendar?hotelId=${hotel.id}&from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      setCalendar(d.calendar || {});
      setRoomPrices(d.roomPrices || {});
      setPriceOverrides(d.priceOverrides || {});
      if (d.autopilotMode) setAutopilotMode(d.autopilotMode);
      setFlashByRoom(d.flashByRoom || {});
    } catch {}
    finally { setCalLoading(false); }
  }

  async function loadOtaFeeds() {
    if (!hotel?.id) return;
    const token = getToken();
    try {
      const r = await fetch(`/api/partner/ota-feeds?hotelId=${hotel.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      setOtaFeeds(d.feeds || []);
    } catch {}
  }

  useEffect(() => {
    if (tab === "availability" && hotel?.id) {
      loadCalendar();
      // OTA feeds are now managed by the self-loading <OtaFeedManager> (v316)
    }
    if (tab === "complaints" && hotel?.id) {
      loadComplaints();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hotel?.id, calMonth]);

  // v98 — fetch guest complaints raised against this hotel
  async function loadComplaints() {
    const token = getToken();
    if (!token) return;
    setComplaintsLoading(true);
    try {
      const r = await fetch("/api/partner/complaints", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      setComplaints(d.complaints || []);
      setVpComplaints(d.vpComplaints || []);
      setComplaintStats(d.stats || { open: 0, total: 0 });
    } catch {} finally { setComplaintsLoading(false); }
  }

  async function submitWalkIn() {
    if (!walkInOpen || !hotel?.id) return;
    if (!walkIn.fromDate || !walkIn.toDate) { alert("Dates required"); return; }
    setWalkInSaving(true);
    const token = getToken();
    try {
      const r = await fetch("/api/partner/walk-in", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          hotelId: hotel.id,
          roomId:  walkInOpen.roomId,
          fromDate: walkIn.fromDate,
          toDate:   walkIn.toDate,
          guestName: walkIn.guestName,
          guestPhone: walkIn.guestPhone,
          amount: walkIn.amount ? Number(walkIn.amount) : null,
          note: walkIn.note,
          assignedUnitId: walkIn.assignedUnitId || null,
          assignedUnitNumber: walkIn.assignedUnitNumber || null,
        }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Failed");
      setWalkInOpen(null);
      setWalkIn({ fromDate:"", toDate:"", guestName:"", guestPhone:"", amount:"", note:"", assignedUnitId:"", assignedUnitNumber:"" });
      loadCalendar();
    } catch(e: any) { alert("❌ " + e.message); }
    finally { setWalkInSaving(false); }
  }

  async function deleteBlock(refId: string) {
    const token = getToken();
    try {
      await fetch(`/api/partner/walk-in?id=${refId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCalendar();
    } catch {}
  }

  // v132.2 — per-date room pricing + quantity override save / clear.
  // Both write to /api/partner/room-pricing, then refresh the calendar
  // so the new prices show up in every relevant cell.
  async function savePricing(payload: { items: Array<{ roomId: string; date: string; floorPrice?: number | null; quantityOverride?: number | null; note?: string | null; }> }) {
    if (!hotel?.id) return;
    const token = getToken();
    try {
      const res = await fetch("/api/partner/room-pricing", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId: hotel.id, items: payload.items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Save failed: ${err?.error || res.statusText}`);
        return;
      }
      await loadCalendar();
    } catch (e: any) {
      alert(`Save error: ${e?.message || e}`);
    }
  }
  async function clearPricing(args: { roomId: string; date: string }) {
    if (!hotel?.id) return;
    const token = getToken();
    try {
      await fetch(`/api/partner/room-pricing?hotelId=${hotel.id}&roomId=${encodeURIComponent(args.roomId)}&date=${encodeURIComponent(args.date)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadCalendar();
    } catch {}
  }

  // v113 — bulk block submitter. Writes one room_blocks row per picked
  // room via the extended /api/partner/walk-in endpoint (`source` field
  // and `roomIds[]` are accepted as of v113).
  async function submitBulkBlock(args: {
    roomIds: string[];
    fromDate: string;
    toDate: string;
    source: "manual" | "group";
    reason: string;
    guestName?: string;
    note?: string;
  }) {
    if (!hotel?.id) return;
    const token = getToken();
    const r = await fetch("/api/partner/walk-in", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        hotelId: hotel.id,
        roomIds: args.roomIds,
        fromDate: args.fromDate,
        toDate:   args.toDate,
        source:   args.source,
        guestName: args.guestName || args.reason,
        note: args.note ? `${args.reason}: ${args.note}` : args.reason,
      }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "Block failed");
    loadCalendar();
  }

  async function addFeed() {
    if (!hotel?.id || !newFeed.roomId || !newFeed.icalUrl) { alert("Room & iCal URL required"); return; }
    setFeedSaving(true);
    const token = getToken();
    try {
      const r = await fetch("/api/partner/ota-feeds", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ hotelId: hotel.id, ...newFeed }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Failed");
      setNewFeed({ roomId:"", provider:"booking", icalUrl:"", label:"" });
      loadOtaFeeds();
    } catch(e: any) { alert("❌ " + e.message); }
    finally { setFeedSaving(false); }
  }

  async function syncFeed(feedId: string) {
    setSyncing(feedId);
    const token = getToken();
    try {
      const r = await fetch("/api/partner/ota-feeds/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ feedId }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Sync failed");
      alert(`✓ Synced: ${d.imported} new, ${d.skipped} already imported (of ${d.totalEvents})`);
      loadOtaFeeds();
      loadCalendar();
    } catch(e: any) { alert("❌ " + e.message); }
    finally { setSyncing(""); }
  }

  async function deleteFeed(feedId: string) {
    if (!confirm("Delete this feed and all its imported blocks?")) return;
    const token = getToken();
    try {
      await fetch(`/api/partner/ota-feeds?id=${feedId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      loadOtaFeeds();
      loadCalendar();
    } catch {}
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-luxury-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-2 border-gold-400 border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-luxury-500 text-sm">Loading your dashboard…</p>
      </div>
    </div>
  );

  // ── Derived stats ────────────────────────────────────────────────────────
  // v177 — drop stale bids from the inbox before counting / rendering.
  // Same expiry rule the customer + admin views use, so the three stay
  // in sync. Hotels never see a 3-day-old "Pending" row again.
  const activeBidsForInbox = filterActiveBids(bids as any[]);
  const pendingBids   = activeBidsForInbox.filter(b => b.status === "PENDING").length;
  const counteredBids = activeBidsForInbox.filter(b => b.status === "COUNTER").length;
  const acceptedBids  = activeBidsForInbox.filter(b => b.status === "ACCEPTED").length;
  const revenue       = activeBidsForInbox.filter(b => b.status === "ACCEPTED").reduce((s, b) => s + (b.amount || 0), 0);
  const activeDeals   = flashDeals.filter(d => d.isActive !== false && daysUntil(d.validUntil || "") >= 0);
  const filteredBids  = bidFilter === "ALL" ? activeBidsForInbox : activeBidsForInbox.filter(b => b.status === bidFilter);

  // v170 — staff role drives which tabs are visible (owner = everything).
  const role = (pUser?.staffRole as string) || "owner";

  // v176 — a subscription service is locked until the admin grants access.
  function serviceLocked(id: string): boolean {
    if (!svcLoaded) return false;
    if (!isSubscriptionService(id)) return false;
    return !svcEnt[id]?.unlocked;
  }

  const TABS = [
    { id:"overview",  icon:"📊", label:"Overview"   },
    // Phase 3c — StayCircle operator: manage your OWN physical rooms
    // (per-unit price / listing). Only shown when the hotel is reached via
    // unit-ownership (isOperator), never for the classic hotel owner.
    ...(hotel?.isOperator ? [{ id:"myrooms", icon:"🛏️", label:"My Rooms" }] : []),
    { id:"bids",      icon:"📩", label:`Bids ${pendingBids > 0 ? `(${pendingBids})` : ""}` },
    { id:"rooms",     icon:"🏨", label:"Rooms"      },
    { id:"flash",     icon:"⚡", label:"Flash Deals"},
    { id:"bookings",  icon:"📅", label:"Bookings"   },
    // v170 — front-desk reservations (walk-in / phone / group bookings).
    { id:"reservations", icon:"🛎️", label:"Reservations" },
    { id:"availability", icon:"🗓️", label:"Availability" },
    // v170 — housekeeping room-status board (clean / dirty / inspected).
    { id:"housekeeping", icon:"🧹", label:"Housekeeping" },
    // v170 — guest billing / folio / GST invoicing.
    { id:"billing", icon:"🧾", label:"Billing" },
    // v172 — F&B digital menu builder.
    { id:"menu", icon:"🍽️", label:"F&B Menu" },
    // v173 — F&B QR ordering — outlets & QR codes.
    { id:"fnbqr", icon:"📱", label:"F&B QR" },
    // v170 — guest CRM (profiles, stay history, repeat tags).
    { id:"guests", icon:"👥", label:"Guests" },
    // v265 — Passport Guests (read-only Explorer Passport holders at this hotel).
    { id:"passport", icon:"🛂", label:"Passport Guests" },
    // v288 — StayCircle investments linked to this hotel (read-only)
    { id:"circle", icon:"◎", label:"StayCircle" },
    // v361 — Model 3: sell spare inventory to travel agents via monthly auction.
    { id:"agentauction", icon:"🏷️", label:"Sell to Agents" },
    // v170 — reports & analytics (revenue, ADR, occupancy, CSV export).
    { id:"reports", icon:"📈", label:"Reports" },
    // v98 — guest complaints feed (read-only; resolution stays admin-side).
    { id:"complaints", icon:"🚩", label:`Complaints${complaintStats.open ? ` (${complaintStats.open})` : ""}` },
    // v124 — StayPoints redemption fulfilment (scan / enter coupon at check-in)
    { id:"redeem", icon:"🎟️", label:"Redeem Codes" },
    // Phase 5 (tier-system) — Pending content moderation queue. Hotel
    // partner approves / rejects / escalates user-uploaded reels & photos
    // tagged to their property. Reads /api/partner/content/pending.
    { id:"content", icon:"🖼️", label:"Guest Content" },
    // Verification = dedicated page (different layout). Treated as a tab so
    // partners discover it in the same row, but clicking routes out.
    { id:"verification", icon:"🎬", label:"Verification", href:"/partner/verification" } as any,
    // v170 — channel manager / OTA connections (owner-only).
    { id:"channels", icon:"🔗", label:"Channels" },
    // v170 — staff & roles management (owner-only).
    { id:"staff", icon:"🧑‍💼", label:"Staff" },
    { id:"profile",   icon:"⚙️", label:"Profile"    },
  ].filter((t: any) => tabAllowed(role, t.id));

  return (
    <div className="min-h-screen bg-luxury-50 pdash-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family:'Cormorant Garamond',serif; }
        body { font-family:'Inter',sans-serif; }
        /* v170 — premium partner panel: tighter padding, refined depth, smaller radii */
        .card-p { background:#fff; border-radius:15px; border:1px solid #efe7d7; box-shadow:0 1px 2px rgba(61,44,20,0.04),0 4px 16px rgba(160,130,80,0.045); padding:15px; }
        .card-tight { padding:12px !important; border-radius:13px !important; }
        .inp-p { border:1px solid #e6ddc8; border-radius:9px; padding:8px 11px; font-size:0.8rem; width:100%; outline:none; transition:all 0.18s; color:#3d2c14; background:#fff; }
        /* Currency-prefixed inputs: the rupee glyph sits at left:0.75rem, so
           the value needs 1.75rem of left padding to clear it. The .inp-p
           padding shorthand was overriding the pl-7 utility (rupee overlapped
           the number); the compound selector wins on specificity. */
        .inp-p.pl-7 { padding-left:1.75rem !important; }
        .inp-p:focus { border-color:#c9911a; box-shadow:0 0 0 3px rgba(201,145,26,0.13); }
        .btn-gold { background:linear-gradient(135deg,#c9911a,#f0b429); color:#fff; border:none; border-radius:9px; padding:8px 15px; font-weight:700; cursor:pointer; font-size:0.8rem; transition:all 0.18s; box-shadow:0 2px 8px rgba(201,145,26,0.22); }
        .btn-gold:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 18px rgba(201,145,26,0.34); }
        .btn-gold:disabled { opacity:0.4; cursor:not-allowed; transform:none; box-shadow:none; }
        .btn-ghost { background:#fff; color:#7a6645; border:1px solid #e6ddc8; border-radius:9px; padding:7px 13px; font-weight:700; cursor:pointer; font-size:0.78rem; transition:all 0.18s; }
        .btn-ghost:hover:not(:disabled) { border-color:#c9911a; color:#3d2c14; background:#fdfaf2; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation:fadeUp 0.3s ease-out both; }
        /* v449 — data-dense partner panel: tabular numerals everywhere so every
           ₹, count, date and KPI aligns in columns and doesn't reflow as values
           change. Digit-advance only — never affects letterforms. This <style>
           is global (not scoped), so the rule cascades into all tab components. */
        .pdash-root { font-variant-numeric: tabular-nums; }
        /* premium clickable hub launcher tile (dashboard boxes) */
        .hub-tile { background:#fff; border:1px solid #efe7d7; border-radius:14px; padding:12px; text-align:left; cursor:pointer; transition:all 0.18s; position:relative; overflow:hidden; display:flex; flex-direction:column; gap:5px; min-height:96px; }
        .hub-tile:hover { transform:translateY(-2px); border-color:#e3c98f; box-shadow:0 9px 24px rgba(160,130,80,0.14); }
        .hub-tile:active { transform:translateY(0); }
        .hub-ico { width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:1rem; }
        .sec-title { font-family:'Cormorant Garamond',serif; font-weight:500; color:#241a0c; letter-spacing:0.01em; }
        /* premium camera scanner */
        .scan-frame { position:relative; width:100%; aspect-ratio:4/3; max-height:360px; background:#0b0907; border-radius:15px; overflow:hidden; }
        .scan-frame video { width:100%; height:100%; object-fit:cover; }
        .scan-reticle { position:absolute; top:13%; bottom:13%; left:13%; right:13%; border-radius:14px; border:2px solid rgba(240,180,41,0.92); box-shadow:0 0 0 100vmax rgba(8,7,5,0.56); }
        .scan-reticle::before,.scan-reticle::after { content:""; position:absolute; width:22px; height:22px; border:3px solid #f0b429; }
        .scan-reticle::before { top:-2px; left:-2px; border-right:0; border-bottom:0; border-radius:6px 0 0 0; }
        .scan-reticle::after { bottom:-2px; right:-2px; border-left:0; border-top:0; border-radius:0 0 6px 0; }
        .scan-laser { position:absolute; left:14%; right:14%; height:2.5px; border-radius:2px; background:linear-gradient(90deg,transparent,#f0b429,transparent); box-shadow:0 0 12px rgba(240,180,41,0.85); animation:scanLaser 2.1s ease-in-out infinite; }
        @keyframes scanLaser { 0%{top:15%} 50%{top:83%} 100%{top:15%} }
        @media (max-width:640px){ .card-p { padding:13px; border-radius:14px; } }
        /* v145 — premium counter slider thumb (gold halo, larger drag target).
           Track is rendered by sibling divs; the <input> itself is transparent
           so the colored zones underneath show through. */
        .counter-range { -webkit-appearance: none; appearance: none; background: transparent; height: 28px; }
        .counter-range:focus { outline: none; }
        .counter-range::-webkit-slider-runnable-track { background: transparent; height: 10px; border-radius: 999px; }
        .counter-range::-moz-range-track { background: transparent; height: 10px; border-radius: 999px; }
        .counter-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; border-radius: 999px;
          background: linear-gradient(135deg, #fef3c7 0%, #f0b429 60%, #c9911a 100%);
          border: 2px solid #fff;
          box-shadow: 0 0 0 2px rgba(201,145,26,0.32), 0 4px 10px rgba(201,145,26,0.45);
          cursor: grab; margin-top: -6px; transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .counter-range::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 999px;
          background: linear-gradient(135deg, #fef3c7 0%, #f0b429 60%, #c9911a 100%);
          border: 2px solid #fff;
          box-shadow: 0 0 0 2px rgba(201,145,26,0.32), 0 4px 10px rgba(201,145,26,0.45);
          cursor: grab; transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .counter-range:hover::-webkit-slider-thumb { transform: scale(1.1); box-shadow: 0 0 0 3px rgba(201,145,26,0.40), 0 6px 14px rgba(201,145,26,0.55); }
        .counter-range:hover::-moz-range-thumb { transform: scale(1.1); box-shadow: 0 0 0 3px rgba(201,145,26,0.40), 0 6px 14px rgba(201,145,26,0.55); }
        .counter-range:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.15); }
        .counter-range:active::-moz-range-thumb { cursor: grabbing; transform: scale(1.15); }
      `}</style>

      {/* ── Partner Navbar ─────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-40" style={{background:"linear-gradient(180deg,#1c140a,#13100a)",borderBottom:"1px solid rgba(240,180,41,0.16)"}}>
        <div className="max-w-7xl mx-auto px-4 sm:px-5 flex items-center justify-between" style={{height:"56px"}}>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0"
              style={{background:"linear-gradient(135deg,#c9911a,#f0b429)",boxShadow:"0 2px 8px rgba(201,145,26,0.4)"}}>S</div>
            <div className="min-w-0">
              <span className="font-display text-base text-white tracking-wide">StayBid</span>
              <span className="ml-1.5 text-[0.55rem] font-bold text-amber-400/75 tracking-[0.18em] uppercase">Partner</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            {hotel && hotelList.length <= 1 && (
              <span className="hidden sm:block text-xs font-semibold text-white/75 bg-white/6 px-2.5 py-1 rounded-full border border-white/10 truncate max-w-[180px]">
                🏨 {hotel.name}
              </span>
            )}
            {/* v285 — Multi-property switcher (only when the partner owns 2+ hotels) */}
            {hotelList.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => setSwitcherOpen((o) => !o)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/15 px-2.5 py-1 rounded-full border border-amber-400/30 transition-all max-w-[190px]"
                  title="Switch property"
                >
                  <span className="truncate">🏨 {hotel?.name || "Select property"}</span>
                  <span className="text-amber-300/80 text-[0.6rem] shrink-0">▾</span>
                </button>
                {switcherOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setSwitcherOpen(false)} />
                    <div className="absolute right-0 mt-1.5 z-50 w-64 rounded-xl overflow-hidden shadow-2xl"
                      style={{ background: "#1c140a", border: "1px solid rgba(240,180,41,0.22)" }}>
                      <div className="px-3 py-2 text-[0.58rem] font-bold text-amber-400/70 uppercase tracking-[0.16em] border-b border-white/8">
                        Your properties · {hotelList.length}
                      </div>
                      <div className="max-h-[60vh] overflow-y-auto py-1">
                        {hotelList.map((h) => {
                          const on = h.id === activeHotelId;
                          // v310 — StayBid-operated pools: legacy Circle
                          // (circle_operator) + Host Property-Listing (host_circle).
                          const isCircle = h.account_type === "circle_operator"
                            || h.account_type === "staybid_operated"
                            || h.owner_type === "host_circle";
                          return (
                            <button
                              key={h.id}
                              onClick={() => switchHotel(h.id)}
                              className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${on ? "bg-amber-400/12" : "hover:bg-white/6"}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${on ? "bg-amber-400" : "bg-white/25"}`} />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[0.8rem] font-semibold text-white truncate">{h.name}</span>
                                <span className="block text-[0.62rem] text-white/45 truncate">
                                  {h.city || "—"}{isCircle ? " · Circle" : ""}
                                </span>
                              </span>
                              {on && <span className="text-amber-300 text-[0.7rem] shrink-0">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {/* v310 — StayBid-operated (Circle / Host Circle) property. The
                partner reaches it via unit-ownership (isOperator), not ownerId,
                so it's visibly distinct from a classic owner-run hotel. */}
            {hotel?.isOperator && (
              <span className="hidden sm:flex items-center gap-1 text-[0.58rem] font-bold text-purple-200 bg-purple-500/15 border border-purple-400/30 px-2 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
                title="This property is operated by StayBid — you manage your own rooms here">
                🏨 Operated by StayBid
              </span>
            )}
            {pUser?.staffRole && (
              <span className="text-[0.58rem] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-2 py-1 rounded-full uppercase tracking-wide">
                {pUser.staffRole === "front_desk" ? "Front Desk" : pUser.staffRole === "housekeeping" ? "Housekeeping" : "Manager"}
              </span>
            )}
            {/* v324.3 — account menu. Switch experience + Sign out now live
                behind the avatar so the mobile header can never overflow past
                the right edge (right side is just [property switcher] + [avatar]).
                Desktop keeps the same one-tap access via the same menu. */}
            <div className="relative shrink-0">
              <button
                onClick={() => setAcctOpen((o) => !o)}
                aria-label="Account menu"
                title="Account"
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[0.62rem] font-bold shrink-0 border border-amber-400/40 hover:border-amber-300/70 transition-all"
                style={{background:"linear-gradient(135deg,#c9911a,#f0b429)"}}>
                {(pUser?.name || pUser?.phone || "P").slice(0,2).toUpperCase()}
              </button>
              {acctOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAcctOpen(false)} />
                  <div className="absolute right-0 mt-1.5 z-50 w-60 rounded-xl overflow-hidden shadow-2xl"
                    style={{ background: "#1c140a", border: "1px solid rgba(240,180,41,0.22)" }}>
                    <div className="px-3 py-2.5 border-b border-white/8">
                      <div className="text-sm font-semibold text-white truncate">
                        {pUser?.name || "Partner"}
                      </div>
                      {pUser?.phone && (
                        <div className="text-[0.62rem] text-white/45 truncate">{pUser.phone}</div>
                      )}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {hotel?.isOperator && (
                          <span className="text-[0.5rem] font-bold text-purple-200 bg-purple-500/15 border border-purple-400/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            🏨 Operated
                          </span>
                        )}
                        {pUser?.staffRole && (
                          <span className="text-[0.5rem] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            {pUser.staffRole === "front_desk" ? "Front Desk" : pUser.staffRole === "housekeeping" ? "Housekeeping" : "Manager"}
                          </span>
                        )}
                      </div>
                    </div>
                    <AppTourButton
                      onClick={() => setAcctOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/12 transition-all text-left"
                      title="Open the app tour & help"
                    >
                      <span aria-hidden className="text-amber-300">❓</span>
                      <span>App Tour</span>
                    </AppTourButton>
                    <HelpSupportButton
                      onClick={() => setAcctOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/12 transition-all text-left"
                      title="Chat with StayBid support"
                    >
                      <span aria-hidden className="text-amber-300">🎧</span>
                      <span>Help &amp; Support</span>
                    </HelpSupportButton>
                    <SwitchExperienceButton
                      onClick={() => setAcctOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-amber-100 hover:bg-amber-400/12 transition-all text-left"
                      title="Switch to another StayBid panel"
                    >
                      <span aria-hidden className="text-amber-300">⇄</span>
                      <span>Switch experience</span>
                    </SwitchExperienceButton>
                    <button
                      onClick={() => { setAcctOpen(false); logout(); }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-white/70 hover:text-red-300 hover:bg-red-500/8 border-t border-white/8 transition-all text-left">
                      <span aria-hidden>↶</span>
                      <span>Sign out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="bg-white/95 backdrop-blur-sm border-b border-luxury-200 sticky top-[56px] z-30 overflow-x-auto"
        style={{boxShadow:"0 1px 6px rgba(160,130,80,0.05)"}}>
        <div className="max-w-7xl mx-auto px-3 sm:px-5 flex gap-1 py-1.5">
          {TABS.map((t: any) => {
            const active = tab === t.id;
            const locked = serviceLocked(t.id);
            const cls = `shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.78rem] font-semibold transition-all ${
              active
                ? "text-white"
                : locked
                ? "text-luxury-400 hover:bg-luxury-50"
                : "text-luxury-500 hover:text-luxury-900 hover:bg-luxury-50"
            }`;
            const style = active
              ? { background:"linear-gradient(135deg,#c9911a,#f0b429)", boxShadow:"0 2px 8px rgba(201,145,26,0.3)" }
              : undefined;
            const inner = (
              <>
                <span className="text-[0.85rem]">{t.icon}</span>{t.label}
                {locked && <span className="text-[0.7rem]">🔒</span>}
                {t.id === "bids" && pendingBids > 0 && !active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
              </>
            );
            if (locked) {
              return (
                <button key={t.id} onClick={() => setLockModal(t.id)} className={cls}>
                  {inner}
                </button>
              );
            }
            if (t.href) {
              return <a key={t.id} href={t.href} className={cls} style={style}>{inner}</a>;
            }
            return (
              <button key={t.id} onClick={() => setTab(t.id as any)} className={cls} style={style}>
                {inner}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-6">

        {/* v178 — paid/trial subscription expiry warning + Renew */}
        {svcLoaded && (
          <ServiceRenewBanner
            entitlements={svcEnt}
            onRenew={(key) => setLockModal(key)}
          />
        )}

        {/* ══════════════ MY ROOMS (StayCircle operator) ══════════════ */}
        {tab === "myrooms" && hotel?.isOperator && (
          <>
            <CircleUnitsTab
              hotelId={hotel.id}
              categories={rooms}
              initialUnits={hotel.ownedUnits || []}
              hotelAutopilotMode={autopilotMode}
            />
            {/* v327 — Circle Phase C1: Model 3 pre-buy inventory (foundation) */}
            <CircleInventoryTab
              hotelId={hotel.id}
              initialUnits={hotel.ownedUnits || []}
            />
          </>
        )}

        {/* ══════════════ OVERVIEW ══════════════ */}
        {tab === "overview" && (() => {
          const todayISO = new Date().toISOString().slice(0,10);
          const isSameDay = (d: any) => d && new Date(d).toISOString().slice(0,10) === todayISO;
          const checkInsToday  = bookings.filter(b => isSameDay(b.checkIn));
          const checkOutsToday = bookings.filter(b => isSameDay(b.checkOut));
          const inHouseToday   = bookings.filter(b => {
            if (!b.checkIn || !b.checkOut) return false;
            const ci = new Date(b.checkIn).toISOString().slice(0,10);
            const co = new Date(b.checkOut).toISOString().slice(0,10);
            return ci <= todayISO && todayISO < co;
          });
          return (
          <div className="fade-up space-y-6">
            <h2 className="sec-title text-xl">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {pUser?.name?.split(" ")[0] || "Partner"} 👋</h2>

            {/* ── Quick Walk-in / PMS Control ── */}
            <div className="rounded-3xl overflow-hidden bg-linear-to-br from-luxury-900 via-luxury-800 to-luxury-900 shadow-xl border border-gold-500/20 relative">
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, #f0b429 0%, transparent 50%), radial-gradient(circle at 80% 80%, #c9911a 0%, transparent 50%)" }} />
              <div className="relative p-5 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[0.65rem] font-bold text-gold-400 uppercase tracking-[0.25em]">🏨 Front Desk</p>
                  <h3 className="font-display text-2xl text-white font-light mt-1">Walk-in Guest Arrived?</h3>
                  <p className="text-white/75 text-sm mt-1">Check room availability & check them in — auto-blocks the room across StayBid, Booking.com, Airbnb everywhere.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setQuickWalkInOpen(true)}
                    className="bg-linear-to-r from-gold-400 to-amber-400 text-luxury-900 font-bold px-5 py-3 rounded-xl hover:scale-105 transition-all shadow-lg text-sm">
                    ➕ New Walk-in
                  </button>
                  <button onClick={() => setTab("availability")}
                    className="bg-white/10 text-white border border-white/25 font-bold px-5 py-3 rounded-xl hover:bg-white/20 transition-all text-sm backdrop-blur-sm">
                    🗓️ Availability
                  </button>
                </div>
              </div>
            </div>

            {/* ── Today's Bookings — Airbnb-style hero panel ── */}
            <div className="rounded-3xl overflow-hidden shadow-lg border border-luxury-200 bg-white">
              <div className="bg-linear-to-r from-luxury-900 via-luxury-800 to-luxury-900 px-5 py-4 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-[0.65rem] font-bold text-gold-400 uppercase tracking-[0.2em]">🌅 Today · {new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"short"})}</p>
                  <p className="text-white font-display text-xl font-light mt-0.5">Your day at a glance</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-bold px-3 py-1.5 rounded-full">
                    🛬 {checkInsToday.length} Check-in{checkInsToday.length!==1?"s":""}
                  </span>
                  <span className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-xs font-bold px-3 py-1.5 rounded-full">
                    🛫 {checkOutsToday.length} Check-out{checkOutsToday.length!==1?"s":""}
                  </span>
                  <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-xs font-bold px-3 py-1.5 rounded-full">
                    🏨 {inHouseToday.length} In-house
                  </span>
                </div>
              </div>

              {/* 3 columns inside */}
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-luxury-100">
                {/* Check-ins */}
                <div className="p-4">
                  <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <span>🛬</span> Arriving Today
                  </p>
                  {checkInsToday.length === 0 ? (
                    <p className="text-sm text-luxury-400 italic">No arrivals today</p>
                  ) : (
                    <div className="space-y-2">
                      {checkInsToday.map(b => (
                        <button key={b.id} onClick={() => setSelectedBooking(b)}
                          className="w-full text-left p-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-all group">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-luxury-900 truncate">{b.guestName || b.user?.name || "Guest"}</p>
                              <p className="text-[0.65rem] text-luxury-500 truncate">
                                {b.room?.type || b.roomId}
                                {(() => {
                                  const u = Object.values(calendar[b.roomId] || {}).find((c: any) => c?.refId === b.id) as any;
                                  const num = b.assignedUnitNumber || u?.assignedUnitNumber;
                                  return num ? <span className="font-bold text-gold-600"> · #{num}</span> : null;
                                })()}
                                {" · "}{b.guests || 2} guests
                              </p>
                            </div>
                            <span className="text-emerald-600 font-bold group-hover:translate-x-0.5 transition-transform">›</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Check-outs */}
                <div className="p-4">
                  <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <span>🛫</span> Departing Today
                  </p>
                  {checkOutsToday.length === 0 ? (
                    <p className="text-sm text-luxury-400 italic">No departures today</p>
                  ) : (
                    <div className="space-y-2">
                      {checkOutsToday.map(b => (
                        <button key={b.id} onClick={() => setSelectedBooking(b)}
                          className="w-full text-left p-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all group">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-luxury-900 truncate">{b.guestName || b.user?.name || "Guest"}</p>
                              <p className="text-[0.65rem] text-luxury-500 truncate">
                                {b.room?.type || b.roomId}
                                {(() => {
                                  const u = Object.values(calendar[b.roomId] || {}).find((c: any) => c?.refId === b.id) as any;
                                  const num = b.assignedUnitNumber || u?.assignedUnitNumber;
                                  return num ? <span className="font-bold text-gold-600"> · #{num}</span> : null;
                                })()}
                                {" · "}{b.guests || 2} guests
                              </p>
                            </div>
                            <span className="text-amber-600 font-bold group-hover:translate-x-0.5 transition-transform">›</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* In-house */}
                <div className="p-4">
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <span>🏨</span> Staying Now
                  </p>
                  {inHouseToday.length === 0 ? (
                    <p className="text-sm text-luxury-400 italic">No in-house guests</p>
                  ) : (
                    <div className="space-y-2">
                      {inHouseToday.slice(0,5).map(b => (
                        <button key={b.id} onClick={() => setSelectedBooking(b)}
                          className="w-full text-left p-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all group">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-luxury-900 truncate">{b.guestName || b.user?.name || "Guest"}</p>
                              <p className="text-[0.65rem] text-luxury-500 truncate">until {fmtDate(b.checkOut)}</p>
                            </div>
                            <span className="text-blue-600 font-bold group-hover:translate-x-0.5 transition-transform">›</span>
                          </div>
                        </button>
                      ))}
                      {inHouseToday.length > 5 && (
                        <button onClick={() => setTab("bookings")} className="w-full text-center text-xs font-bold text-blue-600 hover:text-blue-700 py-1">
                          +{inHouseToday.length - 5} more →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
              {[
                { label:"Pending Bids",  value: pendingBids,  icon:"📩", color:"#b45309", bg:"#fffbeb", border:"#fde68a", action: () => setTab("bids") },
                { label:"Countered",     value: counteredBids, icon:"💬", color:"#c2410c", bg:"#fff7ed", border:"#fed7aa", action: () => setTab("bids") },
                { label:"Confirmed",     value: acceptedBids, icon:"✅", color:"#047857", bg:"#ecfdf5", border:"#a7f3d0", action: () => setTab("bookings") },
                { label:"Est. Revenue",  value: fmtCur(revenue), icon:"💰", color:"#a16207", bg:"#fefce8", border:"#fde68a", action: () => setTab("bookings") },
              ].map(s => (
                <button key={s.label} onClick={s.action}
                  className="card-p card-tight text-left hover:-translate-y-0.5 transition-transform cursor-pointer"
                  style={{ background:s.bg, borderColor:s.border }}>
                  <div className="flex items-center justify-between">
                    <span className="text-base">{s.icon}</span>
                    <span className="text-luxury-300 text-sm">›</span>
                  </div>
                  <p className="text-xl font-bold mt-1.5" style={{ color:s.color }}>{s.value}</p>
                  <p className="text-[0.68rem] text-luxury-500 font-semibold mt-0.5">{s.label}</p>
                </button>
              ))}
            </div>

            {/* ── Premium quick-launch hub ── */}
            <div>
              <p className="sec-title text-lg mb-2.5">Manage your property</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3">
                {[
                  { id:"bids",        icon:"📩", label:"Bids",            hint: pendingBids>0?`${pendingBids} to respond`:"All clear",        c:"#b45309", bg:"#fef3c7" },
                  { id:"rooms",       icon:"🏨", label:"Rooms & Pricing", hint:`${rooms.length} room${rooms.length!==1?"s":""}`,             c:"#7c3aed", bg:"#f3e8ff" },
                  { id:"flash",       icon:"⚡", label:"Flash Deals",     hint: activeDeals.length>0?`${activeDeals.length} live`:"Create one", c:"#dc2626", bg:"#fee2e2" },
                  { id:"bookings",    icon:"📅", label:"Bookings",        hint:`${bookings.length} confirmed`,                                c:"#0d9488", bg:"#ccfbf1" },
                  { id:"reservations",icon:"🛎️", label:"Reservations",    hint:"Walk-in & phone bookings",                                    c:"#7c2d12", bg:"#fde9d8" },
                  { id:"availability",icon:"🗓️", label:"Availability",    hint:"Calendar & PMS",                                              c:"#2563eb", bg:"#dbeafe" },
                  { id:"housekeeping",icon:"🧹", label:"Housekeeping",    hint:"Room status board",                                           c:"#0e7490", bg:"#cffafe" },
                  { id:"billing",     icon:"🧾", label:"Billing",         hint:"Folios · GST invoice",                                        c:"#9a3412", bg:"#ffedd5" },
                  { id:"menu",        icon:"🍽️", label:"F&B Menu",        hint:"Digital restaurant menu",                                     c:"#be123c", bg:"#ffe4e6" },
                  { id:"fnbqr",       icon:"📱", label:"F&B QR",          hint:"QR codes · guest ordering",                                   c:"#0f766e", bg:"#ccfbf1" },
                  { id:"guests",      icon:"👥", label:"Guests",          hint:"CRM · stay history",                                          c:"#7c3aed", bg:"#ede9fe" },
                  { id:"reports",     icon:"📈", label:"Reports",         hint:"Revenue · ADR · occupancy",                                   c:"#15803d", bg:"#ecfdf5" },
                  { id:"complaints",  icon:"🚩", label:"Complaints",      hint: complaintStats.open>0?`${complaintStats.open} open`:"None open", c:"#e11d48", bg:"#ffe4e6" },
                  { id:"redeem",      icon:"🎟️", label:"Redeem Codes",    hint:"📷 Scan at check-in",                                          c:"#c9911a", bg:"#fef9e7" },
                  { id:"content",     icon:"🖼️", label:"Guest Content",   hint:"Reels & photos guests posted",                                c:"#0891b2", bg:"#cffafe" },
                  { id:"verification",icon:"🎬", label:"Verification",    hint:"Video proofs",        href:"/partner/verification",            c:"#4f46e5", bg:"#e0e7ff" },
                  { id:"profile",     icon:"⚙️", label:"Profile",         hint:"Hotel & autopilot",                                            c:"#525252", bg:"#f5f5f4" },
                  { id:"staff",       icon:"🧑‍💼", label:"Staff",           hint:"Team logins & roles",                                          c:"#6d28d9", bg:"#ede9fe" },
                  { id:"channels",    icon:"🔗", label:"Channels",        hint:"OTA sync · Booking.com…",                                     c:"#1d4ed8", bg:"#dbeafe" },
                ].filter((h: any) => tabAllowed(role, h.id))
                  // v176 — unlocked (default + granted) tiles first, locked last
                  .sort((a: any, b: any) => (serviceLocked(a.id) ? 1 : 0) - (serviceLocked(b.id) ? 1 : 0))
                  .map(h => {
                  const locked = serviceLocked(h.id);
                  return (
                  <button key={h.id}
                    onClick={() => locked ? setLockModal(h.id) : (h.href ? router.push(h.href) : setTab(h.id as any))}
                    className="hub-tile" style={locked ? { opacity: 0.62 } : undefined}>
                    <div className="hub-ico" style={{ background:h.bg }}>{h.icon}</div>
                    <p className="text-[0.78rem] font-bold text-luxury-900 leading-tight">
                      {h.label}{locked && <span className="ml-1">🔒</span>}
                    </p>
                    <p className="text-[0.62rem] font-semibold leading-tight" style={{ color: locked ? "#9a8a6a" : h.c }}>
                      {locked ? "Tap to unlock" : h.hint}
                    </p>
                  </button>
                  );
                })}
              </div>
            </div>

            {/* Active flash deals strip */}
            {activeDeals.length > 0 && (
              <div className="card-p bg-linear-to-r from-amber-50 to-gold-50 border border-gold-200">
                <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-3">⚡ Active Flash Deals</p>
                <div className="space-y-2">
                  {activeDeals.slice(0,3).map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm">
                      <span className="text-luxury-700 font-medium">{rooms.find(r=>r.id===d.roomId)?.name || "Room"}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-gold-600">{fmtCur(d.dealPrice)}/night</span>
                        {d.discount > 0 && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">{d.discount}% OFF</span>}
                        <span className="text-xs text-luxury-400">{hoursLeft(d.validUntil) ? `${hoursLeft(d.validUntil)} left` : "Expired"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent bids */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-luxury-900">Recent Bids</p>
                <button onClick={() => setTab("bids")} className="text-xs text-gold-600 font-semibold hover:text-gold-700">View all →</button>
              </div>
              {bids.length === 0 ? (
                <div className="card-p text-center py-8 text-luxury-400 text-sm">No bids received yet.</div>
              ) : (
                <div className="space-y-2">
                  {bids.slice(0,5).map(b => {
                    const st = STATUS_STYLE[b.status] || STATUS_STYLE.PENDING;
                    return (
                      <div key={b.id} className="card-p flex items-center justify-between gap-3">
                        <div className="w-9 h-9 rounded-full bg-gold-100 flex items-center justify-center text-sm font-bold text-gold-700 shrink-0">
                          {(b.guestName || b.customerId || "G").slice(0,2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-luxury-900 truncate">{b.room?.type || b.roomId || "Room"}</p>
                          <p className="text-xs text-luxury-400">{fmtDate(b.checkIn || b.createdAt)}</p>
                        </div>
                        <p className="font-bold text-luxury-900 shrink-0">{fmtCur(customerBidOf(b))}<span className="text-xs text-luxury-400 font-normal">/night</span></p>
                        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                        {b.status === "PENDING" && (
                          <button onClick={() => { setSelectedBid(b); setBidAction("accept"); setCounterAmt(String(snap100(customerBidOf(b)))); setCounterAddons([]);}}
                            className="shrink-0 btn-gold text-xs px-3 py-1.5">Respond</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          );
        })()}

        {/* ══════════════ BID INBOX ══════════════ */}
        {tab === "bids" && (
          <div className="fade-up">
            <div className="flex items-center justify-between mb-5">
              <h2 className="sec-title text-xl">Bid Inbox</h2>
              <div className="flex gap-2">
                {(["PENDING","COUNTER","ACCEPTED","REJECTED","ALL"] as const).map(f => (
                  <button key={f} onClick={() => setBidFilter(f)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${
                      bidFilter === f
                        ? "bg-luxury-900 text-white border-luxury-900"
                        : "bg-white text-luxury-500 border-luxury-200 hover:border-luxury-400"
                    }`}>
                    {f === "ALL" ? "All" : f === "PENDING" ? "To Respond" : f.charAt(0)+f.slice(1).toLowerCase()}
                    {f !== "ALL" && (
                      // v239 — Use the stale-filtered set so the tab count
                      // matches the rendered list. Pre-v239 the count read
                      // raw `bids` (24) but the list rendered the
                      // `activeBidsForInbox` filter (6) — Sachin saw
                      // "Accepted (24)" with only 6 cards because 18
                      // ACCEPTED-unpaid rows had crossed the 15-min payment
                      // window and were dropped by filterActiveBids.
                      <span className="ml-1 text-[0.6rem]">({activeBidsForInbox.filter(b=>b.status===f).length})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {filteredBids.length === 0 ? (
              <div className="card-p text-center py-12 text-luxury-400">
                <p className="text-4xl mb-3">📭</p>
                <p className="font-semibold text-luxury-600">No {bidFilter === "ALL" ? "" : bidFilter.toLowerCase()} bids</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredBids.map(b => {
                  const st = STATUS_STYLE[b.status] || STATUS_STYLE.PENDING;
                  const nights = b.checkIn && b.checkOut
                    ? Math.max(1, Math.ceil((new Date(b.checkOut).getTime()-new Date(b.checkIn).getTime())/86400000))
                    : 1;
                  // v247 — total must scale by rooms too (was nights-only), so
                  // the partner sees the real ₹ a multi-room bid represents.
                  const nr = Math.max(1, Number(b.numRooms || 1));
                  return (
                    <div key={b.id} className="card-p">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gold-100 flex items-center justify-center text-sm font-bold text-gold-700 shrink-0">
                            {(b.guestName || b.customerId || "G").slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-luxury-900">{b.guestName || `Guest …${String(b.customerId||"").slice(-4)}`}</p>
                            <p className="text-xs text-luxury-400">
                              {b.room?.type || "Room"} · {b.guests || 2} guests · {nights} night{nights>1?"s":""}
                              {/* v241 — numRooms chip when > 1. Carries through
                                  via /api/partner/bids → bid row spread. */}
                              {Number(b.numRooms || 0) > 1 && (
                                <span style={{
                                  display: "inline-block",
                                  marginLeft: 6, padding: "1px 6px",
                                  borderRadius: 999,
                                  background: "rgba(201,166,107,0.18)",
                                  border: "1px solid rgba(201,166,107,0.36)",
                                  color: "#8B6914",
                                  fontSize: "0.62rem", fontWeight: 700,
                                }}>
                                  🛏️ {b.numRooms} rooms
                                </span>
                              )}
                            </p>
                            {/* v241 — capacityMismatch chip. Customer
                                packed more guests than (rooms × room
                                capacity) supports. Partner can counter
                                with more rooms or accept-anyway (most
                                accommodate via rollaway). */}
                            {b.capacityMismatch && (
                              <p className="text-[0.65rem] text-amber-700 bg-amber-50 border border-amber-200 inline-block px-2 py-0.5 rounded-sm mt-1" style={{ fontWeight: 600 }}>
                                ⚠️ {b.guests || 2} guests in {b.numRooms || 1} room{(b.numRooms || 1) > 1 ? "s" : ""} — extra-bed setup may be needed
                              </p>
                            )}
                            {/* v239 — Bid ID chip + copy-to-clipboard so the
                                hotel can correlate a card with the admin
                                panel + DB row. Sachin: "hotel pe auto
                                accepted show ho raha hai wahan bid id show
                                nhi ho rahi". Last-6 suffix is the CUID
                                random portion (visually distinct per row).
                                Tap → copies the full id; visual ✓ flash
                                via aria-live for screen readers. */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                try {
                                  navigator.clipboard.writeText(b.id);
                                  const t = e.currentTarget;
                                  const orig = t.dataset.orig || t.textContent || "";
                                  if (!t.dataset.orig) t.dataset.orig = orig;
                                  t.textContent = "✓ Copied";
                                  setTimeout(() => { t.textContent = t.dataset.orig || orig; }, 1200);
                                } catch {}
                              }}
                              title={`Bid ID: ${b.id} (tap to copy)`}
                              className="mt-1 text-[0.6rem] font-mono px-1.5 py-0.5 rounded-sm bg-luxury-100/60 hover:bg-luxury-200 text-luxury-500 hover:text-luxury-700 transition inline-flex items-center gap-1"
                            >
                              <span aria-hidden="true">📋</span>
                              <span>BID-…{String(b.id || "").slice(-6)}</span>
                            </button>
                            <div className="mt-1">
                              <SourceBadge source={b.source} creatorHandle={b.creatorHandle} />
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {/* v145 — show CUSTOMER's actual preferred bid (from
                              message), not the stored floor. Floor shown
                              below as a secondary "system min" chip when it
                              differs from the bid. */}
                          {(() => {
                            const guestBid = customerBidOf(b);
                            const floor = floorOf(b);
                            const isBelowFloor = guestBid < floor;
                            return (
                              <>
                                <p className="font-bold text-luxury-900 text-lg">{fmtCur(guestBid)}<span className="text-xs text-luxury-400 font-normal">/night</span></p>
                                {(nights > 1 || nr > 1) && <p className="text-xs text-emerald-600 font-semibold">{fmtCur(guestBid * nights * nr)} total{nr > 1 ? ` (${nr} rooms × ${nights}n)` : ""}</p>}
                                {isBelowFloor && (
                                  <p className="text-[0.6rem] text-amber-600 mt-0.5 font-semibold" title="System floor — Railway stored the bid at floor; the guest's real wish is the price above.">
                                    Floor: {fmtCur(floor)}
                                  </p>
                                )}
                                <span className={`inline-block mt-1 text-xs font-bold px-2.5 py-0.5 rounded-full border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                        <div className="bg-luxury-50 rounded-xl p-2.5">
                          <p className="text-luxury-400 mb-0.5">Check-in</p>
                          <p className="font-semibold text-luxury-800">{fmtDate(b.checkIn)}</p>
                        </div>
                        <div className="bg-luxury-50 rounded-xl p-2.5">
                          <p className="text-luxury-400 mb-0.5">Check-out</p>
                          <p className="font-semibold text-luxury-800">{fmtDate(b.checkOut)}</p>
                        </div>
                        <div className="bg-luxury-50 rounded-xl p-2.5">
                          <p className="text-luxury-400 mb-0.5">Received</p>
                          <p className="font-semibold text-luxury-800">{fmtDate(b.createdAt)}</p>
                        </div>
                      </div>

                      {b.message && (
                        <div className="mb-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 italic">
                          💬 "{b.message}"
                        </div>
                      )}

                      {b.status === "COUNTER" && (
                        <div className="mb-3 p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm">
                          You countered at <span className="font-bold text-orange-700">{fmtCur(b.counterAmount)}/night</span>
                          {b.hotelMessage && <p className="text-xs text-orange-600 mt-1">"{b.hotelMessage}"</p>}
                        </div>
                      )}
                      {b.status === "ACCEPTED" && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-semibold">
                          ✓ Booking confirmed at {fmtCur(b.counterAmount || b.amount)}/night
                        </div>
                      )}

                      {b.status === "PENDING" && (
                        <button
                          onClick={() => { setSelectedBid(b); setBidAction("accept"); setCounterAmt(String(snap100(customerBidOf(b)))); setCounterAddons([]);}}
                          className="btn-gold w-full py-2.5 text-sm mt-1">
                          Respond to Bid →
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ ROOMS & PRICING ══════════════ */}
        {tab === "rooms" && (
          <div className="fade-up">
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div>
                <h2 className="sec-title text-xl">Rooms &amp; Pricing</h2>
                <div className="flex items-center gap-1.5 text-[0.58rem] text-luxury-400 font-bold uppercase tracking-widest mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />AI Live Engine
                </div>
              </div>
              <button onClick={() => setRoomEditor({ mode: "create" })} className="btn-gold">
                ➕ Add Room Category
              </button>
            </div>

            {rooms.length === 0 ? (
              <div className="card-p text-center py-10">
                <p className="text-3xl mb-2">🏨</p>
                <p className="text-luxury-600 font-semibold text-sm">Abhi koi room category nahi hai</p>
                <p className="text-luxury-400 text-xs mt-0.5 mb-3">Pehla room type add karke pricing set karo.</p>
                <button onClick={() => setRoomEditor({ mode: "create" })} className="btn-gold">➕ Add Room Category</button>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                {rooms.map(r => {
                  const ai   = aiPrices[r.id];
                  const demandKey = (ai?.demandLevel ?? "") as DemandLevel;
                  const ds   = ai && demandKey in DEMAND_STYLE ? DEMAND_STYLE[demandKey] : null;
                  const img  = getRoomImage(r.name || r.type || "", r.images);
                  const ep   = editPrices[r.id] || {};
                  return (
                    <div key={r.id} className="card-p overflow-hidden p-0!">
                      {/* Room image */}
                      <div className="relative h-40 overflow-hidden">
                        <img src={img} alt={r.name||r.type} className="w-full h-full object-cover"
                          onError={(e: any) => { e.target.src="https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=800&q=80"; }} />
                        <div className="absolute inset-0 bg-linear-to-t from-black/70 to-transparent" />
                        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
                          <button onClick={() => setRoomEditor({ mode: "edit", room: r })}
                            className="text-[0.6rem] font-bold px-2 py-1 rounded-lg bg-white/90 text-luxury-700 hover:bg-white backdrop-blur-md transition">
                            ✏️ Edit
                          </button>
                          <button onClick={() => deleteRoomCategory(r.id)}
                            className="text-[0.6rem] font-bold px-2 py-1 rounded-lg bg-white/90 text-red-600 hover:bg-white backdrop-blur-md transition">
                            🗑
                          </button>
                        </div>
                        {ai && ds && (
                          <span className={`absolute top-3 right-3 text-[0.6rem] font-bold px-2.5 py-1 rounded-full border backdrop-blur-md bg-white/80 ${ds.text} ${ds.border}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${ds.dot} mr-1.5 ${ai.demandLevel==="Surge"?"animate-ping":""}`} />
                            {ai.demandLevel} Demand
                          </span>
                        )}
                        <div className="absolute bottom-3 left-3">
                          <p className="font-display font-light text-white text-xl">{r.name || r.type}</p>
                          <p className="text-white/60 text-xs">Up to {r.capacity || 2} guests</p>
                        </div>
                      </div>

                      <div className="p-5">
                        {/* AI price insight */}
                        {ai && (
                          <div className={`flex items-center justify-between mb-4 p-3 rounded-2xl border ${ds?.bg} ${ds?.border}`}>
                            <div>
                              <p className="text-[0.55rem] font-bold uppercase tracking-widest text-luxury-400 mb-0.5">AI Suggested Price</p>
                              <p className={`text-xl font-bold ${ds?.text}`}>{fmtCur(ai.price)}<span className="text-xs font-normal text-luxury-400">/night</span></p>
                            </div>
                            <div className="text-right">
                              <div className="h-1.5 w-24 bg-white/60 rounded-full overflow-hidden mb-1">
                                <div className="h-full rounded-full" style={{width:`${ai.demandScore}%`, background: ds?.dot.replace("bg-","").includes("-") ? "#c9911a" : "#10b981"}} />
                              </div>
                              <p className={`text-[0.6rem] ${ds?.text}`}>{ai.factors[0]}</p>
                            </div>
                          </div>
                        )}

                        {/* Pricing inputs */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">
                              Bid Floor Price
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm font-medium">₹</span>
                              <input
                                type="number"
                                placeholder={String(r.floorPrice || "")}
                                value={ep.floor ?? ""}
                                onChange={e => setEditPrices(prev => ({ ...prev, [r.id]: { ...prev[r.id], floor: e.target.value } }))}
                                className="inp-p pl-7"
                              />
                            </div>
                            <p className="text-[0.55rem] text-luxury-400 mt-1">Current: {fmtCur(r.floorPrice || 0)}</p>
                          </div>
                          <div>
                            <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">
                              Flash Deal Floor
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm font-medium">₹</span>
                              <input
                                type="number"
                                placeholder={String(r.flashFloorPrice || "")}
                                value={ep.flash ?? ""}
                                onChange={e => setEditPrices(prev => ({ ...prev, [r.id]: { ...prev[r.id], flash: e.target.value } }))}
                                className="inp-p pl-7"
                              />
                            </div>
                            <p className="text-[0.55rem] text-luxury-400 mt-1">Current: {fmtCur(r.flashFloorPrice || r.floorPrice || 0)}</p>
                          </div>
                        </div>

                        {/* AI apply buttons */}
                        {ai && (
                          <div className="flex gap-2 mb-4">
                            <button onClick={() => setEditPrices(prev => ({ ...prev, [r.id]: { ...prev[r.id], floor: String(Math.round(ai.price)) } }))}
                              className="flex-1 text-xs py-2 rounded-xl border border-luxury-200 text-luxury-600 hover:border-gold-300 hover:bg-gold-50 transition-all font-medium">
                              Apply AI → Bid Floor
                            </button>
                            <button onClick={() => setEditPrices(prev => ({ ...prev, [r.id]: { ...prev[r.id], flash: String(Math.round(ai.price * 0.82)) } }))}
                              className="flex-1 text-xs py-2 rounded-xl border border-luxury-200 text-luxury-600 hover:border-gold-300 hover:bg-gold-50 transition-all font-medium">
                              Apply AI → Flash (82%)
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => saveRoomPricing(r.id)}
                          disabled={savingRoom === r.id || (!ep.floor && !ep.flash)}
                          className={`btn-gold w-full py-2.5 text-sm ${savedRoom === r.id ? "bg-emerald-500!" : ""}`}>
                          {savingRoom === r.id ? "Saving…" : savedRoom === r.id ? "✓ Saved!" : "Save Pricing"}
                        </button>

                        {/* ── Room Photos (owner self-serve gallery) ── */}
                        <div className="mt-4 pt-4 border-t border-luxury-100">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest">
                              📸 Room Photos ({(r.images || []).length})
                            </p>
                            <span className="text-[0.6rem] text-luxury-400">Shown to guests on booking</span>
                          </div>

                          {(r.images || []).length > 0 && (
                            <div className="grid grid-cols-4 gap-2 mb-3">
                              {(r.images || []).map((url: string, i: number) => (
                                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-luxury-200 group">
                                  <img src={url} alt={`Room photo ${i+1}`} className="w-full h-full object-cover" />
                                  <button
                                    onClick={() => saveRoomImages(r.id, (r.images || []).filter((_: string, j: number) => j !== i))}
                                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/90 text-white text-[0.6rem] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove photo">
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <ImageUpload
                            folder={`rooms/${r.id}`}
                            onUpload={(url) => saveRoomImages(r.id, [...(r.images || []), url])}
                          />
                          <p className="text-[0.55rem] text-luxury-400 mt-1">
                            Upload high-quality photos (JPG/PNG). First photo shows as the cover.
                          </p>
                        </div>

                        {/* ── Room Numbers Inventory ── */}
                        {(() => {
                          const units = roomUnits.filter(u => u.roomId === r.id);
                          return (
                            <div className="mt-4 pt-4 border-t border-luxury-100">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest">🔢 Physical Rooms ({units.length})</p>
                                <span className="text-[0.6rem] text-luxury-400">Individual room numbers</span>
                              </div>

                              {units.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mb-3">
                                  {units.map(u => (
                                    <span key={u.id}
                                      className={`group inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border ${
                                        u.status === "active"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : "bg-orange-50 text-orange-600 border-orange-200 line-through"
                                      }`}>
                                      #{u.roomNumber}
                                      <button onClick={() => toggleUnitStatus(u)}
                                        title={u.status === "active" ? "Mark as under maintenance" : "Reactivate"}
                                        className="opacity-40 hover:opacity-100">
                                        {u.status === "active" ? "🔧" : "↻"}
                                      </button>
                                      <button onClick={() => deleteRoomUnit(u.id)}
                                        className="opacity-40 hover:opacity-100 text-red-500">✕</button>
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  placeholder="e.g. 101, 102, 201-205"
                                  value={unitDraft[r.id] || ""}
                                  onChange={e => setUnitDraft(p => ({ ...p, [r.id]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === "Enter") saveRoomUnitsBulk(r.id); }}
                                  className="inp-p flex-1 text-xs"
                                />
                                <button
                                  onClick={() => saveRoomUnitsBulk(r.id)}
                                  disabled={unitSaving === r.id || !unitDraft[r.id]?.trim()}
                                  className="text-xs px-3 py-2 rounded-lg bg-luxury-900 text-white font-semibold hover:bg-luxury-800 disabled:opacity-40">
                                  {unitSaving === r.id ? "…" : "+ Add"}
                                </button>
                              </div>
                              <p className="text-[0.55rem] text-luxury-400 mt-1">Comma separate or use ranges (e.g. 201-205)</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ FLASH DEALS ══════════════ */}
        {tab === "flash" && (
          <div className="fade-up space-y-6">
            <h2 className="sec-title text-xl">Flash Deals</h2>

            {/* Create deal */}
            <div className="card-p border-2 border-gold-200 bg-linear-to-br from-gold-50/30 to-white">
              <p className="text-xs font-bold text-gold-600 uppercase tracking-widest mb-4">⚡ Create New Flash Deal</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Room</label>
                  <select value={newDeal.roomId} onChange={e => {
                    const r = rooms.find(r=>r.id===e.target.value);
                    const ai = r ? aiPrices[r.id] : null;
                    setNewDeal(p => ({
                      ...p,
                      roomId: e.target.value,
                      dealPrice: ai ? String(Math.round(ai.price * 0.78)) : p.dealPrice,
                      discount: r && ai ? String(Math.round((1 - ai.price*0.78/(r.floorPrice||ai.price))*100)) : p.discount,
                    }));
                  }} className="inp-p">
                    <option value="">Select room…</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name || r.type}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Deal Price/Night</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 text-sm">₹</span>
                    <input type="number" className="inp-p pl-7" placeholder="e.g. 2499" value={newDeal.dealPrice}
                      onChange={e => setNewDeal(p=>({...p, dealPrice:e.target.value}))} />
                  </div>
                </div>
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Discount %</label>
                  <input type="number" className="inp-p" placeholder="e.g. 25" value={newDeal.discount}
                    onChange={e => setNewDeal(p=>({...p, discount:e.target.value}))} />
                </div>
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Duration (hours)</label>
                  <select value={newDeal.durationHours} onChange={e=>setNewDeal(p=>({...p,durationHours:e.target.value}))} className="inp-p">
                    {[6,12,24,48,72].map(h=><option key={h} value={h}>{h < 24 ? `${h} hours` : `${h/24} day${h>24?"s":""}`}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Max Rooms</label>
                  <input type="number" className="inp-p" min={1} max={20} value={newDeal.maxRooms}
                    onChange={e=>setNewDeal(p=>({...p,maxRooms:e.target.value}))} />
                </div>
                <div className="flex items-end">
                  <button onClick={createFlashDeal} disabled={dealLoading} className="btn-gold w-full py-2.5 text-sm">
                    {dealLoading ? "Creating…" : "⚡ Launch Deal"}
                  </button>
                </div>
              </div>
              {dealMsg && (
                <p className={`text-sm font-semibold ${dealMsg.startsWith("✓") ? "text-emerald-600" : "text-red-500"}`}>{dealMsg}</p>
              )}
            </div>

            {/* Existing deals */}
            <div>
              <p className="font-semibold text-luxury-900 mb-3">All Flash Deals</p>
              {flashDeals.length === 0 ? (
                <div className="card-p text-center py-8 text-luxury-400 text-sm">No flash deals created yet.</div>
              ) : (
                <div className="space-y-3">
                  {flashDeals.map(d => {
                    const left = hoursLeft(d.validUntil || "");
                    const active = d.isActive !== false && left !== null;
                    const room = rooms.find(r => r.id === d.roomId);
                    return (
                      <div key={d.id} className={`card-p flex items-center justify-between gap-4 ${active ? "border-gold-200" : "opacity-60"}`}>
                        <div className="flex items-center gap-3">
                          <span className={`text-lg ${active ? "" : "grayscale"}`}>⚡</span>
                          <div>
                            <p className="font-semibold text-luxury-900">{room?.name || room?.type || "Room"}</p>
                            <p className="text-xs text-luxury-400">
                              {fmtCur(d.dealPrice)}/night · {d.discount > 0 ? `${d.discount}% off` : "special price"}
                              {left ? ` · ${left} left` : " · Expired"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-luxury-100 text-luxury-400 border-luxury-200"}`}>
                            {active ? "Active" : "Inactive"}
                          </span>
                          {active && (
                            <button onClick={() => deactivateDeal(d.id)}
                              className="text-xs text-red-500 hover:bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg transition-all">
                              Stop
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════ BOOKINGS ══════════════ */}
        {tab === "bookings" && (
          <div className="fade-up">
            <h2 className="sec-title text-xl mb-5">Confirmed Bookings</h2>
            {bookings.length === 0 ? (
              <div className="card-p text-center py-12 text-luxury-400">
                <p className="text-4xl mb-3">📅</p>
                <p className="font-semibold text-luxury-600">No confirmed bookings yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bookings.map((b: any) => {
                  const nights = b.checkIn && b.checkOut
                    ? Math.max(1, Math.ceil((new Date(b.checkOut).getTime()-new Date(b.checkIn).getTime())/86400000))
                    : 1;
                  // v247 — multi-room bookings: total = rate × nights × rooms.
                  const nr = Math.max(1, Number(b.numRooms || 1));
                  const total = (b.counterAmount || b.amount || 0) * nights * nr;
                  return (
                    <button key={b.id} onClick={() => setSelectedBooking(b)}
                      className="card-p flex items-start justify-between gap-4 w-full text-left hover:shadow-lg hover:border-gold-300 transition-all cursor-pointer">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-base shrink-0">🎫</div>
                        <div className="min-w-0">
                          <p className="font-semibold text-luxury-900 truncate">{b.guestName || b.user?.name || "Guest"} · {b.room?.type || b.roomId || "Room"}</p>
                          <p className="text-xs text-luxury-500">
                            {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} · {nights} night{nights>1?"s":""}
                          </p>
                          <p className="text-xs text-luxury-400">{b.guests || 2} guests · Booked {fmtDate(b.createdAt)}</p>
                          <div className="mt-1">
                            <SourceBadge source={b.source} creatorHandle={b.creatorHandle} />
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-luxury-900 text-base">{fmtCur(total)}</p>
                        <p className="text-xs text-luxury-400">{fmtCur(b.counterAmount || b.amount)}/night</p>
                        <span className={`inline-block mt-1 text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                          b.status === "CHECKED_OUT" ? "bg-purple-50 text-purple-700 border-purple-200" :
                          b.status === "CHECKED_IN"  ? "bg-blue-50 text-blue-700 border-blue-200" :
                          "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}>{b.status === "CHECKED_OUT" ? "Checked out" : b.status === "CHECKED_IN" ? "Checked in" : "Confirmed"} ›</span>
                        {/* Check-in / Check-out actions — additive layer, doesn't affect confirm flow */}
                        <div className="flex gap-1.5 mt-2 justify-end" onClick={(e) => e.stopPropagation()}>
                          {b.status !== "CHECKED_IN" && b.status !== "CHECKED_OUT" && (
                            <button onClick={async (e) => {
                              e.stopPropagation();
                              const tkn = getToken();
                              await fetch(`/api/partner/checkin/${b.id}`, { method: "POST", headers: { Authorization: `Bearer ${tkn}` } });
                              refreshLive(tkn || "");
                            }} className="text-[10px] px-2 py-1 rounded-full bg-blue-600 text-white font-bold hover:bg-blue-700">Mark Check-in</button>
                          )}
                          {b.status === "CHECKED_IN" && (
                            <button onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm("Mark check-out? This starts the 4-hour feedback window.")) return;
                              const tkn = getToken();
                              await fetch(`/api/partner/checkout/${b.id}`, { method: "POST", headers: { Authorization: `Bearer ${tkn}` } });
                              refreshLive(tkn || "");
                            }} className="text-[10px] px-2 py-1 rounded-full bg-purple-600 text-white font-bold hover:bg-purple-700">Mark Check-out</button>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ FRONT DESK · RESERVATIONS ══════════════ */}
        {tab === "reservations" && hotel?.id && (
          <ReservationsTab hotelId={hotel.id} rooms={rooms} />
        )}

        {/* ══════════════ HOUSEKEEPING ══════════════ */}
        {tab === "housekeeping" && hotel?.id && (
          <HousekeepingTab hotelId={hotel.id} rooms={rooms} roomUnits={roomUnits} />
        )}

        {/* ══════════════ BILLING / FOLIO ══════════════ */}
        {tab === "billing" && hotel?.id && (
          <BillingTab hotelId={hotel.id} rooms={rooms} bids={bids} />
        )}

        {/* ══════════════ F&B DIGITAL MENU ══════════════ */}
        {tab === "menu" && hotel?.id && (
          <MenuBuilderTab hotelId={hotel.id} />
        )}

        {/* ══════════════ F&B QR ORDERING ══════════════ */}
        {tab === "fnbqr" && hotel?.id && (
          <FnbOrdersTab hotelId={hotel.id} hotelName={hotel.name || "Hotel"} />
        )}

        {/* ══════════════ GUEST CRM ══════════════ */}
        {tab === "guests" && hotel?.id && (
          <GuestsTab bids={bids} hotelId={hotel.id} />
        )}

        {/* ══════════════ STAFF & ROLES ══════════════ */}
        {tab === "staff" && hotel?.id && role === "owner" && (
          <StaffTab hotelId={hotel.id} />
        )}

        {/* ══════════════ CHANNEL MANAGER ══════════════ */}
        {tab === "channels" && hotel?.id && role === "owner" && (
          <ChannelManagerTab hotelId={hotel.id} rooms={rooms} roomUnits={roomUnits} />
        )}

        {/* ══════════════ REPORTS & ANALYTICS ══════════════ */}
        {tab === "reports" && hotel?.id && (
          <ReportsTab bids={bids} rooms={rooms} hotelId={hotel.id} />
        )}

        {/* ══════════════ AVAILABILITY / PMS ══════════════
            v132 — three-view rewrite of <AvailabilityCalendar>:
              · 📅 Month (default): full month grid; tap a date → per-room
                detail panel with walk-in / remove-block actions.
              · 🛏️ Room: pick one room from horizontal card picker → big
                easy-to-read month timeline for THAT room.
              · 📊 Grid: classic per-room × per-day matrix (v113 layout
                preserved for power users via the view toggle).
              · 📌 Block dates → bulk maintenance / group hold sheet.
              · OTA "Select room…" dropdown upgraded to visual room
                cards + provider pills (no more selects).
        */}
        {tab === "availability" && (
          <div className="fade-up space-y-6">
            <div className="flex items-end justify-between flex-wrap gap-3">
              <div>
                <h2 className="sec-title text-xl">Availability Calendar</h2>
                <p className="text-sm text-luxury-500">Real-time occupancy across bookings, walk-ins, OTA channels & manual holds</p>
              </div>
            </div>

            <AvailabilityCalendar
              rooms={rooms.map(r => ({ id: r.id, type: r.type, name: r.name, capacity: r.capacity }))}
              calendar={calendar}
              month={calMonth}
              onMonthChange={setCalMonth}
              onRefresh={loadCalendar}
              loading={calLoading}
              onPickWalkIn={({ roomId, fromDate, toDate }) => {
                setWalkInOpen({ roomId, date: fromDate });
                setWalkIn({
                  fromDate, toDate,
                  guestName: "", guestPhone: "", amount: "", note: "",
                  assignedUnitId: "", assignedUnitNumber: "",
                });
              }}
              onDeleteBlock={deleteBlock}
              onOpenBlockSheet={() => setBlockSheetOpen(true)}
              roomPrices={roomPrices}
              priceOverrides={priceOverrides}
              onSavePricing={savePricing}
              onClearPricing={clearPricing}
              autopilotMode={autopilotMode}
              flashByRoom={flashByRoom}
            />

            <BlockDatesSheet
              open={blockSheetOpen}
              onClose={() => setBlockSheetOpen(false)}
              rooms={rooms.map(r => ({ id: r.id, type: r.type, name: r.name }))}
              onSubmit={submitBulkBlock}
            />

            {/* OTA Feeds manager — shared component (v316); the full Channel
                Manager console lives in the Channels tab. */}
            <div className="card-p">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="font-display text-xl text-luxury-900">🌐 OTA Channel Sync</h3>
                {tabAllowed(role, "channels") && (
                  <button onClick={() => setTab("channels")} className="btn-ghost text-xs px-2.5! py-1! shrink-0">
                    Full Channel Manager →
                  </button>
                )}
              </div>
              <p className="text-sm text-luxury-500 mb-4">
                Paste iCal URLs from Booking.com, Airbnb, MakeMyTrip, Goibibo or Agoda. Their bookings automatically block your availability — and release when cancelled.
              </p>
              <OtaFeedManager hotelId={hotel.id} rooms={rooms} onChanged={loadCalendar} />
            </div>
          </div>
        )}

        {/* ══════════════ WALK-IN MODAL ══════════════ */}
        {walkInOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
            onClick={() => setWalkInOpen(null)}>
            <div className="bg-white rounded-3xl max-w-md w-full mx-4 overflow-hidden" onClick={e=>e.stopPropagation()}>
              <div className="bg-linear-to-r from-luxury-900 to-luxury-800 px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[0.65rem] font-bold text-gold-400 uppercase tracking-widest">Walk-in Booking</p>
                  <p className="text-white font-semibold text-lg">{rooms.find(r=>r.id===walkInOpen.roomId)?.type || "Room"}</p>
                </div>
                <button onClick={()=>setWalkInOpen(null)} className="text-white/70 hover:text-white text-2xl">✕</button>
              </div>
              <div className="p-6 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Check-in</label>
                    <input type="date" className="inp-p" value={walkIn.fromDate} onChange={e=>setWalkIn(p=>({...p, fromDate:e.target.value}))} />
                  </div>
                  <div>
                    <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Check-out</label>
                    <input type="date" className="inp-p" value={walkIn.toDate} onChange={e=>setWalkIn(p=>({...p, toDate:e.target.value}))} />
                  </div>
                </div>
                <div>
                  <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Guest Name</label>
                  <input className="inp-p" value={walkIn.guestName} onChange={e=>setWalkIn(p=>({...p, guestName:e.target.value}))} placeholder="Walk-in guest"/>
                </div>
                {/* Room number picker */}
                {(() => {
                  const free = freeUnitsForRoom(walkInOpen.roomId, walkIn.fromDate, walkIn.toDate);
                  const allForRoom = roomUnits.filter(u => u.roomId === walkInOpen.roomId);
                  return (
                    <div>
                      <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">🔢 Allocate Room Number</label>
                      {allForRoom.length === 0 ? (
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                          No room numbers set for this category. Add them in <b>Rooms</b> tab.
                        </p>
                      ) : free.length === 0 ? (
                        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                          All rooms of this category are occupied on selected dates.
                        </p>
                      ) : (
                        <select
                          className="inp-p"
                          value={walkIn.assignedUnitId}
                          onChange={e => {
                            const u = free.find((x: any) => x.id === e.target.value);
                            setWalkIn(p => ({ ...p, assignedUnitId: u?.id || "", assignedUnitNumber: u?.roomNumber || "" }));
                          }}>
                          <option value="">Auto-assign later</option>
                          {free.map((u: any) => (
                            <option key={u.id} value={u.id}>Room #{u.roomNumber}{u.floor ? ` · Floor ${u.floor}` : ""}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })()}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Phone</label>
                    <input className="inp-p" value={walkIn.guestPhone} onChange={e=>setWalkIn(p=>({...p, guestPhone:e.target.value}))} placeholder="Optional"/>
                  </div>
                  <div>
                    <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Amount (₹)</label>
                    <input type="number" className="inp-p" value={walkIn.amount} onChange={e=>setWalkIn(p=>({...p, amount:e.target.value}))} placeholder="Per night"/>
                  </div>
                </div>
                <div>
                  <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Note</label>
                  <textarea rows={2} className="inp-p resize-none" value={walkIn.note} onChange={e=>setWalkIn(p=>({...p, note:e.target.value}))} placeholder="ID proof, notes, etc."/>
                </div>
                <button onClick={submitWalkIn} disabled={walkInSaving} className="btn-gold w-full py-3 text-sm">
                  {walkInSaving ? "Saving…" : "✓ Confirm Walk-in"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ QUICK WALK-IN MODAL (from Overview) ══════════════ */}
        {quickWalkInOpen && (() => {
          const qToday = new Date().toISOString().slice(0,10);
          const qTomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10);
          // Initialize dates to today → tomorrow if blank
          if (!walkIn.fromDate) { setWalkIn(p => ({ ...p, fromDate: qToday, toDate: qTomorrow })); }
          const pickedRoom = rooms.find(r => r.id === (walkInOpen?.roomId || ""));
          return (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs overflow-y-auto"
              onClick={() => { setQuickWalkInOpen(false); setWalkInOpen(null); }}>
              <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden my-0 sm:my-8"
                onClick={e => e.stopPropagation()}>
                <div className="bg-linear-to-r from-luxury-900 via-luxury-800 to-luxury-900 px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-[0.65rem] font-bold text-gold-400 uppercase tracking-widest">🏨 Front Desk</p>
                    <p className="text-white font-display text-xl font-light">Walk-in Booking</p>
                  </div>
                  <button onClick={() => { setQuickWalkInOpen(false); setWalkInOpen(null); }}
                    className="text-white/70 hover:text-white w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">✕</button>
                </div>

                <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Check-in</label>
                      <input type="date" className="inp-p" value={walkIn.fromDate} min={qToday}
                        onChange={e=>setWalkIn(p=>({...p, fromDate:e.target.value}))} />
                    </div>
                    <div>
                      <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Check-out</label>
                      <input type="date" className="inp-p" value={walkIn.toDate} min={walkIn.fromDate || qToday}
                        onChange={e=>setWalkIn(p=>({...p, toDate:e.target.value}))} />
                    </div>
                  </div>

                  {/* Room category selector — with live availability count */}
                  <div>
                    <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">🏨 Room Category</label>
                    <div className="grid grid-cols-1 gap-2">
                      {rooms.map(r => {
                        const free = freeUnitsForRoom(r.id, walkIn.fromDate, walkIn.toDate);
                        const total = roomUnits.filter(u => u.roomId === r.id && u.status === "active").length;
                        const selected = walkInOpen?.roomId === r.id;
                        return (
                          <button key={r.id}
                            onClick={() => {
                              setWalkInOpen({ roomId: r.id, date: walkIn.fromDate });
                              setWalkIn(p => ({ ...p, assignedUnitId:"", assignedUnitNumber:"", amount: String(r.floorPrice || p.amount) }));
                            }}
                            className={`text-left p-3 rounded-xl border-2 transition-all ${
                              selected ? "border-indigo-500 bg-indigo-50" : "border-luxury-200 hover:border-luxury-300"
                            } ${total === 0 || free.length === 0 ? "opacity-60" : ""}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold text-luxury-900 text-sm">{r.type || r.name}</p>
                                <p className="text-[0.6rem] text-luxury-500">₹{r.floorPrice || 0}/night · up to {r.capacity || 2} guests</p>
                              </div>
                              <div className="text-right">
                                {total === 0 ? (
                                  <span className="text-[0.55rem] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">No room #s set</span>
                                ) : (
                                  <>
                                    <p className={`text-lg font-bold ${free.length === 0 ? "text-red-600" : "text-emerald-600"}`}>{free.length}/{total}</p>
                                    <p className="text-[0.55rem] text-luxury-400">free</p>
                                  </>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Unit picker (visible once category chosen) */}
                  {walkInOpen?.roomId && (() => {
                    const free = freeUnitsForRoom(walkInOpen.roomId, walkIn.fromDate, walkIn.toDate);
                    const total = roomUnits.filter(u => u.roomId === walkInOpen.roomId).length;
                    if (total === 0) {
                      return (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                          ⚠️ No physical room numbers set for this category. Go to <b>Rooms</b> tab and add room numbers (e.g. 101, 102) for this category first.
                        </div>
                      );
                    }
                    if (free.length === 0) {
                      return (
                        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                          🛑 All rooms of this category are occupied on these dates.
                        </div>
                      );
                    }
                    return (
                      <div>
                        <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">🔢 Allocate Room Number</label>
                        <div className="grid grid-cols-4 gap-1.5">
                          {free.map((u: any) => (
                            <button key={u.id}
                              onClick={() => setWalkIn(p => ({ ...p, assignedUnitId: u.id, assignedUnitNumber: u.roomNumber }))}
                              className={`p-2 rounded-lg text-sm font-bold border-2 transition-all ${
                                walkIn.assignedUnitId === u.id
                                  ? "bg-indigo-500 text-white border-indigo-500 shadow-md"
                                  : "bg-white text-luxury-700 border-luxury-200 hover:border-indigo-400"
                              }`}>
                              #{u.roomNumber}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Guest details */}
                  <div className="pt-3 border-t border-luxury-100 space-y-2">
                    <div>
                      <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Guest Name</label>
                      <input className="inp-p" value={walkIn.guestName} onChange={e=>setWalkIn(p=>({...p, guestName:e.target.value}))} placeholder="Walk-in guest"/>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Phone</label>
                        <input className="inp-p" value={walkIn.guestPhone} onChange={e=>setWalkIn(p=>({...p, guestPhone:e.target.value}))} placeholder="Optional"/>
                      </div>
                      <div>
                        <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Rate/night ₹</label>
                        <input type="number" className="inp-p" value={walkIn.amount} onChange={e=>setWalkIn(p=>({...p, amount:e.target.value}))}/>
                      </div>
                    </div>
                    <div>
                      <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Note</label>
                      <input className="inp-p" value={walkIn.note} onChange={e=>setWalkIn(p=>({...p, note:e.target.value}))} placeholder="ID proof, notes, etc."/>
                    </div>
                  </div>

                  <button onClick={async () => { await submitWalkIn(); setQuickWalkInOpen(false); }}
                    disabled={walkInSaving || !walkInOpen?.roomId || !walkIn.fromDate || !walkIn.toDate}
                    className="w-full py-3 rounded-xl bg-linear-to-r from-gold-400 to-amber-400 text-luxury-900 font-bold text-sm hover:shadow-xl transition-all disabled:opacity-40">
                    {walkInSaving ? "Saving…" : walkIn.assignedUnitNumber ? `✓ Check-in · Room #${walkIn.assignedUnitNumber}` : "✓ Confirm Walk-in (auto-assign)"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ══════════════ COMPLAINTS ══════════════ */}
        {tab === "complaints" && (
          <div className="fade-up space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="sec-title text-xl">Guest Complaints</h2>
              <button onClick={loadComplaints} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-luxury-200 text-luxury-700 hover:bg-luxury-50">
                ↻ Refresh
              </button>
            </div>
            <p className="text-sm text-luxury-500 -mt-3">
              Read-only feed. Resolutions (refunds, hotel warnings) happen via the StayBid admin team.
              Reach out to <a href="mailto:support@staybids.in" className="text-gold-700 underline">support@staybids.in</a> if you want to add context to a specific complaint.
            </p>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Open / In Review", value: complaintStats.open, color: "amber", border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-800" },
                { label: "Total Complaints", value: complaintStats.total, color: "luxury", border: "border-luxury-200", bg: "bg-white", text: "text-luxury-800" },
                { label: "General", value: complaintStats.general || 0, color: "blue", border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-800" },
                { label: "Video / Verification", value: complaintStats.video || 0, color: "purple", border: "border-purple-200", bg: "bg-purple-50", text: "text-purple-800" },
              ].map((s, i) => (
                <div key={i} className={`rounded-2xl px-4 py-3 border ${s.border} ${s.bg}`}>
                  <div className="text-[0.6rem] font-bold uppercase tracking-widest text-luxury-400">{s.label}</div>
                  <div className={`mt-1 text-2xl font-bold ${s.text}`}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* General complaints list */}
            <div>
              <h3 className="text-xs font-bold text-luxury-500 uppercase tracking-widest mb-2">General complaints</h3>
              {complaintsLoading ? (
                <div className="card-p text-center py-10 text-luxury-400">Loading…</div>
              ) : complaints.length === 0 ? (
                <div className="card-p text-center py-10 text-luxury-400">No general complaints raised against this hotel — great news.</div>
              ) : (
                <div className="space-y-3">
                  {complaints.map((c: any) => {
                    const isResolved = c.status === "resolved" || c.status === "rejected";
                    const priorityStyle = c.priority === "high" ? "border-red-300 bg-red-50" : c.priority === "medium" ? "border-amber-300 bg-amber-50" : "border-luxury-200 bg-white";
                    return (
                      <article key={c.id} className={`rounded-2xl border ${priorityStyle} px-4 py-3.5`}>
                        <div className="flex justify-between items-start gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-bold text-luxury-500 uppercase tracking-wider">{c.type || "general"}</span>
                              {c.priority === "high" && <span className="text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full bg-red-500 text-white">Urgent</span>}
                              <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full ${isResolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                                {c.status || "open"}
                              </span>
                            </div>
                            <div className="font-semibold text-luxury-900 text-sm">{c.subject || (c.description || "").slice(0, 80) || "—"}</div>
                            <div className="text-[0.7rem] text-luxury-500 mt-0.5">
                              {c.id?.slice(0, 12)} · {c.customerPhone || c.customerId?.slice(0, 8) || "guest"} · {c.createdAt ? new Date(c.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                            </div>
                          </div>
                          {c.bookingId && (
                            <button
                              onClick={() => setTab("bookings")}
                              className="text-[0.65rem] font-bold px-2 py-1 rounded-md bg-luxury-100 text-luxury-700 hover:bg-luxury-200"
                            >
                              View booking
                            </button>
                          )}
                        </div>
                        {c.description && (
                          <p className="text-xs text-luxury-700 leading-relaxed mt-2 whitespace-pre-wrap line-clamp-4">{c.description}</p>
                        )}
                        {/* v127.1 — Stay-feedback smiley summary so hotels see WHAT
                             guests rated, not just a generic description. Privacy:
                             only the smiley grid + auto-flag pill; no customer
                             notes, no video URLs. */}
                        {c.feedbackType === "stay_feedback" && c.feedback && (
                          <div className="mt-2 px-3 py-2 rounded-lg bg-gold-50 border border-gold-200">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[0.6rem] font-bold text-gold-800 uppercase tracking-wider">
                                Stay feedback {c.feedbackAutoFilled && <span className="ml-1 opacity-60">· auto-marked positive</span>}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                ["roomMatch","Room"],
                                ["staff","Staff"],
                                ["hygiene","Hygiene"],
                                ["food","Food"],
                                ["staffResponse","Response"],
                              ].map(([k,label]) => {
                                const v = (c.feedback as any)?.[k];
                                const icon = v === "positive" ? "😊" : v === "neutral" ? "😐" : v === "negative" ? "😞" : "—";
                                const tone = v === "positive" ? "bg-emerald-100 text-emerald-800"
                                          : v === "neutral"  ? "bg-amber-100 text-amber-800"
                                          : v === "negative" ? "bg-red-100 text-red-800"
                                          : "bg-luxury-100 text-luxury-600";
                                return (
                                  <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] ${tone}`}>
                                    <span>{icon}</span>
                                    <span className="font-medium">{label}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {(c.adminNotes || c.adminNote) && (
                          <div className="mt-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
                            <div className="text-[0.6rem] font-bold text-emerald-800 uppercase tracking-wider mb-0.5">Admin reply</div>
                            <p className="text-xs text-emerald-900">{c.adminNotes || c.adminNote}</p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Video evidence complaints */}
            {vpComplaints.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-luxury-500 uppercase tracking-widest mb-2">Video evidence complaints</h3>
                <p className="text-xs text-luxury-500 mb-2">These have a recorded video. Open the Verification tab to view side-by-side with your hotel video.</p>
                <div className="space-y-3">
                  {vpComplaints.map((c: any) => (
                    <article key={c.id} className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3.5">
                      <div className="flex justify-between items-start gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs font-bold text-purple-700 uppercase tracking-wider">{c.category || "evidence"}</span>
                            <span className={`text-[0.6rem] font-bold uppercase px-2 py-0.5 rounded-full ${c.status === "resolved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                              {c.status || "open"}
                            </span>
                          </div>
                          <div className="text-[0.7rem] text-purple-700 mt-0.5">
                            {c.id?.slice(0, 12)} · booking {c.booking_id?.slice(0, 8) || "—"} · {c.created_at ? new Date(c.created_at).toLocaleString("en-IN", { day: "numeric", month: "short" }) : "—"}
                          </div>
                          {c.description && <p className="text-xs text-luxury-700 mt-2 line-clamp-3">{c.description}</p>}
                        </div>
                        <a
                          href="/partner/verification"
                          className="text-[0.65rem] font-bold px-2 py-1 rounded-md bg-purple-200 text-purple-800 hover:bg-purple-300"
                        >
                          Open Verification →
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════ REDEEM (v124) ══════════════ */}
        {tab === "redeem" && hotel?.id && (
          <PartnerRedeemTab hotelId={hotel.id} />
        )}

        {/* ══════════════ CONTENT REVIEWS (Phase 5 tier-system) ══════════════ */}
        {tab === "content" && hotel?.id && (
          <PartnerContentTab hotelId={hotel.id} />
        )}

        {tab === "passport" && hotel?.id && (
          <PartnerPassportTab />
        )}

        {/* ══════════════ STAYCIRCLE (v288) ══════════════ */}
        {tab === "circle" && hotel?.id && (
          <PartnerCircleTab />
        )}

        {/* ══════════════ SELL TO AGENTS (Model 3 auction supply) ══════════════ */}
        {tab === "agentauction" && hotel?.id && (
          <AgentAuctionTab
            hotelId={hotel.id}
            hotelName={hotel.name}
            city={hotel.city}
            rooms={rooms}
          />
        )}

        {/* ══════════════ PROFILE ══════════════ */}
        {tab === "profile" && (
          <div className="fade-up max-w-xl">
            <h2 className="sec-title text-xl mb-5">Hotel Profile</h2>

            {/* v178 — Subscription billing — payment history + receipts. */}
            <div className="card-p mb-5 flex items-center gap-3">
              <span className="text-xl">🧾</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-luxury-900 text-sm">Subscription Billing</h3>
                <p className="text-[0.68rem] text-luxury-500">Service payments aur receipts dekho</p>
              </div>
              <button
                type="button"
                onClick={() => setBillingOpen(true)}
                className="shrink-0 rounded-lg px-3 py-1.5 text-[0.7rem] font-bold text-white"
                style={{ background: "#c9911a" }}
              >
                View history
              </button>
            </div>

            {/* v130 — Autopilot mode card. Lives at the top of Profile so the
                partner sees their automation posture immediately. Defaults
                to 'auto' if the column isn't provisioned — no UI hides
                behind a migration. */}
            <div className="card-p space-y-3 mb-5 border-2 border-amber-200 bg-linear-to-br from-amber-50 to-luxury-50">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤖</span>
                <h3 className="font-bold text-luxury-900 text-base">Autopilot Mode</h3>
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.55rem] font-bold uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-300">
                  {AUTOPILOT_MODE_LABEL[autopilotMode]}
                </span>
              </div>
              <p className="text-[0.72rem] text-luxury-500 leading-relaxed">
                Pick how the hotel confirms bids on your behalf. You can still accept / counter / decline any pending bid before its timer fires — your action always overrides.
              </p>

              <div className="grid grid-cols-1 gap-2">
                {(["auto", "hybrid", "manual"] as AutopilotMode[]).map((m) => {
                  const on = autopilotMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={autopilotSaving}
                      onClick={() => saveAutopilot(m)}
                      className={`text-left rounded-2xl border-2 p-3 transition-all ${
                        on
                          ? "border-amber-500 bg-white shadow-xs scale-[1.01]"
                          : "border-luxury-200 bg-white hover:border-amber-300"
                      } disabled:opacity-60`}
                      aria-pressed={on}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          aria-hidden
                          className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center text-[0.5rem] font-bold ${
                            on ? "bg-amber-500 border-amber-500 text-white" : "border-luxury-300 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold ${on ? "text-amber-900" : "text-luxury-800"}`}>
                            {AUTOPILOT_MODE_LABEL[m]}
                          </p>
                          <p className={`text-[0.65rem] mt-0.5 leading-relaxed ${on ? "text-amber-700" : "text-luxury-500"}`}>
                            {AUTOPILOT_MODE_DESC[m]}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {autopilotMsg && (
                <p className={`text-xs font-semibold ${autopilotMsg.startsWith("✓") ? "text-emerald-600" : autopilotMsg.startsWith("⚠") ? "text-amber-700" : "text-red-600"}`}>
                  {autopilotMsg}
                </p>
              )}
            </div>

            <div className="card-p space-y-4">
              {[
                { key:"name",        label:"Hotel Name",    type:"text",   placeholder:"Your hotel's full name" },
                { key:"city",        label:"City",          type:"text",   placeholder:"e.g. Mussoorie" },
                { key:"state",       label:"State",         type:"text",   placeholder:"e.g. Uttarakhand" },
                { key:"starRating",  label:"Star Rating",   type:"number", placeholder:"1–5" },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    placeholder={f.placeholder}
                    value={editHotel[f.key] ?? ""}
                    onChange={e => setEditHotel((p: any) => ({ ...p, [f.key]: e.target.value }))}
                    className="inp-p"
                  />
                </div>
              ))}
              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Description</label>
                <textarea rows={3} placeholder="Describe your property…" value={editHotel.description ?? ""}
                  onChange={e => setEditHotel((p: any) => ({ ...p, description: e.target.value }))}
                  className="inp-p resize-none" />
              </div>
              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Amenities (comma-separated)</label>
                <input type="text"
                  placeholder="WiFi, Parking, Pool, AC, Breakfast…"
                  value={Array.isArray(editHotel.amenities) ? editHotel.amenities.join(", ") : editHotel.amenities ?? ""}
                  onChange={e => setEditHotel((p: any) => ({ ...p, amenities: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))}
                  className="inp-p" />
              </div>

              {/* v170 — Property type. Drives which /bid auctions this
                  hotel is invited to. */}
              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Property Type</label>
                <select
                  value={editHotel.property_type ?? "hotel"}
                  onChange={e => setEditHotel((p: any) => ({ ...p, property_type: e.target.value }))}
                  className="inp-p"
                >
                  {PROPERTY_TYPES.map(pt => (
                    <option key={pt.id} value={pt.id}>{pt.emoji} {pt.label}</option>
                  ))}
                </select>
              </div>

              {/* v170 — Meal plans this hotel actually serves. A bid that
                  asks for a plan you don't tick will never reach you. */}
              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Meal Plans You Offer</label>
                <div className="flex flex-wrap gap-2">
                  {CAT_MEAL_PLANS.map(mp => {
                    const arr: string[] = Array.isArray(editHotel.meal_plans) ? editHotel.meal_plans : [];
                    const on = arr.includes(mp.id);
                    return (
                      <button key={mp.id} type="button"
                        onClick={() => setEditHotel((p: any) => {
                          const cur: string[] = Array.isArray(p.meal_plans) ? p.meal_plans : [];
                          return { ...p, meal_plans: cur.includes(mp.id) ? cur.filter(x => x !== mp.id) : [...cur, mp.id] };
                        })}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-gold-500 border-gold-500 text-white" : "bg-white border-luxury-200 text-luxury-500"}`}
                      >
                        {mp.label}{mp.perGuestNight > 0 ? ` · ₹${mp.perGuestNight}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* v170 — Add-on services this hotel can provide. */}
              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Add-on Services You Provide</label>
                <div className="flex flex-wrap gap-2">
                  {ADDON_SERVICES.map(ad => {
                    const arr: string[] = Array.isArray(editHotel.addon_services) ? editHotel.addon_services : [];
                    const on = arr.includes(ad.id);
                    return (
                      <button key={ad.id} type="button"
                        onClick={() => setEditHotel((p: any) => {
                          const cur: string[] = Array.isArray(p.addon_services) ? p.addon_services : [];
                          return { ...p, addon_services: cur.includes(ad.id) ? cur.filter(x => x !== ad.id) : [...cur, ad.id] };
                        })}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-gold-500 border-gold-500 text-white" : "bg-white border-luxury-200 text-luxury-500"}`}
                      >
                        {ad.emoji} {ad.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* v511 — Phase B: tag each gallery photo by space-type so guests
                  can browse "Bedroom / Bathroom / Views…" like Airbnb. Untagged
                  photos still show under "All". Saved with the profile below. */}
              <div className="pt-1">
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Photo Categories</label>
                {Array.isArray(editHotel.images) && editHotel.images.length > 0 ? (
                  <>
                    <p className="text-[0.68rem] text-luxury-500 mb-2.5 leading-relaxed">
                      Label each photo so guests can browse by space. Optional — untagged photos still appear under “All”.
                    </p>
                    <div className="space-y-2">
                      {editHotel.images.map((url: string, i: number) => {
                        const cur = (editHotel.image_categories && editHotel.image_categories[url]) || "";
                        return (
                          <div key={i} className="flex items-center gap-2.5 rounded-xl border border-luxury-200 bg-white p-2">
                            <img
                              src={url}
                              alt={`Photo ${i + 1}`}
                              className="w-14 h-14 rounded-lg object-cover shrink-0 bg-luxury-100"
                              onError={(e: any) => { e.currentTarget.style.opacity = "0.35"; }}
                            />
                            <select
                              value={cur}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEditHotel((p: any) => {
                                  const next = { ...(p.image_categories || {}) };
                                  if (v) next[url] = v; else delete next[url];
                                  return { ...p, image_categories: next };
                                });
                              }}
                              className="inp-p flex-1 text-sm"
                            >
                              <option value="">— Uncategorized —</option>
                              {PHOTO_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-[0.68rem] text-luxury-500 leading-relaxed">
                    No gallery photos yet. Add property photos during onboarding, then return here to tag them by space-type.
                  </p>
                )}
              </div>

              <button onClick={saveHotelProfile} disabled={profileSaving} className="btn-gold w-full py-3 text-sm">
                {profileSaving ? "Saving…" : "Save Profile"}
              </button>
              {profileMsg && (
                <p className={`text-sm font-semibold text-center ${profileMsg.startsWith("✓") ? "text-emerald-600" : "text-red-500"}`}>
                  {profileMsg}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══════════════ BID ACTION MODAL ══════════════ */}
      {/* v145 — responsive shell: mobile bottom-sheet (full width, rounded-top,
          drag indicator), tablet+laptop centered (max-w-lg), desktop wide
          (max-w-2xl). Max-h locked to viewport with internal scroll so the
          sticky header + sticky Send CTA always stay in view. */}
      {selectedBid && !bidActDone && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setSelectedBid(null)}>
          <div className="bg-white w-full sm:max-w-lg lg:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[88vh]"
            onClick={e => e.stopPropagation()}>
            {/* Mobile drag-indicator pill (purely visual — modal closes via X/backdrop). */}
            <div className="sm:hidden flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-luxury-200" />
            </div>
            <div className="bg-luxury-900 px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs font-bold text-white/50 uppercase tracking-widest">Respond to Bid</p>
                <p className="text-white font-semibold text-lg">{selectedBid.room?.type || "Room"}</p>
                <p className="text-white/50 text-sm">
                  Guest bid: <span className="text-white font-semibold">{fmtCur(customerBidOf(selectedBid))}</span>/night
                  {floorOf(selectedBid) > customerBidOf(selectedBid) && (
                    <span className="ml-1.5 text-amber-300/80">· Floor {fmtCur(floorOf(selectedBid))}</span>
                  )}
                  <span className="ml-1.5 text-white/40">· {selectedBid.guests || 2} guests</span>
                </p>
              </div>
              <button onClick={() => setSelectedBid(null)} className="text-white/50 hover:text-white text-2xl shrink-0">✕</button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
              {/* Action choice */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v:"accept",  icon:"✅", label:"Accept",  bg:"bg-emerald-50", border:"border-emerald-300", text:"text-emerald-700" },
                  { v:"counter", icon:"💬", label:"Counter", bg:"bg-amber-50",   border:"border-amber-300",   text:"text-amber-700"   },
                  { v:"reject",  icon:"❌", label:"Decline", bg:"bg-red-50",     border:"border-red-300",     text:"text-red-700"     },
                ] as const).map(a => (
                  <button key={a.v} onClick={() => setBidAction(a.v)}
                    className={`p-3 rounded-2xl border-2 text-center transition-all ${
                      bidAction === a.v ? `${a.bg} ${a.border} shadow-md scale-[1.03]` : "border-luxury-200 hover:border-luxury-300"
                    }`}>
                    <p className="text-2xl mb-1">{a.icon}</p>
                    <p className={`text-xs font-bold ${bidAction === a.v ? a.text : "text-luxury-500"}`}>{a.label}</p>
                  </button>
                ))}
              </div>

              {bidAction === "counter" && (() => {
                // v145 — premium counter arena.
                //
                // Anchors:
                //   • guestBid  = customer's ACTUAL preferred bid (from message
                //                 token, falling back to b.amount for normal
                //                 above-floor bids).
                //   • floor     = system floor (b.amount; equals room floor on
                //                 above-floor bids, equals floor on below-floor
                //                 bids — Railway stores them at floor).
                //   • Slider range = [guestBid, max(floor*1.5, guestBid + 5×step)].
                //   • Track is rendered in 2-3 colored zones so the partner
                //     SEES at a glance where their counter sits:
                //       rose  zone  guestBid → floor   (sweetheart / below-floor)
                //       gold  zone  floor    → floor*1.2  (smart counter, sweet spot)
                //       sage  zone  floor*1.2 → max      (premium counter)
                //   • AI suggestion = midpoint of guestBid & (floor*1.10) — the
                //     "meets in the middle, slight margin" recommendation.
                const guestBid = snap100(customerBidOf(selectedBid));
                const floor    = snap100(floorOf(selectedBid));
                const minCt    = Math.max(PRICE_MIN, Math.min(guestBid, floor));
                const maxCt    = Math.max(ceil100(Math.max(floor, guestBid) * 1.5), minCt + PRICE_STEP * 5);
                const currentVal = snapClamp100(counterAmt || guestBid, minCt, maxCt);
                const aiSuggest  = snapClamp100((guestBid + Math.max(floor, guestBid) * 1.10) / 2, minCt, maxCt);
                const premium    = snapClamp100(Math.max(floor, guestBid) * 1.20, minCt, maxCt);

                // Position helpers for zone-tinted track (% along [minCt, maxCt]).
                const pct = (n: number) => Math.max(0, Math.min(100, ((n - minCt) / Math.max(1, maxCt - minCt)) * 100));
                const floorPct   = pct(floor);
                const premiumPct = pct(premium);
                const currentPct = pct(currentVal);

                // Margin vs guest bid (informational — green when above, rose when at/below).
                const margin = currentVal - guestBid;
                const marginPct = guestBid > 0 ? Math.round((margin / guestBid) * 100) : 0;

                // Match probability (heuristic): closer to guest bid → higher.
                const matchProb = (() => {
                  if (currentVal <= guestBid) return 98;
                  if (currentVal <= floor)    return 80 - Math.round(((currentVal - guestBid) / Math.max(1, floor - guestBid)) * 25);
                  if (currentVal <= premium)  return 55 - Math.round(((currentVal - floor)    / Math.max(1, premium - floor))    * 25);
                  return Math.max(8, 30 - Math.round(((currentVal - premium) / Math.max(1, maxCt - premium)) * 22));
                })();

                const probColor =
                  matchProb >= 75 ? { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" } :
                  matchProb >= 45 ? { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   dot: "bg-amber-500"   } :
                                    { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    dot: "bg-rose-500"    };

                const chips: { label: string; amt: number; sub: string }[] = [
                  { label: "❤️ Match guest", amt: guestBid,  sub: "Sweetheart" },
                  { label: "⭐ AI smart",    amt: aiSuggest, sub: "Recommended" },
                  { label: "⚡ Premium",     amt: premium,   sub: "Top margin" },
                ];

                return (
                  <div>
                    {/* Premium header: arena vibe + live probability chip. */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest">⚡ Counter Pricing Arena</p>
                        <p className="text-[0.6rem] text-luxury-500 mt-0.5">Drag the gold dot · steps of ₹{PRICE_STEP}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 text-[0.65rem] font-bold px-2.5 py-1 rounded-full border ${probColor.bg} ${probColor.text} ${probColor.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${probColor.dot} animate-pulse`} />
                        {matchProb}% match
                      </div>
                    </div>

                    {/* Hero counter card — current value + guest bid + margin. */}
                    <div className="rounded-2xl p-4 mb-4 bg-linear-to-br from-amber-50 via-luxury-50 to-white border border-amber-200 shadow-xs">
                      <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[0.55rem] font-bold text-luxury-400 uppercase tracking-widest mb-1">Your counter</p>
                          <p className="text-3xl font-extrabold text-luxury-900 leading-none">
                            {fmtCur(currentVal)}<span className="text-xs font-medium text-luxury-400 ml-1">/night</span>
                          </p>
                          <p className="text-[0.65rem] font-semibold mt-1.5">
                            {margin > 0   ? <span className="text-emerald-700">+{fmtCur(margin)} above guest ({marginPct > 0 ? `+${marginPct}%` : `${marginPct}%`})</span> :
                             margin === 0 ? <span className="text-amber-700">matches guest's wish</span> :
                                            <span className="text-rose-700">−{fmtCur(-margin)} below guest (sweetheart)</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[0.55rem] font-bold text-luxury-400 uppercase tracking-widest">Guest bid</p>
                          <p className="text-base font-bold text-luxury-700">{fmtCur(guestBid)}</p>
                          {floor !== guestBid && (
                            <p className="text-[0.55rem] text-amber-600 mt-0.5">Floor {fmtCur(floor)}</p>
                          )}
                        </div>
                      </div>

                      {/* Zone-tinted slider track with floor + premium markers.
                          - Rose (sweetheart)   : minCt → floor
                          - Gold (smart)        : floor → premium
                          - Sage (premium)      : premium → maxCt
                          - Floor marker (▼)
                          - AI suggested marker (◆) */}
                      <div className="relative mt-4 mb-1 select-none">
                        {/* Track background (3-zone gradient). */}
                        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full overflow-hidden bg-luxury-100"
                          style={{
                            background: `linear-gradient(to right,
                              rgba(244,176,164,0.35) 0%,
                              rgba(244,176,164,0.35) ${floorPct}%,
                              rgba(245,191,107,0.55) ${floorPct}%,
                              rgba(245,191,107,0.55) ${premiumPct}%,
                              rgba(157,173,143,0.45) ${premiumPct}%,
                              rgba(157,173,143,0.45) 100%)`,
                          }}
                        />
                        {/* Filled portion up to current value (gold gradient on top). */}
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-2.5 rounded-full pointer-events-none"
                          style={{
                            width: `${currentPct}%`,
                            background: "linear-gradient(90deg, #C9A66B 0%, #D9BE82 60%, #E7CFA0 100%)",
                            boxShadow: "0 1px 3px rgba(201,166,107,0.45) inset",
                          }}
                        />
                        {/* Floor marker (only when floor sits inside slider range). */}
                        {floor > minCt && floor < maxCt && (
                          <div className="absolute -top-4 -translate-x-1/2 pointer-events-none" style={{ left: `${floorPct}%` }}>
                            <div className="w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-[5px] border-t-amber-600 mx-auto" />
                            <p className="text-[0.5rem] font-bold text-amber-700 -mt-0.5 whitespace-nowrap text-center">Floor</p>
                          </div>
                        )}
                        {/* AI suggestion marker. */}
                        {aiSuggest > minCt && aiSuggest < maxCt && (
                          <div className="absolute -bottom-5 -translate-x-1/2 pointer-events-none" style={{ left: `${pct(aiSuggest)}%` }}>
                            <p className="text-[0.5rem] font-bold text-emerald-700 whitespace-nowrap text-center">◆ AI</p>
                          </div>
                        )}
                        {/* The actual draggable range input — transparent, sits on top. */}
                        <input
                          type="range"
                          min={minCt}
                          max={maxCt}
                          step={PRICE_STEP}
                          value={currentVal}
                          onChange={(e) => setCounterAmt(String(snapClamp100(Number(e.target.value), minCt, maxCt)))}
                          className="relative w-full h-6 cursor-grab active:cursor-grabbing appearance-none bg-transparent counter-range"
                          aria-label="Counter price slider"
                          aria-valuemin={minCt}
                          aria-valuemax={maxCt}
                          aria-valuenow={currentVal}
                        />
                      </div>
                      <div className="flex justify-between mt-4 text-[0.55rem] text-luxury-400 font-mono">
                        <span>{fmtCur(minCt)}</span>
                        <span>{fmtCur(maxCt)}</span>
                      </div>
                    </div>

                    {/* Quick-pick chips — Match guest · AI smart · Premium. */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {chips.map((c) => {
                        const amt = c.amt;
                        const active = currentVal === amt;
                        return (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => setCounterAmt(String(amt))}
                            className={`rounded-xl p-2.5 text-center border-2 transition-all ${
                              active
                                ? "bg-amber-50 border-amber-400 shadow-md scale-[1.03]"
                                : "bg-white border-luxury-200 hover:border-amber-300 hover:scale-[1.01]"
                            }`}
                          >
                            <p className={`text-[0.62rem] font-bold ${active ? "text-amber-700" : "text-luxury-600"}`}>{c.label}</p>
                            <p className={`text-sm font-extrabold mt-0.5 ${active ? "text-amber-900" : "text-luxury-800"}`}>{fmtCur(amt)}</p>
                            <p className={`text-[0.5rem] mt-0.5 ${active ? "text-amber-600" : "text-luxury-400"}`}>{c.sub}</p>
                          </button>
                        );
                      })}
                    </div>

                    {/* Manual ₹ stepper — for partners who want exact control. */}
                    <div className="flex items-center justify-center gap-2 mb-4">
                      <button
                        type="button"
                        onClick={() => setCounterAmt(String(snapClamp100(currentVal - PRICE_STEP, minCt, maxCt)))}
                        disabled={currentVal <= minCt}
                        className="w-9 h-9 rounded-full bg-luxury-50 hover:bg-luxury-100 disabled:opacity-30 disabled:cursor-not-allowed border border-luxury-200 text-luxury-700 font-bold transition-all">
                        −
                      </button>
                      <div className="px-3 py-1.5 rounded-lg bg-luxury-50 border border-luxury-100 min-w-28 text-center">
                        <p className="text-xs font-extrabold text-luxury-800">{fmtCur(currentVal)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCounterAmt(String(snapClamp100(currentVal + PRICE_STEP, minCt, maxCt)))}
                        disabled={currentVal >= maxCt}
                        className="w-9 h-9 rounded-full bg-luxury-50 hover:bg-luxury-100 disabled:opacity-30 disabled:cursor-not-allowed border border-luxury-200 text-luxury-700 font-bold transition-all">
                        +
                      </button>
                    </div>

                    {/* v129 — Structured complimentary-amenity catalog.
                        Free-text "Message to Guest" is GONE. Hotels can only
                        bundle perks from this whitelisted catalog; the
                        selection serializes into the message field with a
                        sentinel prefix the customer side parses into chips.
                        Anti-bypass: phone/email/WhatsApp can't be typed. */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest">
                          Include complimentary
                        </label>
                        <span className="text-[0.55rem] text-luxury-400">{counterAddons.length} selected</span>
                      </div>
                      <p className="text-[0.62rem] text-luxury-500 leading-relaxed mb-2">
                        Tap to attach perks to your counter. Guest sees these as chips next to your price — no typed messages allowed.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                        {COUNTER_ADDONS.map((a) => {
                          const on = counterAddons.includes(a.id);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() =>
                                setCounterAddons((prev) =>
                                  prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id],
                                )
                              }
                              className={`flex items-start gap-2 rounded-xl p-2 border text-left transition-all ${
                                on
                                  ? "bg-amber-50 border-amber-400 shadow-xs"
                                  : "bg-white border-luxury-200 hover:border-amber-300"
                              }`}
                              aria-pressed={on}
                            >
                              <span className="text-lg leading-none mt-0.5">{a.icon}</span>
                              <span className="flex-1 min-w-0">
                                <span className={`block text-[0.7rem] font-bold leading-tight ${on ? "text-amber-800" : "text-luxury-800"}`}>
                                  {a.label}
                                </span>
                                <span className={`block text-[0.55rem] mt-0.5 ${on ? "text-amber-600" : "text-luxury-400"}`}>
                                  {a.desc}
                                </span>
                              </span>
                              <span
                                aria-hidden
                                className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center text-[0.5rem] font-bold ${
                                  on ? "bg-amber-500 border-amber-500 text-white" : "border-luxury-300 text-transparent"
                                }`}
                              >
                                ✓
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* v129 — "Message to Guest" textarea removed.
                  - On COUNTER: amenities below carry the partner's offer.
                  - On ACCEPT/DECLINE: no message field at all. Confirmation
                    + decline are status flips; in-stay chat opens AFTER
                    booking confirms (see /partner/dashboard Booking modal
                    BookingChat — gated to status ≥ ACCEPTED per v25 + v71). */}
            </div>

            {/* Sticky footer — Send CTA stays visible regardless of scroll. */}
            <div className="border-t border-luxury-100 bg-white/95 backdrop-blur-xs px-5 sm:px-6 py-3 shrink-0">
              <button onClick={submitBidAction} disabled={bidActLoading || (bidAction==="counter" && !counterAmt)}
                className="btn-gold w-full py-3 text-sm shadow-md">
                {bidActLoading ? "Sending…" :
                  bidAction==="accept"  ? `✅ Accept at ${fmtCur(customerBidOf(selectedBid))}/night` :
                  bidAction==="counter" ? `💬 Send Counter: ${counterAmt ? fmtCur(snap100(counterAmt)) : "—"}/night${counterAddons.length ? ` + ${counterAddons.length} perk${counterAddons.length>1?"s":""}` : ""}` :
                  "❌ Decline Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bidActDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-8 text-center shadow-2xl max-w-xs w-full mx-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4 text-3xl">
              {bidAction==="accept" ? "🎉" : bidAction==="counter" ? "💬" : "✓"}
            </div>
            <h3 className="font-display text-xl font-light text-luxury-900 mb-1">
              {bidAction==="accept" ? "Booking Confirmed!" : bidAction==="counter" ? "Counter Sent!" : "Bid Declined"}
            </h3>
            <p className="text-luxury-400 text-sm">Guest has been notified.</p>
          </div>
        </div>
      )}

      {/* ══════════════ BOOKING DETAIL MODAL ══════════════ */}
      {selectedBooking && (() => {
        const b = selectedBooking;
        const nights = b.checkIn && b.checkOut
          ? Math.max(1, Math.ceil((new Date(b.checkOut).getTime()-new Date(b.checkIn).getTime())/86400000))
          : 1;
        const pricePerNight = b.counterAmount || b.amount || 0;
        // v247 — booking detail total scales by rooms × nights.
        const nr = Math.max(1, Number(b.numRooms || 1));
        const total = pricePerNight * nights * nr;
        const guestInitials = (b.guestName || b.user?.name || "G").slice(0,2).toUpperCase();
        const todayISO = new Date().toISOString().slice(0,10);
        const ciISO = b.checkIn ? new Date(b.checkIn).toISOString().slice(0,10) : "";
        const coISO = b.checkOut ? new Date(b.checkOut).toISOString().slice(0,10) : "";
        let statusLabel = "Confirmed";
        let statusBadge = "bg-emerald-500/20 text-emerald-300 border-emerald-400/30";
        if (ciISO === todayISO) { statusLabel = "Arriving Today"; statusBadge = "bg-emerald-500/20 text-emerald-300 border-emerald-400/30"; }
        else if (coISO === todayISO) { statusLabel = "Departing Today"; statusBadge = "bg-amber-500/20 text-amber-300 border-amber-400/30"; }
        else if (ciISO && coISO && ciISO <= todayISO && todayISO < coISO) { statusLabel = "In-house"; statusBadge = "bg-blue-500/20 text-blue-300 border-blue-400/30"; }
        else if (ciISO && ciISO > todayISO) { statusLabel = "Upcoming"; statusBadge = "bg-indigo-500/20 text-indigo-300 border-indigo-400/30"; }
        else if (coISO && coISO < todayISO) { statusLabel = "Checked Out"; statusBadge = "bg-white/10 text-white/60 border-white/20"; }

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs overflow-y-auto"
            onClick={() => setSelectedBooking(null)}>
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden my-0 sm:my-8"
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="relative bg-linear-to-br from-luxury-900 via-luxury-800 to-black px-6 py-5">
                <button onClick={() => setSelectedBooking(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg">✕</button>
                <p className="text-[0.6rem] font-bold text-gold-400 uppercase tracking-[0.25em]">Booking Details</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-12 h-12 rounded-full bg-linear-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold">{guestInitials}</div>
                  <div>
                    <p className="text-white font-semibold text-lg">{b.guestName || b.user?.name || "Guest"}</p>
                    <p className="text-white/60 text-xs">ID: {String(b.id).slice(0,12).toUpperCase()}</p>
                  </div>
                </div>
                <span className={`inline-block mt-3 text-[0.65rem] font-bold px-3 py-1 rounded-full border uppercase tracking-widest ${statusBadge}`}>
                  {statusLabel}
                </span>
              </div>

              {/* Body */}
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <p className="text-[0.6rem] font-bold text-emerald-600 uppercase tracking-widest">🛬 Check-in</p>
                    <p className="text-sm font-bold text-luxury-900 mt-1">{fmtDate(b.checkIn)}</p>
                    <p className="text-[0.65rem] text-luxury-500">{b.checkIn && new Date(b.checkIn).toLocaleDateString("en-IN",{weekday:"long"})}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <p className="text-[0.6rem] font-bold text-amber-600 uppercase tracking-widest">🛫 Check-out</p>
                    <p className="text-sm font-bold text-luxury-900 mt-1">{fmtDate(b.checkOut)}</p>
                    <p className="text-[0.65rem] text-luxury-500">{b.checkOut && new Date(b.checkOut).toLocaleDateString("en-IN",{weekday:"long"})}</p>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-luxury-500 font-semibold">
                  <span className="h-px flex-1 bg-luxury-200" />
                  <span>🌙 {nights} night{nights>1?"s":""}</span>
                  <span className="h-px flex-1 bg-luxury-200" />
                </div>

                {/* Room + assigned unit */}
                {(() => {
                  // Find assigned unit number for this booking (bid or block)
                  const fromBid = Object.values(calendar[b.roomId] || {}).find((c: any) => c?.refId === b.id) as any;
                  const assignedNumber = b.assignedUnitNumber || fromBid?.assignedUnitNumber || "";
                  const freeForAssign = freeUnitsForRoom(b.roomId, b.checkIn || "", b.checkOut || "");
                  return (
                    <div className="p-4 rounded-2xl bg-luxury-50 border border-luxury-200">
                      <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest mb-2">🏨 Room</p>
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div>
                          <p className="font-semibold text-luxury-900">{b.room?.type || b.roomId || "—"}</p>
                          {b.room?.capacity && <p className="text-xs text-luxury-500">Capacity: {b.room.capacity} guests</p>}
                          <p className="text-xs text-luxury-500">{b.guests || 2} guest{(b.guests||2)>1?"s":""} booked</p>
                        </div>
                        {assignedNumber ? (
                          <div className="text-right">
                            <p className="text-[0.55rem] font-bold text-gold-600 uppercase tracking-widest">Allocated Room</p>
                            <p className="text-2xl font-bold text-gold-700">#{assignedNumber}</p>
                          </div>
                        ) : (
                          <div className="w-full mt-2">
                            <p className="text-[0.6rem] font-bold text-amber-600 uppercase mb-1">⚠️ No room # assigned</p>
                            {freeForAssign.length === 0 ? (
                              <p className="text-xs text-luxury-400">No free rooms in this category.</p>
                            ) : (
                              <select
                                className="inp-p text-xs"
                                onChange={async e => {
                                  const unitId = e.target.value; if (!unitId) return;
                                  const token = getToken();
                                  await fetch("/api/partner/room-units/assign", {
                                    method: "POST",
                                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                                    body: JSON.stringify({ bidId: b.id, unitId }),
                                  });
                                  loadCalendar();
                                  alert("✓ Room assigned");
                                }}>
                                <option value="">Assign a room number…</option>
                                {freeForAssign.map((u: any) => (
                                  <option key={u.id} value={u.id}>#{u.roomNumber}{u.floor ? ` · Floor ${u.floor}` : ""}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Guest contact */}
                <div className="p-4 rounded-2xl bg-white border border-luxury-200 space-y-2">
                  <p className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest">👤 Guest Contact</p>
                  {(b.guestPhone || b.user?.phone) && (
                    <a href={`tel:${b.guestPhone || b.user?.phone}`} className="flex items-center justify-between text-sm hover:bg-luxury-50 -mx-2 px-2 py-1 rounded-sm">
                      <span className="text-luxury-600">📱 Phone</span>
                      <span className="font-bold text-luxury-900">{b.guestPhone || b.user?.phone}</span>
                    </a>
                  )}
                  {(b.guestEmail || b.user?.email) && (
                    <a href={`mailto:${b.guestEmail || b.user?.email}`} className="flex items-center justify-between text-sm hover:bg-luxury-50 -mx-2 px-2 py-1 rounded-sm">
                      <span className="text-luxury-600">✉️ Email</span>
                      <span className="font-semibold text-luxury-900 truncate">{b.guestEmail || b.user?.email}</span>
                    </a>
                  )}
                  {!(b.guestPhone || b.user?.phone) && !(b.guestEmail || b.user?.email) && (
                    <p className="text-xs text-luxury-400 italic">No contact info on file</p>
                  )}
                </div>

                {/* Payment */}
                <div className="p-4 rounded-2xl bg-linear-to-br from-gold-50 to-amber-50 border border-gold-200">
                  <p className="text-[0.6rem] font-bold text-gold-700 uppercase tracking-widest mb-2">💰 Payment</p>
                  <div className="flex justify-between text-sm py-1">
                    <span className="text-luxury-600">Rate per night</span>
                    <span className="font-semibold text-luxury-900">{fmtCur(pricePerNight)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1">
                    <span className="text-luxury-600">× {nights} night{nights>1?"s":""}{nr > 1 ? ` × ${nr} rooms` : ""}</span>
                    <span className="font-semibold text-luxury-900">{fmtCur(total)}</span>
                  </div>
                  <div className="h-px bg-gold-300 my-2" />
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-luxury-900">Total Revenue</span>
                    <span className="text-xl font-bold text-gold-700">{fmtCur(total)}</span>
                  </div>
                  {b.message && /razorpay|pay_/i.test(b.message) && (
                    <p className="text-[0.65rem] text-emerald-700 font-semibold mt-2">✓ Paid online via Razorpay</p>
                  )}
                </div>

                {/* Notes / source */}
                {b.message && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-[0.6rem] font-bold text-blue-600 uppercase tracking-widest mb-1">📝 Guest Message</p>
                    <p className="text-xs text-luxury-700">{b.message}</p>
                  </div>
                )}

                <div className="text-[0.65rem] text-luxury-400 text-center">
                  Booking created on {fmtDate(b.createdAt)}
                  {b.status && <> · Status: <b className="text-luxury-600">{b.status}</b></>}
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {(b.guestPhone || b.user?.phone) && (
                    <a href={`tel:${b.guestPhone || b.user?.phone}`}
                      className="py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold text-center transition-all">
                      📞 Call Guest
                    </a>
                  )}
                  {(b.guestPhone || b.user?.phone) && (
                    <a href={`https://wa.me/${String(b.guestPhone || b.user?.phone).replace(/[^0-9]/g,"")}`} target="_blank" rel="noopener"
                      className="py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-bold text-center transition-all">
                      💬 WhatsApp
                    </a>
                  )}
                </div>

                {/* Phase 7: in-platform trip chat — gated to confirmed bids.
                    Anti-bypass sanitizer applied server-side; safe to use for
                    coordinating early check-in, dietary needs, etc. */}
                <PartnerBookingChat bidId={b.id} hotelId={hotel?.id || ""} guestName={b.guestName || b.user?.name || "Guest"} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── v170 — Room category create / edit modal ── */}
      {roomEditor && hotel?.id && (
        <RoomEditorModal
          mode={roomEditor.mode}
          room={roomEditor.room}
          hotelId={hotel.id}
          token={getToken()}
          onClose={() => setRoomEditor(null)}
          onSaved={onRoomSaved}
        />
      )}

      {/* ── v176 — locked subscription service modal ── */}
      {lockModal && hotel?.id && (
        <ServiceLockModal
          serviceKey={lockModal}
          hotelId={hotel.id}
          pendingRequest={svcReqs.find((r: any) => r.service_key === lockModal) || null}
          pricing={svcPricing.find((p: any) => p.service_key === lockModal) || null}
          bundles={svcBundles}
          renew={["paid", "trial"].includes(svcEnt[lockModal]?.accessType)}
          onClose={() => setLockModal(null)}
          onRequested={() => {
            setSvcReqs((p) => [...p, { service_key: lockModal, kind: "activate", status: "pending" }]);
            setLockModal(null);
          }}
          onUnlocked={() => {
            // v178 — paid checkout succeeded; pull fresh entitlements so
            // the now-unlocked service drops its 🔒 immediately.
            const token = getToken();
            if (token) refreshLive(token);
            setLockModal(null);
          }}
        />
      )}

      {/* v178 — subscription billing history */}
      {billingOpen && (
        <SubscriptionBillingModal onClose={() => setBillingOpen(false)} />
      )}
    </div>
  );
}

// ───────── v124 Redeem tab — partner scans / enters a guest code at check-in ─────
function PartnerRedeemTab({ hotelId }: { hotelId: string }) {
  const [codeInput, setCodeInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<any>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  async function lookupCode(rawCode: string) {
    const code = (rawCode || "").trim().toUpperCase();
    if (!code) return;
    setValidating(true);
    setError("");
    setValidated(null);
    try {
      const r: any = await api.partnerValidateCode(code);
      if (r?.code) {
        setValidated(r);
        if (!r.canFulfill) {
          setError(
            r.code.status !== "active"
              ? `This code is ${r.code.status}.`
              : r.code.kind !== "amenity"
              ? "This is a customer-checkout coupon. Only amenity codes are fulfilled at the hotel."
              : "Cannot fulfill this code."
          );
        }
      } else {
        setError(r?.error || "Code not found");
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setValidating(false);
    }
  }
  function lookup() { return lookupCode(codeInput); }
  // v170 — camera scan hands the raw decoded value straight into lookup.
  function onScan(raw: string) {
    const c = (raw || "").trim().toUpperCase();
    setCodeInput(c);
    setValidated(null);
    setError("");
    lookupCode(c);
  }

  async function fulfill() {
    if (!validated?.code?.code) return;
    setValidating(true);
    try {
      const r: any = await api.partnerFulfillCode({ code: validated.code.code, hotelId });
      if (r?.ok) {
        showToast(`✓ Fulfilled: ${validated.code.title || validated.code.code}`);
        setRecent((rs) => [{ ...validated, fulfilledAt: new Date().toISOString() }, ...rs.slice(0, 19)]);
        setValidated(null);
        setCodeInput("");
        setError("");
      } else {
        setError(r?.error || "Failed to fulfill");
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="fade-up max-w-2xl">
      <h2 className="sec-title text-xl mb-0.5">Redeem Guest Codes</h2>
      <p className="text-[0.78rem] text-luxury-500 mb-4">Scan a guest's reward code with your camera at check-in — or type it in. Amenity perks (breakfast, late checkout, upgrades) appear here.</p>

      {/* ── Scanner-first capture card ── */}
      <div className="card-p mb-3.5">
        <div className="rounded-xl p-3.5 mb-3 flex items-center gap-3"
          style={{ background:"linear-gradient(135deg,#fff8e6,#fdf1cf)", border:"1px solid #f0e0b0" }}>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background:"linear-gradient(135deg,#f0b429,#c9911a)" }}>📷</div>
          <div className="flex-1 min-w-0">
            <p className="text-[0.82rem] font-bold text-luxury-900 leading-tight">Camera scan</p>
            <p className="text-[0.66rem] text-luxury-500 leading-tight mt-0.5">Point the camera at the guest's QR or barcode</p>
          </div>
          <CodeScanner onDetected={onScan} buttonClassName="btn-gold" buttonLabel="Scan now" />
        </div>

        <div className="flex items-center gap-2 my-2">
          <div className="h-px flex-1 bg-luxury-200" />
          <span className="text-[0.6rem] font-bold text-luxury-400 uppercase tracking-widest">or enter manually</span>
          <div className="h-px flex-1 bg-luxury-200" />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            value={codeInput}
            onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setValidated(null); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="STAY-XXXX-XXXX or 12-digit"
            className="inp-p font-mono tracking-wider text-base placeholder:font-sans placeholder:tracking-normal placeholder:text-xs"
          />
          <button onClick={lookup} disabled={validating || !codeInput.trim()} className="btn-gold whitespace-nowrap">
            {validating ? "…" : "Look up"}
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-600 mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      {validated && (
        <div className="card-p mb-3.5 fade-up" style={{ border:"1.5px solid #e3c98f", background:"#fffdf6" }}>
          <div className="flex items-start gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0"
              style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)" }}>
              {validated.code.kind === "amenity" ? "🏨" : validated.code.kind === "coupon" ? "🎟️" : "🎁"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-luxury-900 text-[0.92rem] leading-tight">{validated.code.title || validated.code.code}</p>
              <p className="font-mono text-[0.7rem] text-luxury-600 mt-1">{validated.code.code}</p>
            </div>
            <span className={`text-[0.55rem] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
              validated.code.status === "active" ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
              : "bg-red-100 text-red-700 border border-red-300"
            }`}>{validated.code.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              { k:"Guest",   v: validated.customer?.name || "Guest" },
              { k:"Phone",   v: validated.customer?.phone || "—" },
              { k:"Kind",    v: String(validated.code.kind || "").replace("_", " ") },
              { k:"Expires", v: validated.code.expires_at ? new Date(validated.code.expires_at).toLocaleDateString("en-IN") : "—" },
            ].map((d) => (
              <div key={d.k} className="bg-luxury-50 rounded-lg px-2.5 py-1.5">
                <p className="text-[0.58rem] text-luxury-400 uppercase tracking-wider font-bold">{d.k}</p>
                <p className="text-[0.78rem] font-semibold text-luxury-900 capitalize truncate">{d.v}</p>
              </div>
            ))}
          </div>
          {validated.canFulfill ? (
            <button onClick={fulfill} disabled={validating}
              className="w-full py-2.5 rounded-xl font-extrabold text-[0.82rem] text-white transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>
              {validating ? "Marking…" : "✓ Mark Fulfilled"}
            </button>
          ) : (
            <p className="text-xs text-luxury-500 text-center py-2">This code cannot be fulfilled at the hotel.</p>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="card-p">
          <h3 className="font-bold text-luxury-900 text-[0.82rem] mb-2.5">Recently Fulfilled</h3>
          <div className="space-y-1.5">
            {recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-emerald-50 border border-emerald-100 rounded-lg">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-sm">✓</span>
                  <div className="min-w-0">
                    <p className="font-mono text-[0.7rem] font-bold text-emerald-800 truncate">{r.code.code}</p>
                    <p className="text-[0.62rem] text-emerald-700 truncate">{r.code.title || r.code.kind} · {r.customer?.name || "Guest"}</p>
                  </div>
                </div>
                <p className="text-[0.58rem] text-emerald-600 shrink-0">{new Date(r.fulfilledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-lg z-50"
          style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
