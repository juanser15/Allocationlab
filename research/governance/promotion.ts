import {available,canonicalHash,point,seal,time,unique,verify,within} from './common';
import type {Authority,PromotionDecision,PromotionEvidence,PromotionEvaluation,PromotionPolicy,Scope} from './contracts';
export function validateEvidence(e:PromotionEvidence){
 verify(e);point(e);unique(e.refs.map(r=>r.source_id),'evidence sources');
 if(!e.identity.artifact_id||!e.identity.candidate_id||!e.identity.version||!Number.isInteger(e.oos_folds)||e.oos_folds<0||!Number.isInteger(e.observations)||e.observations<0||!Number.isFinite(e.cost_scenario_bps)||e.cost_scenario_bps<0)throw Error('Invalid frozen evidence identity/counts');
 if(Object.values(e.metrics).some(v=>v!==null&&!Number.isFinite(v))||e.refs.some(r=>!/^[a-f0-9]{64}$/.test(r.sha256)||time(r.available_at)>time(e.information_cutoff)))throw Error('Evidence contains unavailable/nonfinite sources');
 if(!e.refs.length||!e.code_hashes.length||!e.data_hashes.length||!e.risk_mandate_hashes.length)throw Error('Incomplete evidence provenance');
}
export function evaluatePromotion(e:PromotionEvidence,p:PromotionPolicy,at:string,cutoff=at):PromotionEvaluation{
 const components:PromotionEvaluation['components']=[];
 const component=(check:string,status:'PASS'|'FAIL'|'BLOCKED',observed:unknown,required:unknown)=>components.push({check,status,observed,required});
 try{
  validateEvidence(e);verify(p);point(p);
  if(time(cutoff)>time(at)||!available(e,at,cutoff)||!available(p,at,cutoff)||e.scope!==p.scope)throw Error('Promotion evidence/policy scope or PIT mismatch');
  if(!p.authority_id||!p.promotion_policy_id||!p.version||!Number.isInteger(p.minimum_oos_folds)||p.minimum_oos_folds<0||!Number.isInteger(p.minimum_observations)||p.minimum_observations<0||p.required_robustness_status!=='PASS'||p.required_reproducibility_status!=='PASS')throw Error('Invalid explicit promotion policy');
  unique(p.required_certifications,'required certifications');unique(p.required_gates,'required gates');
  component('eligible_mode',p.eligible_modes.includes(e.identity.allocation_mode)?'PASS':'FAIL',e.identity.allocation_mode,p.eligible_modes);
  for(const c of p.required_certifications)component('certification:'+c,e.certifications[c]==='PASS'?'PASS':e.certifications[c]===undefined?'BLOCKED':'FAIL',e.certifications[c]??null,'PASS');
  for(const g of p.required_gates)component('gate:'+g,e.gate_statuses[g]==='PASS'?'PASS':e.gate_statuses[g]===undefined?'BLOCKED':'FAIL',e.gate_statuses[g]??null,'PASS');
  component('oos_folds',e.oos_folds>=p.minimum_oos_folds?'PASS':'FAIL',e.oos_folds,p.minimum_oos_folds);
  component('observations',e.observations>=p.minimum_observations?'PASS':'FAIL',e.observations,p.minimum_observations);
  component('robustness',e.robustness_status===p.required_robustness_status?'PASS':'FAIL',e.robustness_status,p.required_robustness_status);
  component('reproducibility',e.reproducibility_status===p.required_reproducibility_status?'PASS':'FAIL',e.reproducibility_status,p.required_reproducibility_status);
  const blocked=e.blockers.filter(x=>!p.allowed_unresolved_blockers.includes(x));component('unresolved_blockers',blocked.length?'BLOCKED':'PASS',blocked,p.allowed_unresolved_blockers);
  for(const [metric,threshold]of Object.entries(p.economic_hurdles)){
   if(!['cagr','capm_alpha','psr','max_drawdown','average_beta','downside_beta','tail_beta','turnover'].includes(metric)||!['MIN','MAX'].includes(threshold.operator)||!Number.isFinite(threshold.value))throw Error('Unknown/nonfinite economic hurdle');
   const value=e.metrics[metric as keyof typeof e.metrics];component('economic:'+metric,value===null?'BLOCKED':(threshold.operator==='MIN'?value>=threshold.value:value<=threshold.value)?'PASS':'FAIL',value,threshold);
  }
 }catch(error){component('canonical/PIT validation','FAIL',String(error),'Valid frozen evidence and declared policy');}
 const status:PromotionEvaluation['status']=components.some(c=>c.status==='FAIL')?'NOT_PROMOTABLE':components.some(c=>c.status==='BLOCKED')?'DEFERRED_BLOCKED':'PROMOTABLE';
 const body={identity:structuredClone(e.identity),scope:e.scope,evidence_hash:e.hash,policy_hash:p.hash,as_of:at,information_cutoff:cutoff,status,components};
 return seal({evaluation_id:'evaluation_'+canonicalHash(body),...body});
}
export function authorize(authority:Authority,scope:Scope,actor:string,action:Authority['allowed_actions'][number],at:string,cutoff:string){
 verify(authority);point(authority);
 if(authority.scope!==scope||!actor.trim()||!authority.actor_refs.includes(actor)||!authority.allowed_actions.includes(action)||!available(authority,at,cutoff)||!within(at,authority.valid_from,authority.valid_until)||scope==='RESEARCH_GOVERNANCE'&&authority.kind!=='EXTERNAL_MANUAL')throw Error('Explicit authorized actor/action/scope required');
}
export function validateDecision(d:PromotionDecision,e:PromotionEvidence,p:PromotionPolicy,v:PromotionEvaluation,a:Authority){
 verify(d);verify(v);validateEvidence(e);verify(p);
 if(d.scope!==e.scope||p.scope!==e.scope||d.evidence_hash!==e.hash||d.policy_hash!==p.hash||d.evaluation_hash!==v.hash||canonicalHash(d.identity)!==canonicalHash(e.identity)||a.authority_id!==p.authority_id||d.authority_hash!==a.hash||time(d.available_at)<time(d.decision_time)||time(d.decision_time)<time(v.as_of)||!d.reason.trim())throw Error('PromotionDecision identity/availability mismatch');
 if(canonicalHash(v)!==canonicalHash(evaluatePromotion(e,p,v.as_of,v.information_cutoff)))throw Error('Forged/stale promotion evaluation');
 authorize(a,d.scope,d.authorized_by,d.decision,d.decision_time,d.decision_time);
 if(!['APPROVE','REJECT','DEFER'].includes(d.decision)||d.decision==='APPROVE'&&v.status!=='PROMOTABLE')throw Error('APPROVE requires a separate PROMOTABLE evaluation');
}
