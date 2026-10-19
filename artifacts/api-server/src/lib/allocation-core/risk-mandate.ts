import { RISK_CONTRACT_VERSION, WEIGHT_TOLERANCE, BETA_DIVISION_TOLERANCE,
  type RiskMandate, type ValidationResult, type SleeveRiskEstimate, type AllocationResponse,
  type RiskSleeveAllocationResult, type MandatedCompositionResponse, type ExposureControllerResult,
  type PointInTime, type AllocationStatus } from "./contracts";
import { canonicalHash, canonicalJson, object, metadata, timestamp, validateRiskSleeveAllocation } from "./validation";
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const text=(v:unknown)=>typeof v==="string"&&v.trim().length>0;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function finished<T>(input:unknown,errors:string[]):ValidationResult<T>{
  try{canonicalJson(input);}catch{errors.push("Noncanonical/nonfinite input");}
  return errors.length?{status:"INVALID_INPUT",value:null,errors}:{status:"VALID",value:structuredClone(input) as T,errors:[]};
}
export function mandatePoint(m:RiskMandate):PointInTime {
  const {information_cutoff,generated_at,...provenance}=m.provenance;
  return {as_of:m.as_of,information_cutoff,provenance};
}
export function validateRiskMandate(input:unknown):ValidationResult<RiskMandate>{
  const e:string[]=[],r=object(input,["schema_version","as_of","policy_id","policy_version","state","confidence","confidence_semantics","semantics","market_benchmark","primary_target","constraints","exposure_policy","provenance","legacy_source"],"RiskMandate",e);
  if(r.schema_version!==RISK_CONTRACT_VERSION)e.push("RiskMandate schema version mismatch");
  if(!text(r.policy_id)||!text(r.policy_version)||!("state"in r))e.push("Policy identity/version and explicit state required");
  if(!["POLICY_DEFINED_SCORE","PROBABILITY"].includes(String(r.confidence_semantics)))e.push("Confidence semantics must be explicit");
  if(r.confidence!==null&&(!finite(r.confidence)||r.confidence_semantics==="PROBABILITY"&&(r.confidence<0||r.confidence>1)))e.push("Invalid confidence");
  const p=object(r.provenance,["information_cutoff","generated_at","data_hash","configuration_hash","source_ids","data_available_at","model"],"mandate provenance",e);
  const {information_cutoff,generated_at,...prov}=p;metadata({as_of:r.as_of,information_cutoff,provenance:prov},"mandate",e);
  const gen=timestamp(generated_at),asof=timestamp(r.as_of);if(gen===null||asof!==null&&gen<asof)e.push("Invalid generated_at");
  const t=object(r.primary_target,["metric","target","lower_bound","upper_bound"],"primary target",e);
  if(!["MARKET_BETA","VOLATILITY","RISK_FRACTION"].includes(String(t.metric))||!finite(t.target))e.push("Finite named primary target required");
  for(const k of ["lower_bound","upper_bound"])if(t[k]!==null&&!finite(t[k]))e.push(`Invalid ${k}`);
  if(finite(t.lower_bound)&&finite(t.upper_bound)&&t.lower_bound>t.upper_bound)e.push("Incompatible primary target bounds");
  if(t.metric==="VOLATILITY"&&finite(t.target)&&t.target<0)e.push("Negative volatility target");
  if(t.metric==="RISK_FRACTION"&&finite(t.target)&&(t.target<0||t.target>1))e.push("Legacy risk fraction outside [0,1]");
  if(t.metric==="RISK_FRACTION"?r.semantics!=="LEGACY":r.semantics!=="SYSTEMATIC_RISK")e.push("RISK_FRACTION is LEGACY only; beta/volatility are SYSTEMATIC_RISK");
  if(t.metric==="MARKET_BETA"?!text(r.market_benchmark):r.market_benchmark!==null&&!text(r.market_benchmark))e.push("Market beta mandate requires an explicit benchmark");
  const c=object(r.constraints,["min_risky_allocation","max_risky_allocation","cash_floor","cash_ceiling","max_gross_exposure","max_net_exposure"],"mandate constraints",e);
  for(const k of ["min_risky_allocation","max_risky_allocation","cash_floor","cash_ceiling","max_gross_exposure","max_net_exposure"])if(!finite(c[k])||c[k]<0)e.push(`Invalid constraint ${k}`);
  for(const k of ["min_risky_allocation","max_risky_allocation","cash_floor","cash_ceiling"])if(finite(c[k])&&c[k]>1)e.push(`No-leverage v1 allocation/cash bound ${k} exceeds 1`);
  if(finite(c.min_risky_allocation)&&finite(c.max_risky_allocation)&&c.min_risky_allocation>c.max_risky_allocation||finite(c.cash_floor)&&finite(c.cash_ceiling)&&c.cash_floor>c.cash_ceiling)e.push("Inverted allocation/cash bounds");
  const policy=object(r.exposure_policy,["controller","constraint_action"],"exposure policy",e);
  if(policy.controller!=="LONG_ONLY_NO_LEVERAGE_V1"||!["REJECT","CLIP"].includes(String(policy.constraint_action)))e.push("Explicit supported exposure policy required");
  if(r.semantics==="LEGACY"){
    const legacy=object(r.legacy_source,["capital_output_hash","risk_budget","cash_budget"],"legacy source",e);
    if(typeof legacy.capital_output_hash!=="string"||!/^([a-f0-9]{64})$/.test(legacy.capital_output_hash)||!finite(legacy.risk_budget)||!finite(legacy.cash_budget)||legacy.risk_budget<0||legacy.cash_budget<0||legacy.risk_budget>1||legacy.cash_budget>1||Math.abs(legacy.risk_budget+legacy.cash_budget-1)>WEIGHT_TOLERANCE||legacy.risk_budget!==t.target)e.push("Invalid legacy capital source");
    if(policy.constraint_action!=="REJECT"||c.min_risky_allocation!==t.target||c.max_risky_allocation!==t.target||c.cash_floor!==legacy.cash_budget||c.cash_ceiling!==legacy.cash_budget)e.push("Legacy adapter must preserve risk/cash literally with no clipping");
  }else if(r.legacy_source!==null)e.push("Systematic risk mandate cannot carry legacy cash primitive");
  return finished(input,e);
}

