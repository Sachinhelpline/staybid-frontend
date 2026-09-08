#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failed = 0;
function ok(v, msg) {
  if (!v) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("PASS", msg);
  }
}

const writer = read("lib/social/storage-upload.ts");
const mode = read("app/api/social/upload-mode/route.ts");
const status = read("app/api/social/upload-session/status/route.ts");
const delivery = read("app/api/social/media/[sessionId]/[signature]/route.ts");
const refs = read("lib/social/secure-media-ref.ts");
const policy = read("lib/social/media-url-policy.ts");

ok(/MEDIA_SECURE_WRITER_ENABLED/.test(mode), "explicit server-side writer cutover gate exists");
ok(/mode:\s*"legacy"/.test(mode), "writer stays legacy while final gate is off");
ok(/"secure"\s*:\s*"blocked"/.test(mode), "enabled writer blocks when prerequisites are not enabled");
ok(/uploadToSignedUrl/.test(writer), "secure client uses standard signed upload token");
ok(/social-media-quarantine/.test(writer), "secure upload targets private quarantine");
ok(/\/api\/social\/upload-session\/complete/.test(writer), "secure writer invokes completion observation");
ok(/\/api\/social\/upload-session\/status/.test(writer), "secure writer waits for owner-bound READY status");
ok(/mode === "blocked"/.test(writer), "blocked secure mode has no legacy fallback");
ok(/resolveVerifiedMediaCustomer/.test(status), "READY status uses strict customer media authority");
ok(/owner_user_id/.test(status), "READY status lookup is owner-bound");
ok(/processed_sha256/.test(status), "READY status binds the media ref to processing evidence");
ok(/secureMediaPath/.test(status), "READY status returns only an opaque processed-media reference");
ok(/SHA256_RE/.test(refs) && /processedSha256 === signature/.test(refs), "media reference is bound to immutable processed SHA-256 evidence");
ok(!/JWT_ACCESS_SECRET|createHmac/.test(refs), "media reference stability does not depend on auth-secret rotation");
ok(/verifySecureMediaRef/.test(delivery), "delivery verifies processed media reference evidence");
ok(/processed_sha256/.test(delivery), "delivery re-reads processed SHA-256 from DB");
ok(/status !== "ready"/.test(delivery), "delivery rejects non-READY session rows");
ok(/APPROVED/.test(delivery) && /AUTO_APPROVED/.test(delivery), "delivery requires a publicly approved post reference");
ok(/createSignedUrl/.test(delivery), "private processed object is exposed only via short-lived signed read URL");
ok(/social-media-processed/.test(delivery), "delivery is pinned to processed bucket");
ok(/SIG_RE/.test(policy) && /SECURE_MEDIA_PREFIX/.test(policy), "post URL policy accepts only strict secure media refs");
ok(!/NEXT_PUBLIC_.*SERVICE/i.test(writer + status + delivery + refs), "no service-role secret is moved to client/public env");

if (failed) process.exit(1);
console.log("SEC-00B final writer cutover source checks passed");
