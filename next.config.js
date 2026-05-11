/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Force single-process build — Phase 8 grew hotel page + partner
  // dashboard past Next.js's default worker-pool memory budget. Without
  // workerThreads:false the child workers get stuck at ~2GB and crash
  // with "Zone Allocation failed" even when the main process has 8GB.
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
};
module.exports = nextConfig;
