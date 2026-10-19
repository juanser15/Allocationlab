import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
export {canonicalHash};
function freeze<T>(x:T):T{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
export function seal<T extends object>(body:T):T&{hash:string}{return freeze({...structuredClone(body),hash:canonicalHash(body)});}
export function validHash(x:unknown):x is string{return typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);}
export function verify(x:{hash:string}):void{const{hash,...body}=x;if(!validHash(hash)||canonicalHash(body)!==hash)throw Error('Canonical hash mismatch');}
export function time(x:string):number{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x.slice(0,10))throw Error('Invalid UTC date '+x);return Date.parse(x);}
export const day=86400000;
export function available(x:{as_of:string;information_cutoff:string;provenance:{available_at:string}},asof:string,cutoff:string){return time(x.information_cutoff)<=time(cutoff)&&time(x.as_of)<=time(asof)&&time(x.provenance.available_at)<=time(cutoff);}
export function point(x:{as_of:string;information_cutoff:string;provenance:{data_hash:string;configuration_hash:string;source_ids:string[];available_at:string}}){
 if(time(x.information_cutoff)>time(x.as_of)||time(x.provenance.available_at)>time(x.as_of)||!validHash(x.provenance.data_hash)||!validHash(x.provenance.configuration_hash)||!x.provenance.source_ids.length||x.provenance.source_ids.some(s=>typeof s!=='string'||!s.trim()))throw Error('Invalid provenance/PIT metadata');
}
export function keys(x:object,allowed:string[]){if(Object.keys(x).some(k=>!allowed.includes(k)))throw Error('Unknown contract field');}
export function unique(items:string[],label:string){if(new Set(items).size!==items.length)throw Error('Duplicate '+label);}
export const within=(at:string,from:string,until:string|null)=>time(from)<=time(at)&&(until===null||time(at)<time(until));
