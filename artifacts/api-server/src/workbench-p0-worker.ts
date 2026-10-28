import {loadP0Dataset,normalizeP0WithData,p0RunId,planP0WithData,engineRequest,requestFromP0Spec} from './lib/workbench/p0-calendar';
import { canonicalJson } from './lib/workbench/identity';
const {runInstitutional}=require('../../../research/coordinated/institutional') as {runInstitutional:(...args:any[])=>any};
process.on('disconnect',()=>process.exit(0));
let busy=false;
process.on('message',async(message:any)=>{
 if(!message||message.type!=='EXECUTE'||typeof message.run_id!=='string'||busy)return;
 busy=true;
 try {
  const t=performance.now(),data=await loadP0Dataset(message.request?.dataset_id),spec=normalizeP0WithData(message.request,data);
  if(p0RunId(spec)!==message.run_id)throw Object.assign(new Error('The requested immutable dataset or execution identity differs from this worker.'),{code:'DATASET_UNAVAILABLE'});
  const plan=planP0WithData(message.request,data);
  // Financial code receives the persisted rows explicitly. The legacy local
  // parser identifier is never used to resolve another payload.
  const result=runInstitutional(spec,data,(progress:unknown)=>process.send?.({type:'PROGRESS',run_id:message.run_id,progress}));
  if(canonicalJson(result.plan.folds)!==canonicalJson(plan.folds))throw new Error('Persistent plan and actual engine fold geometry differ');
  result.plan=plan;Object.assign(result,data.binding);result.execution_profile.worker_wall_ms=performance.now()-t;
  if(Buffer.byteLength(JSON.stringify(result))>message.max_output_bytes)throw Object.assign(new Error('Compact output exceeded the configured size limit'),{code:'OUTPUT_OR_LOG_LIMIT'});
  process.send?.({type:'RESULT',run_id:message.run_id,result});
 }catch(error){const e=error as any;process.send?.({type:'FAILURE',run_id:message.run_id,code:e.code??'INTERACTIVE_WORKER_FAILURE',safe_message:e.code?e.message:'The research worker could not complete this attempt.',details:e.details??{},private_diagnostic:String(e.stack??e).slice(0,65536)})}finally{busy=false;}
});
