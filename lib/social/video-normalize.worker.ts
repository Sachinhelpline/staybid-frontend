// N0 — one-shot dedicated Web Worker: owns the mediabunny remux so a 5–25 MB
// creator video never blocks the UI thread. Created ONLY by
// lib/social/video-normalize.ts after classification says normalization is
// required; terminated by the caller after the single result/error.
import { remuxFragmentedMp4 } from "./video-normalize-core";

type Req = { id: number; bytes: ArrayBuffer };
type Res = { id: number; ok: true; output: ArrayBuffer; packetCheck: unknown } | { id: number; ok: false; error: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: Res, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e) => {
  const { id, bytes } = e.data;
  try {
    const { output, packetCheck } = await remuxFragmentedMp4(new Uint8Array(bytes));
    const buf = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    ctx.postMessage({ id, ok: true, output: buf, packetCheck }, [buf]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
