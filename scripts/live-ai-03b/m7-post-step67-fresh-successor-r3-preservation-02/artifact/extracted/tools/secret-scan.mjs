import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const textExt=new Set(['.mjs','.js','.json','.md','.txt','.sh','.sql','.log']);
const findings=[];
function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n),st=fs.statSync(p);if(st.isDirectory())walk(p);else if(textExt.has(path.extname(p))){const s=fs.readFileSync(p,'utf8');const rel=path.relative(root,p);const pats=[[/-----BEGIN (?:ED25519 |RSA |EC |OPENSSH )?PRIVATE KEY-----/g,'private-key-pem'],[/\bsk-[A-Za-z0-9_-]{20,}\b/g,'openai-secret-like'],[/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/gi,'credential-bearing-db-url'],[/\b(?:railway|rwy)_[A-Za-z0-9_-]{20,}\b/gi,'railway-token-like']];for(const [re,label] of pats)if(re.test(s))findings.push({file:rel,label});}}}
walk(root);
if(findings.length){console.error(JSON.stringify({ok:false,findings},null,2));process.exit(1);}console.log('SECRET_SCAN_PASS no embedded private-key/API-key/credential-bearing-DB-url material');
