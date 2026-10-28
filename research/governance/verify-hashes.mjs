/** Independent canonical SHA256 and journal checker; no governance imports. */
import fs from 'node:fs';
import crypto from 'node:crypto';
const root=process.argv[2]??'reports/pipe02';
const canonical=x=>x===null?'null':typeof x==='string'||typeof x==='boolean'?JSON.stringify(x):typeof x==='number'&&Number.isFinite(x)?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':(()=>{throw Error('Noncanonical value');})();
const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
let seals=0,journals=0,targets=0;
function visit(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(visit);return;}
 if(Object.hasOwn(x,'hash')){const{hash:expected,...body}=x;if(expected!==hash(body))throw Error('Canonical seal mismatch '+(x.event_id??x.routing_id??x.evidence_id??''));seals++;}
 if(x.target_id?.startsWith('target_')){const{target_id,...body}=x;if(target_id!=='target_'+hash(body))throw Error('Target ID mismatch');targets++;}
 for(const v of Object.values(x))visit(v);
}
for(const p of fs.readdirSync(root)){if(p.endsWith('.json'))visit(JSON.parse(fs.readFileSync(root+'/'+p,'utf8')));if(p.endsWith('.jsonl'))for(const s of fs.readFileSync(root+'/'+p,'utf8').split('\n').filter(Boolean))visit(JSON.parse(s));}
for(const dir of fs.readdirSync(root+'/journal'))for(const file of fs.readdirSync(root+'/journal/'+dir)){if(!file.endsWith('.json'))continue;const e=JSON.parse(fs.readFileSync(root+'/journal/'+dir+'/'+file,'utf8'));if(e.value_hash!==hash(e.value)||file!==e.key+'.json')throw Error('Journal integrity mismatch');visit(e.value);journals++;}
const result={status:'PASS',canonical_seals:seals,target_ids:targets,journal_envelopes:journals,original_governance_imports:0};fs.writeFileSync(root+'/independent-hashes.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
