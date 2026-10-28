import {canonicalHash,validateRiskSleeveAllocation} from '../validation';
import {CONTRACT_VERSION,LONG_ONLY,type RiskSleeveAllocationResult} from '../contracts';
import {dot,mv,eigen} from '../assets-engine/numerics';
import {VERSION,OBJECTIVES,type StrategyInput,type StrategyResult,type RiskDiagnostics,type Aggregation} from './contracts';
import {validateInput,selectSnapshot} from './validation';
import {solve,objectiveValue} from './solver';
/** Return risk and current-position risk are deliberately computed separately. */
export function riskDiagnostics(ids:string[],weights:Record<string,number>,cov:number[][],mu:Record<string,number>|null,maxIterations:number):RiskDiagnostics {
 const v=ids.map(id=>weights[id]),m=mv(cov,v),variance=dot(v,m),eig=eigen(cov,maxIterations);
 if(!eig.converged)throw Error('PCA eigendecomposition did not converge');
 const values=eig.values.map(z=>Math.max(0,z)),total=values.reduce((s,z)=>s+z,0),pca=values.map((z,j)=>z*dot(v,eig.vectors.map(row=>row[j]))**2),pv=pca.reduce((s,z)=>s+z,0);
 const entropy=(shares:number[])=>Math.exp(-shares.reduce((s,z)=>s+(z>0?z*Math.log(z):0),0));
 const correlations=cov.map((r,i)=>r.map((z,j)=>cov[i][i]>0&&cov[j][j]>0?z/Math.sqrt(cov[i][i]*cov[j][j]):null));
 const visited=new Set<number>(),clusters:string[][]=[];
 for(let i=0;i<ids.length;i++)if(!visited.has(i)){const todo=[i],component:string[]=[];visited.add(i);while(todo.length){const j=todo.pop()!;component.push(ids[j]);for(let k=0;k<ids.length;k++)if(!visited.has(k)&&correlations[j][k]!==null&&Math.abs(correlations[j][k]!)>=.9){visited.add(k);todo.push(k);}}clusters.push(component.sort());}
 const hhi=dot(v,v);
 return{variance,annualized_volatility:Math.sqrt(Math.max(0,252*variance)),expected_return:mu?dot(v,ids.map(id=>mu[id])):null,
 marginal:Object.fromEntries(ids.map((id,i)=>[id,m[i]])),contributions:Object.fromEntries(ids.map((id,i)=>[id,v[i]*m[i]])),normalized_shares:variance>0?Object.fromEntries(ids.map((id,i)=>[id,v[i]*m[i]/variance])):null,
 hhi,effective_allocations:hhi>0?1/hhi:0,covariance_effective_rank:total>0?entropy(values.map(z=>z/total)):null,pca_effective_risk_bets:pv>0?entropy(pca.map(z=>z/pv)):null,eigenvalues:eig.values,correlations,correlation_clusters:clusters,clustering_method:'ABS_CORRELATION_GE_0.90_CONNECTED_COMPONENTS_DIAGNOSTIC_ONLY'};
}
export function aggregate(x:StrategyInput,a:Record<string,number>):Aggregation{
 const streams=[...x.streams].sort((s,t)=>s.strategy_instance_id.localeCompare(t.strategy_instance_id)),assets=[...new Set(streams.flatMap(s=>Object.keys(s.unit_position_map.exposures)))].sort(),contributions:Aggregation['contributions']={},instruments:Aggregation['instruments']={},exposures:Record<string,number>={};
 for(const id of assets){contributions[id]=Object.fromEntries(streams.map(s=>[s.strategy_instance_id,(s.unit_position_map.exposures[id]??0)*a[s.strategy_instance_id]]));const values=Object.values(contributions[id]);exposures[id]=values.reduce((u,v)=>u+v,0);instruments[id]={gross_positive:values.reduce((u,v)=>u+Math.max(0,v),0),gross_negative_absolute:values.reduce((u,v)=>u+Math.max(0,-v),0),net:exposures[id],contributing_streams:streams.filter(s=>contributions[id][s.strategy_instance_id]!==0).map(s=>s.strategy_instance_id)};}
 const pre=streams.reduce((sum,s)=>sum+a[s.strategy_instance_id]*Object.values(s.unit_position_map.exposures).reduce((u,v)=>u+Math.abs(v),0),0),post=Object.values(exposures).reduce((s,v)=>s+Math.abs(v),0),hhi=post>0?Object.values(exposures).reduce((s,v)=>s+(Math.abs(v)/post)**2,0):null;
 const prev=x.previous_allocation,oldAssets=prev?Object.keys(prev.instrument_exposures):[];
 return{instrument_exposures:exposures,contributions,instruments,pre_net_gross:pre,post_net_gross:post,post_net_net:Object.values(exposures).reduce((s,v)=>s+v,0),netting_benefit:pre-post,internal_residual_capital:streams.reduce((s,t)=>s+a[t.strategy_instance_id]*t.unit_position_map.internal_residual_capital,0),nominal_strategy_count:streams.length,nominal_underlying_count:new Set(streams.flatMap(s=>s.underlying_ids)).size,absolute_normalized_asset_hhi:hhi,effective_asset_count:hhi!==null?1/hhi:null,
 strategy_turnover_l1:prev?streams.reduce((s,t)=>s+Math.abs(a[t.strategy_instance_id]-prev.allocations[t.strategy_instance_id]),0):null,
 instrument_turnover_l1:prev?[...new Set([...assets,...oldAssets])].reduce((s,id)=>s+Math.abs((exposures[id]??0)-(prev.instrument_exposures[id]??0)),0):null};
}
function projection(x:StrategyInput,r:StrategyResult):RiskSleeveAllocationResult {
 const b=x.asset_betas!,c=x.asset_covariance!,q=r.aggregation!.instrument_exposures,combined=canonicalHash({beta:b,asset_covariance:c}),provenance={data_hash:combined,configuration_hash:canonicalHash({projection:VERSION}),source_ids:[...new Set([...b.provenance.source_ids,...c.provenance.source_ids])].sort(),data_available_at:[b.provenance.data_available_at,c.provenance.data_available_at].sort().at(-1)!,model:{id:'EXPLICIT_STRATEGY_INSTRUMENT_PROJECTION',version:VERSION}},point={as_of:x.information_cutoff,information_cutoff:x.information_cutoff,provenance};
 const body:Omit<RiskSleeveAllocationResult,'allocation_id'>={schema_version:CONTRACT_VERSION,allocation_mode:'ASSETS',as_of:x.as_of,information_cutoff:x.information_cutoff,provenance,input_snapshot_id:'snapshot_'+r.input_hash!,status:'VALID',asset_weight_units:'fraction_of_risk_capital',asset_weights_risk_sleeve:q,gross_exposure:r.aggregation!.post_net_gross,net_exposure:r.aggregation!.post_net_net,estimated_market_beta:r.current_position_beta,estimated_volatility:r.implementation_risk!.annualized_volatility,asset_market_betas:b.values,
 beta_model:{benchmark:b.benchmark,estimation_window:b.window,estimator:'SUPPLIED_ASSET_BETAS_V1',as_of:x.information_cutoff,information_cutoff:x.information_cutoff,data_hash:combined},risk_model_provenance:point,risk_measurement_status:'AVAILABLE',explicit_unallocated_risk_budget:0,convention:structuredClone(LONG_ONLY),turnover_estimate:r.aggregation!.instrument_turnover_l1,mode_specific_details:{allocation_mode:'ASSETS',asset_decision_weights:q},warnings:['Explicit lossless instrument projection of ALPHA_STREAMS '+r.result_id+'; origin retains strategy identity, internal residual and distinct risk provenance; no beta scaling performed'],errors:[]};
 return{...body,allocation_id:'allocation_'+canonicalHash(body)};
}
export function allocateStrategies(value:unknown):StrategyResult{
 const errors=validateInput(value),x=value as StrategyInput,objective=x?.objective??{type:'EQUAL_CAPITAL'};
 const r:StrategyResult={schema_version:VERSION,allocation_mode:'ALPHA_STREAMS',terminology:'STRATEGY_INSTANCE_NOT_STATISTICAL_ALPHA',as_of:x?.as_of??null,information_cutoff:x?.information_cutoff??null,provenance:x?.provenance?structuredClone(x.provenance):null,allocation_units:'fraction_of_strategy_risk_capital',instrument_units:'instrument_exposure_per_unit_strategy_risk_capital',status:'INVALID_INPUT',errors,warnings:['StrategyStream/AlphaStream is a strategy instance, not a statistical alpha claim'],input_hash:null,result_id:null,objective,objective_version:OBJECTIVES[objective.type]??'UNKNOWN',allocations:null,objective_value:null,return_risk:null,aggregation:null,strategy_return_beta:null,current_position_beta:null,beta_provenance:{strategy:null,position:null},implementation_risk:null,controller_compatibility:'NOT_EVALUATED',controller_projection:null,controller_projection_status:'NOT_EVALUATED',incremental_cost:null,
 solver:{method:'AL03_EXHAUSTIVE_CONVEX_KKT_FACES_V1',iterations:0,faces:0,supports:0,converged:false,stationarity_residual:null,active_constraints:[],numerical_canonicalization_l1:0,tolerance:x?.solver?.feasibility_tolerance??0,max_iterations:x?.solver?.max_iterations??0}};
 if(errors.length){if(errors.every(e=>e.startsWith('NUMERICAL_FAILURE:')))r.status='NUMERICAL_FAILURE';return r;}
 const fail=(status:StrategyResult['status'],reason:string)=>{r.status=status;r.errors.push(reason);r.allocations=null;r.objective_value=null;r.return_risk=null;r.aggregation=null;r.strategy_return_beta=null;r.current_position_beta=null;r.implementation_risk=null;r.controller_projection=null;r.controller_compatibility='NOT_EVALUATED';r.controller_projection_status='NOT_EVALUATED';r.incremental_cost=null;r.solver.converged=false;return r;};
 r.input_hash=canonicalHash(x);
 if(['MEAN_VARIANCE','MAX_SHARPE'].includes(x.objective.type)&&x.expected_returns===null)return fail('INSUFFICIENT_DATA','BLOCKED_MISSING_PIT_MU_ALPHA');
 const solved=solve(x,r.solver);if(solved.status!=='VALID')return fail(solved.status,solved.reason!);
 const a=solved.weights!,ids=Object.keys(a).sort(),ix=ids.map(id=>x.risk_model.axis_ids.indexOf(id)),sym=x.risk_model.covariance.map((row,i)=>row.map((v,j)=>(v+x.risk_model.covariance[j][i])/2));
 if(sym.some((row,i)=>row.some((v,j)=>v!==x.risk_model.covariance[i][j])))r.warnings.push('Explicit within-tolerance covariance symmetric part; original hash retained, no eigenvalue lift');
 try{
 r.allocations=a;r.objective_value=objectiveValue(x,a);r.return_risk=riskDiagnostics(ids,a,ix.map(i=>ix.map(j=>sym[i][j])),x.expected_returns?.values??null,x.solver.max_iterations);r.aggregation=aggregate(x,a);
 if(!Number.isFinite(r.objective_value)||!Number.isFinite(r.return_risk.annualized_volatility)||r.return_risk.variance<0)return fail('NUMERICAL_FAILURE','Nonfinite allocation diagnostics');
 if(x.strategy_betas)r.strategy_return_beta=ids.reduce((s,id)=>s+a[id]*x.strategy_betas!.values[id],0);
 const assets=Object.keys(r.aggregation.instrument_exposures).sort(),xx=r.aggregation.instrument_exposures;
 if(x.asset_betas)r.current_position_beta=assets.reduce((s,id)=>s+xx[id]*x.asset_betas!.values[id],0);
 if(x.asset_covariance){const c=x.asset_covariance,index=assets.map(id=>c.axis_ids.indexOf(id)),sym=c.covariance.map((row,i)=>row.map((v,j)=>(v+c.covariance[j][i])/2));const d=riskDiagnostics(assets,xx,index.map(i=>index.map(j=>sym[i][j])),null,x.solver.max_iterations);const {hhi:unusedHhi,effective_allocations:unusedCount,expected_return:unusedMu,...positionRisk}=d;r.implementation_risk=positionRisk;if(sym.some((row,i)=>row.some((v,j)=>v!==c.covariance[i][j])))r.warnings.push('Explicit within-tolerance asset covariance symmetrization');}
 r.beta_provenance={strategy:structuredClone(x.strategy_betas),position:structuredClone(x.asset_betas)};
 const active=x.streams.filter(s=>a[s.strategy_instance_id]>0),compatible=Object.values(xx).every(v=>v>=0)&&Math.abs(r.aggregation.post_net_net-1)<=x.solver.feasibility_tolerance&&active.every(s=>s.unit_position_map.funding==='LONG_ONLY_FUNDED')&&r.aggregation.internal_residual_capital===0;
 r.controller_compatibility=compatible?'CONTROLLER_COMPATIBLE_LONG_ONLY_NET_ONE':'SIGNED_OR_NON_NET_ONE_EXPOSURE';
 r.controller_projection_status=compatible?'INSUFFICIENT_ASSET_RISK_ARTIFACTS':'BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE';
 if(x.incremental_cost)r.incremental_cost={amount:x.incremental_cost.trades.reduce((s,t)=>s+Math.abs(t.signed_notional)*x.incremental_cost!.bps/10000,0),embedded_internal_costs_recharged:false,basis:x.incremental_cost.basis,trade_count:x.incremental_cost.trades.length};
 if(r.implementation_risk&&r.implementation_risk.variance<0)return fail('NUMERICAL_FAILURE','Negative current-position variance; no zero-volatility substitution');
 r.status='VALID';r.result_id='strategy_'+canonicalHash({input_hash:r.input_hash,allocations:a,aggregation:r.aggregation,version:VERSION});
 if(compatible&&x.asset_betas&&x.asset_covariance){r.controller_projection=projection(x,r);const p=validateRiskSleeveAllocation(r.controller_projection);if(p.status!=='VALID'){r.controller_projection=null;return fail('NUMERICAL_FAILURE','Projection reconciliation: '+p.errors.join(';'));}r.controller_projection_status='AVAILABLE_UNSCALED_INSTRUMENT_PROJECTION';}
 if(r.solver.numerical_canonicalization_l1>0)r.warnings.push('Explicit bounded simplex roundoff correction '+r.solver.numerical_canonicalization_l1+' L1; no positive weights discarded');
 canonicalHash(r);return r;
 }catch(e){return fail('NUMERICAL_FAILURE',String(e));}
}
export function allocateAsOf(snapshots:StrategyInput[],date:string):StrategyResult {const x=selectSnapshot(snapshots,date);if(!x)throw Error('INSUFFICIENT_DATA: no available historical strategy bundle');return allocateStrategies(x);}
/** Pure attribution of supplied realized stream outcomes, not a generated history.
 * Underlying P&L cannot be inferred from a current H for dynamic/path-dependent strategies. */
export function attributeStrategyReturns(streams:StrategyInput['streams'],a:Record<string,number>,outcomes:Record<string,number>){
 const instance:Record<string,number>={},family:Record<string,number>={};for(const s of [...streams].sort((u,v)=>u.strategy_instance_id.localeCompare(v.strategy_instance_id))){const id=s.strategy_instance_id;if(!Number.isFinite(outcomes[id])||!Number.isFinite(a[id]))throw Error('Missing finite per-capital outcome/allocation');instance[id]=a[id]*outcomes[id];family[s.strategy_family_id]=(family[s.strategy_family_id]??0)+instance[id];}
 return{instance,family,portfolio_strategy_space_pnl_per_unit_capital:Object.values(instance).reduce((s,v)=>s+v,0),underlying_instrument_pnl:null,underlying_pnl_status:'NOT_IDENTIFIABLE_FROM_CURRENT_POSITION_MAP',methodology:'WEIGHTED_SUPPLIED_STREAM_OUTCOMES_V1'};
}
