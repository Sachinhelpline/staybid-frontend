#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid provider-neutral media contract — pure legacy-mapper test suite.
//
//   Run:  node tests/social/media-contract.test.js
//
// Compiles the REAL lib/social/media-contract.ts with the LOCKFILE-INSTALLED
// local tsc (no npx) into an OS TEMP directory (never inside the repo — no
// tests/social/.build, no .gitignore change), requires the emitted JS, and
// drives the pure resolveLegacySocialMedia(). try/finally guarantees the temp
// directory is removed. Exits non-zero on any failure. NO network, provider,
// DB or browser globals.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const SRC_TS = path.join(REPO, "lib/social/media-contract.ts");

let pass = 0, fail = 0;
let fatalError = null;
const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-media-contract-"));
try {
  const SRC = path.join(tempRoot, "src");
  const OUT = path.join(tempRoot, "out");
  fs.mkdirSync(SRC, { recursive: true });
  // Test-only failure injection to PROVE the failure-path cleanup runs. When
  // STAYBID_MEDIA_TEST_FORCE_COMPILE_FAIL=1, throw a compile-gate-style fatal
  // AFTER tempRoot exists and BEFORE any mapper assertion — the outer finally
  // must still remove tempRoot. Never affects a normal run; no env persisted;
  // no production code touched.
  if (process.env.STAYBID_MEDIA_TEST_FORCE_COMPILE_FAIL === "1") {
    throw new Error("COMPILE GATE FAILED — forced failure injection (STAYBID_MEDIA_TEST_FORCE_COMPILE_FAIL)");
  }
  fs.copyFileSync(SRC_TS, path.join(SRC, "media-contract.ts"));
  fs.writeFileSync(
    path.join(SRC, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true,
        moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out",
        typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"],
        lib: ["es2020"], noEmitOnError: true, strict: true,
      },
      include: ["media-contract.ts"],
    }),
  );

  // Compile-gate fatals THROW (never process.exit) so the outer finally always
  // runs its tempRoot cleanup before the process sets a non-zero exit code.
  let TSC_BIN;
  try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
  catch (_) { throw new Error("COMPILE GATE FAILED — local tsc not installed."); }
  const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (compile.status !== 0) { throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); }
  const emitted = path.join(OUT, "media-contract.js");
  if (!fs.existsSync(emitted)) { throw new Error("COMPILE GATE FAILED — no JS emitted"); }
  console.log("• Local tsc compile: exit 0, clean (strict)");

  const M = require(emitted);
  const resolve = M.resolveLegacySocialMedia;

  section("T1 REEL + thumbnail + media_url");
  {
    const r = resolve({ id: "p1", media_type: "REEL", media_url: "https://x/v.mp4", thumbnail_url: "https://x/p.jpg" });
    eq(r.kind, "video", "T1 kind");
    eq(r.status, "READY", "T1 status");
    eq(r.poster.source, "staybid", "T1 poster source");
    eq(r.poster.url, "https://x/p.jpg", "T1 poster url");
    eq(r.preview.type, "DIRECT", "T1 preview type");
    eq(r.preview.url, "https://x/v.mp4", "T1 preview url");
    eq(r.playback.type, "DIRECT", "T1 playback type");
    eq(r.playback.url, "https://x/v.mp4", "T1 playback url");
  }

  section("T2 REEL + no thumbnail → poster = media_url");
  {
    const r = resolve({ id: "p2", media_type: "REEL", media_url: "https://x/v.mp4" });
    eq(r.poster.source, "staybid", "T2 poster source");
    eq(r.poster.url, "https://x/v.mp4", "T2 poster url (media_url fallback)");
    eq(r.preview.type, "DIRECT", "T2 preview DIRECT");
    eq(r.playback.type, "DIRECT", "T2 playback DIRECT");
  }

  section("T3 PHOTO → image, poster only");
  {
    const r = resolve({ id: "p3", media_type: "PHOTO", media_url: "https://x/img.jpg" });
    eq(r.kind, "image", "T3 kind image");
    eq(r.status, "READY", "T3 status READY");
    eq(r.poster.url, "https://x/img.jpg", "T3 poster = media_url");
    eq(r.preview.type, "NONE", "T3 preview NONE");
    eq(r.playback.type, "NONE", "T3 playback NONE");
    const r2 = resolve({ id: "p3b", media_type: "PHOTO", media_url: "https://x/img.jpg", thumbnail_url: "https://x/t.jpg" });
    eq(r2.poster.url, "https://x/t.jpg", "T3 poster prefers thumbnail when present");
  }

  section("T4 STORY → video DIRECT");
  {
    const r = resolve({ id: "p4", media_type: "STORY", media_url: "https://x/s.mp4" });
    eq(r.kind, "video", "T4 kind video");
    eq(r.preview.type, "DIRECT", "T4 preview DIRECT");
    eq(r.playback.type, "DIRECT", "T4 playback DIRECT");
    eq(r.playback.url, "https://x/s.mp4", "T4 playback url");
  }

  section("T5 unknown media_type → safe non-playable");
  {
    for (const t of ["", null, "GIF", "AUDIO"]) {
      let r; let threw = false;
      try { r = resolve({ id: "p5", media_type: t, media_url: "https://x/u.bin" }); } catch (_) { threw = true; }
      ok(!threw, `T5 no throw for media_type=${JSON.stringify(t)}`);
      if (r) { eq(r.preview.type, "NONE", `T5 preview NONE (${JSON.stringify(t)})`); eq(r.playback.type, "NONE", `T5 playback NONE (${JSON.stringify(t)})`); }
    }
  }

  section("T6 missing/blank/non-string media_url → UNAVAILABLE");
  {
    for (const mu of [undefined, null, "", "   ", 123]) {
      let r; let threw = false;
      try { r = resolve({ id: "p6", media_type: "REEL", media_url: mu, thumbnail_url: "https://x/t.jpg" }); } catch (_) { threw = true; }
      ok(!threw, `T6 no throw for media_url=${JSON.stringify(mu)}`);
      if (r) {
        eq(r.status, "UNAVAILABLE", `T6 status UNAVAILABLE (${JSON.stringify(mu)})`);
        eq(r.preview.type, "NONE", `T6 preview NONE (${JSON.stringify(mu)})`);
        eq(r.playback.type, "NONE", `T6 playback NONE (${JSON.stringify(mu)})`);
        eq(r.poster.source, "staybid", `T6 poster from thumbnail (${JSON.stringify(mu)})`);
      }
    }
    const rp = resolve({ id: "p6b", media_type: "REEL", media_url: "" });
    eq(rp.poster.source, "placeholder", "T6 placeholder poster when no thumbnail and no media_url");
  }

  section("T7 input not mutated");
  {
    const input = Object.freeze({ id: "p7", media_type: "REEL", media_url: "https://x/v.mp4", thumbnail_url: "https://x/p.jpg" });
    let threw = false;
    try { resolve(input); } catch (_) { threw = true; }
    ok(!threw, "T7 no throw on frozen input (no mutation attempted)");
    eq(Object.keys(input).length, 4, "T7 input keys unchanged");
    eq(input.media_url, "https://x/v.mp4", "T7 input value unchanged");
  }

  section("T8 deterministic legacy identity");
  {
    eq(resolve({ id: "abc", media_type: "REEL", media_url: "https://x/v.mp4" }).id, "legacy:abc", "T8 legacy:<id>");
    ok(resolve({ id: "abc", media_type: "REEL", media_url: "https://x/v.mp4" }).id === resolve({ id: "abc", media_type: "REEL", media_url: "https://x/v.mp4" }).id, "T8 stable");
    ok(resolve({ id: "abc" }).id !== resolve({ id: "def" }).id, "T8 different ids differ");
    eq(resolve({ media_type: "REEL", media_url: "https://x/v.mp4" }).id, "legacy:unknown", "T8 missing id → legacy:unknown");
    ok(!resolve({ id: "abc" }).id.startsWith("ma_"), "T8 never ma_ prefix");
  }

  section("T9 no empty playable URL across all cases");
  {
    const rows = [
      { id: "a", media_type: "REEL", media_url: "https://x/v.mp4", thumbnail_url: "https://x/p.jpg" },
      { id: "b", media_type: "STORY", media_url: "https://x/s.mp4" },
      { id: "c", media_type: "PHOTO", media_url: "https://x/i.jpg" },
      { id: "d", media_type: "REEL", media_url: "" },
      { id: "e", media_type: "GIF", media_url: "https://x/u.bin" },
    ];
    for (const row of rows) {
      const r = resolve(row);
      eq(r.v, 1, `T9 v===1 (${row.id})`);
      ok(!!r.poster, `T9 poster present (${row.id})`);
      for (const d of [r.preview, r.playback]) {
        if (d.type === "DIRECT" || d.type === "HLS" || d.type === "DASH" || d.type === "ANIMATED") {
          ok(typeof d.url === "string" && d.url.length > 0, `T9 playable descriptor has non-empty url (${row.id}/${d.type})`);
        }
      }
    }
  }

  section("T10 PHOTO never emits DIRECT preview/playback");
  {
    const r = resolve({ id: "ph", media_type: "PHOTO", media_url: "https://x/i.jpg", thumbnail_url: "https://x/t.jpg" });
    ok(r.preview.type !== "DIRECT", "T10 preview not DIRECT");
    ok(r.playback.type !== "DIRECT", "T10 playback not DIRECT");
  }
} catch (err) {
  fatalError = err;
  console.error("\n• FATAL: " + (err && err.message ? err.message : String(err)));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")");
}

section("RESULT");
console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
// Exit code is set AFTER the finally cleanup — never process.exit() inside the
// try, so tempRoot removal is always reached before termination.
if (fatalError) { process.exitCode = 2; }
else if (fail > 0) { process.exitCode = 1; }
else { console.log("• ALL PASS"); process.exitCode = 0; }
