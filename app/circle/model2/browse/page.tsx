"use client";

// v357 — Circle Model 2 · Step 1 BROWSE. Released inventory grouped BY PROPERTY,
// like Model 1's discover. Tapping a property opens its full tour PAGE
// (/circle/model2/[hotelId]). No internal pricing rule is shown to the buyer —
// just "from ₹X/night" and the property. The bundle lives in localStorage; the
// bottom step-dock (Browse → Tour → Pay) + the basket bar read it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth-intent";
import { fmtINR } from "@/lib/circle/engine";
import { CIRCLE_B2B_RESALE_NOTE } from "@/lib/circle/disclosure";
import { basketList as readBasketList, onBasketChange } from "@/lib/circle/model2-basket";

type Meta = { title?: string; city?: string; star?: number; prop_images?: string[]; room_images?: string[]; description?: string };
type Listing = { id: string; hotel_id: string; hotel_name: string | null; hotel_city: string; ask_per_night: number; metadata?: Meta | null };
type Property = { key: string; title: string; city: string; star: number; image: string; rooms: Listing[] };

const token = () => (typeof window !== "undefined" ? localStorage.getItem("sb_token") || "" : "");
const norm = (c: any) => String(c || "").trim().toLowerCase();
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const perN = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const inr = (n: number) => fmtINR(Math.round(n || 0));
const ALL = "__all__";

function fc(l: Listing) {
  const md = l.metadata || {};
  return {
    title: l.hotel_name || md.title || "Property",
    city: l.hotel_city || md.city || "",
    star: Number(md.star) || 0,
    image: (md.prop_images || [])[0] || (md.room_images || [])[0] || "",
    buyN: Number(l.ask_per_night) || 0,
  };
}

