import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadDatasetV2, type DatasetV2, CalendarContractError, boundaryV2, sha256 } from "./calendar-v2";
import { canonicalJson, calculateRunId } from "./identity";
import { resolveWorkbenchRepositoryRoot } from "./repository-root";
import { readExecutionCapacity } from "./execution-capacity";
import { productModelDefinition, RECURRING_V2 } from "./turnover-product";
export const INTERACTIVE_SPEC = "allocationlab-interactive-spec-3.0.0" as const;
export const ANCHORED_CALENDAR = "ANCHORED_NEXT_TRADING_DAY_V1" as const;
export interface InteractiveRequest {
 contract_version: typeof INTERACTIVE_SPEC; research_mode:"CAPITAL_MARKET_EXPOSURE"; execution_scope:"EMPIRICAL"; universe:"SPY";
 validation_protocol:"TRADITIONAL_WALK_FORWARD"; evaluation_start:string; evaluation_end_exclusive:string;
 window_type:"ROLLING"|"EXPANDING";training_window_months:number;rebalance_frequency:"MONTHLY"|"QUARTERLY";
 transaction_cost_bps:number; selection_cost_bps:number;turnover_constraint_methodology_version:typeof RECURRING_V2;
}
const fields = ["contract_version","research_mode","execution_scope","universe","validation_protocol","evaluation_start","evaluation_end_exclusive","window_type","training_window_months","rebalance_frequency","transaction_cost_bps","selection_cost_bps","turnover_constraint_methodology_version"];
export const validDate = (x:unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x;
export function parseInteractive(value:unknown):InteractiveRequest {
 if (!value||typeof value!=="object"||Array.isArray(value)) throw new CalendarContractError("INVALID_RESEARCH_DESIGN","Supply an explicit research design.");
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(v,k)))throw new CalendarContractError("INVALID_RESEARCH_DESIGN","Every research field must be explicit. Unknown inputs are rejected.");
 const fixed={contract_version:INTERACTIVE_SPEC,research_mode:"CAPITAL_MARKET_EXPOSURE",execution_scope:"EMPIRICAL",universe:"SPY",validation_protocol:"TRADITIONAL_WALK_FORWARD",turnover_constraint_methodology_version:RECURRING_V2};
 for(const [k,x]of Object.entries(fixed))if(v[k]!==x)throw new CalendarContractError("UNSUPPORTED_RESEARCH_DESIGN","This research mode or model version is unavailable.");
 if(!validDate(v.evaluation_start)||!validDate(v.evaluation_end_exclusive)||v.evaluation_start>=v.evaluation_end_exclusive)throw new CalendarContractError("INVALID_DATES","Choose valid dates with To after From. To is exclusive.");
 if(!["ROLLING","EXPANDING"].includes(String(v.window_type))||!["MONTHLY","QUARTERLY"].includes(String(v.rebalance_frequency)))throw new CalendarContractError("UNSUPPORTED_CALENDAR","Choose a supported window type and rebalance cadence.");
 if(!Number.isSafeInteger(v.training_window_months)||Number(v.training_window_months)<1||Number(v.training_window_months)>1200)throw new CalendarContractError("INVALID_TRAINING_WINDOW","Training must be a positive whole number of months, at most 1,200.");
 for(const k of ["transaction_cost_bps","selection_cost_bps"])if(typeof v[k]!=="number"||!Number.isFinite(v[k])||Number(v[k])<0)throw new CalendarContractError("INVALID_COST","Costs must be finite, nonnegative basis points.");
 return Object.fromEntries(fields.map(k=>[k,Object.is(v[k],-0)?0:v[k]])) as unknown as InteractiveRequest;
}
/** Anchor-relative calendar arithmetic; clamp day to destination month end, never
 * add repeatedly to a previously clamped date (Jan31 -> Feb28 -> Mar31). */
