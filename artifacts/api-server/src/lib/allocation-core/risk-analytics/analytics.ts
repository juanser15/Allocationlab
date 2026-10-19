/** Versioned AL02 analytics. No backtester, optimizer, UI or data-service calls. */
import {canonicalHash,timestamp}from"../validation";
import {covariance,type PriceObservation}from"./estimators";
export const ANALYTICS_VERSION="market-risk-metrics-1.1.0";
export interface Pair {date:string;portfolio:number;market:number;rf:number;}
export interface Diagnostic {status:"VALID"|"INSUFFICIENT_DATA"|"NUMERICAL_FAILURE";value:number|null;observations:number;reason:string|null;}
export interface RegressionConfiguration {standard_errors:"OLS_HOMOSKEDASTIC"|"HAC_NEWEY_WEST";hac_lags:number;hac_small_sample_correction:boolean;}
export const DEFAULT_REGRESSION:RegressionConfiguration={standard_errors:"HAC_NEWEY_WEST",hac_lags:5,hac_small_sample_correction:false};
export interface RegressionResult {status:"VALID"|"INSUFFICIENT_DATA"|"INVALID_INPUT"|"NUMERICAL_FAILURE";model_spec:string;coefficients:number[]|null;
 inference_status:"VALID"|"INSUFFICIENT_DATA"|"NUMERICAL_FAILURE";inference_reason:string|null;
 standard_errors:number[]|null;t_statistics:Array<number|null>|null;coefficient_covariance:number[][]|null;daily_alpha:number|null;alpha_annualized:number|null;
 beta:number|null;gamma:number|null;t_alpha:number|null;t_beta:number|null;t_gamma:number|null;r_squared:number|null;observations:number;
 sample_start:string|null;sample_end:string|null;configuration:RegressionConfiguration;data_hash:string;methodology_version:string;errors:string[];}
