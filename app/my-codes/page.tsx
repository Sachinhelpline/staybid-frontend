"use client";
// /my-codes — IG-Wallet-style codes wallet. Active codes appear at top with
// QR + alphanumeric + faux-barcode bars. Used / expired codes filterable below.
// Tap an active coupon → "Use at next checkout" sets the localStorage hint
// that BookingReview reads.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { redirectToSignIn } from "@/lib/auth-intent";
import { CountUp } from "@/components/CountUp";
import {
  type RedemptionCode,
  type CodeStatus,
  kindIcon,
  kindLabel,
  setPendingRedemption,
  statusColor,
} from "@/lib/redemption";

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Faux barcode bars derived from the 12-digit numeric — purely decorative,
// real validation uses the alphanumeric code or barcode_value typed/scanned.
function BarcodeBars({ value }: { value: string }) {
  const bars: { w: number; on: boolean }[] = [];
  for (let i = 0; i < value.length; i++) {
    const n = parseInt(value[i], 10);
    bars.push({ w: 2, on: true });
    bars.push({ w: 1 + (n % 3), on: false });
    bars.push({ w: 1 + (n % 2), on: true });
    bars.push({ w: 1, on: false });
  }
  return (
    <div className="flex items-end h-12 gap-px my-2">
      {bars.map((b, i) => (
        <div key={i}
          style={{
            width: `${b.w}px`,
            height: "100%",
            background: b.on ? "#1f1a0f" : "transparent",
          }} />
      ))}
    </div>
  );
}

