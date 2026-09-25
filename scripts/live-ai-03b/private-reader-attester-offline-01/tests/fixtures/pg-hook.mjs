// TEST HARNESS ONLY — Node module resolve hook (node:module register()) mapping the "pg" specifier to the
// synthetic driver below, so the REAL production physical-connection factories (reader-session.mjs
// makePgPhysicalFactory AND observer-connection.mjs makeObserverPgFactory) run unchanged against the
// shared synthetic cluster. Never part of any production start command.
export async function resolve(specifier, context, next) {
  if (specifier === "pg") return { url: new URL("./pg-synthetic-driver.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
