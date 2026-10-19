/** Explicit synthetic artifacts. No signal conversion, fitting or historical forecast generation. */
import {canonicalHash} from '../validation';
import {FACTOR_ENGINE_VERSION,DEFAULT_FACTOR_SOLVER,type FactorsInput,type Implementation} from './contracts';
import {loadingHash,riskHash,trackingHash} from './validation';
export function fixture(B:number[][],target:number[],specific:number[],implementation:Implementation={mode:'EXACT_FACTOR_TARGET',secondary:'SPECIFIC_VARIANCE'},phi?:number[][]):FactorsInput {
 const assets=specific.map((_,i)=>'ASSET_'+i),factors=target.map((_,i)=>'FACTOR_'+i),cutoff='2020-12-31',provenance={data_hash:canonicalHash({label:'SYNTHETIC_SUPPLIED_FACTOR_ARTIFACT',B,target,specific,phi:phi??null}),configuration_hash:canonicalHash({synthetic:true}),source_ids:['SYNTHETIC_AL04_KNOWN_ANSWER'],data_available_at:cutoff,model:{id:'SYNTHETIC_FACTOR_MODEL',version:'1.0.0'}},point={as_of:cutoff,information_cutoff:cutoff,provenance},units=Object.fromEntries(factors.map(f=>[f,'DIMENSIONLESS']));
 const x:FactorsInput={schema_version:FACTOR_ENGINE_VERSION,allocation_mode:'FACTORS',convention:'LONG_ONLY_FULLY_INVESTED',assets,as_of:'2021-01-01',information_cutoff:cutoff,provenance,
 target:{...structuredClone(point),kind:'FACTOR_EXPOSURE_TARGET',target_id:'SYNTHETIC_DECLARED_TARGET',target_version:'1.0.0',factor_ids:factors,units:'factor_exposure',factor_units:units,target_exposures:Object.fromEntries(factors.map((f,i)=>[f,target[i]]))},
 loadings:{...structuredClone(point),kind:'FACTOR_LOADING_MATRIX',orientation:'FACTORS_BY_ASSETS',factor_ids:factors,asset_ids:assets,units:'factor_exposure_per_unit_risk_weight',factor_units:units,factor_kinds:Object.fromEntries(factors.map(f=>[f,'ECONOMIC_FACTOR' as const])),loadings:B.map(r=>[...r]),model_id:'SYNTHETIC_FACTOR_MODEL',model_version:'1.0.0',matrix_hash:''},
 risk_model:{...structuredClone(point),kind:'FACTOR_RISK_MODEL',factor_ids:factors,asset_ids:assets,factor_units:units,factor_return_units:Object.fromEntries(factors.map(f=>[f,'DAILY_DECIMAL_RETURN'])),covariance_units:'factor_return_covariance_in_declared_units',phi:phi?phi.map(r=>[...r]):factors.map((_,i)=>factors.map((_,j)=>i===j?.0004:0)),specific_risk:{representation:'DIAGONAL_VARIANCES',units:'daily_decimal_return_squared',values:[...specific]},model_id:'SYNTHETIC_FACTOR_MODEL',model_version:'1.0.0',model_hash:''},
 tracking_metric:{...structuredClone(point),factor_ids:factors,units:'inverse_factor_exposure_squared',weights:factors.map((_,i)=>factors.map((_,j)=>i===j?1:0)),metric_id:'SYNTHETIC_TRACKING_METRIC',metric_version:'1.0.0',metric_hash:''},
 beta_estimates:{...structuredClone(point),values:Object.fromEntries(assets.map((a,i)=>[a,.8+.2*i])),beta_model:{benchmark:'SPY',estimation_window:{start:'2020-01-01',end:cutoff,observations:252},estimator:'SUPPLIED_ASSET_BETAS_V1',as_of:cutoff,information_cutoff:cutoff,data_hash:provenance.data_hash}},previous_holdings:null,constraints:{asset_bounds:{},group_caps:[],max_active_names:null,turnover_cap:null},implementation,solver:structuredClone(DEFAULT_FACTOR_SOLVER)};
 return rehash(x);
}
export function rehash(x:FactorsInput):FactorsInput {x.loadings.matrix_hash=loadingHash(x.loadings);x.risk_model.model_hash=riskHash(x.risk_model);x.tracking_metric.metric_hash=trackingHash(x.tracking_metric);return x;}
export function withPrevious(x:FactorsInput,weights:number[]):FactorsInput {
 x.previous_holdings={as_of:x.information_cutoff,information_cutoff:x.information_cutoff,provenance:structuredClone(x.provenance),units:'fraction_of_risk_capital',asset_weights:Object.fromEntries(x.assets.map((a,i)=>[a,weights[i]]))};return x;
}
export function certificationFixtures():Array<{id:string;label:'SYNTHETIC';input:FactorsInput}> {
 const rows:Array<{id:string;label:'SYNTHETIC';input:FactorsInput}>=[],add=(id:string,input:FactorsInput)=>rows.push({id,label:'SYNTHETIC',input});
 add('square-exact',fixture([[2,0],[0,-1]],[.5,-.75],[.0001,.0004]));
 add('underdetermined-specific',fixture([[1,1,0]],[.6],[.0001,.0004,.0002]));
 add('underdetermined-total',fixture([[1,1,0]],[.6],[.0001,.0004,.0002],{mode:'EXACT_FACTOR_TARGET',secondary:'TOTAL_VARIANCE'}));
 add('underdetermined-turnover',withPrevious(fixture([[1,1,0]],[.6],[.0001,.0004,.0002],{mode:'EXACT_FACTOR_TARGET',secondary:'TURNOVER'}),[.48,.12,.4]));
 add('impossible-exact',fixture([[1,0]],[1.5],[.0001,.0004]));
 add('explicit-approximate',fixture([[1,0]],[1.5],[.0001,.0004],{mode:'MIN_FACTOR_TRACKING_ERROR',secondary:null,secondary_rule:'EXACT_LEXICOGRAPHIC_ARGMIN'}));
 add('approximate-lexicographic',fixture([[1,0,0]],[.4],[1,.0001,.0004],{mode:'MIN_FACTOR_TRACKING_ERROR',secondary:'TOTAL_VARIANCE',secondary_rule:'EXACT_LEXICOGRAPHIC_ARGMIN'}));
 const singular=fixture([[1,0,0],[0,1,0]],[.4,.9],[.0001,.0001,.0004],{mode:'MIN_FACTOR_TRACKING_ERROR',secondary:'SPECIFIC_VARIANCE',secondary_rule:'EXACT_LEXICOGRAPHIC_ARGMIN'});singular.tracking_metric.weights=[[1,0],[0,0]];add('singular-W-explicit-unpenalized-factor',rehash(singular));
 add('negative-risk-contribution',fixture([[1,1],[-.5,-.5]],[1,-.5],[.0001,.0004],{mode:'EXACT_FACTOR_TARGET',secondary:'SPECIFIC_VARIANCE'},[[.0004,.0003],[.0003,.0004]]));
 add('rank-deficient-B-no-inverse',fixture([[1,1],[2,2]],[1,2],[.0001,.0004]));
 add('overdetermined-inconsistent',fixture([[1,0],[0,1],[1,1]],[.2,.8,1.2],[.0001,.0004]));
 const cap=fixture([[1,1,0]],[.6],[.0001,.0004,.0002]);cap.constraints.asset_bounds={ASSET_0:{min:0,max:.3}};add('asset-bound-active',cap);
 const group=fixture([[1,1,0]],[.6],[.0001,.0004,.0002]);group.constraints.group_caps=[{id:'FIRST',assets:['ASSET_0'],max:.3}];add('group-cap-active',group);
 const card=fixture([[1,1,0]],[.6],[.0001,.0004,.0002]);card.constraints.max_active_names=2;add('cardinality-two',card);
 const turn=withPrevious(fixture([[1,1,0]],[.6],[.0001,.0004,.0002]),[.3,.3,.4]);turn.constraints.turnover_cap=.1;add('turnover-cap-active',turn);
 const zero=fixture([[1,1]],[1],[.0001,.0004]);zero.risk_model.specific_risk={representation:'ZERO_SPECIFIC_RISK',units:'daily_decimal_return_squared'};add('explicit-zero-specific',rehash(zero));
 const full=fixture([[1,1,0]],[.6],[.0001,.0004,.0002]);full.risk_model.specific_risk={representation:'FULL_COVARIANCE',units:'daily_decimal_return_squared',values:[[.0001,.00002,0],[.00002,.0004,0],[0,0,.0002]]};add('full-specific-covariance',rehash(full));
 const unequal=fixture([[1,0,0],[0,1,0]],[.9,.9],[.0001,.0002,.0004],{mode:'MIN_FACTOR_TRACKING_ERROR',secondary:null,secondary_rule:'EXACT_LEXICOGRAPHIC_ARGMIN'});unequal.tracking_metric.weights=[[4,0],[0,1]];add('unequal-W-tracking',rehash(unequal));
 const statistical=fixture([[.01,.02]],[.015],[.0001,.0004],{mode:'EXACT_FACTOR_TARGET',secondary:'SPECIFIC_VARIANCE'},[[2]]);
 statistical.target.factor_units={FACTOR_0:'DAILY_RETURN_LOADING'};statistical.loadings.factor_units={FACTOR_0:'DAILY_RETURN_LOADING'};statistical.risk_model.factor_units={FACTOR_0:'DAILY_RETURN_LOADING'};statistical.loadings.factor_kinds={FACTOR_0:'STATISTICAL_FACTOR'};statistical.risk_model.factor_return_units={FACTOR_0:'STANDARDIZED_DAILY_SHOCK'};add('statistical-standardized-shock-units',rehash(statistical));
 const asymmetric=fixture([[1,1]],[1],[.0001,.0004]);asymmetric.risk_model.specific_risk={representation:'FULL_COVARIANCE',units:'daily_decimal_return_squared',values:[[.0001,.00001+5e-13],[.00001,.0004]]};add('within-tolerance-symmetric-specific-model',rehash(asymmetric));
 return rows;
}