/** Attach supplied PIT risk estimates without fitting/optimizing q. */
export function attachSleeveRisk(sleeve:unknown,estimate:unknown):AllocationResponse {
  const v=validateRiskSleeveAllocation(sleeve);if(!v.value)return {status:v.status,result:null,errors:v.errors};
  const s=v.value;if(s.status!=="VALID")return {status:s.status,result:s,errors:s.errors};
  const e:string[]=[],r=object(estimate,["schema_version","as_of","information_cutoff","provenance","units","allocation_weights_hash","asset_market_betas","estimated_market_beta","estimated_volatility","beta_model"],"sleeve risk estimate",e);
  metadata(r,"sleeve risk estimate",e,s,true);
  if(r.schema_version!==RISK_CONTRACT_VERSION||r.units!=="UNSCALED_SLEEVE_ANNUAL_VOLATILITY"||r.allocation_weights_hash!==canonicalHash(s.asset_weights_risk_sleeve))e.push("Risk estimate version/units/weights hash mismatch");
  const {allocation_id,...body}=s;
  const candidate={...body,estimated_market_beta:r.estimated_market_beta,estimated_volatility:r.estimated_volatility,
    asset_market_betas:r.asset_market_betas,beta_model:r.beta_model,risk_model_provenance:{as_of:r.as_of,information_cutoff:r.information_cutoff,provenance:r.provenance},risk_measurement_status:"AVAILABLE"};
  let out:unknown=null;try{out={...candidate,allocation_id:"allocation_"+canonicalHash(candidate)};}catch{e.push("Nonfinite/noncanonical risk estimate");}
  if(e.length)return {status:"INVALID_INPUT",result:null,errors:e};
  const checked=validateRiskSleeveAllocation(out);return {status:checked.status,result:checked.value,errors:checked.errors};
}

