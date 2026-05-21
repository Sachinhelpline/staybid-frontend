"use client";
//
// v172 — F&B Digital Menu builder (partner panel, Phase 1).
//
// The hotel builds its own restaurant menu — categories, dishes with
// veg/non-veg, photos, descriptions, and portion-wise pricing
// (Half / Full / etc.). This is the foundation; QR ordering + billing
// integration build on these tables.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageUpload } from "@/components/ImageUpload";
import { modalPortal } from "@/lib/partner/modal-portal";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("sb_partner_token") || "" : "";
}
function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }

const FOOD: Record<string, { label: string; c: string }> = {
  veg:    { label: "Veg",     c: "#15803d" },
  nonveg: { label: "Non-veg", c: "#b91c1c" },
  egg:    { label: "Egg",     c: "#b45309" },
};

// classic FSSAI-style veg / non-veg square mark
function FoodMark({ type }: { type: string }) {
  const c = FOOD[type]?.c || FOOD.veg.c;
  return (
    <span className="inline-flex items-center justify-center shrink-0"
      style={{ width: 14, height: 14, border: `1.5px solid ${c}`, borderRadius: 3 }}>
      <span style={{ width: 6, height: 6, borderRadius: type === "nonveg" ? 0 : 999, background: c }} />
    </span>
  );
}

