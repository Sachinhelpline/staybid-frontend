"use client";
//
// v178 — Service renewal banner (partner panel, Phase 4).
//
// Paid / trial subscriptions expire silently via the lazy expires_at
// check. This banner gives the hotel advance warning: any paid-or-trial
// service expiring within 7 days — or already expired — shows here with
// a one-tap Renew that re-runs the Razorpay checkout.
//
import { TriangleAlert, Clock } from "lucide-react";
import { SERVICE_LABEL } from "@/lib/partner/services";

const WARN_DAYS = 7;

type Ent = {
  accessType?: string | null;
  plan?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
};

function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86400000);
}

export default function ServiceRenewBanner({
  entitlements, onRenew,
}: {
  entitlements: Record<string, Ent>;
  onRenew: (serviceKey: string) => void;
}) {
  const items: { key: string; expired: boolean; days: number | null; trial: boolean }[] = [];
  for (const [key, e] of Object.entries(entitlements || {})) {
    const at = e?.accessType;
    // Only paid / trial grants expire. Permanent free grants never do.
    if (at !== "paid" && at !== "trial") continue;
    if (!e?.expiresAt) continue;
    const d = daysLeft(e.expiresAt);
    const expired = !!e.expired || (d != null && d < 0);
    if (expired) {
      items.push({ key, expired: true, days: d, trial: at === "trial" });
    } else if (d != null && d <= WARN_DAYS) {
      items.push({ key, expired: false, days: d, trial: at === "trial" });
    }
  }
  if (!items.length) return null;

  // Expired first, then soonest-expiring.
  items.sort((a, b) => (a.expired === b.expired ? (a.days ?? 0) - (b.days ?? 0) : a.expired ? -1 : 1));

  const anyExpired = items.some((i) => i.expired);

  return (
    <div className={`rounded-xl mb-4 px-3.5 py-3 border ${anyExpired ? "bg-red-50 border-red-200" : "bg-luxury-50 border-luxury-200"}`}>
      <p className="text-[0.78rem] font-bold text-luxury-900 flex items-center gap-1.5">
        {anyExpired
          ? <TriangleAlert size={14} strokeWidth={2.4} aria-hidden className="text-red-600 shrink-0" />
          : <Clock size={14} strokeWidth={2.4} aria-hidden className="text-luxury-500 shrink-0" />}
        {anyExpired ? "Some services have expired" : "A subscription is expiring soon"}
      </p>
      <div className="mt-2 space-y-1.5">
        {items.map((it) => {
          const label = SERVICE_LABEL[it.key] || it.key;
          let note: string;
          if (it.expired) note = `${it.trial ? "Trial" : "Plan"} ended — service locked`;
          else if (it.days === 0) note = "Expires today";
          else if (it.days === 1) note = "Expires tomorrow";
          else note = `Expires in ${it.days} days`;
          return (
            <div key={it.key} className="flex items-center justify-between gap-2">
              <span className="text-[0.7rem] text-luxury-600 min-w-0">
                <b className="text-luxury-900">{label}</b>
                <span className="text-luxury-500"> — {note}</span>
              </span>
              <button
                onClick={() => onRenew(it.key)}
                className="shrink-0 rounded-lg px-2.5 py-1 text-[0.66rem] font-bold text-white transition-all"
                style={{ background: it.expired ? "#c0392b" : "#8198ae" }}
              >
                {it.expired ? "Renew" : "Renew now"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
