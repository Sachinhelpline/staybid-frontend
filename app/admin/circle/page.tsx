"use client";

// /admin/circle — StayCircle™ (Community Partner) oversight + catalog CRUD.
// Dark-luxury inline styles (matches /admin/host). Auth via x-admin-token.
// KPI strip + 5 tabs: Properties (CRUD) · Room Types (CRUD) · Bundles
// (cancel/complete only — 'active' is owned by the payment verify chain) ·
// Payouts (post monthly returns) · Locks (read-only).

import { useEffect, useMemo, useState } from "react";
import { CountUp } from "@/components/CountUp";
import { fmtINR } from "@/lib/circle/engine";

const C = {
  bg: "#07080C", card: "#151820", border: "rgba(255,255,255,0.07)",
  text: "#E8EAF0", sub: "#8A8FA8", gold: "#D4AF37", green: "#2ECC71",
  red: "#FF4757", blue: "#3D9CF5", purple: "#A855F7",
};

type Tab = "properties" | "room_types" | "bundles" | "payouts" | "locks";

function adminHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const tok = localStorage.getItem("sb_admin_token") || "";
  let id = "";
  try { id = JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch { /* noop */ }
  return { "x-admin-token": tok, "x-admin-id": id };
}

const box: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16,
};
const inputS: React.CSSProperties = {
  background: "#0F1117", border: `1px solid ${C.border}`, borderRadius: 10,
  color: C.text, padding: "9px 12px", fontSize: 13, width: "100%",
};
const btnS = (bg: string, fg = "#07080C"): React.CSSProperties => ({
  background: bg, color: fg, border: "none", borderRadius: 10,
  padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
});

