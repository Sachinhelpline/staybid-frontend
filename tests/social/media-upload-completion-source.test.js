#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// SEC-00B-P1H-2 — source-contract test for the dormant upload-completion gate.
// Pure/static (no DB, no network): reads the three source files and asserts the
// locked contract — POST-only route reusing the STRICT media customer authority,
// sessionId-only body authority, the dormant MEDIA_UPLOAD_OBSERVATION_ENABLED
// flag, owner-bound DB preflight BEFORE the ONE listV2 metadata read on the
// server-constant bucket + exact server-derived sessions/<id>/raw key, exact
// object-identity + provider byte-size/MIME/object-id/ETag extraction, ONLY the
// P1H-1 confirmation RPC (six exact params) mutating lifecycle, a metadata-hiding
// public response, and ZERO download / signed-url / upload / remove / file-bytes /
// magic-sniff / malware / READY / env / scheduler surface.
//   Run: node tests/social/media-upload-completion-source.test.js
// ─────────────────────────────────────────────────────────────────────────
const path = require("path"), fs = require("fs");
const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function section(n) { console.log("\n• " + n); }
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
// Strip block + line comments so descriptive prose (e.g. "NO file download / magic
// bytes / malware / READY") in JSDoc can't create false hits. The `[^:]` guard
// leaves `https://` intact.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const ROUTE = "app/api/social/upload-session/complete/route.ts";
const ORCH = "lib/social/upload-completion.ts";
const STORE = "lib/social/upload-observation-store.ts";

let routeRaw = "", orchRaw = "", storeRaw = "", allExist = true;
try { routeRaw = read(ROUTE); orchRaw = read(ORCH); storeRaw = read(STORE); } catch { allExist = false; }
ok(allExist && routeRaw && orchRaw && storeRaw, "all three P1H-2 source files exist");
const route = strip(routeRaw), orch = strip(orchRaw), store = strip(storeRaw);

