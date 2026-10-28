import assert from"node:assert/strict";
import{test,after}from"node:test";
import{readFileSync,writeFileSync}from"node:fs";
import{estimatePitSleeve,adjustedReturns,covariance,type ReturnVector}from"./estimators";
import{regression,conditionalMetrics,rollingBetas,beta,capture,cvar,basicMetrics,DEFAULT_REGRESSION,type Pair}from"./analytics";
import{capitalEfficiency,matchedBenchmarkEfficiency,constantBetaDiagnostic,measuredSleeve,betaMandate,ratio}from"./diagnostics";
import{composeMandatedPortfolio}from"../risk-mandate";
import{canonicalHash}from"../validation";
import{calculateMarketRiskMetrics}from"../risk-metrics";
const oracle=JSON.parse(readFileSync("reports/al02/oracle-fixtures.json","utf8")),cases:Array<{name:string;status:string;error?:string}>=[];
const check=(name:string,fn:()=>void)=>test("AL02 SYNTHETIC — "+name,()=>{try{fn();cases.push({name,status:"PASS"});}catch(e){cases.push({name,status:"FAIL",error:String(e)});throw e;}});
after(()=>writeFileSync("reports/al02/test-cases.json",JSON.stringify({cases,pass:cases.filter(c=>c.status==="PASS").length,fail:cases.filter(c=>c.status==="FAIL").length},null,2)+"\n"));
const near=(a:number|null,b:number,abs=1e-10,rel=1e-8)=>assert.ok(a!==null&&Number.isFinite(a)&&Math.abs(a-b)<=abs+rel*Math.abs(b),`${a} != ${b}`);
const vectors:ReturnVector[]=Array.from({length:300},(_,i)=>{const x=.004*Math.sin(i*.7)+.002*Math.cos(i*.3);return{date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),values:{SPY:x,AAA:.8*x,BBB:1.2*x}};});
const decision="2020-10-28";
for(const window of[63,126,252]as const)check(`PIT exact asset beta, common covariance and q beta/vol, window ${window}`,()=>{
 const q={AAA:.25,BBB:.75},e=estimatePitSleeve(vectors,q,decision,{benchmark:"SPY",window_sessions:window,minimum_observations:window});assert.equal(e.status,"VALID");near(e.asset_betas[0].beta,.8);near(e.asset_betas[1].beta,1.2);near(e.beta_sleeve,1.1);assert.ok(e.information_cutoff!<decision);assert.equal(e.observations,window);
 const data=vectors.slice(-window).map(r=>1.1*r.values.SPY),m=data.reduce((s,v)=>s+v,0)/window;
 const oracleVol=Math.sqrt(data.reduce((s,v)=>s+(v-m)**2,0)/(window-1)*252);near(e.annualized_volatility,oracleVol);
});
check("Future mutations and decision-day rows never enter estimator/hash, internal mutation does",()=>{
 const cutoff=vectors[250].date,a=estimatePitSleeve(vectors,{AAA:1},cutoff,{benchmark:"SPY",window_sessions:126,minimum_observations:126}),changed=structuredClone(vectors);
 changed.filter(r=>r.date>=cutoff).forEach(r=>{r.values.AAA=Infinity;r.values.SPY=NaN;});assert.deepEqual(a,estimatePitSleeve(changed,{AAA:1},cutoff,{benchmark:"SPY",window_sessions:126,minimum_observations:126}));
 changed[230].values.AAA+=.01;assert.notEqual(a.data_hash,estimatePitSleeve(changed,{AAA:1},cutoff,{benchmark:"SPY",window_sessions:126,minimum_observations:126}).data_hash);
});
check("Insufficient/missing history, zero market variance and invalid configuration fail",()=>{
 assert.equal(estimatePitSleeve(vectors.slice(0,20),{AAA:1},decision).status,"INSUFFICIENT_DATA");
 const zero=vectors.map(r=>({...r,values:{...r.values,SPY:.01}}));assert.equal(estimatePitSleeve(zero,{AAA:1},decision).status,"INSUFFICIENT_DATA");
 assert.equal(estimatePitSleeve(vectors,{AAA:1},decision,{benchmark:"SPY",window_sessions:63,minimum_observations:64}).status,"INVALID_INPUT");
 const missing=structuredClone(vectors);delete missing.at(-1)!.values.AAA;const e=estimatePitSleeve(missing,{AAA:1},decision);assert.equal(e.status,"INSUFFICIENT_DATA");assert.ok(e.warnings[0].includes("DROP"));
});
for(const target of[.3,.5,.7,.9])for(const asset of["AAA","BBB"])check(`Controller target ${target}, controlled beta ${asset==="AAA"?.8:1.2}`,()=>{
 const q={[asset]:1},e=estimatePitSleeve(vectors,q,decision),s=measuredSleeve(q,e),f=composeMandatedPortfolio(betaMandate(target,s),s);
 if(target===.9&&asset==="AAA"){assert.equal(f.status,"INFEASIBLE");assert.ok(f.portfolio!.constraint_failures.length);return;}
 assert.equal(f.status,"VALID",f.errors.join("; "));near(f.portfolio!.exposure_multiplier,target/e.beta_sleeve!);near(f.portfolio!.implied_cash_weight,1-target/e.beta_sleeve!);near(f.portfolio!.expected_final_beta,target);
});
check("Estimated sleeve beta is not realized forward beta",()=>{
 const p=estimatePitSleeve(vectors,{AAA:1},decision),s=measuredSleeve({AAA:1},p),f=composeMandatedPortfolio(betaMandate(.6,s),s),future=vectors.slice(-30).map(r=>({date:r.date,market:r.values.SPY,portfolio:1.2*r.values.SPY,rf:0}));
 near(p.beta_sleeve,.8);near(beta(future).value,1.2);near(beta(future.map(r=>({...r,portfolio:f.portfolio!.exposure_multiplier!*r.portfolio}))).value,.9);near(f.portfolio!.expected_final_beta,.6);
});
for(const model of["CAPM","TREYNOR_MAZUY"]as const)for(const se of["OLS","HAC"]as const)check(`${model} coefficients, R2, covariance, SE and t-stats vs independent SciPy/Toeplitz oracle ${se}`,()=>{
 const o=oracle.regressions[model],r=regression(o.pairs,model,o.pairs.at(-1).date,{standard_errors:se==="OLS"?"OLS_HOMOSKEDASTIC":"HAC_NEWEY_WEST",hac_lags:5,hac_small_sample_correction:false});assert.equal(r.status,"VALID");
 o.coefficients.forEach((v:number,i:number)=>near(r.coefficients![i],v));near(r.r_squared,o.r_squared);
 o[se].standard_errors.forEach((v:number,i:number)=>near(r.standard_errors![i],v));o[se].t.forEach((v:number,i:number)=>near(r.t_statistics![i],v));
 o[se].covariance.forEach((row:number[],i:number)=>row.forEach((v,j)=>near(r.coefficient_covariance![i][j],v,1e-14,1e-8)));near(r.alpha_annualized,252*.0002);near(r.beta,.7);if(model==="TREYNOR_MAZUY")near(r.gamma,3);
});
check("HAC finite-sample correction explicit; future regression pairs don't alter earlier fit",()=>{
 const rows:Pair[]=oracle.regressions.CAPM.pairs,a=regression(rows,"CAPM",rows.at(-1)!.date),b=regression(rows,"CAPM",rows.at(-1)!.date,{...DEFAULT_REGRESSION,hac_small_sample_correction:true});
 a.standard_errors!.forEach((s,i)=>near(b.standard_errors![i],s*Math.sqrt(rows.length/(rows.length-2))));
 assert.deepEqual(a,regression([...rows,{date:"2026-03-01",portfolio:Infinity,market:NaN,rf:NaN}],"CAPM",rows.at(-1)!.date));
});
for(const key of["full","upside","downside","DD5","DD10","DD20","Q5","Q1"]as const)check(`Conditional ${key} vs independent numpy state/covariance oracle`,()=>{
 const o=oracle.conditional,result=conditionalMetrics(o.pairs,o.history,o.pairs.at(-1).date),actual=key==="full"?result.full_beta:key==="upside"?result.upside_beta:key==="downside"?result.downside_beta:key.startsWith("DD")?result.drawdown_beta[String(Number(key.slice(2))/100)]:result.tail_beta[String(Number(key.slice(1))/100)];near(actual.value,o.expected[key].value);assert.equal(actual.observations,o.expected[key].observations);
});
check("Inherited drawdown: sample begins below earlier peak; version 1.0 remains different",()=>{
 const o=oracle.conditional,r=conditionalMetrics(o.pairs,o.history,o.pairs.at(-1).date),reset=conditionalMetrics(o.pairs,o.history.slice(2),o.pairs.at(-1).date);assert.ok(r.drawdown_beta["0.1"].observations>reset.drawdown_beta["0.1"].observations);
 assert.equal(r.methodology_version,"market-risk-metrics-1.1.0");
 const legacy=calculateMarketRiskMetrics(o.pairs.map((r:Pair)=>({date:r.date,portfolio_return:r.portfolio,market_return:r.market})),"2026-01-01",o.pairs.at(-1).date);assert.equal(legacy.configuration.methodology_version,"market-risk-metrics-1.0.0");assert.ok(legacy.metrics.find(m=>m.name==="drawdown_beta")!.observations<r.drawdown_beta["0.1"].observations);
});
check("Conditional state/estimates ignore future peaks and future paired returns",()=>{
 const o=oracle.conditional,cutoff=o.pairs[149].date,a=conditionalMetrics(o.pairs,o.history,cutoff),history=structuredClone(o.history),pairs=structuredClone(o.pairs);
 history.filter((r:{date:string})=>r.date>cutoff).forEach((r:{adjusted_close:number})=>r.adjusted_close=1e9);pairs.filter((r:Pair)=>r.date>cutoff).forEach((r:Pair)=>{r.portfolio=NaN;r.market=Infinity;});assert.deepEqual(a,conditionalMetrics(pairs,history,cutoff));
});
for(const [side,key]of[["upside","up_capture"],["downside","down_capture"]])check(`${side} capture uses geometric subset oracle, distinct from beta`,()=>{
 const o=oracle.conditional,r=conditionalMetrics(o.pairs,o.history,o.pairs.at(-1).date),actual=side==="upside"?r.upside_capture:r.downside_capture;near(actual.value,o.expected[key]);assert.notEqual(actual.value,side==="upside"?r.upside_beta.value:r.downside_beta.value);
});
for(const window of[63,126]as const)check(`Rolling ${window} matches independent pairwise covariance`,()=>{
 const rs:Pair[]=oracle.conditional.pairs,r=rollingBetas(rs,window,rs.at(-1)!.date);assert.equal(r.length,rs.length-window+1);for(const actual of[r[0],r.at(-1)!]){const at=rs.findIndex(x=>x.date===actual.date),sample=rs.slice(at-window+1,at+1);let cov=0,v=0;for(let i=0;i<sample.length;i++)for(let j=i+1;j<sample.length;j++){const d=sample[i].market-sample[j].market;cov+=d*(sample[i].portfolio-sample[j].portfolio);v+=d*d;}near(actual.value,cov/v);}
});
check("CVaR worst empirical tail with fractional boundary; no percentile/tail confusion",()=>{
 near(cvar([-.1,-.08,-.04,0,.01],.7),(.1+.5*.08)/1.5);near(cvar(Array.from({length:20},(_,i)=>(i-10)/100),.95),.1);assert.throws(()=>cvar([], .95));
});
check("Basic CAGR calendar convention, sample volatility, drawdown and final index known answers",()=>{
 const rs:Pair[]=[{date:"2020-01-02",portfolio:.1,market:.1,rf:0},{date:"2021-01-01",portfolio:-.1,market:-.1,rf:0}],r=basicMetrics(rs,"2020-01-01");near(r.final_index,99);near(r.cagr,.99**(365.25/366)-1);near(r.max_drawdown,-.1);near(r.annualized_volatility,Math.sqrt(.02*252));near(r.cvar_95,.1);
});
check("Capital efficiency ratios, zero-beta failure, matched-CAGR and same-beta reference",()=>{
 const e=capitalEfficiency(.12,.2,.6);near(e.cagr_per_average_beta.value,.2);near(e.volatility_per_unit_beta.value,1/3);assert.equal(capitalEfficiency(.12,.2,0).return_per_unit_beta.status,"INSUFFICIENT_DATA");assert.equal(ratio(1,1e-20).status,"INSUFFICIENT_DATA");
 const rs:Pair[]=Array.from({length:10},(_,i)=>({date:`2025-01-${String(i+2).padStart(2,"0")}`,portfolio:.5*(.01+i*.001),market:.01+i*.001,rf:0})),r=basicMetrics(rs,"2025-01-01"),matched=matchedBenchmarkEfficiency(r.cagr,.5,rs,"2025-01-01");near(matched.matched_cagr_beta,.5);near(matched.same_cagr_beta_saving.value,0);near(matched.same_beta_cagr_difference.value,0);
});
check("Constant-beta retrospective diagnostic equals exact target market covariance, no book/backtest",()=>{
 const pit=estimatePitSleeve(vectors,{SPY:1},decision),rs:Pair[]=vectors.slice(-30).map(r=>({date:r.date,portfolio:r.values.SPY,market:r.values.SPY,rf:0}));
 const d=constantBetaDiagnostic(rs,.7,pit);assert.equal(d.label,"RETROSPECTIVE_DIAGNOSTIC");assert.equal(d.status,"VALID");near(beta(d.returns).value,.7);near(d.composition.portfolio!.implied_cash_weight,.3);
});
check("Reproducibility: same canonical input/config gives same output hash; price returns explicit",()=>{
 const a=estimatePitSleeve(vectors,{AAA:.25,BBB:.75},decision),b=estimatePitSleeve(structuredClone(vectors),{BBB:.75,AAA:.25},decision);assert.equal(canonicalHash(a),canonicalHash(b));
 assert.deepEqual(adjustedReturns([{date:"2020-01-01",adjusted_close:100},{date:"2020-01-02",adjusted_close:102}]),[{date:"2020-01-02",values:{SPY:102/100-1}}]);
});
check("Exact constant-beta model has no identifiable residual-noise t-statistics",()=>{
 const rows:Pair[]=oracle.regressions.CAPM.pairs.map((r:Pair)=>({...r,rf:0,portfolio:.7*r.market}));
 const r=regression(rows,"CAPM",rows.at(-1)!.date);near(r.beta,.7);near(r.daily_alpha,0);assert.equal(r.t_alpha,null);assert.equal(r.t_beta,null);
});
check("Volatility mandate scales a covariance-PIT sleeve, not a supplied volatility placeholder",()=>{
 const q={AAA:.25,BBB:.75},p=estimatePitSleeve(vectors,q,decision),s=measuredSleeve(q,p),m=betaMandate(.3,s);m.primary_target.metric="VOLATILITY";m.primary_target.target=p.annualized_volatility!/2;
 const f=composeMandatedPortfolio(m,s);assert.equal(f.status,"VALID");near(f.portfolio!.exposure_multiplier,.5);near(f.portfolio!.implied_cash_weight,.5);near(f.portfolio!.expected_final_volatility,p.annualized_volatility!/2);near(f.portfolio!.expected_final_beta,.55);
});
check("Nonfinite PIT configuration rejects as INVALID_INPUT without fabricating a valid hash",()=>{
 assert.equal(estimatePitSleeve(vectors,{AAA:1},decision,{benchmark:"SPY",window_sessions:252,minimum_observations:NaN}).status,"INVALID_INPUT");
});
check("Overflow in efficiency ratio is NUMERICAL_FAILURE, never VALID Infinity",()=>{
 const r=ratio(Number.MAX_VALUE,.001);assert.equal(r.status,"NUMERICAL_FAILURE");assert.equal(r.value,null);
});
