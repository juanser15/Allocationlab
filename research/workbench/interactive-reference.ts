/** Test/owner certification reference. Not a production route or client control.
 * Disables every cache and materializes full actual candidate/OOS ledgers. */
import {mkdirSync,writeFileSync}from'node:fs';
import {preparedDataset,normalizeInteractive}from'../../artifacts/api-server/src/lib/workbench/interactive-calendar';
import{runInteractive}from'./interactive-engine';
export function reference(request:unknown,directory:string){mkdirSync(directory,{recursive:true});let n=0;
 const data=preparedDataset(),spec=normalizeInteractive(request,data),progress:unknown[]=[];
 const result=runInteractive(spec,data,p=>progress.push(p),{disable_cache:true,audit:job=>{writeFileSync(`${directory}/job-${String(n++).padStart(5,'0')}.json`,JSON.stringify(job),{flag:'wx'})}});
 writeFileSync(`${directory}/result.json`,JSON.stringify(result),{flag:'wx'});return{result,progress,materialized_jobs:n};
}
/** Read the actual prior immutable result and its existing B3C sidecar for
 * cross-contract preservation checks. This function is test-only. */
export async function readPriorControls(root:string,id:string){
 const {WorkbenchRunStore}=require('../../artifacts/api-server/src/lib/workbench/run-store') as any;
 const {WorkbenchService}=require('../../artifacts/api-server/src/lib/workbench/service') as any;
 const {enrichExposureRun}=require('../../artifacts/api-server/src/lib/workbench/exposure-attribution') as any;
 const store=await WorkbenchRunStore.open({root});const reader=await WorkbenchService.open({store});return enrichExposureRun(await reader.getRun(id),store);
}
/** Fresh, committed-source legacy reference: no retained /tmp inputs required. */
export async function executePriorReference(request:unknown,directory:string){
 const {RecurringTurnoverService}=require('../../artifacts/api-server/src/lib/workbench/turnover-service') as any;
 const {enrichExposureRun}=require('../../artifacts/api-server/src/lib/workbench/exposure-attribution') as any;
 const previous=process.env.WORKBENCH_RUN_DIR;process.env.WORKBENCH_RUN_DIR=directory;
 try{const api=await RecurringTurnoverService.open();const receipt=await api.submit(request);
  for(let i=0;i<1200;i++){const run=await api.getRun(receipt.run_id);if(['SUCCESS','FAILED','BLOCKED'].includes(run.latest_status)){
   if(run.latest_status!=='SUCCESS')throw new Error('Prior certified reference did not complete');return enrichExposureRun(run,api.store);
  }await new Promise(r=>setTimeout(r,50))}
  throw new Error('Bounded prior-reference wait exceeded');
 }finally{if(previous===undefined)delete process.env.WORKBENCH_RUN_DIR;else process.env.WORKBENCH_RUN_DIR=previous}
}
export function originalCampaignReference(request:any,directory:string){
 const {campaignV2,parseSubmissionV2}=require('../../artifacts/api-server/src/lib/workbench/calendar-v2') as any;
 const {runCampaign}=require('./recurring-turnover-engine') as any;
 const {readFileSync,readdirSync,statSync}=require('node:fs') as typeof import('node:fs');
 const {turnover_constraint_methodology_version:_,...fields}=request;
 const legacy=parseSubmissionV2({...fields,contract_version:'workbench-research-run-spec-2.0.0'}),data=preparedDataset(),started=performance.now();
 const result=runCampaign(campaignV2(legacy,data),data.rows,directory,{maximum_jobs:2000});let files=0,bytes=0;
 const walk=(dir:string)=>{for(const n of readdirSync(dir)){const path=dir+'/'+n,info=statSync(path);if(info.isDirectory())walk(path);else{files++;bytes+=info.size}}};walk(directory);
 return{request:legacy,result,root:directory,elapsed_ms:performance.now()-started,files,bytes,progress:JSON.parse(readFileSync(directory+'/progress.json','utf8'))};
}
