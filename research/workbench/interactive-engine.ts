/** Compact orchestration over the unchanged certified close-fill arithmetic,
 * registry, selection, turnover and AL-02/control calculations. */
import assert from "node:assert/strict";
import {deflateSync,inflateSync} from "node:zlib";
import { computeRegime,defaultBacktestConfig,type PriceRow,type BacktestLedgerEntry } from "../../artifacts/api-server/src/lib/calculator";
import {defaultRegistry,modelSpec} from "../capital/registry";
import {hash,type Campaign,type Candidate} from "../capital/spec";
import {summarize,type Observation,type Ranked} from "../capital/metrics";
import {selectRecurring,ledgerTurnover} from "./turnover-selection";
import {generateInteractiveCandidates as generateCandidates} from "./interactive-candidates";
import {runScheduledLedger} from "./interactive-ledger";
import {planInteractive,parseInteractive,lowerBound,anchoredMonth,type InteractiveSpec,type InteractiveFold} from "../../artifacts/api-server/src/lib/workbench/interactive-calendar";
import {interactiveRiskMetrics} from "../../artifacts/api-server/src/lib/workbench/interactive-risk";
import {controlTrack,matchBeta,AttributionError,BENCHMARK_METHODOLOGY_VERSION,type ControlDay} from "../../artifacts/api-server/src/lib/workbench/exposure-controls";
import type {DatasetV2} from "../../artifacts/api-server/src/lib/workbench/calendar-v2";
export interface ResearchProgress {status:string;stage:string;completed_work_units:number;total_work_units:number;percent_complete:number;current_fold:number;total_folds:number;completed_candidates:number;total_candidates:number;elapsed_ms:number;estimated_remaining_ms:number|null;eta_confidence:"ESTIMATING"|"LOW"|"OBSERVED";}
export class InteractiveExecutionError extends Error {constructor(readonly code:string,message:string,readonly details:Record<string,unknown>={}){super(message)}}
// Bounded process-local caches. Keys bind snapshot, source, every actual calendar,
// candidate, costs and independent-book initial state. No cross-cutoff cache keys.
class BoundedCache<T>{private entries=new Map<string,{value:T;bytes:number}>();private bytes=0;constructor(readonly maxEntries:number,readonly maxBytes:number){} get(k:string){return this.entries.get(k)?.value}set(k:string,value:T){const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>this.maxBytes)return;while(this.entries.size>=this.maxEntries||this.bytes+bytes>this.maxBytes){const key=this.entries.keys().next().value;if(!key)break;this.bytes-=this.entries.get(key)!.bytes;this.entries.delete(key)}this.entries.set(k,{value,bytes});this.bytes+=bytes}clear(){this.entries.clear();this.bytes=0}}
/** Lossless serialization keeps full actual books cacheable across long training
 * windows. Financial values are restored with an exact JSON number round trip;
 * compressed bytes are never a financial hash input. */
