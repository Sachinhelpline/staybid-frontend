// ─────────────────────────────────────────────────────────────────────────
// Visual-regression config for the UI upgrade (Phase 0a, gap G6).
//
// Captures per-route × per-theme screenshots and diffs them against committed
// baselines, so the hex→token / emoji→icon / adoption codemods can't silently
// change a surface. `@playwright/test` is already a devDependency — no new dep.
//
//   Record baselines:   npm run vr:update
//   Check against them:  npm run vr
//   Point at a preview:  PW_BASE=https://<preview>.vercel.app npm run vr
//
// ⚠ Sandbox caveat: image/video CDNs are blocked in the dev sandbox, so local
// baselines omit real media. Record the authoritative baselines against a
// Vercel PREVIEW url (PW_BASE=…) where media renders, BEFORE any Phase-1
// consumer swap — after adoption starts the pre-upgrade look is unrecoverable.
// ─────────────────────────────────────────────────────────────────────────
import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Same Chromium resolver as responsive-audit/audit.mjs — managed runners pin a
// build Playwright can't auto-download, and `playwright install` is blocked.
function resolveChromiumPath(): string | undefined {
  const envPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const symlink = path.join(root, "chromium");
  if (existsSync(symlink)) return symlink;
  try {
    const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
    if (dir) {
      const bin = path.join(root, dir, "chrome-linux", "chrome");
      if (existsSync(bin)) return bin;
    }
  } catch { /* fall through to default */ }
  return undefined;
}

const BASE = process.env.PW_BASE || "http://127.0.0.1:3000";
const executablePath = resolveChromiumPath();

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "e2e/__baseline__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    // small tolerance so anti-aliasing / font-hinting jitter isn't a false diff
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled", caret: "hide" },
  },
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL: BASE,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
