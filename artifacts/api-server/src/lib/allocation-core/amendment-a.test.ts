import assert from "node:assert/strict";
import { test, after } from "node:test";
import "./contracts.test"; // Original 36 cases, unchanged.
import { mkdirSync,writeFileSync } from "node:fs";
import { CONTRACT_VERSION,RISK_CONTRACT_VERSION,LONG_ONLY,BETA_DIVISION_TOLERANCE,
  type AssetsAllocationInput,type CapitalLayerOutput,type PointInTime,type RiskMandate,type SleeveRiskEstimate,type MarketRiskConfiguration,type PairedReturn } from "./contracts";
import { canonicalHash,validateRiskSleeveAllocation } from "./validation";
import { allocationFromAssets,composeFinalPortfolio } from "./composition";
import { attachSleeveRisk,composeMandatedPortfolio,validateRiskMandate } from "./risk-mandate";
import { adaptLegacyCapitalOutput,upgradeLegacyRiskSleeve } from "./adapters";
import { calculateMarketRiskMetrics,DEFAULT_MARKET_RISK_CONFIGURATION } from "./risk-metrics";
const cases:Array<{name:string;status:string;error?:string}>=[];
function check(name:string,fn:()=>void){test("AL01 AMENDMENT A SYNTHETIC — "+name,()=>{try{fn();cases.push({name,status:"PASS"});}catch(e){cases.push({name,status:"FAIL",error:String(e)});throw e;}});}
after(()=>{mkdirSync("reports/al01/amendment-a",{recursive:true});writeFileSync("reports/al01/amendment-a/test-cases.json",JSON.stringify({cases,pass:cases.filter(c=>c.status==="PASS").length,fail:cases.filter(c=>c.status==="FAIL").length},null,2)+"\n");});
const near=(a:number|null,b:number)=>assert.ok(a!==null&&Math.abs(a-b)<=1e-12,`${a} != ${b}`);
const point=():PointInTime=>({as_of:"2026-01-09",information_cutoff:"2026-01-09",provenance:{data_hash:canonicalHash({fixture:"SYNTHETIC/beta"}),configuration_hash:canonicalHash({fixture:"AL01A"}),source_ids:["SYNTHETIC/AL01A"],data_available_at:"2026-01-09",model:{id:"synthetic-risk",version:"1"}}});
function rawSleeve(){const p=point(),i:AssetsAllocationInput={...p,as_of:"2026-01-10",schema_version:CONTRACT_VERSION,allocation_mode:"ASSETS",
  candidate_assets:[{instrument_id:"AAA",kind:"TRADABLE_INSTRUMENT"},{instrument_id:"BBB",kind:"TRADABLE_INSTRUMENT"}],
  expected_returns:{...p,units:"daily_decimal_return",values:{AAA:.01,BBB:.02}},risk_model:{...p,representation:"COVARIANCE",units:"daily_decimal_return_squared",axis_ids:["AAA","BBB"],covariance:[[.04,0],[0,.01]]},
  constraints:{convention:structuredClone(LONG_ONLY),asset_bounds:{}},previous_holdings:null};
  const r=allocationFromAssets(i,{...p,as_of:i.as_of,units:"fraction_of_risk_capital",asset_decision_weights:{AAA:.25,BBB:.75},explicit_unallocated_risk_budget:0});assert.equal(r.status,"VALID");return r.result!;}
function measured(beta=.8,vol=.2){const s=rawSleeve(),p=point(),estimate:SleeveRiskEstimate={...p,schema_version:RISK_CONTRACT_VERSION,units:"UNSCALED_SLEEVE_ANNUAL_VOLATILITY",allocation_weights_hash:canonicalHash(s.asset_weights_risk_sleeve),
  asset_market_betas:{AAA:beta,BBB:beta},estimated_market_beta:beta,estimated_volatility:vol,
  beta_model:{benchmark:"SYNTHETIC_MARKET",estimation_window:{start:"2026-01-01",end:p.as_of,observations:7},estimator:"SUPPLIED_ASSET_BETAS_V1",as_of:p.as_of,information_cutoff:p.information_cutoff,data_hash:p.provenance.data_hash}};
  const out=attachSleeveRisk(s,estimate);assert.equal(out.status,"VALID",out.errors.join("; "));return out.result!;}
