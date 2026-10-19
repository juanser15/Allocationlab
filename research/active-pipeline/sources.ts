/** Read-only integrity adapter for BANK01 persisted certification artifacts.
 * Whole-file versions are immutable; future history belongs in a NEW snapshot.
 * Only the selected result and its matching entry metadata enter the decision. */
import {readFileSync,statSync} from 'node:fs';import {createHash} from 'node:crypto';
import {canonicalHash,validHash} from '../governance/common';import type {FrozenActiveSet} from './contracts';
const cache=new Map<string,unknown>();
function read(path:string,sha:string,mode:'RESULTS'|'INPUTS'):unknown {
 if(!validHash(sha)||!path.startsWith('reports/')||path.split('/').includes('..')||!path.endsWith('.json'))throw Error('INVALID_INPUT: frozen BANK source reference');
 const stat=statSync(path),key=JSON.stringify({path,sha,mode,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs});if(cache.has(key))return cache.get(key);
 const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('INVALID_INPUT: frozen BANK source SHA mismatch');
 const raw=JSON.parse(bytes.toString());if(!Array.isArray(raw))throw Error('INVALID_INPUT: expected versioned BANK01 certification row catalog');
 const result=mode==='RESULTS'?raw.map(r=>({fixture_id:r.fixture_id,input_index:r.input_index,result:r.result})):raw.map(r=>({fixture_id:r.fixture_id,entries:r.input.entries}));cache.set(key,result);return result;
}
export function verifyFrozenSource(a:FrozenActiveSet):void {
 const rows=read(a.source_path,a.source_sha256,'RESULTS') as Array<{fixture_id:string;input_index:number;result:FrozenActiveSet['artifact']}>;
 const found=rows.filter(r=>r.result.hash===a.artifact.hash);if(found.length!==1||canonicalHash(found[0].result)!==canonicalHash(a.artifact))throw Error('INVALID_INPUT: ActiveSet not present in frozen BANK source');
 const refs=a.bank_input_reference;if(!refs)throw Error('INVALID_INPUT: frozen BANK metadata reference required');
 const inputs=read(refs.path,refs.sha256,'INPUTS') as Array<{fixture_id:string;entries:FrozenActiveSet['bank_entries']}>;
 const original=inputs[found[0].input_index];if(!original||original.fixture_id!==found[0].fixture_id||canonicalHash(original.entries)!==canonicalHash(a.bank_entries))throw Error('INVALID_INPUT: bank metadata differs from frozen source');
}
