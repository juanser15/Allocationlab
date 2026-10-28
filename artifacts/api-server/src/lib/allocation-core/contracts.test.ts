import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTRACT_VERSION, LONG_ONLY, type PointInTime, type CapitalLayerOutput,
  type AssetsAllocationInput, type AssetDecisionWeights, type FactorsAllocationInput,
  type AlphaStream, type AlphaStreamsAllocationInput, type AlphaCapitalDecision,
  type AllocationConvention, type RiskSleeveAllocationResult } from "./contracts";
import { canonicalHash, canonicalJson, loadingMatrixHash, validateCapitalOutput,
  validateAssetsInput, validateFactorsInput, validateAlphaStreamsInput, validateRiskSleeveAllocation, timestamp } from "./validation";
import { allocationFromAssets, allocationFromFactors, allocationFromAlphaStreams, composeFinalPortfolio } from "./composition";

// All fixtures SYNTHETIC. Oracles are arithmetic constants, not production mocks.
const cases:Array<{name:string;status:string;error?:string}>=[];
function check(name:string,fn:()=>void){test("AL01 SYNTHETIC — "+name,()=>{try{fn();cases.push({name,status:"PASS"});}catch(e){cases.push({name,status:"FAIL",error:String(e)});throw e;}});}
after(()=>{mkdirSync("reports/al01",{recursive:true});writeFileSync("reports/al01/test-cases.json",JSON.stringify({cases,pass:cases.filter(c=>c.status==="PASS").length,fail:cases.filter(c=>c.status==="FAIL").length},null,2)+"\n");});
const near=(actual:number|null,expected:number)=>{assert.ok(actual!==null&&Math.abs(actual-expected)<=1e-12,`${actual} != ${expected}`);};
const p=(date="2026-01-09",model:{id:string;version:string}|null=null):PointInTime=>({as_of:date,information_cutoff:date,
  provenance:{data_hash:canonicalHash({fixture:"SYNTHETIC",date}),configuration_hash:canonicalHash({fixture:"AL01"}),
    source_ids:["SYNTHETIC/known-answer"],data_available_at:date,model}});
const rootPoint=():PointInTime=>({...p(),as_of:"2026-01-10"});
const instruments=[{instrument_id:"AAA",kind:"TRADABLE_INSTRUMENT" as const},{instrument_id:"BBB",kind:"TRADABLE_INSTRUMENT" as const}];
const risk=(ids:string[])=>({...p(),representation:"COVARIANCE" as const,units:"daily_decimal_return_squared" as const,
  axis_ids:ids,covariance:ids.map((_,i)=>ids.map((_,j)=>i===j?.01:0))});
const capital=(budget=.6):CapitalLayerOutput=>({...rootPoint(),schema_version:CONTRACT_VERSION,policy_id:"SYNTHETIC/capital",policy_version:"1",
  risk_budget:budget,cash_budget:1-budget,state:{observable:"synthetic"},confidence:null,confidence_semantics:"POLICY_DEFINED_SCORE",generated_at:"2026-01-10"});
const assets=():AssetsAllocationInput=>({...rootPoint(),schema_version:CONTRACT_VERSION,allocation_mode:"ASSETS",candidate_assets:structuredClone(instruments),
  expected_returns:{...p(),units:"daily_decimal_return",values:{AAA:.001,BBB:.002}},risk_model:risk(["AAA","BBB"]),
  constraints:{convention:structuredClone(LONG_ONLY),asset_bounds:{}},previous_holdings:null});
