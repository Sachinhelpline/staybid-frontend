"use client";
// /influencer/register has been retired in favour of the unified /upgrade
// flow. The old form lived here — it's now embedded inline on /upgrade
// where public users actually start their creator application from. This
// stub just redirects so any old shortcut / cached link still works.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function InfluencerRegisterRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/upgrade");
  }, [router]);
  return (
    <div className="card-luxury p-8 text-center">
      <div className="shimmer w-12 h-12 rounded-full mx-auto mb-3" />
      <p className="text-luxury-500 text-sm">Taking you to the upgrade page…</p>
    </div>
  );
}
