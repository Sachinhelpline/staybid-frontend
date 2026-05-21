// v170 — shared helpers for hotel-staff auth (Phase 3).
//
// Lives in lib/ (not a route file) so both /api/partner/staff and
// /api/partner/staff-login can import it — Next.js App Router only
// allows HTTP-handler exports inside a route.ts file.
import crypto from "crypto";

// PIN hash — sha256 with a per-row salt (the staff id).
export function pinHash(pin: string, id: string): string {
  return crypto.createHash("sha256").update(`${pin}:${id}:staybid`).digest("hex");
}

// 8-char login code, no ambiguous characters (0/O, 1/I).
export function makeLoginCode(): string {
  const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}
