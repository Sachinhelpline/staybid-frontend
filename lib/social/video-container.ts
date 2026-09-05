// ═══════════════════════════════════════════════════════════════════════════
// N0 — Pure, bounded ISOBMFF (MP4-family) container classifier + normalized-
// output validator for outbound creator video.
// ───────────────────────────────────────────────────────────────────────────
// PURE: no DOM, no network, no provider, no codec parsing beyond the minimum
// box structure (ftyp / moov / mvhd / mvex / mehd / trak / tkhd / mdhd /
// hdlr / stsd entry type + its config box / stts / stsz / stsc / stco|co64 /
// moof / traf / trun sample counts / sidx / mdat). It never decides by MIME
// or filename alone: MIME only hints how to label a NON-ISOBMFF payload.
//
// MEMORY-SAFE: classification reads through a `ByteReader` and touches only
// box HEADERS at top level plus the bodies of ftyp / moov / moof (each
// capped), so a 250 MB original is never loaded whole just to classify it.
// Full-buffer loading happens only when an asset actually enters the bounded
// remux path (lib/social/video-normalize.ts).
// ═══════════════════════════════════════════════════════════════════════════

export type VideoContainerClass =
  | "SAFE_PROGRESSIVE_MP4"
  | "KNOWN_UNSAFE_COMPRESSOR_FMP4"
  | "FRAGMENTED_ORIGINAL_UNVALIDATED"
  | "NON_MP4_ORIGINAL"
  | "UNREADABLE_OR_INVALID_MP4";

export type TrackSummary = {
  id: number;
  handler: string;             // "vide" | "soun" | other 4cc
  sampleEntry: string;         // e.g. "avc1" | "mp4a"
  /** Raw bytes of the codec configuration box (avcC / hvcC / av1C / vpcC /
   *  esds) inside the first sample entry, when present. */
  codecConfig: Uint8Array | null;
  mdhdTimescale: number;
  mdhdDuration: number;
  /** Traditional sample-table state (progressive MP4). */
  stszCount: number;
  sttsCount: number;
  chunkCount: number;
  /** Samples enumerated from moof/traf/trun (fragmented MP4). */
  fragmentSampleCount: number;
};

export type ContainerReport = {
  cls: VideoContainerClass;
  reason: string;
  totalBytes: number;
  majorBrand: string | null;
  compatibleBrands: string[];
  hasMoov: boolean;
  hasMdat: boolean;
  moovBeforeMdat: boolean;
  moofCount: number;
  hasMvex: boolean;
  hasMehd: boolean;
  hasSidx: boolean;
  mvhdTimescale: number;
  mvhdDuration: number;
  tracks: TrackSummary[];
};

/** Minimal random-access byte source. `read` must return exactly `length`
 *  bytes (or fewer only at EOF). */
export type ByteReader = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export const MAX_TOP_LEVEL_BOXES = 4096;
export const MAX_FTYP_BYTES = 4 * 1024;
export const MAX_MOOV_BYTES = 16 * 1024 * 1024;
export const MAX_SINGLE_MOOF_BYTES = 1024 * 1024;
export const MAX_TOTAL_MOOF_BYTES = 8 * 1024 * 1024;

const MP4_FAMILY_BRANDS = new Set([
  "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso8", "mp41", "mp42", "avc1",
  "M4V ", "M4A ", "dash", "cmfc", "mp71", "MSNV", "NDSC", "NDSH", "NDSM", "NDSP", "NDSS", "NDXC", "NDXH", "NDXM", "NDXP", "NDXS",
]);

export function readerFromBytes(bytes: Uint8Array): ByteReader {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      const end = Math.min(bytes.byteLength, offset + length);
      return bytes.subarray(Math.min(offset, bytes.byteLength), end);
    },
  };
}

/** Bounded Blob reader: every read is a `Blob.slice()` of exactly the bytes
 *  requested — never the whole file. */
