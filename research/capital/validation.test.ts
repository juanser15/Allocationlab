import assert from "node:assert/strict";
import { test, after } from "node:test";
import "./engine.test"; // all 16 CL03 tests unchanged
import "./hardening-regressions.test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCampaign, plan } from "./engine";
import { makeFolds, innerFolds, generateCandidates, hash, candidateId, type Campaign } from "./spec";
import { summarize, select, type Metrics } from "./metrics";
import { Cache, readJson, freezeJson } from "./storage";
import { qaCampaign, qaData, qaRegistry, qaSpec, files, jobs, shaFile } from "./qa";
import { foldOracle, innerOracle, metricOracle, sleeveOracle } from "./oracle";

const outcomes: any[] = [];
function check(area: string, name: string, run: () => void) {
  test(`CL04 ${area} — ${name}`, () => { try { run(); outcomes.push({ area, name, status: "PASS" }); }
    catch (e) { outcomes.push({ area, name, status: "FAIL", error: String(e) }); throw e; } });
}
const temp = () => mkdtempSync(tmpdir()+"/allocationlab-cl04-qa-");
const near = (a: number, b: number, label: string, abs=1e-8, rel=1e-10) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=abs+rel*Math.abs(b),`${label}: ${a} != ${b}`);
function metricsMatch(actual: Metrics, expected: Metrics) {
  for (const key of Object.keys(expected) as Array<keyof Metrics>) {
    if (expected[key]===null) assert.equal(actual[key],null,key); else near(Number(actual[key]),Number(expected[key]),key);
  }
}
function run(c: Campaign, data=qaData(), root=temp(), options: Parameters<typeof runCampaign>[3]={registry:qaRegistry()}) {
  freezeJson(root+"/qa-data.json",data);
  const code=hash(["engine","metrics","registry","storage","spec","qa"].map(p=>readFileSync(`research/capital/${p}.ts`,"utf8")).join("\n"));
  return { root, result: runCampaign(c,data,root,{...options,code_hash:code}) };
}
after(()=>{mkdirSync("reports/cl04",{recursive:true});writeFileSync("reports/cl04/unit-verification.json",JSON.stringify({cases:outcomes,passed:outcomes.filter(o=>o.status==="PASS").length,failed:outcomes.filter(o=>o.status==="FAIL").length},null,2)+"\n");});

// 128 calendar combinations, with compatible nested variants checked internally.
for(const mode of ["traditional","nested"] as const) for(const window of ["rolling","expanding"] as const)
for(const train of [3,6,12,24]) for(const horizon of [1,3,6,12]) for(const gap of [0,3]) {
  check("Walk-forward",`${mode}/${window}/train${train}/test${horizon}/step${horizon+gap}`,()=>{
    const c=qaCampaign({validation_mode:mode,window_type:window,dates:{start:"2012-01-01",end_exclusive:"2028-01-01"},train_months:train,test_months:horizon,step_months:horizon+gap});
    assert.deepEqual(makeFolds(c),foldOracle(c));
    const fs=makeFolds(c); assert.ok(fs.every((f,i)=>i===0||fs[i-1].test_end<=f.test_start));
    if(window==="expanding") assert.ok(fs.every(f=>f.train_start===c.dates.start));
    if(mode==="nested") for(const it of new Set([1,Math.floor(train/2)])) for(const ih of new Set([1,train-it])) for(const ig of [0,1]) for(const iw of [undefined,"rolling","expanding"] as const) {
      const cc={...c,inner_train_months:it,inner_test_months:ih,inner_step_months:ih+ig,inner_window_type:iw};
      for(const f of fs) { const inn=innerFolds(cc,f);assert.deepEqual(inn,innerOracle(cc,f));
        assert.ok(inn.every(v=>v.train_start>=f.train_start&&v.test_end<=f.train_end&&v.test_start<f.test_start)); }
    }
  });
}
check("Walk-forward","exact single fold, insufficient calendar, leap year and invalid boundaries",()=>{
  const c=qaCampaign({dates:{start:"2019-02-01",end_exclusive:"2020-03-01"},train_months:12});
  assert.equal(makeFolds(c).length,1);assert.equal(makeFolds(c)[0].test_end,"2020-03-01");
  assert.equal(makeFolds({...c,dates:{...c.dates,end_exclusive:"2020-02-01"}}).length,0);
  for(const date of ["2020-02-29","2020-01-31","2020-13-01"]) assert.throws(()=>makeFolds({...c,dates:{...c.dates,end_exclusive:date}}));
  assert.throws(()=>makeFolds({...c,test_months:3,step_months:1}),/Overlapping/);
  assert.throws(()=>makeFolds({...c,inner_test_months:2,inner_step_months:1}),/Overlapping/);
});
check("Walk-forward","calendar holes, explicit gaps and one less executable observation",()=>{
  const c=qaCampaign({dates:{start:"2020-01-01",end_exclusive:"2020-10-01"},step_months:2});
  const {root,result}=run(c);assert.equal(result.summary!.status,"COMPLETE");
  assert.ok(readFileSync(root+"/folds.csv","utf8").includes("gap_start"));
  assert.deepEqual(makeFolds(c),foldOracle(c));
  const short=qaData(3).slice(0,-1);
  const bad=run(qaCampaign(),short).result;assert.equal(bad.summary!.status,"INCOMPLETE");
});

