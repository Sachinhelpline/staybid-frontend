"use client";
//
// StayBid Offline Kiosk — HUB / launcher
//
// Entry point for setting up or demoing a kiosk unit. Pick a physical
// location, then open either the BIG DISPLAY board or the TOUCHSCREEN
// booking flow. Pure launcher — no data, never breaks.
//
import { useState } from "react";
import Link from "next/link";
import { KIOSK_LOCATIONS, DEFAULT_KIOSK_LOC } from "@/lib/kiosk";

export default function KioskHubPage() {
  const [loc, setLoc] = useState(DEFAULT_KIOSK_LOC);
  const locs = Object.values(KIOSK_LOCATIONS);

  return (
    <div className="kh-screen">
      <div className="kh-tag">STAYBID × OFFLINE KIOSK</div>
      <h1 className="kh-title">Offline Kiosk <span>Control</span></h1>
      <p className="kh-sub">Same-day flash deals · live from hotels &amp; admin · zero staff</p>

      <div className="kh-card">
        <label className="kh-label">Kiosk Location</label>
        <select className="kh-select" value={loc} onChange={(e) => setLoc(e.target.value)}>
          {locs.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <div className="kh-actions">
          <Link className="kh-btn kh-display" href={`/kiosk/display?loc=${loc}`}>
            <div className="kh-bicon">📊</div>
            <div className="kh-btxt"><b>Big Display Board</b><span>Stock-market style · auto-refresh</span></div>
          </Link>
          <Link className="kh-btn kh-book" href={`/kiosk/book?loc=${loc}`}>
            <div className="kh-bicon">🖥️</div>
            <div className="kh-btxt"><b>Touchscreen Booking</b><span>3-step same-day flash booking</span></div>
          </Link>
        </div>
      </div>

      <div className="kh-note">
        Each physical unit runs <code>/kiosk/display</code> (the screen) + <code>/kiosk/book</code> (the kiosk),
        each with its own <code>?loc=</code>. Deals, prices and availability are 100% live from the same
        StayBid backend that powers the customer, hotel and admin panels.
      </div>

      <div className="kh-locs">
        {locs.map((l) => (
          <div className="kh-loc" key={l.id}>
            <div className="kh-loc-name">📍 {l.name}</div>
            <div className="kh-loc-links">
              <Link href={`/kiosk/display?loc=${l.id}`}>Display</Link>
              <Link href={`/kiosk/book?loc=${l.id}`}>Book</Link>
            </div>
          </div>
        ))}
      </div>

      <style jsx global>{`
        html, body { margin:0; padding:0; }
        .kh-screen {
          min-height:100vh; box-sizing:border-box; padding:48px 24px 60px;
          background:radial-gradient(120% 120% at 80% 0%,#14000f 0%,#0a0a0f 55%,#050008 100%);
          color:#f0f0f8; font-family:'Barlow Condensed','Rajdhani',system-ui,sans-serif;
          max-width:900px; margin:0 auto;
        }
        .kh-tag { display:inline-block; background:#FF6B00; color:#000; font-family:monospace; font-size:11px; font-weight:700; letter-spacing:3px; padding:5px 14px; }
        .kh-title { font-family:'Rajdhani',sans-serif; font-size:48px; font-weight:700; margin:18px 0 4px; line-height:1; }
        .kh-title span { color:#FF6B00; }
        .kh-sub { font-family:monospace; font-size:13px; color:#888899; letter-spacing:1px; margin:0 0 28px; }
        .kh-card { background:#12121a; border:1px solid rgba(255,107,0,.25); border-radius:12px; padding:24px; }
        .kh-label { display:block; font-family:monospace; font-size:11px; letter-spacing:2px; color:#FF6B00; margin-bottom:8px; }
        .kh-select { width:100%; background:#0a0a0f; border:1px solid rgba(255,107,0,.3); color:#fff; border-radius:8px; padding:13px 14px; font-size:17px; }
        .kh-actions { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:18px; }
        @media (max-width:620px){ .kh-actions{ grid-template-columns:1fr; } }
        .kh-btn { display:flex; align-items:center; gap:14px; text-decoration:none; color:#fff; border-radius:10px; padding:18px; border:1px solid rgba(255,255,255,.1); }
        .kh-display { background:linear-gradient(135deg,#1a0a00,#0e0e16); }
        .kh-book { background:linear-gradient(135deg,#001a0a,#0e0e16); }
        .kh-bicon { font-size:34px; }
        .kh-btxt b { display:block; font-family:'Rajdhani',sans-serif; font-size:19px; }
        .kh-btxt span { font-family:monospace; font-size:11px; color:#888899; }
        .kh-note { margin-top:22px; font-size:14px; color:#bbbbcc; line-height:1.7; background:rgba(255,107,0,.06); border:1px solid rgba(255,107,0,.2); border-left:3px solid #FF6B00; padding:14px 18px; }
        .kh-note code { font-family:monospace; color:#FFB300; }
        .kh-locs { margin-top:24px; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; }
        .kh-loc { background:#12121a; border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:12px 14px; }
        .kh-loc-name { font-family:'Rajdhani',sans-serif; font-weight:700; font-size:15px; }
        .kh-loc-links { display:flex; gap:14px; margin-top:6px; }
        .kh-loc-links a { font-family:monospace; font-size:12px; color:#FF6B00; text-decoration:none; }
      `}</style>
    </div>
  );
}
