/** AL03 controlled offline replay: explicit q targets + unchanged production accounting engine. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {parseCsv,defaultBacktestConfig,generateRebalanceDates,resolveExecutionDate,runBacktestEngine,type BacktestLedgerEntry} from '../../calculator';
import {canonicalHash,canonicalJson} from '../validation';
import {composeMandatedPortfolio} from '../risk-mandate';
import {betaMandate} from '../risk-analytics/diagnostics';
import {basicMetrics,conditionalMetrics,rollingBetas,regression,DEFAULT_REGRESSION,mean,type Pair} from '../risk-analytics/analytics';
import type {ReturnVector,PriceObservation} from '../risk-analytics/estimators';
import {allocateAssets} from './engine';
import {pitAssetsInput} from './artifacts';
import {localSensitivity,SENSITIVITY_CONFIGURATION} from './sensitivity';
import {ENGINE_VERSION,DEFAULT_SOLVER,type Objective,type EngineResult,type AssetsEngineInput} from './contracts';
const root='reports/al03',source='reports/cl02/adjusted-closes.csv',code='artifacts/api-server/src/lib/allocation-core/assets-engine';
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const save=(p:string,v:unknown)=>writeFileSync(root+'/'+p,JSON.stringify(v,null,2)+'\n');
function csv(file:string,rows:Record<string,unknown>[],headers?:string[]){const keys=headers??[...new Set(rows.flatMap(r=>Object.keys(r)))],cell=(v:unknown)=>'"'+(v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v)).replaceAll('"','""')+'"';writeFileSync(root+'/'+file,keys.map(cell).join(',')+'\r\n'+rows.map(r=>keys.map(k=>cell(r[k])).join(',')).join('\r\n')+(rows.length?'\r\n':''));}
mkdirSync(root,{recursive:true});
const config={engine_version:ENGINE_VERSION,universe:['SPY','XLK','XLV','XLC'],benchmark:'SPY',risk_window:252,minimum_observations:252,
 start:'2012-01-01',end:'2026-09-30',rebalance:'monthly',execution:'next_close',cutoff:'STRICT_PREVIOUS_CLOSE',target_beta:.30,
 objectives:['EQUAL_WEIGHT','MIN_VARIANCE','ERC'],blocked_objectives:['MEAN_VARIANCE','MAX_SHARPE'],
 blocked_reason:'No externally supplied canonical historical ExpectedReturns artifacts for this universe at each 2012-2026 cutoff; no historical-mean substitute',
 cost_bps:[0,5],slippage_bps:0,cash_yield_annual:0,cash_yield_source:'CL02 frozen research zero assumption',initial_nav:100000,
 constraints:{asset_bounds:{},group_caps:[],max_active_names:null,turnover_cap:null},solver:DEFAULT_SOLVER,sensitivity:SENSITIVITY_CONFIGURATION,
 mandate:'Same declared MARKET_BETA .30 / no leverage / REJECT at each date, immutable across all q',regression:DEFAULT_REGRESSION,
 accounting:'Existing runBacktestEngine; quantities unchanged between fills; D5 gross trade notional costs',
 availability:'First actual adjusted-price observation plus 252 complete aligned returns strictly before decision; no backfill',
 limitations:['Adjusted snapshot vintage/dividend adjustment/vendor truth not independently certified','Today-fixed ETF list has survivorship/selection bias','Previously inspected sample, no new holdout','Equalizes estimated PIT beta; realized forward/full beta can differ']};
const sourceFiles=[...readdirSync(code).filter(p=>p.endsWith('.ts')).map(p=>code+'/'+p),
 'artifacts/api-server/src/lib/calculator.ts','artifacts/api-server/src/lib/factor-library.ts','artifacts/api-server/src/lib/d6-trace.ts','artifacts/api-server/src/lib/calculator.a1.db-shim.ts',...readdirSync('artifacts/api-server/src/lib/allocation-core').filter(p=>p.endsWith('.ts')).map(p=>'artifacts/api-server/src/lib/allocation-core/'+p),
 ...readdirSync('artifacts/api-server/src/lib/allocation-core/risk-analytics').filter(p=>p.endsWith('.ts')).map(p=>'artifacts/api-server/src/lib/allocation-core/risk-analytics/'+p)];
const manifest={configuration:config,configuration_hash:canonicalHash(config),data_hash:sha(source),data_source:source,code_hashes:Object.fromEntries(sourceFiles.sort().map(p=>[p,sha(p)])),baseline_checkpoint_sha256:sha(root+'/checkpoint.json'),risk_free_daily:0};
if(existsSync(root+'/manifest.json'))assert.equal(canonicalJson(JSON.parse(readFileSync(root+'/manifest.json','utf8'))),canonicalJson(manifest),'Do not overwrite differing AL03 manifest');else save('manifest.json',manifest);
const prices=parseCsv(readFileSync(source,'utf8')).filter(r=>r.date<=config.end),returns:ReturnVector[]=prices.slice(1).map((r,i)=>({date:r.date,values:Object.fromEntries(Object.entries(r.prices).flatMap(([a,p])=>prices[i].prices[a]>0?[[a,p/prices[i].prices[a]-1]]:[]))}));
const benchmarkPrices:PriceObservation[]=prices.map(r=>({date:r.date,adjusted_close:r.prices.SPY})),market=new Map(returns.map(r=>[r.date,r.values.SPY]));
const firstAvailable=Object.fromEntries(config.universe.map(a=>[a,prices.find(r=>r.prices[a]>0)?.date??null]));
const firstEligible=Object.fromEntries(config.universe.map(a=>[a,prices.find(r=>{const window=returns.filter(t=>t.date<r.date).slice(-252);return window.length===252&&window.every(t=>Number.isFinite(t.values[a]));})?.date??null]));
const btconfig={...defaultBacktestConfig(),startDate:config.start,warmupDays:252,rebalanceFrequency:'monthly' as const,executionTiming:'next_close' as const,transactionCostBps:0,slippageBps:0,maxTurnoverPerRebalance:1,cashYieldAnnual:0};
const signals=generateRebalanceDates(prices,'monthly',252,config.start).filter(d=>resolveExecutionDate(prices,d,'next_close'));
const results:Record<string,unknown>[]=[],risk:Record<string,unknown>[]=[],diversification:Record<string,unknown>[]=[],sensitivity:Record<string,unknown>[]=[],universeRows:Record<string,unknown>[]=[],inputs:Record<string,AssetsEngineInput>={},solves:Record<string,EngineResult>={},targets:Record<string,Record<string,number>>={},mandates:Record<string,unknown>={};
const previous:Record<string,Record<string,number>|null>={EQUAL_WEIGHT:null,MIN_VARIANCE:null,ERC:null};
for(const date of signals) {
 const window=returns.filter(r=>r.date<date).slice(-252),eligible=config.universe.filter(a=>window.length===252&&window.every(r=>Number.isFinite(r.values[a]))).sort();
 assert.ok(eligible.includes('SPY'));const cutoff=window.at(-1)!.date;
 for(const asset of config.universe){const ok=eligible.includes(asset);universeRows.push({signal_date:date,information_cutoff:cutoff,asset,eligible:ok,reason:ok?'ELIGIBLE':!firstAvailable[asset]||date<=firstAvailable[asset]!?'NOT_YET_OBSERVED':'INSUFFICIENT_252_SESSION_WARMUP_OR_MISSING',first_available:firstAvailable[asset],first_eligible:firstEligible[asset],eligible_universe:eligible,observations_in_window:window.filter(r=>Number.isFinite(r.values[asset])).length});}
 let sharedMandate:ReturnType<typeof betaMandate>|null=null;
 for(const type of config.objectives){const objective={type} as Objective,old=previous[type],previousQ=old?Object.fromEntries(eligible.map(a=>[a,old[a]??0])):null;
  const input=pitAssetsInput(returns,eligible,date,objective,previousQ),r=allocateAssets(input),key=type+'|'+date;inputs[key]=input;solves[key]=r;
  results.push({strategy:type,signal_date:date,information_cutoff:cutoff,execution_date:resolveExecutionDate(prices,date,'next_close'),status:r.status,weights:r.weights,objective_value:r.objective_value,objective_version:r.objective_version,result_id:r.result_id,input_hash:r.input_hash,solver:r.solver,errors:r.errors});
  if(r.status!=='VALID')continue;
  previous[type]=r.weights!;risk.push({strategy:type,signal_date:date,...r.diagnostics});diversification.push({strategy:type,signal_date:date,hhi:r.diagnostics!.hhi,effective_number_weights:r.diagnostics!.effective_number_weights,covariance_effective_rank:r.diagnostics!.covariance_effective_rank,pca_effective_risk_bets:r.diagnostics!.pca_effective_risk_bets,largest_weight:r.diagnostics!.largest_weight,top3_share:r.diagnostics!.top3_share});
  sensitivity.push(...localSensitivity(input,r).map(s=>({strategy:type,signal_date:date,...s})));
  targets['RAW|'+key]=r.weights!;
  if(!sharedMandate)sharedMandate=betaMandate(config.target_beta,r.sleeve!);
  const mandateHash=canonicalHash(sharedMandate),qhash=canonicalHash(r.weights),composition=composeMandatedPortfolio(sharedMandate,r.sleeve!);
  assert.equal(canonicalHash(sharedMandate),mandateHash);assert.equal(canonicalHash(r.weights),qhash);
  mandates[key]={mandate:sharedMandate,mandate_hash:mandateHash,q_hash:qhash,composition};
  if(composition.status==='VALID'){targets['BETA_NORMALIZED|'+key]=composition.portfolio!.total_asset_weights!;assert.ok(Math.abs(composition.portfolio!.expected_final_beta!-config.target_beta)<1e-10);}
 }
}
csv('allocation-results.csv',results);csv('risk-diagnostics.csv',risk);csv('diversification-diagnostics.csv',diversification);csv('sensitivity.csv',sensitivity);csv('universe-history.csv',universeRows);
save('allocation-inputs.json',inputs);save('allocation-solves.json',solves);save('controller-results.json',mandates);save('targets.json',targets);
const economic:Record<string,unknown>[]=[],scorecards:Record<string,unknown>={},rollingRows:Record<string,unknown>[]=[],equityRows:Record<string,unknown>[]=[],executionChecks:Record<string,unknown>[]=[];
for(const type of config.objectives)for(const mode of ['RAW','BETA_NORMALIZED'])for(const bps of config.cost_bps) {
 const name=type+'_'+mode+'_'+bps+'bps',missing=signals.filter(date=>!targets[mode+'|'+type+'|'+date]);
 if(missing.length){economic.push({candidate:name,status:'INFEASIBLE',reason:'Uncertified allocations/controller targets; no implicit fallback',missing_signals:missing});continue;}
 const ledgerPath=root+'/'+name+'.ledger.jsonl';let ledger:BacktestLedgerEntry[];
 if(existsSync(ledgerPath)){const cached=JSON.parse(readFileSync(ledgerPath+'.meta.json','utf8'));assert.equal(cached.manifest_hash,canonicalHash(manifest));assert.equal(cached.ledger_hash,sha(ledgerPath));ledger=readFileSync(ledgerPath,'utf8').trim().split('\n').map(s=>JSON.parse(s));}
 else {const backtest=runBacktestEngine(prices,config.universe.map(ticker=>({ticker,name:ticker,sector:'Declared equity ETF',priorWeight:0,enabled:true})),{cashMin:0,cashMax:1,maxEtfWeight:1,minEtfWeight:0,minInclusionThreshold:0,targetActiveEtfs:config.universe.length,diversificationEnabled:false}, {...btconfig,transactionCostBps:bps},'SPY',undefined,(signal,available,context)=>{
   assert.ok(available.every(r=>r.date<signal));assert.equal(available.at(-1)!.date,inputs[type+'|'+signal].information_cutoff);assert.equal(context!.asOf,available.at(-1)!.date);return targets[mode+'|'+type+'|'+signal];
  },{initialNav:config.initial_nav,initialCash:config.initial_nav,initialHoldings:{},dailyCashYield:0,allowShortPositions:false,d5GrossTradeCosts:true});
  assert.ok(backtest.hasSufficientData,backtest.insufficientReason??'Backtest failed');ledger=backtest.dailyLedger;writeFileSync(ledgerPath,ledger.map(r=>JSON.stringify(r)).join('\n')+'\n');writeFileSync(ledgerPath+'.meta.json',JSON.stringify({manifest_hash:canonicalHash(manifest),ledger_hash:sha(ledgerPath)},null,2)+'\n');}
 const pairs:Pair[]=ledger.map(r=>({date:r.date,portfolio:r.netPnl/r.beginningNav,market:market.get(r.date)!,rf:0})),base=basicMetrics(pairs,ledger[0].intervalStart),conditional=conditionalMetrics(pairs,benchmarkPrices,pairs.at(-1)!.date),rolling=rollingBetas(pairs,63,pairs.at(-1)!.date),capm=regression(pairs,'CAPM',pairs.at(-1)!.date);
 let turnover=0,costs=0,maxAccountingError=0;
 for(const row of ledger){const bought=row.trades.reduce((s,t)=>s+t.notional,0),gross=row.trades.reduce((s,t)=>s+Math.abs(t.notional),0),pretrade=row.beginningNav+row.etfPnl+row.cashPnl;turnover+=gross/pretrade;costs+=row.transactionCosts;
  const err=Math.max(Math.abs(row.transactionCosts-gross*bps/10000),Math.abs(row.endingNav-row.endingCash-row.endingPositions.reduce((s,p)=>s+p.marketValue,0)),Math.abs(row.endingCash-(row.beginningCash+row.cashPnl-bought-row.transactionCosts-row.slippage)));
  maxAccountingError=Math.max(maxAccountingError,err);assert.ok(err<1e-7,'Accounting '+name+' '+row.date);assert.ok(row.endingCash>=-1e-7&&row.endingPositions.every(p=>p.quantity>=-1e-10));}
 const diagnostics=risk.filter(r=>r.strategy===type),average=(key:string)=>mean(diagnostics.map(r=>r[key] as number));
 const summary={candidate:name,status:'VALID',strategy:type,mode,cost_bps:bps,...base,full_beta:conditional.full_beta.value,mean_rolling63_beta:mean(rolling.filter(r=>r.value!==null).map(r=>r.value!)),upside_beta:conditional.upside_beta.value,downside_beta:conditional.downside_beta.value,dd10_beta:conditional.drawdown_beta['0.1'].value,dd20_beta:conditional.drawdown_beta['0.2'].value,tail_q5_beta:conditional.tail_beta['0.05'].value,tail_q1_beta:conditional.tail_beta['0.01'].value,
  turnover_gross:turnover,turnover_annualized:turnover*252/ledger.length,costs_nav_units:costs,mean_hhi:average('hhi'),mean_effective_number_weights:average('effective_number_weights'),mean_covariance_effective_rank:average('covariance_effective_rank'),mean_pca_effective_risk_bets:average('pca_effective_risk_bets'),capm_alpha_annualized:capm.alpha_annualized,capm_alpha_hac_t:capm.t_alpha,capm_beta:capm.beta,mean_actual_risky_allocation:mean(ledger.map(r=>r.beginningPositions.reduce((s,p)=>s+p.weight,0)))};
 economic.push(summary);scorecards[name]={...summary,conditional,capm};rollingRows.push(...rolling.map(r=>({candidate:name,...r})));executionChecks.push({candidate:name,ledger_rows:ledger.length,max_accounting_error:maxAccountingError,ledger_sha256:sha(ledgerPath)});
 let nav=100,peak=100;for(const p of pairs){nav*=1+p.portfolio;peak=Math.max(peak,nav);equityRows.push({candidate:name,date:p.date,return:p.portfolio,index:nav,drawdown:nav/peak-1});}
}
csv('economic-replay.csv',economic);csv('rolling-beta.csv',rollingRows);csv('equity.csv',equityRows);save('scorecards.json',scorecards);save('execution-verification.json',{status:'PASS',backtests_expected:12,campaigns_valid:economic.filter(r=>r.status==='VALID').length,checks:executionChecks,allocation_count:results.length,allocation_failures:results.filter(r=>r.status!=='VALID').length,controller_failures:Object.values(mandates).filter((r:any)=>r.composition.status!=='VALID').length,sensitivity_failures:sensitivity.filter(r=>r.status!=='VALID').length});
console.log(JSON.stringify({allocations:results.length,valid:results.filter(r=>r.status==='VALID').length,economic_campaigns:economic.length,valid_campaigns:economic.filter(r=>r.status==='VALID').length,sensitivity:sensitivity.length}));
