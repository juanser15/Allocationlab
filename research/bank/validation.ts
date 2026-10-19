import {time,verify,validHash,unique} from '../governance/common';
import type {Entry,Input,Point,Policy,State} from './contracts';
export const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function visible(x:Point,decision:string,cutoff:string):boolean{return time(x.as_of)<=time(decision)&&time(x.information_cutoff)<=time(cutoff)&&time(x.available_at)<=time(cutoff);}
export function validatePoint(x:Point):void {if(time(x.information_cutoff)>time(x.as_of)||time(x.available_at)<time(x.as_of))throw Error('INVALID_INPUT: inconsistent PIT metadata');}
export function validateProvenance(x:{provenance:{data_hash:string;configuration_hash:string;source_ids:string[]}}){if(!validHash(x.provenance.data_hash)||!validHash(x.provenance.configuration_hash)||!x.provenance.source_ids.length||x.provenance.source_ids.some(s=>!s.trim()))throw Error('INVALID_INPUT: provenance');}
export function latest<T extends Point&{hash:string}>(xs:T[],decision:string,cutoff:string):T|null {
 const a=xs.filter(x=>visible(x,decision,cutoff)).sort((a,b)=>time(a.as_of)-time(b.as_of));if(!a.length)return null;
 a.forEach(x=>{validatePoint(x);verify(x);});const last=a.at(-1)!;if(a.filter(x=>time(x.as_of)===time(last.as_of)).length>1)throw Error('INVALID_INPUT: ambiguous PIT snapshot');return last;
}
export function validatePolicy(p:Policy,decision:string,cutoff:string):void {
 verify(p);validatePoint(p);validateProvenance(p);if(!visible(p,decision,cutoff))throw Error('INVALID_INPUT: future policy');
 if(!p.policy_id?.trim()||!p.version?.trim()||!p.evaluation_frequency?.trim()||!['QA_ONLY','RESEARCH_GOVERNANCE'].includes(p.scope)||p.diagnostic_reference!=='EQUAL_UNIT_REFERENCE_NOT_ALLOCATION')throw Error('INVALID_INPUT: policy identity/reference');
 if(p.correlation.method!=='SAMPLE_PEARSON_COMMON_SESSIONS_V1'||![63,126,252].includes(p.correlation.window_sessions)||p.correlation.missing_data!=='INACTIVATE_INCOMPLETE_WINDOW'||!Number.isInteger(p.correlation.minimum_observations)||p.correlation.minimum_observations<2||p.correlation.minimum_observations>p.correlation.window_sessions||!Number.isInteger(p.minimum_strategy_history)||p.minimum_strategy_history<2)throw Error('INVALID_INPUT: estimator');
 if(!['ENTRY_DECLARED_PASS_REQUIRED','ALL_ENTRIES_PASS_REQUIRED'].includes(p.signal_gate_requirement))throw Error('INVALID_INPUT: gate requirement');
 if(!finite(p.correlation.maximum_data_age_days)||p.correlation.maximum_data_age_days<0||!finite(p.signal_gate_maximum_age_days)||p.signal_gate_maximum_age_days<0)throw Error('INVALID_INPUT: freshness');
 if(p.clustering.method!=='HIERARCHICAL_CORRELATION'||p.clustering.distance!=='SQRT_HALF_ONE_MINUS_RHO'||!['SINGLE','COMPLETE','AVERAGE'].includes(p.clustering.linkage)||!finite(p.clustering.correlation_threshold)||Math.abs(p.clustering.correlation_threshold)>1)throw Error('INVALID_INPUT: linkage');
 if(!['LEXICOGRAPHIC_POLICY','BEST_FROZEN_RESEARCH_SCORE','HIGHEST_PSR_FROM_PROMOTION_EVIDENCE','LOWEST_TURNOVER','LOWEST_CORRELATION_TO_ACTIVE_SET'].includes(p.representative_selector))throw Error('INVALID_INPUT: selector');
 const caps=[p.maximum_total_active,p.maximum_per_cluster,...Object.values(p.maximum_per_family),...Object.values(p.maximum_per_underlying)];if(caps.some(v=>v!==null&&(!Number.isInteger(v)||v<0)))throw Error('INVALID_INPUT: caps');
 if(p.maximum_pairwise_correlation!==null&&(!finite(p.maximum_pairwise_correlation)||Math.abs(p.maximum_pairwise_correlation)>1)||p.minimum_marginal_effective_rank_gain!==null&&!finite(p.minimum_marginal_effective_rank_gain))throw Error('INVALID_INPUT: redundancy threshold');
 if(!p.require_correlation_for_activation&&(p.maximum_pairwise_correlation!==null||p.maximum_per_cluster!==null||p.minimum_marginal_effective_rank_gain!==null||p.representative_selector==='LOWEST_CORRELATION_TO_ACTIVE_SET'))throw Error('INVALID_INPUT: correlation-dependent restriction needs required correlation');
 if(!finite(p.numerical_tolerance)||p.numerical_tolerance<=0||p.numerical_tolerance>1e-6)throw Error('INVALID_INPUT: explicit numerical tolerance');unique(p.regime_allowed,'policy regimes');
 const allowed=['as_of','information_cutoff','available_at','policy_id','version','scope','evaluation_frequency','correlation','clustering','minimum_strategy_history','maximum_total_active','maximum_per_family','maximum_per_underlying','maximum_per_cluster','maximum_pairwise_correlation','minimum_marginal_effective_rank_gain','representative_selector','require_correlation_for_activation','regime_allowed','signal_gate_maximum_age_days','signal_gate_requirement','diagnostic_reference','numerical_tolerance','provenance','hash'];if(Object.keys(p).some(k=>!allowed.includes(k)))throw Error('INVALID_INPUT: unknown policy field; no allocation/cash/mandate input');
}
export function validateEntry(e:Entry):void {
 verify(e);validatePoint(e);validateProvenance(e);if(!e.entry_id.trim()||!['SIGNAL','STRATEGY_INSTANCE'].includes(e.entry_type)||!['QA_ONLY','RESEARCH_GOVERNANCE'].includes(e.scope)||!e.strategy_version.trim()||!validHash(e.parameterization_hash))throw Error('INVALID_INPUT: bank identity');
 unique(e.underlying_ids,'underlyings');unique(e.allowed_regimes,'allowed regimes');unique(e.preferred_regimes,'preferred regimes');unique(e.prohibited_regimes,'prohibited regimes');
 if(e.valid_until!==null&&time(e.valid_until)<=time(e.valid_from))throw Error('INVALID_INPUT: entry availability');
 if(e.entry_type==='STRATEGY_INSTANCE'&&(!e.strategy_instance_id?.trim()||!e.strategy_family_id?.trim()||!e.underlying_ids.length))throw Error('INVALID_INPUT: strategy identity');
 if(e.entry_type==='SIGNAL'&&(e.strategy_instance_id!==null||!e.signal_metadata||!e.signal_metadata.signal_model_id.trim()||!e.signal_metadata.signal_model_version.trim()||!e.signal_metadata.signal_units.trim()||!validHash(e.signal_metadata.artifact_hash)))throw Error('INVALID_INPUT: signal identity/units; signal is not a strategy');
 if(e.entry_type==='STRATEGY_INSTANCE'&&e.signal_metadata!==null)throw Error('INVALID_INPUT: strategy is not a signal');
}
export function validateState(s:State,scope:Entry['scope']):void {
 verify(s);validatePoint(s);if(time(s.effective_at)>time(s.as_of)||!['RESEARCH','VALIDATED','PROMOTABLE','PROMOTED','SUSPENDED','RETIRED'].includes(s.promotion_status)||!s.reason.trim()||!validHash(s.evidence_hash)||typeof s.manual_hold!=='boolean')throw Error('INVALID_INPUT: temporal state');
 if(s.source==='QA_ONLY_EXTERNAL_FIXTURE'&&scope!=='QA_ONLY'||!['QA_ONLY_EXTERNAL_FIXTURE','PIPE02_VERIFIED_REGISTRY'].includes(s.source))throw Error('INVALID_INPUT: unverified promotion source');
 if(['PROMOTED','SUSPENDED','RETIRED'].includes(s.promotion_status)&&(!validHash(s.promotion_decision_hash)||s.promotion_decision_time===null||time(s.promotion_decision_time)>time(s.as_of)))throw Error('INVALID_INPUT: missing external promotion proof');
}
export function validateInput(x:Input){time(x.decision_date);if(time(x.information_cutoff)>time(x.decision_date))throw Error('INVALID_INPUT: future cutoff');validatePolicy(x.policy,x.decision_date,x.information_cutoff);
 if(x.policy.scope==='RESEARCH_GOVERNANCE'&&!x.governance_registry)throw Error('INVALID_INPUT: certified governance registry required for real scope');
 const allowed=['decision_date','information_cutoff','policy','entries','states','returns','session_calendar','regimes','signal_gates','evidence','position_maps','exposures','asset_risk','governance_registry'];if(Object.keys(x).some(k=>!allowed.includes(k)))throw Error('INVALID_INPUT: no allocation, cash or RiskMandate field accepted');}
