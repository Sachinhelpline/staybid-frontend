#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00A — media URL policy + route-wiring hermetic test.
//   Run: node tests/social/media-url-policy.test.js
// Compiles the REAL lib/social/media-url-policy.ts with the lockfile tsc into
// an OS TEMP dir (never inside the repo), drives the pure validators, and
// statically asserts all five write routes call the shared policy before any
// DB mutation. No network, no DB, no packages. Exit code set AFTER cleanup.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0, fatalError = null; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }
const HOST = "uxxhbdqedazpmvbvaosh.supabase.co";
const OKMEDIA = `https://${HOST}/storage/v1/object/public/social-media/photos/u/x.jpg`;

async function main() {
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-media-url-policy-"));
try {
  const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
  fs.mkdirSync(SRC, { recursive: true });
  fs.copyFileSync(path.join(REPO, "lib/social/media-url-policy.ts"), path.join(SRC, "media-url-policy.ts"));
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "es2022", target: "es2020", moduleResolution: "bundler", strict: true, skipLibCheck: true, ignoreDeprecations: "6.0", lib: ["es2022", "dom"], rootDir: ".", outDir: "../out", noEmitOnError: true, types: [] }, include: ["*.ts"] }));
  let TSC; try { TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] }); } catch { throw new Error("COMPILE GATE FAILED — local tsc not installed."); }
  const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (compile.status !== 0) throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
  fs.writeFileSync(path.join(OUT, "package.json"), '{"type":"module"}');
  console.log("• Local tsc compile: exit 0, clean (strict)");
  const P = await import(path.join(OUT, "media-url-policy.js"));

  section("T1 MAIN MEDIA / THUMBNAIL — PASS cases");
  ok(P.isAllowedMediaUrl(OKMEDIA), "T1 approved public object");
  ok(P.isAllowedMediaUrl(OKMEDIA + "?width=800&t=123"), "T1 approved + query preserved");
  ok(P.isAllowedMediaUrl(OKMEDIA + "#frag"), "T1 approved + fragment");
  ok(P.isAllowedThumbnailUrl(`https://${HOST}/storage/v1/object/public/social-media/thumbs/u/x.jpg`), "T1 thumbnail approved");

  section("T2 MAIN MEDIA / THUMBNAIL — FAIL cases");
  const badMedia = [
    ["http", `http://${HOST}/storage/v1/object/public/social-media/x.jpg`],
    ["data", "data:image/png;base64,AAAA"],
    ["blob", "blob:https://staybids.in/abc"],
    ["javascript", "javascript:alert(1)"],
    ["file", "file:///etc/passwd"],
    ["protocol-relative", `//${HOST}/storage/v1/object/public/social-media/x.jpg`],
    ["external host", "https://evil.example/x.jpg"],
    ["suffix lookalike", `https://${HOST}.evil.example/storage/v1/object/public/social-media/x.jpg`],
    ["userinfo@host", `https://evil.example@${HOST}/storage/v1/object/public/social-media/x.jpg`],
    ["credentials", `https://u:p@${HOST}/storage/v1/object/public/social-media/x.jpg`],
    ["wrong bucket", `https://${HOST}/storage/v1/object/public/other-bucket/x.jpg`],
    ["private api path (no /public/)", `https://${HOST}/storage/v1/object/social-media/x.jpg`],
    ["no object key", `https://${HOST}/storage/v1/object/public/social-media/`],
    ["empty", ""], ["null", null], ["number", 123], ["malformed", "https://"],
  ];
  for (const [label, u] of badMedia) ok(!P.isAllowedMediaUrl(u), `T2 reject ${label}`);

  section("T3 SOUND — PASS cases");
  ok(P.isAllowedSoundUrl(`https://${HOST}/storage/v1/object/public/social-media/audio/u/a.mp3`), "T3 StayBid audio object");
  ok(P.isAllowedSoundUrl("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"), "T3 SoundHelix 1");
  ok(P.isAllowedSoundUrl("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3"), "T3 SoundHelix 16");
  ok(P.validateOptionalSoundUrl(null) === null, "T3 null sound ok");
  ok(P.validateOptionalSoundUrl(undefined) === null, "T3 undefined sound ok");
  ok(P.validateOptionalSoundUrl("") === null, "T3 empty sound ok");

  section("T4 SOUND — FAIL cases");
  const badSound = [
    ["SoundHelix 17 (out of catalogue)", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-17.mp3"],
    ["SoundHelix arbitrary path", "https://www.soundhelix.com/examples/mp3/evil.mp3"],
    ["SoundHelix other dir", "https://www.soundhelix.com/other/SoundHelix-Song-1.mp3"],
    ["external mp3 host", "https://cdn.evil.example/track.mp3"],
    ["spotify", "https://open.spotify.com/track/abc"],
    ["data", "data:audio/mp3;base64,AAAA"], ["blob", "blob:https://x/abc"],
    ["javascript", "javascript:alert(1)"], ["http soundhelix", "http://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"],
    ["soundhelix suffix lookalike", "https://www.soundhelix.com.evil.example/examples/mp3/SoundHelix-Song-1.mp3"],
  ];
  for (const [label, u] of badSound) ok(!P.isAllowedSoundUrl(u), `T4 reject ${label}`);
  eq(P.validateOptionalSoundUrl("https://cdn.evil.example/x.mp3"), "Invalid sound URL", "T4 optional sound error label");

  section("T5 validatePostMediaUrls trio");
  eq(P.validatePostMediaUrls({ mediaUrl: OKMEDIA }), null, "T5 media only ok");
  eq(P.validatePostMediaUrls({ mediaUrl: OKMEDIA, thumbnailUrl: OKMEDIA, soundUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" }), null, "T5 full trio ok");
  eq(P.validatePostMediaUrls({ mediaUrl: OKMEDIA, thumbnailUrl: null, soundUrl: undefined }), null, "T5 optional empties ok");
  eq(P.validatePostMediaUrls({ mediaUrl: "https://evil.example/x" }), "Invalid media URL", "T5 bad media label");
  eq(P.validatePostMediaUrls({ mediaUrl: OKMEDIA, thumbnailUrl: "https://evil.example/x" }), "Invalid thumbnail URL", "T5 bad thumb label");
  eq(P.validatePostMediaUrls({ mediaUrl: OKMEDIA, soundUrl: "https://evil.example/x.mp3" }), "Invalid sound URL", "T5 bad sound label");
  // fail-closed order: media checked first
  eq(P.validatePostMediaUrls({ mediaUrl: "data:x", thumbnailUrl: "https://evil/x", soundUrl: "blob:x" }), "Invalid media URL", "T5 media error takes precedence");

  section("T6 route wiring (static, all 5 surfaces call the policy before mutation)");
  const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
  const routes = {
    "app/api/social/posts/route.ts": { fn: "validatePostMediaUrls", mut: 'fetch(`${SB_URL}/rest/v1/social_posts`' },
    "app/api/social/posts/community/route.ts": { fn: "validatePostMediaUrls", mut: "const row" },
    "app/api/social/posts/verified-guest/route.ts": { fn: "validatePostMediaUrls", mut: "const row" },
    "app/api/social/posts/[postId]/route.ts": { fn: "validateOptionalSoundUrl", mut: "const patch: Record" },
    "app/api/social/posts/[postId]/sound/route.ts": { fn: "validateOptionalSoundUrl", mut: 'method: "PATCH"' },
  };
  for (const [p, { fn, mut }] of Object.entries(routes)) {
    const s = read(p);
    ok(s.includes('from "@/lib/social/media-url-policy"'), `T6 ${p} imports the policy`);
    const iCall = s.indexOf(fn + "(");
    const iMut = s.indexOf(mut);
    ok(iCall > 0, `T6 ${p} calls ${fn}`);
    ok(iMut > 0 && iCall < iMut, `T6 ${p} validates BEFORE mutation (${fn} before "${mut}")`);
  }
  // no route persists request media_url/thumbnail_url/sound_url without the policy import
  for (const p of Object.keys(routes)) ok(read(p).includes("media-url-policy"), `T6 ${p} guarded`);

  section("T8 EXACT-ORIGIN / non-default port (SEC-00A-R1 remediation)");
  // StayBid: default port and canonical :443 PASS; non-default ports FAIL.
  ok(P.isAllowedMediaUrl(`https://${HOST}/storage/v1/object/public/social-media/x.jpg`), "T8 StayBid default port PASS");
  ok(P.isAllowedMediaUrl(`https://${HOST}:443/storage/v1/object/public/social-media/x.jpg`), "T8 StayBid :443 canonical PASS");
  ok(!P.isAllowedMediaUrl(`https://${HOST}:444/storage/v1/object/public/social-media/x.jpg`), "T8 StayBid :444 REJECT");
  ok(!P.isAllowedMediaUrl(`https://${HOST}:8443/storage/v1/object/public/social-media/x.jpg`), "T8 StayBid :8443 REJECT");
  eq(new URL(`https://${HOST}:443/x`).origin, `https://${HOST}`, "T8 URL semantics canonicalize :443 → default origin");
  eq(new URL(`https://${HOST}:444/x`).origin, `https://${HOST}:444`, "T8 URL semantics keep :444 in origin");
  // SoundHelix: same rule.
  ok(P.isAllowedSoundUrl("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"), "T8 SoundHelix default port PASS");
  ok(P.isAllowedSoundUrl("https://www.soundhelix.com:443/examples/mp3/SoundHelix-Song-16.mp3"), "T8 SoundHelix :443 canonical PASS");
  ok(!P.isAllowedSoundUrl("https://www.soundhelix.com:444/examples/mp3/SoundHelix-Song-1.mp3"), "T8 SoundHelix :444 REJECT");
  ok(!P.isAllowedSoundUrl("https://www.soundhelix.com:8443/examples/mp3/SoundHelix-Song-16.mp3"), "T8 SoundHelix :8443 REJECT");

  section("T7 module hygiene");
  const mod = read("lib/social/media-url-policy.ts");
  ok(!/from\s+["'](react\b|next\/|@\/components\/discover\/CreateFlow)/.test(mod), "T7 no client/React/next/CreateFlow import specifier");
  ok(mod.includes("new URL("), "T7 uses standards-based URL parsing");
  ok(!/\.endsWith\(|\.startsWith\((?!PUBLIC_SOCIAL_MEDIA_PREFIX)/.test(mod.replace(/raw\.startsWith\("\/\/"\)/g,"")), "T7 no substring host decisions (prefix check on parsed pathname only)");
} catch (err) { fatalError = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err))); }
finally { fs.rmSync(tempRoot, { recursive: true, force: true }); console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")"); }
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fatalError) process.exitCode = 2; else if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