const decision=(w={AAA:.25,BBB:.75},residual=0):AssetDecisionWeights=>({...rootPoint(),units:"fraction_of_risk_capital",asset_decision_weights:w,explicit_unallocated_risk_budget:residual});
function factors():FactorsAllocationInput {
  const m={...p(),units:"factor_exposure_per_unit_risk_weight" as const,orientation:"FACTORS_BY_ASSETS" as const,
    factor_ids:["VALUE","TREND"],instrument_ids:["AAA","BBB"],values:[[1,0],[0,2]],matrix_hash:""};m.matrix_hash=loadingMatrixHash(m);
  return {...rootPoint(),schema_version:CONTRACT_VERSION,allocation_mode:"FACTORS",candidate_assets:structuredClone(instruments),
    target:{...rootPoint(),units:"factor_exposure",exposures:{VALUE:.25,TREND:1.5}},
    factor_model:{...p("2026-01-09",{id:"SYNTHETIC/factor-model",version:"1"}),model_id:"SYNTHETIC/factor-model",model_version:"1",
      factor_ids:["VALUE","TREND"],factor_units:{VALUE:"synthetic beta",TREND:"synthetic trend loading"},risk_model:risk(["VALUE","TREND"])},
    loading_matrix:m,constraints:{convention:structuredClone(LONG_ONLY),asset_bounds:{}},implementation:{method:"UNIQUE_SQUARE_EXACT",regularization:"NONE"}};
}
const signed=(external=false):AllocationConvention=>({kind:"SIGNED_EXPOSURES",funding:external?"EXPOSURES_WITH_EXTERNAL_FINANCING":"NET_ONE_WITH_GLOBAL_CASH",
  mandate:{allow_short:true,allow_leverage:true,allow_external_financing:external,max_gross_exposure:3,min_net_exposure:-2,max_net_exposure:2}});
function stream(id:string,w:Record<string,number>,residual=0):AlphaStream {
  return {...p("2026-01-09",{id,version:"1"}),alpha_stream_id:id,version:"1",
    historical_series:{...p(),kind:"REALIZED_RETURNS",units:"daily_decimal_return",observations:[{date:"2026-01-08",value:.01},{date:"2026-01-09",value:-.01}]},
    expected_return_forecast:{...p(),units:"daily_decimal_return",values:{[id]:.001}},risk_model:risk([id]),
    unit_position_map:{...p(),units:"asset_exposure_per_unit_stream_capital",asset_exposures:w,explicit_unallocated_stream_capital:residual},
    execution_convention:{rebalance:"monthly",execution:"next_close",signal_cutoff:"STRICT_PREVIOUS_CLOSE"}};
}
function alphas():AlphaStreamsAllocationInput{return {...rootPoint(),schema_version:CONTRACT_VERSION,allocation_mode:"ALPHA_STREAMS",candidate_assets:structuredClone(instruments),
  alpha_streams:[stream("S1",{AAA:1}),stream("S2",{AAA:.2,BBB:.8})],risk_model:risk(["S1","S2"]),constraints:{convention:structuredClone(LONG_ONLY),asset_bounds:{}}};}
const alphaDecision=():AlphaCapitalDecision=>({...rootPoint(),units:"fraction_of_risk_capital",alpha_allocations:{S1:.25,S2:.75},explicit_unallocated_risk_budget:0});
const valid=(r:ReturnType<typeof allocationFromAssets>):RiskSleeveAllocationResult=>{assert.equal(r.status,"VALID",r.errors.join("; "));assert.ok(r.result);assert.equal(validateRiskSleeveAllocation(r.result).status,"VALID");return r.result;};
const rehash=(r:RiskSleeveAllocationResult)=>{const {allocation_id,...body}=r;r.allocation_id="allocation_"+canonicalHash(body);return r;};

