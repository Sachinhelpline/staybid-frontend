#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid N0 — reel ingest container normalization: hermetic test suite.
//
//   Run:  node tests/social/video-normalization.test.js
//
// Compiles the REAL lib/social/video-container.ts + video-normalize.ts with
// the lockfile-installed tsc into an OS TEMP directory (never inside the
// repo), then drives them with SYNTHETIC MP4 fixtures built in this file.
// The remux itself is exercised through an injected normalizer so the suite
// stays hermetic (no mediabunny, no network, no browser, no Worker). Exit
// code is set AFTER the finally-cleanup (never process.exit inside try).
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
let pass = 0, fail = 0, fatalError = null;
const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

// ── synthetic ISOBMFF builders ──────────────────────────────────────────
const enc = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const box = (type, ...parts) => { const body = cat(...parts); return cat(u32(8 + body.length), enc(type), body); };
const full = (type, v, flags, ...parts) => box(type, new Uint8Array([v, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...parts);
const zeros = (n) => new Uint8Array(n);
const ftyp = (major = "isom", compat = ["isom", "avc1", "mp41"]) => box("ftyp", enc(major), u32(512), ...compat.map(enc));
const AVCC = box("avcC", new Uint8Array([1, 66, 0, 31, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0x00, 0x1f, 1, 0, 2, 0x68, 0xce]));
const AVCC_OTHER = box("avcC", new Uint8Array([1, 100, 0, 31, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0x00, 0x1f, 1, 0, 2, 0x68, 0xce]));
const ESDS = full("esds", 0, 0, new Uint8Array([3, 25, 0, 1, 0, 4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2, 0x12, 0x10, 6, 1, 2]));
const avc1 = (avcc = AVCC) => box("avc1", zeros(6), u16(1), zeros(16), u16(608), u16(1080), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(24), u16(0xffff), avcc);
const mp4a = () => box("mp4a", zeros(6), u16(1), zeros(8), u16(2), u16(16), u16(0), u16(0), u32(44100 << 16), ESDS);
const mvhd = (dur) => full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(dur), u32(0x10000), u16(0x100), zeros(10), u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000), zeros(24), u32(3));
const tkhd = (id, dur, w, h) => full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(dur), zeros(8), u16(0), u16(0), u16(0), u16(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000), u32(w << 16), u32(h << 16));
const mdhd = (ts, dur) => full("mdhd", 0, 0, u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0));
const hdlr = (h) => full("hdlr", 0, 0, u32(0), enc(h), zeros(12), new Uint8Array([0]));
const dinf = () => box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
const stsd = (entry) => full("stsd", 0, 0, u32(1), entry);
function stblProgressive(entry, sizes, delta) {
  const n = sizes.length;
  return box("stbl", stsd(entry), full("stts", 0, 0, u32(1), u32(n), u32(delta)), full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full("stsz", 0, 0, u32(0), u32(n), ...sizes.map(u32)), full("stco", 0, 0, u32(1), u32(0)), full("stss", 0, 0, u32(1), u32(1)));
}
function stblEmpty(entry) { return box("stbl", stsd(entry), full("stts", 0, 0, u32(0)), full("stsc", 0, 0, u32(0)), full("stsz", 0, 0, u32(0), u32(0)), full("stco", 0, 0, u32(0))); }
const trak = (id, handler, stbl, ts, mdur, tdur, w = 0, h = 0) => box("trak", tkhd(id, tdur, w, h), box("mdia", mdhd(ts, mdur), hdlr(handler), box("minf", handler === "vide" ? full("vmhd", 0, 1, zeros(8)) : full("smhd", 0, 0, zeros(4)), dinf(), stbl)));

