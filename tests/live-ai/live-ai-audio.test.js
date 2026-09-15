#!/usr/bin/env node
/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// StayBid Live AI — LIVE-AI-02A — PCM playback behavioral suite.
//
//   Run:  node tests/live-ai/live-ai-audio.test.js
//
// Compiles lib/live-ai/*.ts with the LOCKFILE-INSTALLED local tsc (NO npx) and
// drives the REAL audio-playback controller through a deterministic FAKE AudioSink
// — NO real AudioContext, NO real audio, NO network. Covers PCM decode/queue order,
// start/chunk/end ownership, sequence replay/gap/conflict, queue + duration bounds,
// flush/barge/route (generation) suppression, autoplay-blocked recovery + teardown.
// ─────────────────────────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const BUILD = path.join(__dirname, ".build", "audio");
const SRC = path.join(BUILD, "src");
const OUT = path.join(BUILD, "out");

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(SRC, "live-ai"), { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, "lib/live-ai"))) {
  if (f.endsWith(".ts")) fs.copyFileSync(path.join(REPO, "lib/live-ai", f), path.join(SRC, "live-ai", f));
}
fs.writeFileSync(path.join(SRC, "tsconfig.json"), JSON.stringify({
  compilerOptions: { module: "commonjs", target: "es2020", esModuleInterop: true, skipLibCheck: true, moduleResolution: "node", ignoreDeprecations: "6.0", rootDir: ".", outDir: "../out", typeRoots: [path.join(REPO, "node_modules/@types")], types: ["node"], lib: ["es2020", "dom"], strict: true, noEmitOnError: true },
  include: ["live-ai/**/*.ts"],
}));
let TSC_BIN;
try { TSC_BIN = require.resolve("typescript/bin/tsc", { paths: [REPO] }); }
catch (_) { console.error("COMPILE GATE FAILED — local tsc not installed."); process.exit(2); }
const compile = cp.spawnSync(process.execPath, [TSC_BIN, "-p", path.join(SRC, "tsconfig.json")], { cwd: REPO, encoding: "utf8" });
if (compile.status !== 0) { console.error("COMPILE GATE FAILED:\n" + (compile.stdout || "") + (compile.stderr || "")); process.exit(2); }
console.log("• Local tsc compile (audio): exit 0, clean (strict)");

const A = require(path.join(OUT, "live-ai/audio-playback.js"));

