// Controlled infrastructure load/replay campaigns. Synthetic QA only; no alpha search.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { runCampaign, plan } from "./engine";
import { hash } from "./spec";
import { qaCampaign, qaData, qaRegistry, qaSpec, files, shaFile } from "./qa";
import { atomicJson, freezeJson, readJson } from "./storage";
import { statSync } from "node:fs";
const label=process.argv[2];
const size=Number(label),scale=Number.isInteger(size);
assert.ok(scale ? [10,50,100,200].includes(size) : ["traditional","nested","overfit-traditional","overfit-nested"].includes(label));
const root=`reports/cl04/${scale?"scale-":"replay-"}${label}`;
mkdirSync(root,{recursive:true});
const overfit=label.startsWith("overfit");
let data=qaData(overfit?12:6,overfit?m=>(m%3!==1?1:-1)*(m<3?.30:.04):()=>.02);
if(overfit) data=data.map((r,i)=>{const m=Math.floor(i/3)+(i%3===2?1:0),up=m%3!==1;
  const a=m<3||m>=9?up:!up,b=m>=3&&m<9?up:!up;
  return {...r,prices:{...r.prices,A:a?200:50,B:b?200:50}};});
const dataPath=root+"/qa-data.json";freezeJson(dataPath,data);
const c=qaCampaign({experiment_id:`cl04-${scale?"scale-":"replay-"}${label}`,max_jobs:500,
  data_csv:dataPath,data_sha256:shaFile(dataPath),
  ...(scale?{candidate_budget:size,candidate_space:[{base:qaSpec,axes:{"exposure_parameters.risk":Array.from({length:size},(_,i)=>(i+1)/size)}}]}:
  {validation_mode:label.endsWith("traditional")?"traditional":"nested"}),
  ...(!scale&&!overfit?{dates:{start:"2020-01-01",end_exclusive:"2020-07-01"}}:{}),
  ...(overfit?{dates:{start:"2020-01-01",end_exclusive:"2021-01-01"},train_months:9,test_months:3,step_months:3,
    inner_train_months:3,inner_test_months:3,inner_step_months:3,transaction_cost_bps:[0],selection_cost_bps:0,
    candidate_space:[{base:{...qaSpec,model_parameters:{kind:"indicator",indicator:"A"},exposure_policy:"cash_band",exposure_parameters:{cash_min:0,cash_max:1}},axes:{"model_parameters.indicator":["A","B"]}}]}:{}),
});
freezeJson(root+"/campaign.qa.json",c);
const sourceFiles=["engine","metrics","registry","storage","spec","qa","qa-campaign"];
const sourceHashes=Object.fromEntries(sourceFiles.map(p=>[`research/capital/${p}.ts`,shaFile(`research/capital/${p}.ts`)]));
const code=hash(sourceHashes);freezeJson(root+"/code-hashes.json",sourceHashes);
const planning=plan(c,data);freezeJson(root+"/dry-run.json",planning);
const started=performance.now();const result=runCampaign(c,data,root,{registry:qaRegistry(),code_hash:code});
assert.ok(!result.paused);assert.equal(result.summary!.status,"COMPLETE");
assert.equal(result.summary!.total_backtest_jobs,planning.backtests_estimated);
const progress=readJson(root+"/progress.json"),elapsed=performance.now()-started;
const economic=files(root).filter(p=>!p.endsWith("progress.json")&&!p.endsWith("load-verification.json"));
const before=Object.fromEntries(economic.map(p=>[p,shaFile(p)]));
const t=performance.now(),resume=runCampaign(c,data,root,{registry:qaRegistry(),code_hash:code}),resumeMs=performance.now()-t;
assert.equal(resume.new_jobs,0);assert.equal(resume.reused_jobs,planning.backtests_estimated);
assert.deepEqual(Object.fromEntries(economic.map(p=>[p,shaFile(p)])),before);
atomicJson(root+"/load-verification.json",{status:"PASS",synthetic_only:true,plan:planning,
  executed_jobs:result.summary!.total_backtest_jobs,new_jobs_initial:result.new_jobs,elapsed_ms:elapsed,
  telemetry:progress.telemetry,fit_cache_hit_ratio:progress.telemetry.model_fit_hits/(progress.telemetry.model_fit_hits+progress.telemetry.model_fit_misses),
  artifact_bytes:files(root).reduce((s,p)=>s+statSync(p).size,0),resume_ms:resumeMs,resume_new_jobs:resume.new_jobs,
  economic_file_hashes:before,DSR:"NOT_IMPLEMENTED"});
console.log(JSON.stringify({root,status:"PASS",jobs:result.summary!.total_backtest_jobs,elapsed_ms:elapsed,resume_ms:resumeMs}));
