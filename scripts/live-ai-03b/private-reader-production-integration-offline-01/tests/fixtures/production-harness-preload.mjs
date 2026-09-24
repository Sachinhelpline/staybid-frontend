// TEST HARNESS ONLY — `node --import` preload that simulates the deployment environment around the REAL,
// unmodified process entrypoint (production-entrypoint.mjs main()) in a child process:
//   • maps the "pg" driver to the synthetic PostgreSQL model (module resolve hook);
//   • resolves the configured private attester DNS name to a local simulated attester;
//   • starts the SIMULATED attester (fixture key generated in memory — co-located here ONLY because this is
//     an offline simulation; a real attester lives outside the reader host) and publishes its PUBLIC key,
//     fingerprint, issuer and port into process.env, exactly as deployment configuration would.
// Never part of any production start command.
import { register } from "node:module";
import dns from "node:dns";
import process from "node:process";
import { makeSyntheticPg } from "./synthetic-pg.mjs";
import { startSimulatedAttester } from "./simulated-attester-server.mjs";
import { ENV } from "../../integration-config.mjs";

register(new URL("./pg-hook.mjs", import.meta.url));
const db = makeSyntheticPg();
globalThis.__LAI03B_SYNTH_PG__ = db;
const name = process.env[ENV.attesterHost];
const orig = dns.lookup;
dns.lookup = (h, o, cb) => {
  if (typeof o === "function") { cb = o; o = {}; }
  if (h === name) return o && o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
  return orig(h, o, cb);
};
const att = await startSimulatedAttester({ db, channelSecret: process.env[ENV.attesterChannelSecret] });
process.env[ENV.attesterIssuer] = att.trustRootConfig.issuer;
process.env[ENV.attesterPublicKeyDerB64] = att.trustRootConfig.publicKeyDerB64;
process.env[ENV.attesterFingerprint] = att.trustRootConfig.fingerprint;
process.env[ENV.attesterPort] = String(att.port);
