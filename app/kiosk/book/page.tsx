"use client";
//
// StayBid Offline Kiosk — TOUCHSCREEN BOOKING (premium cozy)
//
// Mirrors the REAL flash-deal architecture (browse → hotel tour with photo
// gallery + amenities + room/upgrade picker → confirm & pay), in the same
// premium cozy theme as the customer frontend. Fully server-mediated booking
// (`/api/kiosk/book`) so the shared device never stores a customer token.
// Live deals + the upgrade ladder come from the same flash engine the
// customer site uses (wired to hotels + admin).
//
//   EXPLORE — pick city → browse hotels
//   BOOK    — hotel tour: gallery, amenities, room + upgrade picker
//   PAY     — guests/nights + phone + OTP → confirmation
//
// Configure default city:  /kiosk/book?loc=mussoorie-mall
//
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { formatINR, KioskDeal, KIOSK_CITIES, resolveKioskLocation } from "@/lib/kiosk";

type Step = "city" | "browse" | "tour" | "pay" | "done";

const NAV: { key: Step; label: string; icon: string }[] = [
  { key: "city", label: "Explore", icon: "🧭" },
  { key: "tour", label: "Book", icon: "🏨" },
  { key: "pay", label: "Pay", icon: "💳" },
];

function Stars({ n }: { n: number }) {
  return <span className="kb-stars">{"★".repeat(Math.max(1, Math.min(5, Math.round(n))))}</span>;
}

