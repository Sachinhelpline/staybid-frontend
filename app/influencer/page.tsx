"use client";
// The layout decides where to send the user (register vs dashboard).
// This route just renders a soft loading state so the redirect is invisible.
export default function InfluencerIndex() {
  return (
    <div className="card-luxury p-8 text-center">
      <div className="shimmer w-12 h-12 rounded-full mx-auto mb-3" />
      <p className="text-luxury-500 text-sm">Routing…</p>
    </div>
  );
}
