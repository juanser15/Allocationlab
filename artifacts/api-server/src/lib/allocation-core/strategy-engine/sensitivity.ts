import {allocateStrategies} from './engine';
import {mapHash,riskHash,muHash} from './validation';
import type {StrategyInput,StrategyResult} from './contracts';
export const SENSITIVITY_METHOD='DECLARED_LOCAL_PERTURBATIONS_NO_OPTIMIZATION_OF_ROBUSTNESS_V1';
export function sensitivity(input:StrategyInput,baseline:StrategyResult){
 if(baseline.status!=='VALID')return[];
 const perturbations:Array<{name:string;value:number;input:StrategyInput}>=[],add=(name:string,value:number,f:(x:StrategyInput)=>void)=>{const x=structuredClone(input);f(x);perturbations.push({name,value,input:x});};
 for(const rho of [.01,.05])add('covariance_diagonal_shrink',rho,x=>{x.risk_model.covariance=x.risk_model.covariance.map((r,i)=>r.map((z,j)=>i===j?z:(1-rho)*z));x.risk_model.artifact_hash=riskHash(x.risk_model);});
 if(input.expected_returns&&['MEAN_VARIANCE','MAX_SHARPE'].includes(input.objective.type)){
  for(const scale of [.9,1.1])add('mu_scale',scale,x=>{for(const id of Object.keys(x.expected_returns!.values))x.expected_returns!.values[id]*=scale;x.expected_returns!.artifact_hash=muHash(x.expected_returns!);});
  add('mu_rank_preserving_noise',.001,x=>{const values=x.expected_returns!.values,ids=Object.keys(values).sort((a,b)=>values[a]-values[b]||a.localeCompare(b)),unique=[...new Set(ids.map(id=>values[id]))],gaps=unique.slice(1).map((v,i)=>v-unique[i]),size=gaps.length?Math.min(...gaps)*.001:0;for(const id of ids)values[id]+=size*unique.indexOf(values[id]);x.expected_returns!.artifact_hash=muHash(x.expected_returns!);});
 }
 for(const cap of [.4,.8])add('first_strategy_max_bound',cap,x=>{const id=[...x.streams.map(s=>s.strategy_instance_id)].sort()[0];x.strategy_constraints.bounds[id]={min:0,max:cap};});
 for(const scale of [.99,1.01])add('H_column_exposure_scale',scale,x=>{for(const s of x.streams){const m=s.unit_position_map;for(const id of Object.keys(m.exposures))m.exposures[id]*=scale;
   // Changing H cannot silently normalize exposure. Funding is explicitly changed to an
   // exposure snapshot requiring signed/financing semantics, residual remains stream-held.
   m.funding='SIGNED_OR_EXTERNAL_FINANCING';m.map_hash=mapHash(m);}});
 if(input.incremental_cost)for(const bps of [0,10])add('incremental_actual_notional_cost_bps',bps,x=>{x.incremental_cost!.bps=bps;});
 return perturbations.map(p=>{const r=allocateStrategies(p.input),a=baseline.allocations!,x=baseline.aggregation!.instrument_exposures,ok=r.status==='VALID';return{label:'SYNTHETIC_LOCAL_SENSITIVITY',methodology:SENSITIVITY_METHOD,perturbation:p.name,level:p.value,status:r.status,errors:r.errors,
 allocation_l1:ok?Object.keys(a).reduce((s,id)=>s+Math.abs(a[id]-r.allocations![id]),0):null,max_stream_allocation_change:ok?Math.max(...Object.keys(a).map(id=>Math.abs(a[id]-r.allocations![id]))):null,
 stream_vol_change:ok?r.return_risk!.annualized_volatility-baseline.return_risk!.annualized_volatility:null,return_beta_change:ok&&r.strategy_return_beta!==null&&baseline.strategy_return_beta!==null?r.strategy_return_beta-baseline.strategy_return_beta:null,
 instrument_exposure_l1:ok?Object.keys(x).reduce((s,id)=>s+Math.abs(x[id]-r.aggregation!.instrument_exposures[id]),0):null,position_beta_change:ok&&r.current_position_beta!==null&&baseline.current_position_beta!==null?r.current_position_beta-baseline.current_position_beta:null,
 gross_change:ok?r.aggregation!.post_net_gross-baseline.aggregation!.post_net_gross:null,net_change:ok?r.aggregation!.post_net_net-baseline.aggregation!.post_net_net:null,incremental_cost_change:ok&&r.incremental_cost&&baseline.incremental_cost?r.incremental_cost.amount-baseline.incremental_cost.amount:null,result:r,input:p.input};});
}
