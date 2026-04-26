// Customer-device-aware adaptive video delivery.
// Detects network + device capability and picks the best variant URL.
// Server stores multiple variants in vp_videos.urls = { 360p, 480p, 720p, src }.
// If only `src` exists (transcoding pending), we fall back to that.

export type DeliveryProfile = {
  quality: "360p" | "480p" | "720p";
  bitrate: string;
  preload: "none" | "metadata" | "auto";
  showDataWarning: boolean;
  label: string;
};

export type DeviceProfile = {
  network?: string;
  downlink?: number;
  memoryGb?: number;
  cpuCores?: number;
  isIos: boolean;
  screenWidth: number;
};

export function detectDevice(): DeviceProfile {
  if (typeof window === "undefined") return { isIos: false, screenWidth: 1280 };
  const c: any = (navigator as any).connection || (navigator as any).mozConnection;
  return {
    network: c?.effectiveType,
    downlink: c?.downlink,
    memoryGb: (navigator as any).deviceMemory,
    cpuCores: navigator.hardwareConcurrency,
    isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),
    screenWidth: window.screen.width,
  };
}

export function pickProfile(d: DeviceProfile): DeliveryProfile {
  const { network, downlink, memoryGb } = d;
  // Slow networks → Data Saver
  if (network === "2g" || network === "slow-2g" || (downlink && downlink < 1)) {
    return { quality: "360p", bitrate: "400k", preload: "none", showDataWarning: true, label: "Data Saver 📶" };
  }
  // Mid-range
  if (network === "3g" || (downlink && downlink < 5) || (memoryGb && memoryGb <= 2)) {
    return { quality: "480p", bitrate: "800k", preload: "metadata", showDataWarning: false, label: "Standard" };
  }
  // Good network + capable device
  if ((downlink && downlink >= 5) && (memoryGb ? memoryGb >= 3 : true)) {
    return { quality: "720p", bitrate: "1500k", preload: "auto", showDataWarning: false, label: "HD ✨" };
  }
  return { quality: "480p", bitrate: "800k", preload: "metadata", showDataWarning: false, label: "Standard" };
}

export function pickUrlForProfile(urls: Record<string, string> | undefined, profile: DeliveryProfile, fallbackSrc: string): string {
  if (!urls) return fallbackSrc;
  return urls[profile.quality] || urls["480p"] || urls["src"] || fallbackSrc;
}
