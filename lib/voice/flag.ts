// ─────────────────────────────────────────────────────────────────────────
// StayBid Voice AI — VOICE-AI-SB-01 — fail-closed feature flag.
//
// Voice is DISABLED by default. It activates ONLY when the source-level flag is
// EXACTLY the string "1". Any other value (absent, "0", "true", "yes", " 1 ",
// number 1) → disabled. This packet does NOT create/modify the env var and does
// NOT touch Vercel config — it only reads the source-inlined value.
//
// process.env.NEXT_PUBLIC_VOICE_AI_BETA is statically inlined by Next at build,
// so this is safe in a client component; it is also readable in a Node test that
// sets the value on process.env before requiring this module.
// ─────────────────────────────────────────────────────────────────────────
export const VOICE_BETA_FLAG = "NEXT_PUBLIC_VOICE_AI_BETA";

export function isVoiceBetaEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_AI_BETA === "1";
}
