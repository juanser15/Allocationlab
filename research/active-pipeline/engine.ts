/** BANK result -> certified PIPE01 -> certified PIPE02. No BANK computation,
 * optimizer formula, research selection, governance write or execution call. */
import {canonicalHash,seal,time,available,verify} from '../governance/common';
import {route} from '../governance/router';
import {makeContext,runDecision} from '../pipeline/decision';
import {evaluatePortfolioRobustnessGate} from '../../artifacts/api-server/src/lib/allocation-core/gates/portfolio';
import {observeSource} from '../../artifacts/api-server/src/lib/allocation-core/gates/adapters';
import {prepare,resolveActive} from './projection';
import {VERSION,type Request,type Result,type Prepared,type Stage} from './contracts';
import type {CertifiedTarget,PrimaryOutcome} from '../governance/contracts';
export function routing(r:Request,d:Result,p:Prepared|null){
 if(time(r.routing.as_of)<time(r.decision_date)||time(r.routing.information_cutoff)>time(r.routing.as_of))throw Error('INVALID_INPUT: logical governance routing clock');
 if(r.routing.scope!==(p?.active.artifact.scope??r.routing.scope))throw Error('INVALID_INPUT: routing/ActiveSet scope mismatch');
 const target=d.pipeline?.final_target;let certificate:CertifiedTarget|null=null;
 if(target&&p){
  const date=r.decision_date,configHash=canonicalHash(r.source_candidate.spec),definitions=r.routing.registry.definitions.filter(d=>d.entry_id===r.routing.primary_entry_id&&available(d,r.routing.as_of,r.routing.information_cutoff));
  const definition=definitions.length===1?definitions[0]:null;if(definition)verify(definition);
  const approvedIdentity=definition&&definition.scope===r.routing.scope&&definition.identity.candidate_id===r.source_candidate.candidate_id&&definition.identity.allocation_mode==='STRATEGY_STREAMS'&&definition.identity.configuration_hash===configHash?definition.identity:null;
  const identity=structuredClone(approvedIdentity??{artifact_id:'PIPE03_SOURCE_CONFIGURATION:'+r.source_candidate.candidate_id,version:VERSION,candidate_id:r.source_candidate.candidate_id,allocation_mode:'STRATEGY_STREAMS' as const,configuration_hash:configHash}),h=canonicalHash(target);
  const body={as_of:date,information_cutoff:date,provenance:{data_hash:h,configuration_hash:identity.configuration_hash,source_ids:[d.integration_id],available_at:date},scope:r.routing.scope,identity,origin_decision_date:date,target:structuredClone(target),target_hash:h,certification_status:'VALID' as const,certifications:{PIPE01:'PASS',PIPE03:'PASS'},gate_statuses:{PORTFOLIO_ROBUSTNESS:d.pipeline!.robustness_gate!.status,SIGNAL_QUALITY:d.pipeline!.signal_status!},source:{source_id:'PIPE03_INLINE_CANONICAL_TARGET:'+target.target_id,path:'INLINE_CANONICAL_JSON_IN_INTEGRATION_RECORD',sha256:h,available_at:date}};
  certificate=seal({certificate_id:'certificate_'+canonicalHash(body),...body});
 }
 const primary:PrimaryOutcome=seal({decision_context_id:d.pipeline?.decision_context_id??d.integration_id,origin_decision_date:r.decision_date,candidate_id:r.source_candidate.candidate_id,risk_mandate_hash:canonicalHash(r.bundle_template.mandate),status:d.pipeline?.status??(d.status.startsWith('BLOCKED')?'BLOCKED_MISSING_ARTIFACTS':d.status.startsWith('INFEASIBLE')?'ALLOCATION_INFEASIBLE':'INVALID_INPUT'),reason:d.reason,target_certificate_hash:certificate?.hash??null});
 const env={...r.routing,primary,certificates:[...r.routing.certificates,...(certificate?[certificate]:[])]};return{certificate,record:route(env)};
}
export function runIntegration(r:Request,prepared?:Prepared):Result {
 const before=JSON.stringify(r),base={version:VERSION as typeof VERSION,integration_id:'integration_'+canonicalHash({request_id:r.request_id,decision_date:r.decision_date,information_cutoff:r.information_cutoff,active_set_hash:r.active_set_hash}),request_id:r.request_id,decision_date:r.decision_date,information_cutoff:r.information_cutoff,active_set_id:null,active_set_hash:r.active_set_hash,active_ids:[] as string[],excluded:[] as Result['excluded'],bank_snapshot_hash:null,status:'VALID',reason:null,projection:null,pipeline:null,compatibility_blocker:null,additional_robustness:null,certificate:null,routing:null,stages:[] as Stage[],source_unchanged:true};
 const d:Omit<Result,'hash'>=base;let p:Prepared|null=null;
 const stage=(name:string,status:string,output:unknown)=>{const body={integration_id:d.integration_id,sequence:d.stages.length+1,stage:name,status,market_information_cutoff:r.information_cutoff,input_hash:canonicalHash({previous:d.stages.at(-1)?.output_hash??null,active_set:r.active_set_hash}),output_hash:canonicalHash(output),output};d.stages.push({...body,stage_id:'integration_stage_'+canonicalHash(body)});};
 try{
  const bank=prepared?.active??resolveActive(r);d.active_set_id=bank.artifact.active_set_id;d.active_ids=[...bank.artifact.active_strategy_ids];d.excluded=structuredClone(bank.artifact.inactive);d.bank_snapshot_hash=bank.artifact.bank_snapshot_hash;
  let preparationError:unknown=null;try{p=prepared??prepare(r);}catch(e){preparationError=e;}
  if(p)d.integration_id='integration_'+canonicalHash({request_id:r.request_id,prepared_identity:p.identity});
  stage('FROZEN_BANK01_ACTIVE_SET','VALID',{active_set_id:d.active_set_id,active_ids:d.active_ids,excluded:d.excluded,bank_snapshot_hash:d.bank_snapshot_hash});
  if(preparationError)throw preparationError;if(!p)throw Error('INVALID_INPUT: no prepared input');d.projection=p.projection;
  stage('ACTIVE_ONLY_AL05_INPUT','VALID',p.projection);
  const lock={candidate_id:p.candidate.candidate_id,selection_hash:canonicalHash({source_candidate:r.source_candidate.candidate_id,active_set:r.active_set_hash,compilation:'NO_SEARCH_NO_NEW_SELECTION'}),outer_fold:0,source_id:'PIPE03_DECLARED_CONFIGURATION_NO_AL07_SEARCH'};
  const c=makeContext(p.candidate,p.bundle,p.calendar,lock,0);if(c.information_cutoff!==r.information_cutoff)throw Error('INVALID_INPUT: PIPE01 advanced cutoff');
  d.pipeline=runDecision(c,p.bundle);d.status=d.pipeline.status;d.reason=d.pipeline.reason;
  for(const s of d.pipeline.stages)stage('PIPE01:'+s.stage,s.status,s);
  const allocation=d.pipeline.allocation;
  if(allocation?.mode==='STRATEGY_STREAMS'){
   if(canonicalHash(Object.keys(allocation.result.allocations??{}).sort())!==canonicalHash([...p.projection.active_ids].sort())&&allocation.result.status==='VALID')throw Error('INVALID_INPUT: allocator output escaped frozen active universe');
   if(allocation.result.status==='VALID'&&allocation.result.controller_compatibility==='SIGNED_OR_NON_NET_ONE_EXPOSURE')d.compatibility_blocker='BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE';
   // PIPE01 deliberately stops at missing compatible sleeve risk. Observe the
   // exact AL05 result for an explicit robustness diagnosis; never compose it.
   if(!d.pipeline.robustness_gate&&allocation.result.status==='VALID'){
    const hash=canonicalHash(allocation);d.additional_robustness=evaluatePortfolioRobustnessGate(observeSource(allocation,p.bundle.mandate,p.bundle.sensitivity),p.bundle.robustness_policy);
    if(canonicalHash(allocation)!==hash)throw Error('INVALID_INPUT: robustness observer changed allocation');stage('BLOCKED_PATH_ROBUSTNESS_OBSERVATION',d.additional_robustness.status,d.additional_robustness);
   }
  }
 }catch(error){d.status=String(error).replace(/^Error: /,'').split(':')[0];d.reason=String(error);d.pipeline=null;d.projection=null;stage('INTEGRATION_BOUNDARY',d.status,{reason:d.reason});}
 try{const rr=routing(r,d as Result,p);d.certificate=rr.certificate;d.routing=rr.record;stage('PIPE02_LOGICAL_ROUTING',rr.record.status,rr.record);}catch(error){stage('PIPE02_LOGICAL_ROUTING','BLOCKED',{reason:String(error)});if(d.status==='VALID'){d.status='ROUTING_BLOCKED';d.reason=String(error);}}
 d.source_unchanged=JSON.stringify(r)===before;if(!d.source_unchanged)throw Error('INVALID_INPUT: upstream bank/configuration/mandate changed');
 return seal(d);
}
