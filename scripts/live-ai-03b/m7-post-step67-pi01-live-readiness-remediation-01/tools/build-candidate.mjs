#!/usr/bin/env node
// OFFLINE review tool — MANIFEST.json + deterministic candidate ZIP over a staging directory. Node built-ins only.
//   node tools/build-candidate.mjs <stagingDir> manifest | check | zip <out.zip>
// MANIFEST.json lists sha256 + byte size of EVERY payload file (all files except MANIFEST.json itself).
// ZIP: sorted paths, fixed DOS date, deflate level 9, one top-level folder = basename(stagingDir).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep, basename } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";

const [rootArg, cmd, arg] = process.argv.slice(2);
if (!rootArg || !cmd) { console.error("usage: build-candidate.mjs <stagingDir> manifest | check | zip <out>"); process.exit(64); }
const ROOT = resolve(rootArg), TOP = basename(ROOT);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const list = () => { const out = []; (function w(d) { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) w(p); else out.push(relative(ROOT, p).split(sep).join("/")); } })(ROOT);
  return out.filter((p) => p !== "MANIFEST.json").sort(); };

function manifest() {
  const files = list().map((p) => { const b = readFileSync(join(ROOT, p)); return { path: p, size: b.length, sha256: sha256(b) }; });
  return { contract: "M7PI01LiveReadinessRemediation01PackageManifestV1", candidate: TOP, mode: "OFFLINE_NON_LIVE_IMPLEMENTATION_CANDIDATE",
    authoritativePreservationAnchor: "cbcb268939b2c8384188239ba8c228e8ca77c10d", frozenR3: "f1e1f1272b751b99c8a705d868e7762e928c6238",
    acceptedPi01ArtifactSha256: "d9c9c6edb6111618c0388b25a8df7375aa00b1f2b5d96e9dd600b877d89f8956", successorRuntimePinRef: "78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d",
    liveAction: "NONE", liveAuthorization: "THIS_MANIFEST_GRANTS_NO_AUTHORIZATION", payloadCount: files.length, files };
}
function check() {
  const m = JSON.parse(readFileSync(join(ROOT, "MANIFEST.json"), "utf8")); const bad = [];
  for (const f of m.files) { let b; try { b = readFileSync(join(ROOT, f.path)); } catch { bad.push(f.path); continue; } if (sha256(b) !== f.sha256 || b.length !== f.size) bad.push(f.path); }
  const listed = new Set(m.files.map((f) => f.path)), unlisted = list().filter((p) => !listed.has(p));
  return { ok: bad.length === 0 && unlisted.length === 0 && m.payloadCount === m.files.length, entries: m.files.length, mismatched: bad, unlisted };
}
function zip(out) {
  const c = check(); if (!c.ok) throw new Error("manifest_check_failed:" + JSON.stringify(c));
  const paths = [...list(), "MANIFEST.json"].sort();
  const local = [], central = []; let off = 0; const DATE = (1 << 5) | 1;
  for (const p of paths) {
    const data = readFileSync(join(ROOT, p)), comp = deflateRawSync(data, { level: 9 }), name = Buffer.from(TOP + "/" + p, "utf8"), crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28); local.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42); central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const z = Buffer.concat([...local, cd, end]); writeFileSync(out, z);
  return { entries: paths.length, bytes: z.length, sha256: sha256(z), manifestSha256: sha256(readFileSync(join(ROOT, "MANIFEST.json"))) };
}
if (cmd === "manifest") { const m = manifest(); writeFileSync(join(ROOT, "MANIFEST.json"), JSON.stringify(m, null, 2) + "\n"); console.log(JSON.stringify({ payloadCount: m.payloadCount })); }
else if (cmd === "check") { const r = check(); console.log(JSON.stringify(r)); process.exitCode = r.ok ? 0 : 1; }
else if (cmd === "zip" && arg) console.log(JSON.stringify(zip(arg)));
else { console.error("usage: build-candidate.mjs <stagingDir> manifest | check | zip <out>"); process.exitCode = 64; }
