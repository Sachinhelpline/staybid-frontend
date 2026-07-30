"use client";
// Admin → Creator applications. Lists every row in the `influencers` table,
// joined with users.phone/name/email so the admin can see who applied
// without bouncing through another lookup. Approve / block / reactivate
// actions hit /api/admin/creators (PATCH).
import { useEffect, useMemo, useState } from "react";
import DataTable from "@/components/admin/data-table";
import KpiCard from "@/components/admin/kpi-card";

const STATUS_COLORS: Record<string, string> = {
  pending: "#c6d0da",
  active: "#2ECC71",
  blocked: "#FF4757",
};

export default function AdminCreators() {
  const [creators, setCreators] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // v126 — default "all" so admin immediately sees every creator application.
  // Previously "pending" → showed 0 even when 3 active creators existed.
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    setLoading(true);
    setErr("");
    const q = new URLSearchParams({ status: statusFilter, search });
    fetch(`/api/admin/creators?${q.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setErr(String(d.error));
        setCreators(d?.creators || []);
      })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  async function patchCreator(id: string, body: Record<string, unknown>, msg: string) {
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/creators", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      setSelected(null);
      load();
    } catch (e: any) {
      alert(e?.message || "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: "id",
      label: "Application",
      render: (c: any) => (
        <div>
          <div style={{ fontFamily: "monospace", color: "#8A8FA8", fontSize: 11 }}>{String(c.id || "").slice(0, 8)}</div>
          <div style={{ color: "#E8EAF0", fontSize: 13 }}>{c.users?.name || "—"}</div>
        </div>
      ),
    },
    {
      key: "phone",
      label: "Contact",
      // v126.2 — Firebase Google sign-in users carry `unknown_<uid>` in the
      // phone field (placeholder because no phone was collected at signup).
      // Showing that raw string was misleading admin — they thought the
      // creator's phone was hidden. Now we surface a meaningful display:
      // real phone if present, else email + a Firebase chip + the UID.
      render: (c: any) => {
        const phone = c.users?.phone || "";
        const email = c.users?.email || "";
        const isUnknownPhone = /^(unknown_|firebase_|fb_)/i.test(phone);
        const realPhone = !isUnknownPhone && phone ? phone : null;
        // Strip the unknown_ prefix to expose the underlying Firebase UID
        const uid = isUnknownPhone ? phone.replace(/^unknown_(fb_)?/i, "") : null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {realPhone ? (
              <a href={`tel:${realPhone}`} style={{ color: "#E8EAF0", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                📞 {realPhone}
              </a>
            ) : email ? (
              <a href={`mailto:${email}`} style={{ color: "#E8EAF0", fontSize: 11.5, fontWeight: 600, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                ✉️ {email}
              </a>
            ) : (
              <span style={{ fontSize: 10, color: "#8A8FA8", fontStyle: "italic" }}>No contact on file</span>
            )}
            {isUnknownPhone && (
              <span style={{
                fontSize: 9, color: "#A855F7", letterSpacing: "0.08em",
                background: "rgba(168,85,247,0.12)", padding: "1px 6px",
                borderRadius: 999, alignSelf: "flex-start", fontWeight: 700,
              }} title={`Firebase UID: ${uid}`}>
                G sign-in · UID {uid?.slice(0, 6)}…
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "location",
      label: "City",
      render: (c: any) => c.location || <span style={{ color: "#8A8FA8" }}>—</span>,
    },
    {
      key: "total_followers",
      label: "Followers",
      render: (c: any) => Number(c.total_followers || 0).toLocaleString("en-IN"),
    },
    {
      key: "kyc",
      label: "KYC",
      render: (c: any) => {
        const a = !!c.aadhaar_verified;
        const p = !!c.pan_verified;
        return (
          <div style={{ display: "flex", gap: 4 }}>
            <Badge label="Aadhaar" on={a} />
            <Badge label="PAN" on={p} />
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      render: (c: any) => {
        const s = String(c.status || "pending").toLowerCase();
        const color = STATUS_COLORS[s] || "#8A8FA8";
        return (
          <span
            style={{
              background: color + "22",
              color,
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {s}
          </span>
        );
      },
    },
    {
      key: "created_at",
      label: "Submitted",
      render: (c: any) =>
        c.created_at
          ? new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
          : "—",
    },
    {
      key: "actions",
      label: "",
      render: (c: any) => (
        <button onClick={() => setSelected(c)} style={btnPrimary}>
          Review
        </button>
      ),
    },
  ];

  // v103 — KPI strip from current list (mind the filter — these are scoped to current view)
  const stats = useMemo(() => {
    const total    = creators.length;
    const pending  = creators.filter((c: any) => c.status === "pending").length;
    const active   = creators.filter((c: any) => c.status === "active").length;
    const blocked  = creators.filter((c: any) => c.status === "blocked").length;
    const verified = creators.filter((c: any) => c.aadhaar_verified && c.pan_verified).length;
    return { total, pending, active, blocked, verified };
  }, [creators]);

  return (
    <div style={{ fontFamily: "DM Sans, sans-serif" }}>
      <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", fontSize: 28, margin: "0 0 6px" }}>
        Creator Applications
      </h1>
      <p style={{ color: "#8A8FA8", fontSize: 13, margin: "0 0 20px" }}>
        Approve, block, or re-activate creator applications submitted via /upgrade.
      </p>

      <div className="admin-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 22 }}>
        <KpiCard title="In View"      value={stats.total}    icon="✨" color="#9fb1c2" live sub="current filter" onClick={() => setStatusFilter("all")} />
        <KpiCard title="Pending"      value={stats.pending}  icon="⏳" color="#c6d0da" live onClick={() => setStatusFilter("pending")} />
        <KpiCard title="Active"       value={stats.active}   icon="✅" color="#2ECC71" live onClick={() => setStatusFilter("active")} />
        <KpiCard title="Blocked"      value={stats.blocked}  icon="🚫" color="#FF4757" live onClick={() => setStatusFilter("blocked")} />
        <KpiCard title="KYC Verified" value={stats.verified} icon="🛡️" color="#A855F7" live sub="Aadhaar + PAN" onClick={() => (typeof window !== "undefined" && (window.location.href = "/admin/commission-rules"))} />
      </div>

      <div className="admin-filters" style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          placeholder="Search name, phone, bio…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          style={inputStyle}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </select>
        <button onClick={load} style={btnSecondary}>Search</button>
        <span style={{ marginLeft: "auto", color: "#8A8FA8", alignSelf: "center", fontSize: 13 }}>
          Total: {creators.length}
        </span>
      </div>

      {err && (
        <div style={{ color: "#FF4757", background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.3)", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 16 }}>
          {err}
        </div>
      )}

      <DataTable columns={columns} data={creators} loading={loading} pageSize={15} />

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <h2 style={{ fontFamily: "Syne, sans-serif", color: "#E8EAF0", margin: "0 0 6px" }}>
            {selected.users?.name || "Unnamed creator"}
          </h2>
          <p style={{ color: "#8A8FA8", fontSize: 12, margin: "0 0 16px" }}>
            Application id <code>{String(selected.id || "").slice(0, 12)}…</code>
          </p>

          <Field
            label="Phone"
            value={(() => {
              const ph = selected.users?.phone || "";
              if (/^(unknown_|firebase_|fb_)/i.test(ph)) {
                const uid = ph.replace(/^unknown_(fb_)?/i, "");
                return `Not provided · Firebase Google sign-in (UID ${uid.slice(0, 12)}…)`;
              }
              return ph || "—";
            })()}
          />
          <Field label="Email" value={selected.users?.email || "—"} />
          <Field label="User ID" value={String(selected.user_id || "—")} />
          <Field label="City" value={selected.location || "—"} />
          <Field label="Followers" value={Number(selected.total_followers || 0).toLocaleString("en-IN")} />
          <Field label="Tier" value={String(selected.verification_tier ?? 1)} />
          <Field label="Bank" value={selected.bank_name || "—"} />
          <Field label="A/C" value={selected.bank_account_number ? `••••${String(selected.bank_account_number).slice(-4)}` : "—"} />
          <Field label="IFSC" value={selected.ifsc_code || "—"} />
          <Field label="Total earnings" value={`₹${Number(selected.total_earnings || 0).toLocaleString("en-IN")}`} />
          <Field label="Submitted" value={selected.created_at ? new Date(selected.created_at).toLocaleString("en-IN") : "—"} />

          {/* Phase 7 — Application source badge + auto-eval metrics. Only
              renders for cron-driven candidates (application_source !== 'form').
              Form-applicants stay visually identical to pre-Phase-7. */}
          {selected.application_source && selected.application_source !== "form" && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background:
                  selected.application_source === "auto_promote"
                    ? "rgba(46,204,113,0.08)"
                    : "rgba(240,160,48,0.08)",
                borderRadius: 10,
                border:
                  selected.application_source === "auto_promote"
                    ? "1px solid rgba(46,204,113,0.25)"
                    : "1px solid rgba(240,160,48,0.25)",
              }}
            >
              <div
                style={{
                  color:
                    selected.application_source === "auto_promote"
                      ? "#2ECC71"
                      : "#F0A030",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                  fontWeight: 700,
                }}
              >
                {selected.application_source === "auto_promote"
                  ? "🤖 Auto-promoted by cron"
                  : "⚠ Flagged by cron — admin review"}
              </div>
              {selected.auto_eval_data && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Approved posts: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{selected.auto_eval_data.posts_approved ?? "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Rejected: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{selected.auto_eval_data.posts_rejected ?? "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Total views: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{Number(selected.auto_eval_data.total_views ?? 0).toLocaleString("en-IN")}</span>
                  </div>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Followers: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{Number(selected.auto_eval_data.follower_count ?? 0).toLocaleString("en-IN")}</span>
                  </div>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Approval rate: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>
                      {selected.auto_eval_data.approval_rate != null
                        ? `${Math.round(selected.auto_eval_data.approval_rate * 100)}%`
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: "#8A8FA8" }}>Window: </span>
                    <span style={{ color: "#E8EAF0", fontWeight: 600 }}>{selected.auto_eval_data.eval_window_days ?? "—"} days</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Bio</div>
            <div style={{ color: "#E8EAF0", fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {selected.bio || <span style={{ color: "#8A8FA8" }}>No bio provided</span>}
            </div>
          </div>

          <div style={{ marginTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14 }}>
            <div style={{ color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>KYC Verification</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={busy}
                onClick={() => patchCreator(selected.id, { aadhaar_verified: !selected.aadhaar_verified }, `Mark Aadhaar ${selected.aadhaar_verified ? "UN" : ""}verified?`)}
                style={selected.aadhaar_verified ? btnGreen : btnGrey}
              >
                {selected.aadhaar_verified ? "✓ Aadhaar verified" : "Mark Aadhaar verified"}
              </button>
              <button
                disabled={busy}
                onClick={() => patchCreator(selected.id, { pan_verified: !selected.pan_verified }, `Mark PAN ${selected.pan_verified ? "UN" : ""}verified?`)}
                style={selected.pan_verified ? btnGreen : btnGrey}
              >
                {selected.pan_verified ? "✓ PAN verified" : "Mark PAN verified"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14 }}>
            <div style={{ color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Status actions</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={busy || selected.status === "active"}
                onClick={() => patchCreator(selected.id, { status: "active" }, "Approve this creator? They'll get the active badge + creator perks.")}
                style={{ ...btnGreen, opacity: selected.status === "active" ? 0.5 : 1 }}
              >
                ✓ Approve (Active)
              </button>
              <button
                disabled={busy || selected.status === "pending"}
                onClick={() => patchCreator(selected.id, { status: "pending" }, "Move back to pending review?")}
                style={{ ...btnAmber, opacity: selected.status === "pending" ? 0.5 : 1 }}
              >
                ⟲ Pending
              </button>
              <button
                disabled={busy || selected.status === "blocked"}
                onClick={() => patchCreator(selected.id, { status: "blocked" }, "Block this creator? They'll lose all creator perks until unblocked.")}
                style={{ ...btnRed, opacity: selected.status === "blocked" ? 0.5 : 1 }}
              >
                🚫 Block
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Badge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 6,
        background: on ? "rgba(46,204,113,0.16)" : "rgba(138,143,168,0.12)",
        color: on ? "#2ECC71" : "#8A8FA8",
      }}
    >
      {on ? "✓" : "·"} {label}
    </span>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", gap: 12 }}>
      <span style={{ color: "#8A8FA8", fontSize: 12 }}>{label}</span>
      <span style={{ color: "#E8EAF0", fontSize: 13, fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#151820",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16, padding: 24,
          width: "100%", maxWidth: 540, maxHeight: "92vh", overflow: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#151820",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 10, padding: "10px 14px",
  color: "#E8EAF0", fontSize: 14, outline: "none",
  fontFamily: "DM Sans, sans-serif", minWidth: 220,
};
const selectStyle: React.CSSProperties = { ...inputStyle, minWidth: 140 };
const btnPrimary: React.CSSProperties = {
  background: "rgba(140, 160, 182,0.1)",
  color: "#9fb1c2",
  border: "1px solid rgba(140, 160, 182,0.3)",
  padding: "5px 12px",
  borderRadius: 8, cursor: "pointer",
  fontSize: 12, fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  background: "rgba(140, 160, 182,0.18)",
  color: "#9fb1c2",
  border: "1px solid rgba(140, 160, 182,0.4)",
  padding: "8px 16px",
  borderRadius: 10, cursor: "pointer",
  fontSize: 13, fontWeight: 600, fontFamily: "DM Sans, sans-serif",
};
const btnGreen: React.CSSProperties = {
  background: "rgba(46,204,113,0.12)",
  color: "#2ECC71",
  border: "1px solid rgba(46,204,113,0.35)",
  padding: "8px 14px", borderRadius: 10,
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const btnAmber: React.CSSProperties = {
  background: "rgba(176, 192, 209,0.12)",
  color: "#c6d0da",
  border: "1px solid rgba(176, 192, 209,0.35)",
  padding: "8px 14px", borderRadius: 10,
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const btnRed: React.CSSProperties = {
  background: "rgba(255,71,87,0.10)",
  color: "#FF4757",
  border: "1px solid rgba(255,71,87,0.35)",
  padding: "8px 14px", borderRadius: 10,
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const btnGrey: React.CSSProperties = {
  background: "rgba(138,143,168,0.10)",
  color: "#8A8FA8",
  border: "1px solid rgba(138,143,168,0.30)",
  padding: "8px 14px", borderRadius: 10,
  cursor: "pointer", fontSize: 13, fontWeight: 600,
};
