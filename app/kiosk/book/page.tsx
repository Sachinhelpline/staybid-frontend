"use client";
//
// StayBid Offline Kiosk — TOUCHSCREEN BOOKING (3-step)
//
// A floor-standing touchscreen lets a walk-in book a same-day StayBid flash
// deal in 3 taps. Fully server-mediated booking (`/api/kiosk/book`) so the
// shared device never stores a customer token. Live deals come from the same
// flash engine as the customer site (wired to hotels + admin).
//
//   Step 1 — pick city          Step 2 — pick hotel + room
//   Step 3 — phone + OTP        → confirmation screen
//
// Configure default city:  /kiosk/book?loc=mussoorie-mall
//
import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { formatINR, KioskDeal, KIOSK_CITIES, resolveKioskLocation } from "@/lib/kiosk";

type Step = 1 | 2 | 3 | "done";

function BookInner() {
  const params = useSearchParams();
  const loc = resolveKioskLocation(params.get("loc"));

  const [step, setStep] = useState<Step>(1);
  const [city, setCity] = useState<string>("");
  const [deals, setDeals] = useState<KioskDeal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);
  const [picked, setPicked] = useState<KioskDeal | null>(null);

  const [guests, setGuests] = useState(2);
  const [nights, setNights] = useState(1);

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
    setStep(2);
    loadDeals(c);
  }

  function chooseDeal(d: KioskDeal) {
    setPicked(d);
    setGuests(Math.min(d.capacity || 2, 2));
    setStep(3);
    setOtpSent(false);
    setOtp("");
    setPhone("");
    setErr("");
  }

  function reset() {
    setStep(1); setCity(""); setDeals([]); setPicked(null);
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
    if (!picked) return;
    setErr("");
    if (!/^\d{4,6}$/.test(otp.trim())) { setErr("Enter the OTP sent to your phone"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/kiosk/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.replace(/\s/g, ""), otp: otp.trim(),
          hotelId: picked.hotelId, roomId: picked.roomId, dealId: picked.id,
          amount: picked.aiPrice, guests, nights,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setErr(j?.error || "Booking failed. Try again."); return; }
      setResult(j);
      setStep("done");
    } catch { setErr("Booking service unavailable. Try again."); }
    finally { setBusy(false); }
  }

  const total = picked ? picked.aiPrice * nights : 0;

  return (
    <div className="kb-screen">
      {/* Header */}
      <div className="kb-header">
        <div className="kb-logo">Stay<span>Bid</span> · Flash Booking</div>
        <div className="kb-step">{step === "done" ? "✓ CONFIRMED" : `STEP ${step}/3`}</div>
      </div>

      {/* STEP 1 — city */}
      {step === 1 && (
        <div className="kb-body">
          <div className="kb-h1">Namasté! <span>Aaj Kahan?</span></div>
          <div className="kb-sub">SAME-DAY BOOKING ONLY · {loc.name}</div>
          <div className="kb-city-grid">
            {KIOSK_CITIES.map((c) => (
              <button key={c.city} className="kb-city" onClick={() => chooseCity(c.city)}>
                <div className="kb-city-emoji">{c.emoji}</div>
                <div className="kb-city-name">{c.city}</div>
                <div className="kb-city-sub">Tap to see live deals</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2 — hotel + room */}
      {step === 2 && (
        <div className="kb-body">
          <div className="kb-rowtop">
            <button className="kb-back" onClick={() => setStep(1)}>‹ Change City</button>
            <div className="kb-h2">Live Deals — {city}</div>
            <div className="kb-count">{deals.length} hotels · tonight</div>
          </div>
          {loadingDeals ? (
            <div className="kb-empty">Loading live deals…</div>
          ) : deals.length === 0 ? (
            <div className="kb-empty">No same-day deals in {city} right now. Try another city.</div>
          ) : (
            <div className="kb-list">
              {deals.map((d) => (
                <button key={d.id} className="kb-hotel" onClick={() => chooseDeal(d)}>
                  <div className="kb-thumb" style={{ backgroundImage: `url(${d.image})` }} />
                  <div className="kb-hinfo">
                    <div className="kb-hname">{d.hotelName} <span className="kb-hstars">{"★".repeat(Math.min(5, Math.round(d.stars)))}</span></div>
                    <div className="kb-hmeta">{d.roomType}{d.area ? ` · ${d.area}` : ""}{d.distanceKm ? ` · ${d.distanceKm} km` : ""}</div>
                  </div>
                  <div className="kb-hright">
                    <div className="kb-hprice">{formatINR(d.aiPrice)}</div>
                    {d.mrp > d.aiPrice ? <div className="kb-hmrp">{formatINR(d.mrp)}</div> : null}
                    <div className="kb-hrooms">{d.unitsFree} left</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 3 — phone + OTP */}
      {step === 3 && picked && (
        <div className="kb-body">
          <div className="kb-rowtop">
            <button className="kb-back" onClick={() => setStep(2)}>‹ Back</button>
            <div className="kb-h2">Confirm & Pay</div>
            <div />
          </div>
          <div className="kb-confirm">
            <div className="kb-summary">
              <div className="kb-stitle">{picked.hotelName}</div>
              <div className="kb-sline">{picked.roomType} · {city}</div>
              <div className="kb-tiles">
                <div className="kb-tile"><span>Check-in</span><b>Today</b></div>
                <div className="kb-tile">
                  <span>Nights</span>
                  <div className="kb-step2">
                    <button onClick={() => setNights((n) => Math.max(1, n - 1))}>−</button>
                    <b>{nights}</b>
                    <button onClick={() => setNights((n) => Math.min(10, n + 1))}>+</button>
                  </div>
                </div>
                <div className="kb-tile">
                  <span>Guests</span>
                  <div className="kb-step2">
                    <button onClick={() => setGuests((g) => Math.max(1, g - 1))}>−</button>
                    <b>{guests}</b>
                    <button onClick={() => setGuests((g) => Math.min(8, g + 1))}>+</button>
                  </div>
                </div>
              </div>
              <div className="kb-rate">
                <span>{formatINR(picked.aiPrice)} × {nights} night{nights > 1 ? "s" : ""}</span>
                <b>{formatINR(total)}</b>
              </div>
            </div>

            <div className="kb-pay">
              <label className="kb-label">📱 Mobile Number</label>
              <div className="kb-phonerow">
                <span className="kb-cc">+91</span>
                <input
                  className="kb-input" inputMode="numeric" placeholder="10-digit number"
                  value={phone} maxLength={13}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                  disabled={otpSent}
                />
              </div>
              {!otpSent ? (
                <button className="kb-primary" onClick={sendOtp} disabled={busy}>
                  {busy ? "Sending…" : "Send OTP →"}
                </button>
              ) : (
                <>
                  <label className="kb-label" style={{ marginTop: 14 }}>🔐 Enter OTP</label>
                  <input
                    className="kb-input kb-otp" inputMode="numeric" placeholder="••••" maxLength={6}
                    value={otp} onChange={(e) => setOtp(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  <button className="kb-primary kb-green" onClick={confirmBooking} disabled={busy}>
                    {busy ? "Confirming…" : `Confirm Booking · ${formatINR(total)}`}
                  </button>
                  <button className="kb-link" onClick={sendOtp} disabled={busy}>Resend OTP</button>
                </>
              )}
              {err ? <div className="kb-err">{err}</div> : null}
            </div>
          </div>
        </div>
      )}

      {/* DONE */}
      {step === "done" && result && (
        <div className="kb-body kb-done">
          <div className="kb-tick">🎉</div>
          <div className="kb-doneh">Booking Confirmed!</div>
          <div className="kb-doneid">BOOKING ID: {result.bookingId}</div>
          <div className="kb-donecard">
            <div className="kb-stitle">{picked?.hotelName}</div>
            <div className="kb-sline">{picked?.roomType} · {city}</div>
            <div className="kb-donerow"><span>Check-in</span><b>Today · 2:00 PM</b></div>
            <div className="kb-donerow"><span>Nights</span><b>{result.nights}</b></div>
            <div className="kb-donerow"><span>Amount</span><b>{formatINR(result.amount * result.nights)}</b></div>
            <div className="kb-smsbox">✅ SMS confirmation sent to {result.phoneMasked}</div>
          </div>
          <button className="kb-primary" onClick={reset} style={{ maxWidth: 360 }}>Book Another Stay</button>
        </div>
      )}

      <div className="kb-footstrip">
        <span>💳 UPI</span><span>📱 QR</span><span>·</span><span>StayBid Offline Kiosk · {loc.name}</span>
      </div>

      <style jsx global>{`
        html, body { margin:0; padding:0; background:#000; overflow:hidden; }
        .kb-screen {
          position:fixed; inset:0; z-index:999999;
          background:radial-gradient(120% 120% at 20% 0%,#14000f 0%,#0a0a0f 55%,#050008 100%);
          color:#f0f0f8; font-family:'Barlow Condensed','Rajdhani',system-ui,sans-serif;
          display:flex; flex-direction:column;
        }
        .kb-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:14px 24px; background:#FF6B00; color:#000;
        }
        .kb-logo { font-family:'Rajdhani',sans-serif; font-weight:700; font-size:22px; }
        .kb-logo span { color:#fff; }
        .kb-step { font-family:monospace; font-size:13px; font-weight:700; background:rgba(0,0,0,.18); padding:4px 12px; border-radius:4px; letter-spacing:1px; }

        .kb-body { flex:1; overflow-y:auto; padding:24px 26px; }
        .kb-h1 { font-family:'Rajdhani',sans-serif; font-size:38px; font-weight:700; }
        .kb-h1 span { color:#FF6B00; }
        .kb-sub { font-family:monospace; font-size:13px; color:#888899; margin:4px 0 22px; letter-spacing:1px; }

        .kb-city-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
        .kb-city {
          background:#15151f; border:1px solid rgba(255,107,0,.22); border-radius:12px;
          padding:24px 16px; text-align:center; cursor:pointer; color:#fff;
          transition:transform .1s, border-color .1s;
        }
        .kb-city:active { transform:scale(.97); border-color:#FF6B00; }
        .kb-city-emoji { font-size:42px; margin-bottom:8px; }
        .kb-city-name { font-family:'Rajdhani',sans-serif; font-size:22px; font-weight:700; }
        .kb-city-sub { font-family:monospace; font-size:11px; color:#888899; margin-top:3px; }

        .kb-rowtop { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:16px; }
        .kb-back { background:#1a1a26; color:#FFB300; border:1px solid rgba(255,179,0,.3); border-radius:8px; padding:8px 16px; font-size:16px; font-weight:700; cursor:pointer; }
        .kb-h2 { font-family:'Rajdhani',sans-serif; font-size:26px; font-weight:700; }
        .kb-count { font-family:monospace; font-size:12px; color:#888899; }

        .kb-list { display:flex; flex-direction:column; gap:12px; }
        .kb-hotel {
          display:flex; align-items:center; gap:14px; text-align:left; cursor:pointer;
          background:#12121a; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:12px; color:#fff;
          transition:transform .1s, border-color .1s;
        }
        .kb-hotel:active { transform:scale(.99); border-color:#FF6B00; }
        .kb-thumb { width:84px; height:64px; border-radius:8px; background-size:cover; background-position:center; flex-shrink:0; }
        .kb-hinfo { flex:1; min-width:0; }
        .kb-hname { font-family:'Rajdhani',sans-serif; font-weight:700; font-size:20px; }
        .kb-hstars { color:#FFB300; font-size:14px; }
        .kb-hmeta { font-family:monospace; font-size:13px; color:#888899; margin-top:2px; }
        .kb-hright { text-align:right; flex-shrink:0; }
        .kb-hprice { font-family:monospace; font-weight:700; font-size:24px; color:#FF6B00; }
        .kb-hmrp { font-family:monospace; font-size:13px; color:#666; text-decoration:line-through; }
        .kb-hrooms { font-family:monospace; font-size:12px; color:#00E676; }

        .kb-confirm { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
        @media (max-width:760px){ .kb-confirm{ grid-template-columns:1fr; } }
        .kb-summary, .kb-pay { background:#12121a; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:20px; }
        .kb-stitle { font-family:'Rajdhani',sans-serif; font-size:22px; font-weight:700; }
        .kb-sline { font-family:monospace; font-size:13px; color:#888899; margin:3px 0 16px; }
        .kb-tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        .kb-tile { background:#1a1a26; border-radius:8px; padding:10px; text-align:center; }
        .kb-tile span { display:block; font-family:monospace; font-size:11px; color:#888899; }
        .kb-tile b { font-size:18px; color:#fff; }
        .kb-step2 { display:flex; align-items:center; justify-content:center; gap:10px; margin-top:2px; }
        .kb-step2 button { width:30px; height:30px; border-radius:6px; border:1px solid rgba(255,107,0,.4); background:#0a0a0f; color:#FF6B00; font-size:18px; font-weight:700; cursor:pointer; }
        .kb-step2 b { font-size:18px; min-width:22px; }
        .kb-rate { display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding-top:14px; border-top:1px solid rgba(255,255,255,.08); }
        .kb-rate span { font-family:monospace; font-size:14px; color:#ccc; }
        .kb-rate b { font-family:monospace; font-size:24px; color:#FF6B00; }

        .kb-label { display:block; font-family:'Rajdhani',sans-serif; font-size:16px; font-weight:700; margin-bottom:8px; }
        .kb-phonerow { display:flex; align-items:center; gap:8px; }
        .kb-cc { font-family:monospace; font-size:18px; color:#888899; }
        .kb-input { flex:1; width:100%; background:#0a0a0f; border:1px solid rgba(255,107,0,.3); border-radius:8px; padding:14px 16px; font-size:20px; color:#fff; font-family:monospace; letter-spacing:1px; }
        .kb-input:focus { outline:none; border-color:#FF6B00; }
        .kb-otp { text-align:center; letter-spacing:8px; font-size:26px; }
        .kb-primary { width:100%; margin-top:14px; background:#FF6B00; color:#000; border:none; border-radius:10px; padding:15px; font-family:'Rajdhani',sans-serif; font-size:20px; font-weight:700; cursor:pointer; }
        .kb-primary:disabled { opacity:.6; }
        .kb-green { background:#00E676; }
        .kb-link { display:block; width:100%; margin-top:10px; background:none; border:none; color:#FFB300; font-size:14px; cursor:pointer; }
        .kb-err { margin-top:12px; background:rgba(255,23,68,.12); border:1px solid rgba(255,23,68,.35); color:#FF5277; border-radius:8px; padding:10px 12px; font-size:14px; }

        .kb-empty { display:flex; align-items:center; justify-content:center; min-height:240px; font-size:20px; color:#888899; }

        .kb-done { display:flex; flex-direction:column; align-items:center; text-align:center; gap:10px; }
        .kb-tick { font-size:64px; }
        .kb-doneh { font-family:'Rajdhani',sans-serif; font-size:34px; font-weight:700; }
        .kb-doneid { font-family:monospace; font-size:13px; color:#888899; }
        .kb-donecard { background:#12121a; border:1px solid rgba(0,230,118,.3); border-radius:12px; padding:20px; width:100%; max-width:420px; text-align:left; margin-top:8px; }
        .kb-donerow { display:flex; justify-content:space-between; font-family:monospace; font-size:14px; padding:5px 0; color:#ccc; }
        .kb-donerow b { color:#fff; }
        .kb-smsbox { margin-top:12px; background:rgba(0,230,118,.1); border:1px solid rgba(0,230,118,.3); color:#00E676; font-family:monospace; font-size:12px; padding:8px; border-radius:6px; text-align:center; }

        .kb-footstrip { display:flex; align-items:center; justify-content:center; gap:12px; padding:9px; background:#0a0a0f; border-top:1px solid rgba(255,255,255,.06); font-family:monospace; font-size:11px; color:#888899; }
      `}</style>
    </div>
  );
}

export default function KioskBookPage() {
  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#000" }} />}>
      <BookInner />
    </Suspense>
  );
}
