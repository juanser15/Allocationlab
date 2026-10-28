import {fork,type ChildProcess} from "node:child_process";
import {fileURLToPath} from "node:url";
import {WorkbenchRunStore,DEFAULT_STORE_LIMITS,type AttemptRef} from "./run-store";
import {readExecutionCapacity} from "./execution-capacity";
import {normalizeInteractive,interactiveRunId,planInteractive,parseInteractive,INTERACTIVE_SPEC,preparedDataset,type InteractiveSpec,type InteractiveRequest} from "./interactive-calendar";
import {boundaryV2,CalendarContractError} from "./calendar-v2";
import {canonicalJson} from "./identity";
// The financial engine lives outside the API package, using its existing typed
// fixed-module convention. Results cross a fixed, size-bounded IPC boundary.
type CompactResult=any;
export class InteractiveService {
 private worker?:ChildProcess; private progress=new Map<string,any>();
 private constructor(readonly store:WorkbenchRunStore){}
 static async open(){const c=readExecutionCapacity();return new InteractiveService(await WorkbenchRunStore.open({limits:{maxMetadataBytes:Math.max(DEFAULT_STORE_LIMITS.maxEngineOutputBytes,c.max_output_bytes),maxEngineOutputBytes:c.max_output_bytes,maxEngineFiles:c.max_engine_files}}))}
 async submit(value:unknown){const spec=normalizeInteractive(value),id=interactiveRunId(spec);return this.store.withSubmissionLock(async()=>{
  await this.store.ensureRun(id,spec);const run=await this.store.getRun(id);const existing=[...run.attempt_history].reverse().find(a=>["RUNNING","PENDING"].includes(a.status))??run.latest_successful_attempt??run.latest_attempt;
  if(existing)return {...boundaryV2,run_id:id,execution_attempt_id:existing.attempt.execution_attempt_id,status:existing.status,reused_existing_attempt:true,execution_requested:false};
  return this.start(id,spec,"SUBMIT");
 })}
 async rerun(id:string){return this.store.withSubmissionLock(async()=>{const run=await this.store.getRun(id),stored=run.normalized_spec as InteractiveSpec;
  const request=this.request(stored),spec=normalizeInteractive(request);if(interactiveRunId(spec)!==id)throw new CalendarContractError("RUN_IDENTITY_MISMATCH","The engine or data changed. Duplicate the configuration to create a new experiment.",{},409);
  return this.start(id,spec,"RERUN");
 })}
 private request(spec:InteractiveSpec):InteractiveRequest{const keys=Object.keys(planInteractive(parseInteractiveSpec(spec)).normalized_request);return parseInteractive(Object.fromEntries(keys.map(k=>[k,(spec as any)[k]])))}
 private async start(id:string,spec:InteractiveSpec,source:"SUBMIT"|"RERUN"){
  const c=readExecutionCapacity(),active=await this.store.inspectExecutionLease();
  if(active)throw new CalendarContractError("BLOCKED_EXECUTION_CAPACITY","Another empirical run is using the available research worker.",{active_run_id:active.run_id,owner_recovery_requirement:"If the worker was abandoned after a crash, the preview owner must inspect and recover the lease. There is no automatic lease clearing."},429);
  const attempt=await this.store.createAttempt(id,{source}),ref={runId:id,executionAttemptId:attempt.attempt.execution_attempt_id};
  const lease=await this.store.acquireExecutionLease(ref,c.timeout_ms);
  if(!lease.acquired){await this.store.completeBlocked(ref,{code:"BLOCKED_EXECUTION_CAPACITY",explanation:"Another research execution holds the worker."});return {...boundaryV2,run_id:id,execution_attempt_id:ref.executionAttemptId,status:"BLOCKED",reused_existing_attempt:false,execution_requested:false}}
  await this.store.markRunning(ref,{stage:"PREPARING_DATA"});
  const plan=planInteractive(this.request(spec));
  this.progress.set(ref.executionAttemptId,{status:"RUNNING",stage:"Preparing data",completed_work_units:0,total_work_units:plan.total_work_units,percent_complete:0,current_fold:0,total_folds:plan.number_of_folds,completed_candidates:0,total_candidates:5*plan.number_of_folds,elapsed_ms:0,estimated_remaining_ms:null,eta_confidence:"ESTIMATING"});
  void this.execute(ref,spec,lease.lease.token).catch(()=>{});
  return {...boundaryV2,run_id:id,execution_attempt_id:ref.executionAttemptId,status:"RUNNING",reused_existing_attempt:false,execution_requested:true};
 }
 private createWorker(){
  const worker=fork(fileURLToPath(new URL("./workbench-interactive-worker.mjs",import.meta.url)),[],{stdio:["ignore","pipe","pipe","ipc"],execArgv:["--max-old-space-size=768"]});
  const stop=()=>worker.kill("SIGTERM");process.once("SIGTERM",stop);process.once("SIGINT",stop);
  worker.once("exit",()=>{if(this.worker===worker)this.worker=undefined;process.removeListener("SIGTERM",stop);process.removeListener("SIGINT",stop)});
  return worker;
 }
 private async execute(ref:AttemptRef,spec:InteractiveSpec,lease:string){
  const c=readExecutionCapacity(),started=Date.now();let logs="";
  try{
   const result=await new Promise<CompactResult>((resolve,reject)=>{
    const worker=this.worker??=this.createWorker();
    let done=false;
    const clean=()=>{clearTimeout(timer);worker.off("message",message);worker.off("error",failure);worker.off("exit",exit);worker.stdout?.off("data",log);worker.stderr?.off("data",log)};
    const failure=(e:unknown)=>{if(done)return;done=true;clean();reject(e)};
    const log=(chunk:Buffer)=>{logs+=chunk.toString();if(Buffer.byteLength(logs)>this.store.limits.maxLogBytes){this.worker=undefined;worker.kill("SIGKILL");failure(Object.assign(new Error("Worker log limit exceeded"),{code:"OUTPUT_OR_LOG_LIMIT"}))}};
    const exit=(code:number|null,signal:NodeJS.Signals|null)=>{this.worker=undefined;failure(Object.assign(new Error("Worker exited before publishing a result"),{code:"INTERACTIVE_WORKER_FAILURE",private_diagnostic:{exit_code:code,signal}}))};
    const message=(m:any)=>{if(m.run_id!==ref.runId)return;if(m.type==="PROGRESS"){
     const previous=this.progress.get(ref.executionAttemptId);if(m.progress.completed_work_units>=previous.completed_work_units&&m.progress.completed_work_units<=previous.total_work_units)this.progress.set(ref.executionAttemptId,m.progress);
    }else if(m.type==="RESULT"){
     if(Buffer.byteLength(JSON.stringify(m.result))>c.max_output_bytes){failure(Object.assign(new Error("Output exceeded the configured bound"),{code:"OUTPUT_OR_LOG_LIMIT"}));return}
     if(done)return;done=true;clean();resolve(m.result);
    }else if(m.type==="FAILURE")failure(Object.assign(new Error(m.safe_message),{code:m.code,details:m.details,private_diagnostic:m.private_diagnostic}))};
    const timer=setTimeout(()=>{this.worker=undefined;worker.kill("SIGKILL");failure(Object.assign(new Error("This attempt reached the current execution time limit."),{code:"EXECUTION_TIMEOUT"}))},c.timeout_ms);
    worker.on("message",message);worker.once("error",failure);worker.once("exit",exit);worker.stdout?.on("data",log);worker.stderr?.on("data",log);
    worker.send({type:"EXECUTE",request:this.request(spec),run_id:ref.runId,max_output_bytes:c.max_output_bytes},e=>{if(e)failure(e)});
   });
   const expected=planInteractive(this.request(spec));if(result.plan.plan_hash!==expected.plan_hash)throw new Error("Worker plan mismatch");
   const final={...boundaryV2,...result,run_id:ref.runId,execution_attempt_id:ref.executionAttemptId,execution_kind:"INTERACTIVE_RESEARCH",storage_policy:"TEMPORARY_RESEARCH_STORAGE",certification_status:"NOT_CERTIFIED",turnover_constraint_methodology_version:spec.turnover_constraint_methodology_version,provenance:{code_version:spec.code_version,runtime_versions:spec.runtime_versions,engine_version:spec.engine_version,certified_engine_commit:spec.certified_engine_commit,data_snapshot:spec.data_snapshot,calendar_methodology:spec.calendar_methodology,turnover_constraint_methodology_version:spec.turnover_constraint_methodology_version},runtime_progress:this.progress.get(ref.executionAttemptId),started_at:new Date(started).toISOString(),completed_at:new Date().toISOString()};
   if(Buffer.byteLength(JSON.stringify(final))>c.max_output_bytes)throw Object.assign(new Error("The complete result exceeded the current output-size limit."),{code:"OUTPUT_OR_LOG_LIMIT"});
   await this.store.completeSuccess(ref,final,{stage:"RESULTS_READY"});
  }catch(error){const e=error as any;const code=typeof e.code==="string"&&/^[A-Z_]+$/.test(e.code)?e.code:"INTERACTIVE_WORKER_FAILURE";
   const known=["NO_VALID_CANDIDATE","INSUFFICIENT_SELECTION_HISTORY","EXECUTION_ACCOUNTING_FAILURE","OUTPUT_OR_LOG_LIMIT","EXECUTION_TIMEOUT"].includes(code);
   const details=known&&e.details&&typeof e.details==="object"?e.details:{};
   const failure={...boundaryV2,status:"FAILED",run_id:ref.runId,execution_attempt_id:ref.executionAttemptId,error_class:code,safe_message:known?e.message:"The research worker could not complete this attempt.",actionable_explanation:code==="NO_VALID_CANDIDATE"?"The model could not select a policy under its existing constraints. No inputs were changed.":"No inputs were changed and no result was substituted.",suggested_user_action:["OUTPUT_OR_LOG_LIMIT","EXECUTION_TIMEOUT"].includes(code)?"Ask the preview owner to review current execution capacity before explicitly rerunning.":known?"Review the design and the technical evidence before explicitly rerunning.":"Ask the preview owner to inspect the private diagnostic before rerunning.",failed_fold_id:details.fold_id??null,failed_decision_date:details.decision_date??null,failed_stage:this.progress.get(ref.executionAttemptId)?.stage??"PREPARING_DATA",diagnostic_reference:"PRIVATE_ATTEMPT_DIAGNOSTIC",technical_details:details};
   await this.store.completeFailure(ref,{errorClass:code,safeMessage:failure.safe_message,result:failure,diagnostic:{detail:String(e.stack??e).slice(0,65536),worker:e.private_diagnostic??null,details,logs:logs.slice(0,65536)},stage:failure.failed_stage});
   this.progress.set(ref.executionAttemptId,{...this.progress.get(ref.executionAttemptId),status:"FAILED",stage:failure.failed_stage,elapsed_ms:Date.now()-started,estimated_remaining_ms:null});
  }finally{this.progress.delete(ref.executionAttemptId);await this.store.releaseExecutionLease(lease)}
 }
 async get(id:string){const run=await this.store.getRun(id);if((run.normalized_spec as any).contract_version!==INTERACTIVE_SPEC)throw new CalendarContractError("UNSUPPORTED_RUN_VERSION","This run belongs to the prior certification contract.",{},409);
  const latest=run.latest_attempt,success=run.latest_successful_attempt;
  const result=latest&&["SUCCESS","FAILED","BLOCKED"].includes(latest.status)?await this.store.readAttemptResult({runId:id,executionAttemptId:latest.attempt.execution_attempt_id}):null;
  const good=success?latest===success?result:await this.store.readResult({runId:id,executionAttemptId:success.attempt.execution_attempt_id}):null;
  let progress=latest?this.progress.get(latest.attempt.execution_attempt_id)??(result as any)?.runtime_progress??null:null;
  if(progress&&latest){progress={...progress,status:latest.status};if(latest.status==="RUNNING"){
   const elapsed=Math.max(progress.elapsed_ms,Date.now()-Date.parse(latest.started_at??latest.attempt.requested_at));
   progress={...progress,elapsed_ms:elapsed,estimated_remaining_ms:progress.completed_work_units>1?Math.max(0,(progress.total_work_units-progress.completed_work_units)*elapsed/progress.completed_work_units):null};
  }}
  return {...boundaryV2,run_id:id,spec:run.normalized_spec,created_at:run.run.created_at,latest_status:run.latest_status,latest_attempt:latest,attempt_history:run.attempt_history,latest_result:result,latest_successful_result:good,progress};
 }
 async list(){const runs=(await this.store.listRuns()).filter(r=>(r.normalized_spec as any).contract_version===INTERACTIVE_SPEC);return {...boundaryV2,runs:await Promise.all(runs.map(async r=>{const success=r.latest_successful_attempt;const result:any=success?await this.store.readResult({runId:r.run.run_id,executionAttemptId:success.attempt.execution_attempt_id}):null;return {run_id:r.run.run_id,created_at:r.run.created_at,spec:r.normalized_spec,status:r.latest_status,latest_attempt:r.latest_attempt,metrics:result?.metrics??"NOT_SUPPORTED",fold_count:result?.plan.number_of_folds??null}}))}}
 async compare(ids:unknown){
  if(!Array.isArray(ids)||ids.length<2||ids.length>100||new Set(ids).size!==ids.length||ids.some(x=>typeof x!=="string"))throw new CalendarContractError("INVALID_COMPARISON","Select between 2 and 100 distinct successful runs.");
  // Project each record sequentially; do not retain 100 complete candidate-audit
  // payloads just to compare their curves. The response has its own size bound.
  const runs:any[]=[];let bytes=1024;const limit=readExecutionCapacity().max_output_bytes;
  for(const id of ids){const r=await this.get(id),x:any=r.latest_successful_result;
   if(!x)throw new CalendarContractError("COMPARISON_NOT_AVAILABLE","Every selected experiment needs a successful immutable attempt.",{},409);
   const item={run_id:r.run_id,execution_attempt_id:x.execution_attempt_id,latest_status:r.latest_status,comparison_attempt_status:"SUCCESS",spec:r.spec,metrics:x.metrics,turnover:x.turnover.DYNAMIC_EXPOSURE,fold_count:x.plan.number_of_folds,points:x.benchmark_tracks.DYNAMIC_EXPOSURE,financial_result_hash:x.financial_result_hash};
   bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>limit)throw new CalendarContractError("COMPARISON_CAPACITY_EXCEEDED","This comparison exceeds current interactive response capacity. Select fewer runs.",{requested_runs:ids.length,maximum_output_bytes:limit},413);runs.push(item);
  }
  const fields=["evaluation_start","evaluation_end_exclusive","window_type","training_window_months","rebalance_frequency","transaction_cost_bps","selection_cost_bps","turnover_constraint_methodology_version","engine_version","code_version","runtime_versions"];
  const matrix=fields.map(field=>({field,values:runs.map(r=>({run_id:r.run_id,value:r.spec[field]??"NOT_RECORDED"})),differs:new Set(runs.map(r=>canonicalJson(r.spec[field]??"NOT_RECORDED"))).size>1}));
  const warnings=[];if(matrix.some(x=>x.differs&&x.field.startsWith("evaluation_")))warnings.push("Evaluation periods differ. Overlay dates and independent sleeve boundaries need careful interpretation.");if(matrix.some(x=>x.differs&&x.field==="turnover_constraint_methodology_version"))warnings.push("TURNOVER_METHODOLOGY_DIFFERS");
  if(matrix.some(x=>x.differs&&["engine_version","code_version","runtime_versions"].includes(x.field)))warnings.push("Calculation versions differ. Implementation differences may affect comparability; inspect the calculation versions in technical details.");
  if(runs.some(r=>r.latest_status!=="SUCCESS"))warnings.push("A selected experiment has a newer unfinished or unsuccessful attempt. This comparison uses its latest successful immutable result; the newer attempt remains visible in history.");
  const output={...boundaryV2,calculation:"READ_ONLY_NO_RECALCULATION",configuration_matrix:matrix,warnings,display_curve_limit:8,runs};
  if(Buffer.byteLength(JSON.stringify(output))>limit)throw new CalendarContractError("COMPARISON_CAPACITY_EXCEEDED","This comparison exceeds current interactive response capacity. Select fewer runs.",{requested_runs:ids.length,maximum_output_bytes:limit},413);
  return output;
 }
 async close(){this.worker?.kill("SIGTERM");this.worker=undefined}
}
function parseInteractiveSpec(spec:InteractiveSpec){const {contract_version,research_mode,execution_scope,universe,validation_protocol,evaluation_start,evaluation_end_exclusive,window_type,training_window_months,rebalance_frequency,transaction_cost_bps,selection_cost_bps,turnover_constraint_methodology_version}=spec;return {contract_version,research_mode,execution_scope,universe,validation_protocol,evaluation_start,evaluation_end_exclusive,window_type,training_window_months,rebalance_frequency,transaction_cost_bps,selection_cost_bps,turnover_constraint_methodology_version}}
