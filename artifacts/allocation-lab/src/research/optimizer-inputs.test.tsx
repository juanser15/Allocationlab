import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionWorkspace } from "./coordinated-execution";
import { MandateFields } from "./coordinated-p0";
import { ResearchFailureNotice, researchApi } from "./coordinated-ui";

const draft:any={contract_version:"allocationlab-coordinated-1.0.0",dataset_id:`internal_${"a".repeat(64)}`,research_scope:"PORTFOLIO",etfs:Array.from({length:11},(_,j)=>`ETF${j}`),maximum_etf_weight:.3,risk_aversion:5,covariance_shrinkage:.2,cash_policy:{type:"ZERO_RETURN",annual_rate:0},slippage_bps:0,quality_control:{enabled:false,policy_version:"STRUCTURAL_V1"},evaluation_start:"2024-01-03",evaluation_end_exclusive:"2024-04-03",training_window_months:6,window_type:"ROLLING",rebalance_frequency:"MONTHLY",transaction_cost_bps:1,control_mode:"MAX_EXPOSURE",maximum_exposure:.6,risk_budget:.1,regime_model:"TREND",regime_response:"FIXED",defensive_multiplier:.5,capital_signal_frequency:"REBALANCE_ONLY",mandate:{minimum_positions:1,maximum_positions:10,minimum_weight:.03}};
function render(r=draft){return renderToStaticMarkup(<ExecutionWorkspace scope="PORTFOLIO" visible draft={r} onChange={()=>assert.fail("Render must not change input")} caps={{dataset_source:"SYNTHETIC_TEST_ONLY",dataset_version:1}} navigate={()=>{}} calendarRange={{busy:false,error:"",bounds:null,reset:()=>{},edit:()=>{}} as any}/>);}
const runButton=(html:string)=>html.match(/<button[^>]*>Run full portfolio backtest<\/button>/)![0];
test("Invalid minimum holdings disables Run and exposes the actual actionable contract error",()=>{
 for(const value of [null,undefined,"",0,-1,1.5,"garbage",NaN]){
  const html=render({...draft,mandate:{...draft.mandate,minimum_positions:value}});
  assert.match(runButton(html),/disabled=""/);assert.match(html,/Minimum final holdings must be a positive whole number/);assert.match(html,/portfolio-constraint-feedback/);
 }
});
test("Valid 1–10 and 3% controls enable Run; changed impossibilities disable it immediately",()=>{
 assert.doesNotMatch(runButton(render()),/disabled=/);
 for(const patch of [{maximum_exposure:.02},{maximum_etf_weight:.02},{mandate:{...draft.mandate,maximum_positions:12}},{evaluation_start:""},{training_window_months:NaN},{transaction_cost_bps:NaN}])assert.match(runButton(render({...draft,...patch})),/disabled=""/);
});
test("Mandate editor makes count construction and explicit cash semantics visible",()=>{
 const html=renderToStaticMarkup(<MandateFields value={draft.mandate} selected={11} maxWeight={.3} onChange={()=>assert.fail("No silent change")}/>);
 assert.match(html,/step="1"/);assert.match(html,/optimizer searches bounded candidate supports/);assert.doesNotMatch(html,/optimizer does not search/);
 const empty=renderToStaticMarkup(<MandateFields selected={0} maxWeight={.3} onChange={()=>{}}/>);
 assert.match(empty,/<input[^>]*type="checkbox"[^>]*disabled=""/);
});

test("Research failure keeps the exact safe explanation and category with technical detail collapsed",()=>{
 for(const category of ["PORTFOLIO_CONSTRAINT","DATA_COVERAGE","SOLVER_INFEASIBLE","NUMERICAL_FAILURE"]){
  const html=renderToStaticMarkup(<ResearchFailureNotice message="No support satisfies the positive exposure ceiling." category={category} code={category} action="Review the mandate; no inputs were changed."/>);
  assert.match(html,/No support satisfies the positive exposure ceiling/);assert.ok(html.includes(category));assert.match(html,/<details>/);assert.doesNotMatch(html,/<details[^>]*open/);
 }
});
test("API client preserves safe categorized failure without inventing or exposing raw diagnostics",async()=>{
 const previousFetch=globalThis.fetch,previousStorage=globalThis.sessionStorage;
 Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{getItem:()=>null}});
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{category:"SOLVER_INFEASIBLE",code:"SOLVER_INFEASIBLE",message:"No feasible support was found.",issues:{suggestion:"Review the mandate.",internal_stack:"PRIVATE_NOT_RENDERED"}}}),{status:422,headers:{"Content-Type":"application/json"}});
 try{await assert.rejects(()=>researchApi("/plan",{}),(e:any)=>e.message==="No feasible support was found."&&e.category==="SOLVER_INFEASIBLE"&&e.suggestedAction==="Review the mandate."&&!JSON.stringify(e).includes("PRIVATE_NOT_RENDERED"));}
 finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:previousStorage});}
});
