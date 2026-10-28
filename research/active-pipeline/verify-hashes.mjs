/** Independent canonical crypto checks; no pipeline/core hashing import. */
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const root='reports/pipe03';let checked=0,stages=0,targets=0;const failures=[];
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function scan(x,path){if(!x||typeof x!=='object')return;
 if(!Array.isArray(x)&&typeof x.hash==='string'&&/^[a-f0-9]{64}$/.test(x.hash)){const{hash,...body}=x;checked++;if(digest(body)!==hash)failures.push(path+':hash');}
 if(x.stage_id&&x.output_hash){const{stage_id,...body}=x;stages++;if(x.output_hash!==digest(x.output)||stage_id!==(x.sequence?'integration_stage_':'stage_')+digest(body))failures.push(path+':stage');}
 if(x.target_id&&x.final_asset_weights){const{target_id,...body}=x;targets++;if(target_id!=='target_'+digest(body))failures.push(path+':target');}
 for(const[k,v]of Object.entries(x))scan(v,path+'.'+k);
}
function dir(p){for(const n of readdirSync(p)){const f=p+'/'+n;if(statSync(f).isDirectory()){if(!n.startsWith('pre-'))dir(f);}else if(n.endsWith('.json'))scan(JSON.parse(readFileSync(f,'utf8')),f);}}
dir(root);const m=JSON.parse(readFileSync(root+'/manifest.json','utf8'));for(const[p,h]of Object.entries({...m.source,...m.dependencies})){const found=createHash('sha256').update(readFileSync(p)).digest('hex');if(found!==h)failures.push('changed source '+p);}
const result={status:failures.length?'FAIL':'PASS',canonical_records:checked,stage_checks:stages,target_checks:targets,source_files:Object.keys(m.source).length,dependency_files:Object.keys(m.dependencies).length,failures};writeFileSync(root+'/hash-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=failures.length?1:0;