check("A Assets: 60% risk, AAA 25%/BBB 75% => 15%/45%/40%",()=>{
  const sleeve=valid(allocationFromAssets(assets(),decision()));assert.deepEqual(sleeve.asset_weights_risk_sleeve,{AAA:.25,BBB:.75});
  const f=composeFinalPortfolio(capital(),sleeve);assert.equal(f.status,"VALID");near(f.portfolio!.total_asset_weights!.AAA,.15);near(f.portfolio!.total_asset_weights!.BBB,.45);assert.equal(f.portfolio!.total_cash_weight,.4);
  near(Object.values(f.portfolio!.total_asset_weights!).reduce((s,v)=>s+v,0)+f.portfolio!.total_cash_weight!,1);
});
check("B Factor exact diagonal oracle; exposures do not sum one",()=>{
  const i=factors(),s=valid(allocationFromFactors(i));assert.deepEqual(s.asset_weights_risk_sleeve,{AAA:.25,BBB:.75});
  assert.equal(s.mode_specific_details.allocation_mode,"FACTORS");assert.ok("implementation" in s.mode_specific_details);
  const d=s.mode_specific_details.implementation;assert.deepEqual(d.achieved_factor_exposures,{VALUE:.25,TREND:1.5});assert.equal(d.tracking_error,0);assert.deepEqual(d.tracking_residual,{VALUE:0,TREND:0});assert.equal(d.matrix_hash,i.loading_matrix.matrix_hash);
  const f=composeFinalPortfolio(capital(),s);assert.equal(f.status,"VALID");near(f.portfolio!.total_asset_weights!.AAA,.15);
});
check("B2 Factor coupled matrix, pivoting and independent arithmetic oracle",()=>{
  const i=factors();i.loading_matrix.values=[[2,1],[1,3]];i.target.exposures={VALUE:1.25,TREND:2.5};i.loading_matrix.matrix_hash=loadingMatrixHash(i.loading_matrix);
  const s=valid(allocationFromFactors(i));near(s.asset_weights_risk_sleeve!.AAA,.25);near(s.asset_weights_risk_sleeve!.BBB,.75);
  const j=factors();j.loading_matrix.values=[[0,2],[1,0]];j.loading_matrix.matrix_hash=loadingMatrixHash(j.loading_matrix);j.target.exposures={VALUE:1.5,TREND:.25};assert.deepEqual(valid(allocationFromFactors(j)).asset_weights_risk_sleeve,{AAA:.25,BBB:.75});
});
check("C Impossible factor bounds => INFEASIBLE, no invented weights",()=>{
  const i=factors();i.constraints.asset_bounds.AAA={min:0,max:.2};const r=allocationFromFactors(i);assert.equal(r.status,"INFEASIBLE");assert.equal(r.result!.asset_weights_risk_sleeve,null);
  assert.ok("implementation" in r.result!.mode_specific_details);assert.equal(r.result!.mode_specific_details.implementation.implementation_asset_weights,null);
  const f=composeFinalPortfolio(capital(),r.result);assert.equal(f.status,"INFEASIBLE");assert.equal(f.portfolio!.total_asset_weights,null);assert.equal(f.portfolio!.total_cash_weight,.4);
});
check("C2 Singular and underdetermined mapping never use pseudoinverse",()=>{
  const i=factors();i.loading_matrix.values=[[1,1],[2,2]];i.loading_matrix.matrix_hash=loadingMatrixHash(i.loading_matrix);assert.equal(allocationFromFactors(i).status,"MAPPING_FAILURE");
  const j=factors();j.loading_matrix.factor_ids=["VALUE"];j.loading_matrix.values=[[1,1]];j.loading_matrix.matrix_hash=loadingMatrixHash(j.loading_matrix);j.target.exposures={VALUE:1};j.factor_model.factor_ids=["VALUE"];j.factor_model.factor_units={VALUE:"beta"};j.factor_model.risk_model=risk(["VALUE"]);
  const r=allocationFromFactors(j);assert.equal(r.status,"MAPPING_FAILURE");assert.equal(r.result!.asset_weights_risk_sleeve,null);
});
check("D Alpha aggregation: capital x per-unit map, not scores",()=>{
  const s=valid(allocationFromAlphaStreams(alphas(),alphaDecision()));near(s.asset_weights_risk_sleeve!.AAA,.4);near(s.asset_weights_risk_sleeve!.BBB,.6);near(s.gross_exposure,1);near(s.net_exposure,1);
  assert.ok("aggregation" in s.mode_specific_details);assert.equal(s.mode_specific_details.aggregation.stream_versions.S1,"1");near(s.mode_specific_details.aggregation.pre_netting_gross_exposure,1);
  const f=composeFinalPortfolio(capital(),s);assert.equal(f.status,"VALID");near(f.portfolio!.total_asset_weights!.AAA,.24);near(f.portfolio!.total_asset_weights!.BBB,.36);
});
check("E Opposite overlapping alphas: algebraic netting, pre-netting gross distinct",()=>{
  const i=alphas();i.alpha_streams=[stream("S1",{AAA:1}),stream("S2",{AAA:-1})];i.constraints.convention=signed(true);
  const d=alphaDecision();d.alpha_allocations={S1:.75,S2:.25};const s=valid(allocationFromAlphaStreams(i,d));assert.deepEqual(s.asset_weights_risk_sleeve,{AAA:.5});assert.equal(s.gross_exposure,.5);assert.equal(s.net_exposure,.5);
  assert.ok("aggregation" in s.mode_specific_details);assert.equal(s.mode_specific_details.aggregation.pre_netting_gross_exposure,1);
  const f=composeFinalPortfolio(capital(),s);assert.equal(f.status,"VALID");assert.equal(f.portfolio!.total_cash_weight,.4);assert.equal(f.portfolio!.total_asset_weights!.AAA,.3);assert.equal(f.portfolio!.balance_convention,"EXPOSURES_NOT_BALANCE_SHEET");
});
check("E2 Zero-net exposures require explicit external financing; no silent cash=1-net",()=>{
  const i=assets();i.constraints.convention=signed(true);const s=valid(allocationFromAssets(i,decision({AAA:1,BBB:-1})));
  const f=composeFinalPortfolio(capital(.5),s);assert.equal(f.status,"VALID");assert.equal(f.portfolio!.net_exposure,0);assert.equal(f.portfolio!.gross_exposure,1);assert.equal(f.portfolio!.total_cash_weight,.5);
  i.constraints.convention.mandate.allow_external_financing=false;assert.equal(allocationFromAssets(i,decision({AAA:1,BBB:-1})).status,"INFEASIBLE");
});
for(const budget of [0,.5,1])check(`F Capital risk=${budget}: all three modes, scaling once and upstream cash fixed`,()=>{
  const rs=[valid(allocationFromAssets(assets(),decision())),valid(allocationFromFactors(factors())),valid(allocationFromAlphaStreams(alphas(),alphaDecision()))];
  for(const s of rs){const c=capital(budget),f=composeFinalPortfolio(c,s);assert.equal(f.status,"VALID");assert.equal(f.portfolio!.total_cash_weight,1-budget);
    for(const [id,w] of Object.entries(s.asset_weights_risk_sleeve!))near(f.portfolio!.total_asset_weights![id],budget*w);near(f.portfolio!.gross_exposure,budget);near(f.portfolio!.net_exposure,budget);}
});
check("G Double cash blocked in requests, decisions, constraints and canonical outputs",()=>{
  const i=assets(),d=decision();assert.equal(allocationFromAssets({...i,cash_budget:.9},d).status,"INVALID_INPUT");
  assert.equal(allocationFromAssets(i,{...d,total_cash_weight:.9}).status,"INVALID_INPUT");
  assert.equal(allocationFromAssets({...i,constraints:{...i.constraints,totalCash:{min:.9,max:1}}},d).status,"INVALID_INPUT");
  const s=valid(allocationFromAssets(i,d));assert.equal(composeFinalPortfolio(capital(),{...s,cash_budget:.9}).status,"INVALID_INPUT");
  const f=composeFinalPortfolio(capital(),{...s,cash_target:.9});assert.equal(f.portfolio!.total_cash_weight,.4);assert.equal(f.portfolio!.total_asset_weights,null);
});
check("G2 Residual remains explicit, never adds to global cash",()=>{
  const r=allocationFromAssets(assets(),decision({AAA:.2,BBB:.5},.3));assert.equal(r.status,"INFEASIBLE");assert.equal(r.result!.explicit_unallocated_risk_budget,.3);
  const f=composeFinalPortfolio(capital(),r.result);assert.equal(f.status,"INFEASIBLE");assert.equal(f.portfolio!.total_cash_weight,.4);near(f.portfolio!.explicit_unallocated_risk_budget,.18);assert.equal(f.portfolio!.total_asset_weights,null);
  const i=alphas();i.alpha_streams[0].unit_position_map={...i.alpha_streams[0].unit_position_map,asset_exposures:{AAA:.5},explicit_unallocated_stream_capital:.5};
  const a=allocationFromAlphaStreams(i,alphaDecision());assert.equal(a.status,"INFEASIBLE");assert.equal(a.result!.explicit_unallocated_risk_budget,.125);
});
for(const which of ["forecast","covariance","factor-model","matrix","stream","history","position-map","alpha-forecast","availability"])
check(`H Point-in-time rejects future ${which}`,()=>{
  if(which==="forecast"||which==="covariance"||which==="availability"){
    const i=assets();if(which==="forecast")i.expected_returns.as_of="2026-01-10";if(which==="covariance")i.risk_model.information_cutoff="2026-01-10";if(which==="availability")i.expected_returns.provenance.data_available_at="2026-01-10";
    assert.equal(validateAssetsInput(i).status,"INVALID_INPUT");
  }else if(which==="factor-model"||which==="matrix"){
    const i=factors();if(which==="factor-model")i.factor_model.as_of="2026-01-10";else i.loading_matrix.as_of="2026-01-10";assert.equal(allocationFromFactors(i).status,"INVALID_INPUT");
  }else{
    const i=alphas(),s=i.alpha_streams[0];if(which==="stream")s.as_of="2026-01-10";if(which==="history")s.historical_series.observations.push({date:"2026-01-10",value:1});if(which==="position-map")s.unit_position_map.as_of="2026-01-10";if(which==="alpha-forecast")s.expected_return_forecast!.as_of="2026-01-10";
    assert.equal(validateAlphaStreamsInput(i).status,"INVALID_INPUT");
  }
});
check("H2 UTC timestamps, leap day, past metadata, mismatched capital clocks",()=>{
  assert.notEqual(timestamp("2024-02-29"),null);assert.equal(timestamp("2023-02-29"),null);assert.equal(timestamp("2026-02-30"),null);assert.equal(timestamp("2026-01-09T00:00:00+02:00"),null);
  const s=valid(allocationFromAssets(assets(),decision()));const c=capital();c.as_of="2026-01-11";c.generated_at=c.as_of;assert.equal(composeFinalPortfolio(c,s).status,"INVALID_INPUT");
  const early=capital();early.information_cutoff="2026-01-08";early.provenance.data_available_at="2026-01-08";assert.equal(composeFinalPortfolio(early,s).status,"INVALID_INPUT");
});
check("I Invalid units: factor exposures cannot become capital weights",()=>{
  assert.equal(allocationFromAssets(assets(),{...decision(),units:"factor_exposure"}).status,"INVALID_INPUT");
  const f=factors();f.target.units="fraction_of_risk_capital" as never;assert.equal(validateFactorsInput(f).status,"INVALID_INPUT");
  const i=alphas();i.alpha_streams[0].historical_series.kind="SIGNAL_SCORES" as never;assert.equal(validateAlphaStreamsInput(i).status,"INVALID_INPUT");
  const j=alphas();j.alpha_streams[0].unit_position_map.units="signal_score" as never;assert.equal(validateAlphaStreamsInput(j).status,"INVALID_INPUT");
  assert.equal(allocationFromAlphaStreams(alphas(),{...alphaDecision(),units:"signal_score"}).status,"INVALID_INPUT");
});
check("J Reproducible canonical input: key reorder keeps IDs, full input changes alter snapshots",()=>{
  const i=assets(),d=decision(),a=valid(allocationFromAssets(i,d));const reverse=(x:unknown):unknown=>Array.isArray(x)?x.map(reverse):x&&typeof x==="object"?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reverse(v)])):x;
  const b=valid(allocationFromAssets(reverse(i),reverse(d)));assert.deepEqual(a,b);assert.equal(canonicalHash(i),canonicalHash(reverse(i)));
  assert.deepEqual(composeFinalPortfolio(capital(),a),composeFinalPortfolio(reverse(capital()),b));
  const changed=structuredClone(i);changed.expected_returns.values.AAA+=.001;assert.notEqual(valid(allocationFromAssets(changed,d)).input_snapshot_id,a.input_snapshot_id);
  const c=capital();c.policy_version="2";assert.notEqual(composeFinalPortfolio(c,a).portfolio!.portfolio_id,composeFinalPortfolio(capital(),a).portfolio!.portfolio_id);
  assert.equal(canonicalHash(JSON.parse(canonicalJson(a))),canonicalHash(a));
});
check("Capital invariants, nullable confidence and policy-defined scores are explicit",()=>{
  const c=capital();assert.equal(validateCapitalOutput(c).status,"VALID");c.confidence=75;assert.equal(validateCapitalOutput(c).status,"VALID");c.confidence_semantics="PROBABILITY";assert.equal(validateCapitalOutput(c).status,"INVALID_INPUT");
  c.confidence=.75;assert.equal(validateCapitalOutput(c).status,"VALID");
  for(const field of ["risk_budget","cash_budget"] as const)for(const x of [NaN,Infinity,-.1,1.1])assert.equal(validateCapitalOutput({...capital(),[field]:x}).status,"INVALID_INPUT");
  assert.equal(validateCapitalOutput({...capital(),cash_budget:.3}).status,"INVALID_INPUT");
  const within={...capital(),cash_budget:.4+5e-11};assert.equal(validateCapitalOutput(within).status,"VALID");assert.equal(validateCapitalOutput({...capital(),cash_budget:.4+2e-10}).status,"INVALID_INPUT");
});
check("Signed net-one portfolio preserves signs/leverage and prohibits incompatible mandates",()=>{
  const i=assets();i.constraints.convention=signed();const d=decision({AAA:1.2,BBB:-.2}),s=valid(allocationFromAssets(i,d)),f=composeFinalPortfolio(capital(),s);
  assert.equal(f.status,"VALID");near(s.gross_exposure,1.4);near(s.net_exposure,1);near(f.portfolio!.gross_exposure,.84);near(f.portfolio!.net_exposure,.6);near(f.portfolio!.total_asset_weights!.BBB,-.12);assert.equal(f.portfolio!.total_cash_weight,.4);
  for(const flag of ["allow_short","allow_leverage"] as const){const j=structuredClone(i);j.constraints.convention.mandate[flag]=false;assert.equal(allocationFromAssets(j,d).status,"INFEASIBLE");}
  const nonunit=allocationFromAssets(i,decision({AAA:.4,BBB:-.1}));assert.equal(nonunit.status,"INFEASIBLE");
});
check("No normalization/clipping: tiny risk budget remains positive and residual must be exactly zero",()=>{
  const s=valid(allocationFromAssets(assets(),decision()));const f=composeFinalPortfolio(capital(1e-12),s);assert.equal(f.status,"VALID");assert.equal(f.portfolio!.total_asset_weights!.AAA,2.5e-13);
  assert.equal(allocationFromAssets(assets(),decision({AAA:.25,BBB:.75-1e-12},1e-12)).status,"INFEASIBLE");
  assert.equal(allocationFromAssets(assets(),decision({AAA:-1e-12,BBB:1+1e-12})).status,"INFEASIBLE");
});
check("Warnings never erase failure, and tampered weights/gross/details/hash reject",()=>{
  const i=factors();i.constraints.asset_bounds.AAA={min:0,max:.1};const failed=allocationFromFactors(i).result!;
  failed.warnings=["approximate portfolio might be acceptable later"];rehash(failed);assert.equal(composeFinalPortfolio(capital(),failed).status,"INFEASIBLE");
  const s=valid(allocationFromAssets(assets(),decision()));for(const mutate of [ (x:RiskSleeveAllocationResult)=>{x.gross_exposure=.8;},(x:RiskSleeveAllocationResult)=>{x.asset_weights_risk_sleeve!.AAA=.9;},(x:RiskSleeveAllocationResult)=>{x.status="VALID";x.errors=["failure"];},(x:RiskSleeveAllocationResult)=>{x.asset_weight_units="factor_exposure" as never;} ]){
    const copy=structuredClone(s);mutate(copy);rehash(copy);assert.equal(composeFinalPortfolio(capital(),copy).status,"INVALID_INPUT");}
  const changed=structuredClone(s);changed.warnings=["tampered without hash"];assert.equal(validateRiskSleeveAllocation(changed).status,"INVALID_INPUT");
});
check("Missing/provenance/duplicate axes, matrix hash, covariance and insufficient alpha data reject",()=>{
  const i=assets();i.provenance.data_hash="unhashed";assert.equal(validateAssetsInput(i).status,"INVALID_INPUT");
  const j=assets();j.candidate_assets.push(j.candidate_assets[0]);assert.equal(validateAssetsInput(j).status,"INVALID_INPUT");
  const k=assets();k.risk_model.covariance=[[1,2],[2,1]];assert.equal(validateAssetsInput(k).status,"INVALID_INPUT");
  const f=factors();f.loading_matrix.values[0][0]=3;assert.equal(validateFactorsInput(f).status,"INVALID_INPUT");
  const a=alphas();a.alpha_streams[0].historical_series.observations=[];assert.equal(allocationFromAlphaStreams(a,alphaDecision()).status,"INSUFFICIENT_DATA");
  const h=alphas();h.alpha_streams[0].historical_series.observations[1].date="2026-01-08";assert.equal(validateAlphaStreamsInput(h).status,"INVALID_INPUT");
});
check("Malformed/nonfinite runtime inputs reject explicitly rather than throw/fallback",()=>{
  for(const input of [null,[],{},NaN,()=>0]){
    assert.equal(validateCapitalOutput(input).status,"INVALID_INPUT");assert.equal(allocationFromAssets(input,decision()).status,"INVALID_INPUT");assert.equal(allocationFromFactors(input).status,"INVALID_INPUT");assert.equal(allocationFromAlphaStreams(input,alphaDecision()).status,"INVALID_INPUT");assert.equal(composeFinalPortfolio(input,{}).status,"INVALID_INPUT");
    assert.equal(validateRiskSleeveAllocation(input).status,"INVALID_INPUT");
  }
  const r=allocationFromAssets(assets(),decision({AAA:NaN,BBB:1}));assert.equal(r.status,"INVALID_INPUT");assert.equal(r.result,null);
  const bad=alphas();bad.alpha_streams[0].unit_position_map.asset_exposures.AAA=Infinity;assert.equal(allocationFromAlphaStreams(bad,alphaDecision()).status,"INVALID_INPUT");
});
check("Numerical failure is explicit; input objects remain unchanged (pure functions)",()=>{
  const i=assets();i.constraints.convention=signed(true);i.constraints.convention.mandate.max_gross_exposure=Number.MAX_VALUE;
  const d=decision({AAA:Number.MAX_VALUE,BBB:Number.MAX_VALUE});const r=allocationFromAssets(i,d);assert.equal(r.status,"NUMERICAL_FAILURE");assert.equal(r.result!.asset_weights_risk_sleeve,null);
  const a=assets(),b=decision(),c=capital(),before=canonicalJson({a,b,c});const s=valid(allocationFromAssets(a,b));composeFinalPortfolio(c,s);assert.equal(canonicalJson({a,b,c}),before);
});
check("All mode outputs reconcile to the same canonical portfolio when their asset map is equal",()=>{
  const a=valid(allocationFromAssets(assets(),decision())),f=valid(allocationFromFactors(factors())),i=alphas();i.alpha_streams[0].unit_position_map.asset_exposures={AAA:1};i.alpha_streams[1].unit_position_map.asset_exposures={BBB:1};
  const s=valid(allocationFromAlphaStreams(i,alphaDecision()));for(const r of [a,f,s]){assert.deepEqual(r.asset_weights_risk_sleeve,{AAA:.25,BBB:.75});const composed=composeFinalPortfolio(capital(),r);assert.equal(composed.status,"VALID");near(composed.portfolio!.total_asset_weights!.AAA,.15);near(composed.portfolio!.total_asset_weights!.BBB,.45);assert.equal(composed.portfolio!.total_cash_weight,.4);}
});
check("Required capital state, publication/model provenance and malformed detail objects cannot be omitted",()=>{
  const {state,...missing}=capital();assert.equal(validateCapitalOutput(missing).status,"INVALID_INPUT");
  const f=valid(allocationFromFactors(factors()));assert.ok("implementation" in f.mode_specific_details);const changed=structuredClone(f);
  assert.ok("implementation" in changed.mode_specific_details);changed.mode_specific_details.implementation.factor_model_identity.as_of="2026-01-10";rehash(changed);assert.equal(validateRiskSleeveAllocation(changed).status,"INVALID_INPUT");
  const s=valid(allocationFromAlphaStreams(alphas(),alphaDecision()));const x=structuredClone(s);x.mode_specific_details={allocation_mode:"ALPHA_STREAMS",aggregation:{}} as never;rehash(x);assert.equal(validateRiskSleeveAllocation(x).status,"INVALID_INPUT");
  const c=capital();c.state=null;assert.equal(validateCapitalOutput(c).status,"VALID");c.confidence=Infinity;assert.equal(validateCapitalOutput(c).status,"INVALID_INPUT");
});
check("Realized P&L representation preserves units; negative stream capital and repeated IDs reject",()=>{
  const i=alphas();i.alpha_streams[0].historical_series.kind="REALIZED_PNL";i.alpha_streams[0].historical_series.units="pnl_per_unit_stream_capital";
  assert.equal(allocationFromAlphaStreams(i,alphaDecision()).status,"VALID");
  const j=alphaDecision();j.alpha_allocations={S1:-.25,S2:1.25};assert.equal(allocationFromAlphaStreams(i,j).status,"INVALID_INPUT");
  const k=alphas();k.alpha_streams[1]=structuredClone(k.alpha_streams[0]);assert.equal(validateAlphaStreamsInput(k).status,"INVALID_INPUT");
});
check("J2 Canonical key reorder is reproducible with non-associative three-asset sums",()=>{
  const i=assets();i.candidate_assets.push({instrument_id:"CCC",kind:"TRADABLE_INSTRUMENT"});i.expected_returns.values.CCC=.003;i.risk_model=risk(["AAA","BBB","CCC"]);
  const a=valid(allocationFromAssets(i,decision({AAA:.1,BBB:.2,CCC:.7} as never)));
  const b=valid(allocationFromAssets(i,decision({CCC:.7,BBB:.2,AAA:.1} as never)));
  assert.equal(a.input_snapshot_id,b.input_snapshot_id);assert.equal(a.allocation_id,b.allocation_id);assert.deepEqual(a,b);
  assert.deepEqual(composeFinalPortfolio(capital(),a),composeFinalPortfolio(capital(),b));
  const input=alphas();input.candidate_assets=structuredClone(i.candidate_assets);input.alpha_streams[0].unit_position_map.asset_exposures={AAA:.1,BBB:.2,CCC:.7};input.alpha_streams[1].unit_position_map.asset_exposures={AAA:.2,BBB:.3,CCC:.5};
  const reversed=structuredClone(input);reversed.alpha_streams.forEach(s=>{s.unit_position_map.asset_exposures=Object.fromEntries(Object.entries(s.unit_position_map.asset_exposures).reverse());});
  assert.deepEqual(valid(allocationFromAlphaStreams(input,alphaDecision())),valid(allocationFromAlphaStreams(reversed,alphaDecision())));
  const f=factors(),other=structuredClone(f);other.target.exposures=Object.fromEntries(Object.entries(f.target.exposures).reverse());assert.deepEqual(valid(allocationFromFactors(f)),valid(allocationFromFactors(other)));
});
