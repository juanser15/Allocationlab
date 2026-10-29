import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDatasetV2, CalendarContractError, sha256, boundaryV2, type DatasetV2 } from './calendar-v2';
import { anchoredMonth, lowerBound, validDate } from './interactive-calendar';
import { canonicalJson, calculateRunId } from './identity';
import { resolveWorkbenchRepositoryRoot } from './repository-root';
import { persistentDatasetStore, PERSISTENT_DATA_BOUNDARY } from './persistent-datasets';
import { parseCoordinated, planCoordinated, normalizeCoordinated, deriveExperimentBounds, requestFields } from './coordinated-calendar';
import { COORDINATED_SPEC, ETF_UNIVERSE, DEFAULT_FORECAST, isCapitalStudy, type ResearchSubmission } from './coordinated-contract';
import { parseInstitutional, INSTITUTIONAL_FIELDS, INSTITUTIONAL_VERSION, cashIntervals } from './institutional-contract';
import { STRUCTURAL_POLICY, QUALITY_POLICY_HASH } from './quality-policy';
import { portfolioFeasibilityWarnings } from './portfolio-feasibility';
import { CONSTRAINED_OPTIMIZER_VERSION } from './portfolio-numerics';
export const P0_NAMESPACE = 'allocationlab-persistent-data-1.0.0';
export type P0Request = ResearchSubmission & {dataset_id:string};
export type DatasetBinding = {dataset_id:string;dataset_version:number;dataset_hash:string;dataset_source:string};
export type P0Dataset = DatasetV2 & {binding:DatasetBinding};
export { COORDINATED_SPEC, type ResearchSubmission };
/** The original engine's request parser understands only legacy identifiers.
 * Its local identifier is never resolved: every engine call receives the verified
 * persisted payload explicitly. Public plans/specs retain the real immutable ID. */
