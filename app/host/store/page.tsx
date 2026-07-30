"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { openRazorpayForOrder, RazorpayError } from "@/lib/razorpay";

type Mode = "buy" | "rent" | "emi";
interface Cat { id: string; name: string; slug: string; icon: string; }
interface Product {
  id: string; category_id: string; name: string; brand?: string; description?: string;
  images?: string[]; buy_price?: number; rent_monthly?: number; emi_available?: boolean;
  emi_min_months?: number; rating?: number; reviews_count?: number; featured?: boolean; badges?: string[];
}
interface CartLine { product: Product; mode: Mode; qty: number; }

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export default function HostStore() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [checkout, setCheckout] = useState(false);

  useEffect(() => {
    fetch("/api/host/store")
      .then((r) => r.json())
      .then((d) => { setCats(d.categories || []); setProducts(d.products || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(
    () => activeCat === "all" ? products : products.filter((p) => p.category_id === activeCat),
    [products, activeCat],
  );

  const lines = Object.values(cart);
  const cartCount = lines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = lines.reduce((s, l) => {
    const unit = l.mode === "rent" ? (l.product.rent_monthly || 0) : (l.product.buy_price || 0);
    return s + unit * l.qty;
  }, 0);

  function addToCart(p: Product, mode: Mode) {
    const key = `${p.id}|${mode}`;
    setCart((c) => ({ ...c, [key]: { product: p, mode, qty: (c[key]?.qty || 0) + 1 } }));
  }
  function setQty(key: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[key];
      else next[key] = { ...next[key], qty };
      return next;
    });
  }

  return (
    <div className="hostos-store">
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-6 sb-fade-in">
        <Link href="/host" className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>← StayBid for Hosts</Link>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mt-3 mb-3"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>🛋️ StayBid Store</span>
        <h1 className="font-display leading-tight" style={{ fontSize: "clamp(1.9rem,5vw,3rem)", color: "var(--text-base)" }}>
          Furnish your property. <span style={{ color: "var(--accent)" }}>Buy, Rent or EMI.</span>
        </h1>
        <p className="mt-3 max-w-2xl" style={{ color: "var(--text-soft)" }}>
          Genuine, hotel-grade furniture, appliances & amenities at the best prices —
          delivered & installed pan-India.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["100% Genuine", "Best Prices", "Pan-India Delivery", "Installation Support"].map((t) => (
            <span key={t} className="text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>✓ {t}</span>
          ))}
        </div>
      </section>

      {/* Category chips */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-4 sticky top-0 z-20" style={{ background: "var(--bg-page)" }}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
          <Chip active={activeCat === "all"} onClick={() => setActiveCat("all")}>All</Chip>
          {cats.map((c) => (
            <Chip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>{c.icon} {c.name}</Chip>
          ))}
        </div>
      </div>

      {/* Products */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-28">
        {loading ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>Loading the store…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>No products in this category yet.</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sb-stagger">
            {shown.map((p) => <ProductCard key={p.id} p={p} onAdd={addToCart} />)}
          </div>
        )}
      </section>

      {/* Sticky cart bar */}
      {cartCount > 0 && !checkout && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-md sb-fade-in">
          <button onClick={() => setCheckout(true)}
            className="w-full flex items-center justify-between px-5 py-3.5 rounded-full text-white font-semibold shadow-lg"
            style={{ background: "linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
            <span>{cartCount} item{cartCount > 1 ? "s" : ""}</span>
            <span>View cart · {inr(cartTotal)} →</span>
          </button>
        </div>
      )}

      {checkout && (
        <CheckoutSheet
          cart={cart}
          onQty={setQty}
          onClose={() => setCheckout(false)}
          onClear={() => { setCart({}); setCheckout(false); }}
        />
      )}

      <style jsx global>{`.no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="whitespace-nowrap text-sm font-medium px-4 py-2 rounded-full sb-card-lift"
      style={active
        ? { background: "var(--accent)", color: "#fff" }
        : { background: "var(--bg-card)", color: "var(--text-soft)", border: "1px solid var(--border-soft)" }}>
      {children}
    </button>
  );
}

function ProductCard({ p, onAdd }: { p: Product; onAdd: (p: Product, m: Mode) => void }) {
  const modes: Mode[] = ["buy"];
  if (p.rent_monthly != null) modes.push("rent");
  if (p.emi_available) modes.push("emi");
  const [mode, setMode] = useState<Mode>("buy");
  const img = p.images?.[0];

  return (
    <div className="sb-card-lift h-full rounded-2xl overflow-hidden flex flex-col"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>
      <div className="relative aspect-[4/3]" style={{ background: "var(--bg-input)" }}>
        {img && <img src={img} alt={p.name} loading="lazy" className="w-full h-full object-cover" />}
        {p.badges?.[0] && (
          <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full text-white"
            style={{ background: "rgba(31,26,15,0.78)" }}>{p.badges[0]}</span>
        )}
      </div>
      <div className="p-3 flex flex-col flex-1">
        {p.brand && <div className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{p.brand}</div>}
        <div className="font-semibold text-sm leading-snug" style={{ color: "var(--text-base)" }}>{p.name}</div>
        {p.rating != null && (
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            ⭐ {p.rating} · {p.reviews_count || 0} reviews
          </div>
        )}

        {/* mode toggle */}
        {modes.length > 1 && (
          <div className="flex gap-1 mt-2">
            {modes.map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className="text-[11px] font-semibold px-2 py-1 rounded-full"
                style={mode === m
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "var(--accent-soft)", color: "var(--accent)" }}>
                {m === "buy" ? "Buy" : m === "rent" ? "Rent" : "EMI"}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex-1">
          {mode === "rent" ? (
            <div className="font-display text-lg" style={{ color: "var(--accent)" }}>{inr(p.rent_monthly || 0)}<span className="text-xs" style={{ color: "var(--text-muted)" }}>/mo</span></div>
          ) : mode === "emi" ? (
            <div>
              <div className="font-display text-lg" style={{ color: "var(--accent)" }}>{inr(Math.round((p.buy_price || 0) / (p.emi_min_months || 6)))}<span className="text-xs" style={{ color: "var(--text-muted)" }}>/mo</span></div>
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{p.emi_min_months || 6} mo · {inr(p.buy_price || 0)} total</div>
            </div>
          ) : (
            <div className="font-display text-lg" style={{ color: "var(--accent)" }}>{inr(p.buy_price || 0)}</div>
          )}
        </div>

        <button onClick={() => onAdd(p, mode)}
          className="mt-2 w-full px-3 py-2 rounded-full text-white font-semibold text-sm"
          style={{ background: "linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>Add to cart</button>
      </div>
    </div>
  );
}

function CheckoutSheet({ cart, onQty, onClose, onClear }: {
  cart: Record<string, CartLine>;
  onQty: (key: string, qty: number) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const lines = Object.entries(cart);
  const subtotal = lines.reduce((s, [, l]) => {
    const unit = l.mode === "rent" ? (l.product.rent_monthly || 0) : (l.product.buy_price || 0);
    return s + unit * l.qty;
  }, 0);
  const hasEmi = lines.some(([, l]) => l.mode === "emi");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addr, setAddr] = useState("");
  const [emiMonths, setEmiMonths] = useState(6);
  const [status, setStatus] = useState<"idle" | "paying" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function pay() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 8) { setErr("Enter a valid name & phone."); setStatus("error"); return; }
    setStatus("paying"); setErr("");
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("sb_token") : null;
      const items = lines.map(([, l]) => ({ productId: l.product.id, mode: l.mode, qty: l.qty }));
      const co = await fetch("/api/host/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          items, emiMonths: hasEmi ? emiMonths : 0,
          contact: { name, phone, email },
          address: addr ? { line: addr } : null,
        }),
      });
      const cj = await co.json();
      if (!co.ok || !cj?.razorpayOrderId) throw new Error(cj?.error || "Could not start payment.");

      const res = await openRazorpayForOrder({
        orderId: cj.razorpayOrderId,
        amountPaise: Math.round(cj.amount * 100),
        keyId: cj.keyId,
        description: "StayBid Store order",
        userName: name, userPhone: phone, userEmail: email,
      });

      const vr = await fetch("/api/host/store/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ orderId: cj.orderId, ...res }),
      });
      const vj = await vr.json();
      if (!vr.ok || !vj?.ok) throw new Error(vj?.error || "Payment verification failed.");
      setStatus("done");
    } catch (e: any) {
      if (e instanceof RazorpayError && e.message === "__CANCELLED__") { setStatus("idle"); return; }
      setErr(e?.message || "Something went wrong."); setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 max-h-[92dvh] overflow-y-auto"
        style={{ background: "var(--bg-card)", color: "var(--text-base)", boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}>
        {status === "done" ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-2">🎉</div>
            <div className="font-display text-2xl">Order placed!</div>
            <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
              We'll arrange delivery & installation. You'll get a confirmation shortly.
            </p>
            <button onClick={onClear} className="mt-5 px-6 py-2.5 rounded-full text-white font-semibold"
              style={{ background: "linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>Continue shopping</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="font-display text-xl">Your cart</div>
              <button onClick={onClose} className="text-xl px-2" style={{ color: "var(--text-muted)" }}>✕</button>
            </div>

            <div className="space-y-2.5">
              {lines.map(([key, l]) => {
                const unit = l.mode === "rent" ? (l.product.rent_monthly || 0) : (l.product.buy_price || 0);
                return (
                  <div key={key} className="flex items-center gap-3 rounded-2xl p-2.5"
                    style={{ background: "var(--bg-input)" }}>
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0" style={{ background: "var(--bg-card)" }}>
                      {l.product.images?.[0] && <img src={l.product.images[0]} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{l.product.name}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {l.mode === "rent" ? "Rent" : l.mode === "emi" ? "EMI" : "Buy"} · {inr(unit)}{l.mode === "rent" ? "/mo" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onQty(key, l.qty - 1)} className="w-7 h-7 rounded-full font-bold" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>−</button>
                      <span className="text-sm w-5 text-center">{l.qty}</span>
                      <button onClick={() => onQty(key, l.qty + 1)} className="w-7 h-7 rounded-full font-bold" style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {hasEmi && (
              <div className="mt-4">
                <div className="text-sm font-semibold mb-1.5">EMI tenure</div>
                <div className="flex gap-2">
                  {[3, 6, 9, 12].map((m) => (
                    <button key={m} onClick={() => setEmiMonths(m)}
                      className="text-sm font-semibold px-3 py-1.5 rounded-full"
                      style={emiMonths === m ? { background: "var(--accent)", color: "#fff" } : { background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {m} mo
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-2.5">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
              <textarea value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Delivery address" rows={2} className="w-full rounded-xl px-4 py-3 text-sm" style={inp} />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span style={{ color: "var(--text-muted)" }}>{hasEmi ? "First instalment" : "Total payable"}</span>
              <span className="font-display text-2xl" style={{ color: "var(--accent)" }}>
                {inr(hasEmi ? Math.round(subtotal / emiMonths) : subtotal)}
              </span>
            </div>

            {status === "error" && <div className="text-sm mt-2" style={{ color: "#c0392b" }}>{err}</div>}

            <button onClick={pay} disabled={status === "paying"}
              className="w-full mt-3 px-6 py-3.5 rounded-full text-white font-semibold disabled:opacity-60"
              style={{ background: "linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%)" }}>
              {status === "paying" ? "Opening payment…" : `Pay ${inr(hasEmi ? Math.round(subtotal / emiMonths) : subtotal)}`}
            </button>
            <p className="text-[11px] text-center mt-2" style={{ color: "var(--text-muted)" }}>Secure payment via Razorpay · prices set server-side</p>
          </>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-soft)",
  color: "var(--text-base)",
};
