/** Offline certification driver. All output paths are PIPE-02 research reports. */
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalHash} from './common';
import {bankState,proposeEvent} from './bank';
import {prepare,ROUTING_AS_OF} from './data';
import {fixture,SYNTHETIC_ACTOR} from './fixtures';
import {route} from './router';
import {Journal} from './storage';
import {VERSION,type BankRegistry,type RoutingInput,type RoutingRecord} from './contracts';
import {freezeJson,atomicJson,writeCsv} from '../capital/storage';
const root='reports/pipe02';mkdirSync(root,{recursive:true});
if(!process.argv.includes('--certify'))throw Error('Explicit --certify required. Target certification only; no execution.');
const limitAt=process.argv.indexOf('--max-new-routes'),limit=limitAt<0?Infinity:Number(process.argv[limitAt+1]);if(!(limit===Infinity||Number.isInteger(limit)&&limit>=0))throw Error('Invalid route pause limit');
const hashFile=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const codeHashes=Object.fromEntries(readdirSync('research/governance').filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts')).sort().map(f=>['research/governance/'+f,hashFile('research/governance/'+f)]));
const source=prepare(),demo=fixture();
for(const [action,date]of [['SUSPEND','2027-02-01'],['RESUME','2027-02-02'],['ACTIVATE','2027-02-03'],['RETIRE','2027-03-01']] as const)demo.reg.events.push(proposeEvent(demo.reg,'ENTRY_A',action,date,{actor_ref:SYNTHETIC_ACTOR,authority_hash:demo.authority.hash,activation_reason:action==='ACTIVATE'?'ACTIVE':'MANUAL_HOLD',reason:'SYNTHETIC lifecycle demonstration, not actual research governance'}));
const distinct=<T extends {hash:string}>(a:T[])=>[...new Map(a.map(x=>[x.hash,x])).values()];
const reg:BankRegistry={definitions:[...source.registry.definitions,...demo.reg.definitions],events:[...source.registry.events,...demo.reg.events],evidence:distinct([...source.registry.evidence,...demo.reg.evidence]),policies:distinct([...source.registry.policies,...demo.reg.policies]),evaluations:distinct([...source.registry.evaluations,...demo.reg.evaluations]),decisions:distinct([...source.registry.decisions,...demo.reg.decisions]),authorities:distinct([...source.registry.authorities,...demo.reg.authorities])};
const synthetic=JSON.parse(readFileSync(root+'/synthetic-routing.json','utf8')) as Array<{label:string;input:RoutingInput;result:RoutingRecord}>;
const jobs=[...source.inputs,...synthetic.map((x,i)=>({experiment_id:'SYNTHETIC_KNOWN_ANSWER_'+i,input:x.input}))];
if(jobs.length>500)throw Error('Fixed certification guard exceeded, refusing unbounded replay');
freezeJson(root+'/manifest.json',{version:VERSION,code_hashes:codeHashes,source_catalog_hash:canonicalHash([...source.reader.refs.values()]),jobs:jobs.length,financial_model_runs:0,search_runs:0,backtests:0,scope:'Offline research governance; QA approvals are not real promotions',as_of:ROUTING_AS_OF});
freezeJson(root+'/source-catalog.json',[...source.reader.refs.values()]);
const journal=new Journal(root+'/journal',canonicalHash(codeHashes),'PIPE02_OFFLINE_CERTIFICATION');
for(const e of reg.evidence)journal.put('evidence',e.hash,{hash:e.hash},e);
for(const v of reg.evaluations)journal.put('evaluations',v.hash,{hash:v.hash},v);
for(const d of reg.decisions)journal.put('approvals',d.hash,{hash:d.hash},d);
for(const e of reg.events)journal.put('transitions',{entry:e.entry_id,sequence:e.sequence},{hash:e.hash},e);
const existingRouteKeys=new Set(existsSync(root+'/journal/routes')?readdirSync(root+'/journal/routes'):[]),routes:Array<{experiment_id:string;record:RoutingRecord}>=[];let newRoutes=0,reusedRoutes=0,paused=false;
for(const job of jobs){
 const key={experiment_id:job.experiment_id,context:job.input.primary.decision_context_id,stream:job.input.routing_stream_id,at:job.input.as_of},file=canonicalHash(key)+'.json',exists=existingRouteKeys.has(file);
 if(!exists&&newRoutes>=limit){paused=true;break;}
 const record=route(job.input),value=journal.put('routes',key,{input:record.input_hash},{experiment_id:job.experiment_id,record});routes.push(value);if(exists)reusedRoutes++;else newRoutes++;
}
atomicJson(root+'/last-invocation.json',{status:paused?'PAUSED':'COMPLETE',new_routes:newRoutes,reused_routes:reusedRoutes,new_journal_records:journal.added,reused_journal_records:journal.reused,financial_model_runs:0,search_runs:0,backtests:0});
if(paused){atomicJson(root+'/pause-evidence.json',{new_routes:newRoutes,reused_routes:reusedRoutes,completed_route_files:readdirSync(root+'/journal/routes'),completed_transition_files:readdirSync(root+'/journal/transitions')});console.log('PAUSED',newRoutes,'new routing records');process.exit(0);}
const jsonl=(path:string,values:unknown[])=>writeFileSync(root+'/'+path,values.map(x=>JSON.stringify(x)).join('\n')+'\n');
const csv=(path:string,values:Array<Record<string,unknown>>,headers?:string[])=>writeCsv(root+'/'+path,values,headers);
atomicJson(root+'/promotion-policies.json',reg.policies);jsonl('promotion-evidence.jsonl',reg.evidence);csv('promotion-evaluations.csv',reg.evaluations.map(x=>({...x})));csv('promotion-decisions.csv',reg.decisions.map(x=>({...x})));jsonl('promotion-ledger.jsonl',reg.events);atomicJson(root+'/bank-registry-full.json',reg);
const snapshots=reg.definitions.map(d=>{const at=d.entry_id.startsWith('ENTRY_')?'2027-03-02':ROUTING_AS_OF;return{...d,...bankState(reg,d.entry_id,at)!.state,snapshot_as_of:at};});csv('bank-registry.csv',snapshots);
csv('bank-status-history.csv',reg.events.map(e=>({...e})));atomicJson(root+'/routing-policies.json',distinct(jobs.map(j=>j.input.policy)));jsonl('certified-targets.jsonl',[...source.certificates,...demo.input.certificates]);
csv('fallback-registry.csv',[{...demo.fallback}]);jsonl('routing-ledger.jsonl',routes);csv('routing-decisions.csv',routes.map(x=>({experiment_id:x.experiment_id,...x.record})));
csv('fallback-usage.csv',routes.filter(x=>['USE_PREAPPROVED_FALLBACK','HOLD_PREVIOUS_CERTIFIED_TARGET'].includes(x.record.action)).map(x=>({experiment_id:x.experiment_id,...x.record})),['experiment_id','decision_context_id','primary_status','action','previous_target_reference','fallback_reference','selected_certificate_hash','status']);
csv('failure-summary.csv',routes.filter(x=>x.record.primary_status!=='VALID'||x.record.action!=='USE_PRIMARY_TARGET').map(x=>({experiment_id:x.experiment_id,decision_context_id:x.record.decision_context_id,primary_status:x.record.primary_status,primary_failure_reason:x.record.primary_failure_reason,action:x.record.action,routing_status:x.record.status,route_reason:x.record.route_reason})));
csv('blockers.csv',[{blocker:'NO_HISTORICAL_GOVERNANCE_RECORDS',scope:'Original 2020-2021 routing',status:'BLOCKED',evidence:'No backdating of certification/policy/approval from 2026'},{blocker:'REAL_PROMOTION_NOT_AUTHORIZED',scope:'Actual research registry today',status:'NOT_PROMOTED',evidence:'PROMOTABLE is not PROMOTED; all APPROVE records are QA_ONLY'},{blocker:'CURRENT_MARKET_HEALTH_NOT_AVAILABLE',scope:'Current real target consumption',status:'BLOCKED',evidence:'Archive byte integrity is not fresh market-data health'},{blocker:'HISTORICAL_FACTORS_STRATEGIES_MISSING',scope:'Inherited baseline limitation',status:'BLOCKED',evidence:'No additional artifacts invented'}]);
const comparison=routes.filter(x=>x.experiment_id==='ARCHIVAL_IDENTITY_REPLAY_QA_NOT_EX_ANTE').map(x=>{const input=jobs.find(j=>j.experiment_id===x.experiment_id&&j.input.primary.decision_context_id===x.record.decision_context_id)!.input,certificate=input.certificates.find(c=>c.hash===input.primary.target_certificate_hash)!;return{decision_context_id:x.record.decision_context_id,origin_decision_date:input.primary.origin_decision_date,routing_as_of:x.record.routing_timestamp,action:x.record.action,target_id:x.record.selected_certified_target?.target_id??null,frozen_target_id:certificate.target.target_id,target_exact_equal:canonicalHash(x.record.selected_certified_target)===canonicalHash(certificate.target),status:x.record.action==='USE_PRIMARY_TARGET'&&canonicalHash(x.record.selected_certified_target)===canonicalHash(certificate.target)?'PASS':'FAIL'};});csv('replay-comparison.csv',comparison);
// Store compact real replay inputs, and complete small synthetic input snapshots.
jsonl('routing-inputs.jsonl',jobs.map(j=>{const {registry,certificates,...input}=j.input;return j.experiment_id.startsWith('SYNTHETIC_')?{experiment_id:j.experiment_id,input:j.input,registry_ref:'INLINE_SYNTHETIC'}:{experiment_id:j.experiment_id,input,registry_ref:'MAIN',certificate_ref:'certified-targets.jsonl'};}));
const counts=Object.fromEntries([...new Set(routes.map(x=>x.experiment_id))].map(experiment=>[experiment,Object.fromEntries([...new Set(routes.filter(x=>x.experiment_id===experiment).map(x=>x.record.action))].map(a=>[a,routes.filter(x=>x.experiment_id===experiment&&x.record.action===a).length]))]));
atomicJson(root+'/summary.json',{status:comparison.length===96&&comparison.every(r=>r.status==='PASS')?'PASS':'FAIL',version:VERSION,real_evidence_packets:source.registry.evidence.length,real_promoted:source.registry.definitions.filter(d=>d.scope==='RESEARCH_GOVERNANCE'&&bankState(source.registry,d.entry_id,ROUTING_AS_OF)!.state.promotion_status==='PROMOTED').length,archival_exact_targets:comparison.length,routing_records:routes.length,promotion_transitions:reg.events.length,counts,all_approvals_are_QA_ONLY:reg.decisions.every(d=>d.scope==='QA_ONLY'),financial_model_runs:0,optimizer_calls:0,search_runs:0,backtests:0,production_decisions:0});
console.log(JSON.stringify({status:'COMPLETE',new_routes:newRoutes,reused_routes:reusedRoutes,records:routes.length,archival_exact:comparison.filter(x=>x.status==='PASS').length,actual_research_promotions:0},null,2));if(comparison.some(x=>x.status!=='PASS'))process.exitCode=1;
