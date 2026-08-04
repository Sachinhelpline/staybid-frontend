"use client";
//
// v173 — Public F&B ordering page (Phase 2).
//
// A guest scans the in-room / outlet QR → lands here → branded hotel
// menu → builds a cart → places an order. The order lands in
// food_orders (pending); the hotel verifies it in the partner panel.
//
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

function fmtCur(n: number) { return "₹" + Math.round(n || 0).toLocaleString("en-IN"); }

const FOOD: Record<string, string> = { veg: "#15803d", nonveg: "#b91c1c", egg: "#b45309" };
function FoodMark({ type }: { type: string }) {
  const c = FOOD[type] || FOOD.veg;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 14, height: 14, border: `1.5px solid ${c}`, borderRadius: 3 }}>
      <span style={{ width: 6, height: 6, borderRadius: type === "nonveg" ? 0 : 999, background: c }} />
    </span>
  );
}

type Line = { itemId: string; name: string; portionLabel: string; price: number; qty: number; foodType: string };

export default function OrderPage() {
  const params = useParams();
  const outletId = String(params?.outlet || "");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [loc, setLoc] = useState("");
  const [gname, setGname] = useState("");
  const [gphone, setGphone] = useState("");
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/order/${encodeURIComponent(outletId)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Menu not found");
      setData(d);
    } catch (e: any) { setErr(e?.message || "Menu load failed"); }
    finally { setLoading(false); }
  }, [outletId]);
  useEffect(() => { load(); }, [load]);

  const cartLines = Object.values(cart);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cartLines.reduce((s, l) => s + l.price * l.qty, 0);

  function addLine(item: any, portion: any) {
    const key = `${item.id}|${portion.label || ""}`;
    setCart((c) => {
      const ex = c[key];
      return { ...c, [key]: {
        itemId: item.id, name: item.name, portionLabel: portion.label || "",
        price: Number(portion.price) || 0, qty: (ex?.qty || 0) + 1, foodType: item.food_type || "veg",
      } };
    });
  }
  function setQty(key: string, qty: number) {
    setCart((c) => {
      if (qty <= 0) { const n = { ...c }; delete n[key]; return n; }
      return { ...c, [key]: { ...c[key], qty } };
    });
  }

  async function placeOrder() {
    if (!loc.trim()) { alert("Please enter a room or table number."); return; }
    if (!cartLines.length) return;
    setPlacing(true);
    try {
      const r = await fetch(`/api/order/${encodeURIComponent(outletId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: loc.trim(), guestName: gname.trim(), guestPhone: gphone.trim(), note: note.trim(),
          items: cartLines.map((l) => ({ itemId: l.itemId, portionLabel: l.portionLabel, qty: l.qty })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "Order failed");
      setPlaced({ ...d, lines: cartLines, loc: loc.trim() });
      setCart({}); setCartOpen(false);
    } catch (e: any) { alert("❌ " + (e?.message || "Order failed")); }
    finally { setPlacing(false); }
  }

  const isRoom = data?.outlet?.type === "room_service";
  const locLabel = isRoom ? "Room number" : data?.outlet?.type === "restaurant" ? "Table number" : "Room / Table";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg-page)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        body { font-family:'Inter',sans-serif; margin:0; }
        .od-disp { font-family:'Cormorant Garamond',serif; }
        .od-card { background:var(--bg-card); border:1px solid var(--border-soft); border-radius:14px; }
        .od-btn { background:radial-gradient(88% 64% at 32% 4%,rgba(240,247,253,0.24),transparent 58%),linear-gradient(160deg,#a0b2c6 0%,#6f8aa6 50%,#42566d 100%); color:#fff; border:none; border-radius:11px; font-weight:700; cursor:pointer; transition:all .15s; }
        .od-btn:active { transform:scale(.98); }
        .od-btn:disabled { opacity:.5; }
        .od-step { width:26px; height:26px; border-radius:8px; border:1px solid var(--border-strong); background:var(--bg-card); color:var(--accent); font-weight:800; font-size:15px; line-height:1; cursor:pointer; }
        .od-inp { width:100%; background:var(--bg-input); border:1px solid var(--border-strong); border-radius:10px; padding:10px 12px; font-size:0.86rem; outline:none; color:var(--text-base); }
        .od-inp::placeholder { color:var(--text-muted); }
        .od-inp:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(106, 133, 160,.13); }
      `}</style>

      {loading ? (
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 38, height: 38, border: "3px solid var(--border-strong)", borderTopColor: "transparent", borderRadius: 999, animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : err ? (
        <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 40 }}>🍽️</p>
          <p style={{ fontWeight: 700, color: "var(--text-base)" }}>{err}</p>
          <p style={{ fontSize: 13, color: "var(--text-soft)", marginTop: 4 }}>Is the QR code correct? Please confirm with the hotel.</p>
        </div>
      ) : placed ? (
        <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, color: "#fff" }}>✓</div>
          <p className="od-disp" style={{ fontSize: 26, color: "var(--text-base)", marginTop: 14, fontWeight: 600 }}>Order placed!</p>
          <p style={{ fontSize: 13, color: "var(--text-soft)", marginTop: 2 }}>
            {locLabel}: <b>{placed.loc}</b> · {fmtCur(placed.total)}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 10, maxWidth: 320 }}>
            {data?.hotel?.name} will verify and prepare your order. The bill will be added to your room folio.
          </p>
          <button className="od-btn" style={{ padding: "10px 22px", marginTop: 18, fontSize: 14 }}
            onClick={() => setPlaced(null)}>Order more</button>
        </div>
      ) : (
        <>
          {/* header */}
          <div style={{ background: "linear-gradient(135deg,#1c140a,#2b2010)", padding: "18px 16px 16px", color: "#fff" }}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a9b9c8", fontWeight: 700 }}>
              {isRoom ? "🛎 Room Service" : data?.outlet?.type === "restaurant" ? "🍴 Restaurant" : "🍴 Menu"} · {data?.outlet?.name}
            </p>
            <p className="od-disp" style={{ fontSize: 26, fontWeight: 600, marginTop: 2 }}>{data?.hotel?.name}</p>
            {data?.hotel?.city && <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{data.hotel.city}</p>}
          </div>

          <div style={{ padding: "14px 14px 120px", maxWidth: 640, margin: "0 auto" }}>
            {(data?.items || []).length === 0 ? (
              <div className="od-card" style={{ padding: 28, textAlign: "center", color: "var(--text-soft)" }}>
                <p style={{ fontSize: 30 }}>🍽️</p>
                <p style={{ fontWeight: 600, color: "var(--text-base)" }}>The menu is being prepared</p>
              </div>
            ) : (
              <MenuList data={data} cart={cart} onAdd={addLine} onSetQty={setQty} />
            )}
          </div>

          {/* sticky cart bar */}
          {cartCount > 0 && (
            <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 14px calc(10px + env(safe-area-inset-bottom,0px))", background: "rgba(176, 192, 209,0.96)", backdropFilter: "blur(8px)", borderTop: "1px solid var(--border-soft)" }}>
              <button className="od-btn" style={{ width: "100%", maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", fontSize: 15 }}
                onClick={() => setCartOpen(true)}>
                <span>{cartCount} item{cartCount > 1 ? "s" : ""}</span>
                <span>View cart · {fmtCur(cartTotal)} ›</span>
              </button>
            </div>
          )}

          {/* cart sheet */}
          {cartOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(10,8,5,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
              onClick={() => setCartOpen(false)}>
              <div style={{ background: "var(--bg-page)", width: "100%", maxWidth: 640, borderRadius: "18px 18px 0 0", maxHeight: "90dvh", display: "flex", flexDirection: "column" }}
                onClick={(e) => e.stopPropagation()}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                  <p className="od-disp" style={{ fontSize: 20, fontWeight: 600, color: "var(--text-base)" }}>Your order</p>
                  <button onClick={() => setCartOpen(false)} style={{ width: 30, height: 30, borderRadius: 999, border: "none", background: "var(--bg-pill)", fontSize: 17, cursor: "pointer" }}>×</button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
                  {cartLines.map((l) => {
                    const key = `${l.itemId}|${l.portionLabel}`;
                    return (
                      <div key={key} className="od-card" style={{ padding: 10, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
                        <FoodMark type={l.foodType} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-base)" }}>{l.name}</p>
                          <p style={{ fontSize: 11.5, color: "var(--text-soft)" }}>{l.portionLabel ? l.portionLabel + " · " : ""}{fmtCur(l.price)}</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button className="od-step" onClick={() => setQty(key, l.qty - 1)}>−</button>
                          <span style={{ fontWeight: 800, fontSize: 14, minWidth: 16, textAlign: "center" }}>{l.qty}</span>
                          <button className="od-step" onClick={() => setQty(key, l.qty + 1)}>+</button>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <input className="od-inp" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder={`${locLabel} *`} />
                    <input className="od-inp" value={gname} onChange={(e) => setGname(e.target.value)} placeholder="Your name (optional)" />
                    <input className="od-inp" value={gphone} onChange={(e) => setGphone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" />
                    <input className="od-inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Special instructions (optional)" />
                  </div>
                </div>
                <div style={{ padding: "12px 16px calc(12px + env(safe-area-inset-bottom,0px))", borderTop: "1px solid var(--border-soft)", flexShrink: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14, fontWeight: 700, color: "var(--text-base)" }}>
                    <span>Total</span><span>{fmtCur(cartTotal)}</span>
                  </div>
                  <button className="od-btn" style={{ width: "100%", padding: 13, fontSize: 15 }}
                    onClick={placeOrder} disabled={placing}>
                    {placing ? "Placing…" : "Place Order"}
                  </button>
                  <p style={{ fontSize: 10.5, color: "var(--text-soft)", textAlign: "center", marginTop: 7 }}>
                    The hotel will verify your order · bill added to your folio
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MenuList({ data, cart, onAdd, onSetQty }: any) {
  const items: any[] = data?.items || [];
  const cats: any[] = data?.categories || [];
  const groups = useMemo(() => {
    const out: { cat: any; list: any[] }[] = [];
    cats.forEach((c: any) => {
      const list = items.filter((i) => i.category_id === c.id);
      if (list.length) out.push({ cat: c, list });
    });
    const none = items.filter((i) => !i.category_id || !cats.some((c: any) => c.id === i.category_id));
    if (none.length) out.push({ cat: { id: "_none", name: "More" }, list: none });
    return out;
  }, [items, cats]);

  return (
    <>
      {groups.map((g) => (
        <div key={g.cat.id} style={{ marginBottom: 16 }}>
          <p className="od-disp" style={{ fontSize: 18, fontWeight: 600, color: "var(--text-base)", margin: "4px 2px 8px" }}>{g.cat.name}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.list.map((it: any) => (
              <div key={it.id} className="od-card" style={{ padding: 11, display: "flex", gap: 11 }}>
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image} alt="" style={{ width: 70, height: 70, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 70, height: 70, borderRadius: 10, background: "var(--bg-pill)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>🍽️</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FoodMark type={it.food_type} />
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-base)" }}>{it.name}</p>
                  </div>
                  {it.description && <p style={{ fontSize: 11.5, color: "var(--text-soft)", marginTop: 2, lineHeight: 1.35 }}>{it.description}</p>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                    {(Array.isArray(it.portions) ? it.portions : []).map((p: any, i: number) => {
                      const key = `${it.id}|${p.label || ""}`;
                      const inCart = cart[key];
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {inCart ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border-strong)", borderRadius: 9, padding: "2px 4px" }}>
                              <button className="od-step" onClick={() => onSetQty(key, inCart.qty - 1)}>−</button>
                              <span style={{ fontWeight: 800, fontSize: 13, minWidth: 14, textAlign: "center" }}>{inCart.qty}</span>
                              <button className="od-step" onClick={() => onSetQty(key, inCart.qty + 1)}>+</button>
                              <span style={{ fontSize: 11, color: "var(--text-soft)", paddingRight: 4 }}>{p.label}</span>
                            </div>
                          ) : (
                            <button onClick={() => onAdd(it, p)}
                              style={{ border: "1px solid var(--border-strong)", background: "var(--bg-pill)", borderRadius: 9, padding: "5px 10px", fontSize: 12, fontWeight: 700, color: "var(--text-base)", cursor: "pointer" }}>
                              + {p.label ? p.label + " " : ""}{fmtCur(p.price)}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
