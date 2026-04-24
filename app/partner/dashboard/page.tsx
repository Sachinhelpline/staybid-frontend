"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { calculateDynamicPrice, getRoomImage, DEMAND_STYLE, type DemandLevel } from "@/lib/ai-pricing";

const today     = new Date().toISOString().split("T")[0];
const tomorrow  = new Date(Date.now() + 86400000).toISOString().split("T")[0];

// ── helpers ────────────────────────────────────────────────────────────────
function getToken() { return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : ""; }
function getPartnerUser() {
  try { return JSON.parse(localStorage.getItem("sb_partner_user") || "null"); } catch { return null; }
}
function fmtCur(n: number) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
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

// ── main component ─────────────────────────────────────────────────────────
export default function PartnerDashboard() {
  const router = useRouter();
  const [pUser, setPUser]         = useState<any>(null);
  const [hotel, setHotel]         = useState<any>(null);
  const [rooms, setRooms]         = useState<any[]>([]);
  const [bids, setBids]           = useState<any[]>([]);
  const [bookings, setBookings]   = useState<any[]>([]);
  const [flashDeals, setFlashDeals] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState<"overview"|"bids"|"rooms"|"flash"|"bookings"|"availability"|"profile">("overview");

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
  const [walkInOpen, setWalkInOpen]   = useState<{ roomId: string; date: string } | null>(null);
  const [walkIn, setWalkIn]           = useState({ fromDate:"", toDate:"", guestName:"", guestPhone:"", amount:"", note:"", assignedUnitId:"", assignedUnitNumber:"" });
  const [walkInSaving, setWalkInSaving] = useState(false);
  const [newFeed, setNewFeed]         = useState({ roomId:"", provider:"booking", icalUrl:"", label:"" });
  const [feedSaving, setFeedSaving]   = useState(false);
  const [syncing, setSyncing]         = useState<string>("");

  // Bid action
  const [selectedBid, setSelectedBid]   = useState<any>(null);
  const [bidFilter, setBidFilter]       = useState<"PENDING"|"COUNTER"|"ACCEPTED"|"REJECTED"|"ALL">("PENDING");
  const [bidAction, setBidAction]       = useState<"accept"|"counter"|"reject">("accept");
  const [counterAmt, setCounterAmt]     = useState("");
  const [bidMessage, setBidMessage]     = useState("");
  const [bidActLoading, setBidActLoading] = useState(false);
  const [bidActDone, setBidActDone]     = useState(false);

  // Room pricing
  const [editPrices, setEditPrices]   = useState<Record<string, { floor?: string; flash?: string }>>({});
  const [savingRoom, setSavingRoom]   = useState("");
  const [savedRoom, setSavedRoom]     = useState("");
  const [aiPrices, setAiPrices]       = useState<Record<string, any>>({});

  // Flash deal creation
  const [newDeal, setNewDeal]         = useState({ roomId:"", dealPrice:"", discount:"", durationHours:"24", maxRooms:"1" });
  const [dealLoading, setDealLoading] = useState(false);
  const [dealMsg, setDealMsg]         = useState("");

  // Hotel profile edit
  const [editHotel, setEditHotel]     = useState<any>({});
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg]   = useState("");

  // ── Auth guard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    const user  = getPartnerUser();
    if (!token || !user) { router.replace("/partner"); return; }
    setPUser(user);
    loadAll(token, user);
  }, []);

  // ── Live auto-refresh every 20s (silent, no spinner) ───────────────────
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const t = setInterval(() => { refreshLive(token); }, 20_000);
    return () => clearInterval(t);
  }, []);

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

  async function loadAll(token: string, user: any) {
    setLoading(true);
    try {
      const [hotelRes, bidsRes, flashRes] = await Promise.all([
        fetch("/api/partner/hotel",        { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/partner/bids",         { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/partner/flash-deals",  { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [hotelData, bidsData, flashData] = await Promise.all([
        hotelRes.json(), bidsRes.json(), flashRes.json(),
      ]);
      if (hotelData.hotel)  { setHotel(hotelData.hotel); setRooms(hotelData.hotel.rooms || []); setEditHotel(hotelData.hotel); }
      if (hotelData.bookings) setBookings(hotelData.bookings);
      if (bidsData.bids)    setBids(bidsData.bids);
      if (flashData.deals)  setFlashDeals(flashData.deals);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function refreshLive(token: string) {
    try {
      const [hotelRes, bidsRes, flashRes] = await Promise.all([
        fetch("/api/partner/hotel",       { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/partner/bids",        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch("/api/partner/flash-deals", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const [hotelData, bidsData, flashData] = await Promise.all([hotelRes.json(), bidsRes.json(), flashRes.json()]);
      if (hotelData?.hotel)   { setHotel(hotelData.hotel); setRooms(hotelData.hotel.rooms || []); }
      if (hotelData?.bookings) setBookings(hotelData.bookings);
      if (bidsData?.bids)      setBids(bidsData.bids);
      if (flashData?.deals)    setFlashDeals(flashData.deals);
    } catch { /* silent */ }
  }

  function logout() {
    localStorage.removeItem("sb_partner_token");
    localStorage.removeItem("sb_partner_user");
    router.replace("/partner");
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
        body: JSON.stringify({ action: bidAction, counterAmount: counterAmt, message: bidMessage }),
      });
      if (!res.ok) throw new Error("Action failed");
      setBidActDone(true);
      // Refresh bids
      const bRes = await fetch("/api/partner/bids", { headers: { Authorization: `Bearer ${token}` } });
      const bd = await bRes.json();
      if (bd.bids) setBids(bd.bids);
      setTimeout(() => { setSelectedBid(null); setBidActDone(false); setBidMessage(""); setCounterAmt(""); setBidAction("accept"); }, 1500);
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
      loadOtaFeeds();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, hotel?.id, calMonth]);

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
    if (!confirm("Remove this booking/block?")) return;
    const token = getToken();
    try {
      await fetch(`/api/partner/walk-in?id=${refId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      loadCalendar();
    } catch {}
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
  const pendingBids   = bids.filter(b => b.status === "PENDING").length;
  const counteredBids = bids.filter(b => b.status === "COUNTER").length;
  const acceptedBids  = bids.filter(b => b.status === "ACCEPTED").length;
  const revenue       = bids.filter(b => b.status === "ACCEPTED").reduce((s, b) => s + (b.amount || 0), 0);
  const activeDeals   = flashDeals.filter(d => d.isActive !== false && daysUntil(d.validUntil || "") >= 0);
  const filteredBids  = bidFilter === "ALL" ? bids : bids.filter(b => b.status === bidFilter);

  const TABS = [
    { id:"overview",  icon:"📊", label:"Overview"   },
    { id:"bids",      icon:"📩", label:`Bids ${pendingBids > 0 ? `(${pendingBids})` : ""}` },
    { id:"rooms",     icon:"🏨", label:"Rooms"      },
    { id:"flash",     icon:"⚡", label:"Flash Deals"},
    { id:"bookings",  icon:"📅", label:"Bookings"   },
    { id:"availability", icon:"🗓️", label:"Availability" },
    { id:"profile",   icon:"⚙️", label:"Profile"    },
  ] as const;

  return (
    <div className="min-h-screen bg-luxury-50">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family:'Cormorant Garamond',serif; }
        body { font-family:'Inter',sans-serif; }
        .card-p { background:#fff; border-radius:20px; border:1px solid #f0ebe1; box-shadow:0 2px 12px rgba(160,130,80,0.06); padding:20px; }
        .inp-p { border:1px solid #e8e0d0; border-radius:10px; padding:10px 14px; font-size:0.85rem; width:100%; outline:none; transition:all 0.2s; color:#3d2c14; }
        .inp-p:focus { border-color:#c9911a; box-shadow:0 0 0 3px rgba(201,145,26,0.12); }
        .btn-gold { background:linear-gradient(135deg,#c9911a,#f0b429); color:#fff; border:none; border-radius:10px; padding:10px 20px; font-weight:700; cursor:pointer; font-size:0.85rem; transition:all 0.2s; }
        .btn-gold:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(201,145,26,0.35); }
        .btn-gold:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation:fadeUp 0.3s ease-out both; }
      `}</style>

      {/* ── Partner Navbar ─────────────────────────────────────────────── */}
      <nav className="bg-luxury-900 border-b border-luxury-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-5 flex items-center justify-between" style={{height:"60px"}}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-sm"
              style={{background:"linear-gradient(135deg,#c9911a,#f0b429)"}}>S</div>
            <div>
              <span className="font-display text-lg text-white tracking-wide">StayBid</span>
              <span className="ml-2 text-[0.6rem] font-bold text-amber-400/70 tracking-[0.15em] uppercase">Partner</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hotel && (
              <span className="hidden sm:block text-sm font-semibold text-white/70 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                🏨 {hotel.name}
              </span>
            )}
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{background:"linear-gradient(135deg,#c9911a,#f0b429)"}}>
              {(pUser?.name || pUser?.phone || "P").slice(0,2).toUpperCase()}
            </div>
            <button onClick={logout}
              className="text-xs text-white/50 hover:text-red-400 border border-white/10 hover:border-red-400/30 px-3 py-1.5 rounded-lg transition-all">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-luxury-200 sticky top-[60px] z-30 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-5 flex gap-1 py-2">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                tab === t.id
                  ? "bg-gold-500/10 text-gold-600 border border-gold-400/30"
                  : "text-luxury-500 hover:text-luxury-800 hover:bg-luxury-50"
              }`}>
              <span>{t.icon}</span>{t.label}
              {t.id === "bids" && pendingBids > 0 && tab !== "bids" && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-6">

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
            <h2 className="font-display text-2xl font-light text-luxury-900">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {pUser?.name?.split(" ")[0] || "Partner"} 👋</h2>

            {/* ── Quick Walk-in / PMS Control ── */}
            <div className="rounded-3xl overflow-hidden bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 shadow-xl border border-white/20 relative">
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, white 0%, transparent 50%), radial-gradient(circle at 80% 80%, white 0%, transparent 50%)" }} />
              <div className="relative p-5 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[0.65rem] font-bold text-white/80 uppercase tracking-[0.25em]">🏨 Front Desk</p>
                  <h3 className="font-display text-2xl text-white font-light mt-1">Walk-in Guest Arrived?</h3>
                  <p className="text-white/80 text-sm mt-1">Check room availability & check them in — auto-blocks the room across StayBid, Booking.com, Airbnb everywhere.</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setQuickWalkInOpen(true)}
                    className="bg-white text-indigo-700 font-bold px-5 py-3 rounded-xl hover:scale-105 transition-all shadow-lg text-sm">
                    ➕ New Walk-in
                  </button>
                  <button onClick={() => setTab("availability")}
                    className="bg-white/20 text-white border border-white/30 font-bold px-5 py-3 rounded-xl hover:bg-white/30 transition-all text-sm backdrop-blur">
                    🗓️ Availability
                  </button>
                </div>
              </div>
            </div>

            {/* ── Today's Bookings — Airbnb-style hero panel ── */}
            <div className="rounded-3xl overflow-hidden shadow-lg border border-luxury-200 bg-white">
              <div className="bg-gradient-to-r from-luxury-900 via-luxury-800 to-luxury-900 px-5 py-4 flex items-center justify-between flex-wrap gap-2">
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label:"Pending Bids",  value: pendingBids,  icon:"📩", color:"text-amber-600",   bg:"bg-amber-50",   border:"border-amber-200",   action: () => setTab("bids") },
                { label:"Countered",     value: counteredBids, icon:"💬", color:"text-orange-600",  bg:"bg-orange-50",  border:"border-orange-200",  action: () => setTab("bids") },
                { label:"Confirmed",     value: acceptedBids, icon:"✅", color:"text-emerald-600", bg:"bg-emerald-50", border:"border-emerald-200", action: () => setTab("bookings") },
                { label:"Est. Revenue",  value: fmtCur(revenue), icon:"💰", color:"text-gold-600", bg:"bg-gold-50",    border:"border-gold-200",    action: () => setTab("bookings") },
              ].map(s => (
                <button key={s.label} onClick={s.action}
                  className={`card-p text-left hover:scale-[1.02] transition-transform cursor-pointer ${s.bg} border ${s.border}`}>
                  <p className="text-2xl mb-1">{s.icon}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-luxury-500 font-medium mt-0.5">{s.label}</p>
                </button>
              ))}
            </div>

            {/* Active flash deals strip */}
            {activeDeals.length > 0 && (
              <div className="card-p bg-gradient-to-r from-amber-50 to-gold-50 border border-gold-200">
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
                        <div className="w-9 h-9 rounded-full bg-gold-100 flex items-center justify-center text-sm font-bold text-gold-700 flex-shrink-0">
                          {(b.guestName || b.customerId || "G").slice(0,2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-luxury-900 truncate">{b.room?.type || b.roomId || "Room"}</p>
                          <p className="text-xs text-luxury-400">{fmtDate(b.checkIn || b.createdAt)}</p>
                        </div>
                        <p className="font-bold text-luxury-900 flex-shrink-0">{fmtCur(b.amount)}<span className="text-xs text-luxury-400 font-normal">/night</span></p>
                        <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                        {b.status === "PENDING" && (
                          <button onClick={() => { setSelectedBid(b); setBidAction("accept"); setCounterAmt(String(b.amount||"")); setBidMessage(""); }}
                            className="flex-shrink-0 btn-gold text-xs px-3 py-1.5">Respond</button>
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
              <h2 className="font-display text-2xl font-light text-luxury-900">Bid Inbox</h2>
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
                      <span className="ml-1 text-[0.6rem]">({bids.filter(b=>b.status===f).length})</span>
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
                  return (
                    <div key={b.id} className="card-p">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gold-100 flex items-center justify-center text-sm font-bold text-gold-700 flex-shrink-0">
                            {(b.guestName || b.customerId || "G").slice(0,2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-luxury-900">{b.guestName || `Guest …${String(b.customerId||"").slice(-4)}`}</p>
                            <p className="text-xs text-luxury-400">{b.room?.type || "Room"} · {b.guests || 2} guests · {nights} night{nights>1?"s":""}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-luxury-900 text-lg">{fmtCur(b.amount)}<span className="text-xs text-luxury-400 font-normal">/night</span></p>
                          {nights > 1 && <p className="text-xs text-emerald-600 font-semibold">{fmtCur(b.amount*nights)} total</p>}
                          <span className={`inline-block mt-1 text-xs font-bold px-2.5 py-0.5 rounded-full border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
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
                          onClick={() => { setSelectedBid(b); setBidAction("accept"); setCounterAmt(String(b.amount||"")); setBidMessage(""); }}
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
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-2xl font-light text-luxury-900">Rooms & Pricing</h2>
              <div className="flex items-center gap-1.5 text-[0.6rem] text-luxury-400 font-bold uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />AI Live Engine
              </div>
            </div>

            {rooms.length === 0 ? (
              <div className="card-p text-center py-10 text-luxury-400">No rooms found.</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-5">
                {rooms.map(r => {
                  const ai   = aiPrices[r.id];
                  const demandKey = (ai?.demandLevel ?? "") as DemandLevel;
                  const ds   = ai && demandKey in DEMAND_STYLE ? DEMAND_STYLE[demandKey] : null;
                  const img  = getRoomImage(r.name || r.type || "", r.images);
                  const ep   = editPrices[r.id] || {};
                  return (
                    <div key={r.id} className="card-p overflow-hidden !p-0">
                      {/* Room image */}
                      <div className="relative h-40 overflow-hidden">
                        <img src={img} alt={r.name||r.type} className="w-full h-full object-cover"
                          onError={(e: any) => { e.target.src="https://images.unsplash.com/photo-1631049421450-348ccd7f8949?w=800&q=80"; }} />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
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
                          className={`btn-gold w-full py-2.5 text-sm ${savedRoom === r.id ? "!bg-emerald-500" : ""}`}>
                          {savingRoom === r.id ? "Saving…" : savedRoom === r.id ? "✓ Saved!" : "Save Pricing"}
                        </button>

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
            <h2 className="font-display text-2xl font-light text-luxury-900">Flash Deals</h2>

            {/* Create deal */}
            <div className="card-p border-2 border-gold-200 bg-gradient-to-br from-gold-50/30 to-white">
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
            <h2 className="font-display text-2xl font-light text-luxury-900 mb-5">Confirmed Bookings</h2>
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
                  const total = (b.counterAmount || b.amount || 0) * nights;
                  return (
                    <button key={b.id} onClick={() => setSelectedBooking(b)}
                      className="card-p flex items-start justify-between gap-4 w-full text-left hover:shadow-lg hover:border-gold-300 transition-all cursor-pointer">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-base flex-shrink-0">🎫</div>
                        <div className="min-w-0">
                          <p className="font-semibold text-luxury-900 truncate">{b.guestName || b.user?.name || "Guest"} · {b.room?.type || b.roomId || "Room"}</p>
                          <p className="text-xs text-luxury-500">
                            {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} · {nights} night{nights>1?"s":""}
                          </p>
                          <p className="text-xs text-luxury-400">{b.guests || 2} guests · Booked {fmtDate(b.createdAt)}</p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-luxury-900 text-base">{fmtCur(total)}</p>
                        <p className="text-xs text-luxury-400">{fmtCur(b.counterAmount || b.amount)}/night</p>
                        <span className="inline-block mt-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Confirmed ›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══════════════ AVAILABILITY / PMS ══════════════ */}
        {tab === "availability" && (
          <div className="fade-up space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-display text-2xl font-light text-luxury-900">Availability Calendar</h2>
                <p className="text-sm text-luxury-500">Real-time occupancy across all bookings, walk-ins & OTA channels</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth()-1, 1))}
                  className="px-3 py-2 rounded-lg border border-luxury-200 text-luxury-600 hover:bg-luxury-100 text-sm">← Prev</button>
                <span className="text-sm font-bold text-luxury-800 px-3">
                  {calMonth.toLocaleDateString("en-IN", { month:"long", year:"numeric" })}
                </span>
                <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 1))}
                  className="px-3 py-2 rounded-lg border border-luxury-200 text-luxury-600 hover:bg-luxury-100 text-sm">Next →</button>
                <button onClick={loadCalendar}
                  className="px-3 py-2 rounded-lg bg-luxury-900 text-white text-sm hover:bg-luxury-800">
                  {calLoading ? "⟳" : "↻ Refresh"}
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 text-xs">
              {[
                { c:"#dcfce7", b:"#16a34a", l:"Free" },
                { c:"#fef3c7", b:"#d97706", l:"Bid booked" },
                { c:"#dbeafe", b:"#2563eb", l:"OTA (Booking/Airbnb)" },
                { c:"#f3e8ff", b:"#9333ea", l:"Walk-in" },
                { c:"#fee2e2", b:"#dc2626", l:"Blocked" },
              ].map(x => (
                <div key={x.l} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background:x.c, border:`1.5px solid ${x.b}` }} />
                  <span className="text-luxury-600 font-medium">{x.l}</span>
                </div>
              ))}
            </div>

            {/* Calendar grid — one row per room */}
            {rooms.length === 0 ? (
              <div className="card-p text-center py-10 text-luxury-400">
                No rooms configured yet. Add rooms in the <b>Rooms</b> tab first.
              </div>
            ) : (
              <div className="card-p overflow-x-auto">
                {(() => {
                  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth()+1, 0).getDate();
                  const days = Array.from({ length: daysInMonth }, (_, i) => {
                    const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), i+1);
                    return d.toISOString().slice(0,10);
                  });
                  return (
                    <table className="w-full text-xs border-collapse" style={{ minWidth: 820 }}>
                      <thead>
                        <tr>
                          <th className="sticky left-0 bg-white text-left font-bold text-luxury-700 pr-3 pb-2" style={{ minWidth: 140 }}>Room</th>
                          {days.map(d => {
                            const day = new Date(d).getDate();
                            const dow = new Date(d).getDay();
                            const isWE = dow === 0 || dow === 6;
                            return (
                              <th key={d} className={`font-semibold pb-2 text-[0.65rem] ${isWE ? "text-red-500" : "text-luxury-500"}`} style={{ minWidth: 22 }}>{day}</th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rooms.map(r => (
                          <tr key={r.id} className="border-t border-luxury-100">
                            <td className="sticky left-0 bg-white pr-3 py-1.5 font-semibold text-luxury-800 truncate" style={{ maxWidth: 140 }}>
                              {r.type || "Room"}
                            </td>
                            {days.map(d => {
                              const occ = calendar[r.id]?.[d];
                              let bg = "#dcfce7", border = "#bbf7d0";
                              if (occ) {
                                if (occ.source === "bid")      { bg="#fef3c7"; border="#fcd34d"; }
                                else if (occ.source === "ota_ical") { bg="#dbeafe"; border="#93c5fd"; }
                                else if (occ.source === "walk_in")  { bg="#f3e8ff"; border="#c4b5fd"; }
                                else                                 { bg="#fee2e2"; border="#fca5a5"; }
                              }
                              const tooltip = occ
                                ? `${occ.source}${occ.guestName ? " — " + occ.guestName : ""}${occ.amount ? " (₹" + occ.amount + ")" : ""}`
                                : "Tap to add walk-in";
                              return (
                                <td key={d} className="p-0.5">
                                  <button
                                    title={tooltip}
                                    onClick={() => {
                                      if (occ?.refId && (occ.source === "walk_in" || occ.source === "manual")) {
                                        deleteBlock(occ.refId);
                                      } else if (!occ) {
                                        const next = new Date(d); next.setDate(next.getDate()+1);
                                        setWalkInOpen({ roomId: r.id, date: d });
                                        setWalkIn({ fromDate: d, toDate: next.toISOString().slice(0,10), guestName:"", guestPhone:"", amount:"", note:"", assignedUnitId:"", assignedUnitNumber:"" });
                                      }
                                    }}
                                    className="w-full h-6 rounded hover:ring-2 hover:ring-gold-400 transition-all cursor-pointer"
                                    style={{ background: bg, border: `1px solid ${border}` }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}

            {/* OTA Feeds manager */}
            <div className="card-p">
              <h3 className="font-display text-xl text-luxury-900 mb-1">🌐 OTA Channel Sync</h3>
              <p className="text-sm text-luxury-500 mb-4">
                Paste iCal URLs from Booking.com, Airbnb, MakeMyTrip, Goibibo or Agoda. Their bookings will automatically block your availability.
              </p>

              {/* Existing feeds */}
              <div className="space-y-2 mb-4">
                {otaFeeds.length === 0 ? (
                  <div className="text-sm text-luxury-400 italic py-2">No feeds added yet.</div>
                ) : otaFeeds.map(f => {
                  const room = rooms.find(r => r.id === f.roomId);
                  return (
                    <div key={f.id} className="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-luxury-50 border border-luxury-200">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase">{f.provider}</span>
                          <span className="font-semibold text-luxury-800 text-sm">{f.label || f.provider}</span>
                          <span className="text-xs text-luxury-400">· {room?.type || f.roomId}</span>
                        </div>
                        <div className="text-xs text-luxury-500 truncate mt-1" style={{ maxWidth: 420 }}>{f.icalUrl}</div>
                        <div className="text-[0.65rem] text-luxury-400 mt-0.5">
                          {f.lastSyncAt
                            ? `Last sync: ${new Date(f.lastSyncAt).toLocaleString("en-IN")} · ${f.lastSyncStatus || ""} · ${f.lastEventCount || 0} events`
                            : "Never synced"}
                          {f.lastSyncError && <span className="text-red-500 ml-2">({f.lastSyncError})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => syncFeed(f.id)} disabled={syncing === f.id}
                          className="btn-gold text-xs px-3 py-1.5">
                          {syncing === f.id ? "Syncing…" : "↻ Sync Now"}
                        </button>
                        <button onClick={() => deleteFeed(f.id)}
                          className="text-red-500 hover:bg-red-50 px-2 py-1.5 rounded text-sm">🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add new feed */}
              <div className="pt-4 border-t border-luxury-100 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
                <div>
                  <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Room</label>
                  <select className="inp-p" value={newFeed.roomId} onChange={e=>setNewFeed(p=>({...p, roomId:e.target.value}))}>
                    <option value="">Select room…</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.type}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">Provider</label>
                  <select className="inp-p" value={newFeed.provider} onChange={e=>setNewFeed(p=>({...p, provider:e.target.value}))}>
                    <option value="booking">Booking.com</option>
                    <option value="airbnb">Airbnb</option>
                    <option value="mmt">MakeMyTrip</option>
                    <option value="goibibo">Goibibo</option>
                    <option value="agoda">Agoda</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[0.6rem] font-bold text-luxury-400 uppercase block mb-1">iCal URL</label>
                  <input className="inp-p" placeholder="https://..." value={newFeed.icalUrl}
                    onChange={e=>setNewFeed(p=>({...p, icalUrl:e.target.value}))} />
                </div>
                <button onClick={addFeed} disabled={feedSaving} className="btn-gold text-xs py-2.5">
                  {feedSaving ? "Adding…" : "+ Add Feed"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ WALK-IN MODAL ══════════════ */}
        {walkInOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setWalkInOpen(null)}>
            <div className="bg-white rounded-3xl max-w-md w-full mx-4 overflow-hidden" onClick={e=>e.stopPropagation()}>
              <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[0.65rem] font-bold text-white/70 uppercase tracking-widest">Walk-in Booking</p>
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
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto"
              onClick={() => { setQuickWalkInOpen(false); setWalkInOpen(null); }}>
              <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden my-0 sm:my-8"
                onClick={e => e.stopPropagation()}>
                <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-[0.65rem] font-bold text-white/70 uppercase tracking-widest">🏨 Front Desk</p>
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
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-sm hover:shadow-xl transition-all disabled:opacity-40">
                    {walkInSaving ? "Saving…" : walkIn.assignedUnitNumber ? `✓ Check-in · Room #${walkIn.assignedUnitNumber}` : "✓ Confirm Walk-in (auto-assign)"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ══════════════ PROFILE ══════════════ */}
        {tab === "profile" && (
          <div className="fade-up max-w-xl">
            <h2 className="font-display text-2xl font-light text-luxury-900 mb-5">Hotel Profile</h2>
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
      {selectedBid && !bidActDone && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedBid(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="bg-luxury-900 px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white/50 uppercase tracking-widest">Respond to Bid</p>
                <p className="text-white font-semibold text-lg">{selectedBid.room?.type || "Room"}</p>
                <p className="text-white/50 text-sm">{fmtCur(selectedBid.amount)}/night · {selectedBid.guests || 2} guests</p>
              </div>
              <button onClick={() => setSelectedBid(null)} className="text-white/50 hover:text-white text-2xl">✕</button>
            </div>

            <div className="p-6 space-y-4">
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

              {bidAction === "counter" && (
                <div>
                  <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">Your Counter Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-400 font-medium">₹</span>
                    <input type="number" value={counterAmt} onChange={e=>setCounterAmt(e.target.value)}
                      placeholder={String(selectedBid.amount||"")} className="inp-p pl-7" autoFocus />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[0.65rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1.5">
                  Message to Guest <span className="text-luxury-300 normal-case">(optional)</span>
                </label>
                <textarea rows={2} value={bidMessage} onChange={e=>setBidMessage(e.target.value)}
                  placeholder={
                    bidAction==="accept"  ? "Welcome! Looking forward to hosting you…" :
                    bidAction==="counter" ? "Thank you for your interest. Here's our best offer…" :
                    "We regret we can't accommodate your request at this time…"
                  }
                  className="inp-p resize-none" />
              </div>

              <button onClick={submitBidAction} disabled={bidActLoading || (bidAction==="counter" && !counterAmt)}
                className="btn-gold w-full py-3 text-sm">
                {bidActLoading ? "Sending…" :
                  bidAction==="accept"  ? `✅ Accept at ${fmtCur(selectedBid.amount)}/night` :
                  bidAction==="counter" ? `💬 Send Counter: ${counterAmt ? fmtCur(Number(counterAmt)) : "—"}/night` :
                  "❌ Decline Bid"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bidActDone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
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
        const total = pricePerNight * nights;
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
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto"
            onClick={() => setSelectedBooking(null)}>
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden my-0 sm:my-8"
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="relative bg-gradient-to-br from-luxury-900 via-luxury-800 to-black px-6 py-5">
                <button onClick={() => setSelectedBooking(null)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg">✕</button>
                <p className="text-[0.6rem] font-bold text-gold-400 uppercase tracking-[0.25em]">Booking Details</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold">{guestInitials}</div>
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
                    <a href={`tel:${b.guestPhone || b.user?.phone}`} className="flex items-center justify-between text-sm hover:bg-luxury-50 -mx-2 px-2 py-1 rounded">
                      <span className="text-luxury-600">📱 Phone</span>
                      <span className="font-bold text-luxury-900">{b.guestPhone || b.user?.phone}</span>
                    </a>
                  )}
                  {(b.guestEmail || b.user?.email) && (
                    <a href={`mailto:${b.guestEmail || b.user?.email}`} className="flex items-center justify-between text-sm hover:bg-luxury-50 -mx-2 px-2 py-1 rounded">
                      <span className="text-luxury-600">✉️ Email</span>
                      <span className="font-semibold text-luxury-900 truncate">{b.guestEmail || b.user?.email}</span>
                    </a>
                  )}
                  {!(b.guestPhone || b.user?.phone) && !(b.guestEmail || b.user?.email) && (
                    <p className="text-xs text-luxury-400 italic">No contact info on file</p>
                  )}
                </div>

                {/* Payment */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-gold-50 to-amber-50 border border-gold-200">
                  <p className="text-[0.6rem] font-bold text-gold-700 uppercase tracking-widest mb-2">💰 Payment</p>
                  <div className="flex justify-between text-sm py-1">
                    <span className="text-luxury-600">Rate per night</span>
                    <span className="font-semibold text-luxury-900">{fmtCur(pricePerNight)}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1">
                    <span className="text-luxury-600">× {nights} night{nights>1?"s":""}</span>
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
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
