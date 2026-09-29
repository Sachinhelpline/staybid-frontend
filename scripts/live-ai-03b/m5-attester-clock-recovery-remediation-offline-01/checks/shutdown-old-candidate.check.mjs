// §16 — RED SIDE: the WORK shutdown defect reproduced against the EXACT PRIOR reviewed candidate bytes (v1 =
// baseline f5ec5807 + REMEDIATION-v1.diff, sha256 6722afde…; the 5 runtime files re-hashed below). A PASS here
// means the defect IS present in v1. Stop ordering = v1's composition body (baseStop, then sampler.close()).
import crypto from "node:crypto";
import fs from "node:fs";
import { V1_TREE, bdir, makeOk } from "./lib.mjs";
import { loadTree, buildRig, invalidateAndRetire, v1CompositionStop, delta, sleep, deferred, waitFor } from "./shutdown-scenarios.mjs";

if (!V1_TREE) { console.log("shutdown-old-candidate: M5ACR_V1_TREE required (a skip is not a pass)"); process.exit(2); }
const R = makeOk("m5acr-shutdown-old-candidate(v1, RED side)"); const { ok } = R;
const V1 = { "clock-gate.mjs": "3b30dd0fbcd23ca00c3ec2c0460d27cf4b9777b99667d228cbd2e588bdba9b50", "production-db-clock.mjs": "d919b6ec3a965f3d20f8f5600fc85f5ded2d66cecdaf985167d42372ee071de2",
  "attester-bootstrap.mjs": "56a44b7fbd5ff426f0bba530e06136cd0ab0062a1c2a966d1840c16a509e24ff", "production-attester.mjs": "a36c66ee3fbc66be2ca16c365370de7b4f594ee25be4621808c495e1c74998fc",
  "bootstrap-entrypoint-attester.mjs": "3eb85ee323c5673e59fdf2627522b88326454dfeab477ca95173ad5b5cd69820" };
ok("V0 the tree under test is byte-identical to the prior reviewed candidate (5 runtime SHA-256s)", Object.entries(V1).every(([f, h]) => crypto.createHash("sha256").update(fs.readFileSync(bdir(V1_TREE) + "/" + f)).digest("hex") === h));
const T = await loadTree(V1_TREE);

// ── delayed open in flight + active recovery, then stop ──
const rig = await buildRig(T);
await invalidateAndRetire(rig);
const og = deferred(); rig.ctl.openHang = og.promise;
rig.ft.fireNoAwait();                                                   // recovery attempt 1 starts
await waitFor(() => rig.ctl.openCalls === 2 && rig.att.recovery().inFlight === true, 3000);
ok("V1 precondition: one recovery is ACTIVE and a DB open is pending (unresolved) at the stop boundary", rig.att.recovery().inFlight === true && rig.ctl.openCalls === 2 && rig.ctl.physicals.length === 1);
const atStop = rig.snap();
const stop = v1CompositionStop({ baseStop: rig.att.stop, sampler: rig.sampler });
const stopping = stop();
await sleep(50); rig.ctl.openHang = null; og.resolve();                 // the pending open completes LATE (after stop began)
await stopping;
await waitFor(() => rig.att.recovery().inFlight === false, 20000, 50);
await sleep(300);
const after = rig.snap(); const d = delta(atStop, after);
console.log("  at stop: " + JSON.stringify(atStop)); console.log("  after  : " + JSON.stringify(after)); console.log("  delta  : " + JSON.stringify(d));
const late = rig.ctl.physicals[1];
ok("V2 DEFECT: the late-completing open produced a physical AFTER stop began", rig.ctl.physicals.length === 2 && !!late);
ok("V3 DEFECT: that late physical was hardened + USED after stop (SQL ran on it)", late && late.queries > 0);
ok("V4 DEFECT: the active recovery kept STARTING samples after stop (gate kept consuming its 30 attempts)", d.sampleCalls > 1 && d.samplerSamples > 1);
ok("V5 DEFECT: post-stop SQL starts > 0", d.sqlStarts > 0);
ok("V6 (authority unaffected, as WORK found) signing was NOT restored and status stayed STOPPED", rig.att.signingReady() === false && rig.att.status() === T.STATES.STOPPED && rig.E.of("signing_restored").length === 0);
fs.writeFileSync(new URL("../logs/shutdown-old-candidate-counts.json", import.meta.url), JSON.stringify({ tree: "prior candidate v1", atStop, after, delta: d, latePhysicalQueries: late ? late.queries : 0 }, null, 2) + "\n");
await rig.env.cleanup();
R.done(7);