function BookInner() {
  const params = useSearchParams();
  const loc = resolveKioskLocation(params.get("loc"));

  const [step, setStep] = useState<Step>("city");
  const [city, setCity] = useState<string>("");
  const [deals, setDeals] = useState<KioskDeal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [picked, setPicked] = useState<KioskDeal | null>(null);

  const [galleryIdx, setGalleryIdx] = useState(0);
  const [pickedRoomId, setPickedRoomId] = useState<string>("");

  const [guests, setGuests] = useState(2);
  const [nights, setNights] = useState(1);
  const [rooms, setRooms] = useState(1);
  const [roomsTouched, setRoomsTouched] = useState(false);

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<any>(null);

  const loadDeals = useCallback(async (c: string) => {
    setLoadingDeals(true);
    setErr("");
    try {
      const r = await fetch(`/api/kiosk/feed?loc=${encodeURIComponent(loc.id)}&city=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j = await r.json();
      setDeals(Array.isArray(j?.deals) ? j.deals : []);
    } catch {
      setDeals([]);
      setErr("Could not load deals. Try again.");
    } finally {
      setLoadingDeals(false);
    }
  }, [loc.id]);

  function chooseCity(c: string) {
    setCity(c);
    setStep("browse");
    loadDeals(c);
  }

  function openTour(d: KioskDeal) {
    setPicked(d);
    setPickedRoomId(d.roomId);
    setGalleryIdx(0);
    setGuests(Math.min(d.capacity || 2, 2));
    setRooms(1); setRoomsTouched(false);
    setStep("tour");
    setErr("");
  }

  // Selected room price (headline OR an upgrade).
  const selected = useMemo(() => {
    if (!picked) return null;
    if (pickedRoomId === picked.roomId) {
      return { roomId: picked.roomId, type: picked.roomType, price: picked.aiPrice, floor: picked.floorPrice, capacity: picked.capacity };
    }
    const u = picked.upgrades.find((x: any) => x.roomId === pickedRoomId);
    if (u) return { roomId: u.roomId, type: u.type, price: u.dealPrice, floor: u.floorPrice, capacity: u.capacity };
    return { roomId: picked.roomId, type: picked.roomType, price: picked.aiPrice, floor: picked.floorPrice, capacity: picked.capacity };
  }, [picked, pickedRoomId]);

  // StayBid rule: number of rooms auto-fits the guest count (hybrid — auto
  // until the customer manually overrides). One room per `capacity` guests.
  const cap = selected?.capacity || 2;
  const minRooms = Math.max(1, Math.ceil(guests / cap));
  useEffect(() => {
    if (!roomsTouched && rooms < minRooms) setRooms(Math.min(10, minRooms));
  }, [minRooms, roomsTouched, rooms]);

  function goPay() {
    setStep("pay");
    setOtpSent(false); setOtp(""); setPhone(""); setErr("");
  }

  function reset() {
    setStep("city"); setCity(""); setDeals([]); setPicked(null); setPickedRoomId("");
    setNights(1); setGuests(2); setRooms(1); setRoomsTouched(false);
    setPhone(""); setOtp(""); setOtpSent(false); setErr(""); setResult(null); setBusy(false);
  }

  async function sendOtp() {
    setErr("");
    const clean = phone.replace(/\s/g, "");
    if (!/^(\+?91)?[6-9]\d{9}$/.test(clean)) { setErr("Enter a valid 10-digit mobile number"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/kiosk/send-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: clean }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j?.error || "Could not send OTP"); return; }
      setOtpSent(true);
    } catch { setErr("OTP service unavailable. Try again."); }
    finally { setBusy(false); }
  }

  async function confirmBooking() {
    if (!picked || !selected) return;
    setErr("");
    if (!/^\d{4,6}$/.test(otp.trim())) { setErr("Enter the OTP sent to your phone"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/kiosk/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.replace(/\s/g, ""), otp: otp.trim(),
          hotelId: picked.hotelId, roomId: selected.roomId, dealId: picked.id,
          amount: selected.price, guests, nights, rooms,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setErr(j?.error || "Booking failed. Try again."); return; }
      setResult(j);
      setStep("done");
    } catch { setErr("Booking service unavailable. Try again."); }
    finally { setBusy(false); }
  }

  const price = selected?.price || 0;
  const total = price * nights * rooms;
  const checkInDate = new Date();
  const checkOutDate = new Date(); checkOutDate.setDate(checkOutDate.getDate() + Math.max(1, nights));
  const fmtD = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const activeNav: Step = step === "browse" ? "city" : step === "done" ? "pay" : step;

  return (
    <div className="kb-root">
      {/* Header */}
      <div className="kb-top">
        <div className="kb-brand">
          <span className="kb-brand-mark">⛰</span>
          <span className="kb-brand-name">Stay<b>Bid</b></span>
          <span className="kb-brand-tag">Flash Booking</span>
        </div>
        <div className="kb-nav">
          {NAV.map((n) => (
            <div key={n.key} className={`kb-nav-item ${activeNav === n.key ? "on" : ""}`}>
              <span>{n.icon}</span>{n.label}
            </div>
          ))}
        </div>
        <div className="kb-loc">📍 {loc.name}</div>
      </div>

      <div className="kb-scroll">
        {/* CITY */}
        {step === "city" && (
          <div className="kb-pane">
            <div className="kb-h1">Namasté! <span>Where to tonight?</span></div>
            <div className="kb-sub">Same-day flash deals · best price guaranteed</div>
            <div className="kb-city-grid">
              {KIOSK_CITIES.map((c) => (
                <button key={c.city} className="kb-city" onClick={() => chooseCity(c.city)}>
                  <div className="kb-city-emoji">{c.emoji}</div>
                  <div className="kb-city-name">{c.city}</div>
                  <div className="kb-city-sub">See live deals →</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* BROWSE */}
        {step === "browse" && (
          <div className="kb-pane">
            <div className="kb-rowtop">
              <button className="kb-back" onClick={() => setStep("city")} aria-label="Back to cities">‹</button>
              <div className="kb-head">
                <div className="kb-eyebrow"><span className="kb-livedot" />Live now · {deals.length} hotel{deals.length !== 1 ? "s" : ""}</div>
                <h2 className="kb-h2">Tonight in <span>{city}</span></h2>
              </div>
            </div>
            {loadingDeals ? (
              <div className="kb-skeleton">{[1,2,3,4].map(i => <div key={i} className="kb-skel-card" />)}</div>
            ) : deals.length === 0 ? (
              <div className="kb-empty">No same-day deals in {city} right now. Try another city. ⏳</div>
            ) : (
              <div className="kb-grid">
                {deals.map((d) => (
                  <button key={d.id} className="kb-card" onClick={() => openTour(d)}>
                    <div className="kb-card-img" style={{ backgroundImage: `url(${d.image})` }}>
                      {d.discount >= 10 ? <div className="kb-card-disc">−{d.discount}%</div> : null}
                      <div className="kb-card-left">{d.unitsFree} left</div>
                    </div>
                    <div className="kb-card-body">
                      <div className="kb-card-name">{d.hotelName}</div>
                      <div className="kb-card-meta"><Stars n={d.stars} />{d.area ? <span> · {d.area}</span> : null}{d.distanceKm ? <span> · {d.distanceKm} km</span> : null}</div>
                      <div className="kb-card-foot">
                        <div className="kb-card-price">
                          {formatINR(d.aiPrice)}<span>/night</span>
                          {d.mrp > d.aiPrice ? <em>{formatINR(d.mrp)}</em> : null}
                        </div>
                        <div className="kb-card-cta">View →</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TOUR — hotel view + room/upgrade picker */}
        {step === "tour" && picked && (
          <div className="kb-pane">
            <div className="kb-rowtop">
              <button className="kb-back" onClick={() => setStep("browse")} aria-label="Back to hotels">‹</button>
              <div className="kb-head">
                <div className="kb-eyebrow">📍 {picked.city}{picked.area ? ` · ${picked.area}` : ""}</div>
                <h2 className="kb-h2">{picked.hotelName}</h2>
              </div>
            </div>

            <div className="kb-tour">
              {/* Gallery */}
              <div className="kb-gallery">
                <div className="kb-gallery-main" style={{ backgroundImage: `url(${picked.images[galleryIdx] || picked.image})` }}>
                  <div className="kb-gallery-badge">⚡ Flash · −{picked.discount}%</div>
                </div>
                {picked.images.length > 1 && (
                  <div className="kb-thumbs">
                    {picked.images.slice(0, 6).map((im, i) => (
                      <button key={i} className={`kb-thumb ${i === galleryIdx ? "on" : ""}`} style={{ backgroundImage: `url(${im})` }} onClick={() => setGalleryIdx(i)} />
                    ))}
                  </div>
                )}
                <div className="kb-hotel-line">
                  <Stars n={picked.stars} />
                  {picked.avgRating > 0 ? <span className="kb-rating">★ {picked.avgRating.toFixed(1)}</span> : null}
                  {picked.distanceKm ? <span className="kb-distance">📍 {picked.distanceKm} km away</span> : null}
                </div>
                {picked.amenities.length > 0 && (
                  <div className="kb-amen">
                    {picked.amenities.slice(0, 8).map((a, i) => <span key={i} className="kb-amen-chip">{a}</span>)}
                  </div>
                )}
              </div>

              {/* Rooms + upgrades */}
              <div className="kb-rooms-col">
                <div className="kb-section-title">Choose your room</div>
                <div className="kb-rooms">
                  <button className={`kb-room ${pickedRoomId === picked.roomId ? "on" : ""}`} onClick={() => setPickedRoomId(picked.roomId)}>
                    <div className="kb-room-l">
                      <div className="kb-room-type">{picked.roomType} <span className="kb-tag base">Best price</span></div>
                      <div className="kb-room-meta">Sleeps {picked.capacity} · {picked.unitsFree} unit{picked.unitsFree !== 1 ? "s" : ""} free</div>
                    </div>
                    <div className="kb-room-r">
                      <div className="kb-room-price">{formatINR(picked.aiPrice)}</div>
                      {picked.floorPrice > picked.aiPrice ? <div className="kb-room-strike">{formatINR(picked.floorPrice)}</div> : null}
                    </div>
                  </button>
                  {picked.upgrades.length === 0 && (
                    <div className="kb-room-empty">Only one room type available at this hotel tonight.</div>
                  )}
                  {picked.upgrades.map((u: any) => (
                    <button
                      key={u.roomId}
                      className={`kb-room ${pickedRoomId === u.roomId ? "on" : ""} ${!u.available ? "soldout" : ""}`}
                      onClick={() => u.available && setPickedRoomId(u.roomId)}
                      disabled={!u.available}
                    >
                      <div className="kb-room-l">
                        <div className="kb-room-type">
                          {u.type}
                          {u.extraPerNight > 0 && u.available ? <span className="kb-tag gold">+{formatINR(u.extraPerNight)}</span> : null}
                        </div>
                        <div className="kb-room-meta">Sleeps {u.capacity} · {u.available ? `${u.unitsFree} unit${u.unitsFree !== 1 ? "s" : ""} free` : "fully booked"}</div>
                      </div>
                      <div className="kb-room-r">
                        <div className="kb-room-price" style={{ opacity: u.available ? 1 : 0.4 }}>{formatINR(u.dealPrice)}</div>
                        {u.floorPrice > u.dealPrice ? <div className="kb-room-strike">{formatINR(u.floorPrice)}</div> : null}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="kb-rules">
                  <div className="kb-section-title">How this deal works</div>
                  <ul>
                    <li><span>🕒</span> Same-day only · expires midnight, auto-refreshes tomorrow</li>
                    <li><span>🛏️</span> Pick the headline room or upgrade above</li>
                    <li><span>🚫</span> Sold rooms hidden live · no double-booking</li>
                    <li><span>💳</span> Instant confirmation · pay only the shown price</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Sticky CTA */}
            <div className="kb-stickycta">
              <div className="kb-stickyinfo">
                <div className="kb-sticky-type">{selected?.type}</div>
                <div className="kb-sticky-price">
                  {selected && selected.floor > selected.price ? <span className="kb-sticky-strike">{formatINR(selected.floor)}</span> : null}
                  {formatINR(price)}<span>/night</span>
                </div>
              </div>
              <button className="kb-primary" onClick={goPay}>Book this room →</button>
            </div>
          </div>
        )}

        {/* PAY */}
        {step === "pay" && picked && selected && (
          <div className="kb-pane">
            <div className="kb-rowtop">
              <button className="kb-back" onClick={() => setStep("tour")} aria-label="Back">‹</button>
              <div className="kb-head">
                <div className="kb-eyebrow">⚡ Almost there</div>
                <h2 className="kb-h2">Confirm &amp; Pay</h2>
              </div>
            </div>
            <div className="kb-pay">
              <div className="kb-pay-summary">
                <div className="kb-ps-img" style={{ backgroundImage: `url(${picked.image})` }} />
                <div className="kb-ps-info">
                  <div className="kb-ps-name">{picked.hotelName}</div>
                  <div className="kb-ps-room">{selected.type} · {picked.city}</div>
                </div>
              </div>
              <div className="kb-datestrip">
                <div className="kb-date"><span>Check-in</span><b>{fmtD(checkInDate)}</b></div>
                <div className="kb-datearrow">→</div>
                <div className="kb-date"><span>Check-out</span><b>{fmtD(checkOutDate)}</b></div>
                <div className="kb-datenights">{nights} night{nights > 1 ? "s" : ""}</div>
              </div>
              <div className="kb-tiles">
                <div className="kb-tile"><span>Nights</span>
                  <div className="kb-step2"><button onClick={() => setNights(n => Math.max(1, n - 1))}>−</button><b>{nights}</b><button onClick={() => setNights(n => Math.min(10, n + 1))}>+</button></div>
                </div>
                <div className="kb-tile"><span>Guests</span>
                  <div className="kb-step2"><button onClick={() => setGuests(g => Math.max(1, g - 1))}>−</button><b>{guests}</b><button onClick={() => setGuests(g => Math.min(20, g + 1))}>+</button></div>
                </div>
                <div className="kb-tile"><span>Rooms{!roomsTouched && rooms === minRooms && minRooms > 1 ? " ✨" : ""}</span>
                  <div className="kb-step2"><button onClick={() => { setRoomsTouched(true); setRooms(r => Math.max(1, r - 1)); }}>−</button><b>{rooms}</b><button onClick={() => { setRoomsTouched(true); setRooms(r => Math.min(10, r + 1)); }}>+</button></div>
                </div>
              </div>
              {guests > cap * rooms ? (
                <div className="kb-caphint">ℹ️ {guests} guests in {rooms} room{rooms > 1 ? "s" : ""} — the hotel may add extra bedding on arrival.</div>
              ) : null}
              <div className="kb-rate"><span>{formatINR(price)} × {nights} night{nights > 1 ? "s" : ""}{rooms > 1 ? ` × ${rooms} rooms` : ""}</span><b>{formatINR(total)}</b></div>

              <label className="kb-label">📱 Mobile Number</label>
              <div className="kb-phonerow">
                <span className="kb-cc">+91</span>
                <input className="kb-input" inputMode="numeric" placeholder="10-digit number" value={phone} maxLength={13}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))} disabled={otpSent} />
              </div>
              {!otpSent ? (
                <button className="kb-primary kb-wide" onClick={sendOtp} disabled={busy}>{busy ? "Sending…" : "Send OTP →"}</button>
              ) : (
                <>
                  <label className="kb-label" style={{ marginTop: 14 }}>🔐 Enter OTP</label>
                  <input className="kb-input kb-otp" inputMode="numeric" placeholder="••••" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ""))} />
                  <button className="kb-primary kb-wide kb-green" onClick={confirmBooking} disabled={busy}>{busy ? "Confirming…" : `Confirm · ${formatINR(total)}`}</button>
                  <button className="kb-link" onClick={sendOtp} disabled={busy}>Resend OTP</button>
                </>
              )}
              {err ? <div className="kb-err">{err}</div> : null}
            </div>
          </div>
        )}

        {/* DONE */}
        {step === "done" && result && (
          <div className="kb-pane kb-done">
            <div className="kb-tick">🎉</div>
            <div className="kb-doneh">Booking Confirmed!</div>
            <div className="kb-doneid">BOOKING ID · {result.bookingId}</div>
            <div className="kb-donecard">
              <div className="kb-dc-img" style={{ backgroundImage: `url(${picked?.image})` }} />
              <div className="kb-dc-name">{picked?.hotelName}</div>
              <div className="kb-dc-room">{selected?.type} · {city}</div>
              <div className="kb-donerow"><span>Check-in</span><b>{fmtD(checkInDate)} · 2:00 PM</b></div>
              <div className="kb-donerow"><span>Check-out</span><b>{fmtD(checkOutDate)} · 11:00 AM</b></div>
              <div className="kb-donerow"><span>Nights</span><b>{result.nights}{rooms > 1 ? ` · ${rooms} rooms` : ""}</b></div>
              <div className="kb-donerow"><span>Amount paid</span><b>{formatINR((result.amount || price) * (result.nights || nights) * rooms)}</b></div>
              <div className="kb-smsbox">✅ SMS confirmation sent to {result.phoneMasked}</div>
            </div>
            <button className="kb-primary kb-wide" onClick={reset} style={{ maxWidth: 380 }}>Book Another Stay</button>
          </div>
        )}
      </div>

      <div className="kb-footstrip"><span>💳 UPI</span><span>·</span><span>📱 Scan QR</span><span>·</span><span>StayBid Offline Kiosk · {loc.name}</span></div>

      {/* Premium cozy theme — self-contained, cream + champagne (matches customer frontend) */}
      <style jsx global>{`
        html, body { margin:0; padding:0; background:#FAF5EB; overflow:hidden; }
        * { box-sizing:border-box; }
        .kb-root {
          position:fixed; inset:0; z-index:999999; display:flex; flex-direction:column;
          height:100dvh; width:100vw;
          color:#1F1A0F; font-family:'Inter',system-ui,sans-serif;
          background:
            radial-gradient(1100px 560px at 18% -5%, rgba(201,166,107,.14), transparent 60%),
            radial-gradient(900px 500px at 92% 25%, rgba(217,190,130,.12), transparent 55%),
            linear-gradient(180deg,#FFFCF6 0%,#F5EFE0 55%,#FAF5EB 100%);
        }
        .kb-top { flex:0 0 auto; display:flex; align-items:center; gap:16px; padding:14px 26px; background:rgba(255,252,246,.85); backdrop-filter:blur(8px); border-bottom:1px solid #E8DCC8; overflow:hidden; }
        .kb-brand { display:flex; align-items:center; gap:9px; }
        .kb-brand-mark { width:34px; height:34px; display:grid; place-items:center; border-radius:10px; background:linear-gradient(135deg,#D9BE82,#C9A66B); color:#1F1A0F; font-size:18px; box-shadow:0 4px 12px rgba(201,166,107,.4); }
        .kb-brand-name { font-family:'Cormorant Garamond',Georgia,serif; font-size:26px; font-weight:700; letter-spacing:.3px; }
        .kb-brand-name b { color:#9C7E33; }
        .kb-brand-tag { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#6E5430; background:#F2EAD8; padding:3px 9px; border-radius:999px; margin-left:4px; }
        .kb-nav { display:flex; gap:8px; margin:0 auto; }
        .kb-nav-item { display:flex; align-items:center; gap:6px; font-size:14px; font-weight:600; color:#9C8E72; padding:7px 16px; border-radius:999px; border:1px solid transparent; }
        .kb-nav-item.on { color:#1F1A0F; background:#FFFCF6; border-color:#E0D2B4; box-shadow:0 2px 10px rgba(201,166,107,.25); }
        .kb-loc { font-size:13px; color:#6E5430; font-weight:600; }

        .kb-scroll { flex:1; overflow-y:auto; overflow-x:hidden; }
        .kb-pane { padding:26px; max-width:1100px; margin:0 auto; }
        .kb-h1 { font-family:'Cormorant Garamond',Georgia,serif; font-size:42px; font-weight:700; line-height:1.05; }
        .kb-h1 span { color:#9C7E33; font-style:italic; }
        .kb-sub { color:#6E5430; font-size:15px; margin:6px 0 24px; }

        .kb-city-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
        .kb-city { background:#FFFCF6; border:1px solid #E8DCC8; border-radius:18px; padding:26px 16px; text-align:center; cursor:pointer; color:#1F1A0F; box-shadow:0 6px 22px rgba(31,26,15,.06); transition:transform .12s,box-shadow .12s,border-color .12s; }
        .kb-city:active { transform:scale(.97); border-color:#C9A66B; box-shadow:0 10px 28px rgba(201,166,107,.25); }
        .kb-city-emoji { font-size:44px; margin-bottom:8px; }
        .kb-city-name { font-family:'Cormorant Garamond',serif; font-size:24px; font-weight:700; }
        .kb-city-sub { font-size:12px; color:#9C8E72; margin-top:4px; }

        .kb-rowtop { display:flex; align-items:center; gap:14px; margin-bottom:20px; }
        .kb-back { flex:0 0 auto; width:44px; height:44px; display:grid; place-items:center; background:#FFFCF6; color:#9C7E33; border:1px solid #E0D2B4; border-radius:14px; font-size:25px; font-weight:700; line-height:1; cursor:pointer; box-shadow:0 4px 14px rgba(201,166,107,.16); transition:transform .12s, box-shadow .12s, border-color .12s; }
        .kb-back:active { transform:scale(.93); border-color:#C9A66B; box-shadow:0 2px 8px rgba(201,166,107,.28); }
        .kb-head { flex:1; min-width:0; }
        .kb-eyebrow { display:inline-flex; align-items:center; gap:7px; max-width:100%; font-size:11px; font-weight:700; letter-spacing:1.3px; text-transform:uppercase; color:#9C7E33; background:linear-gradient(135deg,rgba(217,190,130,.2),rgba(201,166,107,.1)); border:1px solid rgba(201,166,107,.28); padding:5px 12px; border-radius:999px; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .kb-livedot { flex:0 0 auto; width:7px; height:7px; border-radius:999px; background:#6E8C57; animation:kbpulse 1.8s infinite; }
        @keyframes kbpulse { 0%{box-shadow:0 0 0 0 rgba(110,140,87,.5)} 70%{box-shadow:0 0 0 7px rgba(110,140,87,0)} 100%{box-shadow:0 0 0 0 rgba(110,140,87,0)} }
        .kb-h2 { font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:700; line-height:1.06; margin:0; color:#1F1A0F; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .kb-h2 span { color:#9C7E33; font-style:italic; }
        .kb-datestrip { display:flex; align-items:center; gap:12px; background:linear-gradient(135deg,#FFFCF6,#F7F0E2); border:1px solid #E8DCC8; border-radius:14px; padding:12px 16px; margin-bottom:14px; box-shadow:0 4px 14px rgba(31,26,15,.05); }
        .kb-date { display:flex; flex-direction:column; gap:2px; min-width:0; }
        .kb-date span { font-size:10px; letter-spacing:.6px; text-transform:uppercase; color:#9C8E72; }
        .kb-date b { font-family:'Cormorant Garamond',serif; font-size:18px; font-weight:700; color:#1F1A0F; white-space:nowrap; }
        .kb-datearrow { color:#C9A66B; font-size:18px; font-weight:700; flex:0 0 auto; }
        .kb-datenights { margin-left:auto; flex:0 0 auto; font-size:12px; font-weight:700; color:#9C7E33; background:#F2EAD8; padding:5px 11px; border-radius:999px; white-space:nowrap; }
        .kb-caphint { margin:-4px 0 12px; font-size:12px; color:#9C7E33; background:rgba(201,166,107,.1); border:1px solid rgba(201,166,107,.22); border-radius:10px; padding:8px 11px; line-height:1.35; }

        .kb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:18px; }
        .kb-card { text-align:left; cursor:pointer; background:#FFFCF6; border:1px solid #E8DCC8; border-radius:18px; overflow:hidden; color:#1F1A0F; box-shadow:0 6px 22px rgba(31,26,15,.07); transition:transform .12s,box-shadow .12s; padding:0; }
        .kb-card:active { transform:scale(.99); box-shadow:0 12px 30px rgba(201,166,107,.25); }
        .kb-card-img { height:150px; background-size:cover; background-position:center; position:relative; }
        .kb-card-disc { position:absolute; top:10px; left:10px; background:linear-gradient(135deg,#D49583,#C24E4E); color:#fff; font-weight:700; font-size:13px; padding:4px 10px; border-radius:999px; box-shadow:0 4px 10px rgba(194,78,78,.4); }
        .kb-card-left { position:absolute; top:10px; right:10px; background:rgba(31,26,15,.72); color:#FAF5EB; font-size:11px; padding:3px 9px; border-radius:999px; }
        .kb-card-body { padding:14px 16px 16px; }
        .kb-card-name { font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .kb-card-meta { font-size:13px; color:#6E5430; margin:3px 0 12px; }
        .kb-stars { color:#C9A66B; letter-spacing:1px; }
        .kb-card-foot { display:flex; align-items:flex-end; justify-content:space-between; }
        .kb-card-price { font-family:'Cormorant Garamond',serif; font-size:26px; font-weight:700; color:#1F1A0F; }
        .kb-card-price span { font-size:13px; color:#9C8E72; font-family:'Inter',sans-serif; }
        .kb-card-price em { display:block; font-size:13px; color:#B9A88A; text-decoration:line-through; font-style:normal; font-family:'Inter',sans-serif; }
        .kb-card-cta { background:#1F1A0F; color:#FAF5EB; font-size:13px; font-weight:700; padding:8px 14px; border-radius:999px; }

        .kb-tour { display:grid; grid-template-columns:1.1fr 1fr; gap:24px; }
        @media (max-width:820px){ .kb-tour{ grid-template-columns:1fr; } }
        .kb-gallery-main { height:280px; border-radius:18px; background-size:cover; background-position:center; position:relative; box-shadow:0 10px 30px rgba(31,26,15,.14); }
        .kb-gallery-badge { position:absolute; top:14px; left:14px; background:rgba(255,252,246,.92); color:#9C7E33; font-weight:700; font-size:13px; padding:6px 12px; border-radius:999px; box-shadow:0 4px 12px rgba(0,0,0,.15); }
        .kb-thumbs { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
        .kb-thumb { width:72px; height:54px; border-radius:10px; background-size:cover; background-position:center; border:2px solid transparent; cursor:pointer; opacity:.7; }
        .kb-thumb.on { border-color:#C9A66B; opacity:1; }
        .kb-hotel-line { display:flex; align-items:center; gap:14px; margin-top:14px; font-size:15px; color:#4A3820; }
        .kb-rating { background:#F2EAD8; color:#9C7E33; font-weight:700; padding:2px 10px; border-radius:999px; font-size:13px; }
        .kb-distance { color:#6E5430; }
        .kb-amen { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
        .kb-amen-chip { background:#FFFCF6; border:1px solid #E8DCC8; color:#4A3820; font-size:12px; padding:5px 11px; border-radius:999px; }

        .kb-section-title { font-family:'Cormorant Garamond',serif; font-size:20px; font-weight:700; margin-bottom:12px; }
        .kb-rooms { display:flex; flex-direction:column; gap:10px; }
        .kb-room { display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; cursor:pointer; background:#FFFCF6; border:1.5px solid #E8DCC8; border-radius:14px; padding:13px 15px; color:#1F1A0F; transition:border-color .12s,box-shadow .12s; }
        .kb-room.on { border-color:#C9A66B; box-shadow:0 0 0 3px rgba(201,166,107,.18); background:#FFFDF7; }
        .kb-room.soldout { opacity:.55; cursor:not-allowed; }
        .kb-room-type { font-family:'Cormorant Garamond',serif; font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
        .kb-tag { font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; font-family:'Inter',sans-serif; }
        .kb-tag.base { background:#E7EFE0; color:#5C7048; }
        .kb-tag.gold { background:#F2EAD8; color:#9C7E33; }
        .kb-room-meta { font-size:12px; color:#6E5430; margin-top:2px; }
        .kb-room-r { text-align:right; }
        .kb-room-price { font-family:'Cormorant Garamond',serif; font-size:20px; font-weight:700; }
        .kb-room-strike { font-size:12px; color:#B9A88A; text-decoration:line-through; }
        .kb-room-empty { font-size:13px; color:#9C8E72; padding:8px 2px; }

        .kb-rules { margin-top:18px; }
        .kb-rules ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
        .kb-rules li { display:flex; gap:10px; align-items:flex-start; font-size:13px; color:#4A3820; }

        .kb-stickycta { position:sticky; bottom:0; margin:22px -26px -26px; padding:14px 26px calc(14px + env(safe-area-inset-bottom,0px)); background:rgba(255,252,246,.95); backdrop-filter:blur(8px); border-top:1px solid #E8DCC8; display:flex; align-items:center; gap:16px; }
        .kb-sticky-type { font-size:12px; color:#9C8E72; }
        .kb-sticky-price { font-family:'Cormorant Garamond',serif; font-size:28px; font-weight:700; }
        .kb-sticky-price span { font-size:14px; color:#9C8E72; font-family:'Inter',sans-serif; }
        .kb-sticky-strike { font-size:14px; color:#B9A88A; text-decoration:line-through; margin-right:8px; font-family:'Inter',sans-serif; }

        .kb-primary { background:linear-gradient(135deg,#D9BE82,#C9A66B); color:#1F1A0F; border:none; border-radius:14px; padding:14px 24px; font-family:'Inter',sans-serif; font-size:17px; font-weight:700; cursor:pointer; box-shadow:0 6px 18px rgba(201,166,107,.4); margin-left:auto; }
        .kb-primary:disabled { opacity:.6; }
        .kb-primary.kb-wide { width:100%; margin:14px 0 0; }
        .kb-primary.kb-green { background:linear-gradient(135deg,#8FA77B,#6E8C57); color:#fff; }

        .kb-pay { max-width:560px; margin:0 auto; }
        .kb-pay-summary { display:flex; gap:14px; align-items:center; background:#FFFCF6; border:1px solid #E8DCC8; border-radius:14px; padding:12px; margin-bottom:16px; }
        .kb-ps-img { width:76px; height:60px; border-radius:10px; background-size:cover; background-position:center; flex-shrink:0; }
        .kb-ps-name { font-family:'Cormorant Garamond',serif; font-size:21px; font-weight:700; }
        .kb-ps-room { font-size:13px; color:#6E5430; }
        .kb-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(104px,1fr)); gap:10px; }
        .kb-tile { background:#FFFCF6; border:1px solid #E8DCC8; border-radius:12px; padding:12px 8px; text-align:center; }
        .kb-tile span { display:block; font-size:11px; color:#9C8E72; white-space:nowrap; }
        .kb-tile b { font-size:18px; }
        .kb-step2 { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:5px; }
        .kb-step2 button { width:30px; height:30px; border-radius:8px; border:1px solid #E0D2B4; background:#FAF5EB; color:#9C7E33; font-size:18px; font-weight:700; cursor:pointer; line-height:1; }
        .kb-step2 button:active { transform:scale(.92); }
        .kb-step2 b { min-width:18px; font-size:18px; }
        .kb-rate { display:flex; align-items:center; justify-content:space-between; margin:16px 0; padding:12px 14px; background:#F7F0E2; border-radius:12px; }
        .kb-rate span { font-size:14px; color:#4A3820; }
        .kb-rate b { font-family:'Cormorant Garamond',serif; font-size:24px; }

        .kb-label { display:block; font-size:14px; font-weight:700; margin-bottom:8px; color:#4A3820; }
        .kb-phonerow { display:flex; align-items:center; gap:8px; }
        .kb-cc { font-size:18px; color:#6E5430; font-weight:700; }
        .kb-input { flex:1; width:100%; background:#FFFCF6; border:1.5px solid #E0D2B4; border-radius:12px; padding:14px 16px; font-size:20px; color:#1F1A0F; }
        .kb-input:focus { outline:none; border-color:#C9A66B; box-shadow:0 0 0 3px rgba(201,166,107,.18); }
        .kb-otp { text-align:center; letter-spacing:10px; font-size:26px; }
        .kb-link { display:block; width:100%; margin-top:10px; background:none; border:none; color:#9C7E33; font-size:14px; cursor:pointer; }
        .kb-err { margin-top:12px; background:rgba(212,149,131,.14); border:1px solid rgba(212,149,131,.4); color:#A85B4E; border-radius:10px; padding:10px 12px; font-size:14px; }

        .kb-skeleton { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:18px; }
        .kb-skel-card { height:240px; border-radius:18px; background:linear-gradient(100deg,#F2EAD8 30%,#F7F0E2 50%,#F2EAD8 70%); background-size:200% 100%; animation:kbsh 1.4s infinite; }
        @keyframes kbsh { from{background-position:200% 0} to{background-position:-200% 0} }
        .kb-empty { display:flex; align-items:center; justify-content:center; min-height:240px; font-size:18px; color:#9C8E72; }

        .kb-done { display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; max-width:460px; margin:0 auto; }
        .kb-tick { font-size:60px; }
        .kb-doneh { font-family:'Cormorant Garamond',serif; font-size:34px; font-weight:700; }
        .kb-doneid { font-size:13px; color:#9C8E72; letter-spacing:1px; }
        .kb-donecard { background:#FFFCF6; border:1px solid #DCEAD2; border-radius:16px; padding:18px; width:100%; text-align:left; margin-top:6px; box-shadow:0 8px 24px rgba(31,26,15,.08); }
        .kb-dc-img { width:100%; height:120px; border-radius:12px; background-size:cover; background-position:center; margin-bottom:12px; }
        .kb-dc-name { font-family:'Cormorant Garamond',serif; font-size:22px; font-weight:700; }
        .kb-dc-room { font-size:13px; color:#6E5430; margin-bottom:10px; }
        .kb-donerow { display:flex; justify-content:space-between; font-size:14px; padding:5px 0; color:#4A3820; }
        .kb-donerow b { color:#1F1A0F; }
        .kb-smsbox { margin-top:12px; background:#EAF2E2; border:1px solid #CFE0BD; color:#5C7048; font-size:12px; padding:9px; border-radius:8px; text-align:center; }

        .kb-footstrip { flex:0 0 auto; display:flex; align-items:center; justify-content:center; gap:10px; padding:9px; background:rgba(255,252,246,.7); border-top:1px solid #E8DCC8; font-size:11px; color:#9C8E72; white-space:nowrap; overflow:hidden; }

        /* Device-native: on phones the centred nav + location push the header
           off-screen. They're decorative (the flow has back buttons +
           headings), so hide them and let the brand breathe. */
        @media (max-width:760px){
          .kb-nav { display:none; }
          .kb-brand-tag { display:none; }
          .kb-loc { display:none; }
          .kb-pane { padding:18px 16px; }
          .kb-h1 { font-size:34px; }
          .kb-h2 { font-size:27px; }
          .kb-back { width:40px; height:40px; font-size:23px; }
          .kb-tour { grid-template-columns:1fr; }
          /* sticky bar bleeds to the pane edges — its negative horizontal
             margin MUST match the pane's 16px padding or it overflows left */
          .kb-stickycta { margin:22px -16px -18px; padding-left:16px; padding-right:16px; }
        }
        @media (max-width:380px){
          .kb-brand-name { font-size:22px; }
          .kb-h2 { font-size:23px; }
          .kb-back { width:38px; height:38px; font-size:21px; }
          .kb-eyebrow { font-size:10px; letter-spacing:1px; padding:4px 10px; }
          .kb-date b { font-size:16px; }
          .kb-step2 button { width:28px; height:28px; }
        }
      `}</style>
    </div>
  );
}

export default function KioskBookPage() {
  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#FAF5EB" }} />}>
      <BookInner />
    </Suspense>
  );
}