export default function Model2BrowsePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [all, setAll] = useState<Listing[]>([]);
  const [city, setCity] = useState<string>(ALL);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [accessPrice, setAccessPrice] = useState(999);
  const [loading, setLoading] = useState(true);
  const [bCount, setBCount] = useState(0);
  const [bTotal, setBTotal] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/b2b/marketplace`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((r) => r.json()).then((d) => setAll(Array.isArray(d?.listings) ? d.listings : []))
      .catch(() => setAll([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { redirectToSignIn(router, { route: "/circle/model2/browse" }); return; }
    fetch("/api/circle/city-access", { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json()).then((d) => { if (Array.isArray(d?.cities)) setUnlocked(d.cities.map(norm)); if (d?.price) setAccessPrice(Number(d.price) || 999); }).catch(() => {});
    load();
  }, [user, authLoading, router, load]);

  useEffect(() => {
    const refresh = () => { const l = readBasketList(); setBCount(l.length); setBTotal(l.reduce((s, x) => s + (x.buyerPays || 0), 0)); };
    refresh();
    return onBasketChange(refresh);
  }, []);

  const properties = useMemo<Property[]>(() => {
    const rows = city === ALL ? all : all.filter((l) => norm(fc(l).city) === norm(city));
    const by: Record<string, Property> = {};
    rows.forEach((l) => {
      const f = fc(l);
      const key = l.hotel_id || f.title;
      if (!by[key]) by[key] = { key, title: f.title, city: f.city, star: f.star, image: f.image, rooms: [] };
      by[key].rooms.push(l);
    });
    return Object.values(by).sort((a, b) => a.title.localeCompare(b.title));
  }, [all, city]);

  const supplyCities = useMemo(() => Array.from(new Set(all.map((l) => norm(fc(l).city)).filter(Boolean))).sort(), [all]);
  const isUnlocked = (c: string) => unlocked.includes(norm(c));

  return (
    <div className="sbc-home">
      <div className="sbc-ms-wrap sbc2b">
        <Link href="/circle" className="sbc-ms-back" style={{ color: "var(--sbc-gold-deep)" }}>← StayCircle</Link>
        <div className="sbc-ms-eyebrow"><span className="sbc-ms-model">Model 2</span><span className="sbc-ms-tag" style={{ color: "var(--sbc-coffee)" }}>Multi-City Inventory Bundle</span></div>
        <h1 className="sbc-ms-title" style={{ color: "var(--sbc-coffee)" }}>Browse released inventory</h1>
        <p className="sbc-ms-sub" style={{ color: "rgba(74,56,32,.75)" }}>
          Tour any property, open a room’s <b>live availability calendar</b>, and pick the nights you want.
          Check each room against its real <b>market rate</b> — like a stock — and see your resale upside before you buy.
        </p>

        <div className="sbc2b-steps">
          {[
            { n: "1", t: "Browse", d: "Properties, all cities" },
            { n: "2", t: "Tour", d: "Calendar + market price" },
            { n: "3", t: "Build", d: "Pick nights, add" },
            { n: "4", t: "Pay", d: "Review + one payment" },
          ].map((s) => (<div key={s.n} className="sbc2b-step"><span className="sbc2b-step-n">{s.n}</span><div><div className="sbc2b-step-t">{s.t}</div><div className="sbc2b-step-d">{s.d}</div></div></div>))}
        </div>
        <div className="sbc2b-kpis">
          <span className="sbc2b-kpi">🔓 Full inventory — no pre-unlock</span>
          <span className="sbc2b-kpi">🗝️ ₹{accessPrice}/city · one-time</span>
          <span className="sbc2b-kpi sbc2b-kpi-gold">📈 See market rate before you buy</span>
        </div>

        <div className="sbc2b-chips">
          <button onClick={() => setCity(ALL)} className={`sbc2b-chip${city === ALL ? " on" : ""}`}>All Cities <span className="sbc2b-chip-ct">{new Set(all.map((l) => norm(fc(l).city))).size}</span></button>
          {supplyCities.map((c) => {
            const ct = new Set(all.filter((l) => norm(fc(l).city) === c).map((l) => l.hotel_id)).size;
            return <button key={c} onClick={() => setCity(c)} className={`sbc2b-chip${norm(city) === c ? " on" : ""}`}>{cap(c)}{isUnlocked(c) ? " 🔓" : ""} <span className="sbc2b-chip-ct">{ct}</span></button>;
          })}
        </div>

        {loading ? (
          <div className="sbc-panel" style={{ padding: 28, textAlign: "center", color: "rgba(74,56,32,.6)" }}>Loading inventory…</div>
        ) : properties.length === 0 ? (
          <div className="sbc-panel" style={{ padding: 24, color: "rgba(74,56,32,.6)", fontSize: ".9rem" }}>No released inventory here yet.</div>
        ) : (
          <div className="sbc2b-grid">
            {properties.map((p) => {
              const fromPrice = Math.min(...p.rooms.map((r) => fc(r).buyN));
              return (
                <Link key={p.key} href={`/circle/model2/${encodeURIComponent(p.key)}`} className="sbc2b-card">
                  <div className="sbc2b-card-img">
                    {p.image ? <img src={p.image} alt={p.title} loading="lazy" /> : <div className="sbc2b-noimg">🏔️</div>}
                    <span className="sbc2b-badge sbc2b-badge-city">📍 {cap(p.city)}</span>
                    {p.star > 0 && <span className="sbc2b-badge sbc2b-badge-nights">{"★".repeat(p.star)}</span>}
                    <span className="sbc2b-view">Tour property →</span>
                  </div>
                  <div className="sbc2b-card-body">
                    <div className="sbc2b-card-title">{p.title}</div>
                    <div className="sbc2b-card-room">{p.rooms.length} room{p.rooms.length === 1 ? "" : "s"} released · owner-vacant nights</div>
                    <div className="sbc2b-card-foot">
                      <div className="sbc2b-youpay"><b>from {perN(fromPrice)}</b><span>/night</span></div>
                      <span className="sbc-btn-gold" style={{ pointerEvents: "none" }}>Open</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <p className="sbc-ms-note" style={{ marginTop: 16, color: "rgba(74,56,32,.55)" }}>{CIRCLE_B2B_RESALE_NOTE}</p>
      </div>

      {bCount > 0 && (
        <div className="sbc2b-basket">
          <div className="sbc2b-basket-in">
            <div className="sbc2b-basket-lines"><span>{bCount} room-night set{bCount === 1 ? "" : "s"} in bundle</span></div>
            <div className="sbc2b-basket-cta"><b>{inr(bTotal)}</b><Link href="/circle/model2/review" className="sbc-btn-gold">Review & pay</Link></div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .sbc2b { padding-bottom: 96px; }
        .sbc2b-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 12px; }
        .sbc2b-step { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 12px; padding: 9px 10px; }
        .sbc2b-step-n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--sbc-gold-deep); color: #fff; font-size: .72rem; font-weight: 800; display: grid; place-items: center; }
        .sbc2b-step-t { font-size: .78rem; font-weight: 800; color: var(--sbc-coffee); line-height: 1.1; }
        .sbc2b-step-d { font-size: .62rem; color: rgba(74,56,32,.6); }
        .sbc2b-kpis { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 8px; }
        .sbc2b-kpi { font-size: .7rem; font-weight: 700; color: rgba(74,56,32,.8); background: rgba(139,105,20,.08); border: 1px solid rgba(139,105,20,.16); border-radius: 999px; padding: 5px 11px; }
        .sbc2b-kpi-gold { color: #fff; background: var(--sbc-gold-deep); border-color: var(--sbc-gold-deep); }
        .sbc2b-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
        .sbc2b-chip { text-transform: capitalize; font-size: .82rem; font-weight: 700; padding: 7px 13px; border-radius: 999px; cursor: pointer; border: 1px solid rgba(139,105,20,.25); background: #fff; color: var(--sbc-ink); display: inline-flex; align-items: center; gap: 6px; }
        .sbc2b-chip.on { border-color: var(--sbc-gold-deep); background: var(--sbc-gold-deep); color: #fff; }
        .sbc2b-chip-ct { font-size: .64rem; opacity: .7; background: rgba(0,0,0,.08); border-radius: 999px; padding: 1px 6px; }
        .sbc2b-chip.on .sbc2b-chip-ct { background: rgba(255,255,255,.22); }
        .sbc2b-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
        .sbc2b-card { background: #fff; border: 1px solid rgba(139,105,20,.16); border-radius: 16px; overflow: hidden; box-shadow: 0 4px 18px rgba(74,56,32,.06); transition: transform .15s, box-shadow .15s; display: flex; flex-direction: column; text-align: left; }
        .sbc2b-card:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(74,56,32,.13); }
        .sbc2b-card-img { position: relative; width: 100%; aspect-ratio: 4 / 3; background: linear-gradient(135deg, #e2e7ed, #cdd6df); overflow: hidden; }
        .sbc2b-card-img img { width: 100%; height: 100%; object-fit: cover; }
        .sbc2b-noimg { display: grid; place-items: center; font-size: 2.4rem; width: 100%; height: 100%; }
        .sbc2b-badge { position: absolute; font-size: .64rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: rgba(30,22,12,.72); color: #fff; }
        .sbc2b-badge-city { top: 8px; left: 8px; }
        .sbc2b-badge-nights { top: 8px; right: 8px; background: rgba(139,105,20,.9); color: #e6ebef; }
        .sbc2b-view { position: absolute; bottom: 8px; right: 8px; font-size: .66rem; font-weight: 800; color: #fff; background: rgba(30,22,12,.6); padding: 4px 9px; border-radius: 999px; opacity: 0; transition: opacity .15s; }
        .sbc2b-card:hover .sbc2b-view { opacity: 1; }
        .sbc2b-card-body { padding: 11px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
        .sbc2b-card-title { font-weight: 800; color: var(--sbc-coffee); font-size: .92rem; line-height: 1.15; }
        .sbc2b-card-room { font-size: .72rem; color: rgba(74,56,32,.62); }
        .sbc2b-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 8px; }
        .sbc2b-youpay { display: flex; flex-direction: column; line-height: 1.05; }
        .sbc2b-youpay b { color: var(--sbc-coffee); font-size: .92rem; }
        .sbc2b-youpay span { font-size: .58rem; color: rgba(74,56,32,.5); }
        .sbc2b-basket { position: fixed; left: 0; right: 0; bottom: 62px; z-index: 40; padding: 10px 12px; background: linear-gradient(0deg, rgba(255,255,255,.94) 70%, rgba(255,255,255,0)); }
        .sbc2b-basket-in { max-width: 720px; margin: 0 auto; background: var(--sbc-coffee, #3a2c17); color: #f1f4f6; border-radius: 16px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
        .sbc2b-basket-lines { font-size: .78rem; opacity: .92; }
        .sbc2b-basket-cta { display: flex; align-items: center; gap: 12px; }
        .sbc2b-basket-cta b { font-size: 1.05rem; }
      `}</style>
    </div>
  );
}
