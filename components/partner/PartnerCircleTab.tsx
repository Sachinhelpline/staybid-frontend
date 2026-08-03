"use client";
// PartnerCircleTab (v288) — the hotel's "StayCircle" investments view.
// Read-only: circle properties soft-linked (circle_properties.hotel_id) to a
// hotel this partner owns, plus every active investor bundle touching them.
// Investor identity is stripped server-side (/api/partner/circle removes
// contact + user_id) — the partner sees rooms + inflow, never personal data.
import { useEffect, useState } from "react";
import { CircleDot, RotateCw, MapPin } from "lucide-react";
import { fmtINR, type PaymentPlanKey, CIRCLE_PLANS } from "@/lib/circle/engine";
import { CIRCLE_INCOME_DISCLOSURE } from "@/lib/circle/disclosure";

type RoomType = {
  id: string;
  name: string;
  monthly_rate: number;
  total_units: number;
  locked_units: number;
  active: boolean;
};

type CircleProperty = {
  id: string;
  title: string;
  city: string;
  location_label?: string | null;
  images?: string[];
  monthly_rate: number;
  roi_min_pct: number;
  roi_max_pct: number;
  status: string;
  roomTypes: RoomType[];
};

type Bundle = {
  id: string;
  items: { propertyId: string; propertyTitle: string; roomTypeName: string; rooms: number; monthlyRate: number }[];
  payment_plan: string;
  status: string;
  created_at: string;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function PartnerCircleTab() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<CircleProperty[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [kpis, setKpis] = useState<{ linked: number; investorBundles?: number; investedRooms?: number; monthlyInflow?: number } | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setLoading(true);
    setErr("");
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
    fetch("/api/partner/circle", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) { setErr(d.error); }
        setProperties(Array.isArray(d?.properties) ? d.properties : []);
        setBundles(Array.isArray(d?.bundles) ? d.bundles : []);
        setKpis(d?.kpis || null);
      })
      .catch(() => setErr("Couldn't load StayCircle data."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-luxury-100 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold text-luxury-900 inline-flex items-center gap-2"><CircleDot size={19} strokeWidth={2.2} aria-hidden />StayCircle Investments</h2>
          <p className="text-xs text-luxury-500 mt-0.5">
            Community partners investing in rooms at your property via StayCircle.
          </p>
        </div>
        <button onClick={load} className="text-xs font-semibold text-luxury-500 border border-luxury-200 px-3 py-1.5 rounded-xl hover:border-gold-300 inline-flex items-center gap-1.5">
          <RotateCw size={13} strokeWidth={2.3} aria-hidden />Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{err}</div>
      )}

      {/* KPI strip */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: "Linked properties", value: String(kpis.linked ?? 0) },
            { label: "Investor bundles", value: String(kpis.investorBundles ?? 0) },
            { label: "Rooms invested", value: String(kpis.investedRooms ?? 0) },
            { label: "Expected inflow", value: fmtINR(kpis.monthlyInflow || 0) },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-luxury-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-lg font-bold text-luxury-900" style={{ fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              <div className="text-[11px] text-luxury-500">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {kpis && (
        <p className="text-[10px] leading-snug text-luxury-400">{CIRCLE_INCOME_DISCLOSURE}</p>
      )}

      {/* Empty state — no circle property linked to this hotel yet */}
      {properties.length === 0 ? (
        <div className="rounded-2xl border border-luxury-100 bg-white p-8 text-center shadow-sm">
          <CircleDot className="mx-auto text-luxury-300" size={30} strokeWidth={1.9} aria-hidden />
          <h3 className="mt-2 font-display text-lg font-semibold text-luxury-900">Not on StayCircle yet</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-luxury-500">
            StayCircle lets community partners invest in your rooms and earn from actual
            bookings — you get expected monthly inflow per invested room, based on real
            bookings and property performance. The StayBid team curates the listings; contact
            support to get your property listed.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[10px] leading-snug text-luxury-400">
            {CIRCLE_INCOME_DISCLOSURE}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {properties.map((p) => {
            const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : "";
            return (
              <div key={p.id} className="rounded-2xl border border-luxury-100 bg-white p-4 shadow-sm">
                <div className="flex gap-3">
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-luxury-100">
                    {img && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-luxury-900">{p.title}</h3>
                      <span className="rounded-full bg-luxury-50 px-2 py-0.5 text-[10px] font-semibold text-luxury-500 inline-flex items-center gap-1">
                        <MapPin size={10} strokeWidth={2.4} aria-hidden />{p.location_label || p.city}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-luxury-100 text-luxury-500"}`}>
                        {p.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-luxury-500">
                      {fmtINR(p.monthly_rate)}/room/mo · {p.roi_min_pct}–{p.roi_max_pct}% projected ROI
                    </div>
                  </div>
                </div>

                {/* room-type inventory */}
                {p.roomTypes?.length > 0 && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {p.roomTypes.map((rt) => {
                      const free = Math.max(0, (rt.total_units || 0) - (rt.locked_units || 0));
                      return (
                        <div key={rt.id} className="rounded-xl border border-luxury-100 bg-luxury-50 px-3 py-2">
                          <div className="text-xs font-semibold text-luxury-800">{rt.name}</div>
                          <div className="mt-0.5 text-[11px] text-luxury-500" style={{ fontVariantNumeric: "tabular-nums" }}>
                            {fmtINR(rt.monthly_rate)}/mo · {rt.locked_units}/{rt.total_units} invested
                            {free === 0 && <span className="ml-1 font-bold text-amber-600">· FULL</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* investor bundles touching this partner's properties */}
      {bundles.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-display text-base font-semibold text-luxury-900">Active investor bundles</h3>
          {bundles.map((b) => {
            const planName = CIRCLE_PLANS[b.payment_plan as PaymentPlanKey]?.name || b.payment_plan;
            const rooms = b.items.reduce((s, it) => s + (Number(it.rooms) || 0), 0);
            const inflow = b.items.reduce((s, it) => s + (Number(it.monthlyRate) || 0) * (Number(it.rooms) || 0), 0);
            return (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-luxury-100 bg-white px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-luxury-800">
                    {b.items.map((it) => `${it.propertyTitle} · ${it.roomTypeName} ×${it.rooms}`).join("  +  ")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-luxury-500">
                    {planName} · since {fmtDate(b.created_at)} · {rooms} room{rooms !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-emerald-700" style={{ fontVariantNumeric: "tabular-nums" }}>+{fmtINR(inflow)}</div>
                  <div className="text-[10px] text-luxury-400">/ month to you</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
