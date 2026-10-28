// Actual production API + committed historical data. No old report is written.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
const report = "reports/workbench01/phase-b3c2";
await mkdir(report,{recursive:true});
const read = async p => JSON.parse(await readFile(p,"utf8"));
const save = (name,x) => writeFile(join(report,name), JSON.stringify(x,null,2)+"\n");
const sha = b => createHash("sha256").update(b).digest("hex");
const TOTAL = "TOTAL_TURNOVER_INCLUDING_INITIAL_V1", RECURRING = "RECURRING_TURNOVER_EXCLUDING_INITIAL_V2";
const product = s => ({...s,contract_version:"workbench-research-run-spec-2.1.0",turnover_constraint_methodology_version:RECURRING});
async function start(store,capacity={}) {
  const probe=createServer().listen(0,"127.0.0.1"); await once(probe,"listening");const port=probe.address().port;await new Promise(r=>probe.close(r));
  const token=randomBytes(32).toString("hex");
  const child=spawn(process.execPath,["artifacts/api-server/dist/index.mjs"],{env:{...process.env,NODE_ENV:"production",LOG_LEVEL:"silent",PORT:String(port),
    WORKBENCH_PREVIEW_TOKEN:token,WORKBENCH_RUN_DIR:store,VALIDATION_JOB_WORKER_DISABLED:"1",DATABASE_URL:"postgresql://agent@127.0.0.1:55432/allocationlab",...capacity},stdio:["ignore","pipe","pipe"]});
  let logs="";for(const stream of [child.stdout,child.stderr])stream.on("data",b=>{if(logs.length<1048576)logs+=b.toString()});
  const request=async(path,body,auth=true)=>{const r=await fetch(`http://127.0.0.1:${port}/api/workbench${path}`,{method:body===undefined?"GET":"POST",headers:{...(auth?{authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json()}};
  for(let i=0;i<100;i++){try{if((await request("/capabilities")).status===200)break}catch{}if(child.exitCode!==null||i===99)throw Error("API did not start");await new Promise(r=>setTimeout(r,100))}
  return {request,async stop(){child.kill("SIGTERM");await Promise.race([once(child,"exit"),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill("SIGKILL");await writeFile(join(store,`acceptance-server-${randomBytes(8).toString("hex")}.log`),logs,{flag:"wx"})}};
}
async function tree(dir,prefix="") {
  const out={};for(const f of await readdir(dir,{withFileTypes:true})){const rel=prefix+f.name;if(f.isDirectory())Object.assign(out,await tree(join(dir,f.name),rel+"/"));else if(f.isFile())out[rel]=sha(await readFile(join(dir,f.name)))}return out;
}
const root=process.env.B3C2_ACCEPTANCE_STORE ?? await mkdtemp("/tmp/allocationlab-b3c2-acceptance-"), api=await start(root), req=api.request;
const wait=async(id)=>{const end=Date.now()+150000;while(Date.now()<end){const r=await req(`/runs/${id}`);assert.equal(r.status,200,JSON.stringify(r.body));if(["SUCCESS","FAILED","BLOCKED"].includes(r.body.latest_status))return r.body;await new Promise(r=>setTimeout(r,250))}throw Error("Bounded acceptance deadline")};
const hashes=r=>({financial_result_hash:r.financial_result_hash,passive_control_hash:r.passive_control_hash,matched_beta_control_hash:r.matched_beta_control_hash,attribution_hash:r.attribution_hash});
async function execute(spec,rerun=true){const plan=await req("/plan",spec);assert.equal(plan.status,200,JSON.stringify(plan.body));const submitted=await req("/runs",spec);assert.ok([200,202].includes(submitted.status),JSON.stringify(submitted.body));const d=await wait(submitted.body.run_id);assert.equal(d.latest_status,"SUCCESS",JSON.stringify(d.latest_result));const r=d.latest_successful_result;assert.deepEqual(r.validation_diagnostics.exact_fold_plan,plan.body.folds);
  let repeated;if(rerun){const before=await readFile(join(root,"runs",d.run_id,"attempts",submitted.body.execution_attempt_id,"result.json"));const receipt=await req(`/runs/${d.run_id}/rerun`,{});assert.equal(receipt.status,202);assert.notEqual(receipt.body.execution_attempt_id,submitted.body.execution_attempt_id);assert.equal(receipt.body.run_id,d.run_id);const again=await wait(d.run_id);assert.equal(again.latest_status,"SUCCESS");assert.deepEqual(hashes(again.latest_successful_result),hashes(r));assert.deepEqual(again.latest_successful_result.time_series.points,r.time_series.points);assert.deepEqual(again.latest_successful_result.turnover,r.turnover);assert.deepEqual(before,await readFile(join(root,"runs",d.run_id,"attempts",submitted.body.execution_attempt_id,"result.json")));repeated=receipt.body.execution_attempt_id}
  return {spec,plan:plan.body,receipt:submitted.body,detail:d,result:r,rerun_attempt_id:repeated};}
const matrix=[], legacyProof=[];
try {
  assert.equal((await req("/capabilities",undefined,false)).status,401);
  const cap=(await req("/capabilities")).body;assert.equal(cap.turnover_constraint_methodology_version,RECURRING);assert.deepEqual(cap.resource_limits,{maximum_concurrent_executions:1,max_jobs:2000,max_engine_files:512,timeout_ms:120000,max_output_bytes:67108864,classification:"CURRENT_EXECUTION_CAPACITY",financial_identity_input:false});
  const historyBeforeAdmission = (await req("/runs")).body;
  const legacy=await read("reports/workbench01/phase-b3c1/exact-84-fold-acceptance.json");
  const a=await req("/plan",legacy.exact_request),aSubmit=await req("/runs",legacy.exact_request);
  for(const r of [a,aSubmit]){assert.equal(r.status,422);assert.deepEqual(r.body.error,legacy.blocker)}
  const b=await req("/plan",product(legacy.exact_request)),bSubmit=await req("/runs",product(legacy.exact_request));
  for(const r of [b,bSubmit]){assert.equal(r.status,422);assert.equal(r.body.error.code,"INTERACTIVE_EXECUTION_CAPACITY_EXCEEDED");assert.equal(r.body.error.issues.number_of_folds,84);assert.equal(r.body.error.issues.no_attempt_created,true)}
  assert.deepEqual((await req("/runs")).body,historyBeforeAdmission);
  await save("exact-84-fold-methodology-comparison.json",{status:"PASS",request:legacy.exact_request,V1:{methodology:TOTAL,http_status:a.status,blocker:a.body.error,byte_compatible_legacy_blocker:true},V2:{methodology:RECURRING,http_status:b.status,blocker:b.body.error,initial_entry_not_a_recurring_blocker:true},no_attempt_created:true,no_calendar_adjustment:true});
  matrix.push({case:"A_LEGACY_84",status:"PRE_RUN_BLOCKED",reason:a.body.error.code},{case:"B_RECURRING_84",status:"PRE_RUN_BLOCKED",reason:b.body.error.code});
  const cases=[{name:"C_ONE_MONTH_SINGLE_FOLD",spec:product({...legacy.exact_request,evaluation_end_exclusive:"2019-11-01"})},
    {name:"D_RECURRING_MULTI_FOLD",spec:product({...legacy.exact_request,evaluation_start:"2022-01-01",evaluation_end_exclusive:"2022-05-01",training_window_months:6})},
    {name:"EXPANDING_SHORT_INITIAL",spec:product({...legacy.exact_request,evaluation_start:"2020-05-01",evaluation_end_exclusive:"2020-09-01",window_type:"EXPANDING"})},
    {name:"QUARTERLY",spec:product({...legacy.exact_request,evaluation_start:"2022-01-01",evaluation_end_exclusive:"2022-07-01",training_window_months:6,rebalance_frequency:"QUARTERLY"})}];
  const reconciliations=[];let first;
  for(const c of cases){const x=await execute(c.spec);first??=x;const t=x.result.turnover;
    assert.ok(x.result.costs.realized_transaction_cost>0);assert.equal(x.result.turnover_constraint_methodology_version,RECURRING);
    for(const f of t.candidate_training_by_fold)for(const p of f.candidates){if(p.status==="NOT_SUPPORTED")continue;assert.ok(Math.abs(p.total_gross_turnover-p.initial_implementation_turnover-p.recurring_gross_turnover)<1e-10);assert.ok(Math.abs(p.annualized_recurring_turnover-p.recurring_gross_turnover*252/p.annualization_observations)<1e-10);assert.ok(Math.abs(p.realized_simulated_cost-p.initial_implementation_cost-p.recurring_simulated_cost)<1e-10)}
    for(const p of t.selected_policy_by_fold){assert.equal(p.turnover_constraint_status,"ELIGIBLE");assert.ok(p.annualized_recurring_turnover<=8)}
    if(c.name.startsWith("C_")){assert.equal(t.oos.recurring_gross_turnover,0);assert.ok(t.oos.initial_implementation_cost>0);assert.ok(x.result.warnings.includes("NO_RECURRING_REBALANCE_OBSERVED"))}
    if(c.name.startsWith("D_"))assert.ok(t.candidate_training_by_fold.some(f=>f.candidates.some(p=>p.recurring_gross_turnover>0)));
    assert.ok(Math.abs(t.oos.realized_simulated_cost-x.result.costs.realized_transaction_cost)<1e-10);
    reconciliations.push({case:c.name,turnover:t,hashes:hashes(x.result)});
    matrix.push({case:c.name,status:"SUCCESS",spec:c.spec,run_id:x.detail.run_id,attempt_id:x.receipt.execution_attempt_id,baseline_submission_reused:x.receipt.reused_existing_attempt,rerun_attempt_id:x.rerun_attempt_id,rerun_created_fresh_engine_attempt:true,
      fold_count:x.plan.number_of_folds,metrics:x.result.metrics,costs:x.result.costs,hashes:hashes(x.result),all_hashes_reproduce:true,exact_fold_plan:true});console.log(`PASS ${c.name}`);
  }
  await save("turnover-reconciliation.json",{status:"PASS",tolerance:1e-10,cases:reconciliations,source:"ACTUAL_CERTIFIED_FILL_LEDGERS"});
  // All nine prior successful dynamic-calendar specifications, rerun from code.
  const prior=new Map();for(const p of (await read("reports/workbench01/phase-b3a/acceptance-matrix.json")).matrix)prior.set(p.run_id,{spec:p.request,id:p.run_id,metrics:p.metrics,hash:p.financial_result_hash});
  for(const p of (await read("reports/workbench01/phase-b3c/browser-acceptance.json")).matrix)prior.set(p.run_id,{spec:p.request,id:p.run_id,metrics:p.dynamic_metrics,hash:p.hashes.dynamic,hashes:{financial_result_hash:p.hashes.dynamic,passive_control_hash:p.hashes.passive,matched_beta_control_hash:p.hashes.matched_beta,attribution_hash:p.hashes.attribution}});
  assert.equal(prior.size,9);
  for(const p of prior.values()){const x=await execute(p.spec,false);assert.equal(x.detail.run_id,p.id);assert.equal(x.result.financial_result_hash,p.hash);assert.deepEqual(x.result.metrics,p.metrics);if(p.hashes)assert.deepEqual(hashes(x.result),p.hashes);
    legacyProof.push({run_id:p.id,execution_attempt_id:x.detail.latest_attempt.execution_attempt_id,reused_existing_attempt:x.receipt.reused_existing_attempt,immutable_attempt_new_jobs:x.result.execution.whole_campaign_new_jobs,spec:p.spec,metrics_exact:true,financial_hash_exact:true,benchmark_and_attribution_hashes_exact:p.hashes?true:"NO_PRIOR_BENCHMARK_HASH",financial_result_hash:p.hash});console.log(`PASS legacy ${p.id.slice(0,15)}`)}
  const identicalOld=[...prior.values()].find(p=>p.spec.transaction_cost_bps===0&&p.spec.selection_cost_bps===0&&p.spec.window_type==="ROLLING");
  const paired=await execute(product(identicalOld.spec));assert.notEqual(paired.detail.run_id,identicalOld.id);
  const compare=await req(`/compare?leftRunId=${identicalOld.id}&rightRunId=${paired.detail.run_id}`);assert.equal(compare.status,200);assert.ok(compare.body.warnings.includes("TURNOVER_METHODOLOGY_DIFFERS"));assert.equal(compare.body.calculation,"READ_ONLY_NO_RECALCULATION");
  matrix.push({case:"F_METHOD_VERSION_IDENTITY_AND_COMPARE",status:"PASS",left:identicalOld.id,right:paired.detail.run_id,comparison:compare.body});
  // A changed operational allowance must reproduce even the full engine financial artifact hash.
  const capacityRoot=await mkdtemp("/tmp/allocationlab-b3c2-capacity-"),other=await start(capacityRoot,{WORKBENCH_MAX_JOBS:"2100",WORKBENCH_MAX_ENGINE_FILES:"550",WORKBENCH_EXECUTION_TIMEOUT_MS:"130000",WORKBENCH_MAX_OUTPUT_BYTES:"70000000"});
  try{const receipt=await other.request("/runs",first.spec);assert.equal(receipt.body.run_id,first.detail.run_id);let d;for(let i=0;i<400;i++){d=await other.request(`/runs/${receipt.body.run_id}`);if(["SUCCESS","FAILED","BLOCKED"].includes(d.body.latest_status))break;await new Promise(r=>setTimeout(r,250))}assert.equal(d.body.latest_status,"SUCCESS");assert.deepEqual(hashes(d.body.latest_successful_result),hashes(first.result));assert.equal(d.body.latest_successful_result.execution.full_campaign_financial_artifact_hash,first.result.execution.full_campaign_financial_artifact_hash);matrix.push({case:"G_CAPACITY_IS_NON_FINANCIAL",status:"PASS",same_run_id:true,same_financial_hashes:true,same_engine_financial_artifact_hash:true})}finally{await other.stop()}
  const before=await read("/tmp/allocationlab-b3c2-before.json"), location=await read(before.failed_attempt_location_file), privateNow=await tree(location.attempt);
  assert.deepEqual(privateNow,before.failed_attempt_files);legacyProof.push({B3C1_failed_attempt_files: Object.keys(privateNow).length,byte_identical:true});
  await save("acceptance-matrix.json",{status:"PASS",matrix,legacy_v1_successes:legacyProof,legacy_reuse_disclosure:process.env.B3C2_ACCEPTANCE_STORE ? "Legacy V1-turnover executions were freshly certified earlier in this phase against byte-identical source; this final pass checks their immutable evidence and reports idempotent reuse explicitly. See legacy-financial-execution-proof.json. V2 baseline submission reuse is reported per case, and each explicit rerun executes a fresh immutable engine attempt." : "Fresh isolated store; all financial paths execute afresh.",synthetic_data_used_for_empirical_runs:false,high_recurring_fixture:"Explicit accounting-only unit test: annualized recurring turnover 20.16 > fixed 8; not empirical evidence",economic_claim:"NONE"});
  await writeFile("/tmp/allocationlab-b3c2-acceptance-location.json",JSON.stringify({root},null,2));
  console.log("PASS API acceptance and all nine historical V1-turnover financial regressions");
}finally{await api.stop()}
