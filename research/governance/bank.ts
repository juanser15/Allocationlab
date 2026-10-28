import {available,canonicalHash,point,seal,time,unique,verify} from './common';
import {authorize,evaluatePromotion,validateDecision,validateEvidence} from './promotion';
import type {BankAction,BankDefinition,BankEvent,BankRegistry,BankState,PromotionState,ActivationReason} from './contracts';
const stateActions:Record<string,PromotionState>={VALIDATE:'VALIDATED',MAKE_PROMOTABLE:'PROMOTABLE',APPROVE:'PROMOTED',REJECT:'VALIDATED',DEFER:'VALIDATED',SUSPEND:'SUSPENDED',RESUME:'PROMOTED',RETIRE:'RETIRED'};
const reasons:ActivationReason[]=['REGIME_NOT_APPLICABLE','DATA_UNAVAILABLE','TEMPORARILY_SUSPENDED','REDUNDANCY_POLICY_FUTURE','MANUAL_HOLD','ACTIVE'];
function definition(registry:BankRegistry,id:string,at:string,cutoff:string){
 const defs=registry.definitions.filter(x=>x.entry_id===id&&available(x,at,cutoff));if(defs.length>1)throw Error('Ambiguous immutable bank definition');
 const d=defs[0];if(!d)return null;verify(d);point(d);unique(d.underlying_ids,'underlying IDs');
 if(!['SIGNAL','STRATEGY_INSTANCE','FACTOR_MODEL','ALLOCATION_CONFIGURATION'].includes(d.entry_type)||!d.entry_id.trim()||d.valid_until!==null&&time(d.valid_until)<=time(d.valid_from))throw Error('Invalid bank definition');return d;
}
export function bankState(registry:BankRegistry,id:string,at:string,cutoff=at):{definition:BankDefinition;state:BankState}|null{
 if(time(cutoff)>time(at))throw Error('Registry cutoff is future');const def=definition(registry,id,at,cutoff);if(!def)return null;
 const s:BankState={entry_id:id,definition_hash:def.hash,promotion_status:'RESEARCH',activation_status:'INACTIVE',activation_reason:'MANUAL_HOLD',last_event_hash:null,promotion_decision_hash:null,evidence_hash:def.evidence_hash};
 const events=registry.events.filter(e=>e.entry_id===id&&time(e.available_at)<=time(cutoff)&&time(e.effective_at)<=time(at)).sort((a,b)=>a.sequence-b.sequence);unique(events.map(e=>e.event_id),'bank event IDs');
 let sequence=0,lastTime=-Infinity,lastAvailable=-Infinity;
 for(const event of events){
  verify(event);
  if(event.scope!==def.scope||event.definition_hash!==def.hash||event.previous_event_hash!==s.last_event_hash||event.sequence!==++sequence||event.from_state!==s.promotion_status||time(event.effective_at)<lastTime||time(event.available_at)<lastAvailable||time(event.available_at)<time(event.effective_at)||event.evidence_hash!==def.evidence_hash||!reasons.includes(event.activation_reason))throw Error('Invalid temporal bank event chain');
  if(s.promotion_status==='RETIRED')throw Error('RETIRED is permanent');
  const evidence=registry.evidence.find(e=>e.hash===event.evidence_hash&&available(e,event.effective_at,event.effective_at));if(!evidence)throw Error('Missing PIT frozen promotion evidence');validateEvidence(evidence);
  if(evidence.scope!==def.scope||canonicalHash(evidence.identity)!==canonicalHash(def.identity))throw Error('Evidence/bank identity mismatch');
  let next:PromotionState=s.promotion_status;
  if(event.action==='VALIDATE'){
   if(s.promotion_status!=='RESEARCH'||!Object.keys(evidence.certifications).length||Object.values(evidence.certifications).some(v=>v!=='PASS'))throw Error('VALIDATE requires mechanical frozen certification');next='VALIDATED';
  }else if(event.action==='MAKE_PROMOTABLE'){
   const evaluation=registry.evaluations.find(e=>e.hash===event.evaluation_hash&&time(e.as_of)<=time(event.effective_at)),policy=evaluation?registry.policies.find(p=>p.hash===evaluation.policy_hash):null;
   if(!evaluation||!policy||s.promotion_status!=='VALIDATED'||evaluation.evidence_hash!==evidence.hash||canonicalHash(evaluatePromotion(evidence,policy,evaluation.as_of,evaluation.information_cutoff))!==canonicalHash(evaluation)||evaluation.status!=='PROMOTABLE')throw Error('MAKE_PROMOTABLE requires matching frozen policy evaluation');next='PROMOTABLE';
  }else if(['APPROVE','REJECT','DEFER'].includes(event.action)){
   const decision=registry.decisions.find(d=>d.hash===event.promotion_decision_hash&&time(d.available_at)<=time(event.available_at)&&time(d.decision_time)<=time(event.effective_at)),evaluation=decision?registry.evaluations.find(e=>e.hash===decision.evaluation_hash):null,policy=decision?registry.policies.find(p=>p.hash===decision.policy_hash):null,authority=decision?registry.authorities.find(a=>a.hash===decision.authority_hash):null;
   if(!decision||!evaluation||!policy||!authority||s.promotion_status!=='PROMOTABLE'||decision.decision!==event.action)throw Error('Separate authorized PromotionDecision required');validateDecision(decision,evidence,policy,evaluation,authority);next=stateActions[event.action];if(event.action==='APPROVE')s.promotion_decision_hash=decision.hash;
  }else if(['SUSPEND','RESUME','RETIRE','ACTIVATE','DEACTIVATE'].includes(event.action)){
   const authority=registry.authorities.find(a=>a.hash===event.authority_hash);if(!authority||!event.actor_ref)throw Error('External governance/activation authority required');authorize(authority,def.scope,event.actor_ref,event.action as Parameters<typeof authorize>[3],event.effective_at,event.effective_at);
   if(event.action==='SUSPEND'){if(s.promotion_status!=='PROMOTED')throw Error('Only PROMOTED may suspend');next='SUSPENDED';}
   if(event.action==='RESUME'){if(s.promotion_status!=='SUSPENDED'||!s.promotion_decision_hash)throw Error('Only previously approved SUSPENDED entry may resume');next='PROMOTED';}
   if(event.action==='RETIRE')next='RETIRED';
   if(event.action==='ACTIVATE'||event.action==='DEACTIVATE'){if(s.promotion_status!=='PROMOTED')throw Error('Activation state changes require an approved entry');}
  }else throw Error('Unknown bank action; no dynamic active-set operation');
  const expectedActivation=event.action==='ACTIVATE'?'ACTIVE':event.action==='DEACTIVATE'||next!==s.promotion_status?'INACTIVE':s.activation_status;
  if(event.to_state!==next||event.activation_status!==expectedActivation||event.activation_status==='ACTIVE'&&event.activation_reason!=='ACTIVE'||event.activation_status==='INACTIVE'&&event.activation_reason==='ACTIVE')throw Error('Promotion and activation state mismatch');
  s.promotion_status=next;s.activation_status=event.activation_status;s.activation_reason=event.activation_reason;s.last_event_hash=event.hash;lastTime=time(event.effective_at);lastAvailable=time(event.available_at);
 }
 return{definition:def,state:s};
}
/** Creates a proposed immutable event; caller persists it. Never auto-approves. */
export function proposeEvent(registry:BankRegistry,id:string,action:BankAction,at:string,proof:{evaluation_hash?:string;promotion_decision_hash?:string;actor_ref?:string;authority_hash?:string;activation_reason?:ActivationReason;reason:string}):BankEvent{
 const prior=bankState(registry,id,at);if(!prior)throw Error('Missing bank definition');const all=registry.events.filter(e=>e.entry_id===id);if(all.some(e=>time(e.effective_at)>time(at)||time(e.available_at)>time(at)))throw Error('Cannot append a backdated event before recorded future history');
 const to=stateActions[action]??prior.state.promotion_status,activation=action==='ACTIVATE'?'ACTIVE':action==='DEACTIVATE'||to!==prior.state.promotion_status?'INACTIVE':prior.state.activation_status;
 const body={entry_id:id,definition_hash:prior.definition.hash,scope:prior.definition.scope,sequence:all.length+1,previous_event_hash:prior.state.last_event_hash,action,from_state:prior.state.promotion_status,to_state:to,activation_status:activation as 'ACTIVE'|'INACTIVE',activation_reason:proof.activation_reason??(activation==='ACTIVE'?'ACTIVE':'MANUAL_HOLD'),effective_at:at,available_at:at,actor_ref:proof.actor_ref??null,authority_hash:proof.authority_hash??null,evidence_hash:prior.definition.evidence_hash,evaluation_hash:proof.evaluation_hash??null,promotion_decision_hash:proof.promotion_decision_hash??null,reason:proof.reason};
 const event=seal({event_id:'bank_event_'+canonicalHash(body),...body});bankState({...registry,events:[...registry.events,event]},id,at);return event;
}
