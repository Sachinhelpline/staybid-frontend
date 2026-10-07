import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function canonicalize(v){if(v===null)return'null';const t=typeof v;if(t==='boolean')return v?'true':'false';if(t==='number'){if(!Number.isInteger(v))throw new Error('float');return String(v);}if(t==='string')return JSON.stringify(v);if(Array.isArray(v))return'['+v.map(canonicalize).join(',')+']';if(t==='object')return'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonicalize(v[k])).join(',')+'}';throw new Error('unsupported');}
const sha=s=>createHash('sha256').update(Buffer.isBuffer(s)?s:Buffer.from(s,'utf8')).digest('hex');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const digestInput=readJson('identity/RUNTIME-DIGEST-INPUT.json');
const blobManifest=readJson('identity/RUNTIME-BLOB-MANIFEST.json');
const bindingFile=readJson('identity/RUNTIME-PRESERVATION-BINDING.json');
const binding={contract:bindingFile.contract,parent:bindingFile.parent,commit:bindingFile.commit,tree:bindingFile.tree,runtime_digest:bindingFile.runtime_digest};
const GIT_BLOB=/^[0-9a-f]{40}$/;
if(!Array.isArray(digestInput.files)||digestInput.files.length!==14)throw new Error('runtime_file_count_mismatch');
if(JSON.stringify(digestInput.files)!==JSON.stringify(blobManifest.files))throw new Error('runtime_blob_manifest_diverges_from_digest_input');
const seen=new Set();
for(const f of digestInput.files){
  if(!f||typeof f.path!=='string'||!GIT_BLOB.test(String(f.git_blob))||!Number.isInteger(f.size)||f.size<1)throw new Error('runtime_blob_identity_malformed:'+String(f&&f.path));
  if(seen.has(f.path))throw new Error('runtime_blob_path_duplicate:'+f.path);seen.add(f.path);
}
const v3pi=digestInput.files.find(f=>f.path==='src/v3-production-integration.mjs');
if(!v3pi||v3pi.git_blob!=='d0b3a6318971c836d8e8e8d0bb6849879b72bb80'||v3pi.size!==948)throw new Error('v3_production_integration_git_blob_mismatch');
const runtimeDigest=sha(canonicalize(digestInput));
if(runtimeDigest!==blobManifest.canonical_runtime_digest||runtimeDigest!==binding.runtime_digest)throw new Error('runtime_digest_mismatch');
const pin=sha(canonicalize(binding));
if(pin!==bindingFile.successor_runtime_pin_ref)throw new Error('runtime_pin_ref_mismatch');
if(binding.commit!=='f1e1f1272b751b99c8a705d868e7762e928c6238'||binding.tree!=='5659ea8432f3ca76e267ff9e0a6b3896e0b79b88'||binding.parent!=='37349fe9b33bb1045d0c7b062d4b5c4d7c330c1d')throw new Error('preservation_identity_mismatch');
console.log(`IDENTITY_PASS runtime_digest=${runtimeDigest} pin_ref=${pin} runtime_files=${digestInput.files.length} git_blob_format=40hex`);
