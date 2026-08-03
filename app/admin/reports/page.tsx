"use client";
// /admin/reports — Unified Reports Center
// Single home for every CSV export across the admin panel. Each card is a
// distinct dataset; admin picks an optional date window, then clicks Export
// to download a CSV with the actual rows from production.
//
// v126 — replaces scattered "Export CSV" buttons inside each individual
// admin page so finance, ops, and partner-relations leads can pull every
// kind of report from one place.

import { useEffect, useState, type ReactNode } from "react";
import {
  Files, BarChart3, Banknote, TrendingUp, Gift, ClipboardList, Timer,
  Building2, Sparkles, Ticket, Siren, Star, ShieldAlert, User, Clapperboard,
  Eye, FileSpreadsheet, FileText, Share2, Smartphone, MessageCircle, Mail,
  Send, Link2,
} from "lucide-react";
import { exportRows, exportPDF, shareRows, shareLinks } from "@/lib/admin/export";

type Report = {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  category: "Finance" | "Bookings" | "Commission" | "Loyalty" | "Operations" | "Customers";
  // fetcher returns { rows, columns }
  fetch: (ctx: { from?: string; to?: string }) => Promise<{ rows: any[]; columns: { key: string; label: string; map?: any }[] }>;
};

const adminHeaders = () => {
  const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
  const u = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("sb_admin_user") || "{}") : {};
  return { ...(t ? { "x-admin-token": t } : {}), ...(u?.id ? { "x-admin-id": u.id } : {}) };
};

const fmtINR = (n: number) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;

