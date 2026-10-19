/** AL02 research-only: strict prior-decision common-set sample covariance. */
import { canonicalHash,timestamp } from "../validation";
import type { AllocationStatus } from "../contracts";
export const PIT_MODEL_VERSION="pit-asset-beta-covariance-1.0.0";
export interface ReturnVector {date:string;values:Record<string,number>;}
export interface PriceObservation {date:string;adjusted_close:number;}
export interface PitConfiguration {benchmark:string;window_sessions:63|126|252;minimum_observations:number;}
export const DEFAULT_PIT_CONFIGURATION:PitConfiguration={benchmark:"SPY",window_sessions:252,minimum_observations:252};
export interface AssetBetaEstimate {asset:string;beta:number;observations:number;window_start:string;window_end:string;
 information_cutoff:string;benchmark:string;data_hash:string;model:string;version:string;}
export interface PitSleeveEstimate {status:AllocationStatus;errors:string[];warnings:string[];decision_date:string;
 information_cutoff:string|null;data_hash:string;configuration_hash:string;asset_betas:AssetBetaEstimate[];
 axes:string[];covariance:number[][]|null;beta_sleeve:number|null;annualized_volatility:number|null;observations:number;
 window_start:string|null;window_end:string|null;model:string;version:string;}
export function adjustedReturns(prices:PriceObservation[],asset="SPY"):ReturnVector[]{
 if(prices.some((p,i)=>timestamp(p.date)===null||!Number.isFinite(p.adjusted_close)||p.adjusted_close<=0||i&&p.date<=prices[i-1].date))throw new Error("Invalid adjusted price chronology/value");
 return prices.slice(1).map((p,i)=>({date:p.date,values:{[asset]:p.adjusted_close/prices[i].adjusted_close-1}}));
}
export function covariance(a:number[],b:number[]):number{
 if(a.length!==b.length||a.length<2)throw new Error("Covariance requires common sample >=2");
 const x=a.map(v=>v-a[0]),y=b.map(v=>v-b[0]),xm=x.reduce((s,v)=>s+v,0)/x.length,ym=y.reduce((s,v)=>s+v,0)/y.length;
 return x.reduce((s,v,i)=>s+(v-xm)*(y[i]-ym),0)/(x.length-1);
}
export function estimatePitSleeve(input:ReturnVector[],q:Record<string,number>,decision_date:string,config:PitConfiguration=DEFAULT_PIT_CONFIGURATION):PitSleeveEstimate{
 const axes=Object.keys(q).sort(),errors:string[]=[],warnings:string[]=[],decision=timestamp(decision_date);
 if(decision===null||![63,126,252].includes(config.window_sessions)||!Number.isInteger(config.minimum_observations)||config.minimum_observations<2||config.minimum_observations>config.window_sessions||!config.benchmark.trim()||!axes.length||axes.some(k=>!Number.isFinite(q[k])))errors.push("Invalid PIT configuration/weights/date");
 // Future values do not enter validation, sample selection or hashes.
 const prior=input.filter(r=>timestamp(r.date)!<decision!).slice(-config.window_sessions);
 if(prior.some((r,i)=>timestamp(r.date)===null||i&&r.date<=prior[i-1].date))errors.push("Invalid/duplicate prior chronology");
 const needed=[...new Set([...axes,config.benchmark])],complete=prior.filter(r=>needed.every(k=>r.values[k]!==undefined));
 if(complete.length<prior.length)warnings.push(`EXPLICIT_COMMON_SET_DROP: ${prior.length-complete.length} incomplete sessions`);
 if(complete.some(r=>needed.some(k=>!Number.isFinite(r.values[k])||r.values[k]<=-1)))errors.push("Invalid eligible asset returns");
 let configHash="";try{configHash=canonicalHash(config);}catch{errors.push("Noncanonical/nonfinite configuration; no configuration hash available");}
 const body:PitSleeveEstimate={status:"VALID",errors,warnings,decision_date,information_cutoff:complete.at(-1)?.date??null,
 data_hash:errors.length?canonicalHash({invalid:true}):canonicalHash(complete.map(r=>({date:r.date,values:Object.fromEntries(needed.map(k=>[k,r.values[k]]))}))),
 configuration_hash:configHash,asset_betas:[],axes,covariance:null,beta_sleeve:null,annualized_volatility:null,observations:complete.length,
 window_start:complete[0]?.date??null,window_end:complete.at(-1)?.date??null,model:"sample-covariance-beta",version:PIT_MODEL_VERSION};
 if(errors.length){body.status="INVALID_INPUT";return body;}
 if(complete.length<config.minimum_observations){body.status="INSUFFICIENT_DATA";body.errors.push("Insufficient common observations");return body;}
 const market=complete.map(r=>r.values[config.benchmark]),variance=covariance(market,market);
 if(variance===0){body.status="INSUFFICIENT_DATA";body.errors.push("Market variance zero; no epsilon denominator");return body;}
 const vectors=axes.map(k=>complete.map(r=>r.values[k]));body.covariance=vectors.map(a=>vectors.map(b=>covariance(a,b)));
 body.asset_betas=axes.map((asset,i)=>({asset,beta:covariance(vectors[i],market)/variance,observations:complete.length,window_start:body.window_start!,window_end:body.window_end!,information_cutoff:body.information_cutoff!,benchmark:config.benchmark,data_hash:body.data_hash,model:body.model,version:PIT_MODEL_VERSION}));
 body.beta_sleeve=body.asset_betas.reduce((s,b)=>s+q[b.asset]*b.beta,0);
 const v=axes.reduce((s,a,i)=>s+axes.reduce((t,b,j)=>t+q[a]*q[b]*body.covariance![i][j],0),0);body.annualized_volatility=v>=0?Math.sqrt(252*v):null;
 if(![variance,body.beta_sleeve,body.annualized_volatility,...body.asset_betas.map(b=>b.beta),...body.covariance.flat()].every(v=>v!==null&&Number.isFinite(v))){body.status="NUMERICAL_FAILURE";body.errors.push("Nonfinite/negative covariance risk arithmetic");body.beta_sleeve=null;body.annualized_volatility=null;}
 return body;
}
