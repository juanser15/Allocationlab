/** Research adapter: risk fitting is external to allocateAssets, delegated unchanged to AL02. */
import {canonicalHash} from '../validation';
import {estimatePitSleeve,type ReturnVector} from '../risk-analytics/estimators';
import {ENGINE_VERSION,DEFAULT_SOLVER,type AssetsEngineInput,type Objective} from './contracts';
export function pitAssetsInput(rows:ReturnVector[],assets:string[],date:string,objective:Objective,previous:Record<string,number>|null=null):AssetsEngineInput {
 const ids=[...assets].sort(),estimate=estimatePitSleeve(rows,Object.fromEntries(ids.map(a=>[a,1/ids.length])),date);
 if(estimate.status!=='VALID')throw new Error('External AL02 risk estimation: '+estimate.status+' '+estimate.errors.join(';'));
 const positions=ids.map(a=>estimate.axes.indexOf(a)),cutoff=estimate.information_cutoff!,provenance={data_hash:estimate.data_hash,configuration_hash:estimate.configuration_hash,source_ids:['reports/cl02/adjusted-closes.csv','SPY'],data_available_at:cutoff,model:{id:estimate.model,version:estimate.version}},point={as_of:cutoff,information_cutoff:cutoff,provenance};
 const betas=Object.fromEntries(estimate.asset_betas.map(b=>[b.asset,b.beta]));
 return {schema_version:ENGINE_VERSION,convention:'LONG_ONLY_FULLY_INVESTED',assets:ids,as_of:date,information_cutoff:cutoff,provenance,
  risk_model:{...point,representation:'COVARIANCE',units:'daily_decimal_return_squared',axis_ids:ids,covariance:positions.map(i=>positions.map(j=>estimate.covariance![i][j]))},
  expected_returns:null,beta_estimates:{...point,values:betas,beta_model:{benchmark:'SPY',estimation_window:{start:estimate.window_start!,end:estimate.window_end!,observations:estimate.observations},estimator:'OLS_COV_VARIANCE_SAMPLE_V1',as_of:cutoff,information_cutoff:cutoff,data_hash:estimate.data_hash}},
  previous_holdings:previous?{...point,units:'fraction_of_risk_capital',asset_weights:previous}:null,
  constraints:{asset_bounds:{},group_caps:[],max_active_names:null,turnover_cap:null},objective,solver:structuredClone(DEFAULT_SOLVER)};
}
export function syntheticInput(covariance:number[][],objective:Objective,mu:number[]|null=null):AssetsEngineInput {
 covariance=covariance.map(row=>[...row]);
 const ids=covariance.map((_,i)=>'ASSET_'+i),cutoff='2020-12-31',provenance={data_hash:canonicalHash(covariance),configuration_hash:canonicalHash({synthetic:true}),source_ids:['SYNTHETIC_KNOWN_ANSWER'],data_available_at:cutoff,model:{id:'SYNTHETIC_SUPPLIED_ARTIFACT',version:'1.0.0'}},point={as_of:cutoff,information_cutoff:cutoff,provenance};
 return {schema_version:ENGINE_VERSION,convention:'LONG_ONLY_FULLY_INVESTED',assets:ids,as_of:'2021-01-01',information_cutoff:cutoff,provenance,
  risk_model:{...point,representation:'COVARIANCE',units:'daily_decimal_return_squared',axis_ids:ids,covariance},expected_returns:mu?{...point,units:'daily_decimal_return',values:Object.fromEntries(ids.map((a,i)=>[a,mu[i]]))}:null,
  beta_estimates:{...point,values:Object.fromEntries(ids.map((a,i)=>[a,.8+i*.2])),beta_model:{benchmark:'SPY',estimation_window:{start:'2020-01-01',end:cutoff,observations:252},estimator:'SUPPLIED_ASSET_BETAS_V1',as_of:cutoff,information_cutoff:cutoff,data_hash:provenance.data_hash}},previous_holdings:null,constraints:{asset_bounds:{},group_caps:[],max_active_names:null,turnover_cap:null},objective,solver:structuredClone(DEFAULT_SOLVER)};
}
