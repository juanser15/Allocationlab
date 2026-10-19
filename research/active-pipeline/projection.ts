/** Lossless eligible-axis projection of external PIT artifacts, not a model fit. */
import {canonicalHash,seal,time,verify,validHash,unique} from '../governance/common';
import {assertAllocatorUniverse} from '../bank/adapters';
import {validateInput,riskHash,muHash,betaHash,assetRiskHash} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/validation';
import {candidateId} from '../allocation/spec';
import {scopedBundle} from '../pipeline/decision';
import {verifyFrozenSource} from './sources';
import type {StrategyInput} from '../../artifacts/api-server/src/lib/allocation-core/strategy-engine/contracts';
import type {Request,FrozenActiveSet,Prepared,Projection} from './contracts';
const same=(a:unknown,b:unknown)=>canonicalHash(a)===canonicalHash(b);
export function resolveActive(r:Request):FrozenActiveSet {
 if(time(r.information_cutoff)>=time(r.decision_date))throw Error('INVALID_INPUT: strict previous-close cutoff required');
 const visible=r.active_sets.filter(s=>time(s.available_at)<=time(r.decision_date)&&s.artifact.decision_date===r.decision_date&&s.artifact.information_cutoff===r.information_cutoff);
 const selected=visible.filter(s=>s.artifact.hash===r.active_set_hash);if(selected.length!==1)throw Error('BLOCKED_MISSING_ACTIVE_SET: exact frozen reference unavailable/ambiguous');
 const a=selected[0],v=a.artifact;verifyFrozenSource(a);verify(v);verify(v.correlation);verify(v.clustering);
 const{hash,active_set_id,...body}=v;if(active_set_id!=='active_set_'+canonicalHash(body)||v.status!=='VALID'||!validHash(a.source_sha256)||!a.source_path.trim())throw Error('INVALID_INPUT: ActiveSet identity/source');
 unique(v.active_strategy_ids,'active IDs');unique(v.entries.map(e=>e.entry_id),'bank entries');unique(a.bank_entries.map(e=>e.entry_id),'bank metadata');
 const active=v.entries.filter(e=>e.entry_type==='STRATEGY_INSTANCE'&&e.status==='ELIGIBLE_ACTIVE').map(e=>e.strategy_instance_id!).sort();
 if(!same(active,[...v.active_strategy_ids].sort())||v.active_strategy_ids.some(id=>v.inactive.some(e=>e.strategy_instance_id===id)))throw Error('INVALID_INPUT: ActiveSet membership/status conflict');
 for(const e of v.entries){const definition=a.bank_entries.find(d=>d.entry_id===e.entry_id);if(!definition)throw Error('INVALID_INPUT: missing frozen bank definition');verify(definition);if(definition.scope!==v.scope||time(definition.as_of)>time(r.decision_date)||time(definition.information_cutoff)>time(r.information_cutoff)||time(definition.available_at)>time(r.information_cutoff)||definition.strategy_instance_id!==e.strategy_instance_id)throw Error('INVALID_INPUT: bank identity/PIT mismatch');if(e.status==='ELIGIBLE_ACTIVE'&&e.promotion_status!=='PROMOTED')throw Error('INVALID_INPUT: active entry not promoted');}
 return structuredClone(a);
}
export function resolveStrategy(r:Request):StrategyInput {
 const xs=r.strategy_snapshots.filter(x=>time(x.as_of)<=time(r.decision_date)&&time(x.information_cutoff)<=time(r.information_cutoff)&&time(x.provenance.data_available_at)<=time(r.information_cutoff)).sort((a,b)=>time(a.as_of)-time(b.as_of));
 const source=xs.at(-1);if(!source)throw Error('BLOCKED_MISSING_STRATEGY_ARTIFACTS');if(xs.filter(x=>x.as_of===source.as_of).length!==1)throw Error('INVALID_INPUT: ambiguous strategy snapshot');
 const errors=validateInput(source);if(errors.length)throw Error('INVALID_INPUT: original PIT bundle: '+errors.join('; '));
 if(source.as_of!==r.decision_date)throw Error('BLOCKED_MISSING_STRATEGY_ARTIFACTS: no exact decision snapshot; no current-definition substitution');return structuredClone(source);
}
export function project(r:Request,a:FrozenActiveSet,source:StrategyInput):Projection {
 const ids=[...a.artifact.active_strategy_ids].sort(),all=source.streams.map(s=>s.strategy_instance_id);if(!ids.length)throw Error('BLOCKED_EMPTY_ACTIVE_SET: no allocator invocation or fallback');
 if(ids.some(id=>!all.includes(id)))throw Error('BLOCKED_MISSING_STRATEGY_ARTIFACTS: active identity absent');
 const candidate=r.source_candidate,universe=candidate.spec.strategy_universe;if(!universe||universe.id!=='BANK01:'+a.artifact.policy_id||universe.version!==a.artifact.policy_version||universe.configuration_hash!==a.artifact.policy_hash)throw Error('INVALID_INPUT: source configuration does not authorize this frozen BANK policy');
 if(candidate.candidate_id!==candidateId(candidate.spec)||candidate.spec.allocation_mode!=='STRATEGY_STREAMS'||!same(candidate.spec.objective,source.objective)||!same(candidate.spec.constraints,{strategy_constraints:source.strategy_constraints,implementation_constraints:source.implementation_constraints}))throw Error('INVALID_INPUT: frozen source configuration mismatch');
 const input=structuredClone(source),changes:Projection['constraint_changes']=[];
 const change=(path:string,before:unknown,after:unknown,reason:string)=>{if(!same(before,after))changes.push({path,before,after,reason});};
 input.streams=input.streams.filter(s=>ids.includes(s.strategy_instance_id)).sort((a,b)=>a.strategy_instance_id.localeCompare(b.strategy_instance_id));
 const slice=(axis:string[],matrix:number[][],keep:string[])=>keep.map(a=>keep.map(b=>matrix[axis.indexOf(a)][axis.indexOf(b)]));
 const risk=input.risk_model;input.risk_model={...risk,axis_ids:ids,covariance:slice(risk.axis_ids,risk.covariance,ids)};input.risk_model.artifact_hash=riskHash(input.risk_model);
 if(input.expected_returns){const mu=input.expected_returns;mu.axis_ids=ids;mu.values=Object.fromEntries(ids.map(id=>[id,mu.values[id]]));mu.artifact_hash=muHash(mu);}
 if(input.strategy_betas){const b=input.strategy_betas;b.axis_ids=ids;b.values=Object.fromEntries(ids.map(id=>[id,b.values[id]]));b.artifact_hash=betaHash(b);}
 const assets=[...new Set(input.streams.flatMap(s=>Object.keys(s.unit_position_map.exposures)))].sort();
 if(input.asset_betas){const b=input.asset_betas;b.axis_ids=assets;b.values=Object.fromEntries(assets.map(id=>[id,b.values[id]]));b.artifact_hash=betaHash(b);}
 if(input.asset_covariance){const c=input.asset_covariance;input.asset_covariance={...c,axis_ids:assets,covariance:slice(c.axis_ids,c.covariance,assets)};input.asset_covariance.artifact_hash=assetRiskHash(input.asset_covariance);}
 const sc=input.strategy_constraints;
 for(const [id,bound]of Object.entries(sc.bounds))if(!ids.includes(id)){if(bound.min>0)throw Error('INFEASIBLE_INACTIVE_MIN_ALLOCATION: '+id);change('bounds.'+id,bound,null,'inactive allocation is fixed zero, satisfying zero minimum');delete sc.bounds[id];}
 const families=new Set(input.streams.map(s=>s.strategy_family_id)),underlyings=new Set(input.streams.flatMap(s=>s.underlying_ids));
 const fc=sc.family_caps.filter(g=>families.has(g.id));change('family_caps',sc.family_caps,fc,'removed family has zero active capital and a nonnegative upper cap');sc.family_caps=fc;
 const uc=sc.underlying_group_caps.map(g=>({...g,underlying_ids:g.underlying_ids.filter(u=>underlyings.has(u))})).filter(g=>g.underlying_ids.length);change('underlying_group_caps',sc.underlying_group_caps,uc,'intersection with active strategy underlyings preserves upper limits');sc.underlying_group_caps=uc;
 if(sc.max_active_strategies!==null&&sc.max_active_strategies>ids.length){change('max_active_strategies',sc.max_active_strategies,ids.length,'equivalent upper cardinality bound on reduced axis');sc.max_active_strategies=ids.length;}
 if(input.previous_allocation){const old=input.previous_allocation;if(Object.entries(old.allocations).some(([id,w])=>!ids.includes(id)&&w!==0))throw Error('BLOCKED_PREVIOUS_ALLOCATION_AXIS: inactive held capital requires explicit exit accounting; no renormalization');old.allocations=Object.fromEntries(ids.map(id=>[id,old.allocations[id]]));}
 const ic=input.implementation_constraints,containsZero=(min:number|null,max:number|null)=>(min===null||min<=0)&&(max===null||max>=0);
 for(const [id,b]of Object.entries(ic.instrument_bounds))if(!assets.includes(id)){if(!containsZero(b.min_net,b.max_net))throw Error('INFEASIBLE_INACTIVE_INSTRUMENT_CONSTRAINT: '+id);change('instrument_bounds.'+id,b,null,'absent active instrument exposure is zero and satisfies bound');delete ic.instrument_bounds[id];}
 const gl=ic.group_limits.map(g=>({...g,instruments:g.instruments.filter(id=>assets.includes(id))}));for(const g of gl)if(!g.instruments.length&&!containsZero(g.min,g.max))throw Error('INFEASIBLE_INACTIVE_INSTRUMENT_GROUP: '+g.id);const retained=gl.filter(g=>g.instruments.length);change('group_limits',ic.group_limits,retained,'restrict group to active H rows; drop only zero-satisfied empty group');ic.group_limits=retained;
 if(input.incremental_cost?.trades.some(t=>!assets.includes(t.instrument_id)))throw Error('BLOCKED_COST_AXIS: no invented exit trades or double cost');
 const sourceHash=canonicalHash(source),body={active_set_hash:a.artifact.hash,source_snapshot_hash:sourceHash,methodology:'ACTIVE_AXIS_PRINCIPAL_SUBMATRIX_NO_REFIT_V1' as const,active_ids:ids,excluded:structuredClone(a.artifact.inactive),constraint_changes:changes,input};
 input.provenance={...input.provenance,data_hash:canonicalHash({source:sourceHash,active_set:a.artifact.hash,projection:body.methodology}),source_ids:[...input.provenance.source_ids,'BANK01:'+a.artifact.active_set_id]};
 assertAllocatorUniverse(a.artifact,input,a.bank_entries);return seal(body);
}
export function prepare(r:Request):Prepared {
 const allowed=['request_id','decision_date','information_cutoff','active_set_hash','active_sets','strategy_snapshots','source_candidate','bundle_template','session_calendar','routing'];if(Object.keys(r).some(k=>!allowed.includes(k)))throw Error('INVALID_INPUT: no cash/RiskMandate override field');
 const a=resolveActive(r),source=resolveStrategy(r),projection=project(r,a,source),spec=structuredClone(r.source_candidate.spec);
 // Compilation of the declared universe projection, never search/reselection.
 spec.constraints={strategy_constraints:projection.input.strategy_constraints,implementation_constraints:projection.input.implementation_constraints} as typeof spec.constraints;
 spec.model_config_hashes={...spec.model_config_hashes,active_set:a.artifact.hash,source_candidate:r.source_candidate.candidate_id,source_snapshot:projection.source_snapshot_hash};
 const candidate={candidate_id:candidateId(spec),spec};
 const b:Prepared['bundle']=scopedBundle({...structuredClone(r.bundle_template),native:{mode:'STRATEGY_STREAMS',input:projection.input},original_risk_reference:{active_set_id:a.artifact.active_set_id,source_candidate_id:r.source_candidate.candidate_id,source_snapshot_hash:projection.source_snapshot_hash,projection_methodology:projection.methodology}},r.decision_date,r.information_cutoff);
 const dates=[...r.session_calendar].sort();unique(dates,'calendar sessions');const prior=dates.filter(d=>d<r.decision_date);if(prior.at(-1)!==r.information_cutoff)throw Error('INVALID_INPUT: supplied execution calendar/cutoff mismatch');
 const next=dates.find(d=>d>r.decision_date);if(!next)throw Error('BLOCKED_MISSING_CALENDAR: execution date unavailable');
 // Only prior, decision and first execution session affect the target. Later
 // calendar additions cannot rewrite the decision identity. No prices/fills.
 const calendar=[...prior,...dates.filter(d=>d===r.decision_date),next].map(date=>({date,prices:{}}));
 return{active:a,projection,candidate,bundle:b,calendar,identity:canonicalHash({request_id:r.request_id,active_set:a.artifact.hash,projection,candidate,bundle:b,calendar})};
}
