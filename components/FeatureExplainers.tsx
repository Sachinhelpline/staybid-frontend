"use client";
import { useState, useEffect, useRef, useCallback, ReactNode } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════════════════════════════
   Best-voice picker — prefer neural / Google / Microsoft voices
   ═══════════════════════════════════════════════════════════════════ */
function pickVoice(lang: "en" | "hi"): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const all = window.speechSynthesis.getVoices();
  if (!all.length) return null;

  const prefix = lang === "hi" ? "hi" : "en";
  const langMatch = all.filter(v => v.lang?.toLowerCase().startsWith(prefix));
  if (!langMatch.length) return null;

  const priority = lang === "hi"
    ? ["google हिन्दी", "google hindi", "microsoft swara", "microsoft kalpana", "microsoft hemant", "ravi", "lekha", "veena"]
    : ["google uk english female", "google us english", "microsoft aria", "microsoft jenny", "microsoft guy",
       "samantha", "karen", "daniel", "moira", "tessa", "allison", "ava"];

  for (const name of priority) {
    const v = langMatch.find(x => x.name.toLowerCase().includes(name));
    if (v) return v;
  }
  // fallback: any non-"eSpeak" (robotic) voice
  const nonRobot = langMatch.find(v => !/espeak|festival/i.test(v.name));
  return nonRobot || langMatch[0];
}

/* ═══════════════════════════════════════════════════════════════════
   Phone-frame wrapper — shared by all demo scenes
   ═══════════════════════════════════════════════════════════════════ */
function PhoneFrame({ children, accent = "#c9911a" }: { children: ReactNode; accent?: string }) {
  return (
    <div className="relative mx-auto" style={{ width: "min(280px, 75vw)", aspectRatio: "9 / 18" }}>
      <div className="absolute inset-0 rounded-[2.2rem] p-[4px]"
           style={{ background: `linear-gradient(145deg, ${accent}cc, #222 40%, #111 70%, ${accent}88)` }}>
        <div className="w-full h-full rounded-[2rem] overflow-hidden relative bg-[#0a0812] border border-white/5">
          {/* notch */}
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-16 h-4 bg-black rounded-b-xl z-30" />
          {children}
        </div>
      </div>
      <div className="absolute -inset-3 rounded-[2.5rem] pointer-events-none"
           style={{ boxShadow: `0 30px 70px -20px ${accent}66, 0 0 0 1px ${accent}22` }} />
    </div>
  );
}

const sceneCls = "absolute inset-0 pt-8 px-3 pb-3 transition-opacity duration-500";

/* ═══════════════════════════════════════════════════════════════════
   FLASH DEALS scenes
   ═══════════════════════════════════════════════════════════════════ */
