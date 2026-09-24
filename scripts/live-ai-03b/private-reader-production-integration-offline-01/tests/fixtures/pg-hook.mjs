// TEST HARNESS ONLY — Node module resolve hook (registered via node:module register()) that maps the
// production driver specifier "pg" to the synthetic driver below, so the REAL production session factory
// (reader-session.mjs makePgPhysicalFactory) runs unchanged against a synthetic PostgreSQL model. This is
// process-environment simulation (like a test double on the module path), never a production input.
export async function resolve(specifier, context, next) {
  if (specifier === "pg") return { url: new URL("./pg-synthetic-driver.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
