"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const SB_URL  = "https://uxxhbdqedazpmvbvaosh.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4eGhiZHFlZGF6cG12YnZhb3NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMTIwMDgsImV4cCI6MjA5MDY4ODAwOH0.mBhr1tNlail5u0D_dj3ljA9oRZvZ7_2_0-lt7I6cJ60";

async function uploadVideoToStorage(file: File, userId: string): Promise<string> {
  const ext = file.name.split(".").pop() || "mp4";
  const path = `creator/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const res = await fetch(`${SB_URL}/storage/v1/object/hotel-videos/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_ANON}`,
      "Content-Type": file.type || "video/mp4",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Storage upload failed: ${detail}`);
  }
  return `${SB_URL}/storage/v1/object/public/hotel-videos/${path}`;
}

async function uploadThumbToStorage(file: File, userId: string): Promise<string> {
  const path = `thumbs/${userId}/${Date.now()}.jpg`;
  const res = await fetch(`${SB_URL}/storage/v1/object/hotel-images/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SB_ANON}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) return "";
  return `${SB_URL}/storage/v1/object/public/hotel-images/${path}`;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending:  { label: "Under Review", color: "#f59e0b" },
  approved: { label: "Live",         color: "#10b981" },
  rejected: { label: "Rejected",     color: "#ef4444" },
};

export default function UploadPage() {
  const { user } = useAuth();

  // Form state
  const [hotels, setHotels]       = useState<any[]>([]);
  const [hotelId, setHotelId]     = useState("");
  const [roomType, setRoomType]   = useState("");
  const [title, setTitle]         = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [thumbPreview, setThumbPreview] = useState("");

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState(false);

  // My videos
  const [myVideos, setMyVideos]   = useState<any[]>([]);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getHotels().then(d => setHotels(d?.hotels || [])).catch(() => {});
    loadMyVideos();
  }, []);

  function loadMyVideos() {
    // Fetch all approved+pending videos by this user — no hotelId filter
    fetch(`/api/influencer/my-videos`, {
      headers: { Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("sb_token") : ""}` },
    })
      .then(r => r.json())
      .then(d => setMyVideos(d?.videos || []))
      .catch(() => {});
  }

  function pickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) { setError("Video must be under 200 MB"); return; }
    setVideoFile(f);
    setVideoPreview(URL.createObjectURL(f));
    setError("");
  }

  function pickThumb(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setThumbFile(f);
    setThumbPreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!videoFile) { setError("Please choose a video file"); return; }
    if (!hotelId)   { setError("Select a hotel"); return; }
    if (!user?.id)  { setError("Please log in first"); return; }

    setUploading(true);
    setProgress(10);
    setError("");

    try {
      // Upload video to storage
      setProgress(20);
      const videoUrl = await uploadVideoToStorage(videoFile, user.id);
      setProgress(70);

      // Upload thumbnail if provided
      let thumbUrl = "";
      if (thumbFile) {
        thumbUrl = await uploadThumbToStorage(thumbFile, user.id);
      }
      setProgress(85);

      // Save metadata
      await api.uploadVideo({
        hotelId,
        videoUrl,
        roomType: roomType || undefined,
        title: title || undefined,
        thumbnailUrl: thumbUrl || undefined,
        durationSeconds: undefined,
        quality: "hd",
        sizeBytes: videoFile.size,
      });
      setProgress(100);
      setSuccess(true);

      // Reset form
      setVideoFile(null);
      setThumbFile(null);
      setVideoPreview("");
      setThumbPreview("");
      setTitle("");
      setRoomType("");
      setHotelId("");
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (thumbInputRef.current) thumbInputRef.current.value = "";

      setTimeout(() => { setSuccess(false); setProgress(0); }, 3000);
      loadMyVideos();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card-luxury p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-luxury-900">Upload a Reel</h2>
            <p className="text-luxury-500 text-sm mt-0.5">Show off a hotel stay · Earn when viewers book</p>
          </div>
          <span className="text-4xl">🎬</span>
        </div>
      </div>

      {/* Upload form */}
      <form onSubmit={handleSubmit} className="card-luxury p-6 space-y-5">

        {/* Video picker */}
        <div
          onClick={() => videoInputRef.current?.click()}
          className="relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-luxury-200 bg-luxury-50 cursor-pointer hover:border-gold-400 transition-all"
          style={{ minHeight: 200 }}>
          {videoPreview ? (
            <video src={videoPreview} className="w-full rounded-2xl max-h-72 object-contain" controls />
          ) : (
            <div className="text-center py-10 px-4">
              <div className="text-5xl mb-3">📹</div>
              <p className="font-semibold text-luxury-700">Tap to choose a video</p>
              <p className="text-xs text-luxury-500 mt-1">MP4 · MOV · WebM · up to 200 MB</p>
            </div>
          )}
          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={pickVideo} />
        </div>

        {/* Thumbnail */}
        <div className="flex items-start gap-4">
          <div
            onClick={() => thumbInputRef.current?.click()}
            className="relative flex-shrink-0 w-24 h-24 rounded-xl border-2 border-dashed border-luxury-200 bg-luxury-50 flex items-center justify-center cursor-pointer hover:border-gold-400 transition-all overflow-hidden">
            {thumbPreview
              ? <img src={thumbPreview} alt="thumb" className="w-full h-full object-cover" />
              : <span className="text-3xl">🖼️</span>}
            <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={pickThumb} />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <label className="block text-xs font-bold text-luxury-600 mb-1 uppercase tracking-wider">Title</label>
              <input
                type="text"
                placeholder="e.g. Sunrise view from Mountain Grand suite"
                className="input-luxury w-full"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={120}
              />
            </div>
          </div>
        </div>

        {/* Hotel + Room Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-luxury-600 mb-1 uppercase tracking-wider">Hotel *</label>
            <select
              className="input-luxury w-full"
              value={hotelId}
              onChange={e => setHotelId(e.target.value)}
              required>
              <option value="">— Select hotel —</option>
              {hotels.map((h: any) => (
                <option key={h.id} value={h.id}>{h.name} · {h.city}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-luxury-600 mb-1 uppercase tracking-wider">Room Type</label>
            <select className="input-luxury w-full" value={roomType} onChange={e => setRoomType(e.target.value)}>
              <option value="">— Any / General —</option>
              {["Deluxe", "Suite", "Premium", "Standard", "Penthouse", "Villa", "Cottage"].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Progress */}
        {uploading && (
          <div>
            <div className="flex justify-between text-xs font-semibold text-luxury-600 mb-1">
              <span>Uploading…</span><span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-luxury-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-gold-500 to-gold-400 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {error   && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}
        {success && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">✅ Uploaded! Your reel is under review and will go live within 24 hours.</p>}

        <button
          type="submit"
          disabled={uploading || !videoFile}
          className="btn-luxury w-full py-3 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed">
          {uploading ? "Uploading…" : "Upload Reel 🚀"}
        </button>
      </form>

      {/* My uploads */}
      {myVideos.length > 0 && (
        <div className="card-luxury p-5">
          <h3 className="font-bold text-luxury-900 mb-4">My Reels ({myVideos.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {myVideos.map((v: any) => {
              const badge = STATUS_BADGE[v.verification_status] || STATUS_BADGE.pending;
              return (
                <div key={v.id} className="relative rounded-xl overflow-hidden bg-luxury-100 aspect-[9/16]">
                  {v.thumbnail_url
                    ? <img src={v.thumbnail_url} alt={v.title || "reel"} className="w-full h-full object-cover" />
                    : <video src={v.s3_url} className="w-full h-full object-cover" muted playsInline />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-white text-xs font-semibold line-clamp-2">{v.title || "Untitled"}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full text-white"
                        style={{ background: badge.color + "cc" }}>{badge.label}</span>
                      {v.likes_count > 0 && <span className="text-[0.6rem] text-white/80">❤️ {v.likes_count}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="card-luxury p-5 space-y-2">
        <h3 className="font-bold text-luxury-900 text-sm">Tips for great reels</h3>
        {[
          "🌅 Shoot during golden hour for stunning natural light",
          "📱 Vertical 9:16 format gets 40% more views",
          "🎵 Trending audio boosts discovery significantly",
          "🏷️ Mention the hotel name + city in the first 3 seconds",
          "💬 Reply to comments in the first hour for the algorithm",
        ].map((t, i) => (
          <p key={i} className="text-xs text-luxury-600">{t}</p>
        ))}
      </div>
    </div>
  );
}
