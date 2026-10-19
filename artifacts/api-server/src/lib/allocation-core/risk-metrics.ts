/** Diagnostic arithmetic only: no candidate selection objective or alpha estimator. */
import { type PairedReturn, type MarketRiskConfiguration, type MarketRiskMetric,
  type MarketRiskMetricResult, type MarketRiskMetricName } from "./contracts";
import { canonicalHash, timestamp } from "./validation";
export const DEFAULT_MARKET_RISK_CONFIGURATION:MarketRiskConfiguration={methodology_version:"market-risk-metrics-1.0.0",
  benchmark:"SPY",rolling_window_observations:63,drawdown_threshold:-.10,tail_quantile:.05,minimum_observations:2,
  capture_method:"GEOMETRIC_SUBSET_DAILY_RATIO_V1",quantile_method:"LINEAR_TYPE7_V1"};
export function calculateMarketRiskMetrics(input:PairedReturn[],as_of:string,information_cutoff:string,
  configuration:MarketRiskConfiguration=DEFAULT_MARKET_RISK_CONFIGURATION):MarketRiskMetricResult {
  const config=structuredClone(configuration),errors:string[]=[],cut=timestamp(information_cutoff),asof=timestamp(as_of);
  if(cut===null||asof===null||cut>asof)errors.push("Invalid metric as-of/cutoff");
  if(config.methodology_version!=="market-risk-metrics-1.0.0"||config.capture_method!=="GEOMETRIC_SUBSET_DAILY_RATIO_V1"||config.quantile_method!=="LINEAR_TYPE7_V1"||typeof config.benchmark!=="string"||!config.benchmark.trim()||
    !Number.isInteger(config.rolling_window_observations)||config.rolling_window_observations<2||!Number.isInteger(config.minimum_observations)||config.minimum_observations<2||
    !Number.isFinite(config.drawdown_threshold)||config.drawdown_threshold>=0||config.drawdown_threshold<=-1||!Number.isFinite(config.tail_quantile)||config.tail_quantile<=0||config.tail_quantile>=1)errors.push("Invalid/version-unknown metric configuration");
  if(!Array.isArray(input))return {status:"INVALID_INPUT",metrics:[],configuration:config,errors:[...errors,"Return pairs array required"]};
  // Filter knowledge first; future return values are never validated, hashed or used.
  const rows:PairedReturn[]=[];
  for(const raw of input){const date=raw&&timestamp(raw.date);if(date===null||date===undefined){errors.push("Invalid observation date");continue;}
    if(cut!==null&&date<=cut)rows.push(structuredClone(raw));}
  rows.forEach((r,i)=>{if(![r.portfolio_return,r.market_return].every(Number.isFinite)||r.portfolio_return<=-1||r.market_return<=-1||i&&timestamp(rows[i-1].date)!>=timestamp(r.date)!)errors.push("Invalid/duplicate/unsorted eligible return pair");});
  if(errors.length)return {status:"INVALID_INPUT",metrics:[],configuration:config,errors};
  const ordered=rows.map(r=>r.market_return).sort((a,b)=>a-b),at=(ordered.length-1)*config.tail_quantile;
  const quantile=ordered.length?ordered[Math.floor(at)]+(at-Math.floor(at))*(ordered[Math.ceil(at)]-ordered[Math.floor(at)]):null;
  let wealth=1,high=1;const ddRows:PairedReturn[]=[];
  for(const r of rows){wealth*=1+r.market_return;high=Math.max(high,wealth);if(wealth/high-1<=config.drawdown_threshold)ddRows.push(r);}
  const sets:Array<[MarketRiskMetricName,PairedReturn[]]>=[["market_beta",rows],["rolling_market_beta",rows.slice(-config.rolling_window_observations)],
    ["upside_beta",rows.filter(r=>r.market_return>0)],["downside_beta",rows.filter(r=>r.market_return<0)],
    ["drawdown_beta",ddRows],["tail_beta",quantile===null?[]:rows.filter(r=>r.market_return<=quantile)],
    ["upside_capture",rows.filter(r=>r.market_return>0)],["downside_capture",rows.filter(r=>r.market_return<0)]];
  const provenance={data_hash:canonicalHash(rows),configuration_hash:canonicalHash(config),source_ids:["SYNTHETIC_OR_SUPPLIED_RETURN_PAIRS",config.benchmark],
    data_available_at:information_cutoff,model:{id:"market-risk-metrics",version:config.methodology_version}};
  const metrics=sets.map(([name,sample]):MarketRiskMetric=>{
    let value:number|null=null,status:MarketRiskMetric["status"]="VALID",reason:string|null=null;
    if(sample.length<config.minimum_observations||name==="rolling_market_beta"&&sample.length<config.rolling_window_observations){status="INSUFFICIENT_DATA";reason="Insufficient paired/conditioned observations";}
    else if(name.endsWith("capture")){
      const geometric=(key:"portfolio_return"|"market_return")=>Math.expm1(sample.reduce((s,r)=>s+Math.log1p(r[key]),0)/sample.length);
      const denominator=geometric("market_return");if(denominator===0){status="INSUFFICIENT_DATA";reason="Capture denominator zero";}else value=geometric("portfolio_return")/denominator;
    }else{
      // Translated sample covariance/variance; T-1 cancels in their ratio.
      const x=sample.map(r=>r.market_return-sample[0].market_return),y=sample.map(r=>r.portfolio_return-sample[0].portfolio_return),xm=x.reduce((s,v)=>s+v,0)/x.length,ym=y.reduce((s,v)=>s+v,0)/y.length;
      const variance=x.reduce((s,v)=>s+(v-xm)**2,0),cov=x.reduce((s,v,i)=>s+(v-xm)*(y[i]-ym),0);
      if(variance===0){status="INSUFFICIENT_DATA";reason="Market conditional variance zero";}else value=cov/variance;
    }
    if(value!==null&&!Number.isFinite(value)){value=null;status="NUMERICAL_FAILURE";reason="Nonfinite metric arithmetic";}
    return {name,units:name.endsWith("capture")?"CAPTURE_RATIO":"BETA",value,status,observations:sample.length,sample_start:sample[0]?.date??null,sample_end:sample.at(-1)?.date??null,
      methodology_version:config.methodology_version,as_of,information_cutoff,provenance:structuredClone(provenance),reason};
  });
  return {status:"VALID",metrics,configuration:config,errors:[]};
}
