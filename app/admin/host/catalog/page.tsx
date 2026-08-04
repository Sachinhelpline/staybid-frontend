"use client";
// v282 — Gap 1: Admin catalog manager for the StayBid for Hosts vertical.
// Full add / edit / remove for Store Products, Store Categories, and Smart
// Property Discovery listings. Dark-luxury inline styles (matches /admin/host).
// Auth via x-admin-token. Backed by /api/admin/host/store + /listings.

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
const admIco = { verticalAlign: "-2px", marginRight: 4 } as const;
import {
  PROPERTY_TYPES, PROPERTY_TYPE_MAP, ROOM_CATEGORIES, ROOM_CATEGORY_MAP,
  ROOM_CATEGORY_CAPACITY, MEAL_PLANS, ADDON_SERVICES, AMENITIES,
} from "@/lib/catalog";

type Section = "products" | "categories" | "listings" | "workers";

const inr = (n: any) => (n == null || n === "" ? "—" : `₹${Number(n).toLocaleString("en-IN")}`);

// ── field spec: config-driven form so all editors share one modal ────
// v307 — added "multiselect" (catalog chip toggles) + "rooms" (per-category
// hospitality room builder) + `group:"details"` (fields nested into the
// discovery_properties.details jsonb bag on save / read on seed).
type FieldType = "text" | "num" | "bool" | "select" | "textarea" | "list" | "kv" | "multiselect" | "rooms";
type Field = {
  key: string; label: string; type: FieldType;
  opts?: { value: string; label: string }[];
  ph?: string; half?: boolean;
  group?: "details";
  hint?: string;
};

const CATEGORY_FIELDS: Field[] = [
  { key: "name", label: "Name *", type: "text", half: true },
  { key: "slug", label: "Slug", type: "text", half: true, ph: "e.g. furniture" },
  { key: "icon", label: "Icon (emoji)", type: "text", half: true, ph: "🛋️" },
  { key: "kind", label: "Kind", type: "text", half: true, ph: "furniture" },
  { key: "sort_order", label: "Sort order", type: "num", half: true },
  { key: "active", label: "Active", type: "bool", half: true },
];

const LISTING_STATUSES = ["available", "pending_review", "shortlisted", "rented", "rejected", "inactive"];
const STAR_OPTS = [
  { value: "", label: "— unrated —" }, { value: "1", label: "1★" }, { value: "2", label: "2★" },
  { value: "3", label: "3★" }, { value: "4", label: "4★" }, { value: "5", label: "5★" },
];

