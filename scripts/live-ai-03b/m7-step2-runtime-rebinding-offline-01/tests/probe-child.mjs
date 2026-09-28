// TEST-ONLY child process: issues a V2 preflight receipt from fixtures IN THIS PROCESS (the probe only
// accepts in-process-issued receipts) and sends the ONE probe through a SYNTHETIC broker returning the
// given spend. argv[2] = spendMicros, argv[3] = providerCalls (default 1). Prints the bounded evidence.
import { makeReviewer, makeApproval, testSourcePin, STATES, RAILWAY, DB, phaseBGates, consumedFixture, iso } from "./helpers.mjs";
import { runPreflightV2 } from "../runtime/v2-preflight.mjs";
import { runProbeV2 } from "../probe/v2-first-text-probe.mjs";

const THROW = process.argv[2] === "throw"; const spend = Number(process.argv[2]); const calls = process.argv[3] === undefined ? 1 : Number(process.argv[3]);
const rv = makeReviewer(); const now = Date.now(); const ap = makeApproval(rv, { nowMs: now });
const cf = consumedFixture(ap, iso(now - 60e3));
const pf = runPreflightV2({ railway: RAILWAY(), sourcePin: testSourcePin(), db: DB(), nowIso: iso(now), testBoundary: true,
  approvalEnvelope: ap.envelope, trustRoot: rv.trustRoot, suppliedEvidence: ap.suppliedEvidence, executionId: ap.executionId, ...cf,
  armedState: STATES.armed(), oneCallPolicy: STATES.ceilings(), counts: STATES.counts(), ...phaseBGates() });
let sends = 0;
const r = await runProbeV2({ preflightReceipt: pf.receipt, nowIso: iso(now), expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test",
  sendViaStagingBroker: async (p) => { sends++; if (THROW) throw new Error("broker socket reset"); return { accepted: true, providerCalls: calls, spendMicros: spend, reservationRef: "rsv-synthetic-1", _text: p.text }; } });
const again = await runProbeV2({ preflightReceipt: pf.receipt, nowIso: iso(now), expectedApprovalId: ap.approvalId, expectedExecutionId: ap.executionId, expectedMode: "test",
  sendViaStagingBroker: async () => { sends++; return { accepted: true, providerCalls: 1, spendMicros: 1 }; } });
process.stdout.write(JSON.stringify({ preflightPass: pf.pass, result: r, second: again, sends }) + "\n");
