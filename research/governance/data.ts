/** Read frozen bytes only. No financial engine, performance computation or search. */
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalHash,seal} from './common';
import {authority,point,policy,register,routingPolicy} from './fixtures';
import type {BankRegistry,CertifiedTarget,DataHealth,FrozenRef,Identity,PromotionEvidence,RoutingInput,Scope} from './contracts';
import type {PipelineDecision} from '../pipeline/contracts';
export const CERTIFICATION_AS_OF='2026-10-17T00:00:00Z';
export const ROUTING_AS_OF='2026-10-17T00:06:00Z';
const artifactPoint=(at:string,refs:FrozenRef[],configuration:unknown)=>({as_of:at,information_cutoff:at,provenance:{data_hash:canonicalHash(refs.map(r=>({path:r.path,sha256:r.sha256}))),configuration_hash:canonicalHash(configuration),source_ids:refs.map(r=>r.source_id),available_at:at}});
export class FrozenReader {
 refs=new Map<string,FrozenRef>();
 constructor(readonly expected:Record<string,string>){}
 bytes(path:string):Buffer{const data=readFileSync(path),sha=createHash('sha256').update(data).digest('hex');if(this.expected[path]!==sha)throw Error('Frozen source absent/changed: '+path);this.refs.set(path,{source_id:path,path,sha256:sha,available_at:CERTIFICATION_AS_OF});return data;}
 json<T=any>(path:string):T{return JSON.parse(this.bytes(path).toString()) as T;}
 ref(path:string):FrozenRef{this.bytes(path);return this.refs.get(path)!;}
}
export function prepare(){
 const checkpoint=JSON.parse(readFileSync('reports/pipe02/checkpoint.json','utf8')) as {files:Record<string,string>},reader=new FrozenReader(checkpoint.files);
 const pipe=reader.json('reports/pipe01/verification.json'),are=reader.json('reports/al07/verification.json');if(pipe.status!=='PASS'||are.status!=='PASS')throw Error('Frozen prerequisite certification missing');
 const registry:BankRegistry={definitions:[],events:[],evidence:[],policies:[],evaluations:[],decisions:[],authorities:[]},inputs:Array<{experiment_id:string;input:RoutingInput}> = [],certificates:CertifiedTarget[]=[];
 const frozen= readdirSync('reports/pipe01/replay/decisions').filter(f=>f.endsWith('.json')).sort().map(f=>({path:'reports/pipe01/replay/decisions/'+f,envelope:reader.json('reports/pipe01/replay/decisions/'+f)}));
 for(const row of frozen)if(canonicalHash(row.envelope.value)!==row.envelope.value_hash)throw Error('PIPE01 durable decision checksum mismatch');
 const qaAuthority=authority(CERTIFICATION_AS_OF);
 for(const campaign of ['AL07_REAL_NESTED_ROLLING','AL07_REAL_TRADITIONAL_EXPANDING']){
  const root='reports/al07/campaigns/'+campaign,summary=reader.json(root+'/summary.json'),manifest=reader.json(root+'/manifest.json');
  const winners=[...new Set<string>(summary.selections.map((s:any)=>s.candidate_id))];if(winners.length!==1||!winners[0])throw Error('BLOCKED_NO_CANDIDATE_SPECIFIC_FROZEN_OUTER_SUMMARY');
  const candidate=(reader.json(root+'/candidates.json') as any[]).find(c=>c.candidate_id===winners[0]);
  for(const bps of [0,5]){
   const metrics=summary.performance.find((m:any)=>m.track==='NORMALIZED'&&m.scenario_bps===bps);if(!metrics||metrics.status!=='VALID')throw Error('Missing frozen OOS metrics');
   const commonRefs=['summary.json','manifest.json','candidates.json','outer-oos-results.csv','fold-performance-stability.csv','selection-stability.csv','psr.csv','risk-attribution.csv','gate-outcomes.csv'].map(p=>reader.ref(root+'/'+p));
   const references=[...commonRefs,...['reports/al07/verification.json','reports/pipe01/verification.json','reports/pipe01/independent-verification.json','reports/pipe01/reproducibility.json'].map(p=>reader.ref(p))];
   const identity:Identity={artifact_id:'AL07_SELECTED:'+campaign+':'+bps+'bps',version:'FROZEN_AL07_1.0.1_PIPE01_1.0.2',candidate_id:candidate.candidate_id,allocation_mode:candidate.spec.allocation_mode,configuration_hash:canonicalHash(candidate.spec)};
   const pairs=new Map<Scope,{entry_id:string;packet:PromotionEvidence;certificates:Map<string,CertifiedTarget>}>();
   for(const scope of ['RESEARCH_GOVERNANCE','QA_ONLY'] as const){
    const body={...artifactPoint(CERTIFICATION_AS_OF,references,{identity,scope,cost_scenario_bps:bps}),scope,identity,frozen_campaign_id:campaign,refs:references,observations:metrics.observations,oos_folds:summary.selections.length,
     metrics:{cagr:metrics.cagr,capm_alpha:metrics.alpha,psr:null,max_drawdown:Math.abs(metrics.max_drawdown),average_beta:null,downside_beta:metrics.downside_beta,tail_beta:metrics.tail_beta,turnover:metrics.turnover},
     certifications:{AL07:'PASS',PIPE01:'PASS'},gate_statuses:{PORTFOLIO_ROBUSTNESS:'PASS',SIGNAL_QUALITY:'NOT_REQUIRED'},robustness_status:'PASS',reproducibility_status:'PASS',cost_scenario_bps:bps,risk_mandate_hashes:manifest.risk_mandate_hashes,code_hashes:[manifest.code_hash,pipe.counts.source_code_hash],data_hashes:[manifest.data_snapshot_hash],blockers:['LEGACY_NODE3_EQUIVALENCE_UNAVAILABLE','ZERO_CASH_YIELD_RESEARCH_ASSUMPTION','INDEPENDENT_OUTER_SLEEVES_NOT_LIVE_ACCOUNT']};
    const packet=seal({evidence_id:'evidence_'+canonicalHash(body),...body});const basePolicy=policy(CERTIFICATION_AS_OF,scope),{hash,...pbody}=basePolicy,p=seal({...pbody,...artifactPoint(CERTIFICATION_AS_OF,[reader.ref('reports/pipe01/verification.json')],{policy_id:pbody.promotion_policy_id,scope,thresholds:pbody.economic_hurdles,minimum_folds:pbody.minimum_oos_folds,minimum_observations:pbody.minimum_observations}),allowed_unresolved_blockers:[...body.blockers]});
    const entry_id=(scope==='QA_ONLY'?'QA_ARCHIVAL:':'RESEARCH_ONLY:')+identity.artifact_id;
    const underlying_ids=[...new Set<string>(frozen.filter(r=>r.envelope.value.context.selection_lock.source_id.includes(campaign)&&r.envelope.value.context.costs.bps===bps).flatMap(r=>Object.keys(r.envelope.value.final_target.final_asset_weights)))].sort();
    register(registry,identity,packet,p,qaAuthority,entry_id,'2026-10-17',scope==='QA_ONLY',{underlying_ids,market_tags:['FROZEN_ASSETS'],region_tags:[]});pairs.set(scope,{entry_id,packet,certificates:new Map()});
   }
   for(const row of frozen){
    const d=row.envelope.value as PipelineDecision,c=d.context;if(c.selection_lock.source_id.indexOf(campaign)<0||c.costs.bps!==bps)continue;
    if(d.status!=='VALID'||!d.final_target||d.robustness_gate?.status!=='PASS'||c.candidate.candidate_id!==identity.candidate_id)throw Error('Frozen selected decision identity/gate mismatch');
    for(const scope of ['RESEARCH_GOVERNANCE','QA_ONLY'] as const){
     const pair=pairs.get(scope)!,target=d.final_target,source=reader.ref(row.path);
     const cp=artifactPoint(CERTIFICATION_AS_OF,[source],{identity,target_id:target.target_id});cp.provenance.data_hash=source.sha256;
     const certBody={...cp,scope,identity,origin_decision_date:c.decision_date,target,target_hash:canonicalHash(target),certification_status:'VALID' as const,certifications:{PIPE01:'PASS'},gate_statuses:{PORTFOLIO_ROBUSTNESS:'PASS',SIGNAL_QUALITY:d.signal_status??'UNKNOWN'},source};
     const cert=seal({certificate_id:'certificate_'+canonicalHash(certBody),...certBody});certificates.push(cert);pair.certificates.set(c.decision_context_id,cert);
     const primary=seal({decision_context_id:c.decision_context_id,origin_decision_date:c.decision_date,candidate_id:c.candidate.candidate_id,risk_mandate_hash:c.risk_mandate_hash,status:d.status,reason:d.reason,target_certificate_hash:cert.hash});
     const rawPolicy=routingPolicy(CERTIFICATION_AS_OF),{hash,...rp}=rawPolicy,routing=seal({...rp,...artifactPoint(CERTIFICATION_AS_OF,[reader.ref('reports/pipe01/verification.json')],{scope,rules:rp.rules}),scope,routing_policy_id:scope==='QA_ONLY'?'QA_ARCHIVAL_IDENTITY_REPLAY':'RESEARCH_NO_AUTHORIZATION',accepted_data_health_kinds:scope==='QA_ONLY'?['ARCHIVAL_ARTIFACT_INTEGRITY'] as typeof rawPolicy.accepted_data_health_kinds:['MARKET_INFORMATION'] as typeof rawPolicy.accepted_data_health_kinds,primary_max_age_days:scope==='QA_ONLY'?10000:7});
     const artifactHealth:DataHealth=seal({...artifactPoint(ROUTING_AS_OF,[source],{method:'FROZEN_BYTES_SHA256_CHECK_NOT_MARKET_HEALTH'}),health_id:'FROZEN_ARTIFACT_INTEGRITY_'+source.sha256,kind:'ARCHIVAL_ARTIFACT_INTEGRITY' as const,status:'HEALTHY' as const,data_as_of:ROUTING_AS_OF});
     const input:RoutingInput={routing_stream_id:campaign+':'+bps+'bps:'+scope,scope,as_of:ROUTING_AS_OF,information_cutoff:ROUTING_AS_OF,primary,primary_entry_id:pair.entry_id,policy:routing,registry,certificates:[],fallbacks:[],previous_target_hash:null,previous_routes:[],data_health:artifactHealth,recertifications:[]};
     inputs.push({experiment_id:scope==='QA_ONLY'?'ARCHIVAL_IDENTITY_REPLAY_QA_NOT_EX_ANTE':'CURRENT_REAL_GOVERNANCE_UNAPPROVED',input});
     if(scope==='RESEARCH_GOVERNANCE')inputs.push({experiment_id:'ORIGINAL_DATE_PIT_GOVERNANCE_UNAVAILABLE',input:{...input,as_of:c.decision_date,information_cutoff:c.information_cutoff,data_health:null}});
    }
   }
  }
 }
 for(const job of inputs)job.input.certificates=certificates;
 return{reader,registry,certificates,inputs};
}
