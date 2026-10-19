/** Immutable content-checked journals, atomically published, no mutable history. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,linkSync,unlinkSync,readdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {canonicalHash,verify} from './common';
export class Journal {
 added=0;reused=0;
 constructor(readonly root:string,readonly codeHash:string,readonly scope:string){mkdirSync(root,{recursive:true});this.put('meta','manifest',{scope,codeHash},{scope,codeHash});this.added=0;this.reused=0;}
 put<T>(kind:string,businessKey:unknown,inputs:unknown,value:T):T{
  const key=canonicalHash(businessKey),path=this.root+'/'+kind+'/'+key+'.json',identity=canonicalHash({code:this.codeHash,scope:this.scope,inputs}),envelope={key,identity,value_hash:canonicalHash(value),value};
  if(existsSync(path)){const stored=JSON.parse(readFileSync(path,'utf8'));if(stored.key!==key||stored.identity!==identity||stored.value_hash!==canonicalHash(stored.value)||canonicalHash(stored.value)!==canonicalHash(value))throw Error('Immutable journal conflict/corruption: '+kind);this.reused++;return stored.value as T;}
  mkdirSync(dirname(path),{recursive:true});const tmp=path+'.tmp-'+process.pid;writeFileSync(tmp,JSON.stringify(envelope,null,2)+'\n');
  try{linkSync(tmp,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;unlinkSync(tmp);return this.put(kind,businessKey,inputs,value);}finally{if(existsSync(tmp))unlinkSync(tmp);}
  this.added++;return structuredClone(value);
 }
 values<T>(kind:string):T[]{const path=this.root+'/'+kind;if(!existsSync(path))return[];return readdirSync(path).filter(p=>p.endsWith('.json')).sort().map(p=>{const x=JSON.parse(readFileSync(path+'/'+p,'utf8'));if(x.value_hash!==canonicalHash(x.value))throw Error('Corrupt journal value');if(x.value&&'hash'in x.value)verify(x.value);return x.value as T;});}
}
