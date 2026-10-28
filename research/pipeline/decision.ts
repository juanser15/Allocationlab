import {canonicalHash,validateRiskSleeveAllocation} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {validateRiskMandate,composeMandatedPortfolio} from '../../artifacts/api-server/src/lib/allocation-core/risk-mandate';
import {allocateAssets} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/engine';
import {implementFactors} from '../../artifacts/api-server/src/lib/allocation-core/factors-engine/engine';
import {allocateStrategies} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/engine';
import {evaluateSignalQualityGate,signalHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/signal';
import {evaluatePortfolioRobustnessGate} from '../../artifacts/api-server/src/lib/allocation-core/gates/portfolio';
import {observeSource} from '../../artifacts/api-server/src/lib/allocation-core/gates/adapters';
import {policyHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/common';
import {candidateId} from '../allocation/spec';
import {gatePolicy} from '../allocation/decision';
import {resolveExecutionDate,type PriceRow} from '../../artifacts/api-server/src/lib/calculator';
import {VERSION,type DecisionContext,type Bundle,type PipelineDecision,type Stage,type Status,type FinalPortfolioTarget} from './contracts';
import type {Candidate} from '../allocation/contracts';
const id=(prefix:string,value:unknown)=>prefix+'_'+canonicalHash(value);
/** Ignore unavailable ranking observations in both identity and evaluation.
 * Root/native artifacts with future metadata are rejected, never backdated. */
export function scopedBundle(input:Bundle,date:string,cutoff:string):Bundle {
 const b=structuredClone(input);if(b.signal)b.signal.historical_rankings=b.signal.historical_rankings.filter(r=>r.as_of<date&&r.information_cutoff<=cutoff&&r.provenance.data_available_at<=cutoff);return b;
}
export function resolveBundle(history:Bundle[],date:string):Bundle|null {
 const prior=history.filter(b=>b.native&&b.native.input.as_of<=date&&b.native.input.information_cutoff<date&&b.native.input.provenance.data_available_at<date);
 prior.sort((a,b)=>a.native!.input.as_of.localeCompare(b.native!.input.as_of));
 if(prior.length>1&&prior.at(-1)!.native!.input.as_of===prior.at(-2)!.native!.input.as_of)throw Error('Ambiguous PIT bundle versions');
 return prior.at(-1)??null;
}
export function makeContext(candidate:Candidate,b:Bundle,prices:PriceRow[],lock:DecisionContext['selection_lock'],bps=0):DecisionContext {
 const date=b.native?.input.as_of??b.mandate.as_of,prior=prices.filter(p=>p.date<date),cutoff=prior.at(-1)?.date;
 if(!cutoff)throw Error('No strict prior-close information set');
 b=scopedBundle(b,date,cutoff);
 const native=b.native,eligible=native?.mode==='ASSETS'?native.input.assets:native?.mode==='FACTORS'?native.input.assets:native?.input.streams.flatMap(s=>Object.keys(s.unit_position_map.exposures))??[];
 const body:Omit<DecisionContext,'decision_context_id'>={schema_version:VERSION,decision_date:date,information_cutoff:cutoff,
 execution:{date:resolveExecutionDate(prices,date,'next_close')??'',convention:'next_close',rebalance_frequency:candidate.spec.clocks.rebalance},
 eligible_universe:[...new Set(eligible)].sort(),previous_holdings:native?.mode==='STRATEGY_STREAMS'?native.input.previous_allocation:native?.input.previous_holdings??null,
 candidate:structuredClone(candidate),selection_lock:structuredClone(lock),signal_gate_required:candidate.spec.signal_gate.required,signal_exemption_reason:candidate.spec.signal_gate.exemption_reason,
 risk_mandate_hash:canonicalHash(b.mandate),signal_policy_hash:b.signal_policy.policy_hash,robustness_policy_hash:b.robustness_policy.policy_hash,
 artifact_hashes:{native:native?canonicalHash(native):null,signal:b.signal?signalHash(b.signal):null,sensitivity:b.sensitivity?canonicalHash(b.sensitivity):null,original_risk_reference:canonicalHash(b.original_risk_reference)},
 costs:{bps,slippage_bps:0,basis:'ACTUAL_INSTRUMENT_NOTIONAL',embedded_strategy_costs:'NOT_RECHARGED',cash_yield_daily:0},
 provenance:{information_prices_hash:canonicalHash(prior),source_ids:[lock.source_id],bundle_hash:canonicalHash(b),code_version:VERSION}};
 return{...body,decision_context_id:id('decision',body)};
}
export function reidentify(c:DecisionContext):DecisionContext {const{decision_context_id,...body}=c;return{...body,decision_context_id:id('decision',body)};}
/** Every emitted stage has the same immutable context. No search/selector import. */
export function runDecision(c:DecisionContext,b:Bundle):PipelineDecision {
 b=scopedBundle(b,c.decision_date,c.information_cutoff);
 const before=canonicalHash({c,b}),d:PipelineDecision={decision_context_id:c.decision_context_id,context:structuredClone(c),status:'VALID',reason:null,stages:[],allocation:null,sleeve:null,signal_gate:null,signal_status:null,robustness_gate:null,projection:null,final_target:null,source_unchanged:true};
 const stage=(name:Stage,status:string,output:unknown)=>{const body={decision_context_id:c.decision_context_id,stage:name,status,input_hash:canonicalHash({context:c.decision_context_id,previous:d.stages.at(-1)?.output_hash??null}),output_hash:canonicalHash(output),output};d.stages.push({...body,stage_id:id('stage',body)});};
 const fail=(status:Status,reason:string)=>{d.status=status;d.reason=reason;d.final_target=null;d.source_unchanged=canonicalHash({c,b})===before;return d;};
 try {
 const errors:string[]=[],known=['schema_version','decision_context_id','decision_date','information_cutoff','execution','eligible_universe','previous_holdings','candidate','selection_lock','signal_gate_required','signal_exemption_reason','risk_mandate_hash','signal_policy_hash','robustness_policy_hash','artifact_hashes','costs','provenance'];
 if(Object.keys(c).some(k=>!known.includes(k)))errors.push('Unknown context field; no downstream cash/target override');
 if(c.schema_version!==VERSION||reidentify(c).decision_context_id!==c.decision_context_id)errors.push('Context version/identity mismatch');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(c.decision_date)||!(c.information_cutoff<c.decision_date)||!Number.isFinite(Date.parse(c.information_cutoff)))errors.push('Strict previous-close cutoff required');
 if(!['next_close','same_close','next_open'].includes(c.execution.convention)||c.execution.convention==='same_close'&&c.execution.date!==c.decision_date||c.execution.convention!=='same_close'&&!(c.execution.date>c.decision_date))errors.push('Execution convention/date mismatch');
 if(c.candidate.candidate_id!==candidateId(c.candidate.spec)||c.candidate.candidate_id!==c.selection_lock.candidate_id)errors.push('Persisted selected candidate cannot be replaced');
 if(c.candidate.spec.allocation_mode!==b.native?.mode&&b.native)errors.push('Mode/route mismatch');
 if(c.risk_mandate_hash!==canonicalHash(b.mandate)||c.provenance.bundle_hash!==canonicalHash(b)||c.artifact_hashes.native!==(b.native?canonicalHash(b.native):null)||c.artifact_hashes.signal!==(b.signal?signalHash(b.signal):null)||c.artifact_hashes.sensitivity!==(b.sensitivity?canonicalHash(b.sensitivity):null)||c.artifact_hashes.original_risk_reference!==canonicalHash(b.original_risk_reference))errors.push('Artifact/hash mismatch');
 if(c.signal_gate_required!==c.candidate.spec.signal_gate.required||c.signal_exemption_reason!==c.candidate.spec.signal_gate.exemption_reason)errors.push('Signal gate declaration mismatch');
 if(b.signal_policy.policy_hash!==c.signal_policy_hash||b.robustness_policy.policy_hash!==c.robustness_policy_hash||policyHash(b.signal_policy)!==c.signal_policy_hash||policyHash(b.robustness_policy)!==c.robustness_policy_hash)errors.push('Gate policy hash mismatch');
 if(c.signal_policy_hash!==gatePolicy(c.candidate.spec.signal_gate.policy,c.decision_date,c.information_cutoff).policy_hash||c.robustness_policy_hash!==gatePolicy(c.candidate.spec.portfolio_gate,c.decision_date,c.information_cutoff).policy_hash)errors.push('Gate policy differs from selected candidate definition');
 for(const p of [b.signal_policy,b.robustness_policy])if(p.information_cutoff>c.information_cutoff||p.as_of>c.decision_date||p.provenance.data_available_at>c.information_cutoff||!p.clock.evaluation_dates.includes(c.decision_date))errors.push('Gate policy PIT/decision clock mismatch');
 if(!Number.isFinite(c.costs.bps)||c.costs.bps<0||c.costs.slippage_bps!==0||c.costs.basis!=='ACTUAL_INSTRUMENT_NOTIONAL'||c.costs.embedded_strategy_costs!=='NOT_RECHARGED'||!Number.isFinite(c.costs.cash_yield_daily)||c.costs.cash_yield_daily<=-1)errors.push('Unsupported/nonfinite cost/cash-yield convention');
 if(!c.candidate.spec.costs.scenarios_bps.includes(c.costs.bps))errors.push('Cost scenario not declared in selected candidate');
 if(new Set(c.eligible_universe).size!==c.eligible_universe.length||!c.eligible_universe.length)errors.push('Missing/duplicate eligible universe');
 if(b.native&&(b.native.input.as_of!==c.decision_date||b.native.input.information_cutoff>c.information_cutoff||b.native.input.provenance.data_available_at>c.information_cutoff))errors.push('Native input envelope is future/misaligned');
 if(b.native){const n=b.native,ids=n.mode==='STRATEGY_STREAMS'?[...new Set(n.input.streams.flatMap(s=>Object.keys(s.unit_position_map.exposures)))].sort():[...n.input.assets].sort(),previous=n.mode==='STRATEGY_STREAMS'?n.input.previous_allocation:n.input.previous_holdings;
  if(canonicalHash(ids)!==canonicalHash([...c.eligible_universe].sort())||canonicalHash(previous)!==canonicalHash(c.previous_holdings))errors.push('Context holdings/universe differ from native information set');}
 stage('VALIDATE_CONTEXT',errors.length?'INVALID_INPUT':'VALID',{errors});if(errors.length)return fail('INVALID_INPUT',errors.join(';'));
 const mv=validateRiskMandate(b.mandate),ref=c.candidate.spec.risk_mandate;
 const mandateErrors=[...mv.errors];if(b.mandate.as_of!==c.decision_date||b.mandate.provenance.information_cutoff>c.information_cutoff||b.mandate.provenance.data_available_at>c.information_cutoff||b.mandate.policy_id!==ref.id||b.mandate.policy_version!==ref.version)mandateErrors.push('Mandate identity/PIT mismatch');
 stage('RESOLVE_MANDATE',mandateErrors.length?'INVALID_INPUT':'VALID',{mandate_hash:c.risk_mandate_hash,mandate:b.mandate,errors:mandateErrors});if(mandateErrors.length)return fail('INVALID_INPUT',mandateErrors.join(';'));
 if(c.signal_gate_required){
  if(!b.signal){stage('SIGNAL_GATE','INSUFFICIENT_DATA',{reason:'Missing required PIT signal'});return fail('SIGNAL_GATE_INSUFFICIENT_DATA','Missing required PIT signal');}
  if(c.eligible_universe.some(a=>!b.signal!.eligible_assets.includes(a))){stage('SIGNAL_GATE','INVALID_INPUT',{reason:'Signal universe does not cover tradable decision universe'});return fail('SIGNAL_GATE_INVALID_INPUT','Signal universe mismatch');}
  d.signal_gate=evaluateSignalQualityGate(b.signal,b.signal_policy);d.signal_status=d.signal_gate.status;stage('SIGNAL_GATE',d.signal_gate.status,d.signal_gate);
  if(d.signal_gate.status!=='PASS')return fail(('SIGNAL_GATE_'+d.signal_gate.status) as Status,'Required signal gate '+d.signal_gate.status);
 }else{
  const objective=c.candidate.spec.objective,nonforecast=!['MEAN_VARIANCE','MAX_SHARPE'].includes(String(objective.type));
  if(!c.signal_exemption_reason||!nonforecast||b.signal){stage('SIGNAL_GATE','INVALID_INPUT',{reason:'NOT_REQUIRED needs explicit nonforecast exemption and no consumed signal'});return fail('SIGNAL_GATE_INVALID_INPUT','Unauthorized NOT_REQUIRED');}
  d.signal_status='NOT_REQUIRED';stage('SIGNAL_GATE','NOT_REQUIRED',{reason:c.signal_exemption_reason});
 }
 if(!b.native){stage('ALLOCATOR','BLOCKED',{reason:'Missing canonical allocator artifacts'});return fail('BLOCKED_MISSING_ARTIFACTS','Missing canonical artifacts; no fallback');}
 const native=structuredClone(b.native),spec=c.candidate.spec;
 const actualObjective=native.mode==='FACTORS'?native.input.implementation:native.input.objective;
 const actualConstraints=native.mode==='STRATEGY_STREAMS'?{strategy_constraints:native.input.strategy_constraints,implementation_constraints:native.input.implementation_constraints}:native.input.constraints;
 if(canonicalHash(actualObjective)!==canonicalHash(spec.objective)||canonicalHash(actualConstraints)!==canonicalHash(spec.constraints)){stage('ALLOCATOR','INVALID_INPUT',{reason:'Candidate/native definition mismatch'});return fail('ALLOCATION_INVALID_INPUT','Candidate/native objective or constraints differ');}
 if(native.mode==='ASSETS')d.allocation={...native,result:allocateAssets(native.input)};
 else if(native.mode==='FACTORS'){const response=implementFactors(native.input);d.allocation={...native,result:response.result,source_status:response.status};}
 else d.allocation={...native,result:allocateStrategies(native.input)};
 const a=d.allocation,status=a.mode==='FACTORS'?a.source_status:a.result.status;stage('ALLOCATOR',status,a);
 if(status!=='VALID')return fail((status==='MAPPING_FAILURE'?'ALLOCATION_INFEASIBLE':'ALLOCATION_'+status) as Status,a.result?.errors.join(';')??'Native allocator failed');
 const sleeve=a.mode==='ASSETS'?a.result.sleeve:a.mode==='FACTORS'?a.result?.controller_projection?.sleeve:a.result.controller_projection;
 const rv=sleeve?validateRiskSleeveAllocation(sleeve):null;
 const riskValid=rv?.status==='VALID'&&sleeve?.risk_measurement_status==='AVAILABLE'&&sleeve.estimated_market_beta!==null&&sleeve.estimated_volatility!==null&&sleeve.beta_model!==null&&sleeve.beta_model.information_cutoff<=c.information_cutoff;
 stage('SLEEVE_RISK',riskValid?'VALID':'INSUFFICIENT_DATA',{sleeve:sleeve??null,errors:rv?.errors??['No controller-compatible certified sleeve risk']});
 if(!riskValid||!sleeve)return fail('MISSING_SLEEVE_RISK','Missing certified PIT sleeve risk/controller-compatible projection; no inferred beta or cash');d.sleeve=structuredClone(sleeve);
 const ah=canonicalHash(a),mh=canonicalHash(b.mandate);
 d.robustness_gate=evaluatePortfolioRobustnessGate(observeSource(a,b.mandate,b.sensitivity),b.robustness_policy);stage('ROBUSTNESS_GATE',d.robustness_gate.status,d.robustness_gate);
 if(canonicalHash(a)!==ah||canonicalHash(b.mandate)!==mh)return fail('INVALID_INPUT','Gate mutated allocation or RiskMandate');
 if(d.robustness_gate.status!=='PASS')return fail('ROBUSTNESS_GATE_FAIL','PortfolioRobustnessGate '+d.robustness_gate.hard_failures.concat(d.robustness_gate.policy_failures).join(';'));
 const projection=composeMandatedPortfolio(b.mandate,sleeve);d.projection=projection;stage('EXPOSURE_CONTROLLER',projection.status,projection);
 if(projection.status!=='VALID'||!projection.portfolio)return fail('EXPOSURE_INFEASIBLE',projection.errors.join(';'));
 const p=projection.portfolio;
 const body:Omit<FinalPortfolioTarget,'target_id'>={decision_context_id:c.decision_context_id,risk_mandate_hash:mh,allocation_id:sleeve.allocation_id,robustness_gate_id:d.robustness_gate.gate_id!,composition_id:p.composition_id,final_asset_weights:p.total_asset_weights!,implementation_cash:p.implied_cash_weight!,expected_final_beta:p.expected_final_beta,expected_final_volatility:p.expected_final_volatility,gross_exposure:p.gross_exposure!,net_exposure:p.net_exposure!,execution:structuredClone(c.execution),status:'VALID',provenance:structuredClone(c.provenance)};
 d.final_target={...body,target_id:id('target',body)};stage('FINAL_TARGET','VALID',d.final_target);
 d.source_unchanged=canonicalHash({c,b})===before;if(!d.source_unchanged)return fail('INVALID_INPUT','Upstream input mutated');return d;
 }catch(e){const last=d.stages.at(-1)?.stage,at=last==='SIGNAL_GATE'?'ALLOCATOR':last==='SLEEVE_RISK'?'ROBUSTNESS_GATE':last==='ROBUSTNESS_GATE'?'EXPOSURE_CONTROLLER':null;
  if(at)stage(at,'NUMERICAL_FAILURE',{reason:String(e)});
  const status:Status=at==='ALLOCATOR'?'ALLOCATION_NUMERICAL_FAILURE':at==='ROBUSTNESS_GATE'?'ROBUSTNESS_GATE_FAIL':at==='EXPOSURE_CONTROLLER'?'EXPOSURE_INFEASIBLE':'INVALID_INPUT';return fail(status,String(e));}
}
