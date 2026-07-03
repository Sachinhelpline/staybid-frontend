"use client";
// My Host Activity — the signed-in user's own view across every host module
// (leads, inquiries, design projects, store orders, workforce hires, channel
// connections). Customer-side counterpart to the admin /admin/host hub.

import { useEffect, useState } from "react";
import Link from "next/link";
import { prefLabels, type JourneyPreferences } from "@/lib/host/journey-data";

interface MeData {
  signedIn: boolean;
  leads: any[]; inquiries: any[]; projects: any[]; orders: any[]; jobs: any[]; channels: any[];
  portfolios: any[];
  summary: {
    leads: number; inquiries: number; projects: number; orders: number; jobs: number; channels: number;
    portfolios: number; activePortfolios: number; portfolioInvested: number;
    storeSpend: number; total: number;
  };
}

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const when = (s?: string) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

// Status → cozy tone.
function tone(s?: string): string {
  switch (s) {
    case "converted": case "connected": case "completed": case "delivered": case "paid": case "ready": return "#3f7d4f";
    case "qualified": case "contacted": case "assigned": case "visited": case "syncing": case "processing": case "in_progress": return "#2563eb";
    case "cancelled": case "closed": case "error": return "#b91c1c";
    case "paused": return "#6b7280";
    default: return "#b45309"; // new / requested / pending
  }
}

function Badge({ s }: { s?: string }) {
  return (
    <span style={{ padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: `${tone(s)}1a`, color: tone(s), border: `1px solid ${tone(s)}33` }}>
      {s || "—"}
    </span>
  );
}

export default function HostMe() {
  const [data, setData] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    fetch("/api/host/me", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const s = data?.summary;
  const signedIn = data?.signedIn !== false;
  const hasAny = (s?.total || 0) > 0;

  return (
    <div className="hostos-discovery">
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-4 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <h1 className="font-display leading-tight mt-3" style={{ fontSize: "clamp(1.8rem,5vw,2.8rem)", color: "var(--text-base)" }}>
          My host <span style={{ color: "var(--accent)" }}>activity</span>
        </h1>
        <p className="mt-2 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          Everything you've started across StayBid for Hosts — applications, property inquiries,
          design projects, store orders, staff hires and channel connections — in one place.
        </p>
      </section>

      {loading ? (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
      ) : !signedIn ? (
        <Guest />
      ) : !hasAny ? (
        <EmptyAll />
      ) : (
        <>
          {/* Summary strip */}
          <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 sb-stagger">
              <Stat label="Portfolios" value={s!.portfolios ?? 0} sub={s!.portfolioInvested ? inr(s!.portfolioInvested) : undefined} />
              <Stat label="Applications" value={s!.leads} />
              <Stat label="Inquiries" value={s!.inquiries} />
              <Stat label="Designs" value={s!.projects} />
              <Stat label="Orders" value={s!.orders} sub={s!.storeSpend ? inr(s!.storeSpend) : undefined} />
              <Stat label="Hires" value={s!.jobs} />
              <Stat label="Channels" value={s!.channels} />
            </div>
          </section>

          <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-28 space-y-5 mt-3">
            {/* Investor dashboard — portfolio configs from the 5-phase journey (v284) */}
            {(data!.portfolios?.length || 0) > 0 && (
              <div className="sb-card-lift rounded-2xl p-4 sm:p-5"
                style={{ background: "linear-gradient(140deg, rgba(201,145,26,0.10), var(--bg-card) 55%)", border: "1px solid var(--border-soft)" }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-lg" style={{ color: "var(--text-base)" }}>💼 My portfolios</h2>
                  <Link href="/host/build" className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Build another ›</Link>
                </div>
                <div className="space-y-3">
                  {data!.portfolios.map((p) => <PortfolioCard key={p.id} p={p} />)}
                </div>
              </div>
            )}

            {/* Applications */}
            <Card show={data!.leads.length} title="📨 Your applications" cta={{ href: "/host", label: "Explore tiers" }}>
              {data!.leads.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at}
                  main={r.metadata?.tier ? `${r.metadata.tier} tier` : `Interest: ${r.interest || "general"}`}
                  sub={[r.city, r.message].filter(Boolean).join(" · ")} />
              ))}
            </Card>

            {/* Property inquiries */}
            <Card show={data!.inquiries.length} title="🔍 Property inquiries" cta={{ href: "/host/properties", label: "Browse properties" }}>
              {data!.inquiries.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at}
                  main={r._property?.title || "Property"} sub={[r._property?.city, r.message].filter(Boolean).join(" · ")} />
              ))}
            </Card>

            {/* Design projects */}
            <Card show={data!.projects.length} title="🎨 Design projects" cta={{ href: "/host/studio", label: "New design" }}>
              {data!.projects.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at}
                  main={r.title || `${r.room_type || "Room"} · ${r.style || "Mixed"}`}
                  sub={[`${r._optionCount} options`, (r.budget_min || r.budget_max) ? `${inr(r.budget_min)}–${inr(r.budget_max)}` : null].filter(Boolean).join(" · ")} />
              ))}
            </Card>

            {/* Store orders */}
            <Card show={data!.orders.length} title="🛋️ Store orders" cta={{ href: "/host/store", label: "Shop the store" }}>
              {data!.orders.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at}
                  main={`${(r.items || []).slice(0, 2).map((it: any) => `${it.name}×${it.qty}`).join(", ") || "Order"}${(r.items || []).length > 2 ? ` +${r.items.length - 2}` : ""}`}
                  sub={[r.mode, r.emi_months ? `${r.emi_months}mo EMI` : null].filter(Boolean).join(" · ")}
                  amount={inr(r.total)} />
              ))}
            </Card>

            {/* Workforce hires */}
            <Card show={data!.jobs.length} title="🧑‍🔧 Staff hires" cta={{ href: "/host/workforce", label: "Hire staff" }}>
              {data!.jobs.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at}
                  main={`${r._worker?.name || "Worker"} · ${r.skill || ""}`}
                  sub={r.scheduled_at ? `Scheduled ${when(r.scheduled_at)}` : undefined}
                  amount={r.amount ? inr(r.amount) : undefined} />
              ))}
            </Card>

            {/* Channels */}
            <Card show={data!.channels.length} title="🔗 Channel connections" cta={{ href: "/host/channels", label: "Connect channels" }}>
              {data!.channels.map((r) => (
                <Row key={r.id} status={r.status} date={r.created_at} main={r.channel} sub={r.property_ref || undefined} />
              ))}
            </Card>
          </div>
        </>
      )}
      <style jsx global>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}

