"use client";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import KpiCard from "@/components/admin/kpi-card";
import AdminLineChart from "@/components/admin/charts/line-chart";
import AdminBarChart from "@/components/admin/charts/bar-chart";
import AdminPieChart from "@/components/admin/charts/pie-chart";

const RAILWAY = "https://staybid-live-production.up.railway.app";

export default function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [pulse, setPulse] = useState(0);

  function load() {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);

    let socket: Socket | null = null;
    try {
      socket = io(RAILWAY, { transports: ["websocket", "polling"], timeout: 5000 });
      socket.on("connect", () => {
        setLiveStatus("live");
        socket?.emit("join:admin");
      });
      socket.on("disconnect", () => setLiveStatus("offline"));
      socket.on("connect_error", () => setLiveStatus("offline"));

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
      setLiveStatus("offline");
    }

    return () => {
      clearInterval(t);
      socket?.disconnect();
    };
  }, []);

  const k = data?.kpi || {};

  // Platform-systems widget — pulls counts for the new Session 1/2/4/5/6
  // tables (influencers, hotel videos, points, saves, notifications). Lives
  // in a sibling component so the existing dashboard markup stays untouched.
  function PlatformSystems() {
    const [w, setW] = useState<any>(null);
    useEffect(() => {
      let alive = true;
      const load = () => fetch("/api/admin/overview").then(r => r.json()).then(d => { if (alive) setW(d?.widgets || null); }).catch(() => {});
      load();
      const t = setInterval(load, 60_000);
      return () => { alive = false; clearInterval(t); };
    }, []);
    if (!w) return null;
    const widgets = [
      { title: "Influencers",        value: `${w.influencersActive}/${w.influencersTotal}`, icon: "✨", color: "#A855F7", sub: "active / total", href: "/admin/users" },
      { title: "Videos Pending",     value: w.videosPending,                                  icon: "🎬", color: "#D4AF37", sub: `${w.videosApproved} approved`, href: "/admin/videos" },
      { title: "Points Wallets",     value: w.pointWallets,                                   icon: "⭐", color: "#F0D060", sub: "earning users",                href: "/admin/revenue" },
      { title: "Saves",              value: w.savesTotal,                                     icon: "🔖", color: "#3D9CF5", sub: "across all targets",           href: "/admin" },
      { title: "Notifications Queue",value: w.notifPending,                                   icon: "📨", color: "#2ECC71", sub: "pending dispatch",             href: "/admin" },
    ];
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
        {widgets.map((x) => (
          <a key={x.title} href={x.href} style={{ textDecoration: "none" }}>
            <KpiCard title={x.title} value={x.value as any} icon={x.icon} color={x.color} sub={x.sub} />
          </a>
        ))}
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
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: liveStatus === "live" ? "rgba(46,204,113,0.1)" : liveStatus === "offline" ? "rgba(255,71,87,0.1)" : "rgba(212,175,55,0.1)",
            color: liveStatus === "live" ? "#2ECC71" : liveStatus === "offline" ? "#FF4757" : "#D4AF37",
            border: `1px solid ${liveStatus === "live" ? "rgba(46,204,113,0.3)" : liveStatus === "offline" ? "rgba(255,71,87,0.3)" : "rgba(212,175,55,0.3)"}`,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: liveStatus === "live" ? "#2ECC71" : liveStatus === "offline" ? "#FF4757" : "#D4AF37",
              boxShadow: liveStatus === "live" ? "0 0 8px #2ECC71" : "none",
              animation: liveStatus === "live" ? "pulse 2s infinite" : "none",
            }}
          />
          {liveStatus === "live" ? `LIVE${pulse > 0 ? ` · ${pulse} events` : ""}` : liveStatus === "offline" ? "OFFLINE" : "CONNECTING…"}
        </div>
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      {/* KPI Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <KpiCard title="Total GMV" value={`₹${(k.gmv || 0).toLocaleString()}`} icon="💰" color="#D4AF37" sub="all time" />
        <KpiCard title="Active Bookings" value={k.activeBookings || 0} icon="📋" color="#2ECC71" sub={`of ${k.totalBookings || 0} total`} />
        <KpiCard title="Revenue (5%)" value={`₹${(k.revenue || 0).toLocaleString()}`} icon="📊" color="#3D9CF5" sub="commission earned" />
        <KpiCard title="Pending Verifications" value={k.pendingVerif || 0} icon="🎥" color="#A855F7" sub="awaiting review" />
        <KpiCard title="Fraud Flags" value={k.fraud || 0} icon="🛡️" color="#FF4757" sub="needs attention" />
        <KpiCard title="New Users" value={k.newUsers || 0} icon="👤" color="#F0D060" sub={`of ${k.totalUsers || 0} total`} />
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