export function anchoredMonth(date:string,n:number) {
 const [y,m,d]=date.split("-").map(Number);const first=new Date(Date.UTC(y,m-1+n,1));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 first.setUTCDate(Math.min(d,last));return first.toISOString().slice(0,10);
}
export function lowerBound(rows:DatasetV2["rows"],date:string){let a=0,b=rows.length;while(a<b){const m=(a+b)>>>1;if(rows[m].date<date)a=m+1;else b=m}return a}
export interface InteractiveFold {
 fold_id:number;training_start:string;training_end_exclusive:string;decision_date:string;information_cutoff:string;oos_start:string;oos_end_exclusive:string;
 intended_rebalance_date:string;training_observations:number;warmup_observations:number;oos_observations:number;partial_final_period:boolean;
}
let prepared:DatasetV2|undefined;
export const preparedDataset=()=>prepared??=loadDatasetV2();
export function interactiveCodeVersion(data=preparedDataset()){
 const root=resolveWorkbenchRepositoryRoot({moduleUrl:import.meta.url});
 return sha256(canonicalJson({certified:data.code_version,files:Object.fromEntries([
 "research/workbench/interactive-ledger.ts","research/workbench/interactive-candidates.ts","research/workbench/interactive-engine.ts","research/workbench/turnover-selection.ts",
 "artifacts/api-server/src/lib/workbench/interactive-calendar.ts","artifacts/api-server/src/lib/workbench/interactive-risk.ts",
 "artifacts/api-server/src/lib/workbench/interactive-service.ts","artifacts/api-server/src/workbench-interactive-worker.ts",
 "artifacts/api-server/src/lib/workbench/exposure-controls.ts",
 "artifacts/api-server/src/lib/allocation-core/risk-analytics/analytics.ts","artifacts/api-server/src/lib/allocation-core/risk-analytics/diagnostics.ts",
 "artifacts/api-server/src/lib/allocation-core/risk-analytics/estimators.ts","artifacts/api-server/src/lib/allocation-core/validation.ts","artifacts/api-server/src/lib/allocation-core/contracts.ts",
 ].map(p=>[p,sha256(readFileSync(resolve(root,p)))]))}));
}
export function planInteractive(value:unknown,data=preparedDataset(),enforceCapacity=true){
 const request=parseInteractive(value), rows=data.rows,first=rows[0].date,last=rows.at(-1)!.date;
 const maxEnd=new Date(Date.parse(last)+86400000).toISOString().slice(0,10);
 if(request.evaluation_end_exclusive>maxEnd)throw new CalendarContractError("EVALUATION_BEYOND_DATA_RANGE","The backtest ends beyond available observations.",{requested_end:request.evaluation_end_exclusive,supported_end_exclusive:maxEnd});
 const interval=request.rebalance_frequency==="MONTHLY"?1:3;
 const folds:InteractiveFold[]=[];
 for(let i=0; ;i++){
  const start=anchoredMonth(request.evaluation_start,i*interval);if(start>=request.evaluation_end_exclusive)break;
  const next=anchoredMonth(request.evaluation_start,(i+1)*interval),end=next<request.evaluation_end_exclusive?next:request.evaluation_end_exclusive;
  const train=anchoredMonth(request.window_type==="ROLLING"?start:request.evaluation_start,-request.training_window_months);
  const a=lowerBound(rows,train),b=lowerBound(rows,start),c=lowerBound(rows,end);
  const details={fold_id:i,requested_training_months:request.training_window_months,training_start:train,available_training_observations:b-a,required_training_observations:2,available_warmup_observations:a,required_warmup_observations:data.fixture.warmup_rows,data_first_observation:first};
  if(train<first||b-a<2)throw new CalendarContractError("INSUFFICIENT_TRAINING_HISTORY","Not enough historical information is available for this training window. Choose a later backtest start or explicitly change the training length.",details,422);
  if(a<data.fixture.warmup_rows)throw new CalendarContractError("INSUFFICIENT_MODEL_WARMUP_HISTORY","The model needs more historical observations before training. Choose a later backtest start.",details,422);
  if(c-b<3)throw new CalendarContractError("INCOMPLETE_OOS_DATA","The final rebalance period needs at least three observed sessions for certified next-close execution. Change the requested end explicitly.",{fold_id:i,available_observations:c-b,required_observations:3},422);
  if(rows.slice(a-data.fixture.warmup_rows,c).some(r=>data.fixture.reference_universe.some(t=>!Number.isFinite(r.prices[t])||r.prices[t]<=0)))throw new CalendarContractError("INCOMPLETE_INFORMATION_UNIVERSE","Historical inputs for the current model are incomplete. Choose a later backtest start with complete training and warmup history.",{fold_id:i,required_information_symbols:data.fixture.reference_universe,training_start:train,warmup_requirement_observations:data.fixture.warmup_rows},422);
  folds.push({fold_id:i,training_start:train,training_end_exclusive:start,decision_date:rows[b].date,information_cutoff:rows[b-1].date,oos_start:start,oos_end_exclusive:end,intended_rebalance_date:start,training_observations:b-a,warmup_observations:a,oos_observations:c-b,partial_final_period:next>end});
 }
 if(!folds.length)throw new CalendarContractError("EMPTY_DESIGN","Choose a period with observed trading sessions.");
 // Five actual training candidates + one selected OOS job per fold; preparation,
 // controls, attribution and final publication each count one completed work unit.
 const estimated=folds.length*6+4,capacity=readExecutionCapacity();
 if(enforceCapacity&&(estimated>capacity.max_jobs||capacity.max_engine_files<2))throw new CalendarContractError("INTERACTIVE_CAPACITY_EXCEEDED",estimated>capacity.max_jobs?`This design exceeds current interactive capacity: ${estimated.toLocaleString("en-US")} tasks requested vs ${capacity.max_jobs.toLocaleString("en-US")} available.`:"This design exceeds the current interactive result-storage capacity. No execution attempt was created.",{fold_count:folds.length,estimated_jobs:estimated,maximum_jobs:capacity.max_jobs,compact_engine_files:2,maximum_files:capacity.max_engine_files,no_attempt_created:true},422);
 const plan={calendar_methodology:ANCHORED_CALENDAR,normalized_request:request,folds,number_of_folds:folds.length,total_work_units:estimated,estimated_jobs:estimated,
 derived_timing:{months:interval,step_months:interval,recalibration:"EVERY_REBALANCE"},warnings:[boundaryV2.pit_classification,"Independent fold sleeves; next-close fills; final partial period is explicit."],blockers:[]};
 return {...boundaryV2,...plan,plan_hash:sha256(canonicalJson({request,folds,calendar:ANCHORED_CALENDAR,data_snapshot:data.snapshot.sha256}))};
}
export type InteractivePlan=ReturnType<typeof planInteractive>;
export function normalizeInteractive(value:unknown,data=preparedDataset()){
 const plan=planInteractive(value,data);
 return {...plan.normalized_request,identity_namespace:INTERACTIVE_SPEC,calendar_methodology:ANCHORED_CALENDAR,data_snapshot:data.snapshot,
 code_version:interactiveCodeVersion(data),runtime_versions:{node:process.versions.node,v8:process.versions.v8},engine_version:"interactive-capital-3.0.0",certified_engine_commit:"b9950f7cbe128f9d761597a5e216d777cc3059a3",
 model_definition:{candidate_space:data.fixture.candidate_space,constraints:data.fixture.constraints,selection_metric:data.fixture.selection_metric,warmup_rows:data.fixture.warmup_rows,cash_yield:data.fixture.cash_yield,execution:"next_close",accounting:"INDEPENDENT_FOLD_SLEEVES"},...boundaryV2};
}
export type InteractiveSpec=ReturnType<typeof normalizeInteractive>;
export const interactiveRunId=(s:InteractiveSpec)=>calculateRunId(s);
export function interactiveCapabilities(data=preparedDataset()){
 return {...boundaryV2,contract_version:"allocationlab-interactive-capabilities-3.0.0",supported_spec_version:INTERACTIVE_SPEC,
 supported_modes:["CAPITAL_MARKET_EXPOSURE"],supported_universe:["SPY"],data_snapshot:data.snapshot,
 data_first_observation:data.snapshot.data_first_observation,data_last_observation:data.snapshot.data_last_observation,
 supported_evaluation_end_max:new Date(Date.parse(data.snapshot.data_last_observation)+86400000).toISOString().slice(0,10),
 supported_window_types:["ROLLING","EXPANDING"],supported_rebalance_frequencies:["MONTHLY","QUARTERLY"],
 date_rules:{arbitrary_calendar_dates:true,calendar:ANCHORED_CALENDAR,trading_day_rule:"NEXT_TRADING_DAY",execution:"NEXT_OBSERVED_CLOSE",month_end:"CLAMP_FROM_ORIGINAL_ANCHOR",final_period:"EXPLICIT_PARTIAL_ALLOWED_MINIMUM_THREE_SESSIONS",to_is_exclusive:true},
 training_window_rules:{minimum_months:1,maximum_months:1200,minimum_training_observations:2,warmup_observations:data.fixture.warmup_rows,no_automatic_extension:true},
 cost_rules:{minimum:0,finite:true,rounding:"NONE",standard_mode:"SELECTION_EQUALS_OOS"},model_definition:productModelDefinition(data),
 resource_limits:{...readExecutionCapacity(),maximum_concurrent_executions:1,classification:"CURRENT_EXECUTION_CAPACITY",financial_identity_input:false},
 execution_modes:{interactive:"AVAILABLE",certification:"FUTURE_NOT_IMPLEMENTED"},comparison:{maximum_table_runs:100,maximum_displayed_curves:8},
 temporary_storage:{classification:boundaryV2.storage_classification,durability:"NONE"},code_version:interactiveCodeVersion(data)};
}