export default function AdminCirclePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("properties");
  const [busy, setBusy] = useState("");
  const [editor, setEditor] = useState<{ entity: "property" | "room_type" | "payout"; row: any | null } | null>(null);

  const load = () => {
    setLoading(true); setErr("");
    fetch("/api/admin/circle", { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d?.error) setErr(String(d.error)); else setData(d); })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const kpis = data?.kpis || {};
  const properties: any[] = data?.properties || [];
  const roomTypes: any[] = data?.roomTypes || [];
  const bundles: any[] = data?.bundles || [];
  const payouts: any[] = data?.payouts || [];
  const locks: any[] = data?.locks || [];
  const propTitle = useMemo(
    () => Object.fromEntries(properties.map((p: any) => [String(p.id), p.title])),
    [properties],
  );

  const mutate = async (method: string, body?: any, qs?: string) => {
    setBusy("x");
    try {
      const r = await fetch(`/api/admin/circle${qs || ""}`, {
        method,
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.error) alert(d?.error || "Failed");
      else load();
    } finally { setBusy(""); }
  };

  return (
    <div style={{ color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>◎ StayCircle — Community Partner</h1>
          <p style={{ color: C.sub, fontSize: 12.5 }}>Investment properties · bundles · payouts · live oversight</p>
        </div>
        <button style={btnS(C.gold)} onClick={load}>↻ Refresh</button>
      </div>

      {err && <div style={{ ...box, borderColor: C.red, color: C.red, marginBottom: 14 }}>⚠ {err}</div>}

      {/* KPI strip */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 18 }}>
        {[
          ["Properties", kpis.properties || 0, C.gold, ""],
          ["Active Locks", kpis.locks || 0, C.blue, ""],
          ["Bundles", kpis.bundles || 0, C.purple, ""],
          ["Active Bundles", kpis.activeBundles || 0, C.green, ""],
          ["Monthly GMV", kpis.monthlyGmv || 0, C.gold, "₹"],
          ["Collected", kpis.collected || 0, C.green, "₹"],
          ["Paid Out", kpis.paidOut || 0, C.red, "₹"],
        ].map(([label, val, color, prefix]) => (
          <div key={label as string} style={box}>
            <div style={{ fontSize: 20, fontWeight: 800, color: color as string }}>
              <CountUp value={Number(val)} prefix={prefix as string} />
            </div>
            <div style={{ fontSize: 11, color: C.sub, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {([
          ["properties", `🏔 Properties (${properties.length})`],
          ["room_types", `🛏 Room Types (${roomTypes.length})`],
          ["bundles", `🧺 Bundles (${bundles.length})`],
          ["payouts", `💸 Payouts (${payouts.length})`],
          ["locks", `🔒 Locks (${locks.length})`],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            ...btnS(tab === k ? C.gold : "#0F1117", tab === k ? "#07080C" : C.sub),
            border: `1px solid ${tab === k ? C.gold : C.border}`,
          }}>{label}</button>
        ))}
        {(tab === "properties" || tab === "room_types" || tab === "payouts") && (
          <button
            style={{ ...btnS(C.green), marginLeft: "auto" }}
            onClick={() => setEditor({ entity: tab === "properties" ? "property" : tab === "room_types" ? "room_type" : "payout", row: null })}
          >＋ Add</button>
        )}
      </div>

      {loading ? (
        <div style={{ ...box, textAlign: "center", color: C.sub, padding: 40 }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {tab === "properties" && properties.map((p: any) => (
            <div key={p.id} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{p.title} <span style={{ color: C.sub, fontWeight: 400 }}>· {p.city}</span></div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                  {fmtINR(p.monthly_rate)}/mo · ROI {p.roi_min_pct}–{p.roi_max_pct}% · {p.operation_model} ·{" "}
                  <span style={{ color: p.status === "active" ? C.green : p.status === "sold_out" ? C.red : C.sub }}>{p.status}</span>
                  {p.hotel_id && <span> · 🏨 linked: {p.hotel_id}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={p.status}
                  onChange={(e) => mutate("PATCH", { entity: "property", id: p.id, data: { status: e.target.value } })}
                  style={{ ...inputS, width: "auto" }}
                  disabled={!!busy}
                >
                  {["active", "inactive", "sold_out", "coming_soon"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button style={btnS(C.blue)} onClick={() => setEditor({ entity: "property", row: p })}>✎ Edit</button>
                <button style={btnS(C.red, "#fff")} disabled={!!busy} onClick={() => {
                  if (confirm(`Delete "${p.title}" + its room types?`)) mutate("DELETE", undefined, `?entity=property&id=${p.id}`);
                }}>🗑</button>
              </div>
            </div>
          ))}

          {tab === "room_types" && roomTypes.map((rt: any) => (
            <div key={rt.id} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{rt.name} <span style={{ color: C.sub, fontWeight: 400 }}>· {propTitle[String(rt.property_id)] || rt.property_id}</span></div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                  {fmtINR(rt.monthly_rate)}/mo · {rt.locked_units}/{rt.total_units} locked · {rt.active ? "active" : "inactive"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button style={btnS(C.blue)} onClick={() => setEditor({ entity: "room_type", row: rt })}>✎ Edit</button>
                <button style={btnS(rt.active ? "#0F1117" : C.green, rt.active ? C.sub : "#07080C")} disabled={!!busy}
                  onClick={() => mutate("PATCH", { entity: "room_type", id: rt.id, data: { active: !rt.active } })}>
                  {rt.active ? "⏸ Deactivate" : "▶ Activate"}
                </button>
              </div>
            </div>
          ))}

          {tab === "bundles" && bundles.map((b: any) => (
            <div key={b.id} style={{ ...box }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    <span style={{
                      fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 999, marginRight: 8,
                      background: b.status === "active" ? "rgba(46,204,113,.15)" : b.status === "pending_payment" ? "rgba(212,175,55,.15)" : "rgba(255,71,87,.12)",
                      color: b.status === "active" ? C.green : b.status === "pending_payment" ? C.gold : C.red,
                    }}>{String(b.status).toUpperCase()}</span>
                    {b.user?.name || b.contact?.name || "Partner"} <span style={{ color: C.sub, fontWeight: 400 }}>· {b.user?.phone || b.contact?.phone || ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
                    {(Array.isArray(b.items) ? b.items : []).map((it: any) => `${it.propertyTitle} · ${it.roomTypeName} ×${it.rooms}`).join("  +  ")}
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
                    {fmtINR(b.monthly_total)}/mo · paid {fmtINR(b.pay_now)} ({b.payment_plan}) · ROI {b.expected_roi_min}–{b.expected_roi_max}% · {new Date(b.created_at).toLocaleString("en-IN")}
                  </div>
                </div>
                {(b.status === "active" || b.status === "pending_payment") && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {b.status === "active" && (
                      <button style={btnS(C.blue)} disabled={!!busy} onClick={() => mutate("PATCH", { entity: "bundle", id: b.id, data: { status: "completed" } })}>✓ Complete</button>
                    )}
                    <button style={btnS(C.red, "#fff")} disabled={!!busy} onClick={() => {
                      if (confirm("Cancel this bundle?")) mutate("PATCH", { entity: "bundle", id: b.id, data: { status: "cancelled" } });
                    }}>✕ Cancel</button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {tab === "payouts" && payouts.map((p: any) => (
            <div key={p.id} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{p.month_label} <span style={{ color: C.sub, fontWeight: 400 }}>· bundle {String(p.bundle_id).slice(-6)}</span></div>
                <div style={{ fontSize: 12, color: C.sub }}>{p.note || ""} · {new Date(p.created_at).toLocaleDateString("en-IN")}</div>
              </div>
              <b style={{ color: p.status === "paid" ? C.green : C.gold }}>+{fmtINR(p.amount)} · {p.status}</b>
            </div>
          ))}

          {tab === "locks" && locks.map((l: any) => (
            <div key={l.id} style={{ ...box, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{l.user?.name || l.user_id} <span style={{ color: C.sub, fontWeight: 400 }}>· {l.user?.phone || ""}</span></div>
                <div style={{ fontSize: 12, color: C.sub }}>{propTitle[String(l.property_id)] || l.property_id} · {l.status} · {new Date(l.created_at).toLocaleString("en-IN")}</div>
              </div>
            </div>
          ))}

          {((tab === "properties" && !properties.length) ||
            (tab === "room_types" && !roomTypes.length) ||
            (tab === "bundles" && !bundles.length) ||
            (tab === "payouts" && !payouts.length) ||
            (tab === "locks" && !locks.length)) && (
            <div style={{ ...box, textAlign: "center", color: C.sub, padding: 34 }}>No rows yet.</div>
          )}
        </div>
      )}

      {editor && (
        <EditorModal
          entity={editor.entity}
          row={editor.row}
          properties={properties}
          bundles={bundles}
          onClose={() => setEditor(null)}
          onSave={(payload) => {
            if (editor.row?.id) mutate("PATCH", { entity: editor.entity, id: editor.row.id, data: payload });
            else mutate("POST", { entity: editor.entity, data: payload });
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function EditorModal({
  entity, row, properties, bundles, onClose, onSave,
}: {
  entity: "property" | "room_type" | "payout";
  row: any | null;
  properties: any[];
  bundles: any[];
  onClose: () => void;
  onSave: (payload: Record<string, any>) => void;
}) {
  const [form, setForm] = useState<Record<string, any>>(() => {
    if (row) return { ...row };
    if (entity === "property") return { title: "", city: "", state: "", location_label: "", tagline: "", monthly_rate: 25000, roi_min_pct: 14, roi_max_pct: 17, occupancy_label: "High Occupancy", operation_model: "managed", status: "active", sort_order: 100, images: [], badges: [], video_url: "", rooms_label: "", hotel_id: "" };
    if (entity === "room_type") return { property_id: properties[0]?.id || "", name: "Standard Room", monthly_rate: 20000, total_units: 2, locked_units: 0, active: true, sort_order: 100 };
    return { bundle_id: bundles[0]?.id || "", user_id: bundles[0]?.user_id || "", month_label: "", amount: 0, note: "", status: "paid" };
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.sub }}>
      {label}
      {children}
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ ...box, width: "100%", maxWidth: 560, maxHeight: "88dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <b style={{ color: C.text }}>{row ? "Edit" : "Add"} {entity.replace("_", " ")}</b>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {entity === "property" && (
            <>
              <F label="Title"><input style={inputS} value={form.title || ""} onChange={(e) => set("title", e.target.value)} /></F>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <F label="City"><input style={inputS} value={form.city || ""} onChange={(e) => set("city", e.target.value)} /></F>
                <F label="State"><input style={inputS} value={form.state || ""} onChange={(e) => set("state", e.target.value)} /></F>
              </div>
              <F label="Location label"><input style={inputS} value={form.location_label || ""} onChange={(e) => set("location_label", e.target.value)} /></F>
              <F label="Tagline"><input style={inputS} value={form.tagline || ""} onChange={(e) => set("tagline", e.target.value)} /></F>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
                <F label="₹ / room / month"><input type="number" style={inputS} value={form.monthly_rate ?? 0} onChange={(e) => set("monthly_rate", Number(e.target.value))} /></F>
                <F label="ROI min %"><input type="number" style={inputS} value={form.roi_min_pct ?? 0} onChange={(e) => set("roi_min_pct", Number(e.target.value))} /></F>
                <F label="ROI max %"><input type="number" style={inputS} value={form.roi_max_pct ?? 0} onChange={(e) => set("roi_max_pct", Number(e.target.value))} /></F>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <F label="Occupancy label"><input style={inputS} value={form.occupancy_label || ""} onChange={(e) => set("occupancy_label", e.target.value)} /></F>
                <F label="Rooms label (e.g. 2 Rooms · Mountain View)"><input style={inputS} value={form.rooms_label || ""} onChange={(e) => set("rooms_label", e.target.value)} /></F>
              </div>
              <F label="Images (one URL per line)">
                <textarea style={{ ...inputS, minHeight: 74 }} value={(Array.isArray(form.images) ? form.images : []).join("\n")}
                  onChange={(e) => set("images", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
              </F>
              <F label="Reel video URL"><input style={inputS} value={form.video_url || ""} onChange={(e) => set("video_url", e.target.value)} /></F>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <F label="Operation model">
                  <select style={inputS} value={form.operation_model || "managed"} onChange={(e) => set("operation_model", e.target.value)}>
                    {["managed", "revenue_share", "lease", "franchise"].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </F>
                <F label="Linked hotel id (live partner fetch — optional)"><input style={inputS} value={form.hotel_id || ""} onChange={(e) => set("hotel_id", e.target.value)} /></F>
              </div>
            </>
          )}

          {entity === "room_type" && (
            <>
              <F label="Property">
                <select style={inputS} value={form.property_id || ""} onChange={(e) => set("property_id", e.target.value)}>
                  {properties.map((p: any) => <option key={p.id} value={p.id}>{p.title} · {p.city}</option>)}
                </select>
              </F>
              <F label="Name"><input style={inputS} value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></F>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
                <F label="₹ / month"><input type="number" style={inputS} value={form.monthly_rate ?? 0} onChange={(e) => set("monthly_rate", Number(e.target.value))} /></F>
                <F label="Total units"><input type="number" style={inputS} value={form.total_units ?? 0} onChange={(e) => set("total_units", Number(e.target.value))} /></F>
                <F label="Locked units"><input type="number" style={inputS} value={form.locked_units ?? 0} onChange={(e) => set("locked_units", Number(e.target.value))} /></F>
              </div>
            </>
          )}

          {entity === "payout" && (
            <>
              <F label="Bundle">
                <select style={inputS} value={form.bundle_id || ""} onChange={(e) => {
                  const b = bundles.find((x: any) => String(x.id) === e.target.value);
                  set("bundle_id", e.target.value);
                  if (b?.user_id) set("user_id", b.user_id);
                }}>
                  {bundles.filter((b: any) => b.status === "active" || b.status === "completed").map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {(b.user?.name || b.contact?.name || "Partner")} · {fmtINR(b.monthly_total)}/mo · {String(b.id).slice(-6)}
                    </option>
                  ))}
                </select>
              </F>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <F label="Month label (e.g. Jul 2026)"><input style={inputS} value={form.month_label || ""} onChange={(e) => set("month_label", e.target.value)} /></F>
                <F label="Amount ₹"><input type="number" style={inputS} value={form.amount ?? 0} onChange={(e) => set("amount", Number(e.target.value))} /></F>
              </div>
              <F label="Note"><input style={inputS} value={form.note || ""} onChange={(e) => set("note", e.target.value)} /></F>
              <F label="Status">
                <select style={inputS} value={form.status || "paid"} onChange={(e) => set("status", e.target.value)}>
                  <option value="paid">paid</option><option value="pending">pending</option>
                </select>
              </F>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button style={btnS("#0F1117", C.sub)} onClick={onClose}>Cancel</button>
          <button style={btnS(C.gold)} onClick={() => {
            const { id, created_at, updated_at, user, ...payload } = form;
            void id; void created_at; void updated_at; void user;
            onSave(payload);
          }}>💾 Save</button>
        </div>
      </div>
    </div>
  );
}
