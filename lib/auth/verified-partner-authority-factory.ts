// Production wiring for the verified-partner authority (server-only).
// Kept separate from the pure gate (lib/auth/verified-partner-authority.ts) so
// the gate stays hermetically testable with an injected resolver.
//
// SEC-00B FINAL (partner↔hotel authority): the hotel-scope resolver reads ONLY
// the protected, forge-proof verified_partner_hotel_scope table (service-role).
// It NO LONGER reads hotels.ownerId or hotel_room_units.owner_user_id — both of
// which have permissive production RLS (anon + authenticated full CRUD), so a
// normal customer could forge one of those mappings to their own subject and
// pass scope. Binding is by the EXACT verified token subject, so there is ZERO
// client-writable input on the evidence-writer security path. A valid customer
// token with no active binding resolves to an EMPTY scope (→ 403 fail closed).
// The public ownership mappings remain DISPLAY / inventory data for the
// dashboard, never the evidence-writer authority.
import { readActivePartnerHotelIds } from "@/lib/auth/verified-partner-hotel-scope";
import type { PartnerAuthorityDeps } from "@/lib/auth/verified-partner-authority";

/**
 * Build the partner authority deps. Secret contract is NARROW: the authority
 * verifies ONLY against the authoritative Railway `JWT_ACCESS_SECRET` (the
 * secret partner/customer access tokens are minted with — the same one the
 * admin gate uses). The `JWT_SECRET` compat fallback is deliberately NOT
 * included on this strict evidence-writer path (a legacy JWT_SECRET-only token
 * fails closed rather than being trusted). Authorization is then decided by the
 * protected verified_partner_hotel_scope binding for that exact subject, so a
 * validly-signed CUSTOMER token (no binding) is never a partner authority.
 */
export function createPartnerAuthorityDeps(
  env: Record<string, string | undefined> = process.env
): PartnerAuthorityDeps {
  return {
    secrets: [env.JWT_ACCESS_SECRET],
    // subject-only: the phone/email twins are intentionally NOT used, so no
    // client-writable table (users / onboarding_users / hotels /
    // hotel_room_units) is read on the authorization path.
    resolveHotelIds: async (subject: string) => readActivePartnerHotelIds([subject]),
  };
}
