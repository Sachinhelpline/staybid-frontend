"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function WalletPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push("/auth"); return; }
    api.getWallet()
      .then((d) => setWallet(d.wallet || d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, authLoading, router]);

  const txTypeStyle = (type: string) => {
    if (!type) return { color: "text-luxury-600", icon: "•" };
    const t = type.toUpperCase();
    if (t.includes("CREDIT") || t.includes("REFUND") || t.includes("ADD"))
      return { color: "text-emerald-600", icon: "+" };
    if (t.includes("DEBIT") || t.includes("CHARGE") || t.includes("PAY"))
      return { color: "text-red-500", icon: "−" };
    return { color: "text-luxury-600", icon: "•" };
  };

  if (authLoading || loading) return (
    <div className="max-w-xl mx-auto px-5 py-12 space-y-4">
      <div className="h-40 shimmer rounded-3xl" />
      <div className="h-12 shimmer rounded-2xl" />
      <div className="h-12 shimmer rounded-2xl" />
      <div className="h-12 shimmer rounded-2xl" />
    </div>
  );

  return (
    <div className="bg-luxury-50 min-h-screen">
      <div className="max-w-xl mx-auto px-5 py-12">

        {/* Header */}
        <div className="mb-8">
          <p className="text-gold-500 text-[0.68rem] font-semibold tracking-[0.2em] uppercase mb-2">Account</p>
          <h1 className="font-display font-light text-luxury-900" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
            My Wallet
          </h1>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-6">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Balance card */}
        {wallet && (
          <>
            <div
              className="rounded-3xl p-8 mb-6 text-white relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #0a0812 0%, #130f24 60%, #0a1020 100%)" }}
            >
              {/* Gold glow */}
              <div
                className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none opacity-[0.08]"
                style={{ background: "radial-gradient(circle, #f0b429 0%, transparent 70%)", transform: "translate(30%, -30%)" }}
              />

              <p className="text-white/50 text-xs tracking-[0.2em] uppercase font-semibold mb-3">Available Balance</p>
              <p className="font-display font-light text-white mb-1" style={{ fontSize: "clamp(2.5rem, 6vw, 3.5rem)" }}>
                ₹{(wallet.balance ?? 0).toLocaleString("en-IN")}
              </p>
              <p className="text-white/40 text-xs tracking-wide mt-2">
                StayBid Wallet · {user?.phone}
              </p>

              {wallet.totalCredit !== undefined && (
                <div className="flex gap-8 mt-6 pt-5 border-t border-white/10">
                  <div>
                    <p className="text-white/40 text-[0.65rem] uppercase tracking-widest mb-1">Total Credited</p>
                    <p className="text-emerald-400 font-semibold text-sm">₹{(wallet.totalCredit ?? 0).toLocaleString("en-IN")}</p>
                  </div>
                  <div>
                    <p className="text-white/40 text-[0.65rem] uppercase tracking-widest mb-1">Total Used</p>
                    <p className="text-red-400 font-semibold text-sm">₹{(wallet.totalDebit ?? 0).toLocaleString("en-IN")}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Transactions */}
            <h2 className="font-semibold text-luxury-900 text-base mb-4 tracking-tight">Transaction History</h2>

            {(!wallet.transactions || wallet.transactions.length === 0) && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">💳</span>
                </div>
                <p className="text-luxury-600 font-medium mb-1">No transactions yet</p>
                <p className="text-luxury-400 text-sm">Your wallet history will appear here.</p>
              </div>
            )}

            {wallet.transactions?.length > 0 && (
              <div className="space-y-2">
                {wallet.transactions.map((tx: any, i: number) => {
                  const st = txTypeStyle(tx.type);
                  return (
                    <div key={tx.id || i} className="card-luxury px-5 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                          st.icon === "+" ? "bg-emerald-50 text-emerald-600" :
                          st.icon === "−" ? "bg-red-50 text-red-500" :
                          "bg-luxury-100 text-luxury-600"
                        }`}>
                          {st.icon}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-luxury-900 leading-snug">
                            {tx.description || tx.type || "Transaction"}
                          </p>
                          <p className="text-xs text-luxury-400 mt-0.5">
                            {tx.createdAt
                              ? new Date(tx.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                              : "—"
                            }
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ${st.color}`}>
                        {st.icon !== "•" ? st.icon : ""}₹{(tx.amount ?? 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {!wallet && !error && !loading && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-luxury-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">💳</span>
            </div>
            <p className="text-luxury-600 font-medium">Wallet not set up yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
