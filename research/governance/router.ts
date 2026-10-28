import {available,canonicalHash,day,keys,point,seal,time,unique,verify,within} from './common';
import {bankState} from './bank';
import type {Action,BankState,CertifiedTarget,Condition,RoutingInput,RoutingRecord} from './contracts';
const conditions:Condition[]=['PRIMARY_PIPELINE_PASS','SIGNAL_GATE_FAIL','SIGNAL_INSUFFICIENT_DATA','ALLOCATION_FAILURE','ROBUSTNESS_GATE_FAIL','RISK_TARGET_INFEASIBLE','MISSING_ARTIFACT','PROMOTION_NOT_ALLOWED','ENTRY_INACTIVE','DATA_STALE'];
const actions:Action[]=['USE_PRIMARY_TARGET','HOLD_PREVIOUS_CERTIFIED_TARGET','USE_PREAPPROVED_FALLBACK','NO_NEW_TARGET','BLOCKED'];
export function validateCertificate(c:CertifiedTarget){
 verify(c);point(c);keys(c,['certificate_id','scope','identity','origin_decision_date','target','target_hash','certification_status','certifications','gate_statuses','source','as_of','information_cutoff','provenance','hash']);
 const target=c.target,{target_id,...body}=target;
 keys(target,['target_id','decision_context_id','risk_mandate_hash','allocation_id','robustness_gate_id','composition_id','final_asset_weights','implementation_cash','expected_final_beta','expected_final_volatility','gross_exposure','net_exposure','execution','status','provenance']);
 if(c.target_hash!==canonicalHash(target)||target_id!=='target_'+canonicalHash(body)||c.certification_status!=='VALID'||target.status!=='VALID'||time(c.origin_decision_date)>time(c.as_of)||time(c.source.available_at)>time(c.information_cutoff))throw Error('Invalid frozen target certificate');
 if(!Object.values(target.final_asset_weights).every(Number.isFinite)||![target.implementation_cash,target.gross_exposure,target.net_exposure].every(Number.isFinite))throw Error('Nonfinite certified target');
}
export function route(input:RoutingInput):RoutingRecord{
 const {primary,policy,as_of:at,information_cutoff:cutoff}=input;
 let state:BankState|null=null,observed:Condition[]=[],selected:Condition|null=null,action:Action='BLOCKED',reason:string|null=null,selectedCertificate:CertifiedTarget|null=null,fallbackHash:string|null=null;
 let view:unknown={primary_hash:primary.hash,policy_hash:policy.hash,as_of:at,cutoff};
 try{
  verify(primary);verify(policy);point(policy);
  keys(primary,['decision_context_id','origin_decision_date','candidate_id','risk_mandate_hash','status','reason','target_certificate_hash','hash']);
  keys(policy,['routing_policy_id','version','scope','condition_priority','rules','primary_max_age_days','maximum_data_age_days','accepted_data_health_kinds','hold','fallback','required_certifications','required_gates','as_of','information_cutoff','provenance','hash']);
  if(time(cutoff)>time(at)||!available(policy,at,cutoff)||input.scope!==policy.scope||!input.routing_stream_id||!primary.decision_context_id)throw Error('Routing policy/context scope/PIT mismatch');
  keys(policy.hold,['maximum_target_age_days','require_current_data_health','risk_mandate_must_match','require_mechanical_recertification','recertification_checks','maximum_consecutive_holds','on_invalid']);keys(policy.fallback,['allow_different_preapproved_risk_mandate','on_invalid']);
  if(policy.hold.require_mechanical_recertification&&!policy.hold.recertification_checks.length)throw Error('Required recertification needs explicit nonempty check list');
  unique(policy.condition_priority,'route condition priorities');
  if(policy.condition_priority.some(c=>!conditions.includes(c))||Object.keys(policy.rules).some(c=>!conditions.includes(c as Condition)))throw Error('Unknown routing condition');
  for(const rule of Object.values(policy.rules)){keys(rule,['action','fallback_hash']);if(!actions.includes(rule.action)||(rule.action==='USE_PREAPPROVED_FALLBACK'?!rule.fallback_hash:rule.fallback_hash!==null))throw Error('Invalid explicit route rule');}
  for(const n of [policy.primary_max_age_days,policy.maximum_data_age_days,policy.hold.maximum_target_age_days,policy.hold.maximum_consecutive_holds])if(!Number.isFinite(n)||n<0)throw Error('Invalid explicit staleness/hold limit');
  if(!Number.isInteger(policy.hold.maximum_consecutive_holds)||!['NO_NEW_TARGET','BLOCKED'].includes(policy.hold.on_invalid)||!['NO_NEW_TARGET','BLOCKED'].includes(policy.fallback.on_invalid))throw Error('Explicit rejection action required');
  const bank=bankState(input.registry,input.primary_entry_id,at,cutoff);state=bank?.state??null;
  if(bank&&(bank.definition.scope!==input.scope||bank.definition.identity.candidate_id!==primary.candidate_id))throw Error('Primary bank identity/scope mismatch');
  const visibleCertificates=input.certificates.filter(c=>c.scope===input.scope&&available(c,at,cutoff));unique(visibleCertificates.map(c=>c.hash),'certificate hashes');
  const primaryCert=visibleCertificates.find(c=>c.hash===primary.target_certificate_hash)??null;
  const previous=visibleCertificates.find(c=>c.hash===input.previous_target_hash)??null;
  const health=input.data_health&&available(input.data_health,at,cutoff)?input.data_health:null;if(health){verify(health);point(health);}
  const healthy=!!health&&health.status==='HEALTHY'&&policy.accepted_data_health_kinds.includes(health.kind)&&time(health.data_as_of)<=time(cutoff)&&(time(at)-time(health.data_as_of))/day<=policy.maximum_data_age_days;
  const previousRoutes=input.previous_routes.filter(r=>r.routing_stream_id===input.routing_stream_id&&r.scope===input.scope&&time(r.routing_timestamp)<time(at)&&time(r.information_cutoff)<=time(cutoff)).sort((a,b)=>time(a.routing_timestamp)-time(b.routing_timestamp)||a.routing_id.localeCompare(b.routing_id));
  for(const r of previousRoutes)verify(r);
  unique(previousRoutes.map(r=>r.decision_context_id),'previous decision contexts');
  const visibleFallbacks=input.fallbacks.filter(f=>f.scope===input.scope&&available(f,at,cutoff));
  const recerts=input.recertifications.filter(r=>available(r,at,cutoff));
  // Identity contains only the actually observable governance information set.
  view={primary,policy,bank,primary_certificate:primaryCert,previous_certificate:previous,data_health:health,previous_routes:previousRoutes.map(r=>r.hash)};
  if(!state||state.promotion_status!=='PROMOTED')observed.push('PROMOTION_NOT_ALLOWED');
  if(bank&&(!within(at,bank.definition.valid_from,bank.definition.valid_until)||state?.activation_status!=='ACTIVE'))observed.push('ENTRY_INACTIVE');
  if(!healthy)observed.push('DATA_STALE');
  const status=primary.status;
  if(status==='VALID'){
   if(!primaryCert)observed.push('MISSING_ARTIFACT');
   else{
    validateCertificate(primaryCert);
    if(primaryCert.identity.candidate_id!==primary.candidate_id||primaryCert.target.decision_context_id!==primary.decision_context_id||primaryCert.target.risk_mandate_hash!==primary.risk_mandate_hash)throw Error('Primary target/candidate/mandate identity mismatch');
    if(bank&&(canonicalHash(bank.definition.identity)!==canonicalHash(primaryCert.identity)||!input.registry.evidence.find(e=>e.hash===bank.definition.evidence_hash)?.risk_mandate_hashes.includes(primaryCert.target.risk_mandate_hash)))throw Error('Primary target outside approved configuration/RiskMandate evidence');
    if(policy.required_certifications.some(c=>primaryCert.certifications[c]!=='PASS')||policy.required_gates.some(g=>primaryCert.gate_statuses[g]!=='PASS'))throw Error('Missing required target certification/gate');
    if((time(at)-time(primaryCert.origin_decision_date))/day>policy.primary_max_age_days)observed.push('DATA_STALE');
   }
  }else if(status==='SIGNAL_GATE_FAIL')observed.push('SIGNAL_GATE_FAIL');
  else if(status==='SIGNAL_GATE_INSUFFICIENT_DATA')observed.push('SIGNAL_INSUFFICIENT_DATA');
  else if(status==='ROBUSTNESS_GATE_FAIL')observed.push('ROBUSTNESS_GATE_FAIL');
  else if(status==='EXPOSURE_INFEASIBLE')observed.push('RISK_TARGET_INFEASIBLE');
  else if(['BLOCKED_MISSING_ARTIFACTS','MISSING_SLEEVE_RISK'].includes(status))observed.push('MISSING_ARTIFACT');
  else if(['ALLOCATION_INFEASIBLE','ALLOCATION_NUMERICAL_FAILURE','ALLOCATION_INVALID_INPUT','ALLOCATION_INSUFFICIENT_DATA','INVALID_INPUT','SIGNAL_GATE_INVALID_INPUT','SIGNAL_GATE_NUMERICAL_FAILURE','EXECUTION_FAILURE','ACCOUNTING_FAILURE'].includes(status))observed.push('ALLOCATION_FAILURE');
  else throw Error('Unhandled primary pipeline state; default BLOCKED');
  observed=[...new Set(observed)];if(!observed.length)observed=['PRIMARY_PIPELINE_PASS'];
  selected=policy.condition_priority.find(c=>observed.includes(c))??null;const rule=selected?policy.rules[selected]:null;
  if(!rule){action='BLOCKED';reason='No explicit rule for observed condition';}
  else{
   action=rule.action;
   if(action==='USE_PRIMARY_TARGET'){
    if(selected!=='PRIMARY_PIPELINE_PASS'||status!=='VALID'||!primaryCert)throw Error('Cannot bypass a failed/ineligible primary');selectedCertificate=primaryCert;
   }else if(action==='HOLD_PREVIOUS_CERTIFIED_TARGET'){
    let invalid:string|null=null;
    if(!previous)invalid='No available previous certified target';
    else{
     validateCertificate(previous);
     if((time(at)-time(previous.origin_decision_date))/day>policy.hold.maximum_target_age_days)invalid='Previous target stale';
     if(policy.hold.risk_mandate_must_match&&previous.target.risk_mandate_hash!==primary.risk_mandate_hash)invalid='Previous RiskMandate differs';
     if(policy.required_certifications.some(c=>previous.certifications[c]!=='PASS')||policy.required_gates.some(g=>previous.gate_statuses[g]!=='PASS'))invalid='Previous target missing certifications';
     const active= input.registry.definitions.filter(d=>d.scope===input.scope&&canonicalHash(d.identity)===canonicalHash(previous.identity)&&available(d,at,cutoff)).some(d=>{const bank=bankState(input.registry,d.entry_id,at,cutoff);return bank?.state.promotion_status==='PROMOTED'&&bank.state.activation_status==='ACTIVE'&&within(at,d.valid_from,d.valid_until);});
     if(!active)invalid='Previous target no longer approved/active';
     const last=previousRoutes.filter(r=>r.selected_certificate_hash).at(-1);if(last&&last.selected_certificate_hash!==previous.hash)invalid='Not latest previously selected certified target';
     if(policy.hold.require_mechanical_recertification){const recert=recerts.find(r=>r.target_certificate_hash===previous.hash&&r.status==='VALID'&&policy.hold.recertification_checks.every(c=>r.required_checks[c]==='PASS')&&r.as_of.slice(0,10)===at.slice(0,10));view={...view as object,recertification:recert??null};if(!recert)invalid='Missing current mechanical recertification';else{verify(recert);point(recert);}}
    }
    let holds=0;for(const r of [...previousRoutes].reverse()){if(r.action!=='HOLD_PREVIOUS_CERTIFIED_TARGET'||r.status!=='VALID')break;holds++;}
    if(holds>=policy.hold.maximum_consecutive_holds)invalid='Maximum consecutive holds reached';
    if(policy.hold.require_current_data_health&&!healthy)invalid='Current data health required';
    if(invalid){action=policy.hold.on_invalid;reason=invalid;}else selectedCertificate=previous;
   }else if(action==='USE_PREAPPROVED_FALLBACK'){
    const fallback=visibleFallbacks.find(f=>f.hash===rule.fallback_hash);fallbackHash=rule.fallback_hash;let invalid:string|null=null;
    view={...view as object,selected_fallback_definition:fallback??null};
    if(!fallback)invalid='No available preapproved fallback; no dynamic creation';
    else{
     verify(fallback);point(fallback);
     const certificate=visibleCertificates.find(c=>c.hash===fallback.target_certificate_hash),bank=bankState(input.registry,fallback.bank_entry_id,at,cutoff);
     const preapprovedBank=bankState(input.registry,fallback.bank_entry_id,fallback.provenance.available_at,fallback.provenance.available_at);
     if(fallback.fallback_type!=='FROZEN_CERTIFIED_TARGET'||time(fallback.provenance.available_at)>=time(at)||!within(at,fallback.valid_from,fallback.valid_until))invalid='Fallback not preapproved/valid at routing time';
     if(!bank||bank.state.promotion_status!=='PROMOTED'||bank.state.activation_status!=='ACTIVE'||bank.definition.evidence_hash!==fallback.certification_evidence_hash||!within(at,bank.definition.valid_from,bank.definition.valid_until))invalid='Fallback bank approval/activation missing';
     if(preapprovedBank?.state.promotion_status!=='PROMOTED')invalid='Fallback was not promoted when its preapproval definition became available';
     if(!certificate)invalid='Fallback certificate unavailable';
     else{
      validateCertificate(certificate);
      if(time(certificate.provenance.available_at)>time(fallback.provenance.available_at)||time(certificate.as_of)>time(fallback.provenance.available_at))invalid='Fallback certificate postdates preapproval';
      if(canonicalHash(certificate.identity)!==canonicalHash(fallback.allocation_configuration)||certificate.target.risk_mandate_hash!==fallback.risk_mandate_hash||bank&&canonicalHash(bank.definition.identity)!==canonicalHash(certificate.identity))invalid='Fallback identity/RiskMandate mismatch';
      if(bank&&!input.registry.evidence.find(e=>e.hash===bank.definition.evidence_hash)?.risk_mandate_hashes.includes(certificate.target.risk_mandate_hash))invalid='Fallback RiskMandate absent from approval evidence';
      if(fallback.risk_mandate_hash!==primary.risk_mandate_hash&&!policy.fallback.allow_different_preapproved_risk_mandate)invalid='Different fallback RiskMandate not explicitly allowed';
      if([...policy.required_certifications,...fallback.required_certifications].some(c=>certificate.certifications[c]!=='PASS')||[...policy.required_gates,...fallback.gate_requirements].some(g=>certificate.gate_statuses[g]!=='PASS'))invalid='Fallback mechanical certification/gate missing';
      if(!invalid)selectedCertificate=certificate;
     }
    }
    if(invalid){action=policy.fallback.on_invalid;reason=invalid;selectedCertificate=null;}
   }
  }
 }catch(error){action='BLOCKED';reason=String(error);selectedCertificate=null;}
 const body={decision_context_id:primary.decision_context_id,routing_stream_id:input.routing_stream_id,scope:input.scope,origin_decision_date:primary.origin_decision_date,primary_status:primary.status,primary_target_id:primary.target_certificate_hash?input.certificates.find(c=>c.hash===primary.target_certificate_hash&&available(c,at,cutoff))?.target.target_id??null:null,primary_hash:primary.hash,promotion_status:state?.promotion_status??null,activation_status:state?.activation_status??null,conditions:observed,selected_condition:selected,primary_failure_reason:primary.reason,route_reason:reason??(selected&&selected!=='PRIMARY_PIPELINE_PASS'?selected:null),routing_policy_id:policy.routing_policy_id,routing_policy_hash:policy.hash,action,status:action==='BLOCKED'?'BLOCKED' as const:'VALID' as const,previous_target_reference:input.previous_target_hash,fallback_reference:fallbackHash,selected_certificate_hash:selectedCertificate?.hash??null,selected_certified_target:selectedCertificate?structuredClone(selectedCertificate.target):null,routing_timestamp:at,information_cutoff:cutoff,input_hash:canonicalHash(view),provenance:{data_hash:canonicalHash(view),configuration_hash:policy.hash,source_ids:[primary.decision_context_id,policy.routing_policy_id,...(selectedCertificate?[selectedCertificate.source.source_id]:[])],available_at:cutoff}};
 return seal({routing_id:'route_'+canonicalHash(body),...body});
}
