// ─────────────────────────────────────────────────────────────────────────
// LIVE-AI-03B — M7 STEP6/7 — NAMES-ONLY Railway state (one fixed GraphQL document) + evaluator. OFFLINE. NO I/O.
// The Railway `Variable` node selected here has NO value field (name/serviceId/environmentId only) — the same
// names-only shape the accepted Step11B prestate used. The document never queries a CORE-PROD id.
// ─────────────────────────────────────────────────────────────────────────
import { TARGET, SERVICES } from "../src/constants.mjs";

const DOMAINS = "domains { serviceDomains { id } customDomains { id } }";
const SI = "serviceId serviceName environmentId numReplicas startCommand rootDirectory source { repo image } latestDeployment { id status meta } " + DOMAINS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Build the names-only document. `dedicatedServiceId` is null before P2 records it. */
export function buildNamesOnlyDocument({ dedicatedServiceId = null } = {}) {
  if (dedicatedServiceId !== null && !UUID.test(dedicatedServiceId)) throw new Error("dedicated_service_id_invalid");
  const P = TARGET, E = TARGET.environmentId;
  const inst = (alias, id) => `  ${alias}: serviceInstance(environmentId: "${E}", serviceId: "${id}") { ${SI} }\n  ${alias}Tcp: tcpProxies(environmentId: "${E}", serviceId: "${id}") { id }`;
  return [
    "query Step67NamesOnlyState {",
    `  project(id: "${P.projectId}") { id services(first: 100) { pageInfo { hasNextPage } edges { node { id name } } } }`,
    `  environment(id: "${E}", projectId: "${P.projectId}") { id variables(first: 500) { pageInfo { hasNextPage } edges { node { name serviceId environmentId } } } }`,
    inst("authority", SERVICES.authority.id),
    inst("executorAttester", SERVICES.executorAttester.id),
    inst("m5ReaderAttester", SERVICES.m5ReaderAttester.id),
    inst("m5ReaderHost", SERVICES.m5ReaderHost.id),
    inst("postgres", TARGET.postgresServiceId),
    ...(dedicatedServiceId ? [inst("dedicated", dedicatedServiceId)] : []),
    "}",
  ].join("\n");
}

/** Static proof the document is names-only (a single query; no value-returning field or selection; no CORE-PROD id). */
export function isNamesOnlyDocument(doc) {
  if (typeof doc !== "string") return false;
  if (/\bmutation\b|\bsubscription\b/.test(doc)) return false;
  if (/\bvalue\b|decrypt|rendered|unrendered|\braw\b|variablesForServiceDeployment|\bvariables\s*\(\s*(environmentId|projectId|serviceId)/.test(doc)) return false;
  if ((doc.match(/\bquery\b/g) || []).length !== 1) return false;
  if (doc.includes(TARGET.coreProdProjectId) || doc.includes(TARGET.coreProdPostgresId)) return false;
  const sels = doc.match(/variables\(first: 500\) \{ pageInfo \{ hasNextPage \} edges \{ node \{ ([^}]*) \} \} \}/g) || [];
  if (sels.length !== 1 || !/node \{ name serviceId environmentId \}/.test(sels[0])) return false;
  return true;
}

const edges = (c) => (c && Array.isArray(c.edges) ? c.edges.map((e) => e && e.node) : null);

/** Parse the names-only response into a normalized snapshot (variable NAMES per service, instances, proxies). */
export function parseNamesOnlyState(json) {
  let r; try { r = typeof json === "string" ? JSON.parse(json) : json; } catch { return { ok: false, reason: "state_json_unparseable" }; }
  if (!r || typeof r !== "object") return { ok: false, reason: "state_absent" };
  if (Array.isArray(r.errors) && r.errors.length) return { ok: false, reason: "state_graphql_errors_schema_or_access" };
  const d = r.data || r;
  const text = JSON.stringify(d);
  if (text.includes(TARGET.coreProdProjectId) || text.includes(TARGET.coreProdPostgresId)) return { ok: false, reason: "core_prod_identifier_in_state" };
  const vars = edges(d.environment && d.environment.variables);
  const services = edges(d.project && d.project.services);
  if (!vars || !services || d.environment.variables.pageInfo?.hasNextPage !== false || d.project.services.pageInfo?.hasNextPage !== false) return { ok: false, reason: "state_incomplete" };
  if (vars.some((v) => !v || typeof v.name !== "string" || "value" in v)) return { ok: false, reason: "state_variable_shape_unexpected" };
  const namesBy = {};
  for (const v of vars) { if (v.environmentId !== TARGET.environmentId) continue; (namesBy[v.serviceId] = namesBy[v.serviceId] || []).push(v.name); }
  for (const k of Object.keys(namesBy)) namesBy[k].sort();
  const inst = {};
  for (const a of ["authority", "executorAttester", "m5ReaderAttester", "m5ReaderHost", "postgres", "dedicated"]) {
    if (d[a] === undefined) continue;
    inst[a] = { si: d[a], tcp: Array.isArray(d[a + "Tcp"]) ? d[a + "Tcp"].length : null };
  }
  return { ok: true, snapshot: { services: services.map((s) => ({ id: s.id, name: s.name })), namesBy, inst } };
}

export const commitOf = (si) => { const m = si && si.latestDeployment && si.latestDeployment.meta; const c = m && (m.commitHash || m.commitSha); return typeof c === "string" ? c : null; };
export const deploymentIdOf = (si) => (si && si.latestDeployment ? si.latestDeployment.id : null);
export const isPrivateOnly = (x) => !!x && x.tcp === 0 && !!x.si && !!x.si.domains && x.si.domains.serviceDomains.length + x.si.domains.customDomains.length === 0;
/** Snapshot of a frozen service for later equality: deployment id + variable NAMES (never values). */
export const frozenSnapshotOf = (snap, alias, serviceId) => ({ deploymentId: deploymentIdOf(snap.inst[alias] && snap.inst[alias].si), names: (snap.namesBy[serviceId] || []).slice() });
