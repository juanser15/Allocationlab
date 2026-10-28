import {BETA_DIVISION_TOLERANCE,CONTRACT_VERSION,RISK_CONTRACT_VERSION,LONG_ONLY,type RiskSleeveAllocationResult,type RiskMandate}from"../contracts";
import {canonicalHash}from"../validation";
import {composeMandatedPortfolio}from"../risk-mandate";
import type {PitSleeveEstimate}from"./estimators";
import {basicMetrics,type Diagnostic,type Pair}from"./analytics";
export function ratio(numerator:number,denominator:number):Diagnostic{
 if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||Math.abs(denominator)<=BETA_DIVISION_TOLERANCE)return{status:"INSUFFICIENT_DATA",value:null,observations:0,reason:"Nonfinite/zero/nearly-zero denominator"};
 const value=numerator/denominator;if(!Number.isFinite(value))return{status:"NUMERICAL_FAILURE",value:null,observations:0,reason:"Efficiency ratio overflow"};
 return{status:"VALID",value,observations:0,reason:null};
}
export function capitalEfficiency(cagr:number,volatility:number,average_beta:number){
 return{return_per_unit_beta:ratio(cagr,average_beta),cagr_per_average_beta:ratio(cagr,average_beta),volatility_per_unit_beta:ratio(volatility,average_beta),
 methodology_version:"capital-efficiency-1.0.0"};
}
/** Retrospective scalar matching of a frictionless SPY return reference; no q optimizer. */
export function matchedBenchmarkEfficiency(cagr:number,average_beta:number,market:Pair[],intervalStart:string){
 const unavailable=(reason:string):Diagnostic=>({status:"INSUFFICIENT_DATA",value:null,observations:market.length,reason});
 const gain=(lambda:number)=>basicMetrics(market.map(r=>({...r,portfolio:lambda*r.market+(1-lambda)*r.rf})),intervalStart).cagr;
 if(!Number.isFinite(cagr)||!Number.isFinite(average_beta)||Math.abs(average_beta)<=BETA_DIVISION_TOLERANCE)return{same_cagr_beta_saving:unavailable("Undefined/nearly-zero average beta"),same_beta_cagr_difference:unavailable("Undefined/nearly-zero average beta"),matched_cagr_beta:null};
 const derivative=(lambda:number)=>market.reduce((s,r)=>s+(r.market-r.rf)/(1+lambda*r.market+(1-lambda)*r.rf),0);
 const low=gain(0),high=gain(1);let matched:number|null=null;
 // Concavity: positive derivative at both endpoints certifies increasing growth.
 if(derivative(0)>0&&derivative(1)>0&&cagr>=low&&cagr<=high){let a=0,b=1;for(let i=0;i<80;i++){const m=(a+b)/2;if(gain(m)<cagr)a=m;else b=m;}matched=(a+b)/2;}
 return{same_cagr_beta_saving:matched===null?unavailable("No monotone/no-leverage same-CAGR reference available"):{status:"VALID",value:matched-average_beta,observations:market.length,reason:null}as Diagnostic,
 same_beta_cagr_difference:average_beta<0||average_beta>1?unavailable("Same-beta SPY reference would violate no leverage/short"): {status:"VALID",value:cagr-gain(average_beta),observations:market.length,reason:null}as Diagnostic,
 matched_cagr_beta:matched,methodology_version:"frictionless-SPY-matched-risk-CAGR-1.0.0"};
}
export function asymmetry(up:Diagnostic,down:Diagnostic,upCapture:Diagnostic,downCapture:Diagnostic){return{
 upside_downside_beta_ratio:up.value===null||down.value===null?{status:"INSUFFICIENT_DATA",value:null,observations:0,reason:"Missing conditioned beta"}as Diagnostic:ratio(up.value,down.value),
 downside_minus_upside_beta:up.value===null||down.value===null?null:down.value-up.value,
 upside_capture_minus_abs_downside:upCapture.value===null||downCapture.value===null?null:upCapture.value-Math.abs(downCapture.value)};}