export function readerFromBlob(blob: Blob): ByteReader {
  return {
    size: blob.size,
    async read(offset, length) {
      const end = Math.min(blob.size, offset + length);
      if (offset >= end) return new Uint8Array(0);
      return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    },
  };
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

type Box = { type: string; start: number; size: number; body: number; end: number };

/** Enumerate boxes inside an in-memory byte range. */
function* boxesIn(buf: Uint8Array, start: number, end: number): Generator<Box> {
  let off = start;
  while (off + 8 <= end) {
    let size = u32(buf, off);
    const type = fourcc(buf, off + 4);
    let hdr = 8;
    if (size === 1) { if (off + 16 > end) return; size = u64(buf, off + 8); hdr = 16; }
    else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) return;
    yield { type, start: off, size, body: off + hdr, end: off + size };
    off += size;
  }
}

function child(buf: Uint8Array, parent: Box, type: string): Box | null {
  for (const b of boxesIn(buf, parent.body, parent.end)) if (b.type === type) return b;
  return null;
}
function children(buf: Uint8Array, parent: Box, type: string): Box[] {
  const out: Box[] = [];
  for (const b of boxesIn(buf, parent.body, parent.end)) if (b.type === type) out.push(b);
  return out;
}

function parseTrack(buf: Uint8Array, trak: Box): TrackSummary | null {
  const tkhd = child(buf, trak, "tkhd");
  const mdia = child(buf, trak, "mdia");
  if (!tkhd || !mdia) return null;
  const tv = buf[tkhd.body];
  const id = tv === 1 ? u32(buf, tkhd.body + 20) : u32(buf, tkhd.body + 12);
  const mdhd = child(buf, mdia, "mdhd");
  const hdlr = child(buf, mdia, "hdlr");
  const minf = child(buf, mdia, "minf");
  const stbl = minf ? child(buf, minf, "stbl") : null;
  if (!mdhd || !hdlr || !stbl) return null;
  const mv = buf[mdhd.body];
  const mdhdTimescale = mv === 1 ? u32(buf, mdhd.body + 20) : u32(buf, mdhd.body + 12);
  const mdhdDuration = mv === 1 ? u64(buf, mdhd.body + 24) : u32(buf, mdhd.body + 16);
  const handler = fourcc(buf, hdlr.body + 8);
  let sampleEntry = "";
  let codecConfig: Uint8Array | null = null;
  const stsd = child(buf, stbl, "stsd");
  if (stsd) {
    const first = boxesIn(buf, stsd.body + 8, stsd.end).next().value as Box | undefined;
    if (first) {
      sampleEntry = first.type;
      // Visual sample entry: 78-byte fixed header; audio: 28-byte fixed header
      // (v0). We only look for the well-known config boxes after either.
      for (const hdrLen of handler === "vide" ? [78] : [28, 64]) {
        for (const sub of boxesIn(buf, first.body + hdrLen, first.end)) {
          if (["avcC", "hvcC", "av1C", "vpcC", "esds", "dOps", "dfLa"].includes(sub.type)) { codecConfig = buf.slice(sub.start, sub.end); break; }
        }
        if (codecConfig) break;
      }
    }
  }
  const stsz = child(buf, stbl, "stsz") || child(buf, stbl, "stz2");
  const stts = child(buf, stbl, "stts");
  const stco = child(buf, stbl, "stco") || child(buf, stbl, "co64");
  return {
    id, handler, sampleEntry, codecConfig, mdhdTimescale, mdhdDuration,
    stszCount: stsz ? u32(buf, stsz.body + 8) : 0,
    sttsCount: stts ? u32(buf, stts.body + 4) : 0,
    chunkCount: stco ? u32(buf, stco.body + 4) : 0,
    fragmentSampleCount: 0,
  };
}

function isEbml(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
}

function report(partial: Partial<ContainerReport> & { cls: VideoContainerClass; reason: string; totalBytes: number }): ContainerReport {
  return {
    majorBrand: null, compatibleBrands: [], hasMoov: false, hasMdat: false, moovBeforeMdat: false,
    moofCount: 0, hasMvex: false, hasMehd: false, hasSidx: false, mvhdTimescale: 0, mvhdDuration: 0, tracks: [],
    ...partial,
  };
}

