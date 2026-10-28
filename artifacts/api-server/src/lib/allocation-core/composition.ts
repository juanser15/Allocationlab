import { CONTRACT_VERSION, WEIGHT_TOLERANCE, NUMERICAL_TOLERANCE,
  type PointInTime, type RiskSleeveAllocationResult, type AllocationConvention,
  type AllocationConstraints, type AllocationResponse, type CompositionResponse,
  type AllocationStatus, type ModeDetails, type FactorImplementationResult,
  type AlphaAggregationResult, type FinalPortfolio } from "./contracts";
import { canonicalHash, validateAssetsInput, validateFactorsInput, validateAlphaStreamsInput,
  validateAssetDecision, validateAlphaDecision, validateCapitalOutput,
  validateRiskSleeveAllocation, exposureChecks, timestamp } from "./validation";

const orderedValues=(v:Record<string,number>)=>Object.keys(v).sort().map(k=>v[k]);
const sum=(v:Record<string,number>)=>orderedValues(v).reduce((s,w)=>s+w,0);
const gross=(v:Record<string,number>)=>orderedValues(v).reduce((s,w)=>s+Math.abs(w),0);
const point=(p:PointInTime):PointInTime=>structuredClone({as_of:p.as_of,information_cutoff:p.information_cutoff,provenance:p.provenance});
function reject(status:AllocationStatus,errors:string[]):AllocationResponse {return {status,result:null,errors};}
function result(p:PointInTime,mode:RiskSleeveAllocationResult["allocation_mode"],snapshot:unknown,
  c:AllocationConvention,w:Record<string,number>|null,status:AllocationStatus,errors:string[],details:ModeDetails,residual=0):AllocationResponse {
  let snapshotHash:string;
  try{snapshotHash=canonicalHash(snapshot);}catch{ return reject("INVALID_INPUT",[...errors,"Input cannot be canonized; no snapshot/provenance invented"]); }
  const body:Omit<RiskSleeveAllocationResult,"allocation_id">={...point(p),schema_version:CONTRACT_VERSION,
    allocation_mode:mode,input_snapshot_id:"snapshot_"+snapshotHash,status,asset_weight_units:"fraction_of_risk_capital",
    asset_weights_risk_sleeve:status==="VALID"?structuredClone(w):null,gross_exposure:status==="VALID"?gross(w!):null,
    net_exposure:status==="VALID"?sum(w!):null,estimated_market_beta:null,estimated_volatility:null,
    asset_market_betas:null,beta_model:null,risk_model_provenance:null,risk_measurement_status:"NOT_ESTIMATED",
    explicit_unallocated_risk_budget:residual,convention:structuredClone(c),
    turnover_estimate:null,mode_specific_details:structuredClone(details),warnings:[],errors:[...errors]};
  const out={...body,allocation_id:"allocation_"+canonicalHash(body)};
  return {status,result:out,errors:[...errors]};
}
function feasibility(w:Record<string,number>,constraints:AllocationConstraints,residual:number):string[] {
  const e=exposureChecks(w,constraints.convention,residual);
  for(const [id,b] of Object.entries(constraints.asset_bounds)){const value=w[id]??0;
    if(value<b.min-WEIGHT_TOLERANCE||value>b.max+WEIGHT_TOLERANCE)e.push(`Asset ${id} outside declared risk-sleeve bounds`);}
  return e;
}
export function allocationFromAssets(input:unknown,decision:unknown):AllocationResponse {
  const validated=validateAssetsInput(input);if(!validated.value)return reject(validated.status,validated.errors);
  const i=validated.value,d=validateAssetDecision(decision,i,i.candidate_assets.map(a=>a.instrument_id));
  if(!d.value)return result(i,"ASSETS",{input,decision},i.constraints.convention,null,d.status,d.errors,{allocation_mode:"ASSETS",failure:d.errors});
  const w=d.value.asset_decision_weights,res=d.value.explicit_unallocated_risk_budget,e=feasibility(w,i.constraints,res);
  const status:AllocationStatus=!Number.isFinite(gross(w))||!Number.isFinite(sum(w))?"NUMERICAL_FAILURE":e.length?"INFEASIBLE":"VALID";
  return result(i,"ASSETS",{input,decision},i.constraints.convention,w,status,e,{allocation_mode:"ASSETS",asset_decision_weights:w},res);
}
/** Explicit unique-system implementation; NOT an optimizer or least-squares solver. */
export function allocationFromFactors(input:unknown):AllocationResponse {
  const validated=validateFactorsInput(input);if(!validated.value)return reject(validated.status,validated.errors);
  const i=validated.value,m=i.loading_matrix,n=m.instrument_ids.length;
  let status:AllocationStatus="VALID",errors:string[]=[],solution:number[]|null=null;
  if(m.factor_ids.length!==n){status="MAPPING_FAILURE";errors=["UNIQUE_SQUARE_EXACT requires equal factor/asset dimensions; no pseudoinverse or implicit criterion"];}else{
    const rows=m.values.map((row,k)=>[...row,i.target.exposures[m.factor_ids[k]]]),scale=Math.max(...m.values.flat().map(Math.abs));
    for(let column=0;column<n;column++){
      let pivot=column;for(let row=column+1;row<n;row++)if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column]))pivot=row;
      if(scale===0||Math.abs(rows[pivot][column])<=NUMERICAL_TOLERANCE*scale){status="MAPPING_FAILURE";errors=["Singular/ill-conditioned mapping: unique implementation not certified"];break;}
      [rows[pivot],rows[column]]=[rows[column],rows[pivot]];
      const divisor=rows[column][column];rows[column]=rows[column].map(v=>v/divisor);
      for(let row=0;row<n;row++)if(row!==column){const multiplier=rows[row][column];rows[row]=rows[row].map((v,k)=>v-multiplier*rows[column][k]);}
      if(rows.some(row=>row.some(v=>!Number.isFinite(v)))){status="NUMERICAL_FAILURE";errors=["Nonfinite exact mapping arithmetic"];break;}
    }
    if(status==="VALID")solution=rows.map(row=>row[n]);
  }
  let w:Record<string,number>|null=null,achieved:Record<string,number>|null=null,residual:Record<string,number>|null=null,error:number|null=null;
  if(solution){
    w=Object.fromEntries(m.instrument_ids.map((id,k)=>[id,solution![k]]));
    achieved=Object.fromEntries(m.factor_ids.map((id,k)=>[id,m.values[k].reduce((s,v,j)=>s+v*solution![j],0)]));
    residual=Object.fromEntries(m.factor_ids.map(id=>[id,achieved![id]-i.target.exposures[id]]));error=Math.hypot(...Object.values(residual));
    if(!Number.isFinite(error)){status="NUMERICAL_FAILURE";errors=["Nonfinite factor residual"];}
    else if(error>WEIGHT_TOLERANCE*Math.max(1,Math.hypot(...m.factor_ids.map(id=>i.target.exposures[id])))){status="NUMERICAL_FAILURE";errors=["Exact mapping residual exceeds declared tolerance"];}
    else{errors=feasibility(w,i.constraints,0);if(errors.length)status="INFEASIBLE";}
  }
  const details:FactorImplementationResult={...point(i),factor_model_identity:{...point(i.factor_model),model_id:i.factor_model.model_id,model_version:i.factor_model.model_version},target_factor_exposures:structuredClone(i.target.exposures),
    achieved_factor_exposures:status==="VALID"?achieved:null,implementation_asset_weights:status==="VALID"?w:null,
    asset_weight_units:"fraction_of_risk_capital",tracking_residual:status==="VALID"?residual:null,tracking_error:status==="VALID"?error:null,
    tracking_error_definition:"EUCLIDEAN_EXPOSURE_RESIDUAL_NOT_ANNUALIZED_RISK",feasibility_status:status,method:"UNIQUE_SQUARE_EXACT",regularization:"NONE",
    matrix_date:m.as_of,matrix_information_cutoff:m.information_cutoff,matrix_hash:m.matrix_hash,mapping_provenance:structuredClone(m.provenance)};
  return result(i,"FACTORS",input,i.constraints.convention,w,status,errors,{allocation_mode:"FACTORS",implementation:details});
}
export function allocationFromAlphaStreams(input:unknown,decision:unknown):AllocationResponse {
  const validated=validateAlphaStreamsInput(input);if(!validated.value)return reject(validated.status,validated.errors);
  const i=validated.value,d=validateAlphaDecision(decision,i,i.alpha_streams.map(a=>a.alpha_stream_id));
  if(!d.value)return result(i,"ALPHA_STREAMS",{input,decision},i.constraints.convention,null,d.status,d.errors,{allocation_mode:"ALPHA_STREAMS",failure:d.errors});
  const allocations=d.value.alpha_allocations,contributions:Record<string,Record<string,number>>={},w:Record<string,number>={};
  let beforeNetting=0,res=d.value.explicit_unallocated_risk_budget;
  for(const stream of i.alpha_streams){
    const capital=allocations[stream.alpha_stream_id];res+=capital*stream.unit_position_map.explicit_unallocated_stream_capital;
    contributions[stream.alpha_stream_id]={};
    for(const [asset,exposure] of Object.entries(stream.unit_position_map.asset_exposures).sort(([a],[b])=>a<b?-1:a>b?1:0)){
      const value=capital*exposure;contributions[stream.alpha_stream_id][asset]=value;w[asset]=(w[asset]??0)+value;beforeNetting+=Math.abs(value);}
  }
  const e=feasibility(w,i.constraints,res);
  if(!Number.isFinite(beforeNetting))e.push("Nonfinite pre-netting gross exposure");
  const numerical=!Number.isFinite(beforeNetting)||Object.values(w).some(v=>!Number.isFinite(v));
  if(numerical)return result(i,"ALPHA_STREAMS",{input,decision},i.constraints.convention,null,"NUMERICAL_FAILURE",e,{allocation_mode:"ALPHA_STREAMS",failure:e},res);
  const status:AllocationStatus=e.length?"INFEASIBLE":"VALID";
  const details:AlphaAggregationResult={...point(i),alpha_allocations:structuredClone(allocations),aggregated_asset_exposures:structuredClone(w),
    pre_netting_gross_exposure:beforeNetting,contributions,stream_versions:Object.fromEntries(i.alpha_streams.map(s=>[s.alpha_stream_id,s.version])),
    position_map_provenance:Object.fromEntries(i.alpha_streams.map(s=>[s.alpha_stream_id,point(s.unit_position_map)]))};
  return result(i,"ALPHA_STREAMS",{input,decision},i.constraints.convention,w,status,e,{allocation_mode:"ALPHA_STREAMS",aggregation:details},res);
}
/** @deprecated LEGACY_RISK_FRACTION adapter only; primary composer is composeMandatedPortfolio. */
export function composeFinalPortfolio(capitalOutput:unknown,riskSleeveAllocation:unknown):CompositionResponse {
  const capital=validateCapitalOutput(capitalOutput);
  if(!capital.value)return {status:capital.status,portfolio:null,errors:capital.errors};
  const c=capital.value,risk=validateRiskSleeveAllocation(riskSleeveAllocation),r=risk.value;
  let status:AllocationStatus=r?r.status:risk.status,errors=[...(r?r.errors:risk.errors)];
  if(r){
    if(timestamp(r.as_of)!==timestamp(c.as_of)||timestamp(r.information_cutoff)!>timestamp(c.information_cutoff)!) {status="INVALID_INPUT";errors.push("Allocation as_of must match capital and cannot exceed its information cutoff");}
  }
  let w:Record<string,number>|null=null,g:number|null=null,n:number|null=null;
  const residual=r?c.risk_budget*r.explicit_unallocated_risk_budget:null;
  if(r&&status==="VALID"){
    // Exactly one capital scaling. The cash budget never enters a sleeve optimizer.
    w=Object.fromEntries(Object.entries(r.asset_weights_risk_sleeve!).map(([id,value])=>[id,c.risk_budget*value]));g=gross(w);n=sum(w);
    if(!Number.isFinite(g)||!Number.isFinite(n)){status="NUMERICAL_FAILURE";errors.push("Nonfinite final exposure");}
    if(r.explicit_unallocated_risk_budget!==0){status="INFEASIBLE";errors.push("Unallocated risk capital is explicit; it cannot be reassigned to global cash");}
    if(r.convention.funding==="NET_ONE_WITH_GLOBAL_CASH"&&Math.abs(n+c.cash_budget-1)>WEIGHT_TOLERANCE){status="INFEASIBLE";errors.push("Net assets + upstream cash do not reconcile to total capital");}
    if(status!=="VALID"){w=null;g=null;n=null;}
  }
  const provenance={...c.provenance,data_hash:canonicalHash({capital:c.provenance,risk:r?.provenance??null}),
    configuration_hash:canonicalHash({capital_policy:[c.policy_id,c.policy_version],allocation:r?.allocation_id??null}),
    source_ids:[...new Set([...c.provenance.source_ids,...(r?.provenance.source_ids??[])])].sort(),
    data_available_at:r&&timestamp(r.provenance.data_available_at)!>timestamp(c.provenance.data_available_at)!?r.provenance.data_available_at:c.provenance.data_available_at,
    model:null};
  const body:Omit<FinalPortfolio,"portfolio_id">={...point(c),provenance,schema_version:CONTRACT_VERSION,status,semantics:"LEGACY_RISK_FRACTION",
    capital_policy:{id:c.policy_id,version:c.policy_version},capital_output_hash:canonicalHash(c),risk_allocation_id:r?.allocation_id??null,units:"fraction_of_total_nav",
    total_asset_weights:w,total_cash_weight:c.cash_budget,gross_exposure:g,net_exposure:n,explicit_unallocated_risk_budget:residual,
    balance_convention:r?(r.convention.funding==="NET_ONE_WITH_GLOBAL_CASH"?"NET_ASSET_WEIGHTS_PLUS_CASH_EQUAL_ONE":"EXPOSURES_NOT_BALANCE_SHEET"):null,
    warnings:r?[...r.warnings]:[],errors};
  const portfolio={...body,portfolio_id:"portfolio_"+canonicalHash(body)};
  return {status,portfolio,errors};
}
