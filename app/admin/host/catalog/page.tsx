"use client";
// v282 — Gap 1: Admin catalog manager for the StayBid for Hosts vertical.
// Full add / edit / remove for Store Products, Store Categories, and Smart
// Property Discovery listings. Dark-luxury inline styles (matches /admin/host).
// Auth via x-admin-token. Backed by /api/admin/host/store + /listings.

import { useEffect, useMemo, useState } from "react";

type Section = "products" | "categories" | "listings" | "workers";

const inr = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);

// ── field spec: config-driven form so all three editors share one modal ────
type FieldType = "text" | "num" | "bool" | "select" | "textarea" | "list" | "kv";
type Field = { key: string; label: string; type: FieldType; opts?: { value: string; label: string }[]; ph?: string; half?: boolean };

const CATEGORY_FIELDS: Field[] = [
  { key: "name", label: "Name *", type: "text", half: true },
  { key: "slug", label: "Slug", type: "text", half: true, ph: "e.g. furniture" },
  { key: "icon", label: "Icon (emoji)", type: "text", half: true, ph: "🛋️" },
  { key: "kind", label: "Kind", type: "text", half: true, ph: "furniture" },
  { key: "sort_order", label: "Sort order", type: "num", half: true },
  { key: "active", label: "Active", type: "bool", half: true },
];

const LISTING_STATUSES = ["available", "pending_review", "shortlisted", "rented", "rejected", "inactive"];

const LISTING_FIELDS: Field[] = [
  { key: "title", label: "Title *", type: "text" },
  { key: "city", label: "City", type: "text", half: true },
  { key: "locality", label: "Locality", type: "text", half: true },
  { key: "state", label: "State", type: "text", half: true },
  { key: "property_type", label: "Property type", type: "text", half: true, ph: "villa / apartment …" },
  { key: "bhk", label: "BHK", type: "text", half: true, ph: "2BHK" },
  { key: "furnishing", label: "Furnishing", type: "text", half: true, ph: "furnished / semi …" },
  { key: "area_sqft", label: "Area (sqft)", type: "num", half: true },
  { key: "rent_monthly", label: "Rent / month ₹", type: "num", half: true },
  { key: "deposit", label: "Deposit ₹", type: "num", half: true },
  { key: "score", label: "Score", type: "num", half: true },
  { key: "status", label: "Status", type: "select", opts: LISTING_STATUSES.map((s) => ({ value: s, label: s })), half: true },
  { key: "featured", label: "Featured", type: "bool", half: true },
  { key: "lat", label: "Lat", type: "num", half: true },
  { key: "lng", label: "Lng", type: "num", half: true },
  { key: "images", label: "Image URLs (one per line)", type: "list" },
  { key: "amenities", label: "Amenities (one per line)", type: "list" },
];

const WORKER_SKILLS = [
  "housekeeping", "cook", "chef", "front_desk", "manager", "security",
  "maintenance", "gardener", "driver", "spa", "waiter", "cleaner", "other",
];
const WORKER_STATUSES = ["pending", "approved", "rejected", "suspended"];

const WORKER_FIELDS: Field[] = [
  { key: "name", label: "Name *", type: "text", half: true },
  { key: "phone", label: "Phone", type: "text", half: true, ph: "10-digit mobile" },
  { key: "email", label: "Email", type: "text", half: true },
  { key: "skill", label: "Skill", type: "select", opts: WORKER_SKILLS.map((s) => ({ value: s, label: s })), half: true },
  { key: "status", label: "Status", type: "select", opts: WORKER_STATUSES.map((s) => ({ value: s, label: s })), half: true },
  { key: "city", label: "City", type: "text", half: true },
  { key: "locality", label: "Locality", type: "text", half: true },
  { key: "rate", label: "Rate ₹", type: "num", half: true },
  { key: "rate_unit", label: "Rate unit", type: "select", opts: [{ value: "job", label: "per job" }, { value: "hour", label: "per hour" }, { value: "day", label: "per day" }, { value: "month", label: "per month" }], half: true },
  { key: "rating", label: "Rating (0-5)", type: "num", half: true },
  { key: "jobs_done", label: "Jobs done", type: "num", half: true },
  { key: "verified", label: "Verified", type: "bool", half: true },
  { key: "background_checked", label: "Background checked", type: "bool", half: true },
  { key: "available", label: "Available", type: "bool", half: true },
  { key: "active", label: "Active", type: "bool", half: true },
  { key: "avatar_url", label: "Avatar URL", type: "text" },
  { key: "bio", label: "About", type: "textarea" },
  { key: "languages", label: "Languages (one per line)", type: "list" },
];

