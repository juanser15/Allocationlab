import {canonicalHash,metadata} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {allocateAssets,validateAssetsInput} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/engine';
import {localSensitivity} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/sensitivity';
import {validateFactors} from '../../artifacts/api-server/src/lib/allocation-core/factors-engine/validation';
import {validateInput as validateStrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/validation';
import {implementFactors} from '../../artifacts/api-server/src/lib/allocation-core/factors-engine/engine';
import {factorSensitivity} from '../../artifacts/api-server/src/lib/allocation-core/factors-engine/sensitivity';
import {allocateStrategies} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/engine';
import {sensitivity as strategySensitivity} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/sensitivity';
import {evaluateSignalQualityGate,signalHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/signal';
import {evaluatePortfolioRobustnessGate} from '../../artifacts/api-server/src/lib/allocation-core/gates/portfolio';
import {observeSource,assetSensitivity,factorSensitivityRows,strategySensitivityRows} from '../../artifacts/api-server/src/lib/allocation-core/gates/adapters';
import {policyHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/common';
import {composeMandatedPortfolio} from '../../artifacts/api-server/src/lib/allocation-core/risk-mandate';
import type {BacktestTargetContext} from '../../artifacts/api-server/src/lib/calculator';
import type {AllocationSource,GatePolicy} from '../../artifacts/api-server/src/lib/allocation-core/gates/contracts';
import {VERSION,type Candidate,type DataStore,type Decision,type Snapshot,type Clock,type Campaign} from './contracts';
import {Cache} from '../capital/storage';
export class ScopedCache {
 stores=new Map<string,Cache>();constructor(readonly root:string,readonly codeHash:string=VERSION){}
 get<T>(kind:string,key:unknown,calculate:()=>T):T{let store=this.stores.get(kind);if(!store){store=new Cache(this.root+'/'+kind);this.stores.set(kind,store);}return store.get({code_hash:this.codeHash,kind,inputs:key},calculate).value as T;}
 stats(){return Object.fromEntries([...this.stores].map(([k,v])=>[k,{hits:v.hits,misses:v.misses,computations:v.fits}]));}
}
export const period=(date:string,clock:Clock)=>clock==='once'?'once':clock==='yearly'?date.slice(0,4):clock==='quarterly'?date.slice(0,4)+'Q'+Math.floor((Number(date.slice(5,7))-1)/3):date.slice(0,7);
export function gatePolicy(template:GatePolicy,date:string,cutoff:string):GatePolicy{const p=structuredClone(template);p.as_of=cutoff;p.information_cutoff=cutoff;p.provenance.data_available_at=cutoff;p.clock.evaluation_dates=[date];p.policy_hash=policyHash(p);return p;}
export function allowedSnapshots(data:DataStore,candidate:Candidate,date:string){return data.snapshots.filter(s=>s.reference_id===candidate.spec.risk_model.id&&canonicalHash(s.risk_definition)===canonicalHash(candidate.spec.risk_model)&&s.source.mode===candidate.spec.allocation_mode&&s.decision_date<=date&&s.source.input.information_cutoff<date&&s.source.input.provenance.data_available_at<date).sort((a,b)=>a.decision_date.localeCompare(b.decision_date));}
export function availability(candidate:Candidate,data:DataStore){const s=candidate.spec;if(s.allocation_mode==='FACTORS'&&!s.factor_target)return'BLOCKED_MISSING_FACTOR_ARTIFACTS';if(s.allocation_mode==='STRATEGY_STREAMS'&&!s.strategy_universe)return'BLOCKED_MISSING_STRATEGY_ARTIFACTS';if(!data.snapshots.some(x=>x.reference_id===s.risk_model.id&&canonicalHash(x.risk_definition)===canonicalHash(s.risk_model)&&x.source.mode===s.allocation_mode))return s.allocation_mode==='FACTORS'?'BLOCKED_MISSING_FACTOR_ARTIFACTS':s.allocation_mode==='STRATEGY_STREAMS'?'BLOCKED_MISSING_STRATEGY_ARTIFACTS':'BLOCKED_MISSING_RISK_ARTIFACTS';
 if(['MEAN_VARIANCE','MAX_SHARPE'].includes(String(s.objective.type))&&(!s.expected_return||!data.snapshots.some(x=>x.reference_id===s.risk_model.id&&'expected_returns' in x.source.input&&x.source.input.expected_returns!==null)))return'BLOCKED_MISSING_PIT_EXPECTED_RETURNS';return null;}
/** A decision session can see only snapshots published before its own decision.
 * Risk/forecast clocks choose external artifacts; ARE fits no model/normalizer. */
export class DecisionSession {
 anchors=new Map<string,Snapshot>();
 constructor(readonly candidate:Candidate,readonly data:DataStore,readonly cache:ScopedCache,readonly modelEndExclusive:string|null=null){}
 private external(date:string,clock:Clock,kind:string,eligible:Snapshot[]){const key=kind+'|'+period(date,clock);if(!this.anchors.has(key))this.anchors.set(key,eligible.at(-1)!);return this.anchors.get(key)!;}
 decide(date:string,available:DataStore['prices'],context:BacktestTargetContext):Decision {
 const s=this.candidate.spec,cutoff=available.at(-1)?.date??null;
 const d:Decision={date,cutoff,status:'INSUFFICIENT_DATA',reason:null,eligible_universe:[],input_hash:null,allocation:null,signal_gate:null,portfolio_gate:null,mandate_hash:null,raw:null,normalized:null,projection:null,sensitivity:null};
 const fail=(status:Decision['status'],reason:string)=>{d.status=status;d.reason=reason;return d;};
 if(!cutoff||available.some(x=>x.date>=date)||context.asOf!==cutoff)return fail('INVALID_INPUT','Strict previous-close cutoff/context mismatch');
 const labelled=this.data.snapshots.filter(z=>z.reference_id===s.risk_model.id&&z.decision_date===date);if(labelled.some(z=>z.source.input.as_of!==date))return fail('INVALID_INPUT','Source decision date does not match native input as_of');
 const eligible=allowedSnapshots(this.data,this.candidate,date),current=eligible.find(x=>x.decision_date===date);if(eligible.filter(z=>z.decision_date===date).length>1)return fail('INVALID_INPUT','Ambiguous PIT decision versions');if(!current)return fail('BLOCKED','Missing exact PIT decision bundle; never substitute a current/final snapshot');
 const modelEligible=this.modelEndExclusive?eligible.filter(z=>z.decision_date<this.modelEndExclusive!&&z.source.input.information_cutoff<this.modelEndExclusive!):eligible;if(!modelEligible.length)return fail('BLOCKED','Missing training-only risk/forecast artifacts');
 const externalRisk=this.external(date,this.modelEndExclusive?'once':s.clocks.risk_recalibration,'risk',modelEligible),externalForecast=this.external(date,this.modelEndExclusive?'once':s.clocks.forecast_recalibration,'forecast',modelEligible),externalSignal=this.external(date,s.clocks.signal,'signal',eligible);
 // Validate untouched source information sets BEFORE making any decision envelope.
 // Republishing must never turn a future/invalid native artifact into a valid one.
 for(const snapshot of [current,externalRisk,externalForecast]){const source=snapshot.source,errors=source.mode==='ASSETS'?validateAssetsInput(source.input):source.mode==='FACTORS'?validateFactors(source.input):validateStrategyInput(source.input);if(errors.length)return fail('INVALID_INPUT','Original PIT artifact validation: '+errors.join(';'));}
 d.model_reference={original_training_cutoff:externalRisk.source.input.information_cutoff,original_artifact_as_of:externalRisk.source.input.risk_model.as_of,original_artifact_hash:canonicalHash(externalRisk.source.input.risk_model),original_artifact:structuredClone(externalRisk.source.input.risk_model),envelope_semantics:'REPUBLISHED_UNCHANGED_MODEL_NO_REFIT'};
 const x=structuredClone(current.source.input);x.as_of=date;x.information_cutoff=cutoff;
 x.risk_model=this.cache.get('risk_artifacts',{model:s.risk_model,window:s.estimation,content:externalRisk.source.input.risk_model,cutoff:externalRisk.source.input.information_cutoff},()=>structuredClone(externalRisk.source.input.risk_model)) as typeof x.risk_model;
 // Native AL03 requires a common decision-information envelope. Re-publish the
 // unchanged trained artifact at the decision cutoff; retain the original artifact in Decision.model_reference and its data
 // hash and estimation-window end. This does NOT refit or add OOS observations.
 if(current.source.mode==='ASSETS'){x.risk_model.information_cutoff=cutoff;x.risk_model.as_of=cutoff;}
 if(current.source.mode==='ASSETS'&&externalRisk.source.mode==='ASSETS'&&'assets'in x){x.assets=[...externalRisk.source.input.assets];x.beta_estimates=structuredClone(externalRisk.source.input.beta_estimates);x.beta_estimates.information_cutoff=cutoff;x.beta_estimates.as_of=cutoff;x.beta_estimates.beta_model.information_cutoff=cutoff;x.beta_estimates.beta_model.as_of=cutoff;if(x.beta_estimates.beta_model.estimation_window.observations!==s.estimation.window_sessions||x.beta_estimates.beta_model.estimation_window.observations<s.estimation.minimum_observations)return fail('BLOCKED','BLOCKED_MISSING_DECLARED_ESTIMATION_WINDOW');}
 if(current.source.mode==='FACTORS'&&externalRisk.source.mode==='FACTORS'&&'loadings'in x){x.assets=[...externalRisk.source.input.assets];x.target=structuredClone(externalRisk.source.input.target);x.loadings=structuredClone(externalRisk.source.input.loadings);x.tracking_metric=structuredClone(externalRisk.source.input.tracking_metric);x.beta_estimates=structuredClone(externalRisk.source.input.beta_estimates);}
 if(current.source.mode==='STRATEGY_STREAMS'&&externalRisk.source.mode==='STRATEGY_STREAMS'&&'streams'in x){x.strategy_betas=structuredClone(externalRisk.source.input.strategy_betas);x.asset_betas=structuredClone(externalRisk.source.input.asset_betas);x.asset_covariance=structuredClone(externalRisk.source.input.asset_covariance);x.incremental_cost=null;}
 if('expected_returns'in x){const forecastInput=externalForecast.source.input;if(['MEAN_VARIANCE','MAX_SHARPE'].includes(String(s.objective.type))){if(!s.expected_return||!('expected_returns'in forecastInput)||!forecastInput.expected_returns)return fail('BLOCKED','BLOCKED_MISSING_PIT_EXPECTED_RETURNS');const artifact=forecastInput.expected_returns;x.expected_returns=this.cache.get('forecast_artifacts',{reference:s.expected_return,artifact},()=>structuredClone(artifact)) as typeof x.expected_returns;}else x.expected_returns=null;}
 if(current.source.mode==='ASSETS'&&'expected_returns'in x&&x.expected_returns){x.expected_returns.information_cutoff=cutoff;x.expected_returns.as_of=cutoff;}
 const policy=gatePolicy(s.signal_gate.policy,date,cutoff);
 if(s.signal_gate.required){if(this.modelEndExclusive&&externalSignal.signal_fit_cutoff!=='NO_FIT_OBSERVED_FEATURES'&&(!externalSignal.signal_fit_cutoff||externalSignal.signal_fit_cutoff>=this.modelEndExclusive))return fail('BLOCKED','BLOCKED_MISSING_TRAIN_ONLY_SIGNAL_MODEL_PROVENANCE');if(!externalSignal.signal)return fail('INSUFFICIENT_DATA','Missing required PIT signal artifact');if('assets'in x&&x.assets.some(a=>!externalSignal.signal!.eligible_assets.includes(a)))return fail('INVALID_INPUT','Signal universe does not cover allocation universe');const original=externalSignal.signal,metaErrors:string[]=[];metadata(original as unknown as Record<string,unknown>,'original signal',metaErrors);metadata(original.current_ranking as unknown as Record<string,unknown>,'original ranking',metaErrors,original,true);metadata(original.signal_matrix as unknown as Record<string,unknown>,'original matrix',metaErrors,original,true);if(metaErrors.length||original.as_of>date||original.information_cutoff>cutoff)return fail('INVALID_INPUT','Original signal PIT metadata: '+metaErrors.join(';'));const signal=structuredClone(original);signal.as_of=date;signal.information_cutoff=cutoff;try{signal.artifact_hash=signalHash(signal);}catch(e){return fail('INVALID_INPUT','Noncanonical signal information set: '+String(e));}d.signal_gate=this.cache.get('signal_gate',{signal_information_hash:signal.artifact_hash,policy},()=>evaluateSignalQualityGate(signal,policy));if(d.signal_gate.status!=='PASS')return fail(d.signal_gate.status==='FAIL'?'GATE_FAIL':d.signal_gate.status as Decision['status'],'SignalQualityGate '+d.signal_gate.status);}
 const point={as_of:cutoff,information_cutoff:cutoff,provenance:{...x.provenance,data_available_at:cutoff}};
 let source:AllocationSource;
 if(current.source.mode==='ASSETS'&&'assets'in x&&'objective'in x){x.objective=s.objective as typeof x.objective;x.constraints=structuredClone(s.constraints) as unknown as typeof x.constraints;
  const values=Object.fromEntries(x.assets.map(a=>[a,(context.quantities[a]??0)*(available.at(-1)!.prices[a]??0)])),total=Object.values(values).reduce((a,b)=>a+b,0);x.previous_holdings=total>0?{...point,units:'fraction_of_risk_capital',asset_weights:Object.fromEntries(x.assets.map(a=>[a,values[a]/total]))}:null;d.eligible_universe=[...x.assets];source={mode:'ASSETS',input:x,result:this.cache.get('allocations',{family:'AL03',input:x},()=>allocateAssets(x))};
 }else if(current.source.mode==='FACTORS'&&'loadings'in x){x.implementation=s.objective as unknown as typeof x.implementation;x.constraints=structuredClone(s.constraints) as unknown as typeof x.constraints;d.eligible_universe=[...x.assets];const response=this.cache.get('allocations',{family:'AL04',input:x},()=>implementFactors(x));source={mode:'FACTORS',input:x,result:response.result,source_status:response.status};
 }else if(current.source.mode==='STRATEGY_STREAMS'&&'streams'in x){x.objective=s.objective as typeof x.objective;x.strategy_constraints=structuredClone(s.constraints.strategy_constraints) as typeof x.strategy_constraints;x.implementation_constraints=structuredClone(s.constraints.implementation_constraints) as typeof x.implementation_constraints;d.eligible_universe=x.streams.map(z=>z.strategy_instance_id);source={mode:'STRATEGY_STREAMS',input:x,result:this.cache.get('allocations',{family:'AL05',input:x},()=>allocateStrategies(x))};
 }else return fail('INVALID_INPUT','Native source mode/shape mismatch');
 d.allocation=source;d.input_hash=canonicalHash(source.input);const result=source.result,status=source.mode==='FACTORS'?source.source_status:result!.status;if(status!=='VALID')return fail(status as Decision['status'],result?.errors.join(';')??'Native allocator failure');
 const q=source.mode==='ASSETS'?source.result.weights!:source.mode==='FACTORS'?source.result!.asset_weights_risk_sleeve!:source.result.allocations!;
 const reuse=canonicalHash(s.objective)===current.certified_objective_hash&&canonicalHash(s.constraints)===current.certified_constraints_hash&&canonicalHash(q)===current.certified_weights_hash&&canonicalHash(x.risk_model)===canonicalHash(current.source.input.risk_model);
 let stress=current.sensitivity;
 if(!reuse){stress=this.cache.get('sensitivities',{source},()=>source.mode==='ASSETS'?assetSensitivity(localSensitivity(source.input,source.result),['MIN_VARIANCE','ERC'].includes(source.input.objective.type)):source.mode==='FACTORS'?factorSensitivityRows(factorSensitivity(source.input,source.result!) as unknown as Record<string,unknown>[]):strategySensitivityRows(strategySensitivity(source.input,source.result) as unknown as Record<string,unknown>[]));}
 d.sensitivity=stress;
 const mandate=structuredClone(current.mandate),mh=canonicalHash(mandate);d.mandate_hash=mh;
 if(mandate.policy_id!==s.risk_mandate.id||mandate.policy_version!==s.risk_mandate.version)return fail('INVALID_INPUT','Mandate reference mismatch');
 const observation=observeSource(source,mandate,stress),robustPolicy=gatePolicy(s.portfolio_gate,date,cutoff);d.portfolio_gate=this.cache.get('portfolio_gate',{observation,policy:robustPolicy},()=>evaluatePortfolioRobustnessGate(observation,robustPolicy));
 if(d.portfolio_gate.status!=='PASS')return fail(d.portfolio_gate.status==='FAIL'?'GATE_FAIL':d.portfolio_gate.status as Decision['status'],'PortfolioRobustnessGate '+d.portfolio_gate.status+' '+d.portfolio_gate.hard_failures.concat(d.portfolio_gate.policy_failures).join(';'));
 const sleeve=source.mode==='ASSETS'?source.result.sleeve:source.mode==='FACTORS'?source.result!.controller_projection?.sleeve:source.result.controller_projection;
 if(!sleeve)return fail('INSUFFICIENT_DATA','Missing certified controller-compatible sleeve');const projection=this.cache.get('projections',{mandate,sleeve},()=>composeMandatedPortfolio(mandate,sleeve));d.projection=projection;if(canonicalHash(mandate)!==mh)throw Error('RiskMandate mutated');if(projection.status!=='VALID')return fail(projection.status as Decision['status'],'ExposureController '+projection.errors.join(';'));
 d.raw=structuredClone(sleeve.asset_weights_risk_sleeve);d.normalized=structuredClone(projection.portfolio!.total_asset_weights!);
 if(source.mode==='STRATEGY_STREAMS'){
  // Economic execution requires genuine stream unit-NAV paths and certified PIT maps.
  // Instrument snapshots alone cannot stand in for strategy historical P&L.
  if(!current.stream_unit_nav||current.stream_execution_certification!=='PIT_MAP_HISTORY_MATCHES_UNIT_NAV_AND_NO_EXTRA_INTERNAL_RESIDUAL')return fail('BLOCKED','BLOCKED_MISSING_STRATEGY_EXECUTION_HISTORY');
 }
 d.status='VALID';return d;
 }
}
