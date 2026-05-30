// ═══════════════════════════════════════════════════════════════════════════
// StayBid responsive auditor (Phase 0 harness).
//
//   node responsive-audit/audit.mjs [--surface customer] [--base http://localhost:3000]
//                                   [--only /bid,/wallet] [--no-shots]
//
// For every route × every device in the matrix it:
//   • loads the page, waits for it to settle, records redirects/console errors
//   • runs an in-page detector for:
//       – horizontal overflow (the #1 "content cut off" symptom)
//       – individual elements spilling past the viewport edges
//       – duplicate "back" affordances (the extra-back-button complaint)
//       – tap targets smaller than 44px (native-feel / a11y)
//       – content hidden behind fixed top/bottom bars (safe-area overlap)
//   • saves a screenshot (unless --no-shots)
//
// Output:
//   responsive-audit/artifacts/<surface>/<device>/<route>.png
//   responsive-audit/report.json   (machine-readable, every finding)
//   responsive-audit/report.md     (human summary table)
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEVICES } from "./devices.mjs";
import { SURFACES } from "./routes.mjs";

const args = process.argv.slice(2);
const getArg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const BASE = getArg("base", "http://localhost:3000");
const SURFACE = getArg("surface", "customer");
const ONLY = getArg("only", "").split(",").filter(Boolean);
const SHOTS = !args.includes("--no-shots");
const AUTH = args.includes("--auth");
const DEVICE_FILTER = getArg("devices", "").split(",").filter(Boolean);

const TOL = 2; // px tolerance for sub-pixel rounding

// A well-formed dummy customer session so auth-gated routes render their real
// authenticated layout instead of bouncing to /auth. The token is a syntactically
// valid (unsigned) JWT whose payload carries the id getClientUserId() reads;
// backend calls will still 401, but the page chrome/skeletons render — which is
// exactly what a layout audit needs.
const AUDIT_USER = { id: "audit-user", phone: "9990000000", name: "Audit User", email: "audit@staybid.test", role: "user" };
function makeFakeJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const payload = { id: AUDIT_USER.id, user_id: AUDIT_USER.id, sub: AUDIT_USER.id, exp: Math.floor(Date.now() / 1000) + 86400 * 365 };
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.audit`;
}
function sessionInitScript() {
  const token = makeFakeJwt();
  const user = JSON.stringify(AUDIT_USER);
  return `try{
    localStorage.setItem('sb_token', ${JSON.stringify(token)});
    localStorage.setItem('sb_user', ${JSON.stringify(user)});
    localStorage.setItem('sb_token_type', 'backend');
  }catch(e){}`;
}

// In-page detector. Returns a plain-serialisable findings object.
function detectorSource() {
  return (() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docW = document.documentElement.scrollWidth;
    const TOL = 2;

    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const desc = (el) => {
      const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).slice(0, 3).join(".");
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls : ""}${txt ? ` "${txt}"` : ""}`;
    };

    // 1. elements spilling past the viewport horizontally
    const spill = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const overR = r.right - vw;
      const overL = -r.left;
      if (overR > TOL || overL > TOL) {
        // ignore elements that are themselves the scroll container of a deliberate
        // horizontal carousel (overflow-x auto/scroll with children wider than self)
        const s = getComputedStyle(el);
        const intentionalScroller = (s.overflowX === "auto" || s.overflowX === "scroll");
        if (intentionalScroller) continue;
        spill.push({ el: desc(el), over: Math.round(Math.max(overR, overL)), right: Math.round(r.right), left: Math.round(r.left) });
      }
    }
    // de-dup + keep worst 12
    spill.sort((a, b) => b.over - a.over);
    const spillTop = spill.slice(0, 12);

    // 2. duplicate back affordances
    const backEls = [];
    for (const el of document.querySelectorAll("button, a, [role=button]")) {
      if (!visible(el)) continue;
      const label = `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`.toLowerCase();
      const glyph = (el.textContent || "").trim();
      if (/\bback\b/.test(label) || glyph === "‹" || glyph === "←" || glyph === "⟨" || /go back/.test(label)) {
        backEls.push(desc(el));
      }
    }

    // 3. tiny tap targets (interactive, < 44px on the smaller side)
    let smallTargets = 0;
    const smallSample = [];
    for (const el of document.querySelectorAll("button, a, input, select, [role=button], [onclick]")) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 44 - TOL && Math.min(r.width, r.height) > 0) {
        smallTargets++;
        if (smallSample.length < 8) smallSample.push({ el: desc(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }

    // 4. content hidden behind fixed bottom/top bars
    const fixedBars = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (s.position !== "fixed" && s.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.height < 8 || r.width < vw * 0.5) continue;
      const atBottom = r.bottom >= vh - 4 && r.top > vh * 0.5;
      const atTop = r.top <= 4 && r.bottom < vh * 0.5;
      if (atBottom || atTop) fixedBars.push({ el: desc(el), edge: atBottom ? "bottom" : "top", h: Math.round(r.height) });
    }

    return {
      vw, vh, docW,
      horizontalOverflow: docW - vw > TOL ? docW - vw : 0,
      spill: spillTop,
      spillCount: spill.length,
      backCount: backEls.length,
      backEls,
      smallTargets,
      smallSample,
      fixedBars,
    };
  })();
}