export function measuredSleeve(q:Record<string,number>,pit:PitSleeveEstimate,benchmark="SPY"):RiskSleeveAllocationResult{
 if(pit.status!=="VALID")throw new Error("PIT estimate is not VALID");
 const provenance={data_hash:pit.data_hash,configuration_hash:pit.configuration_hash,source_ids:["SUPPLIED_ADJUSTED_RETURN_INFORMATION_SET",benchmark],data_available_at:pit.information_cutoff!,model:{id:pit.model,version:pit.version}},point={as_of:pit.information_cutoff!,information_cutoff:pit.information_cutoff!,provenance};
 const ids=Object.keys(q).sort();const body:Omit<RiskSleeveAllocationResult,"allocation_id">={schema_version:CONTRACT_VERSION,as_of:pit.decision_date,information_cutoff:pit.information_cutoff!,provenance,
 allocation_mode:"ASSETS",input_snapshot_id:"snapshot_"+canonicalHash({q,pit}),status:"VALID",asset_weight_units:"fraction_of_risk_capital",asset_weights_risk_sleeve:structuredClone(q),gross_exposure:ids.reduce((s,k)=>s+Math.abs(q[k]),0),net_exposure:ids.reduce((s,k)=>s+q[k],0),
 estimated_market_beta:pit.beta_sleeve,estimated_volatility:pit.annualized_volatility,asset_market_betas:Object.fromEntries(pit.asset_betas.map(b=>[b.asset,b.beta])),
 beta_model:{benchmark,estimation_window:{start:pit.window_start!,end:pit.window_end!,observations:pit.observations},estimator:"OLS_COV_VARIANCE_SAMPLE_V1",as_of:pit.information_cutoff!,information_cutoff:pit.information_cutoff!,data_hash:pit.data_hash},risk_model_provenance:point,risk_measurement_status:"AVAILABLE",explicit_unallocated_risk_budget:0,convention:structuredClone(LONG_ONLY),turnover_estimate:null,mode_specific_details:{allocation_mode:"ASSETS",asset_decision_weights:structuredClone(q)},warnings:[...pit.warnings],errors:[]};return{...body,allocation_id:"allocation_"+canonicalHash(body)};
}
export function betaMandate(target:number,sleeve:RiskSleeveAllocationResult):RiskMandate{return{schema_version:RISK_CONTRACT_VERSION,as_of:sleeve.as_of,policy_id:"DECLARED_RESEARCH_BETA_TARGET",policy_version:"AL02-1",state:null,confidence:null,confidence_semantics:"POLICY_DEFINED_SCORE",semantics:"SYSTEMATIC_RISK",market_benchmark:sleeve.beta_model!.benchmark,primary_target:{metric:"MARKET_BETA",target,lower_bound:null,upper_bound:null},constraints:{min_risky_allocation:0,max_risky_allocation:1,cash_floor:0,cash_ceiling:1,max_gross_exposure:1,max_net_exposure:1},exposure_policy:{controller:"LONG_ONLY_NO_LEVERAGE_V1",constraint_action:"REJECT"},provenance:{...sleeve.provenance,information_cutoff:sleeve.information_cutoff,generated_at:sleeve.as_of},legacy_source:null};}
/** Retrospective frictionless daily constant-weight return reference; NOT a ledger/backtest. */
export function constantBetaDiagnostic(market:Pair[],target:number,pit:PitSleeveEstimate){
 const sleeve=measuredSleeve({SPY:1},pit),composition=composeMandatedPortfolio(betaMandate(target,sleeve),sleeve);
 if(composition.status!=="VALID")return{status:composition.status,label:"RETROSPECTIVE_DIAGNOSTIC",composition,returns:[]as Pair[]};
 const lambda=composition.portfolio!.exposure_multiplier!;
 return{status:"VALID",label:"RETROSPECTIVE_DIAGNOSTIC",composition,returns:market.map(r=>({...r,portfolio:lambda*r.market+(1-lambda)*r.rf}))};
}
