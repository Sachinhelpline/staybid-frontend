/** @type {import('next').NextConfig} */
const nextConfig = {
  // v107 — image optimization
  //   • formats: AVIF first (50–80 % smaller than JPEG), WebP fallback
  //   • remote whitelist kept fully open because uploads can come from any
  //     hotel/creator-controlled URL; security is at the upload layer.
  //   • deviceSizes / imageSizes pruned to the actual viewports we ship
  //     (mobile 360–768, tablet 1024, desktop 1280) so Next.js doesn't
  //     emit a dozen sizes per <Image>.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 414, 480, 640, 768, 1024, 1280, 1536],
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 384],
    minimumCacheTTL: 60 * 60 * 24,
  },
  // Gzip/Brotli — Next 14 turns these on for the prod server by default
  // but being explicit costs nothing.
  compress: true,
  // No source-maps in the production browser bundle. Cuts asset weight
  // dramatically. Server-side maps still emit for crash-report parsing.
  productionBrowserSourceMaps: false,
  // Strip out any accidental `console.log` calls from production. `error`
  // + `warn` are kept so genuine warnings still surface.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  experimental: {
    // Single-process build — the hotel page + partner dashboard grew past
    // Next's default worker-pool memory budget; capping to one CPU keeps the
    // build inside the 8GB NODE_OPTIONS budget. (The old `workerThreads:false`
    // companion flag was removed in Next 16 — moot now that Turbopack is the
    // default builder and manages its own worker memory.)
    cpus: 1,
    // v107 — tree-shake aggressively on the few packages that imported
    // namespaces tend to bring along a lot of dead code. `firebase` and
    // `recharts` are only ever used dynamically / on admin pages, but
    // a stray static import would otherwise drag the whole namespace
    // into the customer bundle. This makes that mistake free.
    optimizePackageImports: ["firebase", "recharts", "socket.io-client"],
  },
  // v132.13 — `.well-known/` headers for Trusted Web Activity verification.
  //
  // The Play Store app (Bubblewrap/PWA Builder generated TWA) requires
  // /.well-known/assetlinks.json to verify ownership of staybids.in. If
  // the file is missing / 404s / serves with wrong Content-Type, Chrome
  // falls back to Custom Tabs chrome — that's the "× staybids.in [share]
  // [⋮]" URL bar that re-appeared after the user installed the latest
  // app from Play Store.
  //
  // These headers make the file bulletproof against future CDN/Vercel
  // config changes: explicit Content-Type, short cache (Play re-verifies
  // on each install), and CORS open so PWA Builder's online verifier
  // can fetch it cross-origin.
  async headers() {
    return [
      {
        source: "/.well-known/:path*",
        headers: [
          { key: "Content-Type", value: "application/json; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
  // v620 — SAME-ORIGIN Firebase auth helper proxy (Firebase's documented fix
  // for the "cookies popup + first-sign-in-fails" third-party-storage
  // problem). Serves the auth handler from staybids.in itself, so when
  // lib/firebase.ts flips authDomain to staybids.in (env-gated,
  // NEXT_PUBLIC_FB_AUTH_SAME_ORIGIN=1 — see
  // docs/PENDING-GOOGLE-AUTH-SAME-ORIGIN.md) there is NO cross-origin iframe
  // in the sign-in path at all. These rewrites are INERT until that flag is
  // on — nothing requests /__/auth/* while authDomain still points at
  // firebaseapp.com.
  async rewrites() {
    const fb = `https://${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "staybid-6feb7"}.firebaseapp.com`;
    return [
      { source: "/__/auth/:path*", destination: `${fb}/__/auth/:path*` },
      { source: "/__/firebase/:path*", destination: `${fb}/__/firebase/:path*` },
    ];
  },
};
module.exports = nextConfig;