/**
 * Classify a video payload by STRUCTURE (bounded reads). `mimeHint` only
 * decides whether a non-ISOBMFF payload is labelled NON_MP4_ORIGINAL or
 * UNREADABLE_OR_INVALID_MP4 (a payload that CLAIMS to be MP4 but is not).
 */
export async function classifyVideoContainer(reader: ByteReader, mimeHint: string): Promise<ContainerReport> {
  const totalBytes = reader.size;
  const mime = (mimeHint || "").toLowerCase().split(";")[0].trim();
  const claimsMp4 = mime === "video/mp4" || mime === "video/quicktime" || mime === "video/x-m4v" || mime === "";
  const head = await reader.read(0, 16);
  if (head.length < 16) {
    return report({ cls: claimsMp4 ? "UNREADABLE_OR_INVALID_MP4" : "NON_MP4_ORIGINAL", reason: "too_small", totalBytes });
  }
  if (isEbml(head) || fourcc(head, 4) !== "ftyp") {
    return report({ cls: claimsMp4 && !isEbml(head) ? "UNREADABLE_OR_INVALID_MP4" : "NON_MP4_ORIGINAL", reason: isEbml(head) ? "ebml_webm_mkv" : "no_ftyp_magic", totalBytes });
  }

  // ── top-level walk: headers only, bodies read for ftyp / moov / moof (capped)
  let off = 0, count = 0;
  let ftypBytes: Uint8Array | null = null;
  let moovBytes: Uint8Array | null = null;
  let moovOffset = -1, mdatOffset = -1, moofCount = 0, moofBytesTotal = 0, hasSidx = false;
  const fragmentCounts = new Map<number, number>();
  while (off + 8 <= totalBytes) {
    if (++count > MAX_TOP_LEVEL_BOXES) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: "too_many_boxes", totalBytes });
    const hdr = await reader.read(off, 16);
    if (hdr.length < 8) break;
    let size = u32(hdr, 0); const type = fourcc(hdr, 4); let hdrLen = 8;
    if (size === 1) { if (hdr.length < 16) break; size = u64(hdr, 8); hdrLen = 16; }
    else if (size === 0) size = totalBytes - off;
    if (size < hdrLen || off + size > totalBytes) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: `bad_box_size:${type}`, totalBytes });
    if (type === "ftyp") { if (size > MAX_FTYP_BYTES) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: "ftyp_too_large", totalBytes }); ftypBytes = await reader.read(off, size); }
    else if (type === "moov" && !moovBytes) { if (size > MAX_MOOV_BYTES) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: "moov_too_large", totalBytes }); moovBytes = await reader.read(off, size); moovOffset = off; }
    else if (type === "mdat") { if (mdatOffset < 0) mdatOffset = off; }
    else if (type === "sidx") hasSidx = true;
    else if (type === "moof") {
      moofCount++;
      if (size <= MAX_SINGLE_MOOF_BYTES && moofBytesTotal + size <= MAX_TOTAL_MOOF_BYTES) {
        moofBytesTotal += size;
        const moof = await reader.read(off, size);
        const root: Box = { type: "moof", start: 0, size: moof.length, body: hdrLen, end: moof.length };
        for (const traf of children(moof, root, "traf")) {
          const tfhd = child(moof, traf, "tfhd");
          const tid = tfhd ? u32(moof, tfhd.body + 4) : -1;
          let n = 0;
          for (const trun of children(moof, traf, "trun")) n += u32(moof, trun.body + 4);
          fragmentCounts.set(tid, (fragmentCounts.get(tid) || 0) + n);
        }
      }
    }
    off += size;
  }

  const majorBrand = ftypBytes ? fourcc(ftypBytes, 8) : null;
  const compatibleBrands: string[] = [];
  if (ftypBytes) for (let i = 16; i + 4 <= ftypBytes.length; i += 4) compatibleBrands.push(fourcc(ftypBytes, i));
  const brandFamily = [majorBrand || "", ...compatibleBrands].some((b) => MP4_FAMILY_BRANDS.has(b));
  if (!brandFamily) {
    return report({ cls: "NON_MP4_ORIGINAL", reason: `non_mp4_brand:${(majorBrand || "").trim() || "none"}`, totalBytes, majorBrand, compatibleBrands, hasMoov: !!moovBytes, hasMdat: mdatOffset >= 0, moofCount, hasSidx });
  }
  if (!moovBytes) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: "no_moov", totalBytes, majorBrand, compatibleBrands, hasMdat: mdatOffset >= 0, moofCount, hasSidx });

  // ── moov parse
  const moovRoot: Box = { type: "moov", start: 0, size: moovBytes.length, body: u32(moovBytes, 0) === 1 ? 16 : 8, end: moovBytes.length };
  const mvhd = child(moovBytes, moovRoot, "mvhd");
  let mvhdTimescale = 0, mvhdDuration = 0;
  if (mvhd) { const v = moovBytes[mvhd.body]; mvhdTimescale = v === 1 ? u32(moovBytes, mvhd.body + 20) : u32(moovBytes, mvhd.body + 12); mvhdDuration = v === 1 ? u64(moovBytes, mvhd.body + 24) : u32(moovBytes, mvhd.body + 16); }
  const mvex = child(moovBytes, moovRoot, "mvex");
  const hasMvex = !!mvex;
  const hasMehd = !!(mvex && child(moovBytes, mvex, "mehd"));
  const tracks: TrackSummary[] = [];
  for (const trak of children(moovBytes, moovRoot, "trak")) {
    const t = parseTrack(moovBytes, trak);
    if (!t) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: "bad_trak", totalBytes, majorBrand, compatibleBrands, hasMoov: true, hasMdat: mdatOffset >= 0, moofCount, hasMvex, hasMehd, hasSidx, mvhdTimescale, mvhdDuration });
    t.fragmentSampleCount = fragmentCounts.get(t.id) || 0;
    tracks.push(t);
  }
  const base = { totalBytes, majorBrand, compatibleBrands, hasMoov: true, hasMdat: mdatOffset >= 0, moovBeforeMdat: mdatOffset >= 0 && moovOffset < mdatOffset, moofCount, hasMvex, hasMehd, hasSidx, mvhdTimescale, mvhdDuration, tracks };
  if (!mvhd || tracks.length === 0) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: !mvhd ? "no_mvhd" : "no_tracks", ...base });
  const mediaTracks = tracks.filter((t) => t.handler === "vide" || t.handler === "soun");

  if (hasMvex || moofCount > 0) {
    // The proven Chromium-MediaRecorder class: mvex + moof, movie duration 0,
    // no mehd, no sidx, every traditional sample table empty, only vide/soun
    // tracks, and samples actually enumerated in fragments.
    const knownUnsafe = hasMvex && moofCount > 0 && mvhdDuration === 0 && !hasMehd && !hasSidx
      && mediaTracks.length === tracks.length && mediaTracks.length > 0
      && tracks.every((t) => t.stszCount === 0 && t.sttsCount === 0 && t.chunkCount === 0 && t.fragmentSampleCount > 0);
    return report({ cls: knownUnsafe ? "KNOWN_UNSAFE_COMPRESSOR_FMP4" : "FRAGMENTED_ORIGINAL_UNVALIDATED", reason: knownUnsafe ? "chromium_mediarecorder_fmp4_signature" : "fragmented_variant", ...base });
  }
  // N0 remediation (Correction 1): a SAFE_PROGRESSIVE_MP4 must carry actual
  // media data — a top-level mdat box. A moov with valid-looking sample
  // tables but NO mdat is not safe outbound video; it fails closed through
  // the invalid/unreadable policy.
  const progressive = base.hasMdat && mvhdDuration > 0 && mediaTracks.length > 0
    && mediaTracks.every((t) => t.stszCount > 0 && t.sttsCount > 0 && t.chunkCount > 0 && t.mdhdDuration > 0);
  if (!progressive) return report({ cls: "UNREADABLE_OR_INVALID_MP4", reason: !base.hasMdat ? "no_mdat" : mvhdDuration === 0 ? "zero_duration_non_fragmented" : "empty_sample_tables", ...base });
  return report({ cls: "SAFE_PROGRESSIVE_MP4", reason: "progressive_sample_tables", ...base });
}

