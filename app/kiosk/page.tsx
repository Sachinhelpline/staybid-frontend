"use client";
//
// StayBid Offline Kiosk — HUB / launcher (premium cozy)
//
// Entry point for setting up or demoing a kiosk unit. Pick a physical
// location, then open either the BIG DISPLAY board or the TOUCHSCREEN
// booking flow. Pure launcher — no data, never breaks.
//
import { useState } from "react";
import Link from "next/link";
import SwitchExperienceButton from "@/components/SwitchExperienceButton";
import { AppTourButton, HelpSupportButton } from "@/components/HelpLauncher";
import { KIOSK_LOCATIONS, DEFAULT_KIOSK_LOC } from "@/lib/kiosk";

export default function KioskHubPage() {
  const [loc, setLoc] = useState(DEFAULT_KIOSK_LOC);
  const locs = Object.values(KIOSK_LOCATIONS);

  return (
    <div className="kh-screen">
      <div className="kh-topbar">
        <div className="kh-tag">StayBid · Offline Kiosk</div>
        <AppTourButton className="kh-switch" label="App Tour" />
        <HelpSupportButton className="kh-switch" label="Help & Support" />
        <SwitchExperienceButton className="kh-switch" label="Switch experience" />
      </div>
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
            <div className="kh-btxt"><b>Big Display Board</b><span>Live price ticker · auto-refresh</span></div>
          </Link>
          <Link className="kh-btn kh-book" href={`/kiosk/book?loc=${loc}`}>
            <div className="kh-bicon">🏨</div>
            <div className="kh-btxt"><b>Touchscreen Booking</b><span>Browse · tour · upgrade · pay</span></div>
          </Link>
        </div>
      </div>

      <div className="kh-note">
        Each physical unit runs <code>/kiosk/display</code> (the screen) + <code>/kiosk/book</code> (the kiosk),
        each with its own <code>?loc=</code>. Deals, prices, rooms &amp; availability are 100% live from the same
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
          min-height:100vh; box-sizing:border-box; padding:52px 24px 64px;
          background:
            radial-gradient(1100px 560px at 80% -5%, rgba(201,166,107,.14), transparent 60%),
            linear-gradient(180deg,#fcfcfd 0%,#ecf0f3 55%,#f4f6f8 100%);
          color:#1F1A0F; font-family:'Inter',system-ui,sans-serif; max-width:920px; margin:0 auto;
        }
        .kh-topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .kh-tag { display:inline-block; background:#e7ebef; color:#67839e; font-size:11px; font-weight:700; letter-spacing:3px; text-transform:uppercase; padding:6px 14px; border-radius:999px; }
        .kh-switch { background:#fcfcfd; border:1px solid #cbd4de; color:#67839e; font-size:12px; font-weight:700; padding:8px 14px; border-radius:999px; cursor:pointer; transition:background .12s,box-shadow .12s; }
        .kh-switch:active { box-shadow:0 6px 18px rgba(201,166,107,.22); }
        .kh-title { font-family:'Cormorant Garamond',Georgia,serif; font-size:52px; font-weight:700; margin:18px 0 4px; line-height:1; }
        .kh-title span { color:#67839e; font-style:italic; }
        .kh-sub { font-size:15px; color:#6E5430; margin:0 0 30px; }
        .kh-card { background:#fcfcfd; border:1px solid #E8DCC8; border-radius:20px; padding:26px; box-shadow:0 10px 30px rgba(31,26,15,.07); }
        .kh-label { display:block; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#67839e; margin-bottom:8px; }
        .kh-select { width:100%; background:#f4f6f8; border:1px solid #cbd4de; color:#1F1A0F; border-radius:12px; padding:14px; font-size:17px; }
        .kh-actions { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:18px; }
        @media (max-width:620px){ .kh-actions{ grid-template-columns:1fr; } }
        .kh-btn { display:flex; align-items:center; gap:14px; text-decoration:none; color:#1F1A0F; border-radius:14px; padding:20px; border:1px solid #E8DCC8; background:#f4f6f8; transition:transform .12s,box-shadow .12s; }
        .kh-btn:active { transform:scale(.98); box-shadow:0 10px 26px rgba(201,166,107,.22); }
        .kh-bicon { width:52px; height:52px; display:grid; place-items:center; border-radius:13px; background:linear-gradient(135deg,#b4c1cf,#C9A66B); font-size:26px; }
        .kh-btxt b { display:block; font-family:'Cormorant Garamond',serif; font-size:21px; }
        .kh-btxt span { font-size:12px; color:#6E5430; }
        .kh-note { margin-top:22px; font-size:14px; color:#4A3820; line-height:1.7; background:#f5f7f8; border:1px solid #dae1e7; border-left:3px solid #C9A66B; padding:14px 18px; border-radius:10px; }
        .kh-note code { color:#67839e; background:#e7ebef; padding:1px 6px; border-radius:5px; }
        .kh-locs { margin-top:24px; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; }
        .kh-loc { background:#fcfcfd; border:1px solid #E8DCC8; border-radius:12px; padding:13px 15px; }
        .kh-loc-name { font-family:'Cormorant Garamond',serif; font-weight:700; font-size:16px; }
        .kh-loc-links { display:flex; gap:14px; margin-top:6px; }
        .kh-loc-links a { font-size:13px; color:#67839e; text-decoration:none; font-weight:600; }
      `}</style>
    </div>
  );
}
