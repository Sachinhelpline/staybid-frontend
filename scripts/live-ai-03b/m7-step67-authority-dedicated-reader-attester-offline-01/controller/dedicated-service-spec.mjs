// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — EXACT intended service settings (dedicated reader attester + Authority). OFFLINE. NO I/O.
// These are the settings the Owner applies in the Railway dashboard during P2 / P5 / P6 (no secret involved) and that the
// controller then VERIFIES read-only (names-only state) before any later phase may run.
// ─────────────────────────────────────────────────────────────────────────
import { SERVICES, TARGET, DEDICATED_ATTESTER_START_COMMAND, AUTHORITY_STANDBY_START_COMMAND } from "../src/constants.mjs";

export const DEDICATED_SERVICE_SPEC = Object.freeze({
  name: SERVICES.dedicatedReaderAttester.name,
  projectId: TARGET.projectId, environmentId: TARGET.environmentId,
  source: Object.freeze({ repo: "Sachinhelpline/staybid-frontend", branch: "claude/live-ai-budget-01-price-catalog-inactive-artifact-01",
    commitRule: "the P1 preserved commit (descendant of 1f5e8f66…) whose private-reader-bootstrap-clock-peer-offline-01/ bytes equal 1f5e8f66… exactly" }),
  rootDirectory: "/",
  buildCommand: "echo no-build",
  startCommand: DEDICATED_ATTESTER_START_COMMAND,     // the UNCHANGED accepted attester entrypoint
  numReplicas: 1,
  publicDomains: 0, tcpProxies: 0,
  healthcheck: "none (one-shot private TCP listener; Railway HTTP healthcheck not applicable)",
  restartPolicy: "ON_FAILURE",
  privateNetwork: "enabled (Railway default) — service name live-ai-03b-authority-reader-attester.railway.internal",
  sourceIsUnchangedAcceptedCode: true,
});

export const AUTHORITY_SERVICE_SPEC = Object.freeze({
  id: SERVICES.authority.id, name: SERVICES.authority.name,
  source: DEDICATED_SERVICE_SPEC.source,
  rootDirectory: "/", buildCommand: "echo no-build",
  startCommand: AUTHORITY_STANDBY_START_COMMAND,      // standby only: no DB, no attester, no listener
  numReplicas: 1, publicDomains: 0, tcpProxies: 0,
  restartPolicy: "ON_FAILURE",
  mustNotRedeployBetween: "P5 deployment and P8 completion (its private address is bound by P6/P7)",
});

/** Compare an observed serviceInstance (names-only GraphQL shape) with a spec; returns a list of mismatch codes. */
export function compareServiceInstance(si, spec, { expectDeployed }) {
  const bad = [];
  if (!si) return ["service_instance_absent"];
  if (spec.name && si.serviceName !== spec.name) bad.push("service_name_mismatch");
  if (si.numReplicas !== null && si.numReplicas !== undefined && si.numReplicas !== spec.numReplicas) bad.push("replicas_not_exactly_one");
  if (typeof si.startCommand === "string" && si.startCommand !== spec.startCommand) bad.push("start_command_mismatch");
  if (si.startCommand === undefined) bad.push("start_command_unverifiable");
  if (si.rootDirectory !== undefined && si.rootDirectory !== null && si.rootDirectory !== spec.rootDirectory && si.rootDirectory !== "") bad.push("root_directory_mismatch");
  const doms = si.domains || {};
  if (!Array.isArray(doms.serviceDomains) || !Array.isArray(doms.customDomains) || doms.serviceDomains.length + doms.customDomains.length !== 0) bad.push("public_domain_present");
  if (!si.source || si.source.repo !== spec.source.repo) bad.push("source_repo_mismatch");
  if (expectDeployed) { if (!si.latestDeployment || si.latestDeployment.status !== "SUCCESS") bad.push("deployment_not_success"); }
  return bad;
}