let pass = 0, fail = 0; const failures = [];
function ok(c, l) { if (c) pass += 1; else { fail += 1; failures.push(l); console.error("  ✗ " + l); } }
function eq(a, b, l) { ok(a === b, `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function section(n) { console.log("\n• " + n); }

// deterministic fake sink
function fakeSink(state = "running", resumeOk = true) {
  const enqueued = [];
  let st = state;
  let closed = false;
  return {
    enqueued, get closed() { return closed; },
    resume: async () => { if (resumeOk) st = "running"; return resumeOk; },
    enqueue: (s) => enqueued.push(s.length),
    stopAndClear: () => { enqueued.length = 0; },
    close: () => { closed = true; st = "closed"; },
    state: () => (closed ? "closed" : st),
    _set: (s) => { st = s; },
  };
}
// base64 PCM16 for n samples (each = 1)
function b64pcm(n) {
  const i16 = new Int16Array(n).fill(1);
  return Buffer.from(i16.buffer).toString("base64");
}

(async function main() {
  section("decode + pcm");
  {
    const bytes = A.decodeBase64(b64pcm(2));
    ok(bytes && bytes.length === 4, "decodeBase64 → 4 bytes for 2 samples");
    const s = A.pcm16le(bytes);
    ok(s && s.length === 2 && s[0] === 1, "pcm16le → Int16Array little-endian");
    ok(A.pcm16le(new Uint8Array(3)) === null, "pcm16le rejects odd byte length");
    // REV-15 — a real assertion (no vacuous "|| true"): junk input must not throw and
    // must return either bytes or null, and an over-bound chunk decodes but is rejected
    // downstream by onChunk's bounds check (covered in the bounds section).
    let threw = false, out;
    try { out = A.decodeBase64("!!!!"); } catch (_) { threw = true; }
    ok(threw === false && (out === null || out instanceof Uint8Array), "decodeBase64 on junk never throws and returns null or bytes");
  }

  section("stream ownership + monotonic sequence");
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    ok(p.onStart({ audioId: "au.1", generation: 0 }, 0) === true, "onStart accepted (current generation)");
    eq(p.onChunk({ audioId: "au.1", generation: 0, seq: 0, bytes: b64pcm(4) }, 0), "played", "seq 0 plays");
    eq(p.onChunk({ audioId: "au.1", generation: 0, seq: 1, bytes: b64pcm(4) }, 0), "played", "seq 1 plays");
    // gap
    eq(p.onChunk({ audioId: "au.1", generation: 0, seq: 3, bytes: b64pcm(4) }, 0), "aborted", "a gap (seq 3 after 1) aborts");
    // after abort, further chunks are aborted
    eq(p.onChunk({ audioId: "au.1", generation: 0, seq: 2, bytes: b64pcm(4) }, 0), "aborted", "post-abort chunk aborted");
    ok(sink.enqueued.length === 0, "abort stopped + cleared the sink queue");
  }
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.2", generation: 0 }, 0);
    p.onChunk({ audioId: "au.2", generation: 0, seq: 0, bytes: b64pcm(4) }, 0);
    // conflicting duplicate (seq 0 again, already consumed)
    eq(p.onChunk({ audioId: "au.2", generation: 0, seq: 0, bytes: b64pcm(4) }, 0), "aborted", "duplicate seq aborts");
  }

  section("unknown / stale / mismatched");
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.3", generation: 5 }, 5);
    eq(p.onChunk({ audioId: "au.3", generation: 4, seq: 0, bytes: b64pcm(4) }, 5), "stale", "stale generation chunk ignored");
    eq(p.onChunk({ audioId: "other", generation: 5, seq: 0, bytes: b64pcm(4) }, 5), "unknown", "unknown audioId ignored");
    // a NEW start supersedes (older stream flushed)
    ok(p.onStart({ audioId: "au.4", generation: 6 }, 6) === true, "a new start (new generation) supersedes");
  }

  section("end mismatch + correct end");
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.5", generation: 0 }, 0);
    p.onChunk({ audioId: "au.5", generation: 0, seq: 0, bytes: b64pcm(4) }, 0);
    ok(p.onEnd({ audioId: "au.5", generation: 0, finalSeq: 5 }, 0) === false, "end with wrong finalSeq → false (abort)");
    const p2 = A.createAudioPlayback({ sink: fakeSink("running") });
    p2.onStart({ audioId: "au.6", generation: 0 }, 0);
    p2.onChunk({ audioId: "au.6", generation: 0, seq: 0, bytes: b64pcm(4) }, 0);
    ok(p2.onEnd({ audioId: "au.6", generation: 0, finalSeq: 1 }, 0) === true, "end with matching finalSeq → true");
  }

  section("bounds: chunk / total / queued");
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.7", generation: 0 }, 0);
    // an over-bound single chunk (> MAX_AUDIO_CHUNK_BYTES decoded) aborts.
    const bigSamples = (A.MAX_QUEUED_PCM_BYTES && 0) || 0; // silence lints
    const overChunk = b64pcm(7000); // 14000 bytes > 12 KiB chunk cap
    eq(p.onChunk({ audioId: "au.7", generation: 0, seq: 0, bytes: overChunk }, 0), "aborted", "an over-bound chunk aborts");
    void bigSamples;
  }
  {
    // per-answer total ceiling
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.8", generation: 0 }, 0);
    let aborted = false, seq = 0;
    // 6 KiB per chunk (3000 samples) — many chunks eventually exceed 4.32 MiB.
    for (let i = 0; i < 800 && !aborted; i++) {
      const r = p.onChunk({ audioId: "au.8", generation: 0, seq: seq++, bytes: b64pcm(3000) }, 0);
      if (r === "aborted") aborted = true;
    }
    ok(aborted, "the per-answer total ceiling eventually aborts the stream");
  }

  section("autoplay blocked → recover + teardown");
  {
    const sink = fakeSink("suspended", true); // suspended until resume
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.9", generation: 0 }, 0);
    eq(p.onChunk({ audioId: "au.9", generation: 0, seq: 0, bytes: b64pcm(4) }, 0), "blocked", "chunk into a suspended sink → blocked (keeps text state)");
    ok(p.needsResume() === true, "needsResume true while blocked");
    ok(sink.enqueued.length === 0, "nothing scheduled while blocked");
    // teardown closes the sink
    p.teardown();
    ok(sink.closed === true, "teardown closes the sink");
  }
  {
    const sink = fakeSink("suspended", false); // autoplay permanently blocked
    const p = A.createAudioPlayback({ sink });
    const okResume = await p.resume();
    // R1-NEW-02 — a bare resume FAILURE with NO stream / NO buffered audio must NOT
    // synthesize a resume-required state (no false "tap to hear" before any audio).
    // needsResume is derived from real buffered audio, so it stays FALSE here.
    ok(okResume === false && p.needsResume() === false, "resume() returns false AND needsResume stays false when nothing is buffered (R1-NEW-02)");
  }
  {
    // R1-NEW-02 — the POSITIVE case: a resume FAILURE while a CURRENT stream actually
    // has buffered (suspended) audio DOES keep needsResume true (real audio is waiting).
    const sink = fakeSink("suspended", false);
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.rz", generation: 0 }, 0);
    eq(p.onChunk({ audioId: "au.rz", generation: 0, seq: 0, bytes: b64pcm(4) }, 0), "blocked", "chunk buffered while suspended");
    const okResume2 = await p.resume();
    ok(okResume2 === false && p.needsResume() === true, "resume() false but needsResume TRUE while real buffered audio waits (R1-NEW-02)");
  }

  section("R4-R1-NEW-02 — an ENDED stream with un-drained BUFFERED audio is STILL resumable");
  {
    // audio.end means "no more chunks", NOT "discard the buffer": a stream that ENDED while
    // suspended with buffered audio still waiting must remain resumable until the buffer drains.
    const sink = fakeSink("suspended", false); // autoplay blocked, resume fails
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.end", generation: 0 }, 0);
    eq(p.onChunk({ audioId: "au.end", generation: 0, seq: 0, bytes: b64pcm(8) }, 0), "blocked", "the chunk buffers while suspended");
    ok(p.onEnd({ audioId: "au.end", generation: 0, finalSeq: 1 }, 0) === true, "the stream ENDS cleanly (finalSeq matches) with buffered audio undrained");
    ok(p.needsResume() === true, "R4-R1-NEW-02 — an ENDED stream whose buffered audio never drained is STILL resumable (the buffer is not discarded on end)");
  }

  section("flush suppresses + resets");
  {
    const sink = fakeSink("running");
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.10", generation: 0 }, 0);
    p.onChunk({ audioId: "au.10", generation: 0, seq: 0, bytes: b64pcm(4) }, 0);
    ok(p.isActive() === true, "active after a chunk");
    p.flush();
    ok(p.isActive() === false, "flush deactivates the stream");
    ok(sink.enqueued.length === 0, "flush cleared the sink");
  }

  section("REV-15 — suspended-sink chunks BUFFER and REPLAY on resume (no silent discard)");
  {
    const sink = fakeSink("suspended", true);
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.buf", generation: 0 }, 0);
    eq(p.onChunk({ audioId: "au.buf", generation: 0, seq: 0, bytes: b64pcm(8) }, 0), "blocked", "chunk into a suspended sink → blocked (buffered)");
    eq(p.onChunk({ audioId: "au.buf", generation: 0, seq: 1, bytes: b64pcm(8) }, 0), "blocked", "a second suspended chunk also buffers (sequence preserved)");
    ok(p.queuedBytes() === 32, "the buffered bytes are counted (2×8 samples ×2 bytes)");
    ok(sink.enqueued.length === 0, "nothing reached the sink while suspended");
    const ok1 = await p.resume(); // fake sink resumes → running
    ok(ok1 === true, "resume() succeeds on a resumable sink");
    ok(sink.enqueued.length === 2, "REV-15 — the buffered backlog REPLAYS to the sink on resume (never discarded)");
    ok(p.queuedBytes() === 0, "REV-15 — the queued counter DECREMENTS to 0 after the backlog drains (not cumulative)");
    ok(p.needsResume() === false, "no longer blocked after a successful resume");
    // a subsequent running chunk plays immediately and does NOT accumulate the counter.
    eq(p.onChunk({ audioId: "au.buf", generation: 0, seq: 2, bytes: b64pcm(8) }, 0), "played", "a post-resume chunk plays");
    ok(p.queuedBytes() === 0, "REV-15 — a running-sink chunk never accumulates the queued counter");
  }

  section("REV-15 — a superseded stream's buffer is cleared (stale audio never replays)");
  {
    const sink = fakeSink("suspended", true);
    const p = A.createAudioPlayback({ sink });
    p.onStart({ audioId: "au.old", generation: 0 }, 0);
    p.onChunk({ audioId: "au.old", generation: 0, seq: 0, bytes: b64pcm(8) }, 0); // buffered
    ok(p.queuedBytes() > 0, "the old stream buffered a chunk");
    // a NEW stream supersedes; the old buffer is dropped.
    p.onStart({ audioId: "au.new", generation: 0 }, 0);
    ok(p.queuedBytes() === 0, "the superseded stream's buffer was cleared");
    await p.resume();
    ok(sink.enqueued.length === 0, "REV-15 — the stale (superseded) audio never replays on resume");
  }

  console.log(`\n${"─".repeat(54)}`);
  console.log(`Live AI LIVE-AI-02A audio: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  console.log("ALL LIVE-AI-02A AUDIO CHECKS PASSED");
  process.exit(0);
})();
