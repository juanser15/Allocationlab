import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {beta,basicMetrics} from '../../artifacts/api-server/src/lib/allocation-core/risk-analytics/analytics';
import {atomicJson,freezeJson,writeCsv} from '../capital/storage';
import {realRequests,compareDecision,shaFile} from './data';
import {replay,economicHashes,executionStages} from './execution';
import type {BookResult} from './contracts';
const root='reports/pipe01';mkdirSync(root,{recursive:true});
const prepared=realRequests(),codePaths=readdirSync('research/pipeline').filter(f=>f.endsWith('.ts')&&!f.endsWith('.test.ts')).sort().map(f=>'research/pipeline/'+f),codeHashes=Object.fromEntries(codePaths.map(p=>[p,shaFile(p)])),codeHash=canonicalHash(codeHashes);
freezeJson(root+'/source-code-hashes.json',codeHashes);freezeJson(root+'/replay-source-hashes.json',prepared.sourceHashes);
const requestRoot=root+'/replay',before=economicHashes(requestRoot),options=process.argv.includes('--pause-after-one-book')?{max_new_executions:1}:{},run=replay(prepared.requests,requestRoot,codeHash,options);
atomicJson(root+'/last-invocation.json',{status:run.status,new_decisions:run.new_decisions,reused_decisions:run.reused_decisions,new_executions:run.new_executions,reused_executions:run.reused_executions});
if(run.status==='PAUSED'){atomicJson(root+'/pause-evidence.json',{status:run.status,new_decisions:run.new_decisions,new_executions:run.new_executions,completed_hashes:economicHashes(requestRoot)});console.log('PAUSED',run.new_decisions,'new decisions',run.new_executions,'new books');process.exit(0);}
const contexts=new Map(run.books.flatMap(b=>b.decisions.map(d=>[d.decision_context_id,d.context] as const))),stages=run.books.flatMap(b=>[...b.decisions.flatMap(d=>d.stages),...executionStages(b)]),uniqueStages=new Map(stages.map(s=>[s.stage_id,s]));
writeFileSync(root+'/decision-contexts.jsonl',[...contexts.values()].map(c=>JSON.stringify(c)).join('\n')+'\n');
writeFileSync(root+'/pipeline-stage-ledger.jsonl',[...uniqueStages.values()].map(s=>JSON.stringify(s)).join('\n')+'\n');
const decisions:Record<string,unknown>[]=[],targets:Record<string,unknown>[]=[],executions:Record<string,unknown>[]=[],accounting:Record<string,unknown>[]=[],risk:Record<string,unknown>[]=[],comparison:Record<string,unknown>[]=[],failures:Record<string,unknown>[]=[],equity:Record<string,unknown>[]=[],attribution:Record<string,unknown>[]=[];
for(const book of run.books){
 const req=prepared.requests.find(r=>r.book_id===book.book_id)!,job=prepared.comparators[book.book_id],track=req.track;
 const frozen=job.tracks[track]!.ledger,ledgerEqual=canonicalHash(book.ledger)===canonicalHash(frozen);
 comparison.push({book_id:book.book_id,component:'FULL_LEDGER',status:ledgerEqual?'PASS':'FAIL',actual_hash:canonicalHash(book.ledger),frozen_hash:canonicalHash(frozen),rows:book.ledger.length,frozen_rows:frozen.length,exact_no_tolerance:true});
 for(let i=0;i<book.decisions.length;i++){
  const d=book.decisions[i],c=d.context,t=d.final_target,previous=job.decisions.find(x=>x.date===c.decision_date)!,compare=compareDecision(d,previous),ok=Object.entries(compare).filter(([k])=>k.endsWith('_equal')).every(([,v])=>v===true);
  comparison.push({book_id:book.book_id,component:c.decision_context_id,date:c.decision_date,...compare,status:ok?'PASS':'FAIL'});
  if(d.status!=='VALID')failures.push({book_id:book.book_id,context_id:c.decision_context_id,date:c.decision_date,status:d.status,reason:d.reason});
  const projection=d.projection as {portfolio:{exposure_multiplier:number}}|null,nextExecution=book.decisions[i+1]?.context.execution.date??req.end_exclusive,
   forward=book.ledger.filter(r=>r.date>c.execution.date&&r.date<nextExecution),period=book.ledger.filter(r=>r.date>=c.execution.date&&r.date<nextExecution);
  const market=new Map(req.prices.slice(1).map((p,j)=>[p.date,p.prices.SPY/req.prices[j].prices.SPY-1])),pairs=forward.map(r=>({date:r.date,portfolio:r.netPnl/r.beginningNav,market:market.get(r.date)!,rf:0})),realized=beta(pairs),vol=pairs.length>1?basicMetrics(pairs,forward[0].intervalStart).annualized_volatility:null;
  const targetBeta=d.context.candidate.spec.risk_mandate?req.decisions[i].bundle.mandate.primary_target:null,expectedBeta=track==='RAW'?d.sleeve?.estimated_market_beta:t?.expected_final_beta,expectedVol=track==='RAW'?d.sleeve?.estimated_volatility:t?.expected_final_volatility;
  const realizedReturn=period.length?period.at(-1)!.endingNav/period[0].beginningNav-1:null;
  const row={book_id:book.book_id,track,decision_context_id:c.decision_context_id,date:c.decision_date,information_cutoff:c.information_cutoff,execution_date:c.execution.date,execution_convention:c.execution.convention,
   risk_mandate_id:req.decisions[i].bundle.mandate.policy_id,risk_mandate_hash:c.risk_mandate_hash,risk_mandate_status:d.stages.find(s=>s.stage==='RESOLVE_MANDATE')?.status,
   signal_gate_id:d.signal_gate?.gate_id??null,signal_gate_status:d.signal_status,allocator_mode:d.allocation?.mode,allocator_objective:c.candidate.spec.objective,selected_candidate_id:c.selection_lock.candidate_id,
   allocation_id:d.sleeve?.allocation_id??null,allocation_status:d.allocation?.result?.status??null,risk_sleeve_weights:d.sleeve?.asset_weights_risk_sleeve??null,sleeve_beta:d.sleeve?.estimated_market_beta??null,sleeve_vol:d.sleeve?.estimated_volatility??null,
   robustness_gate_id:d.robustness_gate?.gate_id??null,robustness_status:d.robustness_gate?.status??null,target_risk:targetBeta,exposure_multiplier:projection?.portfolio.exposure_multiplier??null,
   final_weights:t?.final_asset_weights??null,implementation_cash:t?.implementation_cash??null,expected_beta:expectedBeta??null,expected_vol:expectedVol??null,execution_status:book.status,
   realized_next_period_return:realizedReturn,realized_forward_beta:realized.value,realized_forward_volatility:vol,forward_observations:forward.length,
   period_convention:'Return: fill-inclusive to next-fill-exclusive ledger intervals; forward risk: strictly after fill to strictly before next fill',source_hashes:c.provenance,status:d.status};
  decisions.push(row);
  risk.push({book_id:book.book_id,decision_context_id:c.decision_context_id,date:c.decision_date,track,target_beta:targetBeta?.metric==='MARKET_BETA'?targetBeta.target:null,expected_beta:expectedBeta,realized_forward_beta:realized.value,expected_volatility:expectedVol,realized_forward_volatility:vol,realized_minus_target:track==='NORMALIZED'&&realized.value!==null&&targetBeta?.metric==='MARKET_BETA'?realized.value-targetBeta.target:null,realized_minus_expected:realized.value!==null&&expectedBeta!==null&&expectedBeta!==undefined?realized.value-expectedBeta:null,observations:forward.length,status:realized.status});
  if(t)targets.push({book_id:book.book_id,track,...t});
 }
 for(let i=0;i<book.ledger.length;i++){
  const r=book.ledger[i],f=frozen[i];executions.push({book_id:book.book_id,track,...r});accounting.push({book_id:book.book_id,...book.reconciliation[i]});
  if(!f||canonicalHash(r)!==canonicalHash(f))comparison.push({book_id:book.book_id,component:'DAILY_LEDGER',date:r.date,status:'FAIL'});
  equity.push({book_id:book.book_id,track,date:r.date,nav:r.endingNav,cash:r.endingCash,return:r.netPnl/r.beginningNav});
 }
 if(book.status!=='VALID')failures.push({book_id:book.book_id,status:book.status,reason:book.reason});
 attribution.push({book_id:book.book_id,track,attribution:book.attribution});
}
const csv=(name:string,rows:Record<string,unknown>[],headers?:string[])=>writeCsv(root+'/'+name,rows,headers);
csv('decision-ledger.csv',decisions);csv('final-targets.csv',targets);csv('execution-ledger.csv',executions);csv('accounting-reconciliation.csv',accounting);csv('risk-reconciliation.csv',risk);csv('failure-summary.csv',failures,['book_id','context_id','date','status','reason']);csv('replay-comparison.csv',comparison);csv('oos-equity.csv',equity);csv('realized-attribution.csv',attribution);
csv('blockers.csv',[{mode:'FACTORS',status:'BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS',scope:'Historical replay only; certified frozen synthetic E2E exercised'},{mode:'STRATEGY_STREAMS',status:'BLOCKED_MISSING_CANONICAL_ALPHA_STREAM_ARTIFACTS',scope:'Historical replay only; certified frozen compatible synthetic E2E exercised'},{mode:'SIGNAL_QUALITY',status:'BLOCKED_MISSING_LEGACY_NODE3_SOURCE',scope:'Legacy equivalence only; AL06 canonical gate tested synthetically; real selected nonforecast objectives explicitly NOT_REQUIRED'},{mode:'SIGNED_FINANCING',status:'BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE',scope:'No signed/global-cash inference, no fabricated historical execution'}]);
const after=economicHashes(requestRoot),unchanged=Object.entries(before).every(([k,h])=>after[k]===h);
atomicJson(root+'/resume-evidence.json',{status:unchanged?'PASS':'FAIL',new_decisions:run.new_decisions,reused_decisions:run.reused_decisions,new_executions:run.new_executions,reused_executions:run.reused_executions,previous_artifacts:Object.keys(before).length,previous_hashes_unchanged:unchanged,economic_hashes:after,atomic_execution_unit:'INDEPENDENT_NAV100_OUTER_FOLD_BOOK; no published partial fills'});
atomicJson(root+'/summary.json',{status:failures.length||comparison.some(c=>c.status!=='PASS')?'FAIL':'PASS',campaigns:2,outer_jobs:8,execution_books:run.books.length,unique_decisions:contexts.size,decision_rows:decisions.length,execution_rows:executions.length,accounting_checks:accounting.length,exact_replay_checks:comparison.length,stage_rows:uniqueStages.size,failures:failures.length,source_code_hash:codeHash,raw_and_normalized:true,search_runs:0,research_index_not_continuous_live_account:true,economic_winner_claim:false});
console.log(JSON.stringify({status:run.status,books:run.books.length,unique_decisions:contexts.size,new_executions:run.new_executions,reused_executions:run.reused_executions,comparisons:comparison.length,failed_comparisons:comparison.filter(c=>c.status!=='PASS').length,failures},null,2));
if(failures.length||comparison.some(c=>c.status!=='PASS'))process.exitCode=1;
