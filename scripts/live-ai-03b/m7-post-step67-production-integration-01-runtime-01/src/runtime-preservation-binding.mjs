import { createHash } from 'node:crypto';

export const PINNED_RUNTIME_BINDING = Object.freeze({
  contract: 'M7V3SuccessorRuntimePreservationBindingV1',
  parent: '37349fe9b33bb1045d0c7b062d4b5c4d7c330c1d',
  commit: 'f1e1f1272b751b99c8a705d868e7762e928c6238',
  tree: '5659ea8432f3ca76e267ff9e0a6b3896e0b79b88',
  runtime_digest: '3e4be815d493b6854e3ef4467cad1b8d3c0494fc677049a099f351ebdb4e55f8',
});
export const PINNED_SUCCESSOR_RUNTIME_PIN_REF = '78804a8648e684bcdfb7d52dd34463310dec43c592fb2530216be19a04bc203d';

function canonicalize(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') { if (!Number.isInteger(v)) throw new Error('floating-point forbidden'); return String(v); }
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (t === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  throw new Error('unsupported type');
}
export function localRuntimePinRef(binding = PINNED_RUNTIME_BINDING) {
  return createHash('sha256').update(Buffer.from(canonicalize(binding), 'utf8')).digest('hex');
}
export function checkPinnedRuntimeBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { ok:false, reason:'runtime_binding_absent' };
  const keys = ['commit','contract','parent','runtime_digest','tree'];
  if (Object.keys(binding).sort().join(',') !== keys.join(',')) return { ok:false, reason:'runtime_binding_shape_not_exact' };
  for (const k of keys) if (binding[k] !== PINNED_RUNTIME_BINDING[k]) return { ok:false, reason:'runtime_binding_pin_mismatch:' + k };
  if (localRuntimePinRef(binding) !== PINNED_SUCCESSOR_RUNTIME_PIN_REF) return { ok:false, reason:'runtime_binding_pin_ref_mismatch' };
  return { ok:true, pinRef:PINNED_SUCCESSOR_RUNTIME_PIN_REF };
}