// v307 — hospitality listing editor. property_type, amenities, meal plans,
// add-ons, rooms + policy details mirror the customer submission form
// (/host/list-property). Residential fields (bhk/furnishing/area/rent/
// deposit) are dropped from the UI; their columns stay nullable + the API
// still accepts them for backward compat.
const LISTING_FIELDS: Field[] = [
  { key: "title", label: "Property name *", type: "text" },
  { key: "property_type", label: "Property type", type: "select", opts: [{ value: "", label: "— select —" }, ...PROPERTY_TYPES.map((p) => ({ value: p.id, label: `${p.emoji} ${p.label}` }))], half: true },
  { key: "starRating", label: "Star rating", type: "select", opts: STAR_OPTS, half: true, group: "details" },
  { key: "city", label: "City", type: "text", half: true },
  { key: "locality", label: "Locality / area", type: "text", half: true },
  { key: "state", label: "State", type: "text", half: true },
  { key: "formatted_address", label: "Full address", type: "text" },
  { key: "checkIn", label: "Check-in time", type: "text", half: true, ph: "13:00", group: "details" },
  { key: "checkOut", label: "Check-out time", type: "text", half: true, ph: "11:00", group: "details" },
  { key: "lat", label: "Latitude", type: "num", half: true },
  { key: "lng", label: "Longitude", type: "num", half: true },
  { key: "status", label: "Status", type: "select", opts: LISTING_STATUSES.map((s) => ({ value: s, label: s })), half: true },
  { key: "featured", label: "Featured", type: "bool", half: true },
  { key: "description", label: "Description", type: "textarea", group: "details" },
  { key: "houseRules", label: "House rules", type: "textarea", group: "details" },
  { key: "landmarks", label: "Nearby landmarks", type: "text", group: "details" },
  { key: "amenities", label: "Property amenities", type: "multiselect", opts: AMENITIES.map((a) => ({ value: a.id, label: `${a.emoji} ${a.label}` })) },
  { key: "mealPlans", label: "Meal plans", type: "multiselect", opts: MEAL_PLANS.map((m) => ({ value: m.id, label: `${m.label} · ${m.code}` })), group: "details" },
  { key: "addonServices", label: "Add-on services", type: "multiselect", opts: ADDON_SERVICES.map((a) => ({ value: a.id, label: `${a.emoji} ${a.label}` })), group: "details" },
  { key: "rooms", label: "Rooms & cottages", type: "rooms", hint: "Add each room / cottage category with its count, price & in-room amenities." },
  { key: "images", label: "Property photo URLs (one per line)", type: "list" },
  { key: "score", label: "Discovery score (ranking)", type: "num", half: true },
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
                ? { background: "linear-gradient(160deg,#d4dde6 0%,#b1bfd0 52%,#93a7bc 100%)", color: "#0F1117", borderColor: "transparent" }
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
                    <Th>Listing</Th><Th>City</Th><Th>Type</Th><Th>Rooms</Th><Th>Status</Th><Th>Actions</Th>
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
                      <Td><b style={{ color: "#E8EAF0" }}>{r.title}</b>{r.details?.starRating ? <span style={{ color: "#8A8FA8" }}> · {r.details.starRating}★</span> : null}</Td>
                      <Td>{r.city || "—"}</Td>
                      <Td>{r.property_type ? (PROPERTY_TYPE_MAP[r.property_type]?.label || r.property_type) : "—"}</Td>
                      <Td>{Array.isArray(r.rooms) && r.rooms.length ? `🛏 ${r.rooms.length}` : "—"}</Td>
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
                        <button style={miniBtn} disabled={busy === r.id} onClick={() => setEditor({ entity: section, row: r })}><Pencil size={12} strokeWidth={2.2} aria-hidden style={admIco} />Edit</button>
                        {(section === "products" || section === "categories") && (
                          <button style={miniBtn} disabled={busy === r.id} onClick={() => toggle(section, r, "active")}>{r.active ? "⏸ Deactivate" : "▶ Activate"}</button>
                        )}
                        <button style={{ ...miniBtn, borderColor: "rgba(255,71,87,0.4)", color: "#FF9AA8" }} disabled={busy === r.id} onClick={() => remove(section, r.id, r.name || r.title || r.id)}><Trash2 size={12} strokeWidth={2.2} aria-hidden style={admIco} />Delete</button>
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
      const details: Record<string, any> = {};
      let hasDetails = false;
      for (const f of fields) {
        const v = form[f.key];
        let out: any;
        if (f.type === "list") out = String(v || "").split("\n").map((s) => s.trim()).filter(Boolean);
        else if (f.type === "kv") {
          const o: Record<string, string> = {};
          String(v || "").split("\n").forEach((line) => {
            const i = line.indexOf(":");
            if (i > 0) { const k = line.slice(0, i).trim(); const val = line.slice(i + 1).trim(); if (k) o[k] = val; }
          });
          out = o;
        }
        else if (f.type === "multiselect") out = Array.isArray(v) ? v : [];
        else if (f.type === "rooms") out = Array.isArray(v) ? v : [];
        else if (f.type === "bool") out = !!v;
        else if (f.type === "num") out = v === "" || v == null ? null : Number(v);
        else out = v ?? "";
        // Fields flagged `group:"details"` nest into the details jsonb bag.
        if (f.group === "details") { details[f.key] = out; hasDetails = true; }
        else body[f.key] = out;
      }
      if (hasDetails) body.details = details;
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
                <select value={String(form[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} style={inputStyle}>
                  {(f.opts || []).map((o) => <option key={o.value} value={o.value} style={{ background: "#151820" }}>{o.label}</option>)}
                </select>
              ) : f.type === "multiselect" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(f.opts || []).map((o) => {
                    const cur: string[] = Array.isArray(form[f.key]) ? form[f.key] : [];
                    const on = cur.includes(o.value);
                    return (
                      <button key={o.value} type="button"
                        onClick={() => set(f.key, on ? cur.filter((x) => x !== o.value) : [...cur, o.value])}
                        style={{ ...chipToggle, ...(on ? chipToggleOn : {}) }}>{o.label}</button>
                    );
                  })}
                </div>
              ) : f.type === "rooms" ? (
                <RoomBuilder value={Array.isArray(form[f.key]) ? form[f.key] : []} onChange={(v) => set(f.key, v)} />
              ) : f.type === "textarea" || f.type === "list" || f.type === "kv" ? (
                <textarea value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} rows={f.type === "textarea" ? 3 : 3} style={{ ...inputStyle, resize: "vertical", fontFamily: f.type === "kv" ? "monospace" : "inherit" }} />
              ) : (
                <input value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} inputMode={f.type === "num" ? "decimal" : undefined} style={inputStyle} />
              )}
              {f.hint ? <div style={{ color: "#6E7288", fontSize: 10.5, marginTop: 4 }}>{f.hint}</div> : null}
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
    // Fields flagged `group:"details"` are seeded from the details jsonb bag.
    const src = fld.group === "details" ? (row.details && typeof row.details === "object" ? row.details : {}) : row;
    const v = src[fld.key];
    if (fld.type === "list") f[fld.key] = Array.isArray(v) ? v.join("\n") : "";
    else if (fld.type === "kv") f[fld.key] = v && typeof v === "object" ? Object.entries(v).map(([k, val]) => `${k}: ${val}`).join("\n") : "";
    else if (fld.type === "multiselect") f[fld.key] = Array.isArray(v) ? v : [];
    else if (fld.type === "rooms") f[fld.key] = Array.isArray(v) ? v : [];
    else if (fld.type === "bool") f[fld.key] = v == null ? (fld.key === "active" || fld.key === "in_stock") : !!v;
    else f[fld.key] = v ?? "";
  }
  return f;
}