for(const [name,risk,yieldRate,r] of [["constant/full risk",1,0,1],["cash zero",0,0,.02],["cash positive",0,1/64,.02],["cash negative",0,-1/64,.02],["fixed 50/50",.5,0,.02],["zero asset return",1,0,0]] as const) {
  check("Correctness",`known answer ${name}: exact accounting + independent metric oracle`,()=>{
    const data=qaData(8,()=>r);if(r===1) data.forEach((row,i)=>row.prices.R=100*2**i);
    const c=qaCampaign({candidate_space:[{base:{...qaSpec,exposure_parameters:{risk}}}],cash_yield:{type:"constant",daily:yieldRate,reference_daily:0}});
    const {root,result}=run(c,data);assert.equal(result.summary!.status,"COMPLETE");
    for(const j of jobs(root).filter(j=>j.stage==="outer")) {
      const expected=sleeveOracle(data,"2020-04-01","2020-05-01",()=>risk,j.scenario,yieldRate);
      assert.equal(j.ledger.length,expected.length);
      j.ledger.forEach((d:any,i:number)=>{
        const e=expected[i];near(d.endingNav,e.endingNav,"known NAV");near(d.endingCash,e.endingCash,"known cash");near(d.transactionCosts,e.fees,"closed-form fee");
        near(d.etfPnl,e.etfPnl,"only held P&L");near(d.cashPnl,e.cashPnl,"interest");
        near(d.trades.reduce((s:number,t:any)=>s+t.notional,0),e.notional,"trade notional");
        near(d.endingPositions.reduce((s:number,p:any)=>s+p.quantity,0),e.quantity,"shares");
        assert.ok(d.endingCash>=-1e-8&&d.endingPositions.every((p:any)=>p.quantity>=0));
      });
      metricsMatch(j.metrics,metricOracle(expected.map(x=>x.observation),0));
      if(risk===0) near(j.ledger.at(-1).endingNav,100*(1+yieldRate)**expected.length,"cash compound exact law");
      if(name==="fixed 50/50"&&j.scenario===0) {near(j.ledger.at(-1).endingNav,101,"50/50 +2% -> +1%");near(j.ledger.at(-1).netPnl,1,"interval P&L");}
      if(r===1&&j.scenario===0) near(j.ledger.at(-1).endingNav,200,"full-risk one held doubling interval");
    }
  });
}
check("Metrics","zero vol, one observation, unrecovered DD, invalid values and high fees",()=>{
  const obs=(xs:number[])=>xs.map((net_return,i)=>({date:String(i),net_return,turnover:i?0:1,costs:i?0:.05,exposure:.5}));
  for(const xs of [[0],[0,0,0],[.02,.02,.02],[.01,-.1,.01],[-.2,-.1],[.3,-.2,.1]])metricsMatch(summarize(obs(xs),0),metricOracle(obs(xs),0));
  for(const xs of [[-1],[-2],[NaN],[Infinity]])assert.throws(()=>summarize(obs(xs),0));
  for(const key of ["turnover","exposure","costs"] as const) for(const bad of [NaN,Infinity])assert.throws(()=>summarize([{...obs([0])[0],[key]:bad}],0));
  const c=qaCampaign({transaction_cost_bps:[1000],selection_cost_bps:1000,candidate_space:[{base:{...qaSpec,exposure_parameters:{risk:1}}}]});
  const {root,result}=run(c);assert.equal(result.summary!.status,"COMPLETE");
  const j=jobs(root).find(j=>j.stage==="outer")!,expected=sleeveOracle(qaData(),"2020-04-01","2020-05-01",()=>1,1000,0);
  metricsMatch(j.metrics,metricOracle(expected.map(x=>x.observation),0));
});
check("Correctness","causal perfect model selects the expected policy; useless model equals its risk-matched control",()=>{
  const data=qaData(12,m=>m%2?.02:-.02);
  const perfect={...qaSpec,model_parameters:{kind:"perfect"},exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}};
  const c=qaCampaign({dates:{start:"2020-01-01",end_exclusive:"2020-09-01"},train_months:4,test_months:2,step_months:2,inner_train_months:2,inner_test_months:2,inner_step_months:2,
    candidate_space:[{base:perfect},{base:{...qaSpec,exposure_parameters:{risk:1}}}]});
  const {result}=run(c,data);assert.ok(result.summary!.selected_by_fold.every((s:any)=>s.candidate_id===candidateId(perfect)));
  const useless=run(qaCampaign({candidate_space:[{base:{...qaSpec,exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}}}]}),data);
  const control=run(qaCampaign({candidate_space:[{base:qaSpec}]}),data);
  assert.deepEqual(jobs(useless.root).map(j=>j.ledger),jobs(control.root).map(j=>j.ledger));
});
check("Correctness","independent overfit variant: nine-month training, two spurious indicators and changed price path",()=>{
  const data=qaData(12,m=> (m%3!==1?1:-1)*(m<3?.30:.04));
  data.forEach(row=>{
    const month=Number(row.date.slice(5,7))-1,index=data.findIndex(r=>r.date===row.date),next=index%3===2?month+1:month;
    const up=next%3!==1,bGood=next>=3&&next<9;
    row.prices.A=(bGood?!up:up)?200:50;row.prices.B=(bGood?up:!up)?200:50;
  });
  const c=qaCampaign({dates:{start:"2020-01-01",end_exclusive:"2021-01-01"},train_months:9,test_months:3,step_months:3,
    inner_train_months:3,inner_test_months:3,inner_step_months:3,selection_cost_bps:0,transaction_cost_bps:[0],
    candidate_space:[{base:{...qaSpec,model_parameters:{kind:"indicator"},exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}},axes:{"model_parameters.indicator":["A","B"]}}]});
  const t=run({...c,validation_mode:"traditional"},data).result.summary!,n=run(c,data).result.summary!;
  assert.notEqual(t.selected_by_fold[0].candidate_id,n.selected_by_fold[0].candidate_id);
  assert.ok(t.outer_oos[0].cagr>n.outer_oos[0].cagr);assert.ok(n.outer_oos[0].cagr<0);
});
check("Correctness","exact ties: turnover, complexity, candidate_id and constraints",()=>{
  const c=qaCampaign(),cs=generateCandidates(c).candidates,m=metricOracle([{date:"x",net_return:.01,turnover:1,costs:0,exposure:.5},{date:"y",net_return:-.01,turnover:0,costs:0,exposure:.5}],0);
  let rows=cs.map((candidate,i)=>({candidate,status:"VALID",complexity:3-i,metrics:{...m,turnover_annualized:i?1:0}}));
  assert.equal(select(c,rows).winner!.candidate.candidate_id,cs[0].candidate_id);
  rows=rows.map((v,i)=>({...v,metrics:m,complexity:i===1?0:1}));assert.equal(select(c,rows).winner!.candidate.candidate_id,cs[1].candidate_id);
  rows=rows.map(v=>({...v,metrics:m,complexity:0}));assert.equal(select(c,rows.reverse()).winner!.candidate.candidate_id,cs[0].candidate_id);
  assert.equal(select({...c,constraints:{max_drawdown:0}},rows).winner,undefined);
});