// ── ROUTE ──────────────────────────────────────────────────────────────
section("route: POST-only, strict media authority, no generic auth");
ok(/export\s+async\s+function\s+POST\s*\(/.test(route), "exports async POST");
ok(!/export\s+(async\s+function|const|function)\s+GET\b/.test(route), "does NOT export GET");
ok(/runtime\s*=\s*["']nodejs["']/.test(route), "route nodejs runtime");
ok(/dynamic\s*=\s*["']force-dynamic["']/.test(route), "route force-dynamic");
ok(/import\s*\{[\s\S]*?resolveVerifiedMediaCustomer[\s\S]*?createMediaCustomerAuthority[\s\S]*?\}\s*from\s*["']@\/lib\/auth\/media-customer-authority["']/.test(route), "reuses the STRICT media customer authority");
ok(/resolveVerifiedMediaCustomer\s*\(/.test(route), "route resolves the verified media customer");
ok(/createUploadObservationStore\s*\(/.test(route) && /runUploadCompletion\s*\(/.test(route), "wires the observation store into runUploadCompletion");
// No generic / decode-only / admin authority anywhere.
for (const bad of ["verifiedCustomerFromReq", "customer-verify", "decodeJwt", "userFromReq", "socialUserFromReq", "requireVerifiedAdmin", "x-admin", "JWT_SECRET"]) {
  ok(!new RegExp(bad).test(route), "route does NOT use " + bad);
}

// ── ORCHESTRATOR — body authority, flag, order ──────────────────────────
section("orchestrator: sessionId-only body, dormant flag, strict order");
ok(/MEDIA_UPLOAD_OBSERVATION_ENABLED/.test(orch), "reads the MEDIA_UPLOAD_OBSERVATION_ENABLED flag");
ok(/trim\(\)\.toLowerCase\(\)\s*===\s*["']true["']/.test(orch), "flag enabled only when normalized value is exactly 'true'");
// Body authority = sessionId ONLY; unexpected fields rejected (not ignored).
ok(/keys\.length\s*!==\s*1\s*\|\|\s*keys\[0\]\s*!==\s*["']sessionId["']/.test(orch), "body must be EXACTLY { sessionId } (extra keys rejected)");
ok(/isCanonicalUuidV4\(/.test(orch) && /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]/.test(orch), "sessionId must be a canonical lowercase UUID v4");
// The customer can never send owner/bucket/path/size/mime/etag/status: none are read from the body.
ok(!/body[\s\S]{0,40}\.(ownerUserId|owner|bucket|objectKey|byteSize|contentType|storageObjectId|etag|status)\b/.test(orch), "no authority-bearing field read from the request body");
// Strict order: auth -> flag -> validate -> configured -> preflight -> observe -> confirm.
{
  // Use the `deps.store.` call expressions (only in the handler) — the bare method
  // names also appear earlier in the store interface declaration.
  const iAuth = orch.indexOf("deps.verify");
  const iFlag = orch.indexOf("deps.env.MEDIA_UPLOAD_OBSERVATION_ENABLED");
  const iValidate = orch.indexOf("parseCompletionBody(body)");
  const iConfigured = orch.indexOf("deps.store.configured()");
  const iPreflight = orch.indexOf("deps.store.findOwnedSessionTarget");
  const iObserve = orch.indexOf("deps.store.observeExactObject");
  const iConfirm = orch.indexOf("deps.store.confirmObservation");
  ok(iAuth > -1 && iFlag > iAuth && iValidate > iFlag && iConfigured > iValidate && iPreflight > iConfigured && iObserve > iPreflight && iConfirm > iObserve,
    "handler order: auth -> flag -> validate -> configured -> owner preflight -> observe -> confirm");
}
// Server-owned destination invariants BEFORE observe.
ok(/target\.quarantineBucket\s*!==\s*QUARANTINE_BUCKET/.test(orch), "rejects a DB row whose bucket != the server constant");
ok(/target\.objectKey\s*!==\s*expectedObjectKeyFor\(/.test(orch), "rejects a DB row whose key != the server-derived key");
ok(/QUARANTINE_BUCKET\s*=\s*["']social-media-quarantine["']/.test(orch), "server-constant bucket defined");
ok(/expectedObjectKeyFor[\s\S]{0,60}`sessions\/\$\{sessionId\}\/raw`/.test(orch), "exact sessions/<id>/raw key derivation");

// ── ORCHESTRATOR — exact object identity + metadata extraction ──────────
section("orchestrator: exact identity + provider size/MIME/object-id/ETag");
ok(/fullKey\s*!==\s*expectedKey/.test(orch), "exact single-object identity comparison (fullKey === expectedKey)");
ok(/objects\.length\s*>\s*1[\s\S]{0,40}ambiguous/.test(orch), "more than one object -> ambiguous (fail closed)");
ok(/objects\.length\s*===\s*0[\s\S]{0,40}not_observed/.test(orch), "zero objects -> not_observed (retryable)");
ok(/meta\.size/.test(orch) && /MAX_OBSERVED_BYTES/.test(orch) && /104857600/.test(orch), "uses the provider byte size against the 100 MiB ceiling");
ok(/contentLength\s*!==\s*size/.test(orch) && /contentLength[\s\S]{0,320}["']invalid_metadata["']/.test(orch), "size/contentLength disagreement -> invalid_metadata");
ok(/meta\.mimetype/.test(orch), "uses the provider MIME (mimetype)");
ok(/meta\.eTag/.test(orch), "uses the provider ETag (eTag)");
ok(/obj\.id/.test(orch), "uses the provider storage object id");
// No normalization of the observed MIME (P1H-1 owns exact comparison).
ok(!/mimetype[\s\S]{0,40}\.toLowerCase\(|mimetype[\s\S]{0,40}\.trim\(\)\s*[;,)]/.test(orch) || /trim\(\)\.length/.test(orch), "MIME blank-check only (no acceptance-time normalization)");
// Only the exact P1H-1 outcome shapes are accepted; applied/idempotent require quarantined.
ok(/outcome\s*===\s*["']applied["']\s*\|\|\s*outcome\s*===\s*["']idempotent_existing["'][\s\S]{0,80}status\s*===\s*["']quarantined["']/.test(orch), "applied/idempotent REQUIRE status === 'quarantined'");
ok(/return\s*["']malformed["']/.test(orch), "unknown/wrong RPC outcome -> malformed (fail closed)");

// ── ORCHESTRATOR — bounded public response (no metadata leak) ───────────
section("orchestrator: metadata-hiding bounded response");
ok(/status:\s*["']accepted["']/.test(orch), "success returns status:accepted");
// The response body only ever carries { ok, status } or { ok, error } — never provider metadata.
ok(!/JSON\.stringify\([\s\S]{0,120}(byteSize|contentType|storageObjectId|storageEtag|mimetype|objectKey|ownerUserId|bucket)/.test(orch), "response body never serializes object metadata / owner / bucket");
ok(!/status:\s*["']ready["']/.test(orch), "no READY response/claim");

// ── STORE — service-role only, pinned origin, listV2, RPC ───────────────
section("store: service-role only, pinned origin, listV2, P1H-1 RPC only");
ok(/typeof window/.test(store), "store server-only guard");
ok(/SUPABASE_SERVICE_ROLE_KEY/.test(store) && !/\b(SB_ADMIN_KEY|SB_H|SB_READ|SB_KEY)\b/.test(store) && !/NEXT_PUBLIC_/.test(store), "service-role key ONLY, no anon/SB_*/NEXT_PUBLIC fallback");
ok(/EXPECTED_SUPABASE_ORIGIN\s*=\s*["']https:\/\/uxxhbdqedazpmvbvaosh\.supabase\.co["']/.test(store), "pinned exact Supabase origin");
ok(/persistSession:\s*false/.test(store) && /autoRefreshToken:\s*false/.test(store) && /detectSessionInUrl:\s*false/.test(store), "hardened client auth config");
// Owner-bound preflight read BEFORE the Storage call.
ok(/\.from\(TABLE\)[\s\S]*?\.eq\(["']id["'],\s*sessionId\)[\s\S]*?\.eq\(["']owner_user_id["'],\s*ownerId\)[\s\S]*?\.maybeSingle\(\)/.test(store), "owner-BOUND preflight (id + owner_user_id) read");
ok(/TARGET_SELECT\s*=\s*["']id,owner_user_id,status,quarantine_bucket,object_key["']/.test(store), "minimal explicit preflight select (no *)");
ok(!/select\(\s*["']\*["']\s*\)/.test(store), "store never selects *");
// EXACT installed metadata API = listV2, on the server constant bucket + exact prefix, bounded.
ok(/\.storage\.from\(QUARANTINE_BUCKET\)\.listV2\(/.test(store), "Storage read uses listV2 on the SERVER CONSTANT bucket");
ok(!/\.from\(\s*target\.quarantineBucket/.test(store), "store NEVER uses target.quarantineBucket for the Storage bucket");
ok(/expectedPrefixFor\(target\.id\)/.test(store) && /(prefix,|prefix:\s*prefix)/.test(store), "exact server-derived prefix from the DB row id");
ok(/limit:\s*2/.test(store) && /with_delimiter:\s*false/.test(store), "bounded one-folder metadata query (limit 2, flat)");
// No byte download / signed url / public url / upload / remove / info / list(v1).
ok(!/\.download\(|createSignedUrl|createSignedUploadUrl|getPublicUrl|publicUrl|\.upload\(|\.remove\(|\.info\(|\.list\(/.test(store), "no download/signed-url/public-url/upload/remove/info/list(v1) call");
// Only the P1H-1 confirmation RPC mutates lifecycle; no direct table UPDATE, no other RPC.
ok(/RPC_CONFIRM\s*=\s*["']confirm_media_upload_quarantine_observation["']/.test(store), "references the P1H-1 confirmation RPC name");
ok(!/\.update\(/i.test(store) && !/\.insert\(|\.delete\(|\.upsert\(/i.test(store), "no direct lifecycle table UPDATE/INSERT/DELETE/UPSERT");
ok(!/apply_media_upload_authorization_cas|reserve_media_upload_session|claim_media_upload_quarantine_cleanup|complete_media_upload_quarantine_cleanup/.test(store), "references NO other media RPC");
{
  const rpcCalls = (store.match(/\.rpc\(/g) || []).length;
  ok(rpcCalls === 1, "exactly one .rpc() call site (the P1H-1 confirmation), got " + rpcCalls);
}
// Exactly the six P1H-1 params, no more.
for (const p of ["p_session_id", "p_owner_user_id", "p_observed_byte_size", "p_observed_content_type", "p_storage_object_id", "p_storage_etag"]) {
  ok(new RegExp(p + ":").test(store), "RPC param " + p);
}
{
  const pParams = (store.match(/\bp_[a-z_]+:/g) || []).map((s) => s.replace(/:$/, "")).sort();
  const uniq = Array.from(new Set(pParams));
  ok(uniq.length === 6, "exactly six p_* RPC params (got " + uniq.length + ": " + uniq.join(",") + ")");
}

// ── No file bytes / magic sniff / malware / READY / env / scheduler ─────
section("no file bytes / magic / malware / READY / env / scheduler (all three)");
for (const [name, code] of [["route", route], ["orchestrator", orch], ["store", store]]) {
  ok(!/arrayBuffer|createReadStream|readFileSync|readFile\(|ReadableStream|Buffer\.from/.test(code), name + ": no file-byte read");
  ok(!/magic|clamav|antivirus|\bsniff/i.test(code), name + ": no magic-byte / antivirus sniff");
  ok(!/process\.env\.[A-Za-z_]+\s*=(?!=)/.test(code), name + ": no process.env write (no env mutation)");
  ok(!/cron-job\.org|vercel\.json|schedule\s*:|setInterval\(|setTimeout\(/.test(code), name + ": no scheduler");
}

console.log("");
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fail > 0) process.exitCode = 1; else { console.log("• ALL PASS"); process.exitCode = 0; }
