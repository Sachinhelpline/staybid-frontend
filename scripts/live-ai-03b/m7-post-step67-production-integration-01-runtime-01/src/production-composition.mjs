// Additive Production Integration 01 composition. It does not execute on import and performs no I/O at construction.
import { createV3ProductionIntegrationCore } from './v3-integration-core.mjs';
import { PINNED_RUNTIME_BINDING } from './runtime-preservation-binding.mjs';

import { loadRuntimeConfigV3 } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-config.mjs';
import { validateRuntimePreservationBinding, runtimePinRef } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-identity.mjs';
import { verifyApprovalV3 } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/approval-verify-v3.mjs';
import { checkPreActivationState, checkActivatedState } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-runtime-contract.mjs';
import { validateV3ProductionExecutorAuthority } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-production-integration.mjs';
import { EXECUTOR_ATTESTATION_CONTRACT_V2, EXECUTOR_ROLE } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/executor-attestation-v2.mjs';
import { QUERIES, REGISTRY_DIGEST } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-query-registry.mjs';
import { ACTIVATE_SQL_V3, makeRestrictedActivationAdapterV3 } from '../../m7-post-step67-fresh-successor-r3-preservation-02/artifact/extracted/src/v3-restricted-activation-adapter.mjs';

import { establishExecutorSession } from '../../m7-v2-production-authority-provisioning-offline-01/src/executor-session.mjs';
import { establishReaderSession } from '../../private-reader-production-integration-offline-01/reader-session.mjs';
import { bindReaderConnectionV2Only } from './reader-v2-binding.mjs';
import { makeProductionClock } from '../../m7-v2-production-authority-provisioning-offline-01/src/trusted-clock.mjs';

const DEP_KEYS=['env','executorAttestationSource','executorPhysicalFactory','executorTrustRoot','readerAttestationProvider','readerPhysicalFactory','readerTrustRoot'];
const unavailable=reason=>Object.freeze({available:false,reason,run:async()=>Object.freeze({ok:false,activated:false,probeReady:false,stage:'production_integration',reason})});

export function composeProductionActivationBoundaryV3(deps={}){
  if(!deps||typeof deps!=='object'||Array.isArray(deps)||Object.keys(deps).sort().join(',')!==DEP_KEYS.join(','))return unavailable('production_composition_deps_shape_not_exact');
  const runtime=Object.freeze({loadRuntimeConfigV3,validateRuntimePreservationBinding,runtimePinRef,verifyApprovalV3,checkPreActivationState,checkActivatedState,validateV3ProductionExecutorAuthority,EXECUTOR_ATTESTATION_CONTRACT_V2,EXECUTOR_ROLE,QUERIES,REGISTRY_DIGEST,ACTIVATE_SQL_V3,makeRestrictedActivationAdapterV3});
  return createV3ProductionIntegrationCore({
    env:deps.env,
    executorPhysicalFactory:deps.executorPhysicalFactory,
    readerPhysicalFactory:deps.readerPhysicalFactory,
    executorAttestationSource:deps.executorAttestationSource,
    readerAttestationProvider:deps.readerAttestationProvider,
    executorTrustRoot:deps.executorTrustRoot,
    readerTrustRoot:deps.readerTrustRoot,
    establishExecutorSession,
    establishReaderSession,
    bindReaderConnection:bindReaderConnectionV2Only,
    clock:makeProductionClock(),
    runtime,
    runtimePreservationBinding:PINNED_RUNTIME_BINDING,
  });
}