for(const mode of ["traditional","nested"] as const)for(const window of ["rolling","expanding"] as const)for(const clock of ["once","monthly","quarterly","yearly"] as const) {
  check("Leakage",`${mode}/${window}/${clock}: fits, normalization, rankings, targets, trades, NAV and scoped cache`,()=>{
    const c=qaCampaign({validation_mode:mode,window_type:window,dates:{start:"2020-01-01",end_exclusive:"2020-07-01"},candidate_space:[{base:{...qaSpec,recalibration_frequency:clock},axes:{"exposure_parameters.risk":[.5,1]}}]});
    const data=qaData(8),mutated=structuredClone(data),pool=temp();mutated.filter(r=>r.date>="2020-05-01").forEach(r=>{r.prices.SIGNAL*=7;r.prices.R*=2;});
    const a=run(c,data,temp(),{registry:qaRegistry(),cache_root:pool});
    const oldFiles=files(pool).filter(p=>readJson(p).parts.information_cutoff<"2020-05-01"),oldHashes=oldFiles.map(shaFile);
    const b=run(c,mutated,temp(),{registry:qaRegistry(),cache_root:pool});
    assert.deepEqual(generateCandidates(c),generateCandidates(c));assert.deepEqual(oldFiles.map(shaFile),oldHashes);
    assert.deepEqual(readJson(a.root+"/selections/outer-0.json"),readJson(b.root+"/selections/outer-0.json"));
    const aa=jobs(a.root).filter(j=>j.outer_fold===0),bb=jobs(b.root).filter(j=>j.outer_fold===0);
    assert.deepEqual(aa.map(j=>[j.metrics,j.fit_keys,j.targets,j.ledger]),bb.map(j=>[j.metrics,j.fit_keys,j.targets,j.ledger]));
    assert.ok(readJson(b.root+"/progress.json").telemetry.model_fit_hits>0);
    const inside=structuredClone(data);inside[0].prices.SIGNAL+=10;
    const d=run(c,inside,temp(),{registry:qaRegistry(),cache_root:pool});
    assert.ok(readJson(d.root+"/progress.json").telemetry.model_fit_misses>0);
  });
}
check("Leakage","deliberate future read is unavailable, and model/policy inputs cannot be mutated",()=>{
  for(const kind of ["leaky","mutate_spec"]){const c=qaCampaign({candidate_space:[{base:{...qaSpec,model_parameters:{kind}}}]});
    const {root,result}=run(c);assert.equal(result.summary!.status,"INCOMPLETE");assert.ok(jobs(root).every(j=>j.status==="FAILED"));
    assert.ok(result.summary!.selected_by_fold.every((s:any)=>s.candidate_id===null));}
});