/** Progressive faststart MP4: video N samples + audio M samples. */
function progressiveMp4({ vN = 3, aN = 4, dur = 6000, avcc = AVCC, mdatBytes = 300, brands, omitMdat = false } = {}) {
  const vSizes = Array.from({ length: vN }, (_, i) => 40 + i); const aSizes = Array.from({ length: aN }, () => 10);
  const moov = box("moov", mvhd(dur), trak(1, "vide", stblProgressive(avc1(avcc), vSizes, 1000), 30000, 30000 * (dur / 1000), dur, 608, 1080), trak(2, "soun", stblProgressive(mp4a(), aSizes, 1024), 44100, 44100 * (dur / 1000), dur));
  return omitMdat ? cat(ftyp(...(brands || [])), moov) : cat(ftyp(...(brands || [])), moov, box("mdat", zeros(mdatBytes)));
}
/** Chromium-MediaRecorder-like fragmented MP4 (mvex, moof, empty stbl, mvhd 0). */
function fragmentedMp4({ vN = 3, aN = 4, mvhdDur = 0, mehd = false, avcc = AVCC, mdatBytes = 300, sidx = false } = {}) {
  const trex = (id) => full("trex", 0, 0, u32(id), u32(1), u32(0), u32(0), u32(0));
  const mvex = mehd ? box("mvex", full("mehd", 0, 0, u32(6000)), trex(2), trex(1)) : box("mvex", trex(2), trex(1));
  const moov = box("moov", mvhd(mvhdDur), trak(1, "soun", stblEmpty(mp4a()), 44100, 5595, 5595), trak(2, "vide", stblEmpty(avc1(avcc)), 30000, 5074, 5074, 608, 1080), mvex);
  const trun = (n) => full("trun", 0, 0x301, u32(n), u32(0), ...Array.from({ length: n }, () => cat(u32(1000), u32(40))));
  const traf = (id, n) => box("traf", full("tfhd", 0, 0x20000, u32(id)), full("tfdt", 1, 0, zeros(8)), trun(n));
  const moof = box("moof", full("mfhd", 0, 0, u32(1)), traf(1, aN), traf(2, vN));
  return cat(ftyp("isom", ["isom", "iso6", "iso2", "avc1", "mp41"]), moov, ...(sidx ? [full("sidx", 0, 0, u32(1), u32(1000), u32(0), u32(0), u16(0), u16(0))] : []), moof, box("mdat", zeros(mdatBytes)));
}
const WEBM = cat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), zeros(64));
const RANDOM = new Uint8Array(Array.from({ length: 256 }, (_, i) => (i * 73 + 19) & 255));
const toBlob = (bytes, type) => new Blob([bytes], { type });