function FlashScenes({ step }: { step: number }) {
  const s = step;
  return (
    <>
      {/* Scene 0: Home with flash deals carousel */}
      <div className={sceneCls} style={{ opacity: s === 0 ? 1 : 0 }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1"><div className="w-4 h-4 rounded bg-gold-500" /><span className="text-white text-[10px] font-bold">staybid</span></div>
          <div className="text-[8px] text-white/50">📍 Mussoorie</div>
        </div>
        <p className="text-red-400 text-[7px] font-bold tracking-widest uppercase mb-1">⚡ LIVE NOW</p>
        <p className="text-white text-[10px] font-semibold mb-2">Flash Deals — Today Only</p>
        <div className="flex gap-1.5 overflow-hidden">
          {[0, 1, 2].map(i => (
            <div key={i} className={`shrink-0 rounded-lg border transition-all ${i === 1 ? "border-gold-400 scale-105 shadow-lg" : "border-white/10 opacity-60"}`}
                 style={{ width: 68, background: "rgba(255,255,255,0.04)", boxShadow: i === 1 ? "0 0 12px rgba(240,180,41,0.5)" : undefined }}>
              <div className="h-12 bg-gradient-to-br from-gold-500/40 to-purple-500/20 rounded-t-lg relative">
                <span className="absolute top-0.5 right-0.5 bg-gold-500 text-[6px] font-bold text-white px-1 rounded-full">40%</span>
              </div>
              <div className="p-1">
                <div className="h-1 w-full bg-white/20 rounded-full mb-0.5" />
                <div className="h-1 w-2/3 bg-white/10 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scene 1: Timer / discount emphasis */}
      <div className={sceneCls} style={{ opacity: s === 1 ? 1 : 0 }}>
        <div className="h-full flex flex-col items-center justify-center">
          <div className="text-4xl mb-2">⏰</div>
          <p className="text-white text-[11px] font-bold mb-1">Expires Tonight</p>
          <div className="font-mono text-gold-400 text-2xl font-bold tabular-nums tracking-wider">
            <FlippingCountdown />
          </div>
          <p className="text-white/50 text-[8px] mt-2">⚠️ Only 3 slots left</p>
          <div className="mt-3 px-3 py-1 bg-red-500/20 border border-red-500/40 rounded-full">
            <p className="text-red-400 text-[8px] font-bold">BOOK FAST</p>
          </div>
        </div>
      </div>

      {/* Scene 2: Tap deal → opens detail */}
      <div className={sceneCls} style={{ opacity: s === 2 ? 1 : 0 }}>
        <div className="h-20 bg-gradient-to-br from-gold-500/30 to-navy-800 rounded-xl mb-2 relative overflow-hidden">
          <span className="absolute top-1 left-1 bg-red-500 text-white text-[7px] font-bold px-1.5 py-0.5 rounded">40% OFF</span>
          <span className="absolute bottom-1 left-1 text-white text-[9px] font-bold">🏨 Mountain Grand</span>
        </div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-white/40 text-[7px] line-through">₹4,999</p>
            <p className="text-gold-400 font-bold text-[14px]">₹2,999<span className="text-[7px] text-white/50">/night</span></p>
          </div>
          <div className="text-[7px] text-emerald-400 font-bold">You save ₹2,000</div>
        </div>
        <div className="h-px bg-white/10 my-2" />
        <p className="text-white/70 text-[8px]">⭐ 4.5 · 🛏️ Deluxe Suite · 📶 Wifi</p>
      </div>

      {/* Scene 3: Pick dates */}
      <div className={sceneCls} style={{ opacity: s === 3 ? 1 : 0 }}>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">📅 Select Dates</p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="border border-gold-400 bg-gold-500/10 rounded-lg p-2 text-center">
            <p className="text-[6px] text-gold-300 font-bold">CHECK IN</p>
            <p className="text-white text-[11px] font-bold mt-0.5">24 Apr</p>
            <p className="text-[6px] text-white/50">Wednesday</p>
          </div>
          <div className="border border-white/20 bg-white/5 rounded-lg p-2 text-center">
            <p className="text-[6px] text-white/60 font-bold">CHECK OUT</p>
            <p className="text-white text-[11px] font-bold mt-0.5">26 Apr</p>
            <p className="text-[6px] text-white/50">Friday</p>
          </div>
        </div>
        <div className="bg-white/5 rounded-lg p-2 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[8px]">👥 Guests</span>
            <div className="flex items-center gap-1">
              <span className="w-4 h-4 rounded-full bg-white/10 text-white text-[8px] flex items-center justify-center">-</span>
              <span className="text-white text-[9px] font-bold w-4 text-center">2</span>
              <span className="w-4 h-4 rounded-full bg-gold-500 text-white text-[8px] flex items-center justify-center">+</span>
            </div>
          </div>
        </div>
        <div className="bg-gold-500/10 border border-gold-400/40 rounded-lg p-1.5 text-center">
          <p className="text-[7px] text-white/60">Total for 2 nights</p>
          <p className="text-gold-400 font-bold text-[13px]">₹5,998</p>
        </div>
      </div>

      {/* Scene 4: Razorpay payment */}
      <div className={sceneCls} style={{ opacity: s === 4 ? 1 : 0 }}>
        <p className="text-blue-400 text-[8px] font-bold tracking-widest uppercase mb-2">💳 Razorpay</p>
        <div className="bg-white rounded-xl p-3 mb-2">
          <p className="text-gray-900 text-[10px] font-bold mb-1">Pay ₹5,998</p>
          <p className="text-gray-500 text-[7px] mb-2">Mountain Grand · 2 nights</p>
          <div className="space-y-1.5">
            <div className="h-5 bg-gray-100 rounded flex items-center px-1.5"><span className="text-[7px] text-gray-600">UPI · 9876****88</span></div>
            <div className="h-5 bg-gray-100 rounded flex items-center px-1.5"><span className="text-[7px] text-gray-400">💳 Card</span></div>
          </div>
          <div className="mt-2 h-6 bg-gradient-to-r from-blue-500 to-blue-600 rounded flex items-center justify-center">
            <span className="text-white text-[8px] font-bold">Pay Now →</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1 text-[7px] text-white/50">
          <span>🔒</span><span>256-bit encrypted · RBI-approved</span>
        </div>
      </div>

      {/* Scene 5: Confirmed */}
      <div className={sceneCls} style={{ opacity: s === 5 ? 1 : 0 }}>
        <div className="h-full flex flex-col items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mb-3 animate-[ping_1s_ease-in-out_1]">
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-emerald-400 text-[11px] font-bold mb-1">Booking Confirmed!</p>
          <p className="text-white/50 text-[8px] mb-3">BID-2026-00241</p>
          <div className="w-full bg-white/5 border border-white/10 rounded-lg p-2">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-gold-500 to-orange-500 rounded" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-[8px] font-bold">Mountain Grand</p>
                <p className="text-white/50 text-[7px]">24-26 Apr · 2 nights</p>
                <p className="text-gold-400 text-[7px] font-bold mt-0.5">+149 StayPoints</p>
              </div>
            </div>
          </div>
          <div className="mt-2 w-20 h-5 bg-white rounded flex items-center justify-center">
            <div className="flex gap-[1px]">
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="bg-black" style={{ width: i % 3 === 0 ? 2 : 1, height: 14 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HOTELS scenes
   ═══════════════════════════════════════════════════════════════════ */
function HotelsScenes({ step }: { step: number }) {
  const s = step;
  return (
    <>
      {/* Scene 0: Nav to Hotels */}
      <div className={sceneCls} style={{ opacity: s === 0 ? 1 : 0 }}>
        <div className="flex items-center gap-1 mb-2">
          <div className="w-4 h-4 rounded bg-gold-500" />
          <span className="text-white text-[10px] font-bold">staybid</span>
        </div>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">Explore</p>
        <p className="text-white text-[11px] font-bold mb-2">Find Your Perfect Stay</p>
        <div className="flex items-center gap-1 bg-white/5 border border-gold-400 rounded-lg px-2 py-1.5 mb-2" style={{ boxShadow: "0 0 10px rgba(240,180,41,0.4)" }}>
          <span className="text-[9px]">🔍</span>
          <span className="text-white/80 text-[8px]">Search hotels…</span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {["Mussoorie", "Shimla", "Manali"].map((c, i) => (
            <span key={c} className={`text-[7px] px-1.5 py-0.5 rounded-full ${i === 0 ? "bg-gold-500 text-white" : "bg-white/5 text-white/50"}`}>{c}</span>
          ))}
        </div>
      </div>

      {/* Scene 1: Results list */}
      <div className={sceneCls} style={{ opacity: s === 1 ? 1 : 0 }}>
        <p className="text-white/50 text-[8px] mb-2">4 hotels in Mussoorie</p>
        <div className="space-y-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className={`flex gap-1.5 p-1.5 rounded-lg border transition-all ${i === 0 ? "border-gold-400 bg-gold-500/10 scale-[1.02]" : "border-white/10 bg-white/[0.02]"}`}>
              <div className={`w-10 h-10 rounded bg-gradient-to-br ${i === 0 ? "from-gold-500 to-orange-500" : "from-slate-600 to-slate-800"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-white text-[8px] font-bold truncate">Hotel Option {i + 1}</p>
                <p className="text-white/40 text-[6px]">⭐ 4.{5 - i}</p>
                <p className="text-gold-400 text-[8px] font-bold mt-0.5">₹{2999 + i * 400}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scene 2: Hotel detail + gallery */}
      <div className={sceneCls} style={{ opacity: s === 2 ? 1 : 0 }}>
        <div className="h-16 bg-gradient-to-br from-gold-500 to-orange-600 rounded-lg mb-2 relative overflow-hidden">
          <span className="absolute top-1 right-1 bg-black/50 text-white text-[7px] px-1 rounded">1/5</span>
          <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[6px] px-1 py-0.5 rounded">★★★★★</span>
        </div>
        <div className="flex gap-1 mb-2">
          {[0,1,2,3].map(i => (
            <div key={i} className="h-5 flex-1 rounded bg-gradient-to-br from-gold-500/40 to-slate-700" />
          ))}
        </div>
        <p className="text-white text-[10px] font-bold mb-0.5">The Mountain Grand</p>
        <p className="text-white/50 text-[7px]">📍 Library Chowk, Mussoorie</p>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {["📶 WiFi", "🅿️ Parking", "🍳 Breakfast", "🏊 Pool"].map(a => (
            <span key={a} className="text-[6px] px-1 py-0.5 bg-white/5 border border-white/10 rounded-full text-white/60">{a}</span>
          ))}
        </div>
      </div>

      {/* Scene 3: Date + guest picker */}
      <div className={sceneCls} style={{ opacity: s === 3 ? 1 : 0 }}>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">Availability</p>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <div className="border border-gold-400 bg-gold-500/10 rounded p-1.5 text-center">
            <p className="text-[6px] text-gold-300">CHECK IN</p>
            <p className="text-white text-[10px] font-bold">24 Apr</p>
          </div>
          <div className="border border-gold-400 bg-gold-500/10 rounded p-1.5 text-center">
            <p className="text-[6px] text-gold-300">CHECK OUT</p>
            <p className="text-white text-[10px] font-bold">27 Apr</p>
          </div>
        </div>
        <div className="space-y-1">
          {[{l:"Adults",v:2},{l:"Children 5-12",v:1},{l:"Kids <5 FREE",v:0}].map(g => (
            <div key={g.l} className="flex items-center justify-between bg-white/5 rounded p-1.5">
              <span className="text-white/70 text-[7px]">{g.l}</span>
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-white/10 text-white text-[7px] flex items-center justify-center">-</span>
                <span className="text-white text-[8px] font-bold w-3 text-center">{g.v}</span>
                <span className="w-3 h-3 rounded-full bg-gold-500 text-white text-[7px] flex items-center justify-center">+</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scene 4: OTA comparison */}
      <div className={sceneCls} style={{ opacity: s === 4 ? 1 : 0 }}>
        <p className="text-emerald-400 text-[8px] font-bold tracking-widest uppercase mb-2">💰 Price Compare</p>
        <div className="space-y-1.5">
          {[
            {name:"MakeMyTrip", price:4599, you:false},
            {name:"Booking.com", price:4699, you:false},
            {name:"Goibibo",     price:4399, you:false},
            {name:"StayBid",     price:2999, you:true},
          ].map(o => (
            <div key={o.name} className={`flex items-center justify-between p-1.5 rounded border ${o.you ? "border-gold-400 bg-gold-500/15" : "border-white/10 bg-white/[0.02]"}`}
                 style={o.you ? { boxShadow: "0 0 8px rgba(240,180,41,0.4)" } : undefined}>
              <span className={`text-[8px] font-bold ${o.you ? "text-gold-300" : "text-white/60"}`}>{o.you ? "⚡ " : ""}{o.name}</span>
              <span className={`text-[9px] font-bold tabular-nums ${o.you ? "text-gold-400" : "text-white/50 line-through"}`}>₹{o.price}</span>
            </div>
          ))}
        </div>
        <p className="text-emerald-400 text-[8px] font-bold text-center mt-2">✓ Cheapest on StayBid</p>
      </div>

      {/* Scene 5: Book confirmed */}
      <div className={sceneCls} style={{ opacity: s === 5 ? 1 : 0 }}>
        <div className="h-full flex flex-col items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mb-3">
            <span className="text-2xl">✓</span>
          </div>
          <p className="text-emerald-400 text-[11px] font-bold mb-1">Booked!</p>
          <p className="text-white/50 text-[8px] mb-3">Instant confirmation</p>
          <div className="w-full bg-white/5 border border-white/10 rounded-lg p-2">
            <p className="text-white text-[8px] font-bold">Mountain Grand</p>
            <p className="text-white/50 text-[7px]">24-27 Apr · 3 nights · 2 adults</p>
            <p className="text-gold-400 text-[10px] font-bold mt-1">₹8,997 paid</p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PLACE BID scenes
   ═══════════════════════════════════════════════════════════════════ */
function BidScenes({ step }: { step: number }) {
  const s = step;
  return (
    <>
      {/* Scene 0: Bid form intro */}
      <div className={sceneCls} style={{ opacity: s === 0 ? 1 : 0 }}>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">🎯 Place Your Bid</p>
        <p className="text-white text-[10px] font-bold leading-tight mb-2">Name Your Price.<br/><span className="text-gold-400">Hotels Compete.</span></p>
        <div className="space-y-1.5">
          <div className="bg-white/5 rounded p-1.5"><p className="text-[6px] text-white/50">DESTINATION</p><p className="text-white text-[8px] font-semibold">Mussoorie</p></div>
          <div className="grid grid-cols-2 gap-1">
            <div className="bg-white/5 rounded p-1.5"><p className="text-[6px] text-white/50">CHECK IN</p><p className="text-white text-[8px]">24 Apr</p></div>
            <div className="bg-white/5 rounded p-1.5"><p className="text-[6px] text-white/50">CHECK OUT</p><p className="text-white text-[8px]">26 Apr</p></div>
          </div>
        </div>
      </div>

      {/* Scene 1: Your budget slider */}
      <div className={sceneCls} style={{ opacity: s === 1 ? 1 : 0 }}>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">💰 Your Budget</p>
        <div className="text-center mb-2">
          <p className="text-[7px] text-white/50">Per night</p>
          <p className="text-gold-400 font-bold text-3xl tabular-nums">₹2,500</p>
          <p className="text-[6px] text-emerald-400 mt-0.5">↓ 44% below average</p>
        </div>
        <div className="relative h-1.5 bg-white/10 rounded-full mb-1">
          <div className="absolute left-0 top-0 h-full w-1/3 bg-gradient-to-r from-gold-500 to-gold-300 rounded-full" />
          <div className="absolute left-1/3 top-1/2 -translate-y-1/2 w-3 h-3 bg-gold-400 border-2 border-white rounded-full" style={{ boxShadow: "0 0 8px rgba(240,180,41,0.8)" }} />
        </div>
        <div className="flex justify-between text-[6px] text-white/40 mb-2">
          <span>₹1,000</span><span>₹10,000</span>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-400/40 rounded p-1.5 text-center">
          <p className="text-emerald-400 text-[7px] font-bold">⚡ Likely to accept</p>
        </div>
      </div>

      {/* Scene 2: Submit animation */}
      <div className={sceneCls} style={{ opacity: s === 2 ? 1 : 0 }}>
        <div className="h-full flex flex-col items-center justify-center">
          <div className="relative mb-3">
            <div className="w-14 h-14 rounded-full bg-gold-500/20 border-2 border-gold-400 flex items-center justify-center">
              <span className="text-2xl">📤</span>
            </div>
            <div className="absolute inset-0 rounded-full border-2 border-gold-400/40 animate-ping" />
          </div>
          <p className="text-white text-[11px] font-bold mb-1">Bid Sent</p>
          <p className="text-white/50 text-[8px] text-center">Notifying 8 hotels in Mussoorie…</p>
          <div className="mt-3 flex gap-1">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center" style={{ animation: `fadeDot 1.2s ${i * 0.15}s infinite` }}>
                <span className="text-[8px]">🏨</span>
              </div>
            ))}
          </div>
          <style>{`@keyframes fadeDot { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
        </div>
      </div>

      {/* Scene 3: Hotels compete — counter offers streaming */}
      <div className={sceneCls} style={{ opacity: s === 3 ? 1 : 0 }}>
        <p className="text-emerald-400 text-[8px] font-bold tracking-widest uppercase mb-2">📬 Counter Offers</p>
        <div className="space-y-1.5">
          {[
            {h:"Mountain Grand", p:2799, tag:"⭐ 4.5"},
            {h:"Forest Retreat", p:2699, tag:"⭐ 4.3"},
            {h:"Pine View Inn",  p:2899, tag:"⭐ 4.6"},
          ].map((o, i) => (
            <div key={o.h} className="flex items-center gap-2 p-1.5 rounded-lg bg-white/5 border border-emerald-400/30"
                 style={{ animation: `slideIn 0.5s ${i * 0.3}s both` }}>
              <div className="w-6 h-6 rounded bg-gradient-to-br from-gold-500 to-orange-500" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-[7px] font-bold truncate">{o.h}</p>
                <p className="text-[6px] text-white/50">{o.tag}</p>
              </div>
              <div className="text-right">
                <p className="text-gold-400 text-[9px] font-bold">₹{o.p}</p>
                <p className="text-[5px] text-emerald-400">NEW</p>
              </div>
            </div>
          ))}
        </div>
        <style>{`@keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }`}</style>
      </div>

      {/* Scene 4: Accept offer */}
      <div className={sceneCls} style={{ opacity: s === 4 ? 1 : 0 }}>
        <p className="text-gold-400 text-[8px] font-bold tracking-widest uppercase mb-2">Best Offer</p>
        <div className="bg-gold-500/10 border border-gold-400 rounded-xl p-2 mb-2" style={{ boxShadow: "0 0 14px rgba(240,180,41,0.5)" }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-gold-500 to-orange-500" />
            <div>
              <p className="text-white text-[9px] font-bold">Forest Retreat</p>
              <p className="text-[6px] text-emerald-400">Saved ₹2,200 vs OTA</p>
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-white/50 text-[6px] line-through">₹4,899</span>
            <span className="text-gold-400 font-bold text-lg">₹2,699<span className="text-[7px] text-white/50">/nt</span></span>
          </div>
        </div>
        <div className="h-6 bg-gradient-to-r from-gold-600 to-gold-400 rounded-lg flex items-center justify-center" style={{ boxShadow: "0 4px 12px rgba(240,180,41,0.4)" }}>
          <span className="text-white text-[9px] font-bold">✓ Accept & Pay</span>
        </div>
      </div>

      {/* Scene 5: Confirmation */}
      <div className={sceneCls} style={{ opacity: s === 5 ? 1 : 0 }}>
        <div className="h-full flex flex-col items-center justify-center">
          <div className="text-4xl mb-2">🎉</div>
          <p className="text-emerald-400 text-[11px] font-bold mb-1">Saved ₹2,200!</p>
          <p className="text-white/50 text-[8px] mb-3 text-center">Your bid won<br/>Booking confirmed</p>
          <div className="w-full bg-gradient-to-br from-gold-500/20 to-purple-500/10 border border-gold-400/40 rounded-lg p-2">
            <p className="text-white text-[8px] font-bold">Forest Retreat · Dhanaulti</p>
            <p className="text-white/50 text-[6px]">24-26 Apr · 2 nights</p>
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-white/10">
              <span className="text-[6px] text-white/50">Total paid</span>
              <span className="text-gold-400 text-[9px] font-bold">₹5,398</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Animated countdown inside scene 1 of Flash ─── */
function FlippingCountdown() {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  const m = new Date(); m.setHours(23,59,59,999);
  const d = Math.max(0, m.getTime() - t);
  const hh = String(Math.floor(d / 3600000)).padStart(2, "0");
  const mm = String(Math.floor((d % 3600000) / 60000)).padStart(2, "0");
  const ss = String(Math.floor((d % 60000) / 1000)).padStart(2, "0");
  return <>{hh}:{mm}:{ss}</>;
}

/* ═══════════════════════════════════════════════════════════════════
   FEATURE CONFIG — bilingual steps for all 3 features
   ═══════════════════════════════════════════════════════════════════ */
type Step = {
  hi: string;
  en: string;
};
type Feature = {
  id: string;
  icon: string;
  title: { en: string; hi: string };
  color: string;
  accent: string;
  steps: Step[];
  cta: { href: string; en: string; hi: string };
  Scenes: (p: { step: number }) => JSX.Element;
};

const FEATURES: Feature[] = [
  {
    id: "flash",
    icon: "⚡",
    title: { en: "Flash Deals", hi: "फ्लैश डील्स" },
    color: "#ef4444", accent: "#f0b429",
    Scenes: FlashScenes,
    cta: { href: "/flash-deals", en: "Browse Flash Deals →", hi: "फ्लैश डील्स देखें →" },
    steps: [
      { en: "Open the StayBid home page. At the top you will see a carousel of same-day flash deals with massive discounts.",
        hi: "स्टेबिड का होम पेज खोलें। सबसे ऊपर आज की फ्लैश डील्स एक रोटेटिंग कैरोसेल में दिखेंगी, बहुत बड़े डिस्काउंट के साथ।" },
      { en: "Every flash deal is valid only till midnight. A live timer shows how much time is left, and how many slots remain.",
        hi: "हर फ्लैश डील सिर्फ रात बारह बजे तक वैलिड होती है। लाइव टाइमर दिखाता है कि कितना टाइम बचा है और कितनी स्लॉट्स ख़ाली हैं।" },
      { en: "Tap any deal that interests you. The hotel detail page opens with the discounted flash price already applied.",
        hi: "जो भी डील पसंद आए उस पर टैप करें। होटल का डिटेल पेज खुलेगा, डिस्काउंटेड फ्लैश प्राइस पहले से लगा हुआ मिलेगा।" },
      { en: "Pick your check-in and check-out dates, and the number of guests. The total for your stay is shown instantly.",
        hi: "अपनी चेक-इन और चेक-आउट डेट चुनें, और कितने गेस्ट्स हैं वो बताएँ। आपकी पूरी स्टे का टोटल तुरंत दिखेगा।" },
      { en: "Click Book Now. A secure Razorpay window opens where you can pay via UPI, card, or net banking. It is fully encrypted.",
        hi: "बुक नाउ दबाएँ। एक सिक्योर रज़रपे विंडो खुलेगी जहाँ आप यूपीआई, कार्ड या नेट बैंकिंग से पे कर सकते हैं। पूरी तरह एन्क्रिप्टेड।" },
      { en: "Your booking is instantly confirmed. You get a booking ID, a barcode for check-in, and StayPoints added to your wallet.",
        hi: "बुकिंग तुरंत कन्फर्म हो जाती है। आपको बुकिंग आईडी, चेक-इन के लिए बारकोड, और वॉलेट में स्टेपॉइंट्स मिल जाते हैं।" },
    ],
  },
  {
    id: "hotels",
    icon: "🏨",
    title: { en: "Hotels", hi: "होटल्स" },
    color: "#c9911a", accent: "#c9911a",
    Scenes: HotelsScenes,
    cta: { href: "/hotels", en: "Explore Hotels →", hi: "होटल्स देखें →" },
    steps: [
      { en: "Open the Hotels page. Use the search bar to type a destination, or tap a city chip like Mussoorie or Shimla.",
        hi: "होटल्स पेज खोलें। सर्च बार में शहर का नाम टाइप करें, या मसूरी, शिमला जैसी सिटी चिप पर टैप करें।" },
      { en: "You will see a list of verified hotels in that city with ratings, starting price and amenities at a glance.",
        hi: "उस शहर के वेरिफाइड होटल्स की लिस्ट दिखेगी — रेटिंग, शुरुआती दाम और एमिनिटीज़ एक नज़र में।" },
      { en: "Tap any hotel card to open the full detail page with photo gallery, room types, star rating, and exact location.",
        hi: "किसी भी होटल कार्ड पर टैप करें — फोटो गैलरी, कमरे के टाइप्स, स्टार रेटिंग, और सटीक लोकेशन दिखेगी।" },
      { en: "Use the availability picker to pick check-in, check-out, adults, children and kids under five, who stay free.",
        hi: "अवेलेबिलिटी पिकर से चेक-इन, चेक-आउट, एडल्ट्स, बच्चे, और पाँच साल से छोटे किड्स चुनें — जो फ्री रहते हैं।" },
      { en: "StayBid shows live price comparison with MakeMyTrip, Booking.com, Goibibo and Agoda. We are always the cheapest.",
        hi: "स्टेबिड MakeMyTrip, Booking.com, Goibibo, Agoda के साथ लाइव प्राइस कम्पेयरिज़न दिखाता है। हम हमेशा सबसे सस्ते हैं।" },
      { en: "Hit Book Now, pay securely via Razorpay, and your booking is confirmed instantly with barcode and payment details.",
        hi: "बुक नाउ दबाएँ, रज़रपे से सिक्योर पेमेंट करें — बुकिंग तुरंत कन्फर्म, बारकोड और पेमेंट डिटेल्स के साथ।" },
    ],
  },
  {
    id: "bid",
    icon: "🎯",
    title: { en: "Place Bid", hi: "अपना दाम तय करें" },
    color: "#f0b429", accent: "#f0b429",
    Scenes: BidScenes,
    cta: { href: "/bid", en: "Place Your Bid →", hi: "अपनी बिड लगाएं →" },
    steps: [
      { en: "Go to the Place Bid page. Enter your destination city, check-in date, check-out date, and how many guests will stay.",
        hi: "प्लेस बिड पेज पर जाएँ। अपना डेस्टिनेशन शहर, चेक-इन, चेक-आउट डेट, और कितने गेस्ट्स आएँगे — बताएं।" },
      { en: "Now the magic — you decide your own budget per night. Slide the bid amount to whatever you are willing to pay.",
        hi: "अब मैजिक — आप ख़ुद अपना बजट तय करते हैं प्रति रात। जितना देना चाहें, स्लाइडर से उतनी रकम सेट करें।" },
      { en: "Submit your bid. Every hotel in your selected city instantly gets notified about your offer.",
        hi: "अपनी बिड सबमिट करें। चुने हुए शहर के सभी होटल्स को आपकी ऑफ़र की नोटिफ़िकेशन तुरंत पहुँच जाती है।" },
      { en: "Hotels now compete. They can accept your bid, or send back counter-offers, often better than what you see on other OTAs.",
        hi: "अब होटल्स आपस में कम्पीट करते हैं। वो बिड accept कर सकते हैं, या काउंटर-ऑफ़र भेजते हैं — अक्सर दूसरे ओटीए से बेहतर।" },
      { en: "Open the My Bids page to see live counter offers stream in. Compare ratings, location and amenities at a glance.",
        hi: "My Bids पेज खोलें — लाइव काउंटर ऑफ़र्स आते दिखेंगे। रेटिंग, लोकेशन, एमिनिटीज़ एक नज़र में कम्पेयर करें।" },
      { en: "Pick the best counter, pay securely, and save up to forty percent compared to other travel portals.",
        hi: "सबसे अच्छी काउंटर ऑफ़र चुनें, सिक्योर पेमेंट करें, और दूसरे ट्रैवल पोर्टल्स के मुक़ाबले चालीस परसेंट तक बचाएं।" },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════
   MAIN EXPORT — FeatureExplainers
   ═══════════════════════════════════════════════════════════════════ */
export default function FeatureExplainers() {
  const [active, setActive]   = useState(0);
  const [lang, setLang]       = useState<"en" | "hi">("en");
  const [step, setStep]       = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeoutsRef           = useRef<number[]>([]);
  const voicesReadyRef        = useRef(false);

  const feat = FEATURES[active];

  // Force voices to load (Chrome loads asynchronously)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const check = () => { if (window.speechSynthesis.getVoices().length > 0) voicesReadyRef.current = true; };
    check();
    window.speechSynthesis.onvoiceschanged = check;
    return () => { if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const stop = useCallback(() => {
    timeoutsRef.current.forEach(t => clearTimeout(t));
    timeoutsRef.current = [];
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setPlaying(false);
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => { stop(); setStep(0); }, [active, lang, stop]);

  const estimateDuration = (text: string) => Math.max(3200, text.length * 75);

  const speakOne = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = lang === "hi" ? "hi-IN" : "en-US";
    u.rate  = lang === "hi" ? 0.88 : 0.95;   // slightly slower = more natural
    u.pitch = 1.0;
    u.volume = 1.0;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  };

  const play = () => {
    stop();
    setPlaying(true);
    setStep(0);
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.getVoices();

    let cumulative = 400;
    feat.steps.forEach((s, i) => {
      const text = lang === "hi" ? s.hi : s.en;
      const t = window.setTimeout(() => {
        setStep(i);
        speakOne(text);
        if (i === feat.steps.length - 1) {
          const end = window.setTimeout(() => setPlaying(false), estimateDuration(text) + 500);
          timeoutsRef.current.push(end);
        }
      }, cumulative);
      timeoutsRef.current.push(t);
      cumulative += estimateDuration(text) + 350;
    });
  };

  const Scenes = feat.Scenes;
  const currentStepText = lang === "hi" ? feat.steps[step].hi : feat.steps[step].en;

  return (
    <section className="relative py-16 md:py-20 overflow-hidden" style={{ background: "linear-gradient(180deg,#0a0812 0%,#0e0a1c 100%)" }}>
      <style>{`
        @keyframes speakWave { 0%,100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
        .wave-bar { animation: speakWave 0.55s ease-in-out infinite; transform-origin: bottom; }
      `}</style>

      <div className="max-w-6xl mx-auto px-5">
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-gold-400 text-[0.65rem] font-bold tracking-[0.22em] uppercase mb-2">Live Walkthrough · Voice Guided</p>
          <h2 className="font-display font-light text-white" style={{ fontSize: "clamp(1.7rem,3.5vw,2.4rem)" }}>
            How StayBid <span className="lux-gold-text font-semibold">Works — Live Demo</span>
          </h2>
          <p className="text-white/50 text-xs md:text-sm mt-2">
            {lang === "hi" ? "प्ले दबाएँ — हर स्क्रीन live दिखेगी, साथ में voice narration" : "Hit play — watch each screen animate live with voice narration"}
          </p>
        </div>

        {/* Language + feature tabs */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            {FEATURES.map((f, i) => (
              <button key={f.id} onClick={() => setActive(i)}
                className={`nav3d-chip flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs md:text-sm font-semibold ${active === i ? "nav3d-chip-active" : "text-white/60"}`}>
                <span className="text-base">{f.icon}</span>
                <span>{f.title[lang]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
            {(["en", "hi"] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 py-1 rounded-full text-[0.7rem] font-bold transition-all ${lang === l ? "bg-gold-500 text-white shadow-gold" : "text-white/50 hover:text-white"}`}>
                {l === "en" ? "🇬🇧 EN" : "🇮🇳 हिंदी"}
              </button>
            ))}
          </div>
        </div>

        {/* Player card */}
        <div className="lux-glass lux-border rounded-3xl p-5 md:p-7 relative overflow-hidden">
          <div className="absolute -top-32 -right-32 w-72 h-72 rounded-full pointer-events-none"
               style={{ background: `radial-gradient(circle, ${feat.color}22, transparent 70%)` }} />

          <div className="grid md:grid-cols-[auto,1fr] gap-6 md:gap-8 relative">
            {/* Phone demo */}
            <div className="flex flex-col items-center">
              <PhoneFrame accent={feat.accent}>
                <Scenes step={step} />
              </PhoneFrame>

              {/* Scrubber dots */}
              <div className="flex items-center justify-center gap-1.5 mt-4">
                {feat.steps.map((_, i) => (
                  <button key={i} onClick={() => { stop(); setStep(i); }}
                    className={`h-1.5 rounded-full transition-all ${i === step ? "w-8" : "w-1.5 hover:w-3"}`}
                    style={{ background: i === step ? feat.accent : "rgba(255,255,255,0.25)" }} />
                ))}
              </div>
            </div>

            {/* Right panel: controls + step list */}
            <div className="flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-[0.6rem] font-bold tracking-[0.22em] uppercase" style={{ color: feat.color }}>
                    Step {step + 1} of {feat.steps.length}
                  </p>
                  <h3 className="font-display text-white text-xl md:text-2xl mt-1">
                    {feat.icon} {feat.title[lang]}
                  </h3>
                </div>
                <button onClick={playing ? stop : play}
                  className="lux-btn flex items-center gap-2 px-4 py-2.5 rounded-full text-xs md:text-sm whitespace-nowrap shrink-0">
                  {playing ? (<><span>⏹</span><span>{lang === "hi" ? "रोकें" : "Stop"}</span></>)
                           : (<><span>▶</span><span>{lang === "hi" ? "प्ले करें" : "Play Demo"}</span></>)}
                </button>
              </div>

              {/* Current step highlight */}
              <div className="lux-glass rounded-2xl p-3 md:p-4 mb-3 border" style={{ borderColor: `${feat.color}55`, boxShadow: playing ? `0 0 24px ${feat.color}44` : undefined }}>
                <div className="flex items-center gap-2 mb-1.5">
                  {playing && (
                    <div className="flex items-end gap-0.5 h-4">
                      {[0,0.1,0.2,0.15,0.05].map((d, i) => (
                        <span key={i} className="wave-bar w-0.5 rounded-full" style={{ height: "100%", background: feat.color, animationDelay: `${d}s` }} />
                      ))}
                    </div>
                  )}
                  <span className="text-[0.6rem] font-bold tracking-widest uppercase" style={{ color: feat.color }}>
                    {playing ? (lang === "hi" ? "चल रहा है…" : "Playing…") : (lang === "hi" ? "अभी" : "Now")}
                  </span>
                </div>
                <p className="text-white text-sm md:text-base leading-relaxed">{currentStepText}</p>
              </div>

              {/* Full step list (click to jump) */}
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                {feat.steps.map((s, i) => {
                  const isActiveStep = i === step;
                  return (
                    <button key={i} onClick={() => { stop(); setStep(i); speakOne(lang === "hi" ? s.hi : s.en); }}
                      className={`w-full text-left flex items-start gap-2 p-2 rounded-lg border transition-all ${isActiveStep ? "border-gold-400/60 bg-gold-500/10" : "border-white/5 hover:border-white/15 bg-white/[0.02]"}`}>
                      <span className="text-[0.65rem] font-bold tabular-nums shrink-0 mt-0.5" style={{ color: isActiveStep ? feat.color : "rgba(255,255,255,0.3)" }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={`text-[0.75rem] leading-snug ${isActiveStep ? "text-white" : "text-white/55"}`}>
                        {lang === "hi" ? s.hi : s.en}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[0.6rem] text-white/40">🔊 {lang === "hi" ? "आपके ब्राउज़र की हिंदी voice उपयोग करता है" : "Uses your browser's built-in voice"}</p>
                <Link href={feat.cta.href} className="lux-btn px-4 py-2 rounded-full text-xs">
                  {feat.cta[lang]}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