export default function AdminHostCatalog() {
  const [section, setSection] = useState<Section>("products");
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [editor, setEditor] = useState<{ entity: Section; row: any } | null>(null);

  const headers = () => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    const id = typeof window !== "undefined" ? (() => { try { return JSON.parse(localStorage.getItem("sb_admin_user") || "null")?.id || ""; } catch { return ""; } })() : "";
    return { "Content-Type": "application/json", "x-admin-token": tok, "x-admin-id": id };
  };

  const load = () => {
    setLoading(true); setErr("");
    Promise.all([
      fetch("/api/admin/host/store", { headers: headers() }).then((r) => r.json()),
      fetch("/api/admin/host/listings", { headers: headers() }).then((r) => r.json()),
      fetch("/api/admin/host/workers", { headers: headers() }).then((r) => r.json()),
    ])
      .then(([store, list, wk]) => {
        if (store?.error) throw new Error(store.error);
        if (list?.error) throw new Error(list.error);
        if (wk?.error) throw new Error(wk.error);
        setProducts(store.products || []);
        setCategories(store.categories || []);
        setListings(list.listings || []);
        setWorkers(wk.workers || []);
      })
      .catch((e) => setErr(e?.message || "Failed to load catalog"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const catName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  const PRODUCT_FIELDS: Field[] = useMemo(() => [
    { key: "name", label: "Name *", type: "text" },
    { key: "category_id", label: "Category", type: "select", opts: [{ value: "", label: "— none —" }, ...categories.map((c) => ({ value: c.id, label: c.name }))], half: true },
    { key: "brand", label: "Brand", type: "text", half: true },
    { key: "buy_price", label: "Buy price ₹", type: "num", half: true },
    { key: "rent_monthly", label: "Rent / month ₹", type: "num", half: true },
    { key: "emi_available", label: "EMI available", type: "bool", half: true },
    { key: "emi_min_months", label: "EMI min months", type: "num", half: true },
    { key: "rating", label: "Rating (0-5)", type: "num", half: true },
    { key: "in_stock", label: "In stock", type: "bool", half: true },
    { key: "featured", label: "Featured", type: "bool", half: true },
    { key: "active", label: "Active", type: "bool", half: true },
    { key: "description", label: "Description", type: "textarea" },
    { key: "images", label: "Image URLs (one per line)", type: "list" },
    { key: "badges", label: "Badges (one per line)", type: "list" },
    { key: "specs", label: "Specs (key: value per line)", type: "kv" },
  ], [categories]);

  const fieldsFor = (entity: Section): Field[] =>
    entity === "product" as any || entity === "products" ? PRODUCT_FIELDS
    : entity === "categories" ? CATEGORY_FIELDS
    : entity === "workers" ? WORKER_FIELDS
    : LISTING_FIELDS;

  const remove = async (entity: Section, id: string, label: string) => {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setBusy(id);
    try {
      const url = entity === "listings"
        ? `/api/admin/host/listings?id=${encodeURIComponent(id)}`
        : entity === "workers"
        ? `/api/admin/host/workers?id=${encodeURIComponent(id)}`
        : `/api/admin/host/store?entity=${entity === "categories" ? "category" : "product"}&id=${encodeURIComponent(id)}`;
      const r = await fetch(url, { method: "DELETE", headers: headers() });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Delete failed");
      load();
    } catch (e: any) { setErr(e?.message || "Delete failed"); }
    finally { setBusy(""); }
  };

  const toggle = async (entity: Section, row: any, key: string) => {
    setBusy(row.id);
    try {
      const body: any = { id: row.id, [key]: !row[key] };
      const url = entity === "listings" ? "/api/admin/host/listings"
        : entity === "workers" ? "/api/admin/host/workers"
        : "/api/admin/host/store";
      if (entity === "products" || entity === "categories") body.entity = entity === "categories" ? "category" : "product";
      const r = await fetch(url, { method: "PATCH", headers: headers(), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      load();
    } catch (e: any) { setErr(e?.message || "Update failed"); }
    finally { setBusy(""); }
  };

  // Worker approve / reject / suspend — sets status directly.
  const setWorkerStatus = async (row: any, status: string) => {
    setBusy(row.id);
    try {
      const r = await fetch("/api/admin/host/workers", {
        method: "PATCH", headers: headers(), body: JSON.stringify({ id: row.id, status }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Update failed");
      load();
    } catch (e: any) { setErr(e?.message || "Update failed"); }
    finally { setBusy(""); }
  };

  const rows = section === "products" ? products : section === "categories" ? categories
    : section === "workers" ? workers : listings;

  return (
    <div style={{ padding: "0 4px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#E8EAF0", fontSize: 24, fontWeight: 800, margin: 0, fontFamily: "Syne, sans-serif" }}>🗂 Host Catalog Manager</h1>
          <p style={{ color: "#8A8FA8", fontSize: 13, margin: "4px 0 0" }}>Add, edit & remove Store products, categories, and property listings.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/admin/host" style={{ ...btnGhost, textDecoration: "none" }}>← Host hub</a>
          <button onClick={load} disabled={loading} style={btnPrimary}>↻ Refresh</button>
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 14 }}>{err}</div>
      )}

      {/* Section tabs + Add */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {(["products", "categories", "listings", "workers"] as Section[]).map((s) => (
          <button key={s} onClick={() => setSection(s)}
            style={{
              padding: "7px 15px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: "1px solid",
              ...(section === s
                ? { background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117", borderColor: "transparent" }
                : { background: "rgba(255,255,255,0.04)", color: "#8A8FA8", borderColor: "rgba(255,255,255,0.1)" }),
            }}>
            {s === "products" ? "🛋️ Products" : s === "categories" ? "🏷️ Categories" : s === "workers" ? "🧑‍🔧 Workers" : "🏡 Listings"} · {s === "products" ? products.length : s === "categories" ? categories.length : s === "workers" ? workers.length : listings.length}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setEditor({ entity: section, row: {} })} style={btnPrimary}>＋ Add {section === "categories" ? "category" : section === "listings" ? "listing" : section === "workers" ? "worker" : "product"}</button>
      </div>

      {/* Body */}
      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#8A8FA8" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#8A8FA8" }}>Nothing here yet — tap “Add”.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8A8FA8", textAlign: "left" }}>
                  {section === "products" && <>
                    <Th>Product</Th><Th>Category</Th><Th>Buy</Th><Th>Rent/mo</Th><Th>Flags</Th><Th>Actions</Th>
                  </>}
                  {section === "categories" && <>
                    <Th>Category</Th><Th>Slug</Th><Th>Kind</Th><Th>Sort</Th><Th>Flags</Th><Th>Actions</Th>
                  </>}
                  {section === "listings" && <>
                    <Th>Listing</Th><Th>City</Th><Th>Type</Th><Th>Rent/mo</Th><Th>Status</Th><Th>Actions</Th>
                  </>}
                  {section === "workers" && <>
                    <Th>Worker</Th><Th>Skill</Th><Th>City</Th><Th>Rate</Th><Th>Status</Th><Th>Actions</Th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    {section === "products" && <>
                      <Td><b style={{ color: "#E8EAF0" }}>{r.name}</b>{r.brand ? <span style={{ color: "#8A8FA8" }}> · {r.brand}</span> : null}</Td>
                      <Td>{catName[r.category_id] || "—"}</Td>
                      <Td>{inr(r.buy_price)}</Td>
                      <Td>{inr(r.rent_monthly)}</Td>
                      <Td><Flags row={r} keys={["active", "in_stock", "featured"]} /></Td>
                    </>}
                    {section === "categories" && <>
                      <Td><b style={{ color: "#E8EAF0" }}>{r.icon ? r.icon + " " : ""}{r.name}</b></Td>
                      <Td>{r.slug || "—"}</Td>
                      <Td>{r.kind}</Td>
                      <Td>{r.sort_order}</Td>
                      <Td><Flags row={r} keys={["active"]} /></Td>
                    </>}
                    {section === "listings" && <>
                      <Td><b style={{ color: "#E8EAF0" }}>{r.title}</b>{r.bhk ? <span style={{ color: "#8A8FA8" }}> · {r.bhk}</span> : null}</Td>
                      <Td>{r.city || "—"}</Td>
                      <Td>{r.property_type || "—"}</Td>
                      <Td>{inr(r.rent_monthly)}</Td>
                      <Td><span style={statusPill(r.status)}>{r.status}</span>{r.featured ? <span style={{ ...chip, marginLeft: 6 }}>★</span> : null}</Td>
                    </>}
                    {section === "workers" && <>
                      <Td>
                        <b style={{ color: "#E8EAF0" }}>{r.name}</b>
                        {r.verified ? <span style={{ ...chip, marginLeft: 6 }}>✓</span> : null}
                        {r.phone ? <div style={{ color: "#8A8FA8", fontSize: 11 }}>{r.phone}</div> : null}
                      </Td>
                      <Td>{r.skill || "—"}</Td>
                      <Td>{r.city || "—"}</Td>
                      <Td>{inr(r.rate)}{r.rate ? <span style={{ color: "#8A8FA8" }}>/{r.rate_unit || "job"}</span> : null}</Td>
                      <Td><span style={statusPill(r.status)}>{r.status || "—"}</span>{r.available ? <span style={{ ...chip, marginLeft: 6 }}>free</span> : null}</Td>
                    </>}
                    <Td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {section === "workers" && r.status !== "approved" && (
                          <button style={{ ...miniBtn, borderColor: "rgba(34,197,94,0.4)", color: "#7DE3A0" }} disabled={busy === r.id} onClick={() => setWorkerStatus(r, "approved")}>✓ Approve</button>
                        )}
                        {section === "workers" && r.status !== "rejected" && (
                          <button style={miniBtn} disabled={busy === r.id} onClick={() => setWorkerStatus(r, "rejected")}>✕ Reject</button>
                        )}
                        {section === "workers" && r.status !== "suspended" && (
                          <button style={miniBtn} disabled={busy === r.id} onClick={() => setWorkerStatus(r, "suspended")}>⏸ Suspend</button>
                        )}
                        <button style={miniBtn} disabled={busy === r.id} onClick={() => setEditor({ entity: section, row: r })}>✎ Edit</button>
                        {(section === "products" || section === "categories") && (
                          <button style={miniBtn} disabled={busy === r.id} onClick={() => toggle(section, r, "active")}>{r.active ? "⏸ Deactivate" : "▶ Activate"}</button>
                        )}
                        <button style={{ ...miniBtn, borderColor: "rgba(255,71,87,0.4)", color: "#FF9AA8" }} disabled={busy === r.id} onClick={() => remove(section, r.id, r.name || r.title || r.id)}>🗑 Delete</button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editor && (
        <EditorModal
          section={editor.entity}
          row={editor.row}
          fields={fieldsFor(editor.entity)}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
          headers={headers}
        />
      )}
    </div>
  );
}

// ── Editor modal ───────────────────────────────────────────────────────────
function EditorModal({ section, row, fields, onClose, onSaved, headers }: {
  section: Section; row: any; fields: Field[]; onClose: () => void; onSaved: () => void; headers: () => Record<string, string>;
}) {
  const isEdit = !!row.id;
  const [form, setForm] = useState<Record<string, any>>(() => seed(row, fields));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const body: any = {};
      for (const f of fields) {
        const v = form[f.key];
        if (f.type === "list") body[f.key] = String(v || "").split("\n").map((s) => s.trim()).filter(Boolean);
        else if (f.type === "kv") {
          const o: Record<string, string> = {};
          String(v || "").split("\n").forEach((line) => {
            const i = line.indexOf(":");
            if (i > 0) { const k = line.slice(0, i).trim(); const val = line.slice(i + 1).trim(); if (k) o[k] = val; }
          });
          body[f.key] = o;
        }
        else if (f.type === "bool") body[f.key] = !!v;
        else if (f.type === "num") body[f.key] = v === "" || v == null ? null : Number(v);
        else body[f.key] = v ?? "";
      }
      if (isEdit) body.id = row.id;

      const isStore = section === "products" || section === "categories";
      const url = isStore ? "/api/admin/host/store"
        : section === "workers" ? "/api/admin/host/workers"
        : "/api/admin/host/listings";
      if (isStore) body.entity = section === "categories" ? "category" : "product";

      const r = await fetch(url, { method: isEdit ? "PATCH" : "POST", headers: headers(), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 14px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, width: "100%", maxWidth: 560, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: "#E8EAF0", fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "Syne, sans-serif" }}>
            {isEdit ? "Edit" : "Add"} {section === "categories" ? "category" : section === "listings" ? "listing" : section === "workers" ? "worker" : "product"}
          </h3>
          <button onClick={onClose} style={{ ...btnGhost, padding: "4px 10px" }}>✕</button>
        </div>

        {err && <div style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.35)", color: "#FF9AA8", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {fields.map((f) => (
            <div key={f.key} style={{ width: f.half ? "calc(50% - 6px)" : "100%" }}>
              <label style={{ display: "block", color: "#8A8FA8", fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>{f.label}</label>
              {f.type === "bool" ? (
                <button onClick={() => set(f.key, !form[f.key])} style={{ ...inputStyle, cursor: "pointer", textAlign: "left", color: form[f.key] ? "#22C55E" : "#8A8FA8" }}>{form[f.key] ? "✓ Yes" : "✕ No"}</button>
              ) : f.type === "select" ? (
                <select value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} style={inputStyle}>
                  {(f.opts || []).map((o) => <option key={o.value} value={o.value} style={{ background: "#151820" }}>{o.label}</option>)}
                </select>
              ) : f.type === "textarea" || f.type === "list" || f.type === "kv" ? (
                <textarea value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} rows={f.type === "textarea" ? 3 : 3} style={{ ...inputStyle, resize: "vertical", fontFamily: f.type === "kv" ? "monospace" : "inherit" }} />
              ) : (
                <input value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} inputMode={f.type === "num" ? "decimal" : undefined} style={inputStyle} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : isEdit ? "Save changes" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}

function seed(row: any, fields: Field[]): Record<string, any> {
  const f: Record<string, any> = {};
  for (const fld of fields) {
    const v = row[fld.key];
    if (fld.type === "list") f[fld.key] = Array.isArray(v) ? v.join("\n") : "";
    else if (fld.type === "kv") f[fld.key] = v && typeof v === "object" ? Object.entries(v).map(([k, val]) => `${k}: ${val}`).join("\n") : "";
    else if (fld.type === "bool") f[fld.key] = v == null ? (fld.key === "active" || fld.key === "in_stock") : !!v;
    else f[fld.key] = v ?? "";
  }
  return f;
}

// ── bits ────────────────────────────────────────────────────────────────
function Th({ children }: { children: any }) { return <th style={{ padding: "11px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children }: { children: any }) { return <td style={{ padding: "11px 14px", color: "#C7CBD8", verticalAlign: "middle" }}>{children}</td>; }
function Flags({ row, keys }: { row: any; keys: string[] }) {
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
    {keys.filter((k) => row[k]).map((k) => <span key={k} style={chip}>{k === "in_stock" ? "in stock" : k === "featured" ? "★ featured" : k}</span>)}
  </div>;
}

const btnPrimary: React.CSSProperties = { padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "linear-gradient(135deg,#D4AF37,#F0D060)", color: "#0F1117" };
const btnGhost: React.CSSProperties = { padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "#E8EAF0" };
const miniBtn: React.CSSProperties = { padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "#C7CBD8" };
const chip: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.14)", color: "#7DE3A0", border: "1px solid rgba(34,197,94,0.3)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.03)", color: "#E8EAF0", fontSize: 13, outline: "none", boxSizing: "border-box" };
function statusPill(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    available: ["rgba(34,197,94,0.14)", "#7DE3A0"], pending_review: ["rgba(245,158,11,0.14)", "#F5C161"],
    shortlisted: ["rgba(61,156,245,0.14)", "#93C5FD"], rented: ["rgba(168,85,247,0.14)", "#D0A8F7"],
    rejected: ["rgba(255,71,87,0.14)", "#FF9AA8"], inactive: ["rgba(255,255,255,0.06)", "#8A8FA8"],
    approved: ["rgba(34,197,94,0.14)", "#7DE3A0"], pending: ["rgba(245,158,11,0.14)", "#F5C161"],
    suspended: ["rgba(255,255,255,0.06)", "#8A8FA8"],
  };
  const [bg, color] = map[status] || map.inactive;
  return { fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: bg, color };
}