// External QR — qrserver.com has been stable for 10+ years. Falls back gracefully
// to the alphanumeric code if blocked. ~1KB image.
function QRTile({ data, size = 140 }: { data: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-2xl border-2 border-luxury-200 bg-white flex items-center justify-center"
        style={{ width: size, height: size }}>
        <span className="text-xs text-luxury-400 text-center px-2 leading-snug">
          Show this code at checkout
        </span>
      </div>
    );
  }
  const src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=${size}x${size}&margin=2&format=svg`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Scan this code"
      onError={() => setFailed(true)}
      style={{ borderRadius: 12, background: "#fff", display: "block" }}
    />
  );
}

export default function MyCodesPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-luxury-50"><p className="text-luxury-500 text-sm">Loading codes…</p></div>}>
      <MyCodesPage />
    </Suspense>
  );
}

function MyCodesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const initialFilter = (params?.get("status") as CodeStatus) || "active";
  const { user, loading: authLoading } = useAuth();
  const [codes, setCodes] = useState<RedemptionCode[]>([]);
  const [walletCredit, setWalletCredit] = useState<{ balance_inr: number; lifetime_credited: number; lifetime_debited: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CodeStatus | "all">(initialFilter);
  const [openCode, setOpenCode] = useState<RedemptionCode | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      redirectToSignIn(router, {
        route: typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/my-codes",
      });
      return;
    }
    let dead = false;
    api.getMyRedemptionCodes().then((d) => {
      if (dead) return;
      setCodes(d?.codes || []);
      setWalletCredit(d?.walletCredit || null);
    }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [authLoading, user, router]);

  const filtered = useMemo(() => {
    if (filter === "all") return codes;
    return codes.filter((c) => c.status === filter);
  }, [codes, filter]);

  const counts = useMemo(() => ({
    active:  codes.filter((c) => c.status === "active").length,
    used:    codes.filter((c) => c.status === "used").length,
    expired: codes.filter((c) => c.status === "expired").length,
  }), [codes]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  function copy(s: string, label = "Code") {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(s).then(() => showToast(`${label} copied ✓`));
  }

  function useAtCheckout(c: RedemptionCode) {
    if (c.kind === "coupon" || c.kind === "voucher") {
      setPendingRedemption({
        code: c.code,
        kind: c.kind,
        value_inr: Number(c.value_inr) || 0,
        title: c.title || c.code,
        expires_at: c.expires_at,
      });
      showToast("Coupon queued — apply at next booking");
      router.push("/hotels");
    } else if (c.kind === "wallet_credit") {
      // Already credited at redemption time — open wallet for "Use in booking" CTA there
      router.push("/wallet");
    } else {
      // amenity — show at hotel desk; open the detail view
      setOpenCode(c);
    }
  }

  if (loading || authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-luxury-50">
      <p className="text-luxury-500 text-sm">Loading codes…</p>
    </div>;
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-luxury-50 via-white to-luxury-50 pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6">

        <div className="flex items-start justify-between mb-4 gap-3 sb-fade-in">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-luxury-900 leading-tight">My Codes</h1>
            <p className="text-luxury-500 text-sm mt-0.5">Active coupons, vouchers, and hotel perks.</p>
          </div>
          <Link href="/points/redeem"
            className="text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-xl text-white whitespace-nowrap shrink-0 sb-card-lift sb-shimmer relative"
            style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
            <span className="relative" style={{ zIndex: 2 }}>✨ Redeem</span>
          </Link>
        </div>

        {/* Wallet credit balance card */}
        {walletCredit && Number(walletCredit.balance_inr) > 0 && (
          <Link href="/wallet"
            className="block card-luxury sb-card-lift sb-fade-in p-4 mb-4 relative overflow-hidden text-white"
            style={{ background: "linear-gradient(135deg,#0a0812,#1a1424)", animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[0.6rem] uppercase tracking-widest font-bold text-gold-400 mb-1 inline-flex items-center gap-1.5">
                  <span className="sb-pulse-dot is-warn" />
                  💰 Wallet Credit
                </p>
                <p className="font-display text-3xl font-bold leading-none">₹<CountUp value={Number(walletCredit.balance_inr) || 0} duration={1100} /></p>
                <p className="text-[0.65rem] text-white/60 mt-1">Use at any booking →</p>
              </div>
              <span className="text-3xl opacity-80">→</span>
            </div>
          </Link>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: "none" }}>
          {[
            ["active", `Active${counts.active ? ` · ${counts.active}` : ""}`],
            ["used", `Used${counts.used ? ` · ${counts.used}` : ""}`],
            ["expired", `Expired${counts.expired ? ` · ${counts.expired}` : ""}`],
            ["all", "All"],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k as any)}
              className={`text-xs font-semibold px-3.5 py-1.5 rounded-full border whitespace-nowrap transition sb-card-lift ${
                filter === k
                  ? "bg-luxury-900 text-white border-luxury-900"
                  : "bg-white text-luxury-700 border-luxury-200"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="card-luxury sb-card-lift sb-fade-in p-8 text-center">
            <p className="text-3xl mb-2">🎁</p>
            <p className="font-bold text-luxury-900">No codes here yet</p>
            <p className="text-sm text-luxury-500 mt-1 mb-4">Redeem your StayPoints for coupons, wallet credit, or hotel perks.</p>
            <Link href="/points/redeem" className="inline-block px-4 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
              Redeem now →
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sb-stagger" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {filtered.map((c) => {
              const st = statusColor(c.status);
              const expired = c.status === "active" && new Date(c.expires_at).getTime() < Date.now();
              const effectiveStatus: CodeStatus = expired ? "expired" : c.status;
              const eff = statusColor(effectiveStatus);
              return (
                <button key={c.id}
                  onClick={() => setOpenCode(c)}
                  className="card-luxury sb-card-lift p-4 text-left relative overflow-hidden transition hover:shadow-luxury">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                        style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)" }}>
                        {kindIcon(c.kind)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-luxury-900 text-sm leading-tight truncate">{c.title || c.code}</p>
                        <p className="text-[0.6rem] uppercase tracking-wider font-bold text-luxury-500 mt-0.5">
                          {kindLabel(c.kind)}
                          {Number(c.value_inr) > 0 ? ` · ₹${fmt(Number(c.value_inr))}` : ""}
                        </p>
                      </div>
                    </div>
                    <span className="text-[0.55rem] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0"
                      style={{ background: eff.bg, color: eff.text, borderColor: eff.border }}>
                      {eff.label}
                    </span>
                  </div>
                  <div className="font-mono text-base font-bold text-luxury-900 tracking-wider select-all">{c.code}</div>
                  <p className="text-[0.6rem] text-luxury-400 mt-1">
                    {c.status === "active" && !expired ? `Expires ${fmtDate(c.expires_at)}`
                      : c.status === "used" ? `Used ${fmtDate(c.used_at || c.issued_at)}`
                      : `Expired ${fmtDate(c.expires_at)}`}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail / "Show this" modal */}
      {openCode && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center backdrop-blur-md bg-black/80 p-3"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          onClick={() => setOpenCode(null)}>
          <div className="w-full sm:max-w-md rounded-3xl bg-white overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 text-center" style={{ background: "linear-gradient(135deg,#fff9ec,#fdf4d3)" }}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-2 text-3xl"
                style={{ background: "linear-gradient(135deg,#f0b429,#c9911a)" }}>{kindIcon(openCode.kind)}</div>
              <p className="font-display text-lg font-bold text-luxury-900">{openCode.title || openCode.code}</p>
              {Number(openCode.value_inr) > 0 && (
                <p className="text-sm font-bold text-gold-700">Worth ₹{fmt(Number(openCode.value_inr))}</p>
              )}
            </div>

            <div className="p-5 space-y-3">
              <div className="flex justify-center">
                <QRTile data={openCode.code} size={160} />
              </div>
              <div className="border-2 border-dashed border-gold-300 rounded-2xl p-3 text-center bg-white">
                <p className="text-[0.55rem] uppercase tracking-widest font-bold text-luxury-400 mb-1">Code</p>
                <p className="font-mono text-xl font-bold text-luxury-900 tracking-wider select-all">{openCode.code}</p>
                <BarcodeBars value={openCode.barcode_value} />
                <p className="font-mono text-xs text-luxury-500 tracking-widest">{openCode.barcode_value}</p>
              </div>

              <p className="text-[0.7rem] text-center text-luxury-500">
                Status: <span className="font-bold uppercase">{openCode.status}</span> · Expires {fmtDate(openCode.expires_at)}
              </p>

              <div className="flex gap-2">
                <button onClick={() => copy(openCode.code, "Code")}
                  className="flex-1 py-2.5 rounded-2xl font-semibold text-xs border border-luxury-200 text-luxury-700 hover:bg-luxury-50">
                  📋 Copy code
                </button>
                {typeof navigator !== "undefined" && (navigator as any).share && (
                  <button onClick={() => (navigator as any).share?.({ title: "StayBid reward", text: `My StayBid reward code: ${openCode.code}` })}
                    className="flex-1 py-2.5 rounded-2xl font-semibold text-xs border border-luxury-200 text-luxury-700 hover:bg-luxury-50">
                    📲 Share
                  </button>
                )}
              </div>

              {openCode.status === "active" && !((new Date(openCode.expires_at).getTime() < Date.now())) && (
                <button onClick={() => useAtCheckout(openCode)}
                  className="w-full py-3 rounded-2xl font-bold text-sm text-white"
                  style={{ background: "linear-gradient(135deg,#b8871a,#f0b429,#c9911a)" }}>
                  {openCode.kind === "amenity" ? "🏨 Show at hotel desk" :
                   openCode.kind === "wallet_credit" ? "💰 Go to wallet" :
                   "🎟️ Use at next checkout →"}
                </button>
              )}

              <button onClick={() => setOpenCode(null)}
                className="w-full py-2.5 rounded-2xl font-semibold text-xs text-luxury-500 hover:text-luxury-700">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 z-70 px-4 py-2 rounded-full bg-luxury-900 text-white text-xs font-semibold shadow-lg"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom, 0px))" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