export function engineRequest(request:P0Request):ResearchSubmission {const clean=Object.fromEntries(Object.entries(request).filter(([k])=>!(INSTITUTIONAL_FIELDS as readonly string[]).includes(k)));return {...clean,dataset_id:'internal'} as ResearchSubmission;}
export function parseP0(value:unknown):P0Request {
 const v=value as P0Request;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.dataset_id!=='string'||! /^(internal_[a-f0-9]{64}|yf_[a-f0-9]{32,64})$/.test(v.dataset_id))throw new CalendarContractError('DATASET_UNAVAILABLE','Select an existing saved dataset version. No internal dataset will be substituted.',{},409);
  const financial=parseInstitutional(v);
  const request=parseCoordinated(engineRequest(v));
  return {...request,...financial,dataset_id:v.dataset_id} as P0Request;
}
export async function loadP0Dataset(id:string):Promise<P0Dataset> {
 const {metadata,csv}=await persistentDatasetStore.read(id);
 if(sha256(csv)!==metadata.dataset_hash)throw new CalendarContractError('DATASET_UNAVAILABLE','The saved dataset failed its integrity check. No dataset was substituted.',{dataset_id:id},409);
 const lines=csv.trim().split(/\r?\n/),tickers=lines[0].split(',').slice(1);
 const rows=lines.slice(1).map(line=>{const [date,...values]=line.split(',');return {date,prices:Object.fromEntries(tickers.flatMap((t,i)=>values[i]?[[t,Number(values[i])]]:[]))};});
 if(!rows.length||rows.some((r,i)=>!validDate(r.date)||(i>0&&r.date<=rows[i-1].date)||Object.values(r.prices).some(v=>!Number.isFinite(v)||v<=0)))throw new CalendarContractError('DATASET_UNAVAILABLE','The saved dataset has invalid normalized observations. No dataset was substituted.',{dataset_id:id},409);
 const base=loadDatasetV2();
 const binding={dataset_id:id,dataset_version:metadata.dataset_version,dataset_hash:metadata.dataset_hash,dataset_source:metadata.source};
 return {...base,binding,rows,fixture:{...base.fixture,data_csv:`postgres://${id}`,data_sha256:metadata.dataset_hash,data_provenance:canonicalJson(metadata)},snapshot:{...base.snapshot,path:`postgres://${id}`,sha256:metadata.dataset_hash,parsed_data_hash:sha256(canonicalJson(rows)),observations:rows.length,data_first_observation:rows[0].date,data_last_observation:rows.at(-1)!.date,...binding,source:metadata.source,fetched_at:metadata.fetched_at} as DatasetV2['snapshot']};
}
const coverageCodes = new Set([
 'EMPTY_DATASET', 'INVALID_RESEARCH_CALENDAR', 'INVALID_DATES', 'INVALID_TRAINING_WINDOW',
 'DATASET_SYMBOL_MISSING', 'CANDIDATES_NOT_IN_DATASET', 'INSUFFICIENT_TRAINING_HISTORY',
 'INSUFFICIENT_DATA_FOR_EXPERIMENT', 'EVALUATION_BEYOND_DATA_RANGE', 'REGIME_FEATURE_HISTORY_REQUIRED',
 'INSUFFICIENT_FEATURE_HISTORY', 'INSUFFICIENT_MODEL_WARMUP_HISTORY', 'INCOMPLETE_OOS_DATA',
 'INCOMPLETE_CORE_HISTORY', 'INCOMPLETE_ETF_HISTORY', 'CASH_HISTORY_REQUIRED', 'EMPTY_DESIGN',
]);
function coverageError(error: unknown, context: Record<string, unknown> = {}): never {
 if (error instanceof CalendarContractError && coverageCodes.has(error.code))
  throw new CalendarContractError('DATA_COVERAGE', error.message,
   {...context,...error.details,category:'DATA_COVERAGE',reason_code:error.code,no_run_created:true},422);
 throw error;
}
export function validateCoverage(request:P0Request,data:P0Dataset) {
 const context={...data.binding,requested_backtest_start:request.evaluation_start,requested_backtest_end:request.evaluation_end_exclusive};
 try {
  if(!validDate(request.evaluation_start)||!validDate(request.evaluation_end_exclusive)||request.evaluation_start>=request.evaluation_end_exclusive||!Number.isSafeInteger(request.training_window_months)||request.training_window_months<1||request.training_window_months>1200)
   throw new CalendarContractError('INVALID_RESEARCH_CALENDAR','Supply valid From/To dates and a positive whole-number training window of at most 1,200 months.',context,422);
  if(!data.rows.length)throw new CalendarContractError('EMPTY_DATASET','The selected dataset has no observations.',context,422);
  const first=data.rows[0].date,last=data.rows.at(-1)!.date,trainingStart=anchoredMonth(request.evaluation_start,-request.training_window_months);
  const decisionIndex=lowerBound(data.rows,request.evaluation_start);
  const lookback=request.regime_model==='CURRENT'?10:request.regime_model==='TREND'?200:request.regime_model==='TREND_VOL'?253:0;
  const featureStart=decisionIndex>=lookback?data.rows[decisionIndex-lookback]?.date??request.evaluation_start:null;
  const availableSPY=data.rows.slice(0,decisionIndex).filter(r=>Number.isFinite(r.prices.SPY)&&r.prices.SPY>0).length;
  const details={...context,training_start:trainingStart,feature_warmup_start:featureStart,required_feature_observations:lookback,available_feature_observations:availableSPY,dataset_first_date:first,dataset_last_date:last};
  let bounds: ReturnType<typeof deriveExperimentBounds>;
  try { bounds=deriveExperimentBounds(engineRequest(request),data); }
  catch(error){return coverageError(error,details);}
  const history={...details,...bounds,requested_evaluation_start:request.evaluation_start};
  if(trainingStart<first)throw new CalendarContractError('INSUFFICIENT_TRAINING_HISTORY',`Your ${request.training_window_months}-month training window requires history from ${trainingStart}, but the active dataset starts ${first}. Earliest history-supported OOS date: ${bounds.earliest_supported_evaluation_start}.`,history,422);
  const maxEnd=new Date(Date.parse(last)+86400000).toISOString().slice(0,10);
  if(request.evaluation_end_exclusive>maxEnd)throw new CalendarContractError('EVALUATION_BEYOND_DATA_RANGE',`Active dataset ends ${last}. Requested end ${request.evaluation_end_exclusive} is beyond its available coverage.`,{...history,supported_end_exclusive:maxEnd},422);
  if(availableSPY<lookback)throw new CalendarContractError('REGIME_FEATURE_HISTORY_REQUIRED',`${request.regime_model} requires ${lookback} prior SPY observations before ${request.evaluation_start}; only ${availableSPY} are available from ${first}. Earliest history-supported OOS date: ${bounds.earliest_supported_evaluation_start}. The training window has not been changed.`,history,422);
  if(request.evaluation_start<bounds.earliest_supported_evaluation_start)throw new CalendarContractError('INSUFFICIENT_FEATURE_HISTORY',`The requested design starts ${request.evaluation_start}; its training and feature history are available from ${bounds.earliest_supported_evaluation_start}. No dates were moved.`,history,422);
  return history;
 } catch(error) {return coverageError(error,context);}
}
export function planP0WithData(value:unknown,data:P0Dataset) {
 const request=parseP0(value);
 if(request.dataset_id!==data.binding.dataset_id)throw new CalendarContractError('DATASET_UNAVAILABLE','Requested and loaded dataset versions differ.',{},409);
 const coverage=validateCoverage(request,data);
 try {
  if(!isCapitalStudy(request)) {
   const available=new Set(data.rows.flatMap(row=>Object.keys(row.prices)));
   const missing=request.etfs.filter(symbol=>!available.has(symbol));
   if(missing.length)throw new CalendarContractError('CANDIDATES_NOT_IN_DATASET',`Selected candidates not present in this dataset: ${missing.join(', ')}. Remove these candidates or select a dataset that contains them.`,{fields:['etfs','dataset_id'],missing_symbols:missing,...data.binding},422);
  }
  const old=planCoordinated(engineRequest(request),data);
  cashIntervals(data.rows,old.folds[0].decision_date,request.evaluation_end_exclusive,request.cash_policy);
  if(old.effective_evaluation_start!==request.evaluation_start)throw new CalendarContractError('PLAN_DATE_MISMATCH','The execution planner attempted to change the requested start. No run was created.',coverage,422);
  return {...old,normalized_request:request,...data.binding,data_identity:data.binding,coverage,identity_namespace:P0_NAMESPACE,
   static_feasibility:{status:'NECESSARY_CONDITIONS_SATISFIED',category:'PORTFOLIO_CONSTRAINT',budget_semantics:'CEILING',optimizer_methodology_version:request.mandate?CONSTRAINED_OPTIMIZER_VERSION:'LEGACY_CONTINUOUS_NO_HOLDINGS_MANDATE',future_covariance_and_frozen_overlay_feasibility:'CHECKED_AT_DECISION_NOT_GUARANTEED_BY_PLAN'},
   warnings:[...old.warnings,...portfolioFeasibilityWarnings(request)],
   plan_hash:sha256(canonicalJson({request,folds:old.folds,dataset:data.binding,version:P0_NAMESPACE}))};
 }catch(error){return coverageError(error,coverage);}
}
export async function planP0(value:unknown){const r=parseP0(value);return planP0WithData(r,await loadP0Dataset(r.dataset_id));}
export function normalizeP0WithData(value:unknown,data:P0Dataset){
 const plan=planP0WithData(value,data),base=normalizeCoordinated(engineRequest(plan.normalized_request),data),root=resolveWorkbenchRepositoryRoot({moduleUrl:import.meta.url});
  const files=['artifacts/api-server/src/lib/workbench/p0-calendar.ts','artifacts/api-server/src/lib/workbench/p0-service.ts','artifacts/api-server/src/workbench-p0-worker.ts','artifacts/api-server/src/lib/workbench/persistent-datasets.ts','artifacts/api-server/src/lib/workbench/institutional-contract.ts','artifacts/api-server/src/lib/workbench/quality-policy.ts','research/coordinated/institutional.ts','research/workbench/institutional-ledger.ts','research/coordinated/quality.ts'];
  files.push('research/coordinated/capital-clock.ts','artifacts/api-server/src/lib/workbench/portfolio-feasibility.ts','research/coordinated/constrained-optimizer.ts','artifacts/api-server/src/lib/workbench/portfolio-numerics.ts');
  return {...base,...plan.normalized_request,...data.binding,identity_namespace:P0_NAMESPACE,data_snapshot:data.snapshot,engine_version:base.engine_version+'+'+INSTITUTIONAL_VERSION,quality_control_policy:isCapitalStudy(plan.normalized_request)?null:{definition:STRUCTURAL_POLICY,hash:QUALITY_POLICY_HASH},methodology:{...base.methodology,optimizer_methodology_version:plan.normalized_request.mandate?CONSTRAINED_OPTIMIZER_VERSION:'LEGACY_CONTINUOUS_NO_HOLDINGS_MANDATE',cash_yield:'ZERO_RETURN_EACH_OBSERVED_INTERVAL',cash_proxy:plan.normalized_request.cash_policy,slippage_bps:plan.normalized_request.slippage_bps,quality_control:isCapitalStudy(plan.normalized_request)?'NOT_REQUIRED_CAPITAL_ONLY':plan.normalized_request.quality_control,sharpe:'SAMPLE_STD_EXCESS_OVER_ZERO_CASH_SQRT_252'},code_version:sha256(canonicalJson({financial_code:base.code_version,files:files.map(p=>[p,sha256(readFileSync(resolve(root,p)))])})),data_binding_version:P0_NAMESPACE};
}
export async function normalizeP0(value:unknown){const r=parseP0(value);return normalizeP0WithData(r,await loadP0Dataset(r.dataset_id));}
export type P0Spec=ReturnType<typeof normalizeP0WithData>;
export const p0RunId=(spec:P0Spec)=>calculateRunId(spec);
export function requestFromP0Spec(spec:P0Spec){return parseP0(Object.fromEntries([...requestFields,...INSTITUTIONAL_FIELDS].filter(k=>Object.hasOwn(spec,k)).map(k=>[k,(spec as any)[k]])));}
export async function p0Bounds(value:unknown){const r=parseP0(value),data=await loadP0Dataset(r.dataset_id);try{return {...deriveExperimentBounds(engineRequest(r),data),...data.binding};}catch(error){return coverageError(error,{...data.binding,requested_evaluation_start:r.evaluation_start,training_window_months:r.training_window_months});}}
export async function p0Capabilities(id?:string){
 const datasetId=id??(await persistentDatasetStore.workspace()).active_dataset_id;
 if(!datasetId)throw new CalendarContractError('DATASET_UNAVAILABLE','Select a saved dataset before configuring research.',{},409);
 const data=await loadP0Dataset(datasetId);
 return {...boundaryV2,...PERSISTENT_DATA_BOUNDARY,supported_spec_version:COORDINATED_SPEC,constrained_optimizer_methodology_version:CONSTRAINED_OPTIMIZER_VERSION,identity_namespace:P0_NAMESPACE,...data.binding,etfs:[...new Set(data.rows.flatMap(r=>Object.keys(r.prices)))].sort(),forecast_models:['HISTORICAL_MEAN','MANUAL_SCORE','SIGNAL_RIDGE'],default_forecast:DEFAULT_FORECAST,data_snapshot:data.snapshot,data_first_observation:data.snapshot.data_first_observation,data_last_observation:data.snapshot.data_last_observation,data_source:data.binding.dataset_source,models:['CURRENT','TREND','TREND_VOL','HMM'],control_modes:['MAX_EXPOSURE','RISK_BUDGET'],research_scopes:['PORTFOLIO','CAPITAL_EXPOSURE'],training_history_policy:'EXPLICIT_USER_WINDOW_NO_DATE_MOVEMENT',model_data_requirements:{CURRENT:{mandatory_symbols:['SPY'],optional_symbols:data.fixture.reference_universe.filter(t=>t!=='SPY'),mandatory:['SPY'],optional_components:'Existing computeRegime availability-weight renormalization',minimum_causal_observations:10,maximum_information_window:252},TREND:{mandatory:['SPY'],causal_observations:200},TREND_VOL:{mandatory:['SPY'],causal_observations:253},HMM:{mandatory:['SPY'],history:'Actual finite nondegenerate training log returns'}}};
}
