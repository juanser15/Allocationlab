import {existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {canonicalHash} from '../../artifacts/api-server/src/lib/allocation-core/validation';
import {runBacktestEngine,defaultBacktestConfig,generateRebalanceDates,resolveExecutionDate,type BacktestLedgerEntry} from '../../artifacts/api-server/src/lib/calculator';
import {atomicJson,freezeJson,readJson} from '../capital/storage';
import {metrics} from '../allocation/analytics';
import {runDecision,scopedBundle} from './decision';
import {VERSION,type BookRequest,type BookResult,type PipelineDecision,type StageRecord} from './contracts';
export const ACCOUNTING_TOLERANCE=1e-9; // Absolute NAV100 currency, not an economic tolerance.
export function reconciliation(ledger:BacktestLedgerEntry[],bps:number){
 return ledger.map((d,i)=>{
 const sum=(v:number[])=>v.reduce((a,b)=>a+b,0),mv=sum(d.endingPositions.map(p=>p.quantity*p.price)),notional=sum(d.trades.map(t=>t.notional)),fees=sum(d.trades.map(t=>Math.abs(t.notional)))*bps/10000;
 const prior=i?ledger[i-1]:null,priorQuantities=Object.fromEntries(d.beginningPositions.map(p=>[p.ticker,p.quantity])),afterQuantities=Object.fromEntries(d.endingPositions.map(p=>[p.ticker,p.quantity]));
 const ids=[...new Set([...Object.keys(priorQuantities),...Object.keys(afterQuantities),...d.trades.map(t=>t.ticker)])];
 const quantities=ids.map(a=>(afterQuantities[a]??0)-(priorQuantities[a]??0)-sum(d.trades.filter(t=>t.ticker===a).map(t=>t.quantity)));
 const errors={nav:d.endingNav-d.endingCash-mv,cash:d.endingCash-d.beginningCash-d.cashPnl+notional+d.transactionCosts+d.slippage,
 fees:d.transactionCosts-fees,pnl:d.netPnl-d.etfPnl-d.cashPnl+d.transactionCosts+d.slippage,nav_change:d.endingNav-d.beginningNav-d.netPnl,
 position_quantity:Math.max(0,...quantities.map(Math.abs)),continuity:prior?d.beginningNav-prior.endingNav:0,
 position_value:Math.max(0,...d.endingPositions.map(p=>Math.abs(p.marketValue-p.quantity*p.price)))};
 const finite=[d.beginningNav,d.endingNav,d.endingCash,mv,...Object.values(errors)].every(Number.isFinite),longOnly=d.endingCash>=-ACCOUNTING_TOLERANCE&&d.endingPositions.every(p=>p.quantity>=-ACCOUNTING_TOLERANCE),pass=finite&&longOnly&&d.beginningNav>0&&d.endingNav>0&&Object.values(errors).every(v=>Math.abs(v)<=ACCOUNTING_TOLERANCE);
 return{date:d.date,status:pass?'PASS':'FAIL',tolerance:ACCOUNTING_TOLERANCE,...errors,no_short_or_leverage:longOnly};
 });
}
function stored<T>(path:string,identity:string):T|null {
 if(!existsSync(path))return null;const x=readJson(path);if(x.identity!==identity||x.value_hash!==canonicalHash(x.value))throw Error('Durable identity/integrity mismatch '+path);return x.value as T;
}
function persist(path:string,identity:string,value:unknown){freezeJson(path,{identity,value_hash:canonicalHash(value),value});}
export function persistDecision(root:string,p:BookRequest['decisions'][number],codeHash:string):{decision:PipelineDecision;reused:boolean}{
 const identity=canonicalHash({version:VERSION,codeHash,context:p.context,bundle:scopedBundle(p.bundle,p.context.decision_date,p.context.information_cutoff)}),path=root+'/decisions/'+p.context.decision_context_id+'.json',existing=stored<PipelineDecision>(path,identity);
 if(existing)return{decision:existing,reused:true};const decision=runDecision(p.context,p.bundle);persist(path,identity,decision);return{decision,reused:false};
}
export function executeBook(request:BookRequest,decisions:PipelineDecision[]):BookResult {
 const r:BookResult={book_id:request.book_id,status:'UPSTREAM_FAILURE',reason:null,decisions,ledger:[],reconciliation:[],attribution:null};
 if(decisions.length!==request.decisions.length||decisions.some(d=>d.status!=='VALID'||!d.final_target)){r.reason='Upstream failure: no executable book or fallback created';return r;}
 try {
 for(const [i,d]of decisions.entries()){
  if(canonicalHash(d.context)!==canonicalHash(request.decisions[i].context))throw Error('Execution context differs from frozen request');
  if(d.stages.length!==8||d.stages.some((s,i)=>s.stage!==['VALIDATE_CONTEXT','RESOLVE_MANDATE','SIGNAL_GATE','ALLOCATOR','SLEEVE_RISK','ROBUSTNESS_GATE','EXPOSURE_CONTROLLER','FINAL_TARGET'][i]||s.decision_context_id!==d.context.decision_context_id||canonicalHash(s.output)!==s.output_hash))throw Error('Invalid/tampered stage chain');
  if(canonicalHash(d.final_target)!==d.stages[7].output_hash||canonicalHash(d.allocation)!==d.stages[3].output_hash||d.robustness_gate?.status!=='PASS'||canonicalHash(d.robustness_gate)!==d.stages[5].output_hash||d.final_target!.allocation_id!==d.sleeve?.allocation_id||d.final_target!.robustness_gate_id!==d.robustness_gate.gate_id)throw Error('Final target/allocation/gate identity mismatch');
  if(canonicalHash(d.sleeve)!==canonicalHash((d.stages[4].output as {sleeve:unknown}).sleeve))throw Error('Sleeve risk stage mismatch');
 }
 const cs=decisions.map(d=>d.context),first=cs[0];if(!first)throw Error('No decision contexts');
 const settings=canonicalHash({cost:first.costs,convention:first.execution.convention,frequency:first.execution.rebalance_frequency});
 if(cs.some(c=>canonicalHash({cost:c.costs,convention:c.execution.convention,frequency:c.execution.rebalance_frequency})!==settings))throw Error('Mixed book execution conventions');
 const available=request.prices.filter(p=>p.date<request.end_exclusive),dates=generateRebalanceDates(available,first.execution.rebalance_frequency,0,request.start).filter(d=>d<request.end_exclusive);
 if(canonicalHash(dates)!==canonicalHash(cs.map(c=>c.decision_date)))throw Error('Missing/extra decision on declared allocation clock');
 const assets=[...new Set(decisions.flatMap(d=>Object.keys(d.sleeve!.asset_weights_risk_sleeve!)))].sort();
 const cfg={...defaultBacktestConfig(),warmupDays:0,startDate:request.start,executionTiming:first.execution.convention,rebalanceFrequency:first.execution.rebalance_frequency,transactionCostBps:first.costs.bps,slippageBps:0,cashYieldAnnual:0,maxTurnoverPerRebalance:1};
 const etfs=assets.map(ticker=>({ticker,name:ticker,sector:'DECLARED',priorWeight:0,enabled:true})),constraints={cashMin:0,cashMax:1,minEtfWeight:0,maxEtfWeight:1,minInclusionThreshold:0,targetActiveEtfs:assets.length,diversificationEnabled:false};
 const seen=new Set<string>();
 const backtest=runBacktestEngine(available,etfs,constraints,cfg,request.benchmark,undefined,(date,prior,context)=>{
  const d=decisions.find(x=>x.context.decision_date===date);if(!d||seen.has(date))throw Error('Missing/duplicate execution callback');seen.add(date);const c=d.context;
  if(prior.some(p=>p.date>=date)||context?.asOf!==c.information_cutoff||canonicalHash(prior)!==c.provenance.information_prices_hash)throw Error('Strict signal information-set mismatch');
  if(resolveExecutionDate(available,date,c.execution.convention)!==c.execution.date)throw Error('Actual execution session differs from frozen convention');
  if(request.track==='RAW'&&c.previous_holdings&&d.allocation?.mode==='ASSETS'){
   const last=prior.at(-1)!,values=Object.fromEntries(d.allocation.input.assets.map(a=>[a,(context.quantities[a]??0)*(last.prices[a]??0)])),total=Object.values(values).reduce((a,b)=>a+b,0),supplied=d.allocation.input.previous_holdings?.asset_weights;
   if(total>0&&supplied&&Object.keys(values).some(a=>Math.abs(values[a]/total-(supplied[a]??0))>ACCOUNTING_TOLERANCE))throw Error('Previous risky-sleeve holdings differ from carried book');
  }
  return request.track==='RAW'?d.sleeve!.asset_weights_risk_sleeve:d.final_target!.final_asset_weights;
 },{initialNav:100,initialCash:100,initialHoldings:{},dailyCashYield:first.costs.cash_yield_daily,allowShortPositions:false,d5GrossTradeCosts:true});
 if(!backtest.hasSufficientData)throw Error(backtest.insufficientReason??'Insufficient backtest data');
 r.ledger=backtest.dailyLedger.filter(d=>d.date>=request.start&&d.date<request.end_exclusive);
 r.reconciliation=reconciliation(r.ledger,first.costs.bps);
 for(const row of r.ledger)if(row.trades.length){const c=cs.find(c=>c.decision_date===row.executionSignalDate);if(!c||row.date!==c.execution.date)throw Error('Fill date/signal identity mismatch');}
 if(r.reconciliation.some(x=>x.status!=='PASS')){r.status='ACCOUNTING_FAILURE';r.reason='Ledger reconciliation failed';return r;}
 const market=new Map(request.prices.slice(1).map((p,i)=>[p.date,p.prices[request.benchmark]/request.prices[i].prices[request.benchmark]-1])),history=request.prices.map(p=>({date:p.date,adjusted_close:p.prices[request.benchmark]}));
 r.attribution=r.ledger.length>1?metrics(r.ledger,market,history,0):{status:'INSUFFICIENT_DATA',reason:'Fewer than two ledger intervals'};
 r.status='VALID';return r;
 }catch(e){r.status='EXECUTION_FAILURE';r.reason=String(e);return r;}
}
export interface ReplayResult {status:'COMPLETE'|'PAUSED';new_decisions:number;reused_decisions:number;new_executions:number;reused_executions:number;books:BookResult[];}
/** Atomic unit of execution is one independent NAV100 outer-fold book.
 * A pause before/after a committed book cannot repeat fills. A process crash
 * inside an uncommitted pure simulation may recompute that uncommitted book;
 * no partial execution is published as completed. */
export function replay(requests:BookRequest[],root:string,codeHash:string,options:{max_new_decisions?:number;max_new_executions?:number}={}):ReplayResult{
 mkdirSync(root,{recursive:true});for(const n of [options.max_new_decisions,options.max_new_executions])if(n!==undefined&&(!Number.isInteger(n)||n<0))throw Error('Invalid pause limit');
 const manifest={version:VERSION,code_hash:codeHash,books:requests.map(r=>({book_id:r.book_id,input_hash:canonicalHash(r)}))};freezeJson(root+'/manifest.json',manifest);
 const result:ReplayResult={status:'COMPLETE',new_decisions:0,reused_decisions:0,new_executions:0,reused_executions:0,books:[]};
 for(const req of requests){
  const decisions:PipelineDecision[]=[];
  for(const p of req.decisions){const path=root+'/decisions/'+p.context.decision_context_id+'.json';
   if(!existsSync(path)&&options.max_new_decisions!==undefined&&result.new_decisions>=options.max_new_decisions){result.status='PAUSED';atomicJson(root+'/resume-state.json',result);return result;}
   const d=persistDecision(root,p,codeHash);decisions.push(d.decision);if(d.reused)result.reused_decisions++;else result.new_decisions++;
  }
  const identity=canonicalHash({codeHash,request:req,decisions}),path=root+'/books/'+req.book_id+'.json',existing=stored<BookResult>(path,identity);
  if(existing){result.books.push(existing);result.reused_executions++;continue;}
  if(options.max_new_executions!==undefined&&result.new_executions>=options.max_new_executions){result.status='PAUSED';atomicJson(root+'/resume-state.json',result);return result;}
  const book=executeBook(req,decisions);persist(path,identity,book);result.books.push(book);result.new_executions++;
 }
 atomicJson(root+'/resume-state.json',result);return result;
}
export function economicHashes(root:string){const entries:Record<string,string>={};for(const dir of ['decisions','books'])if(existsSync(root+'/'+dir))for(const f of readdirSync(root+'/'+dir).sort())entries[dir+'/'+f]=canonicalHash(readFileSync(root+'/'+dir+'/'+f,'utf8'));return entries;}
export function executionStages(book:BookResult):StageRecord[]{
 if(book.status==='UPSTREAM_FAILURE')return[];
 return book.decisions.flatMap(d=>{
  if(d.status!=='VALID')return[];const c=d.context,rows=book.ledger.filter(r=>r.executionSignalDate===c.decision_date);
  const names:StageRecord['stage'][]=book.status==='EXECUTION_FAILURE'?['EXECUTION']:['EXECUTION','ACCOUNTING_ATTRIBUTION'];
  return names.map(stage=>{const output=stage==='EXECUTION'?{book_id:book.book_id,track:'EXECUTED_RESEARCH_BOOK',rows}: {book_id:book.book_id,rows:book.reconciliation.filter(r=>rows.some(d=>d.date===r.date)),accounting_status:book.status};
   const body={decision_context_id:c.decision_context_id,stage,status:book.status,input_hash:canonicalHash({target:d.final_target!.target_id,book:book.book_id}),output_hash:canonicalHash(output),output};return{...body,stage_id:'stage_'+canonicalHash(body)};});
 });
}
