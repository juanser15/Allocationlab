/** Reuse frozen BANK01 mathematical controls and certified AL05 external-input
 * fixtures. No new financial strategy, promotion, signal, forecast fit or search. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {canonicalHash,seal} from '../governance/common';
import {fixture as strategyFixture,rehash} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/fixtures';
import {fixture as pipelineFixture} from '../pipeline/fixtures';
import {candidateTemplate} from '../allocation/fixtures';import {candidateId} from '../allocation/spec';
import {qaPolicy} from '../../artifacts/api-server/src/lib/allocation-core/gates/fixtures';
import {routingPolicy,health} from '../governance/fixtures';
import type {Input as BankInput,Result as BankResult} from '../bank/contracts';
import type {StrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/contracts';
import type {Request,FrozenActiveSet} from './contracts';
const checkpoint=JSON.parse(readFileSync('reports/pipe03/checkpoint.json','utf8')) as {files:Record<string,string>};
export function frozen<T=unknown>(path:string):{value:T;sha256:string}{const bytes=readFileSync(path),sha256=createHash('sha256').update(bytes).digest('hex');if(checkpoint.files[path]!==sha256)throw Error('Frozen baseline absent/changed '+path);return{value:JSON.parse(bytes.toString()) as T,sha256};}
let bankInputs:Array<{fixture_id:string;input:BankInput}>|null=null,bankResults:Array<{fixture_id:string;input_index:number;result:BankResult}>|null=null,bankHash='',bankInputHash='';
export function bankSource(name='same-family-markets_PRESERVE',ordinal=5):{snapshot:FrozenActiveSet;input:BankInput} {
 if(!bankInputs){const inputFile=frozen<Array<{fixture_id:string;input:BankInput}>>('reports/bank01/synthetic-inputs.json');bankInputs=inputFile.value;bankInputHash=inputFile.sha256;const b=frozen<NonNullable<typeof bankResults>>('reports/bank01/synthetic-results.json');bankResults=b.value;bankHash=b.sha256;}
 const rows=bankResults!.filter(x=>x.fixture_id===name),row=rows[ordinal];if(!row)throw Error('Unknown frozen QA bank case');const b=structuredClone(bankInputs[row.input_index].input);
 return{snapshot:{artifact:structuredClone(row.result),available_at:row.result.decision_date,source_path:'reports/bank01/synthetic-results.json',source_sha256:bankHash,bank_input_reference:{path:'reports/bank01/synthetic-inputs.json',sha256:bankInputHash},bank_entries:b.entries},input:b};
}
export function fixture(name='same-family-markets_PRESERVE',objective:StrategyInput['objective']={type:'MIN_VARIANCE'}):Request {
 const b=bankSource(name),a=b.snapshot.artifact,all=b.input.entries.filter(e=>e.entry_type==='STRATEGY_INSTANCE'),n=all.length;
 const cov=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?.0001*(i+1)**2:0));
 const maps=all.map(e=>b.input.position_maps.find(m=>m.entry_id===e.entry_id)!.exposures),x=strategyFixture(cov,objective,maps),date=a.decision_date,cut=a.information_cutoff;
 const point={as_of:cut,information_cutoff:cut,provenance:{...x.provenance,data_hash:canonicalHash({scope:'SYNTHETIC_CERTIFIED_EXTERNAL_DIAGONAL_COVARIANCE_NOT_HISTORICAL_ESTIMATE',bank_source:b.snapshot.source_sha256,cov}),data_available_at:cut,source_ids:['AL05_CERTIFIED_SYNTHETIC_FIXTURE','BANK01_FROZEN_MATHEMATICAL_CONTROL']}};
 x.as_of=date;x.information_cutoff=cut;x.provenance=structuredClone(point.provenance);
 x.streams=x.streams.map((s,i)=>{const e=all[i],id=e.strategy_instance_id!,hist=b.input.returns[id].observations.filter(o=>o.date<=cut&&o.available_at<=cut);return{...s,...structuredClone(point),strategy_instance_id:id,strategy_family_id:e.strategy_family_id!,underlying_ids:[...e.underlying_ids],configuration:{fixture:i},parameterization_hash:e.parameterization_hash,historical_series:{...s.historical_series,dates:hist.map(o=>o.date),values:hist.map(o=>o.value)},unit_position_map:{...s.unit_position_map,...structuredClone(point)},availability:{first_observation:hist[0].date,version_available_at:e.version_available_at}};});
 x.risk_model={...x.risk_model,...structuredClone(point),axis_ids:all.map(e=>e.strategy_instance_id!)};
 const beta=(v:NonNullable<StrategyInput['strategy_betas']>,axis:string[])=>({...v,...structuredClone(point),axis_ids:axis,values:Object.fromEntries(axis.map((id,i)=>[id,.8+.2*i])),window:{start:b.input.session_calendar[0],end:cut,observations:b.input.session_calendar.filter(d=>d<=cut).length}});
 x.strategy_betas=beta(x.strategy_betas!,x.risk_model.axis_ids);x.asset_betas=beta(x.asset_betas!,x.asset_betas!.axis_ids);x.asset_covariance={...x.asset_covariance!,...structuredClone(point)};rehash(x);
 const spec=candidateTemplate('STRATEGY_STREAMS');spec.strategy_universe={id:'BANK01:'+a.policy_id,version:a.policy_version,configuration_hash:a.policy_hash};spec.objective=structuredClone(objective) as typeof spec.objective;spec.constraints={strategy_constraints:structuredClone(x.strategy_constraints),implementation_constraints:structuredClone(x.implementation_constraints)} as typeof spec.constraints;
 spec.signal_gate.policy=qaPolicy('SIGNAL_QUALITY',date,cut);spec.portfolio_gate=qaPolicy('PORTFOLIO_ROBUSTNESS',date,cut);spec.portfolio_gate.mandatory_checks=['largest_weight','hhi'];
 // Rehash before use; policy constants are declared prior to any allocation.
 const pp=pipelineFixture('STRATEGY_STREAMS'),mandate=structuredClone(pp.bundle.mandate);mandate.as_of=date;mandate.provenance.information_cutoff=cut;mandate.provenance.data_available_at=cut;mandate.provenance.generated_at=date;
 const rp=routingPolicy(cut),dataHealth=health(date),registry=frozen<Request['routing']['registry']>('reports/pipe02/bank-registry-full.json').value;
 const request:Request={request_id:'PIPE03_QA_'+name+'_'+objective.type,decision_date:date,information_cutoff:cut,active_set_hash:a.hash,active_sets:[b.snapshot],strategy_snapshots:[x],source_candidate:{candidate_id:'',spec},bundle_template:{mandate,signal:null,sensitivity:[],signal_policy:spec.signal_gate.policy,robustness_policy:spec.portfolio_gate},session_calendar:b.input.session_calendar,routing:{routing_stream_id:'PIPE03_QA_NO_REAL_PROMOTIONS',scope:'QA_ONLY',as_of:date,information_cutoff:date,primary_entry_id:'UNAPPROVED_PIPE03_CONFIGURATION',policy:rp,registry,certificates:[],fallbacks:[],previous_target_hash:null,previous_routes:[],data_health:dataHealth,recertifications:[]}};
 return refresh(request);
}
import {policyHash} from '../../artifacts/api-server/src/lib/allocation-core/gates/common';
export function refresh(r:Request):Request {
 for(const p of [r.bundle_template.signal_policy,r.bundle_template.robustness_policy])p.policy_hash=policyHash(p);
 const x=r.strategy_snapshots[0];rehash(x);const s=r.source_candidate.spec;s.objective=structuredClone(x.objective) as typeof s.objective;s.constraints={strategy_constraints:structuredClone(x.strategy_constraints),implementation_constraints:structuredClone(x.implementation_constraints)} as typeof s.constraints;s.portfolio_gate=structuredClone(r.bundle_template.robustness_policy);s.signal_gate.policy=structuredClone(r.bundle_template.signal_policy);r.source_candidate.candidate_id=candidateId(s);return r;
}
export function cases():Array<{case_id:string;expected_status:string;request:Request}>{
 const out:Array<{case_id:string;expected_status:string;request:Request}>=[];
 for(const n of ['same-family-markets_PRESERVE','same-asset_PRESERVE','high-correlation_PRESERVE','high-correlation_CAP1','regime-ineligible_PRESERVE'])for(const objective of ['EQUAL_CAPITAL','MIN_VARIANCE','ERC'] as const)out.push({case_id:n+'_'+objective,expected_status:'VALID',request:fixture(n,{type:objective})});
 const zero=fixture();zero.request_id='PIPE03_QA_ACTIVE_ZERO';zero.strategy_snapshots[0].strategy_constraints.bounds.CONTROL_1={min:0,max:0};out.push({case_id:'ACTIVE_ZERO_ALLOCATION',expected_status:'VALID',request:refresh(zero)});
 const sensitive=fixture();sensitive.request_id='PIPE03_QA_ROBUSTNESS_FAIL';sensitive.bundle_template.robustness_policy.thresholds.hhi.value=.01;out.push({case_id:'ROBUSTNESS_THRESHOLD_FAILURE',expected_status:'ROBUSTNESS_GATE_FAIL',request:refresh(sensitive)});
 for(const kind of ['RESIDUAL','SIGNED'] as const){const r=fixture('same-asset_PRESERVE',{type:'EQUAL_CAPITAL'});r.request_id='PIPE03_QA_'+kind;for(const [i,s]of r.strategy_snapshots[0].streams.entries()){s.unit_position_map.exposures={SPY_SYNTHETIC:kind==='RESIDUAL'?.8:i===0?-1:1};s.unit_position_map.internal_residual_capital=kind==='RESIDUAL'?.2:0;s.unit_position_map.funding=kind==='SIGNED'?'SIGNED_OR_EXTERNAL_FINANCING':'LONG_ONLY_FUNDED';}out.push({case_id:kind+'_CONTROLLER_BLOCK',expected_status:'MISSING_SLEEVE_RISK',request:refresh(r)});}
 const incompatible=fixture('high-correlation_CAP1');incompatible.request_id='PIPE03_QA_INACTIVE_POSITIVE_MIN';incompatible.strategy_snapshots[0].strategy_constraints.bounds.CONTROL_1={min:.1,max:1};out.push({case_id:'INACTIVE_POSITIVE_MIN',expected_status:'INFEASIBLE_INACTIVE_MIN_ALLOCATION',request:refresh(incompatible)});
 return out;
}
