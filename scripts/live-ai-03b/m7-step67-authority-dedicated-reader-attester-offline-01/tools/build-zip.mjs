#!/usr/bin/env node
// OFFLINE review tool — deterministic ZIP of this package + the byte-identical accepted dependencies listed in
// EVIDENCE-MANIFEST.json, at their repository-relative paths (sorted, fixed 1980-01-01 timestamps, deflate, 0644).
// usage: node tools/build-zip.mjs <out.zip>
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { REPO_ROOT, PACKAGE_ROOT } from "./import-closure.mjs";
import { PACKAGE_DIR } from "../src/constants.mjs";

export function zipEntries() {
  const m = JSON.parse(readFileSync(join(PACKAGE_ROOT, "EVIDENCE-MANIFEST.json"), "utf8"));
  const paths = [...m.files.map((f) => f.repoPath), PACKAGE_DIR + "/EVIDENCE-MANIFEST.json"].sort();
  for (const f of m.files) { const b = readFileSync(join(REPO_ROOT, f.repoPath)); if (createHash("sha256").update(b).digest("hex") !== f.sha256) throw new Error("file_changed_since_manifest:" + f.repoPath); }
  return paths;
}
export function buildZip(paths) {
  const local = [], central = []; let off = 0;
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;   // 1980-01-01 00:00
  for (const p of paths) {
    const data = readFileSync(join(REPO_ROOT, p)), comp = deflateRawSync(data, { level: 9 }), name = Buffer.from(p, "utf8"), crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1] || "")); } catch { return false; } })();
if (isMain) {
  const out = process.argv[2]; if (!out) { console.error("usage: build-zip.mjs <out.zip>"); process.exit(64); }
  const z = buildZip(zipEntries()); writeFileSync(out, z);
  console.log(JSON.stringify({ entries: zipEntries().length, bytes: z.length, sha256: createHash("sha256").update(z).digest("hex") }));
}