class LedgerCache {
 private entries=new Map<string,Buffer>();private bytes=0;
 constructor(readonly maxEntries:number,readonly maxBytes:number){}
 get(key:string){const bytes=this.entries.get(key);return bytes?JSON.parse(inflateSync(bytes).toString("utf8")):undefined}
 set(key:string,value:unknown){const bytes=deflateSync(Buffer.from(JSON.stringify(value)),{level:1});if(bytes.length>this.maxBytes)return;
  while(this.entries.size>=this.maxEntries||this.bytes+bytes.length>this.maxBytes){const first=this.entries.keys().next().value;if(!first)break;this.bytes-=this.entries.get(first)!.length;this.entries.delete(first)}
  this.entries.set(key,bytes);this.bytes+=bytes.length;
 }
 statistics(){return {entries:this.entries.size,compressed_bytes:this.bytes,capacity_bytes:this.maxBytes,serialization:"LOSSLESS_JSON_DEFLATE_LEVEL_1"}}
 clear(){this.entries.clear();this.bytes=0}
}
const predictions=new BoundedCache<any>(1024,16*1024*1024),logs=new BoundedCache<ReturnType<typeof computeRegime>>(1024,8*1024*1024),jobs=new LedgerCache(1024,96*1024*1024),riskMetricsCache=new BoundedCache<any>(32,8*1024*1024);
export function clearInteractiveCaches(){predictions.clear();logs.clear();jobs.clear();riskMetricsCache.clear()}
export function runInteractive(spec:InteractiveSpec,data:DatasetV2,onProgress:(p:ResearchProgress)=>void=()=>{},options:{disable_cache?:boolean;audit?:(job:unknown)=>void}={}){
 const started=performance.now(),profile:Record<string,number>={},cache={candidate_hits:0,candidate_misses:0,prediction_hits:0,prediction_misses:0};
 const timed=<T>(name:string,fn:()=>T):T=>{const t=performance.now();try{return fn()}finally{profile[name]=(profile[name]??0)+performance.now()-t}};
 const request=parseInteractive(Object.fromEntries(Object.keys(planInteractiveRequestFields).map(k=>[k,(spec as any)[k]])));
 const plan=timed("planning",()=>planInteractive(request,data)),registry=defaultRegistry(),rows=data.rows;
 const step=request.rebalance_frequency==="MONTHLY"?1:3;
 const campaign:Campaign={...structuredClone(data.fixture),experiment_id:"interactive-capital",selection_metric:"net_sharpe",dates:{start:plan.folds[0].training_start,end_exclusive:request.evaluation_end_exclusive},train_months:request.training_window_months,test_months:step,step_months:step,window_type:request.window_type==="ROLLING"?"rolling":"expanding",rebalance_frequency:step===1?"monthly":"quarterly",recalibration_frequency:step===1?"monthly":"quarterly",transaction_cost_bps:[...new Set([request.selection_cost_bps,request.transaction_cost_bps])],selection_cost_bps:request.selection_cost_bps};
 const candidates=generateCandidates(campaign).candidates;
 assert.equal(candidates.length,5,"Fixed model candidate definition");
 let completed=0,foldNumber=0,completedCandidates=0;
 const progress=(stage:string,increment=0)=>{completed+=increment;const elapsed=performance.now()-started,remaining=completed>1?(plan.total_work_units-completed)*elapsed/completed:null;onProgress({status:completed===plan.total_work_units?"SUCCESS":"RUNNING",stage,completed_work_units:completed,total_work_units:plan.total_work_units,percent_complete:100*completed/plan.total_work_units,current_fold:foldNumber,total_folds:plan.number_of_folds,completed_candidates:completedCandidates,total_candidates:plan.number_of_folds*candidates.length,elapsed_ms:elapsed,estimated_remaining_ms:remaining===null?null:Math.max(0,remaining),eta_confidence:remaining===null?"ESTIMATING":completed<5?"LOW":"OBSERVED"})};
 progress("Preparing data",1);
 const byDate=new Map(rows.map((r,i)=>[r.date,i]));
 const selectedJobs:any[]=[],selectionEvidence:any[]=[],allObservations:Array<Observation&{fold_id:number}>=[];
 const cacheBinding=data.snapshot.sha256+":"+spec.code_version;
 function execute(candidate:Candidate,fold:InteractiveFold,stage:"train"|"outer",cost:number){
  const start=stage==="train"?fold.training_start:fold.oos_start,end=stage==="train"?fold.training_end_exclusive:fold.oos_end_exclusive;
  const signalDates:string[]=[];if(stage==="outer")signalDates.push(fold.decision_date);else for(let n=0;;n++){
   const intended=anchoredMonth(start,n*step);if(intended>=end)break;const i=lowerBound(rows,intended);if(i<rows.length&&rows[i].date<end&&!signalDates.includes(rows[i].date))signalDates.push(rows[i].date);
  }
  const key=hash({binding:cacheBinding,candidate:candidate.spec,start,end,signalDates,cost,initial_nav:100,initial_cash:100,cash_yield:campaign.cash_yield,execution:"next_close",stage,fit_end:stage==="outer"?fold.training_end_exclusive:null});
  let result=options.disable_cache?undefined:jobs.get(key);
  if(result){cache.candidate_hits++;options.audit?.({...result,outer_fold:fold.fold_id,stage});return {...result,outer_fold:fold.fold_id,stage}}
  cache.candidate_misses++;
  const targets:any[]=[];
  const engine=timed("ledger_and_targets",()=>runScheduledLedger(rows.slice(0,lowerBound(rows,end)),
   [{ticker:"SPY",name:"SPY",sector:"Fixed risk sleeve",enabled:true,priorWeight:0}],
   {cashMin:0,cashMax:1,maxEtfWeight:1,minEtfWeight:0,minInclusionThreshold:0,targetActiveEtfs:1,diversificationEnabled:false},
   {...defaultBacktestConfig(),rebalanceFrequency:campaign.rebalance_frequency,executionTiming:"next_close",warmupDays:campaign.warmup_rows,startDate:start,transactionCostBps:cost,slippageBps:0,maxTurnoverPerRebalance:1,cashYieldAnnual:0},null,undefined,
   (signalDate,available,ctx)=>{
    assert.ok(ctx&&available.every(r=>r.date<signalDate)&&available.at(-1)!.date===ctx.asOf,"PIT prior information only");
    const model=registry.models.get(candidate.spec.model_family)!;registry.validate(candidate.spec);
    const history=available.slice(-Number(candidate.spec.model_parameters.lookback_rows??252)).map(r=>({date:r.date,prices:Object.fromEntries(candidate.spec.input_set.map(t=>[t,r.prices[t]]))}));
    const predictionKey=hash({binding:cacheBinding,as_of:ctx!.asOf,model:candidate.spec.model_family,parameters:candidate.spec.model_parameters,inputs:candidate.spec.input_set,transformations:candidate.spec.transformations});
    let prediction=options.disable_cache?undefined:predictions.get(predictionKey);
    if(!prediction){cache.prediction_misses++;prediction=timed("regime_calculation",()=>model.predict(modelSpec(candidate.spec),model.fit(modelSpec(candidate.spec),{rows:[],input_set:candidate.spec.input_set,training_start:fold.training_start,training_end:fold.training_end_exclusive,information_cutoff:ctx!.asOf}),{history,input_set:candidate.spec.input_set,information_cutoff:ctx!.asOf}));if(!options.disable_cache)predictions.set(predictionKey,prediction)}else cache.prediction_hits++;
    const risk=registry.policies.get(candidate.spec.exposure_policy)!.map(prediction,candidate.spec.exposure_parameters);
    assert.ok(Number.isFinite(risk)&&risk>=0&&risk<=1);
    targets.push({signalDate,information_cutoff:ctx!.asOf,fit_information_cutoff:stage==="outer"?fold.information_cutoff:ctx!.asOf,risk_target:risk,cash_target:1-risk,output:prediction});return {SPY:risk};
   },{initialNav:100,initialCash:100,initialHoldings:{},dailyCashYield:campaign.cash_yield.daily,allowShortPositions:false,d5GrossTradeCosts:true},signalDates,
   history=>{const key=cacheBinding+":"+history.at(-1)!.date;let value=options.disable_cache?undefined:logs.get(key);if(!value){value=timed("display_regime",()=>computeRegime(history,["SPY"]));if(!options.disable_cache)logs.set(key,value)}return value}));
  if(!engine.hasSufficientData){const reason=engine.insufficientReason??"No valid certified ledger";const history=/Not enough trading days|Need at least|No rebalance/.test(reason);
   throw new InteractiveExecutionError(history?"INSUFFICIENT_SELECTION_HISTORY":"EXECUTION_ACCOUNTING_FAILURE",history?"The training interval cannot support the current selection calculation.":"The certified ledger could not produce a valid self-financing path at these inputs.",{fold_id:fold.fold_id,decision_date:fold.decision_date,training_observations:fold.training_observations,engine_reason:reason,transaction_cost_bps:cost});}
  const ledger=engine.dailyLedger.filter(d=>d.date>=start&&d.date<end);
  const observations=ledger.map(day=>{
   const actual=day.trades.reduce((s,t)=>s+Math.abs(t.notional),0);
   assert.ok(Math.abs(day.transactionCosts-actual*cost/10000)<1e-8);
   assert.ok(Math.abs(day.beginningNav+day.etfPnl+day.cashPnl-day.transactionCosts-day.slippage-day.endingNav)<1e-8);
   return {date:day.date,net_return:day.netPnl/day.beginningNav,turnover:actual/(day.beginningNav+day.etfPnl+day.cashPnl),costs:day.transactionCosts,exposure:day.beginningPositions.reduce((s,p)=>s+p.marketValue,0)/day.beginningNav};
  });
  const metrics=timed("metrics",()=>summarize(observations,campaign.cash_yield.reference_daily));
  result={candidate_id:candidate.candidate_id,outer_fold:fold.fold_id,stage,scenario:cost,status:"VALID",observations,metrics,ledger,targets,job_hash:key,result_hash:hash({observations,metrics,targets,ledger})};
  if(!options.disable_cache)jobs.set(key,result);options.audit?.(result);return result;
 }
 for(const fold of plan.folds){
  foldNumber=fold.fold_id+1;progress("Evaluating candidates");
  const training=candidates.map(candidate=>{const job=execute(candidate,fold,"train",request.selection_cost_bps);completedCandidates++;progress("Evaluating candidates",1);return job});
  const ranked:Ranked[]=candidates.map((candidate,i)=>({candidate,status:training[i].status,metrics:training[i].metrics,complexity:Object.keys(candidate.spec.model_parameters).length+candidate.spec.transformations.length+Object.keys(candidate.spec.exposure_parameters).length}));
  const selection=timed("selection",()=>selectRecurring(campaign,ranked,training,fold.fold_id));
  if(!selection.winner)throw new InteractiveExecutionError("NO_VALID_CANDIDATE","No exposure policy satisfied the research constraints in this training period.",{fold_id:fold.fold_id,decision_date:fold.decision_date,candidates:selection.ranking.map(c=>({candidate_id:c.candidate.candidate_id,status:c.status,reason:c.reason??null,metrics:c.metrics??null,turnover:selection.turnover_evidence[c.candidate.candidate_id]??null}))});
  progress("Running walk-forward");const selected=execute(selection.winner.candidate,fold,"outer",request.transaction_cost_bps);progress("Running walk-forward",1);selectedJobs.push(selected);
  selectionEvidence.push({...fold,candidate_id:selection.winner.candidate.candidate_id,selected_policy:selection.winner.candidate.spec,training_net_sharpe:selection.winner.score,training_turnover:selection.turnover_evidence[selection.winner.candidate.candidate_id],candidate_selection:selection.ranking.map(r=>({candidate_id:r.candidate.candidate_id,status:r.status,score:r.score??null,reason:r.reason??null,metrics:r.metrics??null,turnover:selection.turnover_evidence[r.candidate.candidate_id]??null})),oos_turnover:ledgerTurnover(selected.ledger,selected.observations.length,request.transaction_cost_bps),job_hash:selected.job_hash,result_hash:selected.result_hash,targets:selected.targets});
  allObservations.push(...selected.observations.map((o:Observation)=>({...o,fold_id:fold.fold_id})));
 }
 const ledger:BacktestLedgerEntry[]=selectedJobs.flatMap(j=>j.ledger);
 const days:ControlDay[]=allObservations.map((o,i)=>{const row=ledger[i],current=rows[byDate.get(row.date)!],previous=rows[byDate.get(row.intervalStart)!];const fold=selectedJobs[o.fold_id];return {date:o.date,fold_id:o.fold_id,market_return:(current.prices.SPY-previous.prices.SPY)/previous.prices.SPY,cash_return:campaign.cash_yield.daily,fold_offset:fold.observations.findIndex((x:Observation)=>x.date===o.date),fold_last:allObservations[i+1]?.fold_id!==o.fold_id}});
 let index=100,high=100;
 const dynamic=allObservations.map((o,i)=>{index*=1+o.net_return;high=Math.max(high,index);return {...days[i],net_return:o.net_return,index,drawdown:index/high-1,spy_exposure:o.exposure,cash_allocation:ledger[i].beginningCash/ledger[i].beginningNav,turnover:o.turnover,realized_cost:o.costs}});
 progress("Computing benchmarks");
 const passive=timed("passive_control",()=>controlTrack(days,1,request.transaction_cost_bps));
 const match:any=timed("matched_beta",()=>{try{return matchBeta(days,allObservations.map(o=>o.net_return),request.transaction_cost_bps)}catch(error){if(!(error instanceof AttributionError))throw error;return {status:error.code,safe_message:error.message,track:"NOT_SUPPORTED",methodology:BENCHMARK_METHODOLOGY_VERSION}}});progress("Computing benchmarks",1);
 const matched=Array.isArray(match.track)?match.track:[];
 const history=rows.filter(r=>r.date<=days.at(-1)!.date).map(r=>({date:r.date,adjusted_close:r.prices.SPY}));
 const toObs=(points:typeof passive)=>points.map(p=>({date:p.date,net_return:p.net_return,exposure:p.spy_exposure,turnover:p.turnover,costs:p.realized_cost}));
 const riskKey=hash({binding:cacheBinding,observations:allObservations,days,cost:request.transaction_cost_bps});
 let metrics=options.disable_cache?undefined:riskMetricsCache.get(riskKey);
 if(!metrics) {metrics=timed("risk_analytics",()=>({DYNAMIC_EXPOSURE:interactiveRiskMetrics(allObservations,days,history,campaign.cash_yield.reference_daily),PASSIVE_SPY:interactiveRiskMetrics(toObs(passive),days,history,campaign.cash_yield.reference_daily),STATIC_MATCHED_BETA:matched.length?interactiveRiskMetrics(toObs(matched),days,history,campaign.cash_yield.reference_daily):"NOT_SUPPORTED"}));if(!options.disable_cache)riskMetricsCache.set(riskKey,metrics)}else profile.risk_analytics_cache_hit=1;
 const turnovers=selectionEvidence.map(s=>s.oos_turnover),oosTurnover={initial_implementation_turnover:turnovers.reduce((s,x)=>s+x.initial_implementation_turnover,0),recurring_gross_turnover:turnovers.reduce((s,x)=>s+x.recurring_gross_turnover,0),total_gross_turnover:turnovers.reduce((s,x)=>s+x.total_gross_turnover,0)};
 const trackTurnover=(p:typeof passive)=>({initial_implementation_turnover:p.filter(x=>x.fold_offset===1).reduce((s,x)=>s+x.turnover,0),recurring_gross_turnover:p.filter(x=>x.fold_offset!==1).reduce((s,x)=>s+x.turnover,0),total_gross_turnover:p.reduce((s,x)=>s+x.turnover,0)});
 const finiteMatched=typeof metrics.STATIC_MATCHED_BETA!=="string"&&match.status==="MATCHED";
 const attribution=finiteMatched?{total_dynamic_effect_cagr_difference:metrics.DYNAMIC_EXPOSURE.cagr-metrics.PASSIVE_SPY.cagr,exposure_level_effect_cagr_difference:metrics.STATIC_MATCHED_BETA.cagr-metrics.PASSIVE_SPY.cagr,timing_residual_cagr_difference:metrics.DYNAMIC_EXPOSURE.cagr-metrics.STATIC_MATCHED_BETA.cagr}:"NOT_SUPPORTED";
 progress("Computing attribution",1);
 const {track:_track,...diagnostic}=match;
 const financial={metrics:metrics.DYNAMIC_EXPOSURE,points:dynamic,selected_policy_by_fold:selectionEvidence};
 const hashes={financial_result_hash:hash(financial),passive_control_hash:hash({points:passive,metrics:metrics.PASSIVE_SPY,methodology:BENCHMARK_METHODOLOGY_VERSION}),matched_beta_control_hash:hash({points:matched,metrics:metrics.STATIC_MATCHED_BETA,diagnostic,methodology:BENCHMARK_METHODOLOGY_VERSION}),attribution_hash:hash(attribution)};
 progress("Finalizing results",1);
 return {status:"SUCCESS" as const,plan,metrics:metrics.DYNAMIC_EXPOSURE,benchmark_metrics:metrics,benchmark_tracks:{DYNAMIC_EXPOSURE:dynamic,PASSIVE_SPY:passive,STATIC_MATCHED_BETA:matched},turnover:{DYNAMIC_EXPOSURE:oosTurnover,PASSIVE_SPY:trackTurnover(passive),STATIC_MATCHED_BETA:matched.length?trackTurnover(matched):"NOT_SUPPORTED"},selected_policy_by_fold:selectionEvidence,matched_beta_diagnostic:diagnostic,attribution,benchmark_methodology_version:BENCHMARK_METHODOLOGY_VERSION,...hashes,warnings:[...plan.warnings,...(match.status!=="MATCHED"?[match.status]:[]),...new Set(selectionEvidence.flatMap(s=>s.training_turnover.warnings))],blockers:[],execution_profile:{stage_ms:profile,elapsed_ms:performance.now()-started,cache,ledger_cache:jobs.statistics(),cache_policy:"SNAPSHOT_SOURCE_CANDIDATE_CALENDAR_COST_BOOK_BOUND",certification:options.disable_cache?"UNCACHED_LEDGER_REFERENCE":"INTERACTIVE_COMPACT"}};
}
const planInteractiveRequestFields={contract_version:1,research_mode:1,execution_scope:1,universe:1,validation_protocol:1,evaluation_start:1,evaluation_end_exclusive:1,window_type:1,training_window_months:1,rebalance_frequency:1,transaction_cost_bps:1,selection_cost_bps:1,turnover_constraint_methodology_version:1};
