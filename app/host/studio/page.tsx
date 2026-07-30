"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { uploadImage } from "@/lib/supabase";

const STYLES = ["Modern Luxury", "Minimalist", "Boho Chic", "Urban Premium", "Classic Elegance", "Budget Friendly"];
const ROOM_TYPES = ["Bedroom", "Living Room", "Studio Apartment", "Kitchen", "Bathroom", "Balcony / Outdoor", "Reception / Lobby"];
const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

interface Product { name: string; category: string; price: number; qty: number }
interface Option { id?: string; style: string; title: string; description: string; est_cost?: number; estCost?: number; products: Product[] }

export default function StudioPage() {
  const [roomType, setRoomType] = useState("Bedroom");
  const [style, setStyle] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [recent, setRecent] = useState<any[]>([]);
  const [quote, setQuote] = useState<Option | "all" | null>(null);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
    if (!token) return;
    fetch("/api/host/studio", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json()).then((d) => setRecent(d?.projects || [])).catch(() => {});
  }, []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 6 - images.length);
    if (!files.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of files) { try { urls.push(await uploadImage(f, "host-design")); } catch { /* skip */ } }
      setImages((p) => [...p, ...urls].slice(0, 6));
    } finally { setUploading(false); e.target.value = ""; }
  }

  async function generate() {
    setGenerating(true); setOptions([]); setProvider("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ images, style, roomType, budgetMin: Number(budgetMin) || 0, budgetMax: Number(budgetMax) || 0 }),
      });
      const d = await r.json();
      if (r.ok) {
        setOptions(d.options || []);
        setProvider(d.provider || "");
        if (token) fetch("/api/host/studio", { headers: { Authorization: `Bearer ${token}` } })
          .then((x) => x.json()).then((x) => setRecent(x?.projects || [])).catch(() => {});
        setTimeout(() => document.getElementById("studio-results")?.scrollIntoView({ behavior: "smooth" }), 60);
      }
    } finally { setGenerating(false); }
  }

  const aiBacked = provider.startsWith("gemini") || provider.startsWith("claude");

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-2 text-sm"><Link href="/host" style={{ color: "var(--text-muted)" }}>← Host home</Link></div>
      <div className="sb-fade-in">
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🎨 AI Setup & Design Studio</span>
        <h1 className="font-display mt-3" style={{ fontSize: "clamp(2rem,5vw,3rem)", color: "var(--text-base)" }}>
          Design your space — <span style={{ color: "var(--accent)" }}>smart, real & budget-friendly.</span>
        </h1>
        <p className="mt-2 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          Upload your room (optional), pick a style and budget — get ready-to-shop setup options in seconds.
        </p>
      </div>

      {/* Builder */}
      <div className="mt-7 rounded-3xl p-5 sm:p-7 sb-fade-in"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow-card)" }}>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <Label>Room type</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {ROOM_TYPES.map((r) => (
                <Chip key={r} active={roomType === r} onClick={() => setRoomType(r)}>{r}</Chip>
              ))}
            </div>
          </div>
          <div>
            <Label>Design style <span style={{ color: "var(--text-muted)" }}>(optional — blank = a variety)</span></Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {STYLES.map((s) => (
                <Chip key={s} active={style === s} onClick={() => setStyle(style === s ? "" : s)}>{s}</Chip>
              ))}
            </div>
          </div>
          <div>
            <Label>Budget range (₹, optional)</Label>
            <div className="flex items-center gap-2 mt-2">
              <input value={budgetMin} onChange={(e) => setBudgetMin(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric" placeholder="Min" className="w-full rounded-xl px-3 py-2.5 text-sm" style={inp} />
              <span style={{ color: "var(--text-muted)" }}>—</span>
              <input value={budgetMax} onChange={(e) => setBudgetMax(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric" placeholder="Max" className="w-full rounded-xl px-3 py-2.5 text-sm" style={inp} />
            </div>
          </div>
          <div>
            <Label>Your space (optional — up to 6 photos)</Label>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {images.map((u, i) => (
                <span key={u} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="w-16 h-16 rounded-xl object-cover" style={{ border: "1px solid var(--border-soft)" }} />
                  <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-white text-xs"
                    style={{ background: "#c0392b" }}>✕</button>
                </span>
              ))}
              {images.length < 6 && (
                <label className="w-16 h-16 rounded-xl flex items-center justify-center cursor-pointer text-xl"
                  style={{ border: "1.5px dashed var(--border-strong)", color: "var(--text-muted)" }}>
                  {uploading ? "…" : "＋"}
                  <input type="file" accept="image/*" multiple hidden onChange={onPick} />
                </label>
              )}
            </div>
          </div>
        </div>
        <button onClick={generate} disabled={generating}
          className="w-full sm:w-auto mt-6 px-7 py-3 rounded-full text-white font-semibold disabled:opacity-60 sb-card-lift"
          style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}>
          {generating ? "Designing your space…" : "✨ Generate design options"}
        </button>
      </div>

      {/* Results */}
      <div id="studio-results">
        {options.length > 0 && (
          <div className="mt-9">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <h2 className="font-display" style={{ fontSize: "clamp(1.5rem,4vw,2rem)", color: "var(--text-base)" }}>
                {options.length} setup options for you
              </h2>
              <span className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {aiBacked ? "✨ AI-generated" : "Curated suggestions"}
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-4 sb-stagger">
              {options.map((o, i) => (
                <OptionCard key={o.id || i} o={o} onQuote={() => setQuote(o)} />
              ))}
            </div>
            <div className="mt-5 text-center">
              <button onClick={() => setQuote("all")} className="px-6 py-3 rounded-full text-white font-semibold sb-card-lift"
                style={{ background: "linear-gradient(135deg,#8198ae,#637f9c)" }}>
                💬 Get StayBid to set this up for me
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recent projects */}
      {recent.length > 0 && (
        <div className="mt-10">
          <h3 className="font-semibold mb-3" style={{ color: "var(--text-base)" }}>Your recent designs</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recent.slice(0, 6).map((p) => (
              <button key={p.id} onClick={() => { setOptions(p.options || []); setProvider(p.ai_provider || ""); setTimeout(() => document.getElementById("studio-results")?.scrollIntoView({ behavior: "smooth" }), 40); }}
                className="text-left rounded-2xl p-4 sb-card-lift"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
                <div className="font-semibold text-sm" style={{ color: "var(--text-base)" }}>{p.title}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {(p.options?.length || 0)} options · {new Date(p.created_at).toLocaleDateString("en-IN")}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {quote && <QuoteModal option={quote} roomType={roomType} onClose={() => setQuote(null)} />}
    </div>
  );
}

function OptionCard({ o, onQuote }: { o: Option; onQuote: () => void }) {
  const total = o.est_cost ?? o.estCost ?? o.products.reduce((s, p) => s + p.price * p.qty, 0);
  return (
    <div className="rounded-2xl p-5 flex flex-col" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "#7c3aed1a", color: "#7c3aed" }}>{o.style}</span>
        <span className="font-display text-lg" style={{ color: "var(--accent)" }}>{inr(total)}</span>
      </div>
      <div className="font-semibold mt-2" style={{ color: "var(--text-base)" }}>{o.title}</div>
      <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>{o.description}</p>
      <div className="mt-3 rounded-xl divide-y" style={{ border: "1px solid var(--border-soft)", borderColor: "var(--border-soft)" }}>
        {o.products.map((p, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2 text-sm" style={{ borderColor: "var(--border-soft)" }}>
            <span style={{ color: "var(--text-soft)" }}>{p.name} {p.qty > 1 && <span style={{ color: "var(--text-muted)" }}>×{p.qty}</span>}</span>
            <span className="font-medium" style={{ color: "var(--text-base)" }}>{inr(p.price * p.qty)}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          🛒 Shoppable in StayBid Store — opening soon
        </span>
        <button onClick={onQuote} className="ml-auto text-sm font-semibold" style={{ color: "#7c3aed" }}>Get this setup →</button>
      </div>
    </div>
  );
}

function QuoteModal({ option, roomType, onClose }: { option: Option | "all"; roomType: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const label = option === "all" ? "this design plan" : (option as Option).title;

  async function submit() {
    if (!name.trim() || phone.trim().length < 8) { setState("error"); return; }
    setState("sending");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const r = await fetch("/api/host/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name, phone, interest: "studio", message: `Design Studio quote · ${roomType} · ${label}` }),
      });
      setState(r.ok ? "done" : "error");
    } catch { setState("error"); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-6"
        style={{ background: "var(--bg-card)", color: "var(--text-base)", boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}>
        {state === "done" ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">✅</div>
            <div className="font-display text-2xl">We'll set it up!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>Our team will call you with the full plan & quote.</p>
            <button onClick={onClose} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(135deg,#8198ae,#637f9c)" }}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <div className="font-display text-2xl">Set up {option === "all" ? "your space" : "this design"}</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Share your details — we'll handle sourcing, delivery & installation.</p>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>
            {state === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>Please enter a valid name & phone.</div>}
            <button onClick={submit} disabled={state === "sending"}
              className="w-full mt-4 px-6 py-3 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#7c3aed,#5b21b6)" }}>
              {state === "sending" ? "Sending…" : "Request setup & quote"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold" style={{ color: "var(--text-base)" }}>{children}</div>;
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-sm px-3 py-1.5 rounded-full transition"
      style={active
        ? { background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "#fff" }
        : { background: "var(--bg-pill)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
      {children}
    </button>
  );
}
const inp: React.CSSProperties = { background: "var(--bg-input)", border: "1px solid var(--border-soft)", color: "var(--text-base)" };
