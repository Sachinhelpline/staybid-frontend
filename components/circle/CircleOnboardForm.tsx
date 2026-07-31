"use client";

// components/circle/CircleOnboardForm.tsx
// v312 — the SINGLE StayCircle property onboarding form, used by BOTH:
//   • Admin  (/admin/circle "Add / Edit property")   → variant="admin"  (dark)
//   • Public (/circle/onboard "List your property")   → variant="public" (cozy)
// "Dono ko almost same rakho, alag alag build mat kro" — one component, one
// field set, one payload shape. The ONLY difference is the caller (admin
// publishes directly; public creates a pending submission) + the palette.
//
// Crucially it carries an INLINE room-category builder: a property can NEVER be
// created room-less (which is what made "Dhanaulti Village Resort" show a false
// "Sold out" on /circle/discover — [].every() === true). At least one room
// category with units is required before submit.

import { useMemo, useRef, useState } from "react";
import { PROPERTY_TYPES, AMENITIES, ROOM_CATEGORIES, ROOM_CATEGORY_CAPACITY } from "@/lib/catalog";
import { resizeImageBeforeUpload } from "@/lib/image-resize";

// ── Storage uploader (public social-media bucket, anon-key write) ───────────
const SB_STORAGE = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

function extFromMime(mime: string, fb: string) {
  return ((mime || "").split("/")[1]?.split(";")[0] || fb).replace(/[^a-z0-9]/gi, "").slice(0, 8) || fb;
}
function pushFileToStorage(
  file: Blob, subdir: string, ext: string, contentType: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `circle/${subdir}/${stamp}-${rand}.${ext}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 120_000;
    xhr.open("POST", `${SB_STORAGE}/storage/v1/object/social-media/${path}`, true);
    xhr.setRequestHeader("Authorization", `Bearer ${SB_ANON}`);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress((e.loaded / e.total) * 100); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(`${SB_STORAGE}/storage/v1/object/public/social-media/${path}`);
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(file);
  });
}

// ── Types ───────────────────────────────────────────────────────────────────
export type CircleRoomDraft = {
  id?: string;          // present when editing an existing circle_room_types row
  category: string;     // ROOM_CATEGORIES id (or "custom")
  name: string;
  monthly_rate: number;
  total_units: number;
  locked_units?: number;
  capacity: number;
  bed_type: string;
  view_label: string;
  description: string;
  amenities: string[];   // per-room amenities (separate from property-level)
  images: string[];      // per-room photos (separate from property-level)
};

export type CircleFormValue = {
  title: string;
  property_type: string;
  star_rating: number;
  tagline: string;
  description: string;
  city: string;
  state: string;
  location_label: string;
  available_from: string;         // YYYY-MM-DD or ""
  amenities: string[];
  images: string[];
  video_url: string;
  monthly_rate: number;
  roi_min_pct: number;
  roi_max_pct: number;
  occupancy_label: string;
  rooms_label: string;
  operation_model: string;
  hotel_id?: string;              // admin only (optional live-partner link)
  roomTypes: CircleRoomDraft[];
};

export type CircleFormSubmit = Omit<CircleFormValue, "roomTypes"> & {
  roomTypes: CircleRoomDraft[];
};

const OPERATION_MODELS = [
  { id: "managed", label: "Fully Managed" },
  { id: "revenue_share", label: "Revenue Share" },
  { id: "lease", label: "Lease" },
  { id: "franchise", label: "Franchise" },
];

function emptyRoom(): CircleRoomDraft {
  return { category: "deluxe", name: "Deluxe Room", monthly_rate: 20000, total_units: 2, locked_units: 0, capacity: 2, bed_type: "", view_label: "", description: "", amenities: [], images: [] };
}

export function makeInitialCircleForm(partial?: Partial<CircleFormValue>): CircleFormValue {
  const base: CircleFormValue = {
    title: "", property_type: "cottage", star_rating: 0, tagline: "", description: "",
    city: "", state: "", location_label: "", available_from: "",
    amenities: [], images: [], video_url: "",
    monthly_rate: 25000, roi_min_pct: 14, roi_max_pct: 17,
    occupancy_label: "High Occupancy", rooms_label: "", operation_model: "managed",
    hotel_id: "",
    roomTypes: [emptyRoom()],
    ...partial,
  };
  // Guarantee at least one editable room row (NOTE: `[] || x` returns `[]`
  // because an empty array is truthy — must check `.length` explicitly, or a
  // room-less property would open with zero rooms and re-create the bug).
  base.roomTypes = Array.isArray(partial?.roomTypes) && partial!.roomTypes!.length
    ? partial!.roomTypes!
    : [emptyRoom()];
  return base;
}

// ── Palette ───────────────────────────────────────────────────────────────
type Pal = {
  panel: string; sub: string; text: string; muted: string; accent: string;
  input: string; inputBorder: string; chip: string; chipOn: string; chipOnBorder: string;
  hint: string; divider: string; danger: string; ok: string; roomCard: string;
};
const ADMIN_PAL: Pal = {
  panel: "#151820", sub: "#8A8FA8", text: "#E8EAF0", muted: "#8A8FA8", accent: "#9fb1c2",
  input: "#0F1117", inputBorder: "rgba(255,255,255,0.09)", chip: "#0F1117", chipOn: "rgba(140, 160, 182,0.14)", chipOnBorder: "#9fb1c2",
  hint: "#8A8FA8", divider: "rgba(255,255,255,0.08)", danger: "#FF4757", ok: "#2ECC71", roomCard: "#0F1117",
};
const PUBLIC_PAL: Pal = {
  panel: "var(--bg-card, #fcfcfd)", sub: "var(--text-muted, #6E5430)", text: "var(--text-base, #1F1A0F)", muted: "var(--text-muted, #6E5430)", accent: "var(--cozy-champagne, #5f7c98)",
  input: "var(--bg-input, #f5f7f8)", inputBorder: "var(--border-soft, rgba(106, 133, 160,0.20))", chip: "var(--bg-input, #f5f7f8)", chipOn: "rgba(106,133,160,0.16)", chipOnBorder: "var(--cozy-champagne, #5f7c98)",
  hint: "var(--text-muted, #6E5430)", divider: "var(--border-soft, rgba(106, 133, 160,0.18))", danger: "#C0503E", ok: "#5E7C4E", roomCard: "var(--bg-input, #f5f7f8)",
};

// ── Section (module-scope: defining it inside the component gave it a new
// identity on every keystroke → React remounted the subtree → every input
// blurred after one character, i.e. the "ek hi letter add kar sakte hai" bug) ─
function Section({ P, title, sub, children }: { P: Pal; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${P.divider}`, paddingTop: 14, marginTop: 4 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: P.accent }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: P.hint, marginTop: 3, marginBottom: 8 }}>{sub}</div>}
      <div style={{ display: "grid", gap: 12, marginTop: sub ? 0 : 10 }}>{children}</div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function CircleOnboardForm({
  variant, initial, submitting, submitLabel, onSubmit, onCancel,
}: {
  variant: "admin" | "public";
  initial?: Partial<CircleFormValue>;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (payload: CircleFormSubmit) => void;
  onCancel?: () => void;
}) {
  const P = variant === "admin" ? ADMIN_PAL : PUBLIC_PAL;
  const [form, setForm] = useState<CircleFormValue>(() => makeInitialCircleForm(initial));
  const [err, setErr] = useState("");

  const set = <K extends keyof CircleFormValue>(k: K, v: CircleFormValue[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleAmenity = (id: string) => setForm((f) => {
    const cur = Array.isArray(f.amenities) ? f.amenities : [];
    return { ...f, amenities: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });

  // room helpers ------------------------------------------------------------
  const setRoom = (i: number, patch: Partial<CircleRoomDraft>) =>
    setForm((f) => ({ ...f, roomTypes: f.roomTypes.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRoom = () => setForm((f) => ({ ...f, roomTypes: [...f.roomTypes, emptyRoom()] }));
  const removeRoom = (i: number) => setForm((f) => ({ ...f, roomTypes: f.roomTypes.length > 1 ? f.roomTypes.filter((_, j) => j !== i) : f.roomTypes }));
  const toggleRoomAmenity = (i: number, id: string) => setForm((f) => ({
    ...f,
    roomTypes: f.roomTypes.map((r, j) => {
      if (j !== i) return r;
      const cur = Array.isArray(r.amenities) ? r.amenities : [];
      return { ...r, amenities: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    }),
  }));
  const pickCategory = (i: number, catId: string) => {
    const cat = ROOM_CATEGORIES.find((c) => c.id === catId);
    const cap = ROOM_CATEGORY_CAPACITY[catId] || 2;
    setRoom(i, {
      category: catId,
      name: cat && !cat.custom ? cat.label : form.roomTypes[i]?.name || "",
      capacity: cap,
    });
  };

  // derived: cheapest room rate (drives the property "starting from")
  const minRoomRate = useMemo(() => {
    const rates = form.roomTypes.map((r) => Number(r.monthly_rate) || 0).filter((n) => n > 0);
    return rates.length ? Math.min(...rates) : 0;
  }, [form.roomTypes]);
  const totalUnits = useMemo(() => form.roomTypes.reduce((s, r) => s + (Number(r.total_units) || 0), 0), [form.roomTypes]);

  const validate = (): string => {
    if (!form.title.trim()) return "Property title is required.";
    if (!form.city.trim()) return "City is required.";
    const valid = form.roomTypes.filter((r) => r.name.trim() && (Number(r.total_units) || 0) > 0 && (Number(r.monthly_rate) || 0) > 0);
    if (!valid.length) return "Add at least one room category with a name, room count and monthly rate.";
    return "";
  };

  const submit = () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setErr("");
    // property monthly_rate = the cheapest room rate (starting-from) unless the
    // admin set an explicit one; keep whatever the field shows if > 0.
    const rate = Number(form.monthly_rate) > 0 ? Number(form.monthly_rate) : (minRoomRate || Number(form.monthly_rate) || 0);
    const rooms = form.roomTypes
      .filter((r) => r.name.trim() && (Number(r.total_units) || 0) > 0)
      .map((r, idx) => ({
        ...(r.id ? { id: r.id } : {}),
        category: r.category,
        name: r.name.trim(),
        monthly_rate: Number(r.monthly_rate) || 0,
        total_units: Math.max(1, Math.floor(Number(r.total_units) || 1)),
        locked_units: Math.max(0, Math.floor(Number(r.locked_units) || 0)),
        capacity: Math.max(1, Math.floor(Number(r.capacity) || 2)),
        bed_type: (r.bed_type || "").trim(),
        view_label: (r.view_label || "").trim(),
        description: (r.description || "").trim(),
        amenities: Array.isArray(r.amenities) ? r.amenities : [],
        images: Array.isArray(r.images) ? r.images : [],
        sort_order: (idx + 1) * 10,
      })) as CircleRoomDraft[];
    onSubmit({
      title: form.title.trim(),
      property_type: form.property_type,
      star_rating: Number(form.star_rating) || 0,
      tagline: form.tagline.trim(),
      description: form.description.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      location_label: form.location_label.trim(),
      available_from: form.available_from || "",
      amenities: form.amenities,
      images: form.images,
      video_url: (form.video_url || "").trim(),
      monthly_rate: rate,
      roi_min_pct: Number(form.roi_min_pct) || 0,
      roi_max_pct: Number(form.roi_max_pct) || 0,
      occupancy_label: form.occupancy_label.trim(),
      rooms_label: form.rooms_label.trim() || (totalUnits ? `${totalUnits} Rooms` : ""),
      operation_model: form.operation_model,
      ...(variant === "admin" ? { hotel_id: (form.hotel_id || "").trim() } : {}),
      roomTypes: rooms,
    });
  };

  // shared styles ----------------------------------------------------------
  const inputS: React.CSSProperties = {
    background: P.input, border: `1px solid ${P.inputBorder}`, borderRadius: 10,
    color: P.text, padding: "9px 12px", fontSize: 13.5, width: "100%",
  };
  const labelS: React.CSSProperties = { display: "grid", gap: 5, fontSize: 11.5, color: P.sub, fontWeight: 600 };
  const chipS = (on: boolean): React.CSSProperties => ({
    background: on ? P.chipOn : P.chip, border: `1px solid ${on ? P.chipOnBorder : P.inputBorder}`,
    color: on ? P.accent : P.muted, borderRadius: 999, padding: "6px 12px", fontSize: 12,
    fontWeight: 600, cursor: "pointer",
  });
  const btnPrimary: React.CSSProperties = {
    background: P.accent, color: variant === "admin" ? "#07080C" : "#221A0C", border: "none",
    borderRadius: 12, padding: "12px 22px", fontSize: 14, fontWeight: 800, cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    background: "transparent", color: P.muted, border: `1px solid ${P.inputBorder}`,
    borderRadius: 12, padding: "12px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div style={{ display: "grid", gap: 16, color: P.text }}>
      {/* Property basics */}
      <Section P={P} title="Property basics">
        <label style={labelS}>Property title
          <input style={inputS} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Dhanaulti Village Resort" />
        </label>
        <label style={labelS}>Property type
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {PROPERTY_TYPES.map((t) => (
              <button key={t.id} type="button" onClick={() => set("property_type", t.id)} style={chipS(form.property_type === t.id)}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        </label>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label style={labelS}>Star rating
            <select style={inputS} value={String(form.star_rating)} onChange={(e) => set("star_rating", Number(e.target.value))}>
              <option value="0">Not rated</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}-star</option>)}
            </select>
          </label>
          <label style={labelS}>Tagline
            <input style={inputS} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Short highlight line" />
          </label>
        </div>
        <label style={labelS}>Short description
          <textarea style={{ ...inputS, minHeight: 66 }} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="A line or two about what makes this property special…" />
        </label>
      </Section>

      {/* Location + availability */}
      <Section P={P} title="Location & availability">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label style={labelS}>City
            <input style={inputS} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Dhanaulti" />
          </label>
          <label style={labelS}>State
            <input style={inputS} value={form.state} onChange={(e) => set("state", e.target.value)} placeholder="e.g. Uttarakhand" />
          </label>
        </div>
        <label style={labelS}>Location label
          <input style={inputS} value={form.location_label} onChange={(e) => set("location_label", e.target.value)} placeholder="e.g. 500m from Eco Park" />
        </label>
        <label style={labelS}>Available for lease from
          <input type="date" style={inputS} value={form.available_from} onChange={(e) => set("available_from", e.target.value)} />
          <span style={{ fontSize: 10.5, color: P.hint, fontWeight: 400 }}>Rent starts from this date, not the day the investor pays.</span>
        </label>
      </Section>

      {/* Room categories — the piece that prevents false "Sold out" */}
      <Section P={P} title="Room categories" sub="Add every room type and how many rooms of each are available for investment. At least one is required.">
        <div style={{ display: "grid", gap: 12 }}>
          {form.roomTypes.map((r, i) => (
            <div key={i} style={{ background: P.roomCard, border: `1px solid ${P.inputBorder}`, borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: P.accent }}>Room #{i + 1}</span>
                {form.roomTypes.length > 1 && (
                  <button type="button" onClick={() => removeRoom(i)} style={{ background: "transparent", border: "none", color: P.danger, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>✕ Remove</button>
                )}
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <label style={labelS}>Category
                  <select style={inputS} value={r.category} onChange={(e) => pickCategory(i, e.target.value)}>
                    {ROOM_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label style={labelS}>Room name
                  <input style={inputS} value={r.name} onChange={(e) => setRoom(i, { name: e.target.value })} placeholder="e.g. Deluxe Room" />
                </label>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
                <label style={labelS}>₹ / room / month
                  <input type="number" style={inputS} value={r.monthly_rate} onChange={(e) => setRoom(i, { monthly_rate: Number(e.target.value) })} />
                </label>
                <label style={labelS}>No. of rooms
                  <input type="number" min={1} style={inputS} value={r.total_units} onChange={(e) => setRoom(i, { total_units: Number(e.target.value) })} />
                </label>
                <label style={labelS}>Max guests
                  <input type="number" min={1} style={inputS} value={r.capacity} onChange={(e) => setRoom(i, { capacity: Number(e.target.value) })} />
                </label>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <label style={labelS}>Bed type
                  <input style={inputS} value={r.bed_type} onChange={(e) => setRoom(i, { bed_type: e.target.value })} placeholder="e.g. King" />
                </label>
                <label style={labelS}>View
                  <input style={inputS} value={r.view_label} onChange={(e) => setRoom(i, { view_label: e.target.value })} placeholder="e.g. Valley View" />
                </label>
              </div>
              <label style={labelS}>Room description (optional)
                <input style={inputS} value={r.description} onChange={(e) => setRoom(i, { description: e.target.value })} placeholder="Short note about this room" />
              </label>
              {/* Per-room amenities (separate from property-level amenities) */}
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: P.sub, fontWeight: 600 }}>Room amenities</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {AMENITIES.map((a) => {
                    const on = (r.amenities || []).includes(a.id);
                    return (
                      <button key={a.id} type="button" onClick={() => toggleRoomAmenity(i, a.id)} style={{ ...chipS(on), padding: "4px 10px", fontSize: 11 }}>
                        {a.emoji} {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Per-room photos (separate from property-level photos) */}
              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: P.sub, fontWeight: 600 }}>Room photos</span>
                <MediaBlock kind="image" pal={P} inputS={inputS} subdir="room-photos"
                  value={r.images || []} onValue={(urls) => setRoom(i, { images: urls })} />
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRoom} style={{ ...btnGhost, justifySelf: "start", padding: "9px 16px" }}>＋ Add room category</button>
        <div style={{ fontSize: 11.5, color: P.hint }}>
          Total: <b style={{ color: P.text }}>{totalUnits}</b> room{totalUnits === 1 ? "" : "s"}
          {minRoomRate > 0 && <> · Starting from <b style={{ color: P.text }}>₹{minRoomRate.toLocaleString("en-IN")}</b>/room/month</>}
        </div>
      </Section>

      {/* Amenities */}
      <Section P={P} title="Amenities">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {AMENITIES.map((a) => (
            <button key={a.id} type="button" onClick={() => toggleAmenity(a.id)} style={chipS(form.amenities.includes(a.id))}>
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Media */}
      <Section P={P} title="Photos & reel" sub="Upload from device or paste URLs. A reel video makes the /circle feed much stronger.">
        <MediaBlock kind="image" pal={P} inputS={inputS}
          value={form.images} onValue={(urls) => set("images", urls)} />
        <MediaBlock kind="video" pal={P} inputS={inputS}
          value={form.video_url ? [form.video_url] : []} onValue={(urls) => set("video_url", urls[0] || "")} />
      </Section>

      {/* Investment & ops */}
      <Section P={P} title="Investment & returns" sub="Drives the ROI panel + operating model on the /circle catalog.">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label style={labelS}>Starting ₹ / room / month
            <input type="number" style={inputS} value={form.monthly_rate} onChange={(e) => set("monthly_rate", Number(e.target.value))} placeholder={minRoomRate ? String(minRoomRate) : "25000"} />
          </label>
          <label style={labelS}>ROI min %
            <input type="number" style={inputS} value={form.roi_min_pct} onChange={(e) => set("roi_min_pct", Number(e.target.value))} />
          </label>
          <label style={labelS}>ROI max %
            <input type="number" style={inputS} value={form.roi_max_pct} onChange={(e) => set("roi_max_pct", Number(e.target.value))} />
          </label>
        </div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <label style={labelS}>Occupancy label
            <input style={inputS} value={form.occupancy_label} onChange={(e) => set("occupancy_label", e.target.value)} placeholder="e.g. High Occupancy" />
          </label>
          <label style={labelS}>Operating model
            <select style={inputS} value={form.operation_model} onChange={(e) => set("operation_model", e.target.value)}>
              {OPERATION_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
        {variant === "admin" && (
          <label style={labelS}>Linked hotel id (optional — live partner fetch)
            <input style={inputS} value={form.hotel_id || ""} onChange={(e) => set("hotel_id", e.target.value)} />
          </label>
        )}
      </Section>

      {err && <div style={{ color: P.danger, fontSize: 12.5, fontWeight: 600 }}>⚠ {err}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: `1px solid ${P.divider}`, paddingTop: 14 }}>
        {onCancel && <button type="button" onClick={onCancel} style={btnGhost} disabled={submitting}>Cancel</button>}
        <button type="button" onClick={submit} style={btnPrimary} disabled={submitting}>
          {submitting ? "Saving…" : (submitLabel || (variant === "admin" ? "💾 Save property" : "Submit for review"))}
        </button>
      </div>
    </div>
  );
}

// ── Media uploader block (images multi / single video) ──────────────────────
function MediaBlock({
  kind, value, onValue, pal, inputS, subdir,
}: {
  kind: "image" | "video";
  value: string[];
  onValue: (urls: string[]) => void;
  pal: Pal;
  inputS: React.CSSProperties;
  subdir?: string;
}) {
  const photoDir = subdir || "photos";
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  const handle = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true); setMsg(""); setPct(0);
    const urls: string[] = [];
    try {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (kind === "image") {
          if (!f.type.startsWith("image/")) continue;
          let up: Blob = f;
          try { up = await resizeImageBeforeUpload(f, { maxDim: 1600, quality: 0.82 }); } catch { up = f; }
          const url = await pushFileToStorage(up, photoDir, extFromMime(up.type || "image/jpeg", "jpg"), up.type || "image/jpeg",
            (p) => setPct(Math.round(((i + p / 100) / list.length) * 100)));
          urls.push(url);
        } else {
          if (!f.type.startsWith("video/")) continue;
          if (f.size > 220 * 1024 * 1024) { setMsg("Video too large (max 220MB)"); continue; }
          const url = await pushFileToStorage(f, "videos", extFromMime(f.type || "video/mp4", "mp4"), f.type || "video/mp4",
            (p) => setPct(Math.round(p)));
          urls.push(url);
          break;
        }
      }
      if (urls.length) {
        onValue(kind === "image" ? [...value, ...urls] : urls);
        setMsg(`✓ ${urls.length} uploaded`);
      } else if (!msg) setMsg("No valid files");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false); setPct(0);
      if (ref.current) ref.current.value = "";
    }
  };

  const btn: React.CSSProperties = {
    background: busy ? pal.input : pal.ok, color: busy ? pal.muted : "#0A140A", border: `1px solid ${pal.inputBorder}`,
    borderRadius: 10, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={ref} type="file" hidden accept={kind === "image" ? "image/*" : "video/*"} multiple={kind === "image"} onChange={(e) => handle(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} style={btn}>
          {busy ? `⏳ ${pct}%` : kind === "image" ? "⬆ Upload photos" : "⬆ Upload reel video"}
        </button>
        {msg && <span style={{ fontSize: 11.5, color: msg.startsWith("✓") ? pal.ok : pal.danger }}>{msg}</span>}
      </div>
      {kind === "image" ? (
        <>
          <textarea style={{ ...inputS, minHeight: 54 }} value={value.join("\n")}
            onChange={(e) => onValue(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} placeholder="One image URL per line" />
          {value.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {value.map((src, i) => (
                <div key={i} style={{ position: "relative", width: 60, height: 46, borderRadius: 8, overflow: "hidden", border: `1px solid ${pal.inputBorder}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button type="button" onClick={() => onValue(value.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 1, right: 1, width: 16, height: 16, borderRadius: 999, border: "none", cursor: "pointer", background: "rgba(255,71,87,.9)", color: "#fff", fontSize: 10, lineHeight: "16px", padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <input style={inputS} value={value[0] || ""} onChange={(e) => onValue(e.target.value ? [e.target.value] : [])} placeholder="https://…mp4" />
          {value[0] && <video src={value[0]} controls muted playsInline style={{ width: "100%", maxHeight: 160, borderRadius: 10, background: "#000" }} />}
        </>
      )}
    </div>
  );
}
