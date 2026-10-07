import { digestOf } from './v3-digest-gen.mjs';

export const RUNTIME_PIN_CONTRACT = 'M7V3SuccessorRuntimePreservationBindingV1';
export const SUCCESSOR_PARENT_COMMIT = '37349fe9b33bb1045d0c7b062d4b5c4d7c330c1d';
const H40=/^[0-9a-f]{40}$/; const H64=/^[0-9a-f]{64}$/;
const fail=(reason)=>({ok:false,reason});

export function validateRuntimePreservationBinding(binding){
  if(!binding||typeof binding!=='object'||Array.isArray(binding)) return fail('runtime_binding_absent');
  const keys=['commit','contract','parent','runtime_digest','tree'];
  if(Object.keys(binding).sort().join(',')!==keys.join(',')) return fail('runtime_binding_shape_not_exact');
  if(binding.contract!==RUNTIME_PIN_CONTRACT) return fail('runtime_binding_contract_mismatch');
  if(binding.parent!==SUCCESSOR_PARENT_COMMIT) return fail('runtime_binding_parent_mismatch');
  if(!H40.test(String(binding.commit))||!H40.test(String(binding.tree))||!H64.test(String(binding.runtime_digest))) return fail('runtime_binding_digest_malformed');
  if(binding.commit===binding.parent) return fail('runtime_binding_commit_not_successor');
  return {ok:true,pinRef:digestOf(binding).digest,binding:Object.freeze({...binding})};
}
export function runtimePinRef(binding){const v=validateRuntimePreservationBinding(binding);if(!v.ok)throw new Error(v.reason);return v.pinRef;}