async function main() {
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "staybid-video-normalization-"));
try {
  const SRC = path.join(tempRoot, "src"), OUT = path.join(tempRoot, "out");
  fs.mkdirSync(SRC, { recursive: true });
  for (const f of ["video-container.ts", "video-normalize.ts"]) fs.copyFileSync(path.join(REPO, "lib/social", f), path.join(SRC, f));
  fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "es2022", target: "es2020", moduleResolution: "bundler", strict: true, skipLibCheck: true, ignoreDeprecations: "6.0", lib: ["es2022", "dom", "dom.iterable"], rootDir: ".", outDir: "../out", noEmitOnError: true, types: [] }, include: ["*.ts"] }));
  let TSC; try { TSC = require.resolve("typescript/bin/tsc", { paths: [REPO] }); } catch { throw new Error("COMPILE GATE FAILED — local tsc not installed."); }
  const compile = cp.spawnSync(process.execPath, [TSC, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
  if (compile.status !== 0) throw new Error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || ""));
  fs.writeFileSync(path.join(OUT, "package.json"), '{"type":"module"}');
  for (const f of fs.readdirSync(OUT)) if (f.endsWith(".js")) { const p = path.join(OUT, f); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from "(\.\/[^"]+?)"/g, (m, s) => s.endsWith(".js") ? m : `from "${s}.js"`)); }
  console.log("• Local tsc compile: exit 0, clean (strict)");

  const run = async () => {
    const C = await import(path.join(OUT, "video-container.js"));
    const N = await import(path.join(OUT, "video-normalize.js"));

    section("T1 SAFE progressive MP4 classification");
    { const r = await C.classifyVideoBytes(progressiveMp4(), "video/mp4");
      eq(r.cls, "SAFE_PROGRESSIVE_MP4", "T1 class"); eq(r.tracks.length, 2, "T1 tracks"); eq(r.moofCount, 0, "T1 no moof"); eq(r.hasMvex, false, "T1 no mvex"); eq(r.moovBeforeMdat, true, "T1 faststart"); eq(r.mvhdDuration, 6000, "T1 mvhd");
      eq(r.tracks.find((t) => t.handler === "vide").stszCount, 3, "T1 video stsz"); eq(r.tracks.find((t) => t.handler === "soun").stszCount, 4, "T1 audio stsz");
      ok(r.tracks.find((t) => t.handler === "vide").codecConfig && r.tracks.find((t) => t.handler === "vide").codecConfig.length === AVCC.length, "T1 avcC captured");
      const b = await C.classifyVideoBlob(toBlob(progressiveMp4(), "video/mp4")); eq(b.cls, "SAFE_PROGRESSIVE_MP4", "T1 Blob path same class"); }

    section("T2 known fragmented compressor MP4 classification");
    { const r = await C.classifyVideoBytes(fragmentedMp4(), "video/mp4");
      eq(r.cls, "KNOWN_UNSAFE_COMPRESSOR_FMP4", "T2 class"); eq(r.moofCount, 1, "T2 moof"); eq(r.hasMvex, true, "T2 mvex"); eq(r.hasMehd, false, "T2 no mehd"); eq(r.mvhdDuration, 0, "T2 mvhd 0");
      eq(r.tracks.find((t) => t.handler === "vide").fragmentSampleCount, 3, "T2 video fragment samples"); eq(r.tracks.find((t) => t.handler === "soun").fragmentSampleCount, 4, "T2 audio fragment samples");
      ok(r.tracks.every((t) => t.stszCount === 0), "T2 empty stbl"); }

    section("T3 invalid / unreadable MP4 rejection");
    { eq((await C.classifyVideoBytes(RANDOM, "video/mp4")).cls, "UNREADABLE_OR_INVALID_MP4", "T3 random bytes claiming mp4");
      eq((await C.classifyVideoBytes(cat(ftyp(), box("mdat", zeros(50))), "video/mp4")).cls, "UNREADABLE_OR_INVALID_MP4", "T3 ftyp without moov");
      eq((await C.classifyVideoBytes(progressiveMp4().subarray(0, 60), "video/mp4")).cls, "UNREADABLE_OR_INVALID_MP4", "T3 truncated box");
      eq((await C.classifyVideoBytes(new Uint8Array(4), "video/mp4")).cls, "UNREADABLE_OR_INVALID_MP4", "T3 too small");
      eq((await C.classifyVideoBytes(progressiveMp4({ dur: 0 }), "video/mp4")).cls, "UNREADABLE_OR_INVALID_MP4", "T3 zero-duration non-fragmented"); }

    section("T4 known unsafe triggers the normalization path");
    { let calls = 0; const good = progressiveMp4({ vN: 3, aN: 4, mdatBytes: 300 });
      const normalize = async (bytes) => { calls++; ok(bytes instanceof Uint8Array && bytes.length > 0, "T4 normalizer receives bytes"); return { output: good, packetCheck: { allMatch: true, tracks: [] } }; };
      const p = await N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize });
      eq(calls, 1, "T4 normalizer called once"); eq(p.decision, "NORMALIZED_KNOWN_UNSAFE_FMP4", "T4 decision"); eq(p.normalized, true, "T4 normalized"); eq(p.mime, "video/mp4", "T4 mime"); eq(p.blob.size, good.length, "T4 output blob bytes"); eq(p.classification, "KNOWN_UNSAFE_COMPRESSOR_FMP4", "T4 classification"); }

    section("T5 safe progressive bypasses the mediabunny path");
    { let calls = 0; const normalize = async () => { calls++; throw new Error("must not be called"); };
      const p = await N.prepareOutboundVideo({ blob: toBlob(progressiveMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize });
      eq(calls, 0, "T5 normalizer not called"); eq(p.decision, "ALLOW_SAFE_PROGRESSIVE_MP4", "T5 decision"); eq(p.normalized, false, "T5 not normalized");
      const q = await N.prepareOutboundVideo({ blob: toBlob(progressiveMp4(), "video/mp4"), mime: "video/mp4", origin: "original" }, { normalize }); eq(q.decision, "ALLOW_SAFE_PROGRESSIVE_MP4", "T5 original progressive allowed"); eq(calls, 0, "T5 still not called"); }

    const expectUnsafe = async (label, fn, stage, msgCheck) => {
      let err = null; try { await fn(); } catch (e) { err = e; }
      ok(!!err, `${label} throws`); ok(N.isUnsafeVideoContainerError(err), `${label} is UnsafeVideoContainerError`); eq(err && err.code, "UNSAFE_VIDEO_CONTAINER", `${label} code`);
      if (stage) eq(err && err.stage, stage, `${label} stage`); ok(err && typeof err.creatorMessage === "string" && err.creatorMessage.length > 10, `${label} creator message`);
      if (msgCheck) msgCheck(err);
      return err;
    };
    section("T6 normalization failure = FAIL CLOSED");
    await expectUnsafe("T6", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => { throw new Error("boom"); } }), "normalize");
    await expectUnsafe("T6 empty output", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: new Uint8Array(0), packetCheck: { allMatch: true, tracks: [] } }) }), "normalize");

    section("T7 validator failure = FAIL CLOSED");
    await expectUnsafe("T7 still fragmented", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: fragmentedMp4(), packetCheck: { allMatch: true, tracks: [] } }) }), "validate");
    await expectUnsafe("T7 sample count mismatch", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: progressiveMp4({ vN: 2, aN: 4 }), packetCheck: { allMatch: true, tracks: [] } }) }), "validate");
    await expectUnsafe("T7 avcC changed", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: progressiveMp4({ avcc: AVCC_OTHER }), packetCheck: { allMatch: true, tracks: [] } }) }), "validate");
    await expectUnsafe("T7 packet check mismatch", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: progressiveMp4(), packetCheck: { allMatch: false, tracks: [] } }) }), "validate");
    await expectUnsafe("T7 size out of tolerance", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: progressiveMp4({ mdatBytes: 600 * 1024 }), packetCheck: { allMatch: true, tracks: [] } }) }), "validate");

    section("T8 worker timeout / load failure = FAIL CLOSED");
    { const e = await expectUnsafe("T8 timeout", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: (b, { timeoutMs }) => new Promise((res, rej) => setTimeout(() => rej(new Error("normalize_timeout")), timeoutMs)), timeoutMs: 20 }), "normalize"); ok(String(e.message).includes("normalize_timeout"), "T8 timeout detail");
      await expectUnsafe("T8 load failure (stub)", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: () => Promise.reject(new Error("worker_unavailable")) }), "normalize");
      // DEFAULT path: no Worker global in Node ⇒ the real normalizeInWorker must fail closed, never fall back.
      eq(typeof Worker, "undefined", "T8 precondition: no Worker in Node");
      const e2 = await expectUnsafe("T8 default normalizer without Worker", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }), "normalize"); ok(String(e2.message).includes("worker_unavailable"), "T8 default reports worker_unavailable");
      // real timeout helper: a normalizer that never settles is cut by timeoutMs
      const e3 = await expectUnsafe("T8 never-settling normalizer", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: () => new Promise(() => {}), timeoutMs: 20 }), "normalize");
      ok(String(e3.message).includes("normalize_timeout"), "T8 orchestrator enforces the bound itself (never-settling normalizer is cut)"); }

    section("T9 fragmented ORIGINAL is NOT blindly normalized");
    { let calls = 0; const normalize = async () => { calls++; return { output: progressiveMp4(), packetCheck: { allMatch: true, tracks: [] } }; };
      eq((await C.classifyVideoBytes(fragmentedMp4({ mvhdDur: 6000, mehd: true }), "video/mp4")).cls, "FRAGMENTED_ORIGINAL_UNVALIDATED", "T9 mehd/duration variant class");
      eq((await C.classifyVideoBytes(fragmentedMp4({ sidx: true }), "video/mp4")).cls, "FRAGMENTED_ORIGINAL_UNVALIDATED", "T9 sidx variant class");
      await expectUnsafe("T9 original fragmented", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4({ mvhdDur: 6000, mehd: true }), "video/mp4"), mime: "video/mp4", origin: "original" }, { normalize }), "policy");
      await expectUnsafe("T9 compressor fragmented variant", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4({ mvhdDur: 6000, mehd: true }), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize }), "policy");
      eq(calls, 0, "T9 normalizer never called"); }

    section("T10 compressor WebM is NOT silently published; originals unchanged (separate path)");
    { let calls = 0; const normalize = async () => { calls++; throw new Error("no"); };
      eq((await C.classifyVideoBytes(WEBM, "video/webm")).cls, "NON_MP4_ORIGINAL", "T10 webm class");
      await expectUnsafe("T10 compressor webm", () => N.prepareOutboundVideo({ blob: toBlob(WEBM, "video/webm"), mime: "video/webm", origin: "compressor" }, { normalize }), "policy", (e) => ok(e.creatorMessage.includes("Chrome or Safari"), "T10 browser-format creator message"));
      const o = await N.prepareOutboundVideo({ blob: toBlob(WEBM, "video/webm"), mime: "video/webm", origin: "original" }, { normalize }); eq(o.decision, "ALLOW_ORIGINAL_UNCHANGED_SEPARATE_PATH", "T10 original webm unchanged"); eq(o.mime, "video/webm", "T10 original mime preserved");
      const mov = await N.prepareOutboundVideo({ blob: toBlob(progressiveMp4({ brands: ["qt  ", ["qt  "]] }), "video/quicktime"), mime: "video/quicktime", origin: "original" }, { normalize }); eq(mov.classification, "NON_MP4_ORIGINAL", "T10 quicktime brand = non-mp4 original"); eq(mov.decision, "ALLOW_ORIGINAL_UNCHANGED_SEPARATE_PATH", "T10 mov unchanged");
      eq(calls, 0, "T10 normalizer never called");
      await expectUnsafe("T10 original unreadable mp4", () => N.prepareOutboundVideo({ blob: toBlob(RANDOM, "video/mp4"), mime: "video/mp4", origin: "original" }, { normalize }), "policy"); }

    const cf = fs.readFileSync(path.join(REPO, "components/discover/CreateFlow.tsx"), "utf8");
    section("T11 ordinary compressor soft fallback preserved BEFORE the final gate");
    { const iCompress = cf.indexOf("const result = await compressVideo("); const iSoft = cf.indexOf("// Soft errors (codec mismatch etc) — ship the original file."); const iGate = cf.indexOf("const prepared = await prepareOutboundVideo("); const iUpload = cf.indexOf("const uploaded = await uploadSocialMedia(");
      ok(iCompress > 0 && iSoft > iCompress, "T11 compression soft-fallback comment still present after compressVideo call"); ok(iGate > iSoft, "T11 gate is AFTER the compression catch"); ok(iUpload > iGate, "T11 gate is BEFORE uploadSocialMedia");
      const compressionBlock = cf.slice(iCompress, iSoft + 200); ok(!compressionBlock.includes("prepareOutboundVideo"), "T11 gate is not inside the compression try/catch"); ok(cf.includes('outboundOrigin = "compressor"'), "T11 origin tagged only on real replacement"); }

    section("T12 unsafe error cannot be swallowed by the compression fallback");
    { const iGate = cf.indexOf("const prepared = await prepareOutboundVideo("); const gateBlock = cf.slice(iGate, cf.indexOf("const uploaded = await uploadSocialMedia("));
      ok(gateBlock.includes("isUnsafeVideoContainerError(e)") && gateBlock.includes("return { ok: false, error: msg }"), "T12 gate catch returns a failed upload result (fail closed)"); ok(!/catch[\s\S]*?uploadBlobUrl\s*=\s*post\.mediaUrl/.test(gateBlock), "T12 gate catch never restores the original blob");
      // runtime: the orchestrator converts unexpected internal failures into the typed error
      const badBlob = { size: 100, type: "video/mp4", slice: () => ({ arrayBuffer: async () => { throw new Error("io"); } }), arrayBuffer: async () => { throw new Error("io"); } };
      await expectUnsafe("T12 classify I/O failure", () => N.prepareOutboundVideo({ blob: badBlob, mime: "video/mp4", origin: "compressor" }, { normalize: async () => { throw new Error("x"); } }), "classify");
      const frag = fragmentedMp4(); const readFail = { size: frag.length, type: "video/mp4", slice: (a, b) => ({ arrayBuffer: async () => frag.slice(a, b).buffer }), arrayBuffer: async () => { throw new Error("read-fail"); } };
      await expectUnsafe("T12 full-read failure", () => N.prepareOutboundVideo({ blob: readFail, mime: "video/mp4", origin: "compressor" }, { normalize: async () => ({ output: progressiveMp4(), packetCheck: { allMatch: true, tracks: [] } }) }), "read"); }

    section("T13 lazy load / import boundary (static)");
    { const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
      for (const p of ["components/home/DesktopHome.tsx", "lib/social/media-contract.ts", "app/page.tsx", "app/layout.tsx", "lib/social/storage-upload.ts", "lib/social/video-compress.ts"]) ok(!/mediabunny|video-normalize/.test(read(p)), `T13 no mediabunny/normalizer reference in ${p}`);
      const orch = read("lib/social/video-normalize.ts"); ok(!/from\s+["']mediabunny["']/.test(orch) && !/from\s+["']\.\/video-normalize-core["']/.test(orch), "T13 orchestrator has NO static mediabunny/core import"); ok(orch.includes('new Worker(new URL("./video-normalize.worker.ts", import.meta.url), { type: "module" })'), "T13 worker created via new URL(import.meta.url) module worker");
      ok(/from\s+["']mediabunny["']/.test(read("lib/social/video-normalize-core.ts")), "T13 only the core module imports mediabunny"); ok(/from\s+["']\.\/video-normalize-core["']/.test(read("lib/social/video-normalize.worker.ts")), "T13 worker imports the core");
      ok(/from\s+["']@\/lib\/social\/video-normalize["']/.test(cf) && !/from\s+["'][^"']*(mediabunny|video-normalize-core)["']/.test(cf), "T13 CreateFlow imports only the orchestrator (no mediabunny/core import specifier)");
      const grep = cp.spawnSync("grep", ["-rl", "--include=*.ts", "--include=*.tsx", "from \"mediabunny\"", "app", "components", "lib"], { cwd: REPO, encoding: "utf8" }); eq((grep.stdout || "").trim(), "lib/social/video-normalize-core.ts", "T13 repo-wide: exactly one static mediabunny importer");
      const pkg = JSON.parse(read("package.json")); eq(pkg.dependencies.mediabunny, "1.55.7", "T13 exact pin 1.55.7 (no caret/tilde)"); }

    section("T14 output validator positive case");
    { const inRep = await C.classifyVideoBytes(fragmentedMp4(), "video/mp4"); const outBytes = progressiveMp4(); const outRep = await C.classifyVideoBytes(outBytes, "video/mp4");
      const v = C.validateNormalizedOutput(outRep, inRep, outBytes.length, fragmentedMp4().length); eq(v.ok, true, "T14 valid: " + v.failures.join(",")); }

    section("T15 output validator rejects moof / mvex / zero duration");
    { const inRep = await C.classifyVideoBytes(fragmentedMp4(), "video/mp4");
      const fr = await C.classifyVideoBytes(fragmentedMp4(), "video/mp4"); const v1 = C.validateNormalizedOutput(fr, inRep, 400, 400); ok(!v1.ok && v1.failures.some((f) => f === "output_has_moof") && v1.failures.some((f) => f === "output_has_mvex"), "T15 rejects moof+mvex: " + v1.failures.join(","));
      const zero = await C.classifyVideoBytes(progressiveMp4({ dur: 0 }), "video/mp4"); const v2 = C.validateNormalizedOutput(zero, inRep, 400, 400); ok(!v2.ok && v2.failures.some((f) => f === "output_mvhd_duration_invalid"), "T15 rejects zero mvhd: " + v2.failures.join(","));
      const noMdat = await C.classifyVideoBytes(cat(box("mdat", zeros(10)), progressiveMp4().subarray(0, 0)), "video/mp4"); ok(!C.validateNormalizedOutput(noMdat, inRep, 10, 400).ok, "T15 rejects non-MP4 output"); }

    section("T16 size ceiling + memory-safe classification");
    { await expectUnsafe("T16 over ceiling", () => N.prepareOutboundVideo({ blob: toBlob(fragmentedMp4(), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => { throw new Error("must not run"); }, maxInputBytes: 100 }), "size");
      eq(N.NORMALIZATION_MAX_INPUT_BYTES, 40 * 1024 * 1024, "T16 ceiling = 40 MiB"); ok(N.NORMALIZATION_TIMEOUT_MS >= 10000 && N.NORMALIZATION_TIMEOUT_MS <= 120000, "T16 bounded timeout");
      const big = progressiveMp4({ mdatBytes: 3 * 1024 * 1024 }); let bytesRead = 0, reads = 0; const blob = toBlob(big, "video/mp4"); const spy = { size: blob.size, type: "video/mp4", slice: (a, b) => { reads++; bytesRead += Math.max(0, Math.min(b, blob.size) - a); return blob.slice(a, b); } };
      const r = await C.classifyVideoBlob(spy, "video/mp4"); eq(r.cls, "SAFE_PROGRESSIVE_MP4", "T16 big progressive classified"); ok(bytesRead < 64 * 1024, `T16 bounded reads: ${bytesRead} bytes in ${reads} slices (<64 KiB) for a ${blob.size}-byte file`); }

    section("T17 progressive moov WITHOUT mdat = NOT SAFE / FAIL CLOSED (Correction 1)");
    { const r = await C.classifyVideoBytes(progressiveMp4({ omitMdat: true }), "video/mp4");
      eq(r.cls, "UNREADABLE_OR_INVALID_MP4", "T17 PROGRESSIVE_MOOV_WITHOUT_MDAT not SAFE"); eq(r.reason, "no_mdat", "T17 reason=no_mdat"); eq(r.hasMdat, false, "T17 hasMdat false"); eq(r.hasMoov, true, "T17 moov present"); ok(r.tracks.length === 2 && r.mvhdDuration > 0, "T17 moov/tracks/duration look valid yet still unsafe");
      eq((await C.classifyVideoBytes(progressiveMp4(), "video/mp4")).cls, "SAFE_PROGRESSIVE_MP4", "T17 same file WITH mdat is still SAFE (not over-tightened)");
      await expectUnsafe("T17 gate no-mdat", () => N.prepareOutboundVideo({ blob: toBlob(progressiveMp4({ omitMdat: true }), "video/mp4"), mime: "video/mp4", origin: "compressor" }, { normalize: async () => { throw new Error("must not run"); } }), "policy");
      const inRep = await C.classifyVideoBytes(fragmentedMp4(), "video/mp4"); const noMdatRep = await C.classifyVideoBytes(progressiveMp4({ omitMdat: true }), "video/mp4");
      const v = C.validateNormalizedOutput(noMdatRep, inRep, 400, fragmentedMp4().length); ok(!v.ok, "T17 validator rejects a no-mdat normalized output: " + v.failures.join(",")); }

    section("T18 temp object-URL single-ownership cleanup (Correction 2, static over CreateFlow.runUpload)");
    { const start = cf.indexOf("const runUpload = useCallback(async (tempId"); const end = cf.indexOf("}, [overlays, tierContext]);", start);
      ok(start > 0 && end > start, "T18 runUpload region located"); const slice = cf.slice(start, end);
      const declIdx = slice.indexOf("const ownedObjectUrls: string[] = [];"); const tryIdx = slice.indexOf("try {");
      ok(declIdx > 0, "T18 ownedObjectUrls declared"); ok(slice.includes("const trackObjectUrl = (blob: Blob): string =>"), "T18 trackObjectUrl helper present");
      ok(declIdx < tryIdx, "T18 owner/tracker declared BEFORE the try (finally can never hit TDZ)");
      eq((slice.match(/URL\.createObjectURL\(/g) || []).length, 1, "T18 exactly one bare URL.createObjectURL in runUpload (inside the tracker only)");
      eq((slice.match(/trackObjectUrl\(/g) || []).length, 3, "T18 three trackObjectUrl call sites (compressed photo + compressed video + normalized)");
      const iOuterFinally = slice.lastIndexOf("} finally {"); const iRevoke = slice.indexOf("for (const u of ownedObjectUrls) { try { URL.revokeObjectURL(u); } catch {} }");
      ok(iOuterFinally > 0 && iRevoke > iOuterFinally, "T18 CLEANUP: revoke loop lives inside the outer runUpload finally (runs on success AND every failure path)");
      ok(!slice.includes("trackObjectUrl(post.mediaUrl") && !/revokeObjectURL\(\s*post\.mediaUrl/.test(slice), "T18 ORIGINAL_POST_MEDIA_URL_NOT_REVOKED: post.mediaUrl never tracked or revoked");
      ok(slice.includes("let uploadBlobUrl = post.mediaUrl;"), "T18 uploadBlobUrl starts at the durable post.mediaUrl (retry-safe)");
      const iUpload = slice.indexOf("uploadSocialMedia("); const iPostApi = slice.indexOf("fetch(postEndpoint");
      ok(iUpload > 0 && iPostApi > iUpload && iRevoke > iPostApi && iRevoke > iUpload, "T18 revoke runs AFTER both the uploadSocialMedia await and the post-API await → CLEANUP_ON_UPLOAD_FAILURE + CLEANUP_ON_POST_API_FAILURE");
      ok(slice.includes("uploadSocialAudio(") && !/trackObjectUrl\([^)]*[Aa]udio/.test(slice), "T18 audio URL handling unchanged (not routed through the tracker)"); }
  };
  await run();
} catch (err) {
  fatalError = err; console.error("\n• FATAL: " + (err && err.message ? err.message : String(err)));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("\n• Temp dir removed: " + tempRoot + " (exists=" + fs.existsSync(tempRoot) + ")");
}
section("RESULT"); console.log(`  ${pass} passed, ${fail} failed`);
if (failures.length) console.error("\nFAILURES:\n  " + failures.join("\n  "));
if (fatalError) { process.exitCode = 2; } else if (fail > 0) { process.exitCode = 1; } else { console.log("• ALL PASS"); process.exitCode = 0; }
}
main();
