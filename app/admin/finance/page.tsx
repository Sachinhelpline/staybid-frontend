"use client";
import { useEffect, useState } from "react";
import KPICard from "@/components/admin/kpi-card";
import DataTable from "@/components/admin/data-table";
import Modal from "@/components/admin/modal";
import { adminColors as C, btnGold, btnGhost, h1Style, inputStyle, pageStyle, pill } from "@/lib/admin/styles";
import { exportRows } from "@/lib/admin/export";

type Tab = "ledger" | "payouts";

export default function AdminFinance() {
  const [tab, setTab] = useState<Tab>("ledger");
  const [ledger, setLedger] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<any | null>(null);
  const [pAmount, setPAmount] = useState("");
  const [pNotes, setPNotes] = useState("");
  const [pPeriod, setPPeriod] = useState(new Date().toISOString().slice(0, 7));

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/finance/commissions").then((r) => r.json()),
      fetch("/api/admin/finance/payout").then((r) => r.json()),
    ]).then(([l, p]) => {
      setLedger(l.ledger || []);
      setPayouts(p.payouts || []);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function createPayout() {
    if (!creating || !pAmount) return;
    await fetch("/api/admin/finance/payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hotelId: creating.hotelId, amount: Number(pAmount), period: pPeriod, notes: pNotes }),
    });
    setCreating(null);
    setPAmount(""); setPNotes(""); setPPeriod(new Date().toISOString().slice(0, 7));
    load();
  }

  async function markPaid(id: string) {
    const ref = prompt("Bank txn reference?") || "";
    await fetch("/api/admin/finance/payout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payoutId: id, status: "paid", txnRef: ref }),
    });
    load();
  }

  const totalGMV = ledger.reduce((s, r) => s + r.gmv, 0);
  const totalCommission = ledger.reduce((s, r) => s + r.commissionEarned, 0);
  const pendingPayouts = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.amount || 0), 0);
  const paidPayouts = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.amount || 0), 0);

  const ledgerCols: any[] = [
    { key: "hotelName", label: "Hotel", render: (r: any) => <span style={{ color: C.text, fontWeight: 500 }}>{r.hotelName}</span> },
    { key: "city", label: "City" },
    { key: "bookings", label: "Bookings", render: (r: any) => r.bookings || 0 },
    { key: "gmv", label: "GMV", render: (r: any) => `₹${r.gmv.toLocaleString()}` },
    { key: "commissionPct", label: "Commission %", render: (r: any) => <span style={pill(C.gold, "")}>{r.commissionPct}%</span> },
    { key: "commissionEarned", label: "Earned", render: (r: any) => <span style={{ color: C.green }}>₹{r.commissionEarned.toLocaleString()}</span> },
    { key: "netPayout", label: "Net Payout", render: (r: any) => `₹${r.netPayout.toLocaleString()}` },
    {
      key: "actions",
      label: "",
      render: (r: any) => (
        <button
          onClick={() => {
            setCreating(r);
            setPAmount(r.netPayout.toString());
          }}
          style={smallBtn}
        >
          Pay
        </button>
      ),
    },
  ];

  const payoutCols: any[] = [
    { key: "id", label: "ID", render: (p: any) => <span style={{ fontFamily: "monospace", color: C.textDim, fontSize: 12 }}>{p.id?.slice(0, 8)}</span> },
    { key: "hotelId", label: "Hotel", render: (p: any) => p.hotelId?.slice(0, 8) || "—" },
    { key: "period", label: "Period" },
    { key: "amount", label: "Amount", render: (p: any) => `₹${Number(p.amount || 0).toLocaleString()}` },
    {
      key: "status",
      label: "Status",
      render: (p: any) => <span style={pill(p.status === "paid" ? C.green : p.status === "pending" ? C.amber : C.textDim, "")}>{p.status}</span>,
    },
    { key: "txnRef", label: "Txn Ref", render: (p: any) => p.txnRef || <span style={{ color: C.textDim }}>—</span> },
    { key: "createdAt", label: "Created", render: (p: any) => (p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—") },
    {
      key: "actions",
      label: "",
      render: (p: any) =>
        p.status === "pending" ? (
          <button onClick={() => markPaid(p.id)} style={{ ...smallBtn, color: C.green, background: "rgba(46,204,113,0.1)", border: `1px solid ${C.green}55` }}>Mark Paid</button>
        ) : null,
    },
  ];

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ ...h1Style, margin: 0 }}>Commission & Finance</h1>
        <button
          onClick={() =>
            tab === "ledger"
              ? exportRows("commission-ledger", ledger, ledgerCols.filter((c: any) => c.key !== "actions"))
              : exportRows("payouts", payouts, payoutCols.filter((c: any) => c.key !== "actions"))
          }
          style={{ ...btnGhost, marginLeft: "auto" }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <KPICard title="Total GMV" value={`₹${totalGMV.toLocaleString()}`} color={C.gold} />
        <KPICard title="Commission Earned" value={`₹${totalCommission.toLocaleString()}`} color={C.green} />
        <KPICard title="Pending Payouts" value={`₹${pendingPayouts.toLocaleString()}`} color={C.amber} />
        <KPICard title="Paid Out" value={`₹${paidPayouts.toLocaleString()}`} color={C.blue} />
      </div>

      <div className="admin-tabs" style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}` }}>
        {(["ledger", "payouts"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              color: tab === t ? C.gold : C.textDim,
              padding: "12px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === t ? `2px solid ${C.gold}` : "2px solid transparent",
              fontFamily: "DM Sans, sans-serif",
              textTransform: "capitalize",
            }}
          >
            {t === "ledger" ? "Commission Ledger" : "Payout Queue"}
          </button>
        ))}
      </div>

      {tab === "ledger" ? (
        <DataTable columns={ledgerCols} data={ledger} loading={loading} pageSize={15} />
      ) : (
        <DataTable columns={payoutCols} data={payouts} loading={loading} pageSize={15} />
      )}

      {creating && (
        <Modal onClose={() => setCreating(null)} width={460}>
          <h2 style={{ fontFamily: "Syne, sans-serif", margin: "0 0 6px" }}>Create Payout</h2>
          <div style={{ color: C.textDim, fontSize: 13, marginBottom: 16 }}>{creating.hotelName}</div>
          <Lbl>Amount (₹)</Lbl>
          <input type="number" value={pAmount} onChange={(e) => setPAmount(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>Period (YYYY-MM)</Lbl>
          <input value={pPeriod} onChange={(e) => setPPeriod(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 10 }} />
          <Lbl>Notes</Lbl>
          <textarea value={pNotes} onChange={(e) => setPNotes(e.target.value)} rows={3} style={{ ...inputStyle, width: "100%", resize: "vertical", marginBottom: 14 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createPayout} style={btnGold}>Queue Payout</button>
            <button onClick={() => setCreating(null)} style={btnGhost}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Lbl({ children }: { children: any }) {
  return <div style={{ color: C.textDim, fontSize: 11, marginBottom: 6, fontWeight: 600, letterSpacing: 0.5 }}>{children}</div>;
}

const smallBtn = {
  background: "rgba(212,175,55,0.1)",
  color: C.gold,
  border: `1px solid rgba(212,175,55,0.3)`,
  padding: "5px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
} as const;
