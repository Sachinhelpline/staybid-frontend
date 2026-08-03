"use client";
// v319 — Channel Manager Phase 5: admin channel-health console.
// Every OTA feed + connection across all hotels, with a health rollup + a
// per-feed "Re-sync" through the shared engine (lib/channels/sync.ts).
import { useCallback, useEffect, useState } from "react";
import { Radio, RotateCw } from "lucide-react";

const HEALTH: Record<string, { color: string; label: string }> = {
  ok: { color: "#2ECC71", label: "Healthy" },
  error: { color: "#FF4757", label: "Sync error" },
  paused: { color: "#8A8FA8", label: "Paused" },
  stale: { color: "#a9b9c8", label: "Stale" },
  idle: { color: "#3D9CF5", label: "Awaiting first sync" },
};

function adminId(): string {
  if (typeof window === "undefined") return "";
  try {
    const u = JSON.parse(localStorage.getItem("sb_admin_user") || "null");
    return u?.id || "";
  } catch {
    return "";
  }
}

function ago(ts: any): string {
  if (!ts) return "never";
  let s = String(ts);
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function AdminChannels() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState("");

  const headers = useCallback((): HeadersInit => {
    const tok = typeof window !== "undefined" ? localStorage.getItem("sb_admin_token") || "" : "";
    return { "x-admin-token": tok, "x-admin-id": adminId() };
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    fetch("/api/admin/channels", { headers: headers(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) setErr(String(d.error));
        else setData(d);
      })
      .catch((e) => setErr(e?.message || "Failed"))
      .finally(() => setLoading(false));
  }, [headers]);

  useEffect(() => {
    load();
  }, [load]);

  const resync = async (feedId: string) => {
    setBusy(feedId);
    setFlash("");
    try {
      const r = await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ feedId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Re-sync failed");
      const res = d.result || {};
      setFlash(`Synced: ${res.imported ?? 0} imported · ${res.removed ?? 0} removed · ${res.totalEvents ?? 0} events`);
      load();
    } catch (e: any) {
      setErr(e?.message || "Re-sync failed");
    } finally {
      setBusy("");
    }
  };

  const s = data?.summary || { total: 0, ok: 0, error: 0, paused: 0, stale: 0, idle: 0 };
  const feeds: any[] = data?.feeds || [];

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ color: "#E8EAF0", fontSize: 24, fontWeight: 800, margin: 0, fontFamily: "Syne, sans-serif", display: "inline-flex", alignItems: "center", gap: 9 }}><Radio size={22} strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />Channel Health</h1>
          <div style={{ color: "#8A8FA8", fontSize: 13, marginTop: 4 }}>Every OTA feed across all hotels · unified Channel Manager</div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#E8EAF0", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {loading ? "…" : <><RotateCw size={14} strokeWidth={2.2} aria-hidden />Refresh</>}
        </button>
      </div>

      {err && <div style={{ background: "rgba(255,71,87,0.12)", border: "1px solid rgba(255,71,87,0.3)", color: "#FF4757", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{err}</div>}
      {flash && <div style={{ background: "rgba(46,204,113,0.12)", border: "1px solid rgba(46,204,113,0.3)", color: "#2ECC71", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>{flash}</div>}

      {/* rollup */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { k: "total", label: "Total feeds", color: "#E8EAF0" },
          { k: "ok", label: "Healthy", color: HEALTH.ok.color },
          { k: "stale", label: "Stale", color: HEALTH.stale.color },
          { k: "error", label: "Errors", color: HEALTH.error.color },
          { k: "paused", label: "Paused", color: HEALTH.paused.color },
          { k: "idle", label: "Awaiting", color: HEALTH.idle.color },
        ].map((c) => (
          <div key={c.k} style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ color: c.color, fontSize: 26, fontWeight: 800, fontFamily: "Syne, sans-serif" }}>{s[c.k] ?? 0}</div>
            <div style={{ color: "#8A8FA8", fontSize: 12, marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* feeds table */}
      <div style={{ background: "#151820", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" }}>
        {feeds.length === 0 ? (
          <div style={{ color: "#8A8FA8", padding: 28, textAlign: "center", fontSize: 14 }}>{loading ? "Loading…" : "No OTA feeds connected yet."}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                  {["Hotel", "Channel", "Health", "Last sync", "Last result", "Fails", "Action"].map((h) => (
                    <th key={h} style={{ textAlign: "left", color: "#8A8FA8", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: "10px 14px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => {
                  const hh = HEALTH[f.health] || HEALTH.idle;
                  return (
                    <tr key={f.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "12px 14px", color: "#E8EAF0", fontSize: 13 }}>
                        <div style={{ fontWeight: 600 }}>{f.hotelName}</div>
                        {f.label && <div style={{ color: "#8A8FA8", fontSize: 11 }}>{f.label}</div>}
                      </td>
                      <td style={{ padding: "12px 14px", color: "#E8EAF0", fontSize: 13, textTransform: "capitalize" }}>{f.provider}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: `${hh.color}1a`, color: hh.color, border: `1px solid ${hh.color}33` }}>{hh.label}</span>
                      </td>
                      <td style={{ padding: "12px 14px", color: "#8A8FA8", fontSize: 12 }}>{ago(f.lastSyncAt)}</td>
                      <td style={{ padding: "12px 14px", color: "#8A8FA8", fontSize: 12, maxWidth: 220 }}>
                        {f.health === "error" && f.lastSyncError
                          ? <span style={{ color: "#FF4757" }}>{String(f.lastSyncError).slice(0, 60)}</span>
                          : (f.lastImportedCount != null ? `${f.lastImportedCount} in · ${f.lastRemovedCount ?? 0} out` : "—")}
                      </td>
                      <td style={{ padding: "12px 14px", color: f.consecutiveFailures > 0 ? "#FF4757" : "#8A8FA8", fontSize: 12, fontWeight: f.consecutiveFailures > 0 ? 700 : 400 }}>{f.consecutiveFailures ?? 0}</td>
                      <td style={{ padding: "12px 14px" }}>
                        <button disabled={busy === f.id} onClick={() => resync(f.id)}
                          style={{ background: "rgba(61,156,245,0.14)", border: "1px solid rgba(61,156,245,0.35)", color: "#3D9CF5", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: busy === f.id ? "wait" : "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {busy === f.id ? "…" : <><RotateCw size={13} strokeWidth={2.2} aria-hidden />Re-sync</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
