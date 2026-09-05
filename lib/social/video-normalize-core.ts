// ═══════════════════════════════════════════════════════════════════════════
// N0 — mediabunny@1.55.7 (EXACT pin, gate-accepted) packet-copy remux of the
// proven Chromium-MediaRecorder fragmented-MP4 class → progressive faststart
// MP4, plus the strongest practical bounded payload/config preservation check
// (EncodedPacketSink over input and output; no decode, no re-encode).
// ───────────────────────────────────────────────────────────────────────────
// This module statically imports mediabunny and therefore MUST only ever be
// loaded lazily from the creator normalization path (the one-shot Worker in
// video-normalize.worker.ts). Never import it from Home / browse / viewer
// code. No resize, trim, codec, bitrate, overlay or audio change happens here.
// ═══════════════════════════════════════════════════════════════════════════
import { Input, Output, Conversion, Mp4OutputFormat, BufferSource, BufferTarget, MP4, EncodedPacketSink } from "mediabunny";

export type TrackPacketCheck = {
  type: string; codec: string | null;
  packetsIn: number; packetsOut: number;
  keyIn: number; keyOut: number;
  bytesIn: number; bytesOut: number;
  payloadHashIn: string; payloadHashOut: string;
  configIn: string | null; configOut: string | null;
  match: boolean;
};
export type PacketCheck = { tracks: TrackPacketCheck[]; allMatch: boolean };
export type RemuxResult = { output: Uint8Array; packetCheck: PacketCheck };

// FNV-1a over two independent 32-bit lanes (odd/even bytes) — deterministic,
// dependency-free, cheap; used only to compare INPUT vs OUTPUT payload streams.
function fnvLanes(): { update(b: Uint8Array): void; hex(): string } {
  let h0 = 0x811c9dc5, h1 = 0x811c9dc5, len = 0;
  return {
    update(b: Uint8Array) {
      for (let i = 0; i < b.length; i++) {
        if ((len + i) & 1) { h1 ^= b[i]; h1 = Math.imul(h1, 0x01000193) >>> 0; }
        else { h0 ^= b[i]; h0 = Math.imul(h0, 0x01000193) >>> 0; }
      }
      len += b.length;
    },
    hex() { return h0.toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0") + ":" + len; },
  };
}

async function packetProfile(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
  const out: { type: string; codec: string | null; packets: number; keys: number; bytes: number; hash: string; config: string | null }[] = [];
  for (const track of await input.getTracks()) {
    const sink = new EncodedPacketSink(track);
    const h = fnvLanes(); let n = 0, keys = 0, total = 0;
    for await (const p of sink.packets()) { h.update(p.data); n++; total += p.byteLength; if (p.type === "key") keys++; }
    let config: string | null = null;
    try {
      const c = (await (track as any).getDecoderConfig?.()) as { codec?: string; description?: ArrayBuffer | ArrayBufferView } | null;
      if (c) { const ch = fnvLanes(); if (c.description) ch.update(ArrayBuffer.isView(c.description) ? new Uint8Array(c.description.buffer, c.description.byteOffset, c.description.byteLength) : new Uint8Array(c.description)); config = `${c.codec || ""}|${ch.hex()}`; }
    } catch { config = null; }
    out.push({ type: track.type, codec: track.codec, packets: n, keys, bytes: total, hash: h.hex(), config });
  }
  return out;
}

/** Packet-copy remux (gate-proven API) + preservation check. Throws on any
 *  library failure; the caller treats every throw as FAIL CLOSED. */
export async function remuxFragmentedMp4(inputBytes: Uint8Array): Promise<RemuxResult> {
  const input = new Input({ source: new BufferSource(inputBytes), formats: [MP4] });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const conversion = await Conversion.init({ input, output }); // defaults ⇒ copy packets, never transcode
  if (conversion.discardedTracks.length > 0) throw new Error("remux_discarded_tracks:" + conversion.discardedTracks.map((d) => d.reason).join(","));
  await conversion.execute();
  const buffer = output.target.buffer;
  if (!buffer || buffer.byteLength === 0) throw new Error("remux_empty_output");
  const outBytes = new Uint8Array(buffer);
  const pin = await packetProfile(inputBytes);
  const pout = await packetProfile(outBytes);
  const tracks: TrackPacketCheck[] = pin.map((a, i) => {
    const b = pout[i];
    const match = !!b && a.type === b.type && a.codec === b.codec && a.packets === b.packets && a.keys === b.keys && a.bytes === b.bytes && a.hash === b.hash && a.config === b.config;
    return { type: a.type, codec: a.codec, packetsIn: a.packets, packetsOut: b?.packets ?? 0, keyIn: a.keys, keyOut: b?.keys ?? 0, bytesIn: a.bytes, bytesOut: b?.bytes ?? 0, payloadHashIn: a.hash, payloadHashOut: b?.hash ?? "", configIn: a.config, configOut: b?.config ?? null, match };
  });
  const allMatch = tracks.length > 0 && pin.length === pout.length && tracks.every((t) => t.match);
  return { output: outBytes, packetCheck: { tracks, allMatch } };
}
