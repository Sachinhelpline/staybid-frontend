// Dynamic SB-XXXX code generation + verification.
// Bound to a request_id so the same code can't be reused across requests
// (defends against pre-recorded videos being passed off as fresh).
import { customAlphabet } from "nanoid";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const codeNano = customAlphabet(CODE_ALPHABET, 4);

export function generateVerificationCode(): string {
  return `SB-${codeNano()}`;
}

export function isWellFormedCode(code: string): boolean {
  return /^SB-[A-Z0-9]{4}$/.test(code);
}
