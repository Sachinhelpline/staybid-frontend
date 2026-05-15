"use client";
// /admin/redemption-rules — CRUD UI for the StayPoints redemption catalog.
// Cozy dark-luxury theme matching the rest of /admin/*. List + editor modal.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Kind = "coupon" | "wallet_credit" | "amenity" | "voucher";
type Tier = "silver" | "gold" | "platinum";

type Rule = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: Kind;
  points_cost: number;
  value_inr: number;
  min_tier: Tier;
  max_per_user_per_month: number;
  validity_days: number;
  icon: string | null;
  terms: string | null;
  display_order: number;
  active: boolean;
};

const KIND_LABEL: Record<Kind, string> = {
  coupon: "🎟️ Coupon",
  wallet_credit: "💰 Wallet Credit",
  amenity: "🏨 Hotel Amenity",
  voucher: "🎁 Voucher",
};

const TIER_COLOR: Record<Tier, string> = {
  silver: "#94a3b8",
  gold: "#D4AF37",
  platinum: "#A855F7",
};

const blankRule: Partial<Rule> = {
  slug: "",
  title: "",
  description: "",
  kind: "coupon",
  points_cost: 1000,
  value_inr: 100,
  min_tier: "silver",
  max_per_user_per_month: 5,
  validity_days: 90,
  icon: "🎟️",
  terms: "",
  display_order: 100,
  active: true,
};

