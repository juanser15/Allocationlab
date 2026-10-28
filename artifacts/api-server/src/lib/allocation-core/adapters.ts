/** Explicit LEGACY boundaries. No B2 invocation, optimizer, or production connection. */
import { CONTRACT_VERSION, RISK_CONTRACT_VERSION, type RiskMandateResponse, type AllocationResponse } from "./contracts";
import { validateCapitalOutput, validateRiskSleeveAllocation, canonicalHash } from "./validation";
import { validateRiskMandate } from "./risk-mandate";
export function adaptLegacyCapitalOutput(input:unknown):RiskMandateResponse {
  const v=validateCapitalOutput(input);if(!v.value)return {status:v.status,mandate:null,errors:v.errors};
  const c=v.value,m={schema_version:RISK_CONTRACT_VERSION,as_of:c.as_of,policy_id:c.policy_id,policy_version:c.policy_version,
    state:structuredClone(c.state),confidence:c.confidence,confidence_semantics:c.confidence_semantics,semantics:"LEGACY",market_benchmark:null,
    primary_target:{metric:"RISK_FRACTION",target:c.risk_budget,lower_bound:null,upper_bound:null},
    constraints:{min_risky_allocation:c.risk_budget,max_risky_allocation:c.risk_budget,cash_floor:c.cash_budget,cash_ceiling:c.cash_budget,max_gross_exposure:1,max_net_exposure:1},
    exposure_policy:{controller:"LONG_ONLY_NO_LEVERAGE_V1",constraint_action:"REJECT"},
    provenance:{...structuredClone(c.provenance),information_cutoff:c.information_cutoff,generated_at:c.generated_at},
    legacy_source:{capital_output_hash:canonicalHash(c),risk_budget:c.risk_budget,cash_budget:c.cash_budget}};
  const checked=validateRiskMandate(m);return {status:checked.status,mandate:checked.value,errors:checked.errors};
}
export function upgradeLegacyRiskSleeve(input:unknown):AllocationResponse {
  if(!input||typeof input!=="object"||Array.isArray(input))return {status:"INVALID_INPUT",result:null,errors:["Legacy sleeve must be an object"]};
  const r=input as Record<string,unknown>;
  if(r.schema_version!=="allocation-core-1.0.0")return {status:"INVALID_INPUT",result:null,errors:["Only pre-amendment 1.0.0 sleeve adapter supported"]};
  const {allocation_id,...old}=r;
  try{
    if(allocation_id!=="allocation_"+canonicalHash(old))return {status:"INVALID_INPUT",result:null,errors:["Legacy sleeve content hash mismatch"]};
    const body={...old,schema_version:CONTRACT_VERSION,estimated_market_beta:null,estimated_volatility:null,
      asset_market_betas:null,beta_model:null,risk_model_provenance:null,risk_measurement_status:"NOT_ESTIMATED",
      warnings:[...(Array.isArray(old.warnings)?old.warnings:[]),"LEGACY_UNMEASURED_SLEEVE: market beta is not inferred from capital weights"]};
    const v=validateRiskSleeveAllocation({...body,allocation_id:"allocation_"+canonicalHash(body)});
    return {status:v.value?.status??v.status,result:v.value,errors:v.errors};
  }catch{return {status:"INVALID_INPUT",result:null,errors:["Legacy sleeve cannot be canonized"]};}
}