/** Convenience wrappers. */
export function classifyVideoBytes(bytes: Uint8Array, mimeHint: string): Promise<ContainerReport> {
  return classifyVideoContainer(readerFromBytes(bytes), mimeHint);
}
export function classifyVideoBlob(blob: Blob, mimeHint?: string): Promise<ContainerReport> {
  return classifyVideoContainer(readerFromBlob(blob), mimeHint ?? blob.type);
}

export type ValidationResult = { ok: boolean; failures: string[] };

function bytesEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Size tolerance for a packet-copy remux: headers/tables only change. */
export const NORMALIZED_SIZE_TOLERANCE = (inputBytes: number) => Math.max(256 * 1024, Math.ceil(inputBytes * 0.02));

/**
 * FAIL-CLOSED validator for a normalized output. A successful remux return
 * is NOT enough — the OUTPUT structure and its consistency with the INPUT
 * report are checked independently of the remux library.
 */
export function validateNormalizedOutput(output: ContainerReport, input: ContainerReport, outputBytes: number, inputBytes: number): ValidationResult {
  const f: string[] = [];
  if (output.cls !== "SAFE_PROGRESSIVE_MP4") f.push(`output_class:${output.cls}:${output.reason}`);
  if (output.moofCount > 0) f.push("output_has_moof");
  if (output.hasMvex) f.push("output_has_mvex");
  if (!output.hasMoov || !output.hasMdat || !output.moovBeforeMdat) f.push("output_moov_not_before_mdat");
  if (!(output.mvhdDuration > 0 && output.mvhdTimescale > 0)) f.push("output_mvhd_duration_invalid");
  const inMedia = input.tracks.filter((t) => t.handler === "vide" || t.handler === "soun");
  const outMedia = output.tracks.filter((t) => t.handler === "vide" || t.handler === "soun");
  if (inMedia.length !== outMedia.length) f.push(`track_count:${inMedia.length}->${outMedia.length}`);
  for (const it of inMedia) {
    const ot = outMedia.find((t) => t.handler === it.handler && t.sampleEntry === it.sampleEntry && !(t as any)._used);
    if (!ot) { f.push(`track_missing:${it.handler}/${it.sampleEntry}`); continue; }
    (ot as any)._used = true;
    if (!(ot.stszCount > 0 && ot.sttsCount > 0 && ot.chunkCount > 0)) f.push(`sample_tables_empty:${it.handler}`);
    if (it.fragmentSampleCount > 0 && ot.stszCount !== it.fragmentSampleCount) f.push(`sample_count:${it.handler}:${it.fragmentSampleCount}->${ot.stszCount}`);
    if (!(ot.mdhdDuration > 0 && ot.mdhdTimescale > 0)) f.push(`track_duration_invalid:${it.handler}`);
    if (it.codecConfig && it.codecConfig.length > 0) {
      // avcC/hvcC/av1C/vpcC are copied verbatim by a packet-copy remux; esds
      // wrappers may be re-serialized, so only the box TYPE is required there.
      const type = String.fromCharCode(it.codecConfig[4], it.codecConfig[5], it.codecConfig[6], it.codecConfig[7]);
      if (type === "esds") { if (!ot.codecConfig || ot.codecConfig.length < 8) f.push("audio_config_missing"); }
      else if (!bytesEqual(it.codecConfig, ot.codecConfig)) f.push(`codec_config_changed:${it.handler}/${type}`);
    }
  }
  for (const ot of outMedia) delete (ot as any)._used;
  if (Math.abs(outputBytes - inputBytes) > NORMALIZED_SIZE_TOLERANCE(inputBytes)) f.push(`size_out_of_tolerance:${inputBytes}->${outputBytes}`);
  return { ok: f.length === 0, failures: f };
}