export const mean=(a:number[])=>a.length?a[0]+a.reduce((s,v)=>s+(v-a[0]),0)/a.length:NaN;
const zero=(n:number,m=n)=>Array.from({length:n},()=>Array<number>(m).fill(0));
const transpose=(a:number[][])=>a[0].map((_,j)=>a.map(r=>r[j]));
const multiply=(a:number[][],b:number[][])=>a.map(r=>b[0].map((_,j)=>r.reduce((s,v,k)=>s+v*b[k][j],0)));
function inverse(a:number[][]):number[][]|null{
 const n=a.length,r=a.map((row,i)=>[...row,...Array.from({length:n},(_,j)=>i===j?1:0)]),scale=Math.max(1,...a.flat().map(Math.abs));
 for(let j=0;j<n;j++){let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(r[i][j])>Math.abs(r[pivot][j]))pivot=i;
  if(Math.abs(r[pivot][j])<=64*Number.EPSILON*scale*n)return null;[r[j],r[pivot]]=[r[pivot],r[j]];
  const divisor=r[j][j];r[j]=r[j].map(v=>v/divisor);for(let i=0;i<n;i++)if(i!==j){const f=r[i][j];r[i]=r[i].map((v,k)=>v-f*r[j][k]);}}
 return r.map(row=>row.slice(n));
}
export function regression(input:Pair[],model:"CAPM"|"TREYNOR_MAZUY",cutoff:string,config:RegressionConfiguration=DEFAULT_REGRESSION):RegressionResult{
 const rows=input.filter(r=>r.date<=cutoff),n=rows.length,p=model==="CAPM"?2:3;
 const out:RegressionResult={status:"VALID",inference_status:"INSUFFICIENT_DATA",inference_reason:"Regression not yet fitted",model_spec:model==="CAPM"?"rp-rf = alpha + beta*(rm-rf) + epsilon":"rp-rf = alpha + beta*(rm-rf) + gamma*(rm-rf)^2 + epsilon",coefficients:null,standard_errors:null,t_statistics:null,coefficient_covariance:null,daily_alpha:null,alpha_annualized:null,beta:null,gamma:null,t_alpha:null,t_beta:null,t_gamma:null,r_squared:null,observations:n,sample_start:rows[0]?.date??null,sample_end:rows.at(-1)?.date??null,configuration:structuredClone(config),data_hash:"",methodology_version:"risk-attribution-regression-1.0.1",errors:[]};
 if(timestamp(cutoff)===null||!Number.isInteger(config.hac_lags)||config.hac_lags<0||!["OLS_HOMOSKEDASTIC","HAC_NEWEY_WEST"].includes(config.standard_errors)||rows.some((r,i)=>timestamp(r.date)===null||![r.portfolio,r.market,r.rf].every(Number.isFinite)||i&&r.date<=rows[i-1].date)){out.status="INVALID_INPUT";out.errors.push("Invalid eligible regression pairs/configuration");return out;}
 out.data_hash=canonicalHash(rows);
 if(n<=p||config.standard_errors==="HAC_NEWEY_WEST"&&config.hac_lags>=n){out.status="INSUFFICIENT_DATA";out.errors.push("Insufficient observations/degrees of freedom/HAC lag");return out;}
 const xs=rows.map(r=>r.market-r.rf),y=rows.map(r=>r.portfolio-r.rf),columns=[xs,...(p===3?[xs.map(x=>x*x)]:[])],means=columns.map(mean),scales=columns.map((c,j)=>Math.sqrt(c.reduce((s,v)=>s+(v-means[j])**2,0)/n));
 if(scales.some(s=>s===0||!Number.isFinite(s))){out.status="INSUFFICIENT_DATA";out.errors.push("Singular market design");return out;}
 const z=rows.map((_,i)=>[1,...columns.map((c,j)=>(c[i]-means[j])/scales[j])]),zt=transpose(z),inv=inverse(multiply(zt,z));
 if(!inv){out.status="INSUFFICIENT_DATA";out.errors.push("Rank deficient regression design");return out;}
 const cz=multiply(inv,multiply(zt,y.map(v=>[v]))).map(r=>r[0]),transform=zero(p);transform[0][0]=1;for(let j=1;j<p;j++){transform[0][j]=-means[j-1]/scales[j-1];transform[j][j]=1/scales[j-1];}
 const coefficients=multiply(transform,cz.map(v=>[v])).map(r=>r[0]),residual=z.map((r,i)=>y[i]-r.reduce((s,v,j)=>s+v*cz[j],0)),sse=residual.reduce((s,v)=>s+v*v,0),ym=mean(y),tss=y.reduce((s,v)=>s+(v-ym)**2,0);
 // Machine-precision residual is not an identified noise variance. Keep fitted
 // coefficients; suppress inference rather than manufacturing significance.
 const signalNorm=Math.sqrt(y.reduce((s,v)=>s+v*v,0)),roundoffBound=64*Number.EPSILON*p*signalNorm;
 if(Math.sqrt(sse)<=roundoffBound){Object.assign(out,{coefficients,daily_alpha:coefficients[0],alpha_annualized:252*coefficients[0],beta:coefficients[1],gamma:p===3?coefficients[2]:null,r_squared:tss===0?null:1-sse/tss,inference_status:"INSUFFICIENT_DATA",inference_reason:"Residual noise is zero at floating-point resolution (64*EPS*p*||y||2); t-stats unidentified"});return out;}
 let covz:number[][];
 if(config.standard_errors==="OLS_HOMOSKEDASTIC")covz=inv.map(r=>r.map(v=>v*sse/(n-p)));
 else{const meat=zero(p);for(let t=0;t<n;t++)for(let i=0;i<p;i++)for(let j=0;j<p;j++)meat[i][j]+=residual[t]**2*z[t][i]*z[t][j];
  for(let lag=1;lag<=config.hac_lags;lag++){const weight=1-lag/(config.hac_lags+1);for(let t=lag;t<n;t++)for(let i=0;i<p;i++)for(let j=0;j<p;j++)meat[i][j]+=weight*residual[t]*residual[t-lag]*(z[t][i]*z[t-lag][j]+z[t-lag][i]*z[t][j]);}
  covz=multiply(multiply(inv,meat),inv);if(config.hac_small_sample_correction)covz=covz.map(r=>r.map(v=>v*n/(n-p)));}
 const cov=multiply(multiply(transform,covz),transpose(transform)),se=cov.map((r,i)=>r[i]>=0?Math.sqrt(r[i]):NaN),ts=se.map((s,i)=>s===0?null:coefficients[i]/s);
 if(![...coefficients,...se,...cov.flat(),...ts.filter((x):x is number=>x!==null)].every(Number.isFinite)){out.status="NUMERICAL_FAILURE";out.errors.push("Nonfinite covariance/regression arithmetic");return out;}
 Object.assign(out,{coefficients,standard_errors:se,t_statistics:ts,coefficient_covariance:cov,daily_alpha:coefficients[0],alpha_annualized:252*coefficients[0],beta:coefficients[1],gamma:p===3?coefficients[2]:null,t_alpha:ts[0],t_beta:ts[1],t_gamma:p===3?ts[2]:null,r_squared:tss===0?null:1-sse/tss,inference_status:"VALID",inference_reason:null});return out;
}
export function beta(rows:Pair[]):Diagnostic{
 if(rows.length<2)return{status:"INSUFFICIENT_DATA",value:null,observations:rows.length,reason:"Fewer than 2 pairs"};const variance=covariance(rows.map(r=>r.market),rows.map(r=>r.market));
 if(variance===0)return{status:"INSUFFICIENT_DATA",value:null,observations:rows.length,reason:"Zero conditional market variance"};const value=covariance(rows.map(r=>r.portfolio),rows.map(r=>r.market))/variance;
 return{status:Number.isFinite(value)?"VALID":"NUMERICAL_FAILURE",value:Number.isFinite(value)?value:null,observations:rows.length,reason:null};
}
export function capture(rows:Pair[]):Diagnostic{
 if(rows.length<2)return{status:"INSUFFICIENT_DATA",value:null,observations:rows.length,reason:"Fewer than 2 capture pairs"};const geometric=(key:"portfolio"|"market")=>Math.expm1(rows.reduce((s,r)=>s+Math.log1p(r[key]),0)/rows.length),denom=geometric("market"),value=denom===0?NaN:geometric("portfolio")/denom;
 return{status:Number.isFinite(value)?"VALID":"INSUFFICIENT_DATA",value:Number.isFinite(value)?value:null,observations:rows.length,reason:Number.isFinite(value)?null:"Undefined capture ratio"};
}
export function quantile(a:number[],q:number):number{if(!a.length||q<0||q>1)throw new Error("Invalid quantile");const v=[...a].sort((x,y)=>x-y),h=(v.length-1)*q;return v[Math.floor(h)]+(h-Math.floor(h))*(v[Math.ceil(h)]-v[Math.floor(h)]);}
/** Empirical expected loss: worst (1-level)*n mass, fractional boundary observation. */
export function cvar(returns:number[],level=.95):number{
 if(!returns.length||level<=0||level>=1||returns.some(r=>!Number.isFinite(r)))throw new Error("Invalid CVaR input");
 const sorted=[...returns].sort((a,b)=>a-b),mass=(1-level)*returns.length;let sum=0;for(let i=0;i<sorted.length&&i<mass;i++)sum+=sorted[i]*Math.min(1,mass-i);return -sum/mass;
}
export function benchmarkDrawdownState(history:PriceObservation[],cutoff:string):Map<string,number>{
 const prior=history.filter(r=>r.date<=cutoff),out=new Map<string,number>();let high=-Infinity;
 for(let i=0;i<prior.length;i++){const r=prior[i];if(timestamp(r.date)===null||!Number.isFinite(r.adjusted_close)||r.adjusted_close<=0||i&&r.date<=prior[i-1].date)throw new Error("Invalid benchmark state history");high=Math.max(high,r.adjusted_close);out.set(r.date,r.adjusted_close/high-1);}return out;
}
export function conditionalMetrics(input:Pair[],history:PriceObservation[],cutoff:string){
 const rows=input.filter(r=>r.date<=cutoff);if(rows.some((r,i)=>![r.portfolio,r.market,r.rf].every(Number.isFinite)||r.portfolio<=-1||r.market<=-1||i&&r.date<=rows[i-1].date))throw new Error("Invalid eligible metric pairs");
 const states=benchmarkDrawdownState(history,cutoff);if(rows.some(r=>!states.has(r.date)))throw new Error("Missing benchmark state for evaluation dates");
 const up=rows.filter(r=>r.market>0),down=rows.filter(r=>r.market<0),dd=Object.fromEntries([.05,.10,.20].map(t=>[String(t),beta(rows.filter(r=>states.get(r.date)!<=-t))])),tails=Object.fromEntries([.05,.01].map(q=>[String(q),beta(rows.filter(r=>r.market<=quantile(rows.map(r=>r.market),q)))]));
 return{methodology_version:ANALYTICS_VERSION,data_hash:canonicalHash({pairs:rows,state_history:history.filter(r=>r.date<=cutoff)}),configuration_hash:canonicalHash({drawdowns:[.05,.1,.2],tails:[.05,.01],state:"ALL_AVAILABLE_PRIOR_HISTORY",capture:"GEOMETRIC_SUBSET_DAILY_RATIO_V1",quantile:"LINEAR_TYPE7_V1"}),full_beta:beta(rows),upside_beta:beta(up),downside_beta:beta(down),drawdown_beta:dd,tail_beta:tails,upside_capture:capture(up),downside_capture:capture(down)};
}
export function rollingBetas(input:Pair[],window:63|126,cutoff:string){const rows=input.filter(r=>r.date<=cutoff);return rows.slice(window-1).map((r,i)=>({date:r.date,window,...beta(rows.slice(i,i+window))}));}
export function basicMetrics(rows:Pair[],intervalStart:string){
 if(rows.length<2||rows.some(r=>!Number.isFinite(r.portfolio)||r.portfolio<=-1))throw new Error("Invalid performance returns");let wealth=1,high=1,dd=0;for(const r of rows){wealth*=1+r.portfolio;high=Math.max(high,wealth);dd=Math.min(dd,wealth/high-1);}
 const days=(Date.parse(rows.at(-1)!.date)-Date.parse(intervalStart))/86400000,vol=Math.sqrt(252*covariance(rows.map(r=>r.portfolio),rows.map(r=>r.portfolio)));
 if(days<=0)throw new Error("Nonpositive calendar span");return{cagr:wealth**(365.25/days)-1,annualized_volatility:vol,max_drawdown:dd,cvar_95:cvar(rows.map(r=>r.portfolio)),final_index:100*wealth,calendar_days:days,observations:rows.length};
}
