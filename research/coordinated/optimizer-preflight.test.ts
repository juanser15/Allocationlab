import test from "node:test";
import assert from "node:assert/strict";
import { portfolioFeasibilityIssue, portfolioFeasibilityWarnings } from "../../artifacts/api-server/src/lib/workbench/portfolio-feasibility";
import { parseP0, planP0WithData, engineRequest, type P0Dataset } from "../../artifacts/api-server/src/lib/workbench/p0-calendar";
import { deriveExperimentBounds } from "../../artifacts/api-server/src/lib/workbench/coordinated-calendar";
import { COORDINATED_SPEC, CURRENT_CASH_POLICY } from "../../artifacts/api-server/src/lib/workbench/coordinated-contract";

// SYNTHETIC SOURCE-ONLY CALENDAR FIXTURE. No market dataset, DB, provider or
// excluded certification report is read. These prices test date/input mechanics.
function calendarData(): P0Dataset {
  const rows: any[] = [];
  for (let t=Date.parse("2022-01-03"), i=0;t<Date.parse("2025-01-01");t+=86400000) {
    const date=new Date(t);if([0,6].includes(date.getUTCDay()))continue;
    rows.push({date:date.toISOString().slice(0,10),prices:Object.fromEntries(["SPY",...Array.from({length:11},(_,j)=>`ETF${j}`)].map((symbol,j)=>[symbol,100+i*.01+j]))});i++;
  }
  const binding={dataset_id:`internal_${"a".repeat(64)}`,dataset_version:1,dataset_hash:"a".repeat(64),dataset_source:"SYNTHETIC_TEST_ONLY"};
  return {rows,binding,fixture:{warmup_rows:0,reference_universe:["SPY"]},snapshot:{path:"SYNTHETIC_TEST_ONLY",sha256:binding.dataset_hash,parsed_data_hash:binding.dataset_hash,observations:rows.length,data_first_observation:rows[0].date,data_last_observation:rows.at(-1).date},code_version:"synthetic-calendar-only"} as P0Dataset;
}
const data=calendarData();
const request:any={contract_version:COORDINATED_SPEC,dataset_id:data.binding.dataset_id,research_scope:"PORTFOLIO",etfs:Array.from({length:11},(_,j)=>`ETF${j}`),maximum_etf_weight:.3,risk_aversion:5,covariance_shrinkage:.2,cash_policy:CURRENT_CASH_POLICY,slippage_bps:0,quality_control:{enabled:false,policy_version:"STRUCTURAL_V1"},evaluation_start:"2024-01-03",evaluation_end_exclusive:"2024-04-03",training_window_months:6,window_type:"ROLLING",rebalance_frequency:"MONTHLY",transaction_cost_bps:1,control_mode:"MAX_EXPOSURE",maximum_exposure:.6,risk_budget:.1,regime_model:"TREND",regime_response:"FIXED",defensive_multiplier:.5,capital_signal_frequency:"REBALANCE_ONLY",mandate:{minimum_positions:1,maximum_positions:10,minimum_weight:.03}};

