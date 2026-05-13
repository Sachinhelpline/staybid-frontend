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
    // Force single-process build — Phase 8 grew hotel page + partner
    // dashboard past Next.js's default worker-pool memory budget. Without
    // workerThreads:false the child workers get stuck at ~2GB and crash
    // with "Zone Allocation failed" even when the main process has 8GB.
    workerThreads: false,
    cpus: 1,
    // v107 — tree-shake aggressively on the few packages that imported
    // namespaces tend to bring along a lot of dead code. `firebase` and
    // `recharts` are only ever used dynamically / on admin pages, but
    // a stray static import would otherwise drag the whole namespace
    // into the customer bundle. This makes that mistake free.
    optimizePackageImports: ["firebase", "recharts", "socket.io-client"],
  },
};
module.exports = nextConfig;