// ───── Report fetchers ─────────────────────────────────────────────
const REPORTS: Report[] = [
  // ── Finance ─────────────────────────────────────────────────────
  {
    id: "commission-ledger",
    label: "Commission Ledger (by hotel)",
    description: "Per-hotel GMV, commission %, commission earned, net payout.",
    icon: <BarChart3 size={18} strokeWidth={2} aria-hidden />,
    category: "Finance",
    async fetch() {
      const r = await fetch("/api/admin/finance/commissions").then((x) => x.json());
      return {
        rows: r?.ledger || [],
        columns: [
          { key: "hotelName", label: "Hotel" },
          { key: "city", label: "City" },
          { key: "bookings", label: "Accepted Bookings" },
          { key: "gmv", label: "GMV (INR)", map: (v: any) => Math.round(v || 0) },
          { key: "commissionPct", label: "Commission %" },
          { key: "commissionEarned", label: "Commission (INR)" },
          { key: "netPayout", label: "Net Payout (INR)" },
        ],
      };
    },
  },
  {
    id: "payouts",
    label: "Payout Queue",
    description: "All payouts (pending + paid) with txn references.",
    icon: <Banknote size={18} strokeWidth={2} aria-hidden />,
    category: "Finance",
    async fetch() {
      const r = await fetch("/api/admin/finance/payout").then((x) => x.json());
      return {
        rows: r?.payouts || [],
        columns: [
          { key: "id", label: "Payout ID" },
          { key: "hotelId", label: "Hotel ID" },
          { key: "period", label: "Period (YYYY-MM)" },
          { key: "amount", label: "Amount (INR)" },
          { key: "status", label: "Status" },
          { key: "txnRef", label: "Bank Txn Ref" },
          { key: "notes", label: "Notes" },
          { key: "createdAt", label: "Created At" },
        ],
      };
    },
  },
  {
    id: "revenue-snapshot",
    label: "Platform Revenue Snapshot",
    description: "Gross all-time, gross 30d, points outstanding, redemption cost.",
    icon: <TrendingUp size={18} strokeWidth={2} aria-hidden />,
    category: "Finance",
    async fetch() {
      const r = await fetch("/api/admin/revenue").then((x) => x.json());
      const rows = [
        { metric: "Gross all-time", value: r?.grossAllTime || 0 },
        { metric: "Gross this month", value: r?.grossThisMonth || 0 },
        { metric: "Gross last 30 days", value: r?.gross30Days || 0 },
        { metric: "Commission paid", value: r?.commissionPaid || 0 },
        { metric: "Commission pending", value: r?.commissionPending || 0 },
        { metric: "Points outstanding", value: r?.pointsOutstanding || 0 },
        { metric: "Accepted bids", value: r?.acceptedBids || 0 },
      ];
      return {
        rows,
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
      };
    },
  },
  {
    id: "redemption-cost",
    label: "Redemption Cost (last 30d)",
    description: "₹ cost of used codes + wallet credit debited + liability still active.",
    icon: <Gift size={18} strokeWidth={2} aria-hidden />,
    category: "Finance",
    async fetch() {
      const r = await fetch("/api/admin/analytics/redemption?days=30", { headers: adminHeaders() }).then((x) =>
        x.json(),
      );
      const k = r?.kpis || {};
      const rows = [
        { metric: "Codes issued (30d)", value: k.totalIssued || 0 },
        { metric: "Codes used (30d)", value: k.totalUsed || 0 },
        { metric: "Points spent (30d)", value: k.totalPointsSpent || 0 },
        { metric: "₹ cost of used codes", value: k.totalCostUsed || 0 },
        { metric: "₹ liability (active codes)", value: k.totalLiabilityActive || 0 },
        { metric: "Wallet credit debited", value: k.walletDebited || 0 },
        { metric: "Wallet credit credited (from points)", value: k.walletCredited || 0 },
      ];
      return { rows, columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }] };
    },
  },

  // ── Bookings ─────────────────────────────────────────────────────
  {
    id: "bookings-all",
    label: "All Bids & Bookings",
    description: "Every bid with status, paid amount, source attribution.",
    icon: <ClipboardList size={18} strokeWidth={2} aria-hidden />,
    category: "Bookings",
    async fetch() {
      const r = await fetch("/api/admin/bookings").then((x) => x.json());
      return {
        rows: r?.bookings || r?.bids || [],
        columns: [
          { key: "id", label: "Bid ID" },
          { key: "hotelName", label: "Hotel" },
          { key: "amount", label: "Bid Amount" },
          { key: "paidTotal", label: "Paid (INR)" },
          { key: "status", label: "Status" },
          { key: "source", label: "Source" },
          { key: "creatorHandle", label: "Creator" },
          { key: "checkIn", label: "Check-In" },
          { key: "checkOut", label: "Check-Out" },
          { key: "createdAt", label: "Created" },
        ],
      };
    },
  },
  {
    id: "active-holds",
    label: "Active Holds",
    description: "All 24h price-hold reservations with expiry + balance due.",
    icon: <Timer size={18} strokeWidth={2} aria-hidden />,
    category: "Bookings",
    async fetch() {
      const r = await fetch("/api/admin/holds?status=active", { headers: adminHeaders() }).then((x) => x.json());
      return {
        rows: r?.holds || [],
        columns: [
          { key: "bid_id", label: "Bid ID" },
          { key: "hotel_name", label: "Hotel" },
          { key: "hold_amount", label: "Hold (INR)" },
          { key: "balance_due", label: "Balance Due (INR)" },
          { key: "total_amount", label: "Total (INR)" },
          { key: "expires_at", label: "Expires" },
          { key: "flow", label: "Flow" },
          { key: "pay_at_hotel", label: "Pay at hotel" },
        ],
      };
    },
  },

  // ── Commission ───────────────────────────────────────────────────
  {
    id: "hotel-commission-rules",
    label: "Hotel Commission Rules",
    description: "Every hotel's effective commission % (override or default).",
    icon: <Building2 size={18} strokeWidth={2} aria-hidden />,
    category: "Commission",
    async fetch() {
      const r = await fetch("/api/admin/hotel-commission-rules", { headers: adminHeaders() }).then((x) => x.json());
      const rows = (r?.hotels || []).map((row: any) => ({
        hotelName: row.hotel.name,
        city: row.hotel.city,
        source: row.source,
        platformPct: row.rule.platform_pct,
        slabs: row.rule.slabs ? JSON.stringify(row.rule.slabs) : "",
        notes: row.rule.notes || "",
      }));
      return {
        rows,
        columns: [
          { key: "hotelName", label: "Hotel" },
          { key: "city", label: "City" },
          { key: "source", label: "Source" },
          { key: "platformPct", label: "Flat %" },
          { key: "slabs", label: "Slabs (JSON)" },
          { key: "notes", label: "Notes" },
        ],
      };
    },
  },
  {
    id: "creator-commissions",
    label: "Creator Commission History",
    description: "Per-creator monthly slab + loyalty bonus + GMV + commission.",
    icon: <Sparkles size={18} strokeWidth={2} aria-hidden />,
    category: "Commission",
    async fetch() {
      // Reuse the bid attributions API to pull creator-attributed bookings
      const r = await fetch("/api/admin/analytics/bidding?days=90", { headers: adminHeaders() }).then((x) =>
        x.json(),
      );
      const rows = (r?.topCreators || []).map((c: any) => ({
        creatorHandle: c.handle,
        bookings: c.bookings,
        gmv: c.gmv,
        commission: c.commission,
      }));
      return {
        rows,
        columns: [
          { key: "creatorHandle", label: "Creator" },
          { key: "bookings", label: "Bookings" },
          { key: "gmv", label: "GMV (INR)" },
          { key: "commission", label: "Commission (INR)" },
        ],
      };
    },
  },

  // ── Loyalty ─────────────────────────────────────────────────────
  {
    id: "redemption-codes",
    label: "Issued Redemption Codes",
    description: "Every code issued from /points/redeem with status + value.",
    icon: <Ticket size={18} strokeWidth={2} aria-hidden />,
    category: "Loyalty",
    async fetch() {
      const r = await fetch("/api/admin/redemption-codes?limit=500", { headers: adminHeaders() }).then((x) =>
        x.json(),
      );
      return {
        rows: r?.codes || [],
        columns: [
          { key: "code", label: "Code" },
          { key: "barcode_value", label: "Barcode" },
          { key: "kind", label: "Kind" },
          { key: "title", label: "Title" },
          { key: "value_inr", label: "Value (INR)" },
          { key: "points_spent", label: "Points Spent" },
          { key: "status", label: "Status" },
          { key: "issued_at", label: "Issued" },
          { key: "expires_at", label: "Expires" },
          { key: "used_at", label: "Used At" },
          { key: "used_on_bid_id", label: "Used on Bid" },
          { key: "used_by_hotel_id", label: "Used by Hotel" },
        ],
      };
    },
  },

  // ── Operations ──────────────────────────────────────────────────
  {
    id: "complaints",
    label: "Complaints",
    description: "All customer complaints with status, priority, and resolution.",
    icon: <Siren size={18} strokeWidth={2} aria-hidden />,
    category: "Operations",
    async fetch() {
      const r = await fetch("/api/admin/complaints").then((x) => x.json());
      return {
        rows: r?.complaints || [],
        columns: [
          { key: "id", label: "Complaint ID" },
          { key: "type", label: "Type" },
          { key: "subject", label: "Subject" },
          { key: "priority", label: "Priority" },
          { key: "status", label: "Status" },
          { key: "refundAmount", label: "Refund (INR)" },
          { key: "createdAt", label: "Created" },
          { key: "resolvedAt", label: "Resolved" },
        ],
      };
    },
  },
  {
    id: "feedback",
    label: "Customer Feedback",
    description: "Post-stay ratings + comments earned via /bookings.",
    icon: <Star size={18} strokeWidth={2} aria-hidden />,
    category: "Operations",
    async fetch() {
      const r = await fetch("/api/admin/feedback").then((x) => x.json());
      return {
        rows: r?.feedback || [],
        columns: [
          { key: "id", label: "ID" },
          { key: "booking_id", label: "Booking" },
          { key: "rating", label: "Rating" },
          { key: "comments", label: "Comments" },
          { key: "created_at", label: "Submitted" },
        ],
      };
    },
  },
  {
    id: "fraud-flags",
    label: "Fraud & Security Flags",
    description: "Open fraud signals across users, bids, and payments.",
    icon: <ShieldAlert size={18} strokeWidth={2} aria-hidden />,
    category: "Operations",
    async fetch() {
      const r = await fetch("/api/admin/fraud/flags").then((x) => x.json());
      return {
        rows: r?.flags || [],
        columns: [
          { key: "id", label: "Flag ID" },
          { key: "type", label: "Type" },
          { key: "severity", label: "Severity" },
          { key: "subject_id", label: "Subject" },
          { key: "details", label: "Details" },
          { key: "created_at", label: "Detected" },
        ],
      };
    },
  },

  // ── Customers ──────────────────────────────────────────────────
  {
    id: "users",
    label: "Users",
    description: "All registered customers with tier, lifetime spend, points.",
    icon: <User size={18} strokeWidth={2} aria-hidden />,
    category: "Customers",
    async fetch() {
      const r = await fetch("/api/admin/users").then((x) => x.json());
      return {
        rows: r?.users || [],
        columns: [
          { key: "id", label: "User ID" },
          { key: "phone", label: "Phone" },
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role" },
          { key: "createdAt", label: "Joined" },
        ],
      };
    },
  },
  {
    id: "creators",
    label: "Creator Applications",
    description: "All influencer applications with KYC + bank details.",
    icon: <Clapperboard size={18} strokeWidth={2} aria-hidden />,
    category: "Customers",
    async fetch() {
      const r = await fetch("/api/admin/creators?status=all").then((x) => x.json());
      const rows = (r?.creators || []).map((c: any) => ({
        id: c.id,
        name: c.users?.name || "",
        phone: c.users?.phone || "",
        email: c.users?.email || "",
        bio: c.bio,
        followers: c.total_followers,
        status: c.status,
        verification_tier: c.verification_tier,
        aadhaar_verified: c.aadhaar_verified,
        pan_verified: c.pan_verified,
        bank_name: c.bank_name,
        ifsc: c.ifsc_code,
        total_earnings: c.total_earnings,
        created_at: c.created_at,
      }));
      return {
        rows,
        columns: [
          { key: "name", label: "Name" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "bio", label: "Bio" },
          { key: "followers", label: "Followers" },
          { key: "status", label: "Status" },
          { key: "verification_tier", label: "Tier" },
          { key: "aadhaar_verified", label: "Aadhaar OK" },
          { key: "pan_verified", label: "PAN OK" },
          { key: "bank_name", label: "Bank" },
          { key: "ifsc", label: "IFSC" },
          { key: "total_earnings", label: "Earnings (INR)" },
          { key: "created_at", label: "Joined" },
        ],
      };
    },
  },
];