for(const budget of [1,2,10,50,100,200])check("Search",`grid/random budget ${budget}, exact Cartesian indices and seed replay`,()=>{
  const values=Array.from({length:budget},(_,i)=>(i+1)/budget),c=qaCampaign({candidate_budget:budget,candidate_space:[{base:qaSpec,axes:{"exposure_parameters.risk":values}}]});
  assert.equal(generateCandidates(c).cartesianSize,budget);assert.equal(generateCandidates(c).candidates.length,budget);
  const random={...c,search_method:"random" as const,random_seed:7};assert.deepEqual(generateCandidates(random),generateCandidates(structuredClone(random)));
  assert.equal(new Set(generateCandidates(random).candidates.map(x=>x.candidate_id)).size,budget);
  assert.equal(generateCandidates({...random,candidate_budget:Math.min(200,budget+1)}).candidates.length,budget);
  assert.throws(()=>generateCandidates({...random,random_seed:undefined}));
  if(budget>1)assert.throws(()=>generateCandidates({...c,candidate_budget:budget-1}),/Grid product/);
  const reduced=generateCandidates({...c,grid_reduction:{indices:budget===1?[0]:[0,budget-1]}}).candidates;
  assert.deepEqual(new Set(reduced.map(x=>x.spec.exposure_parameters.risk)),new Set(budget===1?[values[0]]:[values[0],values.at(-1)]));
});
check("Search","multi-axis Cartesian oracle, ordered seeded subset, reordered keys and economic change",()=>{
  const c=qaCampaign({candidate_space:[{base:{...qaSpec,exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}},axes:{"exposure_parameters.cash_min":[0,.1],"exposure_parameters.cash_max":[.2,.4,.6]}}]});
  const expected=[];for(const min of [0,.1])for(const max of [.2,.4,.6])expected.push(candidateId({...qaSpec,exposure_policy:"cash_band",exposure_parameters:{cash_min:min,cash_max:max}}));
  assert.deepEqual(generateCandidates(c).candidates.map(x=>x.candidate_id).sort(),expected.sort());
  const a=generateCandidates({...c,search_method:"random",candidate_budget:2,random_seed:"a"}),b=generateCandidates({...c,search_method:"random",candidate_budget:2,random_seed:"b"});assert.notDeepEqual(a,b);
  assert.deepEqual(generateCandidates({...c,candidate_space:[{...c.candidate_space[0],axes:Object.fromEntries(Object.entries(c.candidate_space[0].axes!).reverse())}]}),generateCandidates(c));
  assert.notEqual(candidateId(qaSpec),candidateId({...qaSpec,exposure_parameters:{risk:.6}}));
});
check("Cache","every identity dimension isolates; policy-only changes share; corrupt state rejects",()=>{
  const pool=temp(),cache=new Cache(pool),parts={data_hash:"a",family:"qa",version:"v1",parameters:{x:1},input_set:["SIGNAL"],transformations:["identity"],training_start:"2020-01-01",training_end:"2020-02-01",information_cutoff:"2020-01-31",fold_identity:"0:0"};let calls=0;
  cache.get(parts,()=>({n:++calls}));cache.get(structuredClone(parts),()=>({n:++calls}));assert.equal(cache.hits,1);
  for(const field of Object.keys(parts)) cache.get({...parts,[field]:"changed"},()=>({n:++calls}));assert.equal(calls,Object.keys(parts).length+1);
  const {root,result}=run(qaCampaign({candidate_space:[{base:qaSpec,axes:{"exposure_parameters.risk":Array.from({length:20},(_,i)=>(i+1)/20)}}]}));
  assert.equal(result.summary!.cache.persisted_model_artifacts,2);assert.equal(readJson(root+"/progress.json").telemetry.model_fit_misses,2);
  const file=files(root+"/cache/fits")[0],v=readJson(file);v.value.mean=999;writeFileSync(file,JSON.stringify(v));
  assert.throws(()=>new Cache(root+"/cache/fits").get(v.parts,()=>0),/integrity/);
  const changed=qaCampaign({candidate_space:[{base:{...qaSpec,model_parameters:{kind:"neutral",parameter:1}}}]});
  const shared=temp();run(qaCampaign(),qaData(),temp(),{registry:qaRegistry(),cache_root:shared});
  const other=run(changed,qaData(),temp(),{registry:qaRegistry(),cache_root:shared});assert.equal(readJson(other.root+"/progress.json").telemetry.model_fit_misses,2);
});
for(const stop of [0,1,4,"before_summary"] as const)check("Resume",`interruption ${stop}: completed records stable and only pending jobs execute`,()=>{
  const c=qaCampaign(),data=qaData(),dir=temp();const first=run(c,data,dir,{registry:qaRegistry(),...(typeof stop==="number"?{max_new_jobs:stop}:{pause_before_summary:true})});
  assert.equal(first.result.paused,true);const completed=existsSync(dir+"/jobs")?files(dir+"/jobs").filter(p=>p.endsWith(".json")):[],hashes=completed.map(shaFile);
  const second=run(c,data,dir);assert.equal(second.result.summary!.status,"COMPLETE");assert.deepEqual(completed.map(shaFile),hashes);assert.equal(second.result.reused_jobs,completed.length);
  const all=files(dir).filter(p=>p.endsWith(".csv")||p.endsWith("summary.json")||p.endsWith("manifest.json")),before=all.map(shaFile);
  const third=run(c,data,dir);assert.equal(third.result.new_jobs,0);assert.deepEqual(all.map(shaFile),before);
});
check("Failure handling","invalid, fit/predict/backtest and write failures retained; no fallback winner",()=>{
  const badData=qaData();delete badData.find(r=>r.date==="2020-03-03")!.prices.R;
  for(const kind of ["fit_failure","prediction_failure"]){const c=qaCampaign({candidate_space:[{base:qaSpec},{base:{...qaSpec,model_parameters:{kind}}},{base:{...qaSpec,exposure_parameters:{risk:2}}}]});
    const {root,result}=run(c);assert.equal(result.summary!.status,"COMPLETE");assert.ok(jobs(root).some(j=>j.status==="INVALID")&&jobs(root).some(j=>j.status==="FAILED"));
    assert.equal(run(c,qaData(),root).result.new_jobs,0);}
  const fail=run(qaCampaign({candidate_space:[{base:{...qaSpec,exposure_parameters:{risk:1}}}]}),badData);assert.equal(fail.result.summary!.status,"INCOMPLETE");
  const c=qaCampaign(),dir=temp(),id=generateCandidates(c).candidates[0].candidate_id;mkdirSync(dir+"/jobs");writeFileSync(dir+"/jobs/"+id,"blocked");
  assert.throws(()=>run(c,qaData(),dir));assert.ok(existsSync(dir+"/storage-failures.jsonl"));assert.ok(!existsSync(dir+"/summary.json"));
  unlinkSync(dir+"/jobs/"+id);assert.equal(run(c,qaData(),dir).result.summary!.status,"COMPLETE");assert.ok(readFileSync(dir+"/failures.csv","utf8").includes("ABORTED_WRITE"));
});
check("Accounting","no pre-fill P&L, fees-only scenario differences, sleeves reset and no fictional liquidation",()=>{
  const c=qaCampaign({dates:{start:"2020-01-01",end_exclusive:"2020-07-01"},candidate_space:[{base:qaSpec}]});
  const {root,result}=run(c);assert.equal(result.summary!.status,"COMPLETE");
  for(const j of jobs(root).filter(j=>j.stage==="outer")){
    assert.equal(j.ledger[0].beginningNav,100);assert.equal(j.ledger[0].beginningCash,100);assert.deepEqual(j.ledger[0].beginningPositions,[]);
    const fill=j.ledger.find((d:any)=>d.executionSignalDate)!;near(fill.etfPnl,0,"new shares no prior P&L");assert.ok(fill.transactionCosts>0||j.scenario===0);
    assert.ok(j.ledger.at(-1).endingPositions.length>0);assert.equal(j.ledger.at(-1).trades.length,0);
    for(const d of j.ledger){near(d.endingNav,d.endingCash+d.endingPositions.reduce((s:number,p:any)=>s+p.quantity*p.price,0),"book");if(!d.executionSignalDate)assert.deepEqual(d.trades,[]);}
  }
});
check("Consistency","identical candidate definitions: same winner case and different winner case without nested preference",()=>{
  const c=qaCampaign();const t=run({...c,validation_mode:"traditional"}),n=run(c);
  assert.equal(t.result.summary!.candidate_definitions_hash,n.result.summary!.candidate_definitions_hash);
  assert.equal(t.result.summary!.selected_by_fold[0].candidate_id,n.result.summary!.selected_by_fold[0].candidate_id);
  const changed={...c,search_method:"random" as const,random_seed:99,candidate_budget:2};const a=run(changed),b=run(changed,qaData(),a.root);
  assert.equal(b.result.new_jobs,0);assert.equal(a.result.summary!.candidate_definitions_hash,b.result.summary!.candidate_definitions_hash);
});
check("Leakage","mutations after multiple intra-sleeve cutoffs preserve all earlier targets and accounting",()=>{
  for(const mode of ["traditional","nested"] as const)for(const cutoff of ["2020-04-03","2020-05-04","2020-06-03"]){
    const c=qaCampaign({validation_mode:mode,dates:{start:"2020-01-01",end_exclusive:"2020-07-01"}}),data=qaData(8),future=structuredClone(data);
    future.filter(r=>r.date>cutoff).forEach(r=>{r.prices.SIGNAL*=5;r.prices.R*=3;});
    const a=run(c,data),b=run(c,future);
    assert.equal(a.result.summary!.candidate_definitions_hash,b.result.summary!.candidate_definitions_hash);
    for(const x of jobs(a.root)){
      const y=jobs(b.root).find(j=>j.stage===x.stage&&j.candidate_id===x.candidate_id&&j.outer_fold===x.outer_fold&&j.inner_fold===x.inner_fold&&j.scenario===x.scenario);
      if(!y)continue;
      assert.deepEqual(x.ledger.filter((d:any)=>d.date<=cutoff),y.ledger.filter((d:any)=>d.date<=cutoff));
      assert.deepEqual(x.targets.filter((d:any)=>d.signalDate<=cutoff),y.targets.filter((d:any)=>d.signalDate<=cutoff));
    }
    for(const s of a.result.summary!.selected_by_fold.filter((s:any)=>s.test_start<=cutoff))assert.deepEqual(s,b.result.summary!.selected_by_fold[s.outer_fold]);
  }
});
check("Cache","actual registry/version/projection changes isolate; different exposure policy shares the same fit",()=>{
  const pool=temp(),data=qaData(),base=qaCampaign({candidate_space:[{base:qaSpec},{base:{...qaSpec,exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}}}]});
  const a=run(base,data,temp(),{registry:qaRegistry(),cache_root:pool});assert.equal(readJson(a.root+"/progress.json").telemetry.model_fit_misses,2);
  for(const change of ["version","input","transformation","start","cutoff"]){
    const reg=qaRegistry();let c=structuredClone(base);
    if(change==="version")reg.models.get("qa_observable")!.version="qa-only-2";
    if(change==="input")c.candidate_space.forEach(t=>t.base.input_set=["SIGNAL"]);
    if(change==="transformation")c.candidate_space.forEach(t=>t.base.transformations=[{name:"qa-identity-metadata",parameters:{version:2}}]);
    if(change==="start")c.inner_train_months=1;
    if(change==="cutoff")c.dates.end_exclusive="2020-06-01";
    const x=run(c,data,temp(),{registry:reg,cache_root:pool});assert.ok(readJson(x.root+"/progress.json").telemetry.model_fit_misses>0,change);
  }
});
check("Persistence","tampered jobs and frozen selections reject resume; JSON finite round-trip",()=>{
  const c=qaCampaign(),x=run(c),file=files(x.root+"/jobs")[0],record=readJson(file);
  record.result.metrics.final_index+=1;writeFileSync(file,JSON.stringify(record));assert.throws(()=>run(c,qaData(),x.root),/integrity/);
  const y=run(c),selection=readJson(y.root+"/selections/outer-0.json");selection.candidate_id="c_unknown";
  writeFileSync(y.root+"/selections/outer-0.json",JSON.stringify(selection));assert.throws(()=>run(c,qaData(),y.root),/Frozen artifact differs/);
  for(const p of files(y.root).filter(p=>p.endsWith(".json")))assert.deepEqual(JSON.parse(JSON.stringify(readJson(p))),readJson(p));
});