// ── Room builder (hospitality listings) ──────────────────────────────────
type RoomRow = { category: string; name: string; count: any; price: any; capacity: any; amenities: string[]; images: string[] };

function RoomBuilder({ value, onChange }: { value: RoomRow[]; onChange: (v: RoomRow[]) => void }) {
  const rows: RoomRow[] = Array.isArray(value) ? value : [];
  const update = (i: number, patch: Partial<RoomRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { category: "deluxe", name: "", count: 1, price: "", capacity: ROOM_CATEGORY_CAPACITY["deluxe"] || 2, amenities: [], images: [] }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  const onCat = (i: number, cat: string) => {
    const r = rows[i];
    const prevLabel = ROOM_CATEGORY_MAP[r.category]?.label || "";
    const patch: Partial<RoomRow> = { category: cat };
    // Auto-fill name from the new category label if untouched / matched old label.
    if (!r.name || r.name === prevLabel) patch.name = cat === "custom" ? "" : (ROOM_CATEGORY_MAP[cat]?.label || "");
    // Seed capacity from the category default if still empty.
    if (r.capacity === "" || r.capacity == null) patch.capacity = ROOM_CATEGORY_CAPACITY[cat] || 2;
    update(i, patch);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.length === 0 && (
        <div style={{ color: "#6E7288", fontSize: 12, padding: "10px 12px", border: "1px dashed rgba(255,255,255,0.14)", borderRadius: 10 }}>
          No rooms added yet.
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 12, background: "rgba(255,255,255,0.02)", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#9fb1c2", fontSize: 12, fontWeight: 700 }}>Room {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...miniBtn, borderColor: "rgba(255,71,87,0.4)", color: "#FF9AA8" }}><Trash2 size={12} strokeWidth={2.2} aria-hidden style={admIco} />Remove</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <div style={{ width: "calc(50% - 4px)" }}>
              <RbLabel>Category</RbLabel>
              <select value={r.category} onChange={(e) => onCat(i, e.target.value)} style={inputStyle}>
                {ROOM_CATEGORIES.map((c) => <option key={c.id} value={c.id} style={{ background: "#151820" }}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ width: "calc(50% - 4px)" }}>
              <RbLabel>Room name</RbLabel>
              <input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Deluxe Valley View" style={inputStyle} />
            </div>
            <div style={{ width: "calc(33.33% - 6px)" }}>
              <RbLabel>Count</RbLabel>
              <input value={r.count ?? ""} onChange={(e) => update(i, { count: e.target.value })} inputMode="numeric" style={inputStyle} />
            </div>
            <div style={{ width: "calc(33.33% - 6px)" }}>
              <RbLabel>Price ₹/night</RbLabel>
              <input value={r.price ?? ""} onChange={(e) => update(i, { price: e.target.value })} inputMode="decimal" style={inputStyle} />
            </div>
            <div style={{ width: "calc(33.33% - 6px)" }}>
              <RbLabel>Max guests</RbLabel>
              <input value={r.capacity ?? ""} onChange={(e) => update(i, { capacity: e.target.value })} inputMode="numeric" style={inputStyle} />
            </div>
          </div>
          <div>
            <RbLabel>In-room amenities</RbLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {AMENITIES.map((a) => {
                const cur = Array.isArray(r.amenities) ? r.amenities : [];
                const on = cur.includes(a.id);
                return (
                  <button key={a.id} type="button"
                    onClick={() => update(i, { amenities: on ? cur.filter((x) => x !== a.id) : [...cur, a.id] })}
                    style={{ ...chipToggle, ...(on ? chipToggleOn : {}) }}>{a.emoji} {a.label}</button>
                );
              })}
            </div>
          </div>
          <div>
            <RbLabel>Room photo URLs (one per line)</RbLabel>
            <textarea value={(Array.isArray(r.images) ? r.images : []).join("\n")}
              onChange={(e) => update(i, { images: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
              rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnGhost, alignSelf: "flex-start" }}>＋ Add room / cottage</button>
    </div>
  );
}
function RbLabel({ children }: { children: any }) { return <label style={{ display: "block", color: "#8A8FA8", fontSize: 10.5, fontWeight: 600, marginBottom: 4 }}>{children}</label>; }

// ── bits ────────────────────────────────────────────────────────────────
function Th({ children }: { children: any }) { return <th style={{ padding: "11px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>{children}</th>; }
function Td({ children }: { children: any }) { return <td style={{ padding: "11px 14px", color: "#C7CBD8", verticalAlign: "middle" }}>{children}</td>; }
function Flags({ row, keys }: { row: any; keys: string[] }) {
  return <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
    {keys.filter((k) => row[k]).map((k) => <span key={k} style={chip}>{k === "in_stock" ? "in stock" : k === "featured" ? "★ featured" : k}</span>)}
  </div>;
}

const btnPrimary: React.CSSProperties = { padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "linear-gradient(160deg,#d4dde6 0%,#b1bfd0 52%,#93a7bc 100%)", color: "#0F1117" };
const btnGhost: React.CSSProperties = { padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "#E8EAF0" };
const miniBtn: React.CSSProperties = { padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "#C7CBD8" };
const chip: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: "rgba(34,197,94,0.14)", color: "#7DE3A0", border: "1px solid rgba(34,197,94,0.3)" };
const chipToggle: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 999, cursor: "pointer", background: "rgba(255,255,255,0.04)", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.12)" };
const chipToggleOn: React.CSSProperties = { background: "rgba(140, 160, 182,0.16)", color: "#c6d0da", borderColor: "rgba(140, 160, 182,0.5)" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.03)", color: "#E8EAF0", fontSize: 13, outline: "none", boxSizing: "border-box" };
function statusPill(status: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    available: ["rgba(34,197,94,0.14)", "#7DE3A0"], pending_review: ["rgba(245,158,11,0.14)", "#bbc7d3"],
    shortlisted: ["rgba(61,156,245,0.14)", "#93C5FD"], rented: ["rgba(168,85,247,0.14)", "#D0A8F7"],
    rejected: ["rgba(255,71,87,0.14)", "#FF9AA8"], inactive: ["rgba(255,255,255,0.06)", "#8A8FA8"],
    approved: ["rgba(34,197,94,0.14)", "#7DE3A0"], pending: ["rgba(245,158,11,0.14)", "#bbc7d3"],
    suspended: ["rgba(255,255,255,0.06)", "#8A8FA8"],
  };
  const [bg, color] = map[status] || map.inactive;
  return { fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: bg, color };
}
