#!/usr/bin/env node
/**
 * Android Admin Auth + Switcher Fix — Regression Tests (P0.1-D)
 *
 * Exercises ACTUAL source code:
 *   • lib/panels.ts — compiled via tsc, then required
 *   • public/sw.js — loaded in a vm with a mocked service-worker global
 *
 * Run: node --test tests/android-auth-switcher-fix.test.js
 * Expected: 5 passed, 0 failed.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const cp = require("node:child_process");
const vm = require("node:vm");

const REPO = path.resolve(__dirname, "..");

// ─────────────────────────────────────────────────────────────────────────
// 1. Compile lib/panels.ts → JS so we can require() it
// ─────────────────────────────────────────────────────────────────────────
const TMP = path.join(REPO, ".test-panels-out");
fs.mkdirSync(TMP, { recursive: true });

const tscfg = {
  compilerOptions: {
    module: "commonjs",
    target: "es2020",
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: "node",
    rootDir: ".",
    outDir: TMP,
    types: [],
  },
  include: ["lib/panels.ts"],
};
const cfgPath = path.join(REPO, ".test-panels-tsconfig.json");
fs.writeFileSync(cfgPath, JSON.stringify(tscfg));
try {
  cp.execSync(`npx tsc -p "${cfgPath}"`, { cwd: REPO, stdio: "pipe" });
} catch (_) {
  // panels.ts is self-contained, should compile cleanly
}
const panelsJs = path.join(TMP, "lib/panels.js");
if (!fs.existsSync(panelsJs)) {
  console.error("COMPILE FAILED — lib/panels.js not emitted");
  process.exit(2);
}
const panels = require(panelsJs);

// Clean up temp config
try { fs.unlinkSync(cfgPath); } catch (_) {}

// ─────────────────────────────────────────────────────────────────────────
// Panel tests — exercise the ACTUAL visiblePanels, panelState, PANELS
// ─────────────────────────────────────────────────────────────────────────

describe("Admin panel visibility + state (actual lib/panels.ts)", () => {
  const baseCtx = {
    pathname: "/",
    signedIn: true,
    isCreator: false,
    isHotelOwner: false,
    hasPartnerToken: false,
    hasWorkerToken: false,
    hasOnboardToken: false,
    hasAdminToken: false,
  };

  it("visiblePanels returns all panels including Admin regardless of token", () => {
    const withoutToken = panels.visiblePanels({ ...baseCtx, hasAdminToken: false });
    const withToken = panels.visiblePanels({ ...baseCtx, hasAdminToken: true });

    const adminInWithout = withoutToken.find((p) => p.key === "admin");
    const adminInWith = withToken.find((p) => p.key === "admin");

    assert.ok(adminInWithout, "Admin panel must be visible without a token");
    assert.ok(adminInWith, "Admin panel must be visible with a token");
    assert.equal(withoutToken.length, panels.PANELS.length);
    assert.equal(withToken.length, panels.PANELS.length);
  });

  it("panelState returns 'join' without admin token → routes to /admin/login", () => {
    const adminPanel = panels.PANELS.find((p) => p.key === "admin");
    const state = panels.panelState(adminPanel, { ...baseCtx, hasAdminToken: false });

    assert.equal(state, "join");
    assert.equal(adminPanel.joinRoute, "/admin/login");
  });

  it("panelState returns 'joined' with admin token → routes to /admin", () => {
    const adminPanel = panels.PANELS.find((p) => p.key === "admin");
    const state = panels.panelState(adminPanel, { ...baseCtx, hasAdminToken: true });

    assert.equal(state, "joined");
    assert.equal(adminPanel.home, "/admin");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Load public/sw.js in a mocked service-worker VM
// ─────────────────────────────────────────────────────────────────────────

describe("Service Worker Firebase auth bypass (actual public/sw.js)", () => {
  let fetchHandler;

  // Build the SW context once for the suite
  const swCode = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");

  const listeners = {};
  const mockSelf = {
    location: { origin: "https://staybids.in" },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() {},
    __WB_MANIFEST: [],
  };
  // Minimal caches API stub
  const cacheStore = {};
  mockSelf.caches = {
    open(name) {
      if (!cacheStore[name]) cacheStore[name] = { match() { return null; }, put() {}, delete() {} };
      return Promise.resolve(cacheStore[name]);
    },
    keys() { return Promise.resolve(Object.keys(cacheStore)); },
    delete(name) { delete cacheStore[name]; return Promise.resolve(true); },
  };
  // Minimal clients API stub
  mockSelf.clients = {
    claim() { return Promise.resolve(); },
    matchAll() { return Promise.resolve([]); },
  };

  // Provide globals the SW expects
  const sandbox = {
    self: mockSelf,
    caches: mockSelf.caches,
    clients: mockSelf.clients,
    addEventListener: mockSelf.addEventListener.bind(mockSelf),
    skipWaiting: mockSelf.skipWaiting,
    fetch: () => Promise.resolve(new Response("", { status: 200 })),
    URL,
    Response,
    Request,
    Headers,
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Date,
    Math,
    JSON,
    Error,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };

  try {
    vm.runInNewContext(swCode, sandbox, { filename: "sw.js" });
    fetchHandler = listeners.fetch;
  } catch (e) {
    console.error("SW load failed:", e.message);
  }

  it("Firebase auth endpoints bypass the cache (no respondWith call)", () => {
    assert.ok(fetchHandler, "fetch handler must be registered");

    const firebasePaths = [
      "/__/auth/handler",
      "/__/auth/action",
      "/__/firebase/init",
      "/__/firebase/callback",
    ];

    for (const pathname of firebasePaths) {
      let respondWithCalled = false;
      const event = {
        request: new Request(`https://staybids.in${pathname}`, { method: "GET" }),
        respondWith(_p) { respondWithCalled = true; },
        waitUntil() {},
      };
      fetchHandler(event);
      assert.equal(respondWithCalled, false,
        `respondWith must NOT be called for ${pathname}`);
    }
  });

  it("normal HTML navigation IS intercepted (respondWith called)", () => {
    assert.ok(fetchHandler, "fetch handler must be registered");

    let respondWithCalled = false;
    const event = {
      request: new Request("https://staybids.in/hotels/123", {
        method: "GET",
        headers: { accept: "text/html" },
      }),
      respondWith(_p) { respondWithCalled = true; },
      waitUntil() {},
    };
    // Set mode to navigate for the HTML path
    Object.defineProperty(event.request, "mode", { value: "navigate" });

    fetchHandler(event);
    assert.equal(respondWithCalled, true,
      "respondWith must be called for normal HTML navigation");
  });
});
