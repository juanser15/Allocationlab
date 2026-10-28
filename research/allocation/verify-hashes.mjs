// Independent serialization/checksum verifier; imports no ARE/allocator/gate code.
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
let checked=0;
for(const root of process.argv.slice(2)){
 const candidates=JSON.parse(readFileSync(root+'/candidates.json','utf8'));
 for(const c of candidates){if(c.candidate_id!=='are_'+hash(c.spec))throw Error('Candidate checksum mismatch');checked++;}
 const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.name.endsWith('.json')){const entry=JSON.parse(readFileSync(p,'utf8'));if(entry.value_hash!==hash(entry.value))throw Error('Value checksum mismatch '+p);if(entry.parts&&entry.key!==hash(entry.parts))throw Error('Cache key mismatch '+p);checked++;}}};
 walk(root+'/jobs');walk(root+'/cache');
}
console.log(JSON.stringify({status:'PASS',checks:checked,scope:'Independent native JSON serializer/SHA256; no original selection or engine calls'}));
