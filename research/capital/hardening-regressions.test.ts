import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCampaign } from "./engine";
import { generateCandidates } from "./spec";
import { summarize, correlation } from "./metrics";
import { qaCampaign, qaData, qaRegistry, jobs } from "./qa";
import { Cache, readJson, writeCsv } from "./storage";
const temp = () => mkdtempSync(tmpdir()+"/allocationlab-cl04-reg-");
test("CL04 regression — identical returns have exactly zero variance and undefined Sharpe", () => {
  const rows = Array.from({length:60},(_,i)=>({date:String(i),net_return:.02,turnover:0,costs:0,exposure:1}));
  const actual = summarize(rows,0); assert.equal(actual.volatility,0); assert.equal(actual.net_sharpe,null);
});
test("CL04 regression — nonfinite reference, costs, exposure and overflow are rejected", () => {
  const row={date:"2020-01-01",net_return:0,turnover:0,costs:0,exposure:1};
  assert.throws(()=>summarize([row],NaN));
  for(const key of ["turnover","costs","exposure"] as const) assert.throws(()=>summarize([{...row,[key]:Infinity}],0));
  assert.throws(()=>summarize([{...row,net_return:1e300}],0));
});
test("CL04 regression — model cannot consume policy parameters", () => {
  const c=qaCampaign({candidate_space:[{base:{...qaCampaign().candidate_space[0].base,model_parameters:{kind:"check_projection"}}}]});
  const r=runCampaign(c,qaData(),temp(),{registry:qaRegistry()});assert.equal(r.summary!.status,"COMPLETE");
});
test("CL04 regression — cached nonfinite model state is rejected before persistence",()=>{
  assert.throws(()=>new Cache(temp()).get({key:"unsafe"},()=>({value:NaN})));
});
test("CL04 regression — future mutation preserves earlier fit cache identities",()=>{
  const a=temp(),b=temp(),rows=qaData(),changed=structuredClone(rows);
  changed.filter(r=>r.date>="2020-04-01").forEach(r=>{r.prices.SIGNAL*=5;});
  runCampaign(qaCampaign(),rows,a,{registry:qaRegistry()});runCampaign(qaCampaign(),changed,b,{registry:qaRegistry()});
  const aj=jobs(a).filter(j=>j.stage==="inner"),bj=jobs(b).filter(j=>j.stage==="inner");
  assert.deepEqual(aj.map(j=>j.fit_keys),bj.map(j=>j.fit_keys));
});
test("CL04 regression — write failure is journaled without inventing a completed job",()=>{
  const c=qaCampaign(),dir=temp(),id=generateCandidates(c).candidates[0].candidate_id;
  mkdirSync(dir+"/jobs");writeFileSync(dir+"/jobs/"+id,"QA blocked directory");
  assert.throws(()=>runCampaign(c,qaData(),dir,{registry:qaRegistry()}));
  assert.ok(existsSync(dir+"/storage-failures.jsonl"));
  assert.ok(readFileSync(dir+"/storage-failures.jsonl","utf8").includes(id));
  assert.ok(!existsSync(dir+"/summary.json"));
});
test("CL04 regression — constant candidate returns have undefined correlation",()=>{
  const rows=Array.from({length:60},(_,i)=>({date:String(i),net_return:.02,turnover:0,costs:0,exposure:1}));
  assert.equal(correlation(rows,rows),null);
});
test("CL04 regression — CSV records use RFC4180 CRLF and quote embedded delimiters",()=>{
  const path=temp()+"/quoted.csv";
  writeCsv(path,[{text:'comma, quote" and\r\nnewline',value:2}]);
  assert.equal(readFileSync(path,"utf8"),'"text","value"\r\n"comma, quote"" and\r\nnewline","2"\r\n');
});