export default function AdminReportsPage() {
  const [filter, setFilter] = useState<string>("All");
  const [busy, setBusy] = useState<string>("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<{ id: string; rows: any[]; columns: any[] } | null>(null);
  // v126.2 — Share menu state
  const [shareOpen, setShareOpen] = useState<{ rep: Report; rows: any[]; columns: any[] } | null>(null);
  const [toast, setToast] = useState("");
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  // Pre-warm row counts for the KPI strip (best-effort, ignore errors)
  useEffect(() => {
    let dead = false;
    (async () => {
      const out: Record<string, number> = {};
      for (const r of REPORTS) {
        if (dead) return;
        try {
          const { rows } = await r.fetch({});
          out[r.id] = rows.length;
        } catch {
          out[r.id] = 0;
        }
        setCounts({ ...out });
      }
    })();
    return () => { dead = true; };
  }, []);

  const categories = Array.from(new Set(REPORTS.map((r) => r.category)));
  const visible = filter === "All" ? REPORTS : REPORTS.filter((r) => r.category === filter);

  async function runExport(rep: Report) {
    setBusy(rep.id);
    try {
      const { rows, columns } = await rep.fetch({});
      exportRows(rep.id, rows, columns);
      showToast(`CSV downloaded · ${rows.length.toLocaleString("en-IN")} rows`);
    } catch (e: any) {
      alert(`Export failed: ${e?.message || "unknown"}`);
    } finally {
      setBusy("");
    }
  }

  async function runPDF(rep: Report) {
    setBusy(rep.id);
    try {
      const { rows, columns } = await rep.fetch({});
      exportPDF(rep.id, rep.label, rows, columns);
      showToast("PDF preview opened · use Save as PDF");
    } catch (e: any) {
      alert(`PDF failed: ${e?.message || "unknown"}`);
    } finally {
      setBusy("");
    }
  }

  async function openShare(rep: Report) {
    setBusy(rep.id);
    try {
      const { rows, columns } = await rep.fetch({});
      setShareOpen({ rep, rows, columns });
    } catch (e: any) {
      alert(`Failed: ${e?.message || "unknown"}`);
    } finally {
      setBusy("");
    }
  }

  async function showPreview(rep: Report) {
    setBusy(rep.id);
    try {
      const { rows, columns } = await rep.fetch({});
      setPreview({ id: rep.id, rows: rows.slice(0, 20), columns });
    } finally {
      setBusy("");
    }
  }

  const totalRowCount = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div style={{ padding: 0, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 22, color: "#E8EAF0", margin: 0, display: "inline-flex", alignItems: "center", gap: 9 }}>
            <Files size={21} strokeWidth={2} aria-hidden />Reports Center
          </h1>
          <p style={{ fontSize: 11, color: "#8A8FA8", marginTop: 4 }}>
            One CTA per dataset. Preview the first 20 rows or export the full CSV.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{
            fontSize: 11, color: "#9fb1c2", fontWeight: 700, padding: "5px 10px",
            background: "rgba(140, 160, 182,0.1)", border: "1px solid rgba(140, 160, 182,0.3)",
            borderRadius: 999, letterSpacing: "0.06em",
          }}>
            {REPORTS.length} REPORTS · {totalRowCount.toLocaleString("en-IN")} ROWS
          </span>
        </div>
      </div>

      {/* Category filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["All", ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            style={{
              padding: "5px 14px", borderRadius: 999, fontSize: 11, fontWeight: 700,
              border: filter === c ? "1px solid #9fb1c2" : "1px solid rgba(255,255,255,0.12)",
              background: filter === c ? "rgba(140, 160, 182,0.12)" : "transparent",
              color: filter === c ? "#9fb1c2" : "#8A8FA8",
              cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
            {c}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 10 }}>
        {visible.map((rep) => (
          <div key={rep.id} className="admin-card" style={{
            background: "#151820", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)",
            padding: 13, display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, color: "#c2cfdb",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: "linear-gradient(135deg, rgba(140, 160, 182,0.16), rgba(140, 160, 182,0.04))",
              }}>{rep.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ color: "#E8EAF0", fontWeight: 700, fontSize: 13, margin: 0 }}>{rep.label}</p>
                <p style={{ color: "#8A8FA8", fontSize: 11, margin: "3px 0 0", lineHeight: 1.4 }}>{rep.description}</p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "#808698", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {rep.category} · {counts[rep.id] != null ? `${counts[rep.id].toLocaleString("en-IN")} rows` : "…"}
              </span>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <button onClick={() => showPreview(rep)} disabled={!!busy} title="Preview first 20 rows"
                  style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, background: "transparent", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Eye size={12} strokeWidth={2.2} aria-hidden />Preview
                </button>
                <button onClick={() => runExport(rep)} disabled={!!busy} title="Download as CSV"
                  style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, background: "rgba(140, 160, 182,0.16)", color: "#9fb1c2", border: "1px solid rgba(140, 160, 182,0.36)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <FileSpreadsheet size={12} strokeWidth={2.2} aria-hidden />CSV
                </button>
                <button onClick={() => runPDF(rep)} disabled={!!busy} title="Download as PDF"
                  style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, background: "rgba(255,71,87,0.12)", color: "#FF8C42", border: "1px solid rgba(255,140,66,0.32)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <FileText size={12} strokeWidth={2.2} aria-hidden />PDF
                </button>
                <button onClick={() => openShare(rep)} disabled={!!busy} title="Share via WhatsApp / email / system share"
                  style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 7, background: "rgba(61,156,245,0.12)", color: "#3D9CF5", border: "1px solid rgba(61,156,245,0.32)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Share2 size={12} strokeWidth={2.2} aria-hidden />Share
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Preview modal */}
      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0F1117", borderRadius: 16, width: "100%", maxWidth: 1100, padding: 18, border: "1px solid rgba(255,255,255,0.1)", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ color: "#9fb1c2", fontFamily: "Syne, sans-serif", margin: 0, fontSize: 16 }}>
                {REPORTS.find((r) => r.id === preview.id)?.label} — first 20 rows
              </h2>
              <button onClick={() => setPreview(null)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", color: "#8A8FA8", borderRadius: 7, padding: "5px 11px", fontSize: 11, cursor: "pointer" }}>Close</button>
            </div>
            <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                <thead style={{ background: "rgba(255,255,255,0.04)" }}>
                  <tr>
                    {preview.columns.map((c: any) => (
                      <th key={c.key} style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      {preview.columns.map((c: any) => (
                        <td key={c.key} style={{ padding: "6px 10px", fontSize: 11, color: "#E8EAF0", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(() => {
                            const raw = c.map ? c.map(row[c.key], row) : row[c.key];
                            return raw == null ? "—" : String(raw).slice(0, 60);
                          })()}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {preview.rows.length === 0 && (
                    <tr><td colSpan={preview.columns.length} style={{ padding: 22, textAlign: "center", color: "#8A8FA8", fontSize: 12 }}>No data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button onClick={() => {
                const rep = REPORTS.find((r) => r.id === preview.id);
                if (rep) {
                  rep.fetch({}).then(({ rows, columns }) => exportRows(rep.id, rows, columns));
                  setPreview(null);
                }
              }} style={{ background: "linear-gradient(160deg,#d4dde6 0%,#b1bfd0 52%,#93a7bc 100%)", color: "#1a1205", border: "none", padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Export full CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share modal (v126.2) */}
      {shareOpen && (
        <div onClick={() => setShareOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#0F1117", borderRadius: 16, width: "100%", maxWidth: 460, padding: 18, border: "1px solid rgba(255,255,255,0.1)" }}>
            <h2 style={{ color: "#9fb1c2", fontFamily: "Syne, sans-serif", margin: 0, fontSize: 16, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 8 }}><Share2 size={16} strokeWidth={2} aria-hidden />Share {shareOpen.rep.label}</h2>
            <p style={{ color: "#8A8FA8", fontSize: 11, margin: "0 0 14px" }}>
              {shareOpen.rows.length.toLocaleString("en-IN")} rows · pick a destination
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* Native share — only shown when supported */}
              {typeof navigator !== "undefined" && typeof (navigator as any).share === "function" && (
                <button onClick={async () => {
                  const r = await shareRows({
                    filename: shareOpen.rep.id,
                    title: `StayBid — ${shareOpen.rep.label}`,
                    description: shareOpen.rep.description,
                    rows: shareOpen.rows,
                    columns: shareOpen.columns,
                    format: "csv",
                  });
                  showToast(r.ok ? `Shared (${r.via})` : "Share cancelled");
                  setShareOpen(null);
                }} style={shareBtn("#2ECC71")}>
                  <Smartphone size={13} strokeWidth={2.2} aria-hidden />System share
                </button>
              )}
              {(() => {
                const links = shareLinks(
                  `StayBid Report — ${shareOpen.rep.label}`,
                  `${shareOpen.rep.description}\n${shareOpen.rows.length} rows · generated ${new Date().toLocaleDateString("en-IN")}`,
                );
                return (
                  <>
                    <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" style={shareLink("#25D366")}>
                      <MessageCircle size={13} strokeWidth={2.2} aria-hidden />WhatsApp
                    </a>
                    <a href={links.email} style={shareLink("#3D9CF5")}>
                      <Mail size={13} strokeWidth={2.2} aria-hidden />Email
                    </a>
                    <a href={links.telegram} target="_blank" rel="noopener noreferrer" style={shareLink("#2AABEE")}>
                      <Send size={13} strokeWidth={2.2} aria-hidden />Telegram
                    </a>
                    <button onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(links.copy);
                        showToast("Link copied to clipboard");
                      } catch {
                        showToast("Copy failed");
                      }
                    }} style={shareBtn("#D8B4FE")}>
                      <Link2 size={13} strokeWidth={2.2} aria-hidden />Copy text
                    </button>
                    <button onClick={() => {
                      exportRows(shareOpen.rep.id, shareOpen.rows, shareOpen.columns);
                      showToast("CSV downloaded — attach in your app");
                    }} style={shareBtn("#9fb1c2")}>
                      <FileSpreadsheet size={13} strokeWidth={2.2} aria-hidden />Download CSV first
                    </button>
                    <button onClick={() => {
                      exportPDF(shareOpen.rep.id, shareOpen.rep.label, shareOpen.rows, shareOpen.columns);
                      showToast("PDF preview opened — Save then share");
                    }} style={shareBtn("#FF8C42")}>
                      <FileText size={13} strokeWidth={2.2} aria-hidden />Download PDF first
                    </button>
                  </>
                );
              })()}
            </div>
            <p style={{ color: "#808698", fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
              The data leaves the platform once shared. Confidential — internal use only.
            </p>
            <div style={{ marginTop: 12, textAlign: "right" }}>
              <button onClick={() => setShareOpen(null)} style={{ background: "transparent", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.12)", padding: "6px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "#0F1117", color: "#9fb1c2", padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 600, border: "1px solid rgba(140, 160, 182,0.3)", zIndex: 70, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

const shareBtn = (color: string): React.CSSProperties => ({
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 9,
  background: `${color}1A`,
  color,
  border: `1px solid ${color}55`,
  cursor: "pointer",
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
});
const shareLink = (color: string): React.CSSProperties => ({
  ...shareBtn(color),
  textDecoration: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});
