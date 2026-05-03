"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

const TABS = [
  { href: "/influencer/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/influencer/referrals", label: "Referrals", icon: "🔗" },
  { href: "/influencer/earnings",  label: "Earnings",  icon: "💸" },
  { href: "/influencer/profile",   label: "Profile",   icon: "👤" },
];

export default function InfluencerLayout({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const router   = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [registered, setRegistered] = useState(false);

  // Public creator profile pages skip the entire auth check.
  const isPublic = !!pathname && pathname.startsWith("/influencer/public");

  useEffect(() => {
    if (isPublic) { setChecking(false); return; }
    if (authLoading) return;
    if (!user) { router.push("/auth?next=/influencer"); return; }

    api.getMyInfluencer()
      .then((d) => {
        const reg = !!d?.registered;
        setRegistered(reg);
        // Routing matrix:
        //   /influencer (index)       → register-or-dashboard based on reg
        //   /influencer/register      → dashboard if already registered
        //   /influencer/<other>       → register if not registered
        if (pathname === "/influencer") {
          router.replace(reg ? "/influencer/dashboard" : "/influencer/register");
        } else if (pathname === "/influencer/register" && reg) {
          router.replace("/influencer/dashboard");
        } else if (!reg && pathname !== "/influencer/register") {
          router.replace("/influencer/register");
        }
      })
      .catch(() => {
        setRegistered(false);
        if (pathname !== "/influencer/register") router.replace("/influencer/register");
      })
      .finally(() => setChecking(false));
  }, [authLoading, user, pathname, router, isPublic]);

  // Public profile renders without the chrome/tabs.
  if (isPublic) return <>{children}</>;

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-luxury-50">
        <div className="text-center">
          <div className="shimmer w-16 h-16 rounded-full mx-auto mb-3" />
          <p className="text-luxury-600 text-sm font-medium">Loading creator hub…</p>
        </div>
      </div>
    );
  }

  const showTabs = registered && pathname !== "/influencer/register";
  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <div className="min-h-screen bg-gradient-to-b from-luxury-50 via-white to-luxury-50">
      <div className="max-w-6xl mx-auto px-4 pt-6 pb-24">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">✨</span>
          <div>
            <h1 className="font-display text-3xl md:text-4xl font-bold text-luxury-900 leading-none">
              Creator Hub
            </h1>
            <p className="text-luxury-500 text-sm mt-1">Earn 12% commission on every booking you bring</p>
          </div>
        </div>
        <div className="divider-gold my-5" />

        {showTabs && (
          <div className="flex gap-2 mb-6 overflow-x-auto -mx-1 px-1">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  isActive(t.href)
                    ? "bg-gold-500 text-white border-gold-600 shadow-gold"
                    : "bg-white text-luxury-700 border-luxury-200 hover:border-gold-400"
                }`}>
                <span className="mr-1.5">{t.icon}</span>{t.label}
              </Link>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
