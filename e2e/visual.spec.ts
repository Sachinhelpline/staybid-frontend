// ─────────────────────────────────────────────────────────────────────────
// Visual-regression baselines — one screenshot per (route × theme × project).
// Guards the Phase-1 adoption codemods (hex→token, emoji→icon, primitive swaps)
// from silently changing a surface. See playwright.config.ts for how to run and
// the sandbox media caveat (record authoritative baselines on a Vercel preview).
// ─────────────────────────────────────────────────────────────────────────
import { test, expect, type Page } from "@playwright/test";

// A representative slice of the customer surface — the highest-impact Phase-1
// pages. Extend per phase as surfaces are migrated (keep names stable so a
// baseline maps to a route across runs).
const ROUTES: { path: string; name: string }[] = [
  { path: "/", name: "home" },
  { path: "/hotels", name: "hotels" },
  { path: "/flash-deals", name: "flash-deals" },
  { path: "/bid", name: "bid" },
  { path: "/discover", name: "discover" },
];

const THEMES = ["light", "dark"] as const;

// Seed theme + suppress the first-run welcome carousel BEFORE first paint, so
// the shot is the real page in the intended theme (the app/layout.tsx no-FOUC
// bootstrap reads sb_theme and stamps <html data-theme>).
async function primeTheme(page: Page, theme: string) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("sb_theme", t as string);
      localStorage.setItem("sb_tutorial_disabled", "1");
      localStorage.setItem("sb_tutorial_welcome_seen", "1");
    } catch { /* ignore */ }
  }, theme);
}

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`${route.name} · ${theme}`, async ({ page }) => {
      await primeTheme(page, theme);
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      // let hydration + entrance animations settle; VR config disables animations
      await page.waitForTimeout(1500);
      // prove the theme actually applied before we snapshot
      const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      expect(applied, `data-theme should be ${theme}`).toBe(theme);
      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`, { fullPage: false });
    });
  }
}
