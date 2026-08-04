"use client";

// v359 — Circle Model 2 · Your Selling Inventory (deck step 5–6). After a B2B
// purchase the buyer holds the SELLING RIGHTS to those room-nights; this surface
// shows what they own and routes them to the REAL owner controls to sell it to
// the public — set price / list / availability / OTA — via their partner "My
// Rooms" dashboard (their owned units already resolve there via owner_user_id).
// Honest by design: it links to the working owner surfaces; the automatic
// guest-payment payout is a backend (settlement) phase and is labelled as such.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Home, Link2, Tag, Globe, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { bridgeToPartnerDashboard } from "@/lib/circle/partner-bridge";

type Block = {
  id: string; hotel_id: string; hotel_name: string | null; unit_id: string | null; unit_number: string | null;
  date_from: string; date_to: string; nights: number; buy_total: number; status: string; metadata?: any;
};
type Portfolio = {
  blocks: Block[]; operatedHotels: { id: string; name: string; unitCount: number }[];
  kpis: { ownedBlocks: number; listedBlocks: number; inventoryValue: number; operatedHotelCount: number };
};

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const cap = (s: string) => String(s || "").replace(/\b\w/g, (m) => m.toUpperCase());
const inr = (n: number) => fmtINR(Math.round(n || 0));

