/** SYNTHETIC certification artifacts, not financial forecasts or new strategies. */
import {canonicalHash} from '../validation';
import {DEFAULT_SOLVER} from '../assets-engine/contracts';
import {VERSION,type StrategyInput,type Objective,type BetaArtifact} from './contracts';
import {mapHash,riskHash,muHash,betaHash,assetRiskHash} from './validation';
export function fixture(cov:number[][]=[[.0001,0,0],[0,.0004,0],[0,0,.0009]],objective:Objective={type:'MIN_VARIANCE'},maps?:Array<Record<string,number>>,mu:number[]|null=null):StrategyInput {
 const n=cov.length,cut='2020-12-31',ids=cov.map((_,i)=>'STRATEGY_'+i),position=maps??cov.map((_,i)=>({['ETF_'+i]:1})),assets=[...new Set(position.flatMap(m=>Object.keys(m)))].sort(),provenance={data_hash:canonicalHash({label:'SYNTHETIC_AL05',cov,position}),configuration_hash:canonicalHash({fixture:true}),source_ids:['SYNTHETIC_AL05_KNOWN_ANSWER'],data_available_at:cut,model:{id:'SYNTHETIC_EXTERNAL_ARTIFACT',version:'1.0.0'}},point={as_of:cut,information_cutoff:cut,provenance};
 const beta=(axis:string[],method:BetaArtifact['beta_method'],values:number[]):BetaArtifact=>({...structuredClone(point),axis_ids:axis,values:Object.fromEntries(axis.map((id,i)=>[id,values[i]])),beta_method:method,benchmark:'SPY',window:{start:'2020-01-01',end:cut,observations:252},artifact_hash:''});
 const x:StrategyInput={schema_version:VERSION,allocation_mode:'ALPHA_STREAMS',convention:'NONNEGATIVE_FULLY_ALLOCATED_STRATEGY_CAPITAL',as_of:'2021-01-01',information_cutoff:cut,provenance,
 streams:ids.map((id,i)=>{const config={method:'SYNTHETIC_CONTROLLED_INSTANCE',index:i},net=Object.values(position[i]).reduce((s,v)=>s+v,0),long=Object.values(position[i]).every(v=>v>=0)&&net<=1;
  return{...structuredClone(point),kind:'STRATEGY_INSTANCE',strategy_instance_id:id,strategy_family_id:'FAMILY_'+(i%2),underlying_universe_id:'SYNTHETIC_UNIVERSE',underlying_ids:Object.keys(position[i]).sort(),strategy_version:'1.0.0',parameterization_hash:canonicalHash(config),configuration:config,separate_execution_sleeve_id:null,
   historical_series:{units:'NET_RETURN_PER_UNIT_CAPITAL',capital_basis:'BEGINNING_STREAM_CAPITAL',frequency:'DAILY',dates:['2020-12-30',cut],values:[.001*(i+1),-.002*(i+1)]},unit_position_map:{...structuredClone(point),units:'instrument_exposure_per_unit_allocated_stream_capital',exposures:position[i],internal_residual_capital:long?1-net:0,residual_semantics:'STREAM_HELD_NOT_EXTERNALLY_REDEPLOYABLE',funding:long?'LONG_ONLY_FUNDED':'SIGNED_OR_EXTERNAL_FINANCING',map_hash:''},forecast:null,
   execution_convention:{signal_timing:'STRICT_PRIOR_CLOSE',rebalance_timing:'DECLARED_SYNTHETIC_MONTHLY',execution_lag_sessions:1,internal_costs:'EMBEDDED_IN_NET_HISTORY',internal_cash_yield:'EMBEDDED_IN_NET_HISTORY',description:'SYNTHETIC_NOT_A_FINANCIAL_STRATEGY'},availability:{first_observation:'2020-12-30',version_available_at:cut}};}),
 risk_model:{...structuredClone(point),kind:'STRATEGY_RETURN_COVARIANCE',axis_ids:ids,series_units:'NET_RETURN_PER_UNIT_CAPITAL',capital_basis:'BEGINNING_STREAM_CAPITAL',frequency:'DAILY',covariance:cov,artifact_hash:''},
 expected_returns:mu?{...structuredClone(point),kind:'EXTERNAL_STRATEGY_EXPECTED_RETURN',axis_ids:ids,series_units:'NET_RETURN_PER_UNIT_CAPITAL',capital_basis:'BEGINNING_STREAM_CAPITAL',frequency:'DAILY',values:Object.fromEntries(ids.map((id,i)=>[id,mu[i]])),artifact_hash:''}:null,
 strategy_betas:beta(ids,'STRATEGY_RETURN_SAMPLE_COV_VARIANCE',ids.map((_,i)=>1.8-.2*i)),asset_betas:beta(assets,'CURRENT_POSITION_ASSET_BETA',assets.map((_,i)=>.8+.2*i)),asset_covariance:{...structuredClone(point),kind:'CURRENT_ASSET_RETURN_COVARIANCE',axis_ids:assets,covariance:assets.map((_,i)=>assets.map((_,j)=>i===j?.0002*(i+1)**2:0)),units:'daily_decimal_return_squared',artifact_hash:''},
 previous_allocation:null,strategy_constraints:{bounds:{},family_caps:[],underlying_group_caps:[],max_active_strategies:null,turnover_cap:null},implementation_constraints:{instrument_bounds:{},group_limits:[],max_gross:null,min_net:null,max_net:null},objective,solver:structuredClone(DEFAULT_SOLVER),incremental_cost:null};return rehash(x);
}
export function rehash(x:StrategyInput):StrategyInput{
 for(const s of x.streams)s.unit_position_map.map_hash=mapHash(s.unit_position_map);
 x.risk_model.artifact_hash=riskHash(x.risk_model);if(x.expected_returns)x.expected_returns.artifact_hash=muHash(x.expected_returns);if(x.strategy_betas)x.strategy_betas.artifact_hash=betaHash(x.strategy_betas);if(x.asset_betas)x.asset_betas.artifact_hash=betaHash(x.asset_betas);if(x.asset_covariance)x.asset_covariance.artifact_hash=assetRiskHash(x.asset_covariance);return x;
}
export function withPrevious(x:StrategyInput,a:number[],exposures:Record<string,number>):StrategyInput{x.previous_allocation={as_of:x.information_cutoff,information_cutoff:x.information_cutoff,provenance:structuredClone(x.provenance),units:'fraction_of_strategy_risk_capital',allocations:Object.fromEntries(x.streams.map((s,i)=>[s.strategy_instance_id,a[i]])),instrument_exposures:exposures};return x;}
export function certificationFixtures(){
 const out:Array<{id:string;label:'SYNTHETIC';input:StrategyInput}>=[],add=(id:string,input:StrategyInput)=>out.push({id,label:'SYNTHETIC',input});
 for(const objective of ['EQUAL_CAPITAL','MIN_VARIANCE','ERC','MEAN_VARIANCE','MAX_SHARPE'] as const)add(objective,fixture([[.0001,0,0],[0,.0004,0],[0,0,.0009]],objective==='MEAN_VARIANCE'?{type:objective,gamma:10}:objective==='MAX_SHARPE'?{type:objective,rf_stream:0}:{type:objective},undefined,['MEAN_VARIANCE','MAX_SHARPE'].includes(objective)?[.0003,.0005,.0004]:null));
 add('signed-opposing',fixture([[.0001,0],[0,.0004]],{type:'EQUAL_CAPITAL'},[{SPY:1},{SPY:-1}]));
 add('internal-residual',fixture([[.0001,0],[0,.0004]],{type:'EQUAL_CAPITAL'},[{SPY:.8},{SPY:.8}]));
 add('same-underlying-distinct-instance',fixture([[.0001,.00009],[.00009,.0001]],{type:'MIN_VARIANCE'},[{SPY:1},{SPY:1}]));
 const cap=fixture([[.0001,0,0],[0,.0001,0],[0,0,.0004]],{type:'MIN_VARIANCE'},[{SPY:1},{SPY:1},{TLT:1}]);cap.implementation_constraints.instrument_bounds={SPY:{max_absolute:.4,min_net:null,max_net:null}};add('post-map-shared-asset-cap',cap);
 const net=fixture([[.0001,0],[0,.0004]],{type:'MIN_VARIANCE'},[{SPY:1},{SPY:-1}]);net.implementation_constraints.max_net=.2;net.implementation_constraints.min_net=-.2;add('signed-net-band',net);
 const gross=fixture([[.0001,0],[0,.0004]],{type:'MIN_VARIANCE'},[{SPY:1,TLT:-1},{SPY:-1,TLT:1}]);gross.implementation_constraints.max_gross=.4;add('post-net-gross-cap',gross);
 const group=fixture();group.strategy_constraints.family_caps=[{id:'FAMILY_0',max:.5}];add('strategy-family-cap',group);
 const under=fixture([[.0001,0,0],[0,.0001,0],[0,0,.0004]],{type:'MIN_VARIANCE'},[{SPY:1},{SPY:1},{TLT:1}]);under.strategy_constraints.underlying_group_caps=[{id:'SPY_STRATEGIES',underlying_ids:['SPY'],max:.4}];add('underlying-strategy-group-cap',under);
 const sector=fixture();sector.implementation_constraints.group_limits=[{id:'ETF_GROUP',instruments:['ETF_0','ETF_1'],basis:'NET',min:0,max:.6}];add('post-map-sector-net-cap',sector);
 const cardinality=fixture();cardinality.strategy_constraints.max_active_strategies=2;add('max-active-two',cardinality);
 const turnover=withPrevious(fixture(),[1/3,1/3,1/3],{ETF_0:1/3,ETF_1:1/3,ETF_2:1/3});turnover.strategy_constraints.turnover_cap=.1;add('strategy-turnover-cap',turnover);
 const impossible=fixture();impossible.strategy_constraints.bounds={STRATEGY_0:{min:.7,max:1},STRATEGY_1:{min:.7,max:1}};add('impossible-bounds',impossible);
 add('missing-mu-mv',fixture(undefined,{type:'MEAN_VARIANCE',gamma:10}));add('missing-mu-sharpe',fixture(undefined,{type:'MAX_SHARPE',rf_stream:0}));
 const cost=withPrevious(fixture(),[1/3,1/3,1/3],{ETF_0:1/3,ETF_1:1/3,ETF_2:1/3});cost.incremental_cost={as_of:cost.information_cutoff,information_cutoff:cost.information_cutoff,provenance:structuredClone(cost.provenance),source:'NET',basis:'ACTUAL_INSTRUMENT_TRADE_NOTIONAL',units:'CAPITAL_CURRENCY',methodology:'ABS_NOTIONAL_TIMES_BPS_V1',embedded_in_stream_history:false,bps:5,trades:[{instrument_id:'ETF_0',trade_id:'BUY_1',signed_notional:200},{instrument_id:'ETF_1',trade_id:'SELL_1',signed_notional:-100}]};add('incremental-instrument-cost',cost);
 const nonpositive=fixture([[.0001,0],[0,.0004]],{type:'MAX_SHARPE',rf_stream:0},undefined,[-.001,-.001]);add('negative-excess-sharpe',nonpositive);
 const flat=fixture([[.0001,.0001],[.0001,.0001]],{type:'MIN_VARIANCE'},[{SPY:1},{SPY:1}]);add('perfectly-correlated-preserved',flat);
 return out;
}