function mandate(target=.6):RiskMandate {const p=point();return {schema_version:RISK_CONTRACT_VERSION,as_of:"2026-01-10",policy_id:"SYNTHETIC/beta-mandate",policy_version:"1",state:{observable:"synthetic"},confidence:null,confidence_semantics:"POLICY_DEFINED_SCORE",semantics:"SYSTEMATIC_RISK",market_benchmark:"SYNTHETIC_MARKET",
  primary_target:{metric:"MARKET_BETA",target,lower_bound:null,upper_bound:null},constraints:{min_risky_allocation:0,max_risky_allocation:1,cash_floor:0,cash_ceiling:1,max_gross_exposure:1,max_net_exposure:1},
  exposure_policy:{controller:"LONG_ONLY_NO_LEVERAGE_V1",constraint_action:"REJECT"},provenance:{...p.provenance,information_cutoff:p.information_cutoff,generated_at:"2026-01-10"},legacy_source:null};}
function legacy(risk=.6):CapitalLayerOutput {const p=point();return {...p,schema_version:"allocation-core-1.0.0",as_of:"2026-01-10",policy_id:"legacy-policy",policy_version:"1",risk_budget:risk,cash_budget:1-risk,state:null,confidence:null,confidence_semantics:"POLICY_DEFINED_SCORE",generated_at:"2026-01-10"};}