export default function AdminRedemptionRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const load = () =>
    api.adminGetRedemptionRules().then((d: any) => {
      setRules(d?.rules || []);
    }).finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const filtered = rules.filter((r) =>
    filter === "all" ? true : filter === "active" ? r.active : !r.active,
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.adminUpsertRedemptionRule(editing);
      if (res?.ok) {
        await load();
        setEditing(null);
        showToast(editing.id ? "Rule updated" : "Rule created");
      } else {
        setError(res?.error || "Failed to save");
      }
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this rule? Customers will no longer see it.")) return;
    setBusy(true);
    await api.adminDeleteRedemptionRule(id);
    await load();
    showToast("Rule deactivated");
    setBusy(false);
  }

  const KPI = {
    total: rules.length,
    active: rules.filter((r) => r.active).length,
    coupons: rules.filter((r) => r.kind === "coupon" && r.active).length,
    wallet: rules.filter((r) => r.kind === "wallet_credit" && r.active).length,
    amenities: rules.filter((r) => r.kind === "amenity" && r.active).length,
  };

  return (
    <div style={{ padding: 0, fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <h1 className="admin-h1" style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 22, color: "#E8EAF0", margin: 0 }}>
          🎁 Redemption Rules
        </h1>
        <button
          onClick={() => setEditing({ ...blankRule })}
          style={{
            background: "linear-gradient(135deg,#D4AF37,#F0D060)",
            color: "#1a1205",
            border: "none",
            padding: "9px 16px",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}>
          + New Rule
        </button>
      </div>

      <div className="admin-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Total Rules", KPI.total, "#D4AF37"],
          ["Active", KPI.active, "#2ECC71"],
          ["Coupons", KPI.coupons, "#3D9CF5"],
          ["Wallet Credits", KPI.wallet, "#F0D060"],
          ["Amenities", KPI.amenities, "#A855F7"],
        ].map(([label, val, color]) => (
          <div key={String(label)} className="admin-card" style={{ background: "#151820", padding: 14, borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: 11, color: "#8A8FA8", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{label}</p>
            <p style={{ fontSize: 24, color: color as string, fontWeight: 700, marginTop: 4, marginBottom: 0, fontFamily: "Syne, sans-serif" }}>{val}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {([["active", "Active"], ["inactive", "Inactive"], ["all", "All"]] as [any, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              border: filter === k ? "1px solid #D4AF37" : "1px solid rgba(255,255,255,0.12)",
              background: filter === k ? "rgba(212,175,55,0.1)" : "#0F1117",
              color: filter === k ? "#D4AF37" : "#8A8FA8",
              cursor: "pointer",
            }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: "#8A8FA8" }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((r) => (
            <div key={r.id} className="admin-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "#151820", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg,#D4AF37,#F0D060)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                {r.icon || "🎁"}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontWeight: 700, color: "#E8EAF0", margin: 0 }}>{r.title}</p>
                <p style={{ fontSize: 11, color: "#8A8FA8", marginTop: 2, marginBottom: 0 }}>
                  <span style={{ color: TIER_COLOR[r.min_tier] }}>{r.min_tier.toUpperCase()}+</span> · {KIND_LABEL[r.kind]} · {r.points_cost.toLocaleString("en-IN")} pts
                  {r.value_inr > 0 ? ` · ₹${r.value_inr.toLocaleString("en-IN")}` : ""}
                  · max {r.max_per_user_per_month}/mo · {r.validity_days}d validity
                </p>
                {r.description && <p style={{ fontSize: 12, color: "#8A8FA8", marginTop: 6, marginBottom: 0 }}>{r.description}</p>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: r.active ? "rgba(46,204,113,0.15)" : "rgba(255,71,87,0.15)",
                  color: r.active ? "#2ECC71" : "#FF4757",
                  letterSpacing: "0.1em",
                }}>
                  {r.active ? "ACTIVE" : "INACTIVE"}
                </span>
                <button onClick={() => setEditing(r)}
                  style={{ background: "rgba(212,175,55,0.1)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.3)", padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  Edit
                </button>
                {r.active && (
                  <button onClick={() => deactivate(r.id)} disabled={busy}
                    style={{ background: "rgba(255,71,87,0.1)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.3)", padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p style={{ color: "#8A8FA8", textAlign: "center", padding: 30 }}>No rules in this filter.</p>}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }} onClick={() => !busy && setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#0F1117", borderRadius: 16, width: "100%", maxWidth: 560, padding: 22,
            border: "1px solid rgba(255,255,255,0.1)", maxHeight: "92vh", overflowY: "auto",
          }}>
            <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 18, color: "#D4AF37", marginTop: 0, marginBottom: 16 }}>
              {editing.id ? "Edit Rule" : "New Redemption Rule"}
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Slug (unique)" full>
                <input type="text" value={editing.slug || ""}
                  disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
              </Field>
              <Field label="Title" full>
                <input type="text" value={editing.title || ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>
              <Field label="Kind">
                <select value={editing.kind || "coupon"}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as Kind })}>
                  <option value="coupon">Coupon</option>
                  <option value="voucher">Voucher</option>
                  <option value="wallet_credit">Wallet Credit</option>
                  <option value="amenity">Hotel Amenity</option>
                </select>
              </Field>
              <Field label="Min Tier">
                <select value={editing.min_tier || "silver"}
                  onChange={(e) => setEditing({ ...editing, min_tier: e.target.value as Tier })}>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                </select>
              </Field>
              <Field label="Points cost">
                <input type="number" min={1} value={editing.points_cost || 0}
                  onChange={(e) => setEditing({ ...editing, points_cost: parseInt(e.target.value, 10) || 0 })} />
              </Field>
              <Field label="₹ Value (for coupon / wallet)">
                <input type="number" min={0} value={editing.value_inr || 0}
                  onChange={(e) => setEditing({ ...editing, value_inr: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Max per user / month">
                <input type="number" min={1} value={editing.max_per_user_per_month || 5}
                  onChange={(e) => setEditing({ ...editing, max_per_user_per_month: parseInt(e.target.value, 10) || 5 })} />
              </Field>
              <Field label="Validity (days)">
                <input type="number" min={1} value={editing.validity_days || 90}
                  onChange={(e) => setEditing({ ...editing, validity_days: parseInt(e.target.value, 10) || 90 })} />
              </Field>
              <Field label="Icon (emoji)">
                <input type="text" value={editing.icon || ""}
                  onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
              </Field>
              <Field label="Display order">
                <input type="number" value={editing.display_order || 100}
                  onChange={(e) => setEditing({ ...editing, display_order: parseInt(e.target.value, 10) || 100 })} />
              </Field>
              <Field label="Description" full>
                <textarea rows={2} value={editing.description || ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </Field>
              <Field label="Terms (customer-visible)" full>
                <textarea rows={3} value={editing.terms || ""}
                  onChange={(e) => setEditing({ ...editing, terms: e.target.value })} />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1/-1", color: "#E8EAF0", fontSize: 13 }}>
                <input type="checkbox" checked={editing.active !== false}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                Active (visible to customers)
              </label>
            </div>

            {error && <p style={{ color: "#FF4757", fontSize: 12, marginTop: 12 }}>{error}</p>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(null)} disabled={busy}
                style={{ background: "transparent", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.12)", padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={save} disabled={busy}
                style={{ background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#1a1205", border: "none", padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                {busy ? "Saving…" : "Save Rule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: "#0F1117", color: "#D4AF37", padding: "10px 18px", borderRadius: 999,
          fontSize: 13, fontWeight: 600, border: "1px solid rgba(212,175,55,0.3)",
          zIndex: 60, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>{toast}</div>
      )}

      <style jsx>{`
        input, select, textarea {
          width: 100%;
          background: #07080C;
          color: #E8EAF0;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          font-family: inherit;
        }
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: #D4AF37;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: any; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? "1/-1" : undefined }}>
      <label style={{ display: "block", color: "#8A8FA8", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}
