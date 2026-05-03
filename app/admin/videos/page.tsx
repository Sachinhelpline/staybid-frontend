"use client";
import { useEffect, useState } from "react";

type Tab = "pending" | "approved" | "rejected";

export default function AdminVideosPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/admin/videos/pending?status=${tab}`)
      .then((r) => r.json())
      .then((d) => setVideos(d.videos || []))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  function authHeader(): Record<string, string> {
    const t = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function approve(id: string) {
    setBusy(true);
    await fetch(`/api/admin/videos/${id}/approve`, { method: "POST", headers: { ...authHeader() } });
    setBusy(false); setSelected(null); load();
  }
  async function reject(id: string) {
    setBusy(true);
    await fetch(`/api/admin/videos/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ reason }),
    });
    setBusy(false); setSelected(null); setReason(""); load();
  }

  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<Tab, number>;
  for (const v of videos) counts[v.verification_status as Tab] = (counts[v.verification_status as Tab] || 0) + 1;

  return (
    <div style={{ padding: "24px", color: "#E8EAF0", fontFamily: "DM Sans, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 700, color: "#D4AF37", margin: 0 }}>
          Hotel Video Queue
        </h1>
        <span style={{ fontSize: 12, color: "#8A8FA8" }}>
          {videos.length} {tab} · room walkthroughs
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {(["pending", "approved", "rejected"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: tab === t ? "rgba(212,175,55,0.15)" : "#151820",
              color: tab === t ? "#D4AF37" : "#8A8FA8",
              border: tab === t ? "1px solid #D4AF37" : "1px solid rgba(255,255,255,0.07)",
              textTransform: "capitalize",
            }}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#8A8FA8" }}>Loading…</div>
      ) : videos.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#8A8FA8", background: "#151820", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)" }}>
          No {tab} videos.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {videos.map((v) => (
            <div key={v.id} style={{
              background: "#151820", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)",
              overflow: "hidden", cursor: "pointer", transition: "transform .15s",
            }}
              onClick={() => setSelected(v)}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}>
              <div style={{ aspectRatio: "16/9", background: "#0F1117", position: "relative" }}>
                {v.thumbnail_url ? (
                  <img src={v.thumbnail_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🎬</div>
                )}
                <span style={{
                  position: "absolute", top: 8, right: 8, padding: "3px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em",
                  background: v.verification_status === "approved" ? "rgba(46,204,113,0.2)" : v.verification_status === "rejected" ? "rgba(255,71,87,0.2)" : "rgba(212,175,55,0.2)",
                  color:      v.verification_status === "approved" ? "#2ECC71" : v.verification_status === "rejected" ? "#FF4757" : "#D4AF37",
                }}>{v.verification_status}</span>
                {v.duration_seconds && (
                  <span style={{ position: "absolute", bottom: 8, right: 8, padding: "2px 6px", borderRadius: 4, fontSize: 11, background: "rgba(0,0,0,0.7)", color: "#fff" }}>
                    {Math.floor(v.duration_seconds / 60)}:{String(v.duration_seconds % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
              <div style={{ padding: 12 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: "#E8EAF0" }}>
                  {v.hotel?.name || `Hotel ${String(v.hotel_id).slice(0, 8)}`}
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8A8FA8" }}>
                  {v.room_type || v.title || "—"} · {v.hotel?.city || ""}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#5A5F70" }}>
                  Uploaded {new Date(v.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div onClick={() => setSelected(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#151820", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "92vh", overflow: "auto",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <div style={{ aspectRatio: "16/9", background: "#000" }}>
              <video src={selected.s3_url} controls poster={selected.thumbnail_url || undefined}
                style={{ width: "100%", height: "100%", display: "block" }} />
            </div>
            <div style={{ padding: 18 }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: "#E8EAF0" }}>
                {selected.hotel?.name || `Hotel ${String(selected.hotel_id).slice(0, 8)}`}
              </p>
              <p style={{ margin: "4px 0 12px", fontSize: 13, color: "#8A8FA8" }}>
                {selected.room_type || selected.title || "Walkthrough"} · {selected.quality?.toUpperCase()} · uploaded {new Date(selected.created_at).toLocaleString()}
              </p>
              {selected.rejection_reason && (
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "#FF8A95", fontSize: 13, marginBottom: 12 }}>
                  Rejected: {selected.rejection_reason}
                </div>
              )}

              {selected.verification_status === "pending" && (
                <>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                    placeholder="Rejection reason (required if rejecting)"
                    style={{ width: "100%", padding: 10, borderRadius: 8, background: "#0F1117", border: "1px solid rgba(255,255,255,0.1)", color: "#E8EAF0", fontSize: 13, fontFamily: "inherit", marginBottom: 12 }} />
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button onClick={() => setSelected(null)} disabled={busy}
                      style={{ padding: "10px 18px", borderRadius: 8, background: "transparent", color: "#8A8FA8", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Cancel
                    </button>
                    <button onClick={() => reject(selected.id)} disabled={busy || !reason.trim()}
                      style={{ padding: "10px 18px", borderRadius: 8, background: "rgba(255,71,87,0.15)", color: "#FF4757", border: "1px solid rgba(255,71,87,0.4)", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !reason.trim() ? 0.5 : 1 }}>
                      Reject
                    </button>
                    <button onClick={() => approve(selected.id)} disabled={busy}
                      style={{ padding: "10px 18px", borderRadius: 8, background: "#D4AF37", color: "#0F1117", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      Approve
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