for(const [beta,mult,cash]of[[.8,.75,.25],[1.2,.5,.5]])check(`A/B target beta .60, sleeve ${beta}: multiplier ${mult}, cash ${cash}`,()=>{
 const s=measured(beta),out=composeMandatedPortfolio(mandate(),s);assert.equal(out.status,"VALID",out.errors.join("; "));const f=out.portfolio!;
 near(f.exposure_multiplier,mult);near(f.implied_cash_weight,cash);near(f.expected_final_beta,.6);near(f.total_asset_weights!.AAA,.25*mult);near(f.total_asset_weights!.BBB,.75*mult);
 assert.equal(f.semantics,"SYSTEMATIC_RISK");assert.equal(f.beta_sleeve,beta);near(f.gross_exposure,mult);near(f.net_exposure,mult);
});
check("C Same beta mandate reconciles different sleeves to same final beta",()=>{
 const a=composeMandatedPortfolio(mandate(),measured(.8)),b=composeMandatedPortfolio(mandate(),measured(1.2));near(a.portfolio!.expected_final_beta!,b.portfolio!.expected_final_beta!);assert.notEqual(a.portfolio!.implied_cash_weight,b.portfolio!.implied_cash_weight);
});
check("D Zero/nearly-zero beta nonzero target infeasible, tiny nonzero target not rounded away",()=>{
 for(const beta of [0,BETA_DIVISION_TOLERANCE/2]){const f=composeMandatedPortfolio(mandate(.6),measured(beta));assert.equal(f.status,"INFEASIBLE");assert.equal(f.portfolio!.total_asset_weights,null);assert.equal(f.portfolio!.implied_cash_weight,null);}
 assert.equal(composeMandatedPortfolio(mandate(1e-30),measured(0)).status,"INFEASIBLE");
 const z=composeMandatedPortfolio(mandate(0),measured(0));assert.equal(z.status,"VALID");assert.equal(z.portfolio!.exposure_multiplier,0);assert.equal(z.portfolio!.implied_cash_weight,1);
 const tiny=composeMandatedPortfolio(mandate(1e-14),measured(1));assert.equal(tiny.status,"VALID");assert.equal(tiny.portfolio!.exposure_multiplier,1e-14);
});
check("E Requested beta outside caps rejects; only explicit CLIP returns clipped diagnostic",()=>{
 const m=mandate();m.constraints.max_risky_allocation=.5;const f=composeMandatedPortfolio(m,measured(.8));assert.equal(f.status,"INFEASIBLE");assert.ok(f.portfolio!.constraint_failures.length);assert.equal(f.portfolio!.total_asset_weights,null);
 m.exposure_policy.constraint_action="CLIP";const c=composeMandatedPortfolio(m,measured(.8));assert.equal(c.status,"VALID");assert.equal(c.portfolio!.target_clipped,true);near(c.portfolio!.exposure_multiplier,.5);near(c.portfolio!.expected_final_beta,.4);assert.ok(c.portfolio!.warnings[0].includes("not achieved"));
 const hi=mandate(1.4);assert.equal(composeMandatedPortfolio(hi,measured(.8)).status,"INFEASIBLE");
});
check("E2 Cash/risky/gross/net/target bounds all enforced; conflicting caps have no fallback",()=>{
 for(const field of ["cash_floor","cash_ceiling","min_risky_allocation","max_risky_allocation","max_gross_exposure","max_net_exposure"] as const){const m=mandate();m.constraints[field]=field==="cash_floor"?.5:field==="min_risky_allocation"?.9:field==="cash_ceiling"?.1:.5;assert.equal(composeMandatedPortfolio(m,measured()).status,"INFEASIBLE",field);}
 const m=mandate();m.primary_target.lower_bound=.7;assert.equal(composeMandatedPortfolio(m,measured()).status,"INFEASIBLE");
 m.exposure_policy.constraint_action="CLIP";m.constraints.cash_floor=.9;assert.equal(composeMandatedPortfolio(m,measured()).status,"INFEASIBLE");
});
check("F LEGACY RISK_FRACTION preserves literal cash/risk, version and labels",()=>{
 for(const risk of[0,.1,.5,.6,1]){const c=legacy(risk),s=measured(.8),a=adaptLegacyCapitalOutput(c);assert.equal(a.status,"VALID");assert.equal(a.mandate!.semantics,"LEGACY");assert.equal(a.mandate!.primary_target.metric,"RISK_FRACTION");
  const f=composeMandatedPortfolio(a.mandate,s);assert.equal(f.status,"VALID",f.errors.join("; "));assert.equal(f.portfolio!.implied_cash_weight,c.cash_budget);near(f.portfolio!.exposure_multiplier,risk);near(f.portfolio!.expected_final_beta,risk*.8);
  const old=composeFinalPortfolio(c,s);assert.equal(old.status,"VALID");assert.equal(old.portfolio!.semantics,"LEGACY_RISK_FRACTION");assert.deepEqual(old.portfolio!.total_asset_weights,f.portfolio!.total_asset_weights);assert.equal(old.portfolio!.total_cash_weight,f.portfolio!.implied_cash_weight);}
 const m=mandate();m.primary_target.metric="RISK_FRACTION";assert.equal(validateRiskMandate(m).status,"INVALID_INPUT");
});
check("F2 Archived unmeasured sleeve upgrade keeps allocation but never invents beta",()=>{
 const s=rawSleeve(),{allocation_id,estimated_market_beta,estimated_volatility,asset_market_betas,beta_model,risk_model_provenance,risk_measurement_status,...rest}=s;
 const body={...rest,schema_version:"allocation-core-1.0.0"},old={...body,allocation_id:"allocation_"+canonicalHash(body)};const upgraded=upgradeLegacyRiskSleeve(old);assert.equal(upgraded.status,"VALID");assert.deepEqual(upgraded.result!.asset_weights_risk_sleeve,s.asset_weights_risk_sleeve);assert.equal(upgraded.result!.estimated_market_beta,null);
 assert.equal(composeMandatedPortfolio(mandate(),upgraded.result).status,"INSUFFICIENT_DATA");assert.equal(composeMandatedPortfolio(adaptLegacyCapitalOutput(legacy()).mandate,upgraded.result).status,"VALID");
});
// Independent oracle: pairwise covariance identity, not the core centered sums.
const oracleBeta=(rows:PairedReturn[])=>{let cov=0,variance=0;for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const dx=rows[i].market_return-rows[j].market_return;cov+=dx*(rows[i].portfolio_return-rows[j].portfolio_return);variance+=dx*dx;}return cov/variance;};
const xs=[.02,-.15,-.05,.01,-.20,.03,.04,-.01,-.08,.06,-.12,.07],ys=[.014,-.255,-.065,.012,-.29,.016,.019,-.005,-.14,.023,-.18,.03];
const rows:PairedReturn[]=xs.map((market_return,i)=>({date:`2026-01-${String(i+1).padStart(2,"0")}`,market_return,portfolio_return:ys[i]}));
const config:MarketRiskConfiguration={...DEFAULT_MARKET_RISK_CONFIGURATION,benchmark:"SYNTHETIC_MARKET",rolling_window_observations:3,tail_quantile:.25};
for(const name of["market_beta","rolling_market_beta","upside_beta","downside_beta","drawdown_beta","tail_beta"] as const)check(`G ${name} known answer from independent pairwise oracle`,()=>{
 const result=calculateMarketRiskMetrics(rows,"2026-01-13","2026-01-12",config);assert.equal(result.status,"VALID");let sample=rows;
 if(name==="rolling_market_beta")sample=rows.slice(-3);if(name==="upside_beta")sample=rows.filter(r=>r.market_return>0);if(name==="downside_beta")sample=rows.filter(r=>r.market_return<0);
 if(name==="tail_beta")sample=rows.filter(r=>r.market_return<=-.09); // Type7(.25): -.12 + .75*(.04) = -.09.
 if(name==="drawdown_beta"){const levels=[1];rows.forEach(r=>levels.push(levels.at(-1)!*(1+r.market_return)));sample=rows.filter((_,i)=>levels[i+1]/Math.max(...levels.slice(0,i+2))-1<=-.1);}
 const actual=result.metrics.find(m=>m.name===name)!;assert.equal(actual.status,"VALID");assert.equal(actual.observations,sample.length);near(actual.value,oracleBeta(sample));assert.equal(actual.units,"BETA");
});
for(const [name,sign]of[["upside_capture",1],["downside_capture",-1]] as const)check(`Capture ${name} is geometric subset ratio, not conditional beta`,()=>{
 const metrics=calculateMarketRiskMetrics(rows,"2026-01-13","2026-01-12",config).metrics,sample=rows.filter(r=>sign*r.market_return>0);
 const geom=(key:"portfolio_return"|"market_return")=>sample.reduce((p,r)=>p*(1+r[key]),1)**(1/sample.length)-1;
 const actual=metrics.find(m=>m.name===name)!;near(actual.value,geom("portfolio_return")/geom("market_return"));assert.equal(actual.units,"CAPTURE_RATIO");
 assert.notEqual(actual.value,metrics.find(m=>m.name===(sign>0?"upside_beta":"downside_beta"))!.value);
});
check("H Future mutations/NaN/appended returns do not change past beta/capture/hash estimates",()=>{
 const cutoff="2026-01-08",a=calculateMarketRiskMetrics(rows,"2026-01-09",cutoff,config),future=structuredClone(rows);
 future.filter(r=>r.date>cutoff).forEach(r=>{r.market_return=NaN;r.portfolio_return=Infinity;});future.push({date:"2026-02-01",market_return:.99,portfolio_return:-.9});
 assert.deepEqual(a,calculateMarketRiskMetrics(future,"2026-01-09",cutoff,config));const inside=structuredClone(rows);inside[0].portfolio_return+=.01;assert.notDeepEqual(a,calculateMarketRiskMetrics(inside,"2026-01-09",cutoff,config));
});
check("Risk estimates bind to weights/model/cutoff; missing or future risk cannot normalize",()=>{
 const s=measured(),copy=structuredClone(s);copy.estimated_market_beta=1;const {allocation_id,...body}=copy;copy.allocation_id="allocation_"+canonicalHash(body);assert.equal(validateRiskSleeveAllocation(copy).status,"INVALID_INPUT");
 const future=structuredClone(s);future.beta_model!.as_of="2026-01-10";const {allocation_id:id,...b}=future;future.allocation_id="allocation_"+canonicalHash(b);assert.equal(composeMandatedPortfolio(mandate(),future).status,"INVALID_INPUT");
 assert.equal(composeMandatedPortfolio(mandate(),rawSleeve()).status,"INSUFFICIENT_DATA");
});
check("Volatility mandate uses unscaled annual volatility; sum weights is not beta",()=>{
 const m=mandate(.1);m.primary_target.metric="VOLATILITY";const f=composeMandatedPortfolio(m,measured(.8,.2));assert.equal(f.status,"VALID");near(f.portfolio!.exposure_multiplier,.5);near(f.portfolio!.expected_final_volatility,.1);near(f.portfolio!.expected_final_beta,.4);
 assert.equal(composeMandatedPortfolio(m,measured(.8,0)).status,"INFEASIBLE");assert.equal(measured(.8).net_exposure,1);assert.equal(measured(.8).estimated_market_beta,.8);
});
check("Metric default 63/.05/-10%, insufficient variance, invalid data and config reject explicitly",()=>{
 assert.equal(DEFAULT_MARKET_RISK_CONFIGURATION.rolling_window_observations,63);assert.equal(DEFAULT_MARKET_RISK_CONFIGURATION.tail_quantile,.05);assert.equal(DEFAULT_MARKET_RISK_CONFIGURATION.drawdown_threshold,-.1);
 const constant=rows.map(r=>({...r,market_return:.01}));const result=calculateMarketRiskMetrics(constant,"2026-01-13","2026-01-12");assert.equal(result.metrics.find(m=>m.name==="market_beta")!.value,null);assert.equal(result.metrics.find(m=>m.name==="market_beta")!.status,"INSUFFICIENT_DATA");
 assert.equal(result.metrics.find(m=>m.name==="rolling_market_beta")!.status,"INSUFFICIENT_DATA");
 assert.equal(calculateMarketRiskMetrics([{...rows[0],portfolio_return:NaN}],"2026-01-13","2026-01-12").status,"INVALID_INPUT");
 assert.equal(calculateMarketRiskMetrics(rows,"2026-01-13","2026-01-12",{...config,tail_quantile:1}).status,"INVALID_INPUT");
});
check("Primary mandate validation rejects second cash primitive and malformed metadata",()=>{
 assert.equal(validateRiskMandate({...mandate(),cash_budget:.4}).status,"INVALID_INPUT");assert.equal(validateRiskMandate({...mandate(),confidence:NaN}).status,"INVALID_INPUT");
 const m=mandate();m.provenance.data_available_at="2026-01-11";assert.equal(validateRiskMandate(m).status,"INVALID_INPUT");
 for(const bad of[null,{},[],NaN])assert.equal(composeMandatedPortfolio(bad,rawSleeve()).status,"INVALID_INPUT");
});
check("Mandate composition is pure, key-order/hash reproducible and cash only an implementation output",()=>{
 const m=mandate(),s=measured(),before=canonicalHash({m,s}),a=composeMandatedPortfolio(m,s);assert.equal(canonicalHash({m,s}),before);
 const reordered=Object.fromEntries(Object.entries(m).reverse());assert.deepEqual(a,composeMandatedPortfolio(reordered,s));assert.equal(m.primary_target.metric,"MARKET_BETA");assert.equal("cash_budget"in m,false);
});
check("Beta benchmark identity cannot be silently substituted",()=>{
 const m=mandate();m.market_benchmark="OTHER_SYNTHETIC_MARKET";assert.equal(composeMandatedPortfolio(m,measured()).status,"INVALID_INPUT");m.market_benchmark=null;assert.equal(validateRiskMandate(m).status,"INVALID_INPUT");
});
check("Default 63-session rolling beta is computed only when all 63 past pairs exist",()=>{
 const rs:PairedReturn[]=Array.from({length:70},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),market_return:(i%2?-.01:.02)+i*.0001,portfolio_return:.6*((i%2?-.01:.02)+i*.0001)+.0003}));
 const out=calculateMarketRiskMetrics(rs,"2025-03-12","2025-03-11");const roll=out.metrics.find(m=>m.name==="rolling_market_beta")!;assert.equal(roll.status,"VALID");assert.equal(roll.observations,63);near(roll.value,oracleBeta(rs.slice(-63)));near(roll.value,.6);
});
