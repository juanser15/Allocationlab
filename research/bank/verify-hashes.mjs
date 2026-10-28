/** Independent JSON canonicalization using Node crypto; no core hash imports. */
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='reports/bank01',failures=[];let count=0;
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function visit(x,path){if(!x||typeof x!=='object')return;if(!Array.isArray(x)&&typeof x.hash==='string'&&/^[a-f0-9]{64}$/.test(x.hash)){const{hash,...body}=x;count++;if(digest(body)!==hash)failures.push(path);}
 for(const[k,v]of Object.entries(x))visit(v,path+'.'+k);
}
function scan(path){for(const n of readdirSync(path)){const p=path+'/'+n;if(statSync(p).isDirectory()){if(n!=='pre-hardening')scan(p);}else if(n.endsWith('.json'))visit(JSON.parse(readFileSync(p,'utf8')),p);}}
scan(root);
const manifest=JSON.parse(readFileSync(root+'/manifest.json','utf8'));for(const[p,h]of Object.entries({...manifest.source,...manifest.dependencies})){const current=createHash('sha256').update(readFileSync(p)).digest('hex');if(current!==h)failures.push('source/dependency '+p);}
const result={status:failures.length?'FAIL':'PASS',canonical_records_checked:count,failures,source_files_verified:Object.keys(manifest.source).length,dependency_files_verified:Object.keys(manifest.dependencies).length};
writeFileSync(root+'/hash-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=failures.length?1:0;
