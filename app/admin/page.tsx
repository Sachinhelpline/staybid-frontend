"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import KpiCard from "@/components/admin/kpi-card";
import AdminLineChart from "@/components/admin/charts/line-chart";
import AdminBarChart from "@/components/admin/charts/bar-chart";
import AdminPieChart from "@/components/admin/charts/pie-chart";

const RAILWAY = "https://staybid-live-production.up.railway.app";

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // v126.2 — "Today" toggle: when on, dashboard KPIs swap to today-only values
  const [todayOnly, setTodayOnly] = useState(false);
  // v97 — dashboard liveness has 3 honest states:
  //   • "live"     = Socket.io connected + REST polling running       (green)
  //   • "polling"  = Socket.io disconnected (Railway cold / down) but
  //                  REST data is still refreshing every 30 s          (amber)
  //   • "connecting" = first 5 s after mount                            (gold)
  // Previously a single Socket.io error flipped to a red "OFFLINE"
  // chip that made the whole dashboard LOOK broken even though the
  // KPI / chart data was loading fine via REST. Now we degrade
  // gracefully + show a tooltip explaining what each state means.
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "polling">("connecting");
  const [pulse, setPulse] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  function load() {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); setLastRefresh(Date.now()); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);

    let socket: Socket | null = null;
    try {
      // Reconnection enabled so a Railway cold-start (~30 s) doesn't
      // permanently kill push updates — Socket.io will keep retrying
      // every 3 s up to 10 attempts.
      socket = io(RAILWAY, {
        transports: ["websocket", "polling"],
        timeout: 5000,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 8000,
      });
      socket.on("connect", () => {
        setLiveStatus("live");
        socket?.emit("join:admin");
      });
      // Both disconnect + connect_error fall back to "polling" so the
      // user knows REST is still fresh. "OFFLINE" wording was alarming
      // and inaccurate — the dashboard is online, only the websocket isn't.
      socket.on("disconnect", () => setLiveStatus((s) => (s === "live" ? "polling" : s)));
      socket.on("connect_error", () => setLiveStatus("polling"));
      socket.on("reconnect", () => setLiveStatus("live"));

      const onAnyBid = (b: any) => {
        setData((prev: any) => {
          if (!prev) return prev;
          const recentBids = [b, ...(prev.recentBids || [])].slice(0, 20);
          return { ...prev, recentBids };
        });
        setPulse((p) => p + 1);
      };
      socket.on("bid:new", onAnyBid);
      socket.on("bid:counter", onAnyBid);
      socket.on("bid:accepted", onAnyBid);
      socket.on("bid:rejected", onAnyBid);
    } catch {
      setLiveStatus("polling");
    }

    return () => {
      clearInterval(t);
      socket?.disconnect();
    };
  }, []);

  const k = data?.kpi || {};

  // Platform-systems widget — pulls counts for the new Session 1/2/4/5/6
  // tables (influencers, hotel videos, points, saves, notifications). Now
  // realtime-driven via Supabase Realtime: any INSERT/UPDATE on the new
  // tables triggers an immediate refetch (debounced 800ms to coalesce bursts).
  function PlatformSystems() {
    const [w, setW] = useState<any>(null);
    const [pulses, setPulses] = useState(0);
    useEffect(() => {
      let alive = true;
      const load = () => fetch("/api/admin/overview").then(r => r.json()).then(d => { if (alive) setW(d?.widgets || null); }).catch(() => {});
      load();
      const slow = setInterval(load, 60_000);

      let debounce: any = null;
      let unsub: (() => void) | null = null;
      (async () => {
        const { subscribeTables } = await import("@/lib/realtime");
        if (!alive) return;
        unsub = subscribeTables(
          ["influencers","influencer_commissions","influencer_referral_codes","referral_events","hotel_videos","user_points","points_history","user_saves","notification_queue"],
          () => {
            setPulses((p) => p + 1);
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(load, 800);
          }
        );
      })();

      return () => { alive = false; clearInterval(slow); if (debounce) clearTimeout(debounce); unsub?.(); };
    }, []);
    if (!w) return null;
    const widgets: { title: string; value: any; icon: string; color: string; sub: string; href: string }[] = [
      // v126.2 — Influencer = Creator. Same `influencers` table backs both
      // the legacy "influencer" naming AND the customer-facing "Creator"
      // surface. Show the more familiar word + split the active/total
      // visually so admins don't read "3/3" as "33".
      { title: "Creators",           value: `${w.influencersActive} · ${w.influencersTotal}`, icon: "✨", color: "#A855F7", sub: `${w.influencersActive} active of ${w.influencersTotal}`, href: "/admin/creators" },
      { title: "Videos Pending",     value: w.videosPending,                                  icon: "🎬", color: "#D4AF37", sub: `${w.videosApproved} approved`, href: "/admin/videos" },
      { title: "Points Wallets",     value: w.pointWallets,                                   icon: "⭐", color: "#F0D060", sub: "earning users",                href: "/admin/revenue" },
      { title: "Saves",              value: w.savesTotal,                                     icon: "🔖", color: "#3D9CF5", sub: "across all targets",           href: "/admin" },
      { title: "Notifications Queue",value: w.notifPending,                                   icon: "📨", color: "#2ECC71", sub: "pending dispatch",             href: "/admin" },
    ];
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: "#8A8FA8", fontFamily: "DM Sans, sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Platform Systems
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "rgba(46,204,113,0.12)", color: "#2ECC71", border: "1px solid rgba(46,204,113,0.3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2ECC71", boxShadow: "0 0 6px #2ECC71" }} />
            REALTIME{pulses > 0 ? ` · ${pulses}` : ""}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          {widgets.map((x) => (
            <a key={x.title} href={x.href} style={{ textDecoration: "none" }}>
              <KpiCard title={x.title} value={x.value as any} icon={x.icon} color={x.color} sub={x.sub} />
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      {/* Title */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, color: "#E8EAF0", fontSize: 28, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ color: "#8A8FA8", fontSize: 14, marginTop: 4 }}>
            Real-time overview of platform performance
          </p>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* v126.2 — Today / All-time toggle */}
          <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
            {[
              { k: false, label: "All-time" },
              { k: true,  label: "Today" },
            ].map((t) => (
              <button key={String(t.k)} onClick={() => setTodayOnly(t.k)}
                style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: "none",
                  background: todayOnly === t.k ? "linear-gradient(135deg,#D4AF37,#F0D060)" : "transparent",
                  color: todayOnly === t.k ? "#1a1205" : "#8A8FA8",
                  letterSpacing: "0.06em",
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div
            title={
              liveStatus === "live"
                ? "Socket.io connected — push updates active. Data also refreshes every 30 s."
                : liveStatus === "polling"
                ? "Socket.io disconnected (backend cold-start or temporary). Dashboard data still refreshes every 30 s via REST — everything you see is fresh."
                : "Connecting to real-time backend…"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: liveStatus === "live" ? "rgba(46,204,113,0.1)" : liveStatus === "polling" ? "rgba(212,175,55,0.12)" : "rgba(212,175,55,0.1)",
              color: liveStatus === "live" ? "#2ECC71" : liveStatus === "polling" ? "#D4AF37" : "#D4AF37",
              border: `1px solid ${liveStatus === "live" ? "rgba(46,204,113,0.3)" : liveStatus === "polling" ? "rgba(212,175,55,0.45)" : "rgba(212,175,55,0.3)"}`,
              cursor: "help",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: liveStatus === "live" ? "#2ECC71" : "#D4AF37",
                boxShadow: liveStatus === "live" ? "0 0 8px #2ECC71" : "none",
                animation: "pulse 2s infinite",
              }}
            />
            {liveStatus === "live"
              ? `LIVE${pulse > 0 ? ` · ${pulse} events` : ""}`
              : liveStatus === "polling"
              ? `POLLING · 30s${lastRefresh ? ` · refreshed ${Math.max(0, Math.floor((Date.now() - lastRefresh) / 1000))}s ago` : ""}`
              : "CONNECTING…"}
          </div>
          <button
            onClick={load}
            title="Refresh dashboard now"
            style={{
              background: "rgba(212,175,55,0.1)",
              color: "#D4AF37",
              border: "1px solid rgba(212,175,55,0.3)",
              borderRadius: 999,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* KPI Grid — v102 admin-kpi-grid class lets admin.css mobile rules
           tighten it to 2-col on phones + 1-col on tiny phones. */}
      <div
        className="admin-kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* v100 — KpiCards now animate value changes (CountUp) and pulse
            the accent stripe whenever Socket.io/REST poll bumps a number.
            v126.2 — every card is now clickable; Today toggle swaps to
            today-only values. */}
        <KpiCard
          title="Total GMV"
          value={(todayOnly ? data?.today?.gmv : k.gmv) || 0}
          format={(n) => "₹" + Math.round(n).toLocaleString("en-IN")}
          icon="💰" color="#D4AF37" sub={todayOnly ? "today" : "all time"} live
          sparkline={(data?.revenueTrend || []).map((p: any) => p.value)}
          onClick={() => router.push("/admin/finance")}
        />
        <KpiCard
          title={todayOnly ? "Today's Bookings" : "Active Bookings"}
          value={(todayOnly ? data?.today?.accepted : k.activeBookings) || 0}
          icon="📋" color="#2ECC71"
          sub={todayOnly ? `${data?.today?.bids || 0} bids placed` : `of ${k.totalBookings || 0} total`} live
          sparkline={(data?.bookingTrend || []).map((p: any) => p.value)}
          onClick={() => router.push("/admin/bookings")}
        />
        <KpiCard
          title="Revenue (5%)"
          value={(todayOnly ? data?.today?.revenue : k.revenue) || 0}
          format={(n) => "₹" + Math.round(n).toLocaleString("en-IN")}
          icon="📊" color="#3D9CF5" sub={todayOnly ? "today's commission" : "commission earned"} live
          sparkline={(data?.revenueTrend || []).map((p: any) => p.value)}
          onClick={() => router.push("/admin/revenue")}
        />
        <KpiCard
          title="Pending Verifications"
          value={k.pendingVerif || 0}
          icon="🎥" color="#A855F7" sub="awaiting review" live
          onClick={() => router.push("/admin/verification")}
        />
        <KpiCard
          title="Fraud Flags"
          value={k.fraud || 0}
          icon="🛡️" color="#FF4757" sub="needs attention" live
          onClick={() => router.push("/admin/fraud")}
        />
        <KpiCard
          title={todayOnly ? "New Users Today" : "New Users (7d)"}
          value={(todayOnly ? data?.today?.newUsers : k.newUsers) || 0}
          icon="👤" color="#F0D060" sub={`of ${k.totalUsers || 0} total`} live
          onClick={() => router.push("/admin/users")}
        />
      </div>

      {/* Platform systems row (Sessions 1, 2, 4–6 — additive overlay) */}
      <PlatformSystems />

      {/* Charts row */}
      <div className="admin-chart-row" style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 16, marginBottom: 24 }}>
        <Card title="Bookings Trend (7 days)">
          {loading ? <Skel /> : <AdminLineChart data={data?.bookingTrend || []} color="#D4AF37" />}
        </Card>
        <Card title="Revenue Trend (7 days)">
          {loading ? <Skel /> : <AdminBarChart data={data?.revenueTrend || []} color="#3D9CF5" />}
        </Card>
        <Card title="Verification Rate">
          {loading ? <Skel /> : <AdminPieChart data={data?.verifPie || []} />}
        </Card>
      </div>

      {/* Live ticker + queues */}
      <div className="admin-queues-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <Card title="🔴 Live Bid Ticker" subtitle={`${data?.recentBids?.length || 0} latest bids`}>
          {(data?.recentBids || []).slice(0, 7).map((b: any, i: number) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: i < 6 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
            >
              <div>
                <div style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500 }}>BID-{b.id}</div>
                <div style={{ color: "#8A8FA8", fontSize: 11 }}>
                  {new Date(b.createdAt).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#D4AF37", fontWeight: 600, fontSize: 14 }}>₹{Number(b.amount || 0).toLocaleString()}</div>
                <span style={statusPill(b.status)}>{b.status}</span>
              </div>
            </div>
          ))}
          {!data?.recentBids?.length && <Empty msg="No bids yet" />}
        </Card>

        <Card title="🎥 Verification Queue" subtitle={`${data?.verifQueue?.length || 0} pending`}>
          {(data?.verifQueue || []).map((v: any, i: number) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
            >
              <div>
                <div style={{ color: "#E8EAF0", fontSize: 13 }}>VP-{v.id?.slice(0, 8)}</div>
                <div style={{ color: "#8A8FA8", fontSize: 11 }}>Tier: {v.tier || "Silver"}</div>
              </div>
              <a
                href="/admin/verification"
                style={{
                  background: "rgba(212,175,55,0.1)",
                  color: "#D4AF37",
                  border: "1px solid rgba(212,175,55,0.3)",
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Review
              </a>
            </div>
          ))}
          {!data?.verifQueue?.length && <Empty msg="No pending verifications" />}
        </Card>

        <Card title="🚨 Recent Complaints" subtitle={`${data?.recentComplaints?.length || 0} latest`}>
          {(data?.recentComplaints || []).map((c: any, i: number) => (
            <div
              key={i}
              style={{
                padding: "10px 0",
                borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500 }}>{c.type || "general"}</span>
                <span style={statusPill(c.status)}>{c.status}</span>
              </div>
              <div style={{ color: "#8A8FA8", fontSize: 11, marginTop: 4 }}>
                priority: {c.priority || "med"} · {new Date(c.createdAt).toLocaleDateString("en-IN")}
              </div>
            </div>
          ))}
          {!data?.recentComplaints?.length && <Empty msg="No complaints" />}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#151820",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h3 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h3>
        {subtitle && <span style={{ color: "#8A8FA8", fontSize: 11 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Skel() {
  return <div style={{ height: 200, background: "rgba(255,255,255,0.03)", borderRadius: 10 }} />;
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ color: "#8A8FA8", fontSize: 13, padding: "20px 0", textAlign: "center" }}>{msg}</div>;
}

function statusPill(status: string): React.CSSProperties {
  const s = (status || "").toLowerCase();
  let color = "#8A8FA8";
  if (["accepted", "confirmed", "resolved", "verified"].includes(s)) color = "#2ECC71";
  else if (["rejected", "ban", "high"].includes(s)) color = "#FF4757";
  else if (["pending", "open", "counter", "in-review"].includes(s)) color = "#D4AF37";
  return {
    background: color + "22",
    color,
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginLeft: 6,
  };
}