export default function Model2SellingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState("");
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/circle/portfolio", { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => setPf(d && !d.error ? d : null))
      .catch(() => setPf(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/selling" }); return; }
    load();
  }, [user, authLoading, router, load]);

  const sellable = useMemo(() => (pf?.blocks || []).filter((b) => ["owned", "listed"].includes(String(b.status))), [pf]);
  const nights = sellable.reduce((s, b) => s + (Number(b.nights) || 0), 0);

  const copyDirect = (b: Block) => {
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/hotels/${b.hotel_id}?checkIn=${b.date_from}&checkOut=${b.date_to}`;
    try { navigator.clipboard.writeText(url); setCopied(b.id); setTimeout(() => setCopied(""), 1600); } catch { /* ignore */ }
  };

  const sellAction = async (b: Block, action: "list" | "pause") => {
    setBusy(b.id); setFlash("");
    try {
      const price = action === "list" && priceDraft[b.id] ? Number(priceDraft[b.id]) : undefined;
      const r = await fetch("/api/circle/inventory/sell", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ blockId: b.id, action, ...(price ? { price } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { setFlash(d?.error || "Couldn't update — try again."); return; }
      setFlash(action === "list"
        ? (d?.priceCapped && d?.warning ? d.warning : "Listed for public booking ✓ — guests can now book these nights.")
        : "Paused — nights held back from guests.");
      load();
    } catch { setFlash("Something went wrong."); }
    finally { setBusy(""); }
  };
  const isLive = (b: Block) => !!(b.metadata && b.metadata.publicListed);
  const unlisted = useMemo(() => sellable.filter((b) => !isLive(b)), [sellable]);

  // One-tap Option A — list EVERY owned/current room-night for public booking.
  const listAll = async () => {
    setBusy("__all__"); setFlash("");
    try {
      const r = await fetch("/api/circle/inventory/sell", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ action: "list_all" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { setFlash(d?.error || "Couldn't list — try again."); return; }
      setFlash(`Listed ${d.listed || unlisted.length} room-night set${(d.listed || unlisted.length) === 1 ? "" : "s"} for public booking ✓ — guests can now book them on StayBid.`);
      load();
    } catch { setFlash("Something went wrong."); }
    finally { setBusy(""); }
  };

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap sbc2s">
        <Link href="/circle/model2/browse" className="sbc2s-back">← Browse more inventory</Link>
        <div className="sbc-ms-eyebrow"><span className="sbc-ms-model">Model 2</span><span className="sbc-ms-tag" style={{ color: "var(--sbc-coffee)" }}>Your Selling Inventory</span></div>
        <h1 className="sbc-ms-title" style={{ color: "var(--sbc-coffee)" }}>Your inventory. Your strategy.</h1>
        <p className="sbc-ms-sub" style={{ color: "rgba(74,56,32,.75)" }}>
          The room-nights you bought are yours to sell to the public — like any property owner. Set your price and
          list them to guests on StayBid, your OTAs, or share a direct booking link. Bookings land in your owner dashboard.
        </p>

        {/* KPI strip */}
        <div className="sbc2s-kpis">
          <div className="sbc2s-kpi"><b>{nights}</b><span>ROOM-NIGHTS OWNED</span></div>
          <div className="sbc2s-kpi"><b>{sellable.length}</b><span>UNITS</span></div>
          <div className="sbc2s-kpi"><b>{inr(pf?.kpis?.inventoryValue || 0)}</b><span>INVENTORY VALUE</span></div>
          <div className="sbc2s-kpi"><b>{pf?.kpis?.operatedHotelCount || 0}</b><span>PROPERTIES</span></div>
        </div>

        {flash && <div className="sbc2s-flash">{flash}</div>}

        {/* Post-purchase nudge — one-tap Option A (list everything for booking). */}
        {!loading && unlisted.length > 0 && (
          <div className="sbc2s-nudge">
            <div>
              <b>🎉 {unlisted.length} room-night set{unlisted.length === 1 ? "" : "s"} ready to sell</b>
              <span>Your inventory is yours — open it to guests on StayBid in one tap (you can set a per-room price below, or use the default).</span>
            </div>
            <button className="sbc-btn-gold" disabled={busy === "__all__"} onClick={listAll}>
              {busy === "__all__" ? "Listing…" : "List all for booking"}
            </button>
          </div>
        )}

        {loading ? (
          <div className="sbc-panel" style={{ padding: 28, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading your inventory…</div>
        ) : sellable.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 26, textAlign: "center", color: "rgba(74,56,32,.65)" }}>
            You don’t own any released room-nights yet. <Link href="/circle/model2/browse" style={{ color: "var(--sbc-gold-deep)", fontWeight: 700 }}>Browse inventory →</Link>
          </div>
        ) : (<>
          {/* owned room-nights */}
          <div className="sbc2s-h2">Room-nights you own</div>
          {sellable.map((b) => (
            <div key={b.id} className="sbc2s-block">
              <div className="sbc2s-block-top">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sbc2s-block-title">{b.hotel_name || b.hotel_id}</div>
                  <div className="sbc2s-block-sub">{b.unit_number ? `Room #${b.unit_number} · ` : ""}{b.date_from} → {b.date_to} · {b.nights}n</div>
                </div>
                <span className={`sbc2s-status ${isLive(b) ? "live" : "held"}`}>{isLive(b) ? "● live for guests" : "held"}</span>
              </div>

              {/* list for PUBLIC booking (deck: sell to public like a hotel owner) */}
              <div className="sbc2s-sell">
                <div className="sbc2s-sell-row">
                  <input type="number" min={0} inputMode="numeric" placeholder="your ₹/night (optional)"
                    value={priceDraft[b.id] ?? ""} onChange={(e) => setPriceDraft((s) => ({ ...s, [b.id]: e.target.value }))}
                    className="sbc2s-price" />
                  {isLive(b) ? (
                    <button disabled={busy === b.id} className="sbc-btn-ghost" onClick={() => sellAction(b, "pause")}>{busy === b.id ? "…" : "Pause"}</button>
                  ) : (
                    <button disabled={busy === b.id} className="sbc-btn-gold" onClick={() => sellAction(b, "list")}>{busy === b.id ? "…" : "List for public booking"}</button>
                  )}
                </div>
                <div className="sbc2s-sell-note">{isLive(b) ? "Guests can book these nights on StayBid — bookings land in your owner dashboard." : "Open these nights to guests on StayBid (customer feed · bid · direct)."}</div>
              </div>

              {/* sell-through channels */}
              <div className="sbc2s-chan">
                <button className="sbc2s-ch" onClick={() => bridgeToPartnerDashboard(user, "myrooms")}><span style={{ display: "inline-flex" }}><Home size={18} strokeWidth={2} aria-hidden /></span><div><b>Option A · Sell on StayBid</b><small>list to guests · set your price</small></div><span className="sbc2s-ch-go">→</span></button>
                <button className="sbc2s-ch" onClick={() => copyDirect(b)}><span style={{ display: "inline-flex" }}><Link2 size={18} strokeWidth={2} aria-hidden /></span><div><b>Option B · Direct selling</b><small>{copied === b.id ? "Copied ✓" : "your own customers · copy link"}</small></div><span className="sbc2s-ch-go" style={{ display: "inline-flex" }}><Copy size={15} strokeWidth={2} aria-hidden /></span></button>
                <button className="sbc2s-ch" onClick={() => bridgeToPartnerDashboard(user, "agentauction")}><span style={{ display: "inline-flex" }}><Tag size={18} strokeWidth={2} aria-hidden /></span><div><b>Sell to travel agents</b><small>Model 3 · wholesale auction</small></div><span className="sbc2s-ch-go">→</span></button>
                <button className="sbc2s-ch" onClick={() => bridgeToPartnerDashboard(user, "channels")}><span style={{ display: "inline-flex" }}><Globe size={18} strokeWidth={2} aria-hidden /></span><div><b>Your OTA listings</b><small>Channel Manager · Airbnb / Booking</small></div><span className="sbc2s-ch-go">→</span></button>
              </div>
            </div>
          ))}

          {/* manage CTA */}
          <button onClick={() => bridgeToPartnerDashboard(user)} className="sbc-btn-gold" style={{ display: "block", width: "100%", textAlign: "center", padding: 13, marginTop: 6, border: 0, cursor: "pointer", font: "inherit" }}>
            Manage &amp; sell in your owner dashboard →
          </button>
          <p className="sbc2s-note">
            Your rooms already resolve in <b>Partner → My Rooms</b> (set price, photos, availability, OTA feeds). A guest
            booking your specific room shows in that dashboard. Automatic settlement of the guest’s payment to you is a
            billing-layer step we’re rolling out — until then payouts are reconciled like every other Circle payout.
          </p>
        </>)}

        <p className="sbc-ms-note" style={{ marginTop: 14, color: "rgba(74,56,32,.5)" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>

      <style jsx global>{`
        .sbc2s { padding-bottom: 90px; max-width: 960px; margin: 0 auto; }
        /* v711 (owner Circle rebuild) — selling page fully themed: the dark KPI
           strip + cold-grey nudge + every hardcoded color → app tokens. */
        .sbc2s-back { display: inline-block; margin-bottom: 12px; font-weight: 700; color: var(--accent); font-size: .9rem; }
        .sbc2s-kpis { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; margin: 16px 0 18px; }
        @media (min-width: 560px) { .sbc2s-kpis { grid-template-columns: repeat(4,1fr); } }
        .sbc2s-kpi { background: var(--bg-card); border: 1px solid var(--border-soft); border-radius: 13px; padding: 13px 14px; }
        .sbc2s-kpi b { display: block; color: var(--text-base); font-size: 1.1rem; font-weight: 800; }
        .sbc2s-kpi span { font-size: .63rem; letter-spacing: .06em; color: var(--text-muted); font-weight: 700; }
        .sbc2s-h2 { font-size: 1.15rem; font-weight: 800; color: var(--text-base); margin: 6px 0 10px; }
        .sbc2s-block { background: var(--bg-card); border: 1px solid var(--border-soft); border-radius: 16px; padding: 13px 15px; margin-bottom: 12px; box-shadow: 0 4px 16px rgba(31,26,15,.06); }
        .sbc2s-block-top { display: flex; align-items: center; gap: 10px; }
        .sbc2s-block-title { font-weight: 800; color: var(--text-base); font-size: .95rem; }
        .sbc2s-block-sub { font-size: .72rem; color: var(--text-muted); }
        .sbc2s-status { font-size: .64rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
        .sbc2s-status.live { color: color-mix(in srgb, #7FA968 55%, var(--text-base)); background: color-mix(in srgb, #7FA968 16%, transparent); }
        .sbc2s-status.held { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
        .sbc2s-flash { font-size: .82rem; font-weight: 600; color: color-mix(in srgb, #7FA968 55%, var(--text-base)); background: color-mix(in srgb, #7FA968 12%, transparent); border: 1px solid color-mix(in srgb, #7FA968 30%, transparent); border-radius: 12px; padding: 10px 13px; margin-bottom: 12px; }
        .sbc2s-nudge { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; background: color-mix(in srgb, var(--accent) 8%, var(--bg-card)); border: 1px solid var(--border-strong); border-radius: 14px; padding: 13px 15px; margin-bottom: 14px; }
        .sbc2s-nudge b { display: block; color: var(--text-base); font-size: .92rem; }
        .sbc2s-nudge span { display: block; font-size: .72rem; color: var(--text-soft); margin-top: 2px; max-width: 520px; line-height: 1.45; }
        .sbc2s-nudge .sbc-btn-gold { white-space: nowrap; }
        .sbc2s-sell { margin-top: 11px; padding-top: 11px; border-top: 1px dashed var(--border-soft); }
        .sbc2s-sell-row { display: flex; gap: 8px; align-items: center; }
        .sbc2s-price { flex: 1; min-width: 0; background: var(--bg-input); border: 1px solid var(--border-soft); border-radius: 10px; padding: 8px 11px; font-size: .82rem; font-family: inherit; color: var(--text-base); }
        .sbc2s-sell-note { font-size: .66rem; color: var(--text-muted); margin-top: 6px; }
        .sbc2s-chan { display: grid; gap: 7px; margin-top: 11px; }
        @media (min-width: 640px) { .sbc2s-chan { grid-template-columns: repeat(3, 1fr); } }
        .sbc2s-ch { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; background: var(--bg-pill); border: 1px solid var(--border-soft); border-radius: 11px; padding: 9px 12px; cursor: pointer; font-family: inherit; }
        .sbc2s-ch > span:first-child { font-size: 1.1rem; }
        .sbc2s-ch b { display: block; color: var(--text-base); font-size: .8rem; }
        .sbc2s-ch small { color: var(--text-muted); font-size: .66rem; }
        .sbc2s-ch div { flex: 1; min-width: 0; }
        .sbc2s-ch-go { color: var(--accent); font-weight: 800; }
        .sbc2s-note { font-size: .7rem; color: var(--text-soft); margin: 12px 0 0; line-height: 1.55; background: var(--bg-pill); border: 1px solid var(--border-soft); border-radius: 12px; padding: 11px 13px; }
      `}</style>
    </div>
  );
}