async function run() {
  const routes = (SURFACES[SURFACE] || SURFACES.customer).filter(
    (r) => ONLY.length === 0 || ONLY.includes(r.path)
  );
  const devices = DEVICES.filter((d) => DEVICE_FILTER.length === 0 || DEVICE_FILTER.includes(d.id));

  const browser = await chromium.launch();
  const results = [];
  const t0 = Date.now();

  for (const device of devices) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dpr,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      userAgent: device.ua,
    });
    if (AUTH) await context.addInitScript(sessionInitScript());
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 200)));

    for (const route of routes) {
      consoleErrors.length = 0;
      const url = BASE + route.path;
      let finalUrl = url, status = 0, err = null, findings = null;
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        status = resp ? resp.status() : 0;
        await page.waitForTimeout(1200); // let client hydrate / redirect / animations settle
        // Authed pages fire backend fetches that never settle against an
        // unreachable API, so networkidle would always burn its full timeout.
        // 2.5s is enough for layout to paint; we're auditing geometry, not data.
        await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
        finalUrl = page.url();
        // evaluate can race a late client-side redirect; retry once after re-settling
        try {
          findings = await page.evaluate(detectorSource);
        } catch (e1) {
          if (/context was destroyed|navigation/i.test(String(e1))) {
            await page.waitForTimeout(1500);
            finalUrl = page.url();
            findings = await page.evaluate(detectorSource);
          } else throw e1;
        }
        if (SHOTS) {
          const dir = path.join("responsive-audit/artifacts", SURFACE, device.id);
          await mkdir(dir, { recursive: true });
          await page.screenshot({ path: path.join(dir, route.name + ".png"), fullPage: false });
        }
      } catch (e) {
        err = String(e).slice(0, 300);
      }
      const redirected = finalUrl.replace(BASE, "").split("?")[0] !== route.path;
      results.push({
        device: device.id, deviceClass: device.class, deviceLabel: device.label,
        w: device.width, h: device.height,
        route: route.path, name: route.name, auth: !!route.auth,
        status, redirected, finalUrl: finalUrl.replace(BASE, ""),
        consoleErrors: consoleErrors.slice(0, 5), consoleErrorCount: consoleErrors.length,
        err, ...findings,
      });
      const flag = err ? "ERR " : (findings?.horizontalOverflow ? `OVF+${findings.horizontalOverflow} ` : "");
      process.stdout.write(`  ${device.id} ${route.path} → ${status}${redirected ? " (→" + finalUrl.replace(BASE, "") + ")" : ""} ${flag}\n`);
    }
    await context.close();
  }
  await browser.close();

  // ── reports ────────────────────────────────────────────────────────────
  await writeFile("responsive-audit/report.json", JSON.stringify({ base: BASE, surface: SURFACE, generatedAt: new Date().toISOString(), durationMs: Date.now() - t0, results }, null, 2));

  // Markdown summary: group by route, show worst finding per device class.
  const byRoute = {};
  for (const r of results) (byRoute[r.route] ||= []).push(r);
  let md = `# Responsive audit — ${SURFACE}\n\nBase: ${BASE} · ${devices.length} devices × ${routes.length} routes = ${results.length} checks · ${new Date().toISOString()}\n\n`;
  md += `Legend: **OVF** = horizontal overflow (content cut), **spill** = elements past viewport edge, **back** = back-affordance count (>1 = duplicate), **tap** = tap targets <44px, **err** = load/console errors.\n\n`;
  md += `| Route | Device class | Status | OVF | spill | back | tap<44 | console err | notes |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const [route, rows] of Object.entries(byRoute)) {
    for (const r of rows) {
      const notes = [];
      if (r.err) notes.push("LOAD ERR: " + r.err);
      else {
        if (r.redirected) notes.push("→ " + r.finalUrl);
        if (r.spill?.length) notes.push("worst: " + r.spill[0].el + " (+" + r.spill[0].over + "px)");
      }
      md += `| \`${route}\` | ${r.deviceLabel} | ${r.status || "-"} | ${r.horizontalOverflow || ""} | ${r.spillCount || ""} | ${r.backCount || ""} | ${r.smallTargets || ""} | ${r.consoleErrorCount || ""} | ${notes.join("; ").slice(0, 90)} |\n`;
    }
  }
  await writeFile("responsive-audit/report.md", md);

  // ── console rollup ─────────────────────────────────────────────────────
  const ovf = results.filter((r) => r.horizontalOverflow).length;
  const errs = results.filter((r) => r.err).length;
  const dupBack = results.filter((r) => r.backCount > 1).length;
  console.log(`\n──────── SUMMARY ────────`);
  console.log(`checks: ${results.length}  | horizontal-overflow: ${ovf}  | load-errors: ${errs}  | duplicate-back: ${dupBack}`);
  console.log(`reports: responsive-audit/report.md  +  report.json`);
}

run().catch((e) => { console.error(e); process.exit(1); });
