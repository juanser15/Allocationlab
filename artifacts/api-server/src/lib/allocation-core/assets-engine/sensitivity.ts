import {allocateAssets,objectiveValue} from './engine';
import {canonicalHash} from '../validation';
import type {AssetsEngineInput,EngineResult} from './contracts';
export const SENSITIVITY_CONFIGURATION={version:'allocation-local-sensitivity-1.0.0',covariance_diagonal_shrink:[.01,.05],mean_scale:[.9,1.1],gamma_scale:[.8,1,1.2],rank_noise_fraction_of_minimum_gap:.01};
export function localSensitivity(input:AssetsEngineInput,base:EngineResult) {
 if(base.status!=='VALID')return [];
 const scenarios:Array<{id:string;input:AssetsEngineInput}>=[];
 for(const level of SENSITIVITY_CONFIGURATION.covariance_diagonal_shrink){const x=structuredClone(input);x.risk_model.covariance=x.risk_model.covariance.map((r,i)=>r.map((v,j)=>i===j?v:(1-level)*v));x.risk_model.provenance.configuration_hash=canonicalHash({base:input.risk_model.provenance.configuration_hash,shrink:level});scenarios.push({id:'covariance-diagonal-shrink-'+level,input:x});}
 if(input.objective.type==='MEAN_VARIANCE')for(const scale of SENSITIVITY_CONFIGURATION.gamma_scale){const x=structuredClone(input);x.objective={type:'MEAN_VARIANCE',gamma:input.objective.gamma*scale};scenarios.push({id:'gamma-scale-'+scale,input:x});}
 if(input.expected_returns&&(input.objective.type==='MEAN_VARIANCE'||input.objective.type==='MAX_SHARPE')) {
  for(const scale of SENSITIVITY_CONFIGURATION.mean_scale){const x=structuredClone(input);for(const a of x.assets)x.expected_returns!.values[a]*=scale;scenarios.push({id:'mu-scale-'+scale,input:x});}
  const distinct=[...new Set(Object.values(input.expected_returns.values))].sort((a,b)=>a-b),gaps=distinct.slice(1).map((v,i)=>v-distinct[i]),gap=gaps.length?Math.min(...gaps):0,x=structuredClone(input);
  // Deterministic monotone rank offsets; tied values receive identical offsets. No invented financial forecast.
  for(const a of x.assets){const rank=distinct.indexOf(x.expected_returns!.values[a]);x.expected_returns!.values[a]+=.01*gap*(rank-(distinct.length-1)/2)/Math.max(1,distinct.length);}
  scenarios.push({id:gap?'mu-rank-preserving-noise':'mu-rank-noise-NO_DISTINCT_GAP',input:x});
 }
 return scenarios.map(({id,input:x})=>{const solved=allocateAssets(x),ids=[...input.assets].sort();return{scenario:id,status:solved.status,errors:solved.errors,
  sensitivity_configuration_hash:canonicalHash(SENSITIVITY_CONFIGURATION),input_hash:solved.input_hash,result_id:solved.result_id,
  weight_l1:solved.weights?ids.reduce((s,a)=>s+Math.abs(solved.weights![a]-base.weights![a]),0):null,
  max_weight_change:solved.weights?Math.max(...ids.map(a=>Math.abs(solved.weights![a]-base.weights![a]))):null,
  beta_change:solved.diagnostics?solved.diagnostics.beta_sleeve-base.diagnostics!.beta_sleeve:null,
  vol_change:solved.diagnostics?solved.diagnostics.annualized_volatility-base.diagnostics!.annualized_volatility:null,
  objective_change:solved.objective_value===null?null:solved.objective_value-base.objective_value!,
  original_objective_change:solved.weights?objectiveValue(input,solved.weights)-base.objective_value!:null,
  perturbed_objective_value:solved.objective_value,weights:solved.weights,solver:solved.solver};});
}