// One purchased/pending portfolio config (5-phase configurator, v284).
// Shows the money facts + the journey preferences the investor picked.
function PortfolioCard({ p }: { p: any }) {
  const prefs = prefLabels((p.preferences || null) as JourneyPreferences | null);
  const cities: string[] = Array.isArray(p.cities) ? p.cities : [];
  const tierName = String(p.tier || "").replace(/^\w/, (c: string) => c.toUpperCase());
  const active = p.status === "active";
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--bg-input, rgba(0,0,0,0.02))", border: "1px solid var(--border-soft)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display font-bold" style={{ color: "var(--text-base)", fontSize: 16 }}>
          {tierName} portfolio
        </span>
        <Badge s={active ? "paid" : p.status} />
        {active && (
          <span className="sb-pulse-dot" aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: "#3f7d4f", display: "inline-block" }} />
        )}
        <span className="ml-auto" style={{ color: "var(--text-muted)", fontSize: 11 }}>{when(p.created_at)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <MiniFact k="Rooms" v={String(p.rooms || 1)} />
        <MiniFact k="Cities" v={cities.length ? cities.join(", ") : "—"} />
        <MiniFact k="Paid now" v={inr(p.pay_now)} accent />
        <MiniFact k="Recurring" v={`${inr(p.recurring)}/mo`} />
      </div>
      {prefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {prefs.map((x) => (
            <span key={x.k} title={x.k} style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--border-soft)" }}>
              {x.k}: {x.v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniFact({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
      <div className="truncate" style={{ fontSize: 13, fontWeight: 700, color: accent ? "var(--accent)" : "var(--text-base)" }}>{v}</div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="sb-card-lift rounded-2xl p-3 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="font-display" style={{ fontSize: 24, fontWeight: 800, color: value > 0 ? "var(--accent)" : "var(--text-muted)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-soft)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Card({ show, title, cta, children }: { show: number; title: string; cta: { href: string; label: string }; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="sb-card-lift rounded-2xl p-4 sm:p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg" style={{ color: "var(--text-base)" }}>{title}</h2>
        <Link href={cta.href} className="text-xs font-semibold" style={{ color: "var(--accent)" }}>{cta.label} ›</Link>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ main, sub, status, date, amount }:
  { main: string; sub?: string; status?: string; date?: string; amount?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: "var(--bg-input, rgba(0,0,0,0.02))", border: "1px solid var(--border-soft)" }}>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate" style={{ color: "var(--text-base)", fontSize: 14 }}>{main}</div>
        {sub && <div className="truncate" style={{ color: "var(--text-muted)", fontSize: 12 }}>{sub}</div>}
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 1 }}>{when(date)}</div>
      </div>
      {amount && <div className="font-bold whitespace-nowrap" style={{ color: "var(--accent)", fontSize: 14 }}>{amount}</div>}
      <Badge s={status} />
    </div>
  );
}

function EmptyAll() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-28">
      <div className="rounded-3xl p-8 text-center sb-fade-in" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
        <div className="text-4xl mb-2">🏠</div>
        <div className="font-display text-2xl" style={{ color: "var(--text-base)" }}>Nothing here yet</div>
        <p className="mt-2 mx-auto max-w-md" style={{ color: "var(--text-soft)" }}>
          You haven't started anything on StayBid for Hosts. Pick a budget tier, browse properties,
          design a space, or hire staff — it'll all show up here.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-5">
          <Link href="/host" className="px-5 py-2.5 rounded-full text-white font-semibold text-sm" style={{ background: "linear-gradient(135deg,#c9911a,#a8740f)" }}>Explore tiers</Link>
          <Link href="/host/properties" className="px-5 py-2.5 rounded-full font-semibold text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Browse properties</Link>
        </div>
      </div>
    </section>
  );
}

function Guest() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-28">
      <div className="rounded-3xl p-8 text-center sb-fade-in" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
        <div className="text-4xl mb-2">🔑</div>
        <div className="font-display text-2xl" style={{ color: "var(--text-base)" }}>Sign in to see your activity</div>
        <p className="mt-2 mx-auto max-w-md" style={{ color: "var(--text-soft)" }}>
          Your host applications, inquiries, orders and hires are tied to your account. Sign in to track them here.
        </p>
        <div className="flex flex-wrap gap-3 justify-center mt-5">
          <Link href="/auth" className="px-6 py-2.5 rounded-full text-white font-semibold text-sm" style={{ background: "linear-gradient(135deg,#c9911a,#a8740f)" }}>Sign in</Link>
          <Link href="/host" className="px-6 py-2.5 rounded-full font-semibold text-sm" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Back to /host</Link>
        </div>
      </div>
    </section>
  );
}
