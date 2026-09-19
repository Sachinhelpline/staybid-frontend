// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — P1-02 TRUSTED EXECUTOR RUNTIME (REMEDIATION) — INDEPENDENT
// PRODUCTION AUTHORITY acquisition. OFFLINE, Node built-ins only.
//
// WORK finding corrected here: the previous production entrypoint accepted its
// security-authoritative dependencies (DB clients, trust root, connection proof,
// privilege proof, reviewed SQL, source pin) DIRECTLY FROM THE ACTIVATION CALLER,
// so a caller could fabricate all of them and drive a false ok/activated result.
//
// The trusted production dependencies are now obtained ONLY through this module,
// which is INDEPENDENT of the activation request. There is deliberately NO exported
// setter / injector / factory that an activation caller could use to install
// authority at runtime — a module-local object, closure, helper or known string is
// NOT proof of authenticity. Genuine authority requires real, credential-isolated
// capabilities (real reviewer trust root, real credential-isolated executor + reader
// DB clients, an independently issued connection→service identity proof, an
// independently issued privilege-isolation proof, and a schema-confirmed query
// registry) that CANNOT exist offline. In this repository state the authority is
// UNPROVISIONED, so acquireProductionAuthority() fails closed. Provisioning is an
// out-of-band, controlled deployment operation (replacing this module in the private
// deployment image), never an activation-request input and never a repo default.
// ─────────────────────────────────────────────────────────────────────────

// The contract a genuinely provisioned authority MUST satisfy (documentation for the
// future controlled deployment; NOT constructed here).
export const PRODUCTION_AUTHORITY_CONTRACT = Object.freeze({
  contract: "TrustedProductionAuthorityV1",
  must_supply: Object.freeze([
    "cfg: loaded from the deployment's own process env (NOT from the activation request)",
    "trustRoot: independently-pinned reviewer public key + fingerprint (from a controlled keystore, not the envelope)",
    "executorDbClient: real, credential-isolated restricted-executor client (EXECUTE-only on the trusted fn)",
    "readerDbClient: real, credential-isolated read-only client (no table DML)",
    "connectionIdentityProof: independently ISSUED AiStagingConnectionIdentityProofV1 bound to the actual client + issuer + freshness",
    "privilegeProof: independently ISSUED privilege-isolation proof bound to the actual executor/reader credential identities + verified grants",
    "queryRegistry: the schema-confirmed, digest-bound production query registry (see production-query-registry.mjs)",
    "nowProvider: a trusted clock",
  ]),
  must_not: Object.freeze([
    "be supplied, chosen, replaced or overridden by the activation request caller",
    "become trusted merely because an object carries a known provenance string, a boolean, or a helper-created shape",
    "fall back to CORE-PROD or to a synthetic/in-memory fixture",
  ]),
});

// UNPROVISIONED sentinel — the only value this repository state can return.
const UNPROVISIONED = Object.freeze({ available: false, reason: "production_authority_unprovisioned" });

/**
 * Acquire the independently-controlled trusted production authority.
 * In this repository state it is UNPROVISIONED and fails closed. No argument, env var,
 * activation request, or runtime call can provision it here — that is intentional.
 * @returns {Promise<{available:false, reason:string}>} offline; a provisioned deployment
 *   returns { available:true, authority:<TrustedProductionAuthorityV1> } instead.
 */
export async function acquireProductionAuthority() {
  return UNPROVISIONED;
}
