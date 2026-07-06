"use client";

// ============================================================================
// v285 — Property studio + public showcase.
// A per-property reel/photo feed. Only the OWNER (their sb_token resolves to
// discovery_properties.submitted_by) OR a StayBid ADMIN (sb_admin_token) can
// add / remove content — the API enforces it and returns canManage. Everyone
// else sees a read-only showcase. Owner contact is never exposed here.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { uploadImage } from "@/lib/supabase";
import { uploadSocialMedia } from "@/lib/social/storage-upload";

interface Media {
  id: string; media_type: "video" | "photo"; media_url: string;
  thumbnail_url?: string | null; caption?: string | null; uploaded_role?: string; created_at?: string;
}
interface Property {
  id: string; title: string; city?: string; locality?: string; state?: string;
  property_type?: string; bhk?: string; area_sqft?: number; furnishing?: string;
  rent_monthly?: number; deposit?: number; score?: number; images?: string[];
  amenities?: string[]; lat?: number | null; lng?: number | null; formatted_address?: string;
  details?: Record<string, any> | null; status?: string;
}

const inr = (n?: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const GOOGLE_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

function mapSrc(lat: number, lng: number): string {
  if (GOOGLE_EMBED_KEY) return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_EMBED_KEY}&q=${lat},${lng}&zoom=15`;
  const d = 0.008;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (typeof window === "undefined") return h;
  const tok = localStorage.getItem("sb_token");
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  const at = localStorage.getItem("sb_admin_token");
  if (at) {
    h["x-admin-token"] = at;
    try { const au = JSON.parse(localStorage.getItem("sb_admin_user") || "{}"); if (au?.id) h["x-admin-id"] = au.id; } catch { /* ignore */ }
  }
  return h;
}

function posterFromVideo(file: File): Promise<string> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      v.preload = "metadata"; v.muted = true; (v as any).playsInline = true;
      v.src = URL.createObjectURL(file);
      const done = (s: string) => { try { URL.revokeObjectURL(v.src); } catch { /* */ } resolve(s); };
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.15, (v.duration || 1) / 2); } catch { done(""); } };
      v.onseeked = () => {
        try {
          const c = document.createElement("canvas");
          const scale = Math.min(1, 720 / (v.videoHeight || 720));
          c.width = (v.videoWidth || 720) * scale; c.height = (v.videoHeight || 1280) * scale;
          c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
          done(c.toDataURL("image/jpeg", 0.7));
        } catch { done(""); }
      };
      v.onerror = () => done("");
      setTimeout(() => done(""), 7000);
    } catch { resolve(""); }
  });
}

export default function PropertyStudio() {
  const params = useParams();
  const id = String((params as any)?.id || "");
  const [property, setProperty] = useState<Property | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [viewer, setViewer] = useState<Media | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await fetch(`/api/host/property/${id}/media`, { headers: authHeaders() });
      if (r.status === 404) { setNotFound(true); return; }
      const d = await r.json();
      setProperty(d.property || null);
      setMedia(Array.isArray(d.media) ? d.media : []);
      setCanManage(!!d.canManage);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); /* eslint-disable-next-line */ }, [id]);

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    setBusy(isVideo ? "Uploading reel…" : "Uploading photo…");
    try {
      let mediaUrl = "", thumbnailUrl = "";
      if (isVideo) {
        const blobUrl = URL.createObjectURL(file);
        const poster = await posterFromVideo(file);
        let uid = "owner";
        try { uid = JSON.parse(localStorage.getItem("sb_user") || "{}")?.id || "owner"; } catch { /* */ }
        const up = await uploadSocialMedia({ mediaBlobUrl: blobUrl, mediaMime: file.type, kind: "REEL", posterDataUrl: poster || undefined, userId: uid });
        try { URL.revokeObjectURL(blobUrl); } catch { /* */ }
        mediaUrl = up.mediaUrl; thumbnailUrl = up.thumbnailUrl;
      } else {
        mediaUrl = await uploadImage(file, "property-media");
        thumbnailUrl = mediaUrl;
      }
      const r = await fetch(`/api/host/property/${id}/media`, {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ mediaType: isVideo ? "video" : "photo", mediaUrl, thumbnailUrl, caption }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) { setBusy(d.error || "Upload failed"); setTimeout(() => setBusy(""), 2500); return; }
      setMedia((s) => [d.media, ...s]);
      setCaption("");
      setBusy("");
    } catch {
      setBusy("Upload failed"); setTimeout(() => setBusy(""), 2500);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(m: Media) {
    if (!confirm("Remove this from the property?")) return;
    setMedia((s) => s.filter((x) => x.id !== m.id));
    try {
      await fetch(`/api/host/property/${id}/media?mediaId=${encodeURIComponent(m.id)}`, { method: "DELETE", headers: authHeaders() });
    } catch { /* optimistic */ }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--bg-page)" }}>
        <div className="text-4xl mb-2">🏚️</div>
        <div className="font-display text-2xl" style={{ color: "var(--text-base)" }}>Property not found</div>
        <Link href="/host/properties" className="mt-4 px-5 py-2.5 rounded-full font-semibold text-white" style={{ background: "var(--accent)" }}>Browse properties →</Link>
      </div>
    );
  }

  const d = property?.details || {};
  const detailRows: [string, any][] = property ? [
    ["Type", property.property_type], ["Config", property.bhk],
    ["Area", property.area_sqft ? `${property.area_sqft} ${d.areaUnit || "sqft"}` : null],
    ["Furnishing", property.furnishing], ["Floor", d.floor], ["Facing", d.facing],
    ["Age", d.ageYears ? `${d.ageYears} yrs` : null], ["Available", d.availableFrom],
    ["Lease", d.leaseType], ["Tenant", d.tenantPref],
    ["Maintenance", d.maintenanceMonthly ? `${inr(d.maintenanceMonthly)}/mo` : null],
  ] : [];

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-page)" }}>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-4 sb-fade-in">
        <Link href="/host/properties" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← All properties</Link>

        {loading ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>Loading…</div>
        ) : property ? (
          <>
            <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.5rem,4vw,2.2rem)", color: "var(--text-base)" }}>{property.title}</h1>
                <div className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                  📍 {[property.locality, property.city, property.state].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl" style={{ color: "var(--accent)" }}>{inr(property.rent_monthly)}<span className="text-xs" style={{ color: "var(--text-muted)" }}>/mo</span></div>
                {property.deposit ? <div className="text-xs" style={{ color: "var(--text-muted)" }}>Deposit {inr(property.deposit)}{d.negotiable ? " · Negotiable" : ""}</div> : null}
              </div>
            </div>

            {/* Detail chips */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {detailRows.filter(([, v]) => v).map(([k, v]) => (
                <span key={k} className="text-[11px] px-2 py-1 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-soft)" }}>
                  <b style={{ color: "var(--text-muted)" }}>{k}:</b> {String(v)}
                </span>
              ))}
            </div>
            {(property.amenities || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {(property.amenities || []).map((a) => (
                  <span key={a} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{a}</span>
                ))}
              </div>
            )}

            {property.lat != null && property.lng != null && (
              <div className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-soft)" }}>
                <iframe title="Location" src={mapSrc(property.lat as number, property.lng as number)} className="w-full block" style={{ height: 180, border: 0 }} loading="lazy" />
                <a href={`https://www.google.com/maps/search/?api=1&query=${property.lat},${property.lng}`} target="_blank" rel="noopener noreferrer"
                  className="block text-xs font-semibold px-3 py-2" style={{ color: "var(--accent)", background: "var(--bg-card)" }}>Open in Google Maps ↗</a>
              </div>
            )}

            {/* ---- Reels & photos studio ---- */}
            <div className="mt-6 flex items-center justify-between gap-2">
              <h2 className="font-display text-xl" style={{ color: "var(--text-base)" }}>🎬 Reels & photos</h2>
              {canManage && <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>You can manage this</span>}
            </div>

            {canManage ? (
              <div className="mt-3 rounded-2xl p-4 sb-fade-in" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none mb-2"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" }} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}
                    className="sb-card-lift px-5 py-2.5 rounded-full font-semibold text-white text-sm" style={{ background: "var(--accent)", opacity: busy ? 0.6 : 1 }}>
                    {busy || "＋ Add reel / photo"}
                  </button>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>Video → reel · Image → photo</span>
                </div>
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => onPick(e.target.files)} />
              </div>
            ) : (
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>Showcase by the property owner. Only the owner or StayBid can add content here.</p>
            )}

            {media.length === 0 ? (
              <div className="mt-4 rounded-2xl p-10 text-center" style={{ background: "var(--bg-card)", border: "1px dashed var(--border-soft)", color: "var(--text-muted)" }}>
                {canManage ? "No reels or photos yet — add your first above." : "No reels or photos yet."}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 sb-stagger">
                {media.map((m) => (
                  <div key={m.id} className="relative aspect-[3/4] rounded-xl overflow-hidden sb-card-lift cursor-pointer"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-soft)" }} onClick={() => setViewer(m)}>
                    {m.media_type === "video" ? (
                      m.thumbnail_url
                        ? <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        : <video src={m.media_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <img src={m.media_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    )}
                    {m.media_type === "video" && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}>▶</span>
                      </div>
                    )}
                    {m.caption && (
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px] truncate" style={{ background: "linear-gradient(transparent,rgba(0,0,0,0.7))", color: "#fff" }}>{m.caption}</div>
                    )}
                    {canManage && (
                      <button onClick={(e) => { e.stopPropagation(); remove(m); }}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-sm flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>Could not load this property.</div>
        )}
      </section>

      {/* Fullscreen viewer */}
      {viewer && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.9)" }} onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl" onClick={() => setViewer(null)}>✕</button>
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            {viewer.media_type === "video"
              ? <video src={viewer.media_url} className="w-full rounded-2xl" controls autoPlay playsInline />
              : <img src={viewer.media_url} alt="" className="w-full rounded-2xl" />}
            {viewer.caption && <p className="text-center text-sm mt-3 text-white/90">{viewer.caption}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
