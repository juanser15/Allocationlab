/** Deterministic SYNTHETIC supplied artifacts; no forecasts generated. */
import {syntheticInput} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/artifacts';
import {allocateAssets} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/engine';
import {localSensitivity} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/sensitivity';
import {qaPolicy,signalFixture,rehashSignal} from '../../artifacts/api-server/src/lib/allocation-core/gates/fixtures';
import {assetSensitivity} from '../../artifacts/api-server/src/lib/allocation-core/gates/adapters';
import {betaMandate} from '../../artifacts/api-server/src/lib/allocation-core/risk-analytics/diagnostics';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {generateRebalanceDates} from '../../artifacts/api-server/src/lib/calculator';
import {candidateId} from './spec';
import type {DataStore,CandidateSpec,Campaign,Snapshot} from './contracts';
export function candidateTemplate(mode:CandidateSpec['allocation_mode']='ASSETS'):CandidateSpec {
 const ref=(id:string)=>({id,version:'1',configuration_hash:canonicalHash({id,declared_before_run:true})});
 const gate=qaPolicy('PORTFOLIO_ROBUSTNESS');gate.robustness_methodology.sensitivity_required_families=['COVARIANCE'];
 // Rehash because policy definitions, not thresholds inferred from performance.
 const {policyHash}=requirePolicy();gate.policy_hash=policyHash(gate);
 return{allocation_mode:mode,objective:{type:'EQUAL_WEIGHT'},constraints:{asset_bounds:{},group_caps:[],max_active_names:null,turnover_cap:null},risk_model:{id:'SYNTHETIC_PIT_RISK',version:'1.0.0',configuration_hash:canonicalHash({synthetic:true})},expected_return:null,factor_target:null,strategy_universe:null,signal_gate:{required:false,policy:qaPolicy('SIGNAL_QUALITY'),exemption_reason:'NO_SIGNAL_CONSUMED: supplied covariance/equal weight only'},portfolio_gate:gate,clocks:{signal:'monthly',rebalance:'monthly',risk_recalibration:'monthly',forecast_recalibration:'monthly',gate:'EACH_ALLOCATION_DECISION'},estimation:{window_sessions:252,minimum_observations:252},costs:{scenarios_bps:[0],slippage_bps:0,basis:'ACTUAL_INSTRUMENT_NOTIONAL',embedded_strategy_costs:'ALREADY_NET_NOT_RECHARGED'},risk_mandate:{id:'DECLARED_RESEARCH_BETA_TARGET',version:'AL02-1',configuration_hash:canonicalHash({target_beta:.3,action:'REJECT',controller:'LONG_ONLY_NO_LEVERAGE_V1'})},model_config_hashes:{allocator:canonicalHash({certified:'AL03'})}};
}
import {policyHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/common';
function requirePolicy(){return{policyHash};}
export function syntheticData():DataStore {
 const prices:DataStore['prices']=[];let values={AAA:100,BBB:100,CCC:100,DDD:100,SPY:100};let i=0;
 for(let d=new Date('2019-01-01');d<new Date('2024-01-01');d.setUTCDate(d.getUTCDate()+1)){if([0,6].includes(d.getUTCDay()))continue;
  const m=.0002+.008*Math.sin(i*.43)+.003*Math.cos(i*.17);values={AAA:values.AAA*(1+.8*m+.001*Math.cos(i*.9)),BBB:values.BBB*(1+1*m+.002*Math.sin(i*.8)),CCC:values.CCC*(1+1.2*m-.001*Math.cos(i*.7)),DDD:values.DDD*(1+1.4*m+.0015*Math.sin(i*.6)),SPY:values.SPY*(1+m)};prices.push({date:d.toISOString().slice(0,10),prices:{...values}});i++;}
 const snapshots:Snapshot[]=[];for(const date of generateRebalanceDates(prices,'monthly',0,'2021-01-01')){const past=prices.filter(p=>p.date<date),cutoff=past.at(-1)!.date,ids=['AAA','BBB','CCC','DDD'];let input=syntheticInput([[.0001,0,0,0],[0,.0002,0,0],[0,0,.0003,0],[0,0,0,.0004]],{type:'EQUAL_WEIGHT'});
  let text=JSON.stringify(input);for(let j=0;j<4;j++)text=text.replaceAll('ASSET_'+j,ids[j]);text=text.replaceAll('2020-12-31',cutoff).replaceAll('2021-01-01',date);input=JSON.parse(text);input.beta_estimates.beta_model.estimation_window.start=past.at(-253)!.date;
  const result=allocateAssets(input);if(result.status!=='VALID')throw Error(result.errors.join(';'));const source={mode:'ASSETS' as const,input,result},signal=signalFixture();
  const shift=(v:unknown):unknown=>Array.isArray(v)?v.map(shift):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,z])=>[k,shift(z)])):typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)?v==='2021-01-01'?date:v==='2020-12-31'?cutoff:new Date(Date.parse(cutoff)+Date.parse(v)-Date.parse('2020-12-31')).toISOString().slice(0,10):v;
  const sig=shift(signal) as typeof signal;rehashSignal(sig);
  snapshots.push({reference_id:'SYNTHETIC_PIT_RISK',risk_definition:candidateTemplate().risk_model,decision_date:date,source,mandate:betaMandate(.3,result.sleeve!),signal:sig,signal_fit_cutoff:'NO_FIT_OBSERVED_FEATURES',sensitivity:assetSensitivity(localSensitivity(input,result),false),certified_objective_hash:canonicalHash(input.objective),certified_constraints_hash:canonicalHash(input.constraints),certified_weights_hash:canonicalHash(result.weights)});
 }
 return{prices,snapshots,provenance:'SYNTHETIC_QA_ONLY; constants/paths supplied independently, not alpha research'};
}
export function smallCampaign(mode:Campaign['validation_mode']='NESTED_WALK_FORWARD'):Campaign {
 const base=candidateTemplate(),min=structuredClone(base);min.objective={type:'MIN_VARIANCE'};
 return{campaign_id:'SYNTHETIC_'+mode,validation_mode:mode,window_type:'ROLLING',dates:{start:'2021-01-01',end_exclusive:'2023-01-01'},train_months:12,test_months:6,step_months:6,inner_train_months:6,inner_test_months:3,inner_step_months:3,search:'GRID',candidate_budget:200,hard_max_candidates:200,space:[{base},{base:min}],selection:{version:'ARE_SELECTION_1.0.0',metric:'CAGR',lexicographic:[],utility_risk_aversion:null,selection_scenario_bps:0,hurdles:{}},controls:{candidate_ids:[candidateId(base)],same_average_beta:true,same_volatility:true,label:'DECLARED_BEFORE_RUN'},cost_scenarios_bps:[0],cash_yield_daily:0,risk_free_daily:0,benchmark:'SPY',max_jobs:1000,decay_horizons:[1,5,10,20,63],cross_sectional:{enabled:false,buckets:10},data_reference:'SYNTHETIC_ONLY'};
}
