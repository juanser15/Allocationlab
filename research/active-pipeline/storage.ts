/** Durable integration decisions. Resume validates selected PIT inputs and the
 * observable router view before reuse, without invoking the allocator again. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {canonicalHash,seal,verify,time} from '../governance/common';
import {prepare} from './projection';import {runIntegration,routing} from './engine';
import type {Request,Result,Prepared} from './contracts';
export function executeDurable(root:string,r:Request,codeHash:string):{result:Result;reused:boolean;pipeline_runs:number}{
 mkdirSync(root,{recursive:true});const key=canonicalHash({request_id:r.request_id,decision_date:r.decision_date}),file=root+'/'+key+'.json';
 let p:Prepared|null=null,error:string|null=null;try{p=prepare(r);}catch(e){error=String(e);}
 const identity=p?.identity??canonicalHash({request_id:r.request_id,decision:r.decision_date,cutoff:r.information_cutoff,active_set_hash:r.active_set_hash,error,source_candidate:r.source_candidate,bundle_template:r.bundle_template,visible_snapshots:r.strategy_snapshots.filter(x=>time(x.as_of)<=time(r.decision_date)&&time(x.information_cutoff)<=time(r.information_cutoff)&&time(x.provenance.data_available_at)<=time(r.information_cutoff)),visible_active_sets:r.active_sets.filter(x=>time(x.available_at)<=time(r.decision_date)&&x.artifact.decision_date===r.decision_date&&x.artifact.information_cutoff===r.information_cutoff)});
 if(existsSync(file)){
  const old=JSON.parse(readFileSync(file,'utf8'));verify(old);verify(old.result);if(old.code_hash!==codeHash||old.input_identity!==identity)throw Error('Immutable integration input/code conflict');
  const rr=routing(r,old.result,p);if(canonicalHash(rr.record)!==canonicalHash(old.result.routing))throw Error('Immutable routing view conflict');return{result:old.result,reused:true,pipeline_runs:0};
 }
 const result=runIntegration(r,p??undefined),record=seal({key,code_hash:codeHash,input_identity:identity,result}),tmp=file+'.tmp-'+process.pid;
 try{writeFileSync(tmp,JSON.stringify(record,null,2)+'\n');try{linkSync(tmp,file);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;return executeDurable(root,r,codeHash);}}finally{if(existsSync(tmp))unlinkSync(tmp);}
 return{result,reused:false,pipeline_runs:result.pipeline?1:0};
}