export default function MenuBuilderTab({ hotelId }: { hotelId: string }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [provisioned, setProvisioned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [catEditor, setCatEditor]   = useState<{ mode: "create" | "edit"; cat?: any } | null>(null);
  const [itemEditor, setItemEditor] = useState<{ mode: "create" | "edit"; item?: any; categoryId?: string } | null>(null);

  const load = useCallback(async () => {
    if (!hotelId) return;
    try {
      const r = await fetch(`/api/partner/menu?hotelId=${encodeURIComponent(hotelId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store",
      });
      const d = await r.json().catch(() => ({}));
      setCategories(d.categories || []);
      setItems(d.items || []);
      setProvisioned(d.provisioned !== false);
    } catch { /* keep */ }
    finally { setLoading(false); }
  }, [hotelId]);

  useEffect(() => { load(); }, [load]);

  async function delCategory(id: string) {
    if (!confirm("Category aur uske saare items delete ho jayenge. Pakka?")) return;
    try {
      await fetch(`/api/partner/menu?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
      setCategories((p) => p.filter((c) => c.id !== id));
      setItems((p) => p.filter((i) => i.category_id !== id));
    } catch { load(); }
  }
  async function delItem(id: string) {
    if (!confirm("Yeh dish delete karein?")) return;
    setItems((p) => p.filter((i) => i.id !== id));
    try {
      await fetch(`/api/partner/menu/items?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` },
      });
    } catch { load(); }
  }
  async function toggleItem(it: any) {
    setItems((p) => p.map((i) => (i.id === it.id ? { ...i, available: !i.available } : i)));
    try {
      await fetch("/api/partner/menu/items", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: it.id, available: !it.available }),
      });
    } catch { load(); }
  }

  const itemsByCat = useMemo(() => {
    const m: Record<string, any[]> = {};
    items.forEach((i) => { (m[i.category_id || "_none"] = m[i.category_id || "_none"] || []).push(i); });
    return m;
  }, [items]);

  return (
    <div className="fade-up">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="sec-title text-xl">F&amp;B Digital Menu</h2>
          <p className="text-[0.7rem] text-luxury-500 mt-0.5">{categories.length} categories · {items.length} dishes — apna restaurant menu khud design karo.</p>
        </div>
        <button onClick={() => setCatEditor({ mode: "create" })} className="btn-gold">➕ Add Category</button>
      </div>

      {!provisioned && (
        <div className="card-p card-tight mb-3 border-amber-200" style={{ background: "#fffbeb" }}>
          <p className="text-[0.74rem] text-amber-800 font-semibold">⚠ Menu storage abhi setup nahi hua</p>
          <p className="text-[0.66rem] text-amber-700 mt-0.5">
            <span className="font-mono">migrations/2026-05-21-fnb-menu.sql</span> Supabase me apply karni hai.
          </p>
        </div>
      )}

      {loading ? (
        <div className="card-p text-center py-10 text-luxury-400 text-sm">Loading menu…</div>
      ) : categories.length === 0 && items.length === 0 ? (
        <div className="card-p text-center py-10">
          <p className="text-3xl mb-2">🍽️</p>
          <p className="text-luxury-600 font-semibold text-sm">Abhi menu khali hai</p>
          <p className="text-luxury-400 text-xs mt-0.5 mb-3">Pehle category banao (Starters, Main Course…), phir dishes add karo.</p>
          <button onClick={() => setCatEditor({ mode: "create" })} className="btn-gold">➕ Add Category</button>
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const list = itemsByCat[cat.id] || [];
            return (
              <div key={cat.id} className="card-p card-tight">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[0.86rem] font-bold text-luxury-900">{cat.name}
                    <span className="text-luxury-400 font-semibold"> · {list.length}</span>
                  </p>
                  <div className="flex gap-1.5">
                    <button onClick={() => setItemEditor({ mode: "create", categoryId: cat.id })}
                      className="btn-gold !px-2.5 !py-1 text-[0.7rem]">➕ Dish</button>
                    <button onClick={() => setCatEditor({ mode: "edit", cat })}
                      className="btn-ghost !px-2.5 !py-1 text-[0.7rem]">✏️</button>
                    <button onClick={() => delCategory(cat.id)}
                      className="btn-ghost !px-2.5 !py-1 text-[0.7rem] !text-red-600 hover:!border-red-300">🗑</button>
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className="text-[0.7rem] text-luxury-400 py-1">Koi dish nahi — "➕ Dish" se add karo.</p>
                ) : (
                  <div className="space-y-1.5">
                    {list.map((it) => (
                      <MenuItemRow key={it.id} it={it}
                        onEdit={() => setItemEditor({ mode: "edit", item: it })}
                        onDelete={() => delItem(it.id)}
                        onToggle={() => toggleItem(it)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* uncategorised */}
          {(itemsByCat["_none"] || []).length > 0 && (
            <div className="card-p card-tight">
              <p className="text-[0.86rem] font-bold text-luxury-900 mb-2">Uncategorised
                <span className="text-luxury-400 font-semibold"> · {(itemsByCat["_none"] || []).length}</span>
              </p>
              <div className="space-y-1.5">
                {(itemsByCat["_none"] || []).map((it) => (
                  <MenuItemRow key={it.id} it={it}
                    onEdit={() => setItemEditor({ mode: "edit", item: it })}
                    onDelete={() => delItem(it.id)}
                    onToggle={() => toggleItem(it)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {catEditor && (
        <CategoryEditor mode={catEditor.mode} cat={catEditor.cat} hotelId={hotelId}
          onClose={() => setCatEditor(null)} onSaved={() => { setCatEditor(null); load(); }} />
      )}
      {itemEditor && (
        <ItemEditor mode={itemEditor.mode} item={itemEditor.item}
          categoryId={itemEditor.categoryId} categories={categories} hotelId={hotelId}
          onClose={() => setItemEditor(null)} onSaved={() => { setItemEditor(null); load(); }} />
      )}
    </div>
  );
}

function MenuItemRow({ it, onEdit, onDelete, onToggle }: any) {
  const portions: any[] = Array.isArray(it.portions) ? it.portions : [];
  return (
    <div className={`flex items-center gap-2.5 py-1.5 border-b border-luxury-50 last:border-0 ${it.available ? "" : "opacity-55"}`}>
      {it.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={it.image} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-luxury-50 flex items-center justify-center text-sm shrink-0">🍽️</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <FoodMark type={it.food_type} />
          <p className="text-[0.8rem] font-bold text-luxury-900 truncate">{it.name}</p>
        </div>
        <p className="text-[0.64rem] text-luxury-500 truncate">
          {portions.map((p: any, i: number) => (
            <span key={i}>{i > 0 ? " · " : ""}{p.label ? `${p.label} ` : ""}<b className="text-gold-700">{fmtCur(p.price)}</b></span>
          ))}
          {it.description ? ` — ${it.description}` : ""}
        </p>
      </div>
      <button onClick={onToggle}
        className={`text-[0.56rem] font-bold px-1.5 py-1 rounded-md shrink-0 ${
          it.available ? "bg-emerald-100 text-emerald-700" : "bg-luxury-100 text-luxury-500"
        }`}>
        {it.available ? "ON" : "OFF"}
      </button>
      <button onClick={onEdit} className="text-luxury-400 hover:text-luxury-700 text-sm shrink-0">✏️</button>
      <button onClick={onDelete} className="text-red-400 hover:text-red-600 text-sm shrink-0">×</button>
    </div>
  );
}

// ── Category create / edit ─────────────────────────────────────────────────
function CategoryEditor({ mode, cat, hotelId, onClose, onSaved }: any) {
  const [name, setName] = useState(cat?.name || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) { setErr("Category ka naam daalo."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/menu", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify(mode === "create" ? { hotelId, name: name.trim() } : { id: cat.id, name: name.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); setSaving(false); }
  }

  return modalPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {mode === "create" ? "New Category" : "Edit Category"}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <label className="text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1">Category name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            placeholder="e.g. Starters · Main Course · Beverages" className="inp-p"
            onKeyDown={(e) => e.key === "Enter" && save()} />
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">{err}</p>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Dish create / edit ─────────────────────────────────────────────────────
function ItemEditor({ mode, item, categoryId, categories, hotelId, onClose, onSaved }: any) {
  const [f, setF] = useState({
    name: item?.name || "",
    description: item?.description || "",
    foodType: item?.food_type || "veg",
    categoryId: item?.category_id || categoryId || (categories[0]?.id || ""),
    available: item?.available !== false,
  });
  const [image, setImage] = useState<string>(item?.image || "");
  const [portions, setPortions] = useState<{ label: string; price: string }[]>(
    Array.isArray(item?.portions) && item.portions.length
      ? item.portions.map((p: any) => ({ label: p.label || "", price: String(p.price || "") }))
      : [{ label: "", price: "" }]
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const lbl = "text-[0.62rem] font-bold text-luxury-400 uppercase tracking-widest block mb-1";

  function setPortion(i: number, k: "label" | "price", v: string) {
    setPortions((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  }

  async function save() {
    if (!f.name.trim()) { setErr("Dish ka naam daalo."); return; }
    const cleaned = portions
      .map((p) => ({ label: p.label.trim(), price: Number(p.price) || 0 }))
      .filter((p) => p.price > 0);
    if (!cleaned.length) { setErr("Kam se kam ek portion ka price daalo."); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/partner/menu/items", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(mode === "edit" ? { id: item.id } : { hotelId }),
          categoryId: f.categoryId || null,
          name: f.name.trim(), description: f.description.trim(),
          foodType: f.foodType, image, portions: cleaned, available: f.available,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e?.message || "Save failed"); setSaving(false); }
  }

  return modalPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4"
      style={{ background: "rgba(10,8,5,0.62)", backdropFilter: "blur(3px)" }} onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "90dvh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-luxury-100 shrink-0">
          <p className="font-display text-lg text-luxury-900" style={{ fontWeight: 500 }}>
            {mode === "create" ? "New Dish" : "Edit Dish"}
          </p>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-luxury-50 hover:bg-luxury-100 text-luxury-500 text-lg leading-none flex items-center justify-center">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <div>
            <label className={lbl}>Dish name *</label>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} className="inp-p" autoFocus
              placeholder="e.g. Paneer Butter Masala" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={lbl}>Category</label>
              <select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)} className="inp-p">
                <option value="">Uncategorised</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Food type</label>
              <div className="flex gap-1">
                {(["veg", "egg", "nonveg"] as const).map((t) => {
                  const on = f.foodType === t;
                  return (
                    <button key={t} type="button" onClick={() => set("foodType", t)}
                      className="flex-1 rounded-lg py-1.5 text-[0.62rem] font-bold transition-all"
                      style={{ border: `1.5px solid ${on ? FOOD[t].c : "#e6ddc8"}`, color: on ? FOOD[t].c : "#9a8a6a", background: on ? FOOD[t].c + "14" : "#fff" }}>
                      {FOOD[t].label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div>
            <label className={lbl}>Description</label>
            <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2}
              placeholder="Short description guests will see" className="inp-p resize-none" />
          </div>

          {/* portions */}
          <div>
            <label className={lbl}>Portions &amp; price</label>
            <div className="space-y-1.5">
              {portions.map((p, i) => (
                <div key={i} className="flex gap-1.5">
                  <input value={p.label} onChange={(e) => setPortion(i, "label", e.target.value)}
                    placeholder="Portion (Half / Full — optional)" className="inp-p flex-1 text-[0.76rem]" />
                  <div className="relative w-24 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-luxury-400 text-sm">₹</span>
                    <input value={p.price} onChange={(e) => setPortion(i, "price", e.target.value)}
                      type="number" inputMode="numeric" placeholder="price" className="inp-p pl-6 text-[0.76rem]" />
                  </div>
                  {portions.length > 1 && (
                    <button type="button" onClick={() => setPortions((pp) => pp.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600 text-lg leading-none w-6 shrink-0">×</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setPortions((p) => [...p, { label: "", price: "" }])}
              className="text-[0.68rem] font-bold text-gold-600 mt-1.5">+ Add portion</button>
          </div>

          {/* photo */}
          <div>
            <label className={lbl}>Photo</label>
            {image ? (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-luxury-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => setImage("")}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-xs leading-none">×</button>
              </div>
            ) : (
              <ImageUpload folder="menu" onUpload={(url) => setImage(url)} />
            )}
          </div>

          <label className="flex items-center gap-2 text-[0.74rem] font-semibold text-luxury-700">
            <input type="checkbox" checked={f.available} onChange={(e) => set("available", e.target.checked)} />
            Available (guests order kar sakte hain)
          </label>

          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-luxury-100 shrink-0">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-gold flex-1">
            {saving ? "Saving…" : mode === "create" ? "Add Dish" : "Save Dish"}
          </button>
        </div>
      </div>
    </div>
  );
}