test("Exact failure: malformed minimum final holdings is rejected before loading data or creating a run",()=>{
 for(const value of [null,undefined,"",0,-1,1.5,"garbage",NaN,Infinity]) {
  const r={...request,mandate:{...request.mandate,minimum_positions:value}};
  assert.throws(()=>parseP0(r),(e:any)=>e.code==="PORTFOLIO_CONSTRAINT"&&/Minimum final holdings must be a positive whole number/.test(e.message));
 }
 for(const mandate of [null,[],{},"invalid"])assert.throws(()=>parseP0({...request,mandate}),(e:any)=>e.code==="PORTFOLIO_CONSTRAINT");
});
test("Coherent finite cardinalities and candidate selection are authoritative and never clamped",()=>{
 for(const patch of [
  {mandate:{minimum_positions:1,maximum_positions:12,minimum_weight:.03}},
  {mandate:{minimum_positions:3,maximum_positions:2,minimum_weight:.03}},
  {mandate:{minimum_positions:1,maximum_positions:NaN,minimum_weight:.03}},
  {mandate:{minimum_positions:1,maximum_positions:10,minimum_weight:null}},
  {etfs:["ETF0","ETF0"]},{etfs:[]},
 ])assert.throws(()=>parseP0({...request,...patch}),(e:any)=>e.code==="PORTFOLIO_CONSTRAINT");
 const original=structuredClone(request);assert.deepEqual(parseP0(request).mandate,request.mandate);assert.deepEqual(request,original);
});
test("Joint 1–10 holdings and 3% floor accepts eleven eligible assets without promising all are held",()=>{
 assert.equal(portfolioFeasibilityIssue(request),null);
 const plan=planP0WithData(request,data);assert.equal(plan.normalized_request.etfs.length,11);
 assert.equal(plan.static_feasibility.budget_semantics,"CEILING");assert.equal(plan.number_of_folds,3);
 assert.equal(plan.static_feasibility.optimizer_methodology_version,"cardinality-active-support-2.0.0");
 assert.equal(plan.static_feasibility.portfolio_constraint_scope,"STRATEGIC_NAV_TARGET_AT_SCHEDULED_REBALANCE");
 assert.equal(plan.static_feasibility.capital_overlay_and_market_drift_reapply_construction_limits,false);
 for(const f of plan.folds){assert.ok(f.training_end_exclusive<=f.decision_date);assert.ok(f.information_cutoff<f.decision_date);}
});
test("Analytic impossible mandates identify the precise inequality; ceiling is not equality",()=>{
 const impossible={...request,maximum_exposure:.09,mandate:{minimum_positions:4,maximum_positions:10,minimum_weight:.03}};
 const issue=portfolioFeasibilityIssue(impossible)!;assert.equal(issue.code,"PORTFOLIO_CONSTRAINT");assert.equal(issue.details?.required_exposure,.12);assert.equal(issue.details?.exposure_ceiling,.09);
 assert.throws(()=>parseP0(impossible),(e:any)=>e.code==="PORTFOLIO_CONSTRAINT");
 const ceiling={...request,maximum_exposure:1,mandate:{minimum_positions:1,maximum_positions:2,minimum_weight:.03}};
 assert.equal(portfolioFeasibilityIssue(ceiling),null);
 assert.match(portfolioFeasibilityIssue(ceiling,"EXACT")!.message,/60%.*100%/);
});
test("Explicit cash is allowed in both clocks; stress overlay does not reapply construction floors",()=>{
 for(const capital_signal_frequency of ["DAILY","REBALANCE_ONLY"]){
  assert.ok(parseP0({...request,maximum_exposure:0,capital_signal_frequency}));
  assert.ok(parseP0({...request,regime_response:"ADAPTIVE",defensive_multiplier:0,capital_signal_frequency,control_mode:"RISK_BUDGET"}));
 }
 assert.equal(portfolioFeasibilityIssue({...request,regime_response:"ADAPTIVE",defensive_multiplier:.1,mandate:{minimum_positions:4,maximum_positions:10,minimum_weight:.03}}),null);
 assert.equal(portfolioFeasibilityIssue({...request,regime_response:"ADAPTIVE",defensive_multiplier:0}),null);
 assert.match(portfolioFeasibilityWarnings({...request,regime_response:"ADAPTIVE",defensive_multiplier:0}).join(),/strategic NAV targets at scheduled allocation rebalances/);
});
test("2.5% and 3% construction floors accept lower positive HMM exposure while retaining impossible strategic-budget blockers",()=>{
 for(const minimum_weight of [.025,.03])for(const capital_signal_frequency of ["DAILY","REBALANCE_ONLY"]){
  const r={...request,maximum_exposure:.6,regime_response:"ADAPTIVE",defensive_multiplier:.01,capital_signal_frequency,mandate:{minimum_positions:4,maximum_positions:10,minimum_weight}};
  const before=structuredClone(r);
  const plan=planP0WithData(r,data);
  assert.deepEqual(plan.normalized_request.mandate,r.mandate);
  assert.equal(plan.normalized_request.defensive_multiplier,.01);
  assert.equal(plan.static_feasibility.capital_overlay_and_market_drift_reapply_construction_limits,false);
  assert.ok(plan.warnings.some(w=>/without an error or corrective trade/.test(w)));
  assert.deepEqual(r,before,"Preflight must not change the chosen dates, mandate or HMM response");
  const required=4*minimum_weight;
  assert.throws(()=>planP0WithData({...r,maximum_exposure:required-.001},data),(e:any)=>e.code==="PORTFOLIO_CONSTRAINT"&&e.details.required_exposure===required);
 }
});
test("Data coverage error includes requested and earliest dates without modifying the design",()=>{
 const r={...request,evaluation_start:"2022-03-03",evaluation_end_exclusive:"2022-06-03",training_window_months:6};const before=structuredClone(r);
 assert.throws(()=>planP0WithData(r,data),(e:any)=>e.code==="DATA_COVERAGE"&&e.details.reason_code==="INSUFFICIENT_TRAINING_HISTORY"&&e.details.training_start==="2021-09-03"&&e.details.dataset_first_date==="2022-01-03"&&e.details.earliest_supported_evaluation_start>r.evaluation_start);
 assert.deepEqual(r,before);
 assert.throws(()=>planP0WithData({...request,evaluation_end_exclusive:"2025-01-03"},data),(e:any)=>e.code==="DATA_COVERAGE"&&e.details.reason_code==="EVALUATION_BEYOND_DATA_RANGE");
});
test("Warmup beyond available data cannot be clamped to the dataset's final row",()=>{
 const short={...data,rows:data.rows.slice(0,40),snapshot:{...data.snapshot,data_last_observation:data.rows[39].date}};
 assert.throws(()=>deriveExperimentBounds(engineRequest({...request,training_window_months:1,regime_model:"TREND_VOL"}),short),(e:any)=>e.code==="INSUFFICIENT_DATA_FOR_EXPERIMENT");
 assert.throws(()=>planP0WithData({...request,training_window_months:1,regime_model:"TREND_VOL"},short),(e:any)=>e.code==="DATA_COVERAGE"&&e.details.required_feature_observations===253);
});
test("Boundary date, missing symbols and causal holes are distinct coverage failures",()=>{
 const bounds=deriveExperimentBounds(engineRequest(request),data);
 const valid={...request,evaluation_start:bounds.earliest_supported_evaluation_start,evaluation_end_exclusive:"2023-02-03"};
 const plan=planP0WithData(valid,data);assert.equal(plan.normalized_request.evaluation_start,valid.evaluation_start);
 assert.throws(()=>planP0WithData({...request,etfs:["NOTINDATA"],mandate:{minimum_positions:1,maximum_positions:1,minimum_weight:.03}},data),(e:any)=>e.code==="DATA_COVERAGE"&&e.details.reason_code==="DATASET_SYMBOL_MISSING");
 const hole=structuredClone(data);delete hole.rows.find(r=>r.date==="2024-01-02")!.prices.SPY;
 assert.throws(()=>planP0WithData(request,hole),(e:any)=>e.code==="DATA_COVERAGE"&&/HISTORY/.test(e.details.reason_code));
});
test("Latest-starting selected ticker explains the current executable bound without moving requested dates",()=>{
 const late=structuredClone(data);
 for(const row of late.rows)if(row.date<"2023-06-19")delete row.prices.ETF10;
 const r={...request,regime_model:"HMM",training_window_months:12,evaluation_start:"2023-01-03",evaluation_end_exclusive:"2024-12-03"};
 const before=structuredClone(r),bounds=deriveExperimentBounds(engineRequest(r),late);
 assert.equal(bounds.dataset_start,"2022-01-03");
 assert.equal(bounds.common_required_data_start,"2023-06-19");
 assert.equal(bounds.required_symbol_first_observations.ETF10,"2023-06-19");
 assert.equal(bounds.required_symbol_first_observations.SPY,"2022-01-03");
 assert.deepEqual(bounds.limiting_symbols,["ETF10"]);
 assert.equal(bounds.training_ready_date,"2024-06-19");
 assert.equal(bounds.earliest_supported_evaluation_start,"2024-06-19");
 assert.throws(()=>planP0WithData(r,late),(e:any)=>e.code==="DATA_COVERAGE"&&e.details.earliest_supported_evaluation_start==="2024-06-19"&&e.details.limiting_symbols[0]==="ETF10");
 assert.deepEqual(r,before);
 const withoutLate={...r,etfs:r.etfs.filter((t:string)=>t!=="ETF10")};
 const earlier=deriveExperimentBounds(engineRequest(withoutLate),late);
 assert.equal(earlier.earliest_supported_evaluation_start,"2023-01-03");
 assert.ok(earlier.earliest_supported_evaluation_start<bounds.earliest_supported_evaluation_start);
});
