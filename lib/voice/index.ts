// StayBid Voice AI — barrel.
// SB-01: read-orchestration foundation for the /hotels customer surface.
// SB-02: the dormant Voice interaction shell (UX state machine, injectable audio
// capture, provider-neutral transport contracts, and the untrusted→SB-01 bridge).
// Disabled by default (NEXT_PUBLIC_VOICE_AI_BETA === "1"). No provider/STT/TTS wired.
export * from "./contracts";
export * from "./registry";
export * from "./policy";
export * from "./session";
export * from "./normalize";
export * from "./adapters";
export * from "./actions";
export * from "./flag";
// SB-02 additions (additive — SB-01 exports above are unchanged).
export * from "./ux-machine";
export * from "./audio-capture";
export * from "./transport-contracts";
export * from "./interaction";
