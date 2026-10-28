/** Durable immutable activation records; no duplicate event append on retry. */
import {mkdirSync,readFileSync,existsSync,writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {canonicalHash,verify} from '../governance/common';
import type {Result} from './contracts';
export function persistActiveSet(root:string,result:Result,codeHash:string):{result:Result;reused:boolean} {
 verify(result);mkdirSync(root,{recursive:true});const key=canonicalHash({decision_date:result.decision_date,policy_id:result.policy_id,scope:result.scope}),path=root+'/'+key+'.json';
 const body={version:'bank01-immutable-record-1',code_hash:codeHash,value:result},envelope={...body,hash:canonicalHash(body)};
 if(existsSync(path)){const prior=JSON.parse(readFileSync(path,'utf8'));verify(prior);verify(prior.value);if(prior.hash!==envelope.hash)throw Error('Immutable BANK decision conflict/code mismatch');return{result:prior.value,reused:true};}
 const tmp=path+'.tmp-'+process.pid;try{writeFileSync(tmp,JSON.stringify(envelope,null,2)+'\n');try{linkSync(tmp,path);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;return persistActiveSet(root,result,codeHash);}}finally{if(existsSync(tmp))unlinkSync(tmp);}return{result,reused:false};
}