/** Minimal scalar controller, not an optimizer. Full-invested, long-only, no leverage. */
export function composeMandatedPortfolio(mandate:unknown,sleeve:unknown):MandatedCompositionResponse {
  const mv=validateRiskMandate(mandate),sv=validateRiskSleeveAllocation(sleeve);
  if(!mv.value||!sv.value)return {status:"INVALID_INPUT",portfolio:null,errors:[...mv.errors,...sv.errors]};
  const m=mv.value,s=sv.value,mp=mandatePoint(m),metric=m.primary_target.metric;
  let status:AllocationStatus=s.status;const failures=[...s.errors];let multiplier:number|null=null,clipped=false;
  const reject=(reason:string,kind:AllocationStatus="INFEASIBLE")=>{if(status==="VALID")status=kind;failures.push(reason);};
  if(timestamp(s.as_of)!==timestamp(m.as_of)||timestamp(s.information_cutoff)!>timestamp(mp.information_cutoff)!)reject("Capital/allocation clocks disagree or sleeve information is future","INVALID_INPUT");
  if(s.convention.kind!=="LONG_ONLY_FULLY_INVESTED"||s.convention.funding!=="NET_ONE_WITH_GLOBAL_CASH")reject("Primary controller v1 supports long-only fully-invested sleeves only","MAPPING_FAILURE");
  if(s.explicit_unallocated_risk_budget!==0)reject("Unallocated risk budget cannot become implicit cash");
  const beta=s.estimated_market_beta,vol=s.estimated_volatility;
  const denominator=metric==="MARKET_BETA"?beta:metric==="VOLATILITY"?vol:1;
  if(metric!=="RISK_FRACTION"&&s.risk_measurement_status!=="AVAILABLE")reject("Unscaled sleeve beta/volatility is not estimated","INSUFFICIENT_DATA");
  if(metric==="MARKET_BETA"&&s.beta_model&&s.beta_model.benchmark!==m.market_benchmark)reject("Sleeve beta benchmark differs from mandate","INVALID_INPUT");
  if(status==="VALID"){
    if(denominator===null||!finite(denominator))reject("Missing/nonfinite unscaled risk estimate","INSUFFICIENT_DATA");
    else if(metric==="MARKET_BETA"&&Math.abs(denominator)<=BETA_DIVISION_TOLERANCE||metric==="VOLATILITY"&&denominator===0){
      if(m.primary_target.target!==0)reject("Zero/nearly-zero sleeve risk cannot implement nonzero target");else multiplier=0;
    }else multiplier=m.primary_target.target/denominator;
  }
  const q=s.asset_weights_risk_sleeve??{},ids=Object.keys(q).sort(),net=ids.reduce((a,k)=>a+q[k],0),gross=ids.reduce((a,k)=>a+Math.abs(q[k]),0),c=m.constraints;
  let lo=Math.max(0,c.min_risky_allocation/net,(1-c.cash_ceiling)/net);
  let hi=Math.min(1/net,c.max_risky_allocation/net,(1-c.cash_floor)/net,c.max_gross_exposure/gross,c.max_net_exposure/net);
  if(denominator!==null&&finite(denominator)&&denominator!==0){
    const t=m.primary_target;
    if(t.lower_bound!==null){if(denominator>0)lo=Math.max(lo,t.lower_bound/denominator);else hi=Math.min(hi,t.lower_bound/denominator);}
    if(t.upper_bound!==null){if(denominator>0)hi=Math.min(hi,t.upper_bound/denominator);else lo=Math.max(lo,t.upper_bound/denominator);}
  }else if((m.primary_target.lower_bound!==null&&m.primary_target.lower_bound>0)||(m.primary_target.upper_bound!==null&&m.primary_target.upper_bound<0))reject("Zero risk does not satisfy primary target bounds");
  if(status==="VALID"&&multiplier!==null){
    if(!finite(multiplier)||!finite(lo)||!finite(hi))reject("Nonfinite exposure arithmetic","NUMERICAL_FAILURE");
    else if(lo>hi+WEIGHT_TOLERANCE)reject("Declared risk/allocation/cash constraints have empty intersection");
    else if(multiplier<lo-WEIGHT_TOLERANCE||multiplier>hi+WEIGHT_TOLERANCE){
      if(m.exposure_policy.constraint_action==="CLIP"){multiplier=Math.max(lo,Math.min(hi,multiplier));clipped=true;}
      else reject("Requested risk target violates declared allocation/cash/gross/net/target bounds; no clipping authorized");
    }
  }
  let weights:Record<string,number>|null=null,cash:number|null=null,g:number|null=null,n:number|null=null,finalBeta:number|null=null,finalVol:number|null=null;
  if(status==="VALID"&&multiplier!==null){
    weights=Object.fromEntries(ids.map(id=>[id,multiplier!*q[id]]));n=ids.reduce((a,id)=>a+weights![id],0);g=ids.reduce((a,id)=>a+Math.abs(weights![id]),0);
    cash=m.semantics==="LEGACY"?m.legacy_source!.cash_budget:1-n;
    finalBeta=beta===null?null:multiplier*beta;finalVol=vol===null?null:multiplier*vol;
    if(![n,g,cash,...Object.values(weights),...(finalBeta===null?[]:[finalBeta]),...(finalVol===null?[]:[finalVol])].every(finite))reject("Nonfinite final portfolio","NUMERICAL_FAILURE");
    if(cash<0||cash>1||Math.abs(n+cash-1)>WEIGHT_TOLERANCE)reject("Implementation cash/NAV does not reconcile");
    if(g>c.max_gross_exposure+WEIGHT_TOLERANCE||n>c.max_net_exposure+WEIGHT_TOLERANCE||n<c.min_risky_allocation-WEIGHT_TOLERANCE||n>c.max_risky_allocation+WEIGHT_TOLERANCE||cash<c.cash_floor-WEIGHT_TOLERANCE||cash>c.cash_ceiling+WEIGHT_TOLERANCE)reject("Final exposures violate declared constraints");
    if(metric==="MARKET_BETA"&&!clipped&&finalBeta!==null&&Math.abs(finalBeta-m.primary_target.target)>WEIGHT_TOLERANCE)reject("Final beta does not reconcile to mandate","NUMERICAL_FAILURE");
  }
  if(status!=="VALID"){weights=null;cash=null;g=null;n=null;finalBeta=null;finalVol=null;multiplier=null;}
  const body:Omit<ExposureControllerResult,"composition_id">={schema_version:RISK_CONTRACT_VERSION,controller:"LONG_ONLY_NO_LEVERAGE_V1",status,
    semantics:m.semantics,mandate_hash:canonicalHash(m),allocation_id:s.allocation_id,requested_target:structuredClone(m.primary_target),
    exposure_multiplier:multiplier,total_asset_weights:weights,implied_cash_weight:cash,expected_final_beta:finalBeta,expected_final_volatility:finalVol,
    beta_sleeve:beta,volatility_sleeve:vol,beta_model:structuredClone(s.beta_model),risk_model_provenance:structuredClone(s.risk_model_provenance),
    gross_exposure:g,net_exposure:n,explicit_unallocated_risk_budget:s.explicit_unallocated_risk_budget,target_clipped:clipped,
    constraint_failures:failures,warnings:clipped?["EXPLICIT_CLIP: requested target was not achieved"]:[],as_of:m.as_of,information_cutoff:mp.information_cutoff,
    provenance:{data_hash:canonicalHash({mandate:m.provenance,sleeve:s.provenance,risk:s.risk_model_provenance}),configuration_hash:canonicalHash({mandate:canonicalHash(m),sleeve:s.allocation_id}),
      source_ids:[...new Set([...mp.provenance.source_ids,...s.provenance.source_ids,...(s.risk_model_provenance?.provenance.source_ids??[])])].sort(),
      data_available_at:[mp.provenance.data_available_at,s.provenance.data_available_at,...(s.risk_model_provenance?[s.risk_model_provenance.provenance.data_available_at]:[])].reduce((latest,d)=>timestamp(d)!>timestamp(latest)!?d:latest),model:{id:"ExposureController",version:"LONG_ONLY_NO_LEVERAGE_V1"}}};
  const portfolio={...body,composition_id:"composition_"+canonicalHash(body)};return {status,portfolio,errors:failures};
}
