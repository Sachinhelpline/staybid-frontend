// ═══════════════════════════════════════════════════════════════════════════
// Device matrix for the StayBid responsive audit.
// Covers the device classes the brief calls out: small/large Android phones,
// every iPhone shape (notch + Dynamic Island + Max), foldables, tablets in
// both orientations, laptops, desktops, and an ultrawide — plus the exact
// breakpoint boundaries the codebase keys off (768 / 1024).
//
// Each entry: { id, label, class, width, height, dpr, isMobile, hasTouch,
//               ua? }  — ua only where the OS actually changes layout
//               (iOS Safari vs Android Chrome safe-area + 100vh behaviour).
// ═══════════════════════════════════════════════════════════════════════════

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

export const DEVICES = [
  // ── small / narrow phones ────────────────────────────────────────────────
  { id: "galaxy-fold",      label: "Galaxy Fold (folded)",    class: "phone", width: 280,  height: 653,  dpr: 3, isMobile: true, hasTouch: true, ua: ANDROID_UA },
  { id: "iphone-se",        label: "iPhone SE",               class: "phone", width: 375,  height: 667,  dpr: 2, isMobile: true, hasTouch: true, ua: IOS_UA },
  { id: "galaxy-s20",       label: "Galaxy S20 (20:9)",       class: "phone", width: 360,  height: 800,  dpr: 3, isMobile: true, hasTouch: true, ua: ANDROID_UA },
  // ── mainstream phones ─────────────────────────────────────────────────────
  { id: "iphone-14",        label: "iPhone 14/15",            class: "phone", width: 390,  height: 844,  dpr: 3, isMobile: true, hasTouch: true, ua: IOS_UA },
  { id: "iphone-15-pro",    label: "iPhone 15 Pro (island)",  class: "phone", width: 393,  height: 852,  dpr: 3, isMobile: true, hasTouch: true, ua: IOS_UA },
  { id: "pixel-8",          label: "Pixel 8",                 class: "phone", width: 412,  height: 915,  dpr: 2.6, isMobile: true, hasTouch: true, ua: ANDROID_UA },
  { id: "iphone-15-promax", label: "iPhone 15 Pro Max",       class: "phone", width: 430,  height: 932,  dpr: 3, isMobile: true, hasTouch: true, ua: IOS_UA },
  // ── tablets (both orientations; 768 + 1024 are codebase breakpoints) ──────
  { id: "ipad-mini-port",   label: "iPad mini portrait",      class: "tablet", width: 768,  height: 1024, dpr: 2, isMobile: true, hasTouch: true, ua: IPAD_UA },
  { id: "ipad-air-port",    label: "iPad Air portrait",       class: "tablet", width: 820,  height: 1180, dpr: 2, isMobile: true, hasTouch: true, ua: IPAD_UA },
  { id: "ipad-pro11-land",  label: "iPad Pro 11 landscape",   class: "tablet", width: 1194, height: 834,  dpr: 2, isMobile: true, hasTouch: true, ua: IPAD_UA },
  { id: "ipad-pro12-port",  label: "iPad Pro 12.9 portrait",  class: "tablet", width: 1024, height: 1366, dpr: 2, isMobile: true, hasTouch: true, ua: IPAD_UA },
  // ── laptops / desktops ────────────────────────────────────────────────────
  { id: "laptop-1280",      label: "Laptop 1280",             class: "laptop", width: 1280, height: 800,  dpr: 1, isMobile: false, hasTouch: false },
  { id: "laptop-1440",      label: "Laptop 1440",             class: "laptop", width: 1440, height: 900,  dpr: 2, isMobile: false, hasTouch: false },
  { id: "desktop-1920",     label: "Desktop 1080p",           class: "desktop", width: 1920, height: 1080, dpr: 1, isMobile: false, hasTouch: false },
  { id: "ultrawide-2560",   label: "Ultrawide 1440p",         class: "desktop", width: 2560, height: 1440, dpr: 1, isMobile: false, hasTouch: false },
];

export const DEVICE_BY_ID = Object.fromEntries(DEVICES.map((d) => [d.id, d]));
