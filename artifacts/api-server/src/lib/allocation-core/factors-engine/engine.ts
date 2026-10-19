import {canonicalHash,validateRiskSleeveAllocation,timestamp} from '../validation';
import {CONTRACT_VERSION,LONG_ONLY,type AllocationStatus,type RiskSleeveAllocationResult} from '../contracts';
import {portfolioDiagnostics} from '../assets-engine/engine';
import {ENGINE_VERSION,type AssetsEngineInput} from '../assets-engine/contracts';
import {dot,mv,quadratic,eigen,combinations,choose} from '../assets-engine/numerics';
import type {Halfspace} from '../assets-engine/solver';
import {FACTOR_ENGINE_VERSION,type FactorsInput,type FactorImplementationResult,type FactorDiagnostics,type Secondary} from './contracts';
import {validateFactors,matrices} from './validation';
import {multiEqualityQp,type Equality,type MultiResult} from './solver';
export interface FactorResponse {status:AllocationStatus;result:FactorImplementationResult|null;errors:string[];}

function inequalities(x:FactorsInput,assets:string[]):Halfspace[] {
 const c:Halfspace[]=[];assets.forEach((a,i)=>{const b=x.constraints.asset_bounds[a]??{min:0,max:1},v=assets.map((_,j)=>i===j?1:0);c.push({a:v,b:b.min,name:a+':min'},{a:v.map(z=>-z),b:-b.max,name:a+':max'});});
 for(const g of [...x.constraints.group_caps].sort((a,b)=>a.id.localeCompare(b.id)))c.push({a:assets.map(a=>g.assets.includes(a)?-1:0),b:-g.max,name:'group:'+g.id});
 if(x.constraints.turnover_cap!==null)for(let mask=0;mask<2**assets.length;mask++){const s=assets.map((_,i)=>(mask>>i)&1?1:-1);c.push({a:s.map(z=>-z),b:-x.constraints.turnover_cap-dot(s,assets.map(a=>x.previous_holdings!.asset_weights[a])),name:'turnover_cap:'+mask});}
 return c;
}
function secondarySolve(x:FactorsInput,assets:string[],criterion:Secondary,D:number[][],Sigma:number[][],eq:Equality[],c:Halfspace[]):MultiResult {
 const n=assets.length;
 if(criterion!=='TURNOVER')return multiEqualityQp((criterion==='SPECIFIC_VARIANCE'?D:Sigma).map(r=>r.map(v=>2*v)),assets.map(()=>0),eq,c,x.solver);
 const H=Array.from({length:n+1},()=>Array(n+1).fill(0)),f=[...assets.map(()=>0),1],constraints=c.map(z=>({...z,a:[...z.a,0]})),equalities=eq.map(z=>({...z,a:[...z.a,0]}));
 for(let mask=0;mask<2**n;mask++){const s=assets.map((_,i)=>(mask>>i)&1?1:-1);constraints.push({a:[...s.map(z=>-z),1],b:-dot(s,assets.map(a=>x.previous_holdings!.asset_weights[a])),name:'turnover_epigraph:'+mask});}
 constraints.push({a:[...assets.map(()=>0),1],b:0,name:'turnover_nonnegative'},{a:[...assets.map(()=>0),-1],b:-2,name:'turnover_simplex_upper_bound'});
 const r=multiEqualityQp(H,f,equalities,constraints,x.solver);return{...r,x:r.x?.slice(0,n)??null};
}
function diagnostics(x:FactorsInput,q:Record<string,number>):FactorDiagnostics {
 const {assets,factors,B,P,D,W,Sigma,target}=matrices(x),v=assets.map(a=>q[a]),e=mv(B,v),res=e.map((z,i)=>z-target[i]),Pe=mv(P,e),rc=e.map((z,i)=>z*Pe[i]),systematic=dot(e,Pe),specific=quadratic(D,v),total=systematic+specific;
 const byFactor=(values:number[])=>Object.fromEntries(factors.map((f,i)=>[f,values[i]]));
 const ev=eigen(P,x.solver.max_iterations).values,nonnegative=ev.map(z=>Math.max(0,z)),trace=nonnegative.reduce((s,z)=>s+z,0),shares=systematic>0?rc.map(z=>z/systematic):null,prob=shares&&shares.every(z=>z>=0)?shares:null;
 const entropy=(p:number[])=>Math.exp(-p.reduce((s,z)=>s+(z>0?z*Math.log(z):0),0));
 const point={as_of:x.information_cutoff,information_cutoff:x.information_cutoff,provenance:{...x.risk_model.provenance,data_hash:canonicalHash({loadings:x.loadings.matrix_hash,risk:x.risk_model.model_hash}),model:{id:'FACTOR_IMPLIED_ASSET_COVARIANCE',version:'1.0.0'}}};
 const ai:AssetsEngineInput={schema_version:ENGINE_VERSION,convention:'LONG_ONLY_FULLY_INVESTED',assets,as_of:x.as_of,information_cutoff:x.information_cutoff,provenance:x.provenance,risk_model:{...point,representation:'COVARIANCE',units:'daily_decimal_return_squared',axis_ids:assets,covariance:Sigma},expected_returns:null,beta_estimates:x.beta_estimates,previous_holdings:x.previous_holdings,constraints:x.constraints,objective:{type:'EQUAL_WEIGHT'},solver:x.solver};
 return {target_factor_exposures:byFactor(target),achieved_factor_exposures:byFactor(e),residual:byFactor(res),absolute_residual:byFactor(res.map(Math.abs)),l2_residual:Math.hypot(...res),weighted_residual_objective:quadratic(W,res),maximum_absolute_miss:Math.max(...res.map(Math.abs)),exact_within_declared_tolerance:res.every(z=>Math.abs(z)<=x.solver.factor_tolerance),
 systematic_variance:systematic,specific_variance:specific,total_variance:total,asset_covariance_variance:quadratic(Sigma,v),annualized_volatility:Math.sqrt(Math.max(0,252*total)),factor_marginal_contributions:byFactor(Pe),factor_risk_contributions:byFactor(rc),factor_risk_shares:shares?byFactor(shares):null,specific_risk_share:total>0?specific/total:null,
 factor_dimensions:factors.length,factor_covariance_effective_rank:trace>0?entropy(nonnegative.map(z=>z/trace)):null,dominant_factor_eigenvalue_share:trace>0?Math.max(...nonnegative)/trace:null,systematic_risk_concentration:prob?dot(prob,prob):null,systematic_factor_entropy_bets:prob?entropy(prob):null,entropy_reason:prob?null:systematic<=0?'ZERO_SYSTEMATIC_VARIANCE':'SIGNED_FACTOR_CONTRIBUTIONS',factor_eigenvalues:ev,asset_diagnostics:portfolioDiagnostics(q,ai)};
}
/** Research-only lossless instrument projection; no B2/D1 adapter or allocation re-optimization. */
function controllerProjection(x:FactorsInput,r:FactorImplementationResult):RiskSleeveAllocationResult {
 const q=r.asset_weights_risk_sleeve!,d=r.diagnostics!,body:Omit<RiskSleeveAllocationResult,'allocation_id'>={schema_version:CONTRACT_VERSION,allocation_mode:'ASSETS',as_of:x.as_of,information_cutoff:x.information_cutoff,
 provenance:{...r.provenance,source_ids:[...new Set([...r.provenance.source_ids,'FACTOR_ORIGIN:'+r.result_id])].sort()},input_snapshot_id:'snapshot_'+r.input_hash,status:'VALID',asset_weight_units:'fraction_of_risk_capital',asset_weights_risk_sleeve:structuredClone(q),gross_exposure:r.gross_exposure,net_exposure:r.net_exposure,estimated_market_beta:r.estimated_market_beta,estimated_volatility:r.estimated_volatility,asset_market_betas:structuredClone(x.beta_estimates.values),beta_model:structuredClone(x.beta_estimates.beta_model),
 // Frozen AL01 risk estimate provenance is bound to beta_model.data_hash. Full factor-volatility provenance stays in r.
 risk_model_provenance:{as_of:x.beta_estimates.as_of,information_cutoff:x.beta_estimates.information_cutoff,provenance:structuredClone(x.beta_estimates.provenance)},risk_measurement_status:'AVAILABLE',explicit_unallocated_risk_budget:0,convention:structuredClone(LONG_ONLY),turnover_estimate:d.asset_diagnostics.turnover_gross_l1,mode_specific_details:{allocation_mode:'ASSETS',asset_decision_weights:structuredClone(q)},
 warnings:['Explicit instrument projection from FACTORS '+r.result_id+'; factor method/risk provenance retained in origin result; no scoring conversion'],errors:[]};
 return{...body,allocation_id:'allocation_'+canonicalHash(body)};
}
export function implementFactors(value:unknown):FactorResponse {
 const errors=validateFactors(value);if(errors.length)return{status:'INVALID_INPUT',result:null,errors};
 const x=structuredClone(value) as FactorsInput,{assets,factors,B,D,W,rawP,rawD,rawW,Sigma,target}=matrices(x),n=assets.length;
 const canonical={...x,assets,target:{...x.target,factor_ids:factors},loadings:{...x.loadings,factor_ids:factors,asset_ids:assets,loadings:B},risk_model:{...x.risk_model,factor_ids:factors,asset_ids:assets,phi:rawP,specific_risk:x.risk_model.specific_risk.representation==='ZERO_SPECIFIC_RISK'?x.risk_model.specific_risk:x.risk_model.specific_risk.representation==='DIAGONAL_VARIANCES'?{...x.risk_model.specific_risk,values:rawD.map((r,i)=>r[i])}:{...x.risk_model.specific_risk,values:rawD}},tracking_metric:{...x.tracking_metric,factor_ids:factors,weights:rawW}};
 const sources=[x,x.target,x.loadings,x.risk_model,x.tracking_metric,x.beta_estimates],point=(p:typeof x.target)=>({as_of:p.as_of,information_cutoff:p.information_cutoff,provenance:structuredClone(p.provenance)});
 const r:FactorImplementationResult={schema_version:FACTOR_ENGINE_VERSION,allocation_mode:'FACTORS',as_of:x.as_of,information_cutoff:x.information_cutoff,
 provenance:{data_hash:canonicalHash({target:x.target.provenance,loadings:x.loadings.matrix_hash,risk:x.risk_model.model_hash,tracking:x.tracking_metric.metric_hash,beta:x.beta_estimates.provenance}),configuration_hash:canonicalHash({implementation:x.implementation,constraints:x.constraints,solver:x.solver}),source_ids:[...new Set(sources.flatMap(s=>s.provenance.source_ids))].sort(),data_available_at:sources.map(s=>s.provenance.data_available_at).sort((a,b)=>timestamp(a)!-timestamp(b)!).at(-1)!,model:{id:'FactorImplementationEngine',version:FACTOR_ENGINE_VERSION}},result_id:null,input_hash:canonicalHash(canonical),status:'INFEASIBLE',asset_weight_units:'fraction_of_risk_capital',asset_weights_risk_sleeve:null,gross_exposure:null,net_exposure:null,estimated_market_beta:null,estimated_volatility:null,
 asset_market_betas:structuredClone(x.beta_estimates.values),beta_model:structuredClone(x.beta_estimates.beta_model),
 mapping_provenance:{as_of:x.loadings.as_of,information_cutoff:x.loadings.information_cutoff,provenance:structuredClone(x.loadings.provenance),model_id:x.loadings.model_id,model_version:x.loadings.model_version,matrix_hash:x.loadings.matrix_hash,orientation:x.loadings.orientation},
 factor_risk_model_reference:{as_of:x.risk_model.as_of,information_cutoff:x.risk_model.information_cutoff,provenance:structuredClone(x.risk_model.provenance),model_id:x.risk_model.model_id,model_version:x.risk_model.model_version,model_hash:x.risk_model.model_hash,specific_representation:x.risk_model.specific_risk.representation},
 target_reference:{...point(x.target),target_id:x.target.target_id,target_version:x.target.target_version,factor_units:structuredClone(x.target.factor_units)},
 tracking_metric_reference:{as_of:x.tracking_metric.as_of,information_cutoff:x.tracking_metric.information_cutoff,provenance:structuredClone(x.tracking_metric.provenance),metric_id:x.tracking_metric.metric_id,metric_version:x.tracking_metric.metric_version,metric_hash:x.tracking_metric.metric_hash},
 implementation:x.implementation,secondary_value:null,diagnostics:null,controller_projection:null,
 solver:{method:'CONSTRAINED_MULTI_EQUALITY_KKT_FACES_V1',faces_examined:0,supports_examined:0,equality_rank:null,stationarity_residual:null,converged:false,numerical_canonicalization:null},warnings:[],errors:[]};
 const response=():FactorResponse=>({status:r.status,result:r,errors:r.errors}),fail=(status:AllocationStatus,reason:string)=>{r.status=status;r.errors.push(reason);return response();};
 for(const[name,m]of [['Phi',rawP],['D',rawD],['W',rawW]] as const)if(m.some((row,i)=>row.some((v,j)=>v!==m[j][i])))r.warnings.push('Explicit within-tolerance symmetric part used for '+name+'; raw content hashes/provenance preserved');
 if(!Sigma.flat().every(Number.isFinite))return fail('NUMERICAL_FAILURE','Implied asset covariance overflow/nonfinite');
 for(const a of assets){const b=x.constraints.asset_bounds[a]??{min:0,max:1};if(b.min>b.max)return fail('INFEASIBLE','Asset lower bound exceeds upper bound');}
 const K=x.constraints.max_active_names??n;
 if(choose(n,K)>x.solver.max_supports||(x.constraints.turnover_cap!==null||x.implementation.secondary==='TURNOVER')&&2**n>x.solver.max_faces)return fail('NUMERICAL_FAILURE','Explicit support/turnover sign workload limit exceeded');
 const c=inequalities(x,assets),base:Equality[]=[{a:assets.map(()=>1),b:1,name:'sleeve_simplex',tolerance:x.solver.feasibility_tolerance}],WB=factors.map((_,i)=>assets.map((_,j)=>factors.reduce((s,_,k)=>s+W[i][k]*B[k][j],0))),H=assets.map((_,i)=>assets.map((_,j)=>2*factors.reduce((s,_,k)=>s+B[k][i]*WB[k][j],0))),f=assets.map((_,j)=>-2*factors.reduce((s,_,k)=>s+WB[k][j]*target[k],0));
 if(![...H.flat(),...f].every(Number.isFinite))return fail('NUMERICAL_FAILURE','Tracking arithmetic overflow');
 const candidates:Array<{q:number[];tracking:number;secondary:number|null;solver:MultiResult;canonicalization:FactorImplementationResult['solver']['numerical_canonicalization']}>=[];let numerical=false,lastReason='No feasible factor implementation';
 for(const support of combinations(n,K)){r.solver.supports_examined++;
  const eq=[...base,...assets.flatMap((_,i)=>support.includes(i)?[]:[{a:assets.map((_,j)=>i===j?1:0),b:0,name:'support:'+assets[i],tolerance:x.solver.feasibility_tolerance}])];
  let primary:MultiResult,final:MultiResult;
  if(x.implementation.mode==='EXACT_FACTOR_TARGET') {eq.push(...factors.map((f,i)=>({a:B[i],b:target[i],name:'factor:'+f,tolerance:x.solver.factor_tolerance})));primary=secondarySolve(x,assets,x.implementation.secondary,D,Sigma,eq,c);final=primary;}
  else {primary=multiEqualityQp(H,f,eq,c,x.solver);final=primary;
   if(primary.status==='VALID'&&x.implementation.secondary!==null){const locks=WB.map((a,i)=>({a,b:dot(a,primary.x!),name:'tracking_argmin:'+i,tolerance:x.solver.factor_tolerance}));final=secondarySolve(x,assets,x.implementation.secondary,D,Sigma,[...eq,...locks],c);r.solver.faces_examined+=primary.faces;}}
  r.solver.faces_examined+=final.faces;
  if(final.status!=='VALID'){numerical ||= final.status==='NUMERICAL_FAILURE';lastReason=final.reason!;continue;}
  // Only numerical negatives and explicitly excluded support coordinates are zeroed.
  // No small positive active weight is discarded; simplex correction is additive, never scaling.
  const original=final.x!,q=original.map((v,i)=>!support.includes(i)||v<0&&v>=-x.solver.feasibility_tolerance?0:v),sum=q.reduce((s,v)=>s+v,0),largest=q.indexOf(Math.max(...q));q[largest]+=1-sum;
  const adjustment=Math.max(...q.map((v,i)=>Math.abs(v-original[i]))),canonicalization=adjustment?{original_weights:[...original],applied_weights:[...q],maximum_adjustment:adjustment}:null;
  const stationarityBound=(final.residual??0)+n*adjustment;
  if(adjustment>x.solver.feasibility_tolerance||stationarityBound>x.solver.stationarity_tolerance||q.some(v=>v<0)||!eq.every(e=>Math.abs(dot(e.a,q)-e.b)<=e.tolerance)||c.some(c=>dot(c.a,q)<c.b-x.solver.feasibility_tolerance)){numerical=true;lastReason='Numerical sleeve canonicalization exceeds declared primal/stationarity tolerance';continue;}
  const res=mv(B,q).map((z,i)=>z-target[i]),tracking=quadratic(W,res),secondary=x.implementation.secondary==='SPECIFIC_VARIANCE'?quadratic(D,q):x.implementation.secondary==='TOTAL_VARIANCE'?quadratic(Sigma,q):x.implementation.secondary==='TURNOVER'?assets.reduce((s,a,i)=>s+Math.abs(q[i]-x.previous_holdings!.asset_weights[a]),0):null;
  if(!Number.isFinite(tracking)||secondary!==null&&!Number.isFinite(secondary)){numerical=true;lastReason='Nonfinite solved objective';continue;}
  if(x.implementation.mode==='MIN_FACTOR_TRACKING_ERROR'&&Math.abs(tracking-quadratic(W,mv(B,primary.x!).map((z,i)=>z-target[i])))>x.solver.tracking_tie_tolerance){numerical=true;lastReason='Secondary optimization changed primary tracking objective beyond declared tolerance';continue;}
  candidates.push({q,tracking,secondary,solver:{...final,residual:stationarityBound},canonicalization});
 }
 if(!candidates.length)return fail(numerical?'NUMERICAL_FAILURE':'INFEASIBLE',lastReason);
 // A skipped numerically failed support might dominate; never claim a global certified result.
 if(numerical)return fail('NUMERICAL_FAILURE','At least one support could not be certified; no partial winner: '+lastReason);
 const minimum=x.implementation.mode==='MIN_FACTOR_TRACKING_ERROR'?Math.min(...candidates.map(c=>c.tracking)):0;
 const admissible=x.implementation.mode==='MIN_FACTOR_TRACKING_ERROR'?candidates.filter(c=>c.tracking<=minimum+x.solver.tracking_tie_tolerance):candidates;
 admissible.sort((a,b)=>{if(a.secondary!==null&&b.secondary!==null&&Math.abs(a.secondary-b.secondary)>x.solver.secondary_tie_tolerance)return a.secondary-b.secondary;for(let i=0;i<n;i++)if(a.q[i]!==b.q[i])return a.q[i]-b.q[i];return 0;});
 const best=admissible[0],weights=Object.fromEntries(assets.map((a,i)=>[a,best.q[i]]));
 if(Math.abs(best.q.reduce((s,v)=>s+v,0)-1)>x.solver.feasibility_tolerance||c.some(c=>dot(c.a,best.q)<c.b-x.solver.feasibility_tolerance))return fail('NUMERICAL_FAILURE','Final sleeve primal reconciliation failed');
 const d=diagnostics(x,weights);
 if(x.implementation.mode==='EXACT_FACTOR_TARGET'&&!d.exact_within_declared_tolerance)return fail('NUMERICAL_FAILURE','Exact result exceeds declared maximum factor miss');
 if(![d.systematic_variance,d.specific_variance,d.total_variance,d.asset_covariance_variance,d.annualized_volatility,d.asset_diagnostics.beta_sleeve].every(Number.isFinite)||Math.abs(d.total_variance-d.asset_covariance_variance)>x.solver.psd_tolerance||d.total_variance<-x.solver.psd_tolerance)return fail('NUMERICAL_FAILURE','Factor/specific/implied asset risk did not reconcile');
 r.status='VALID';r.asset_weights_risk_sleeve=weights;r.gross_exposure=d.asset_diagnostics.gross_exposure;r.net_exposure=d.asset_diagnostics.net_exposure;r.estimated_market_beta=d.asset_diagnostics.beta_sleeve;r.estimated_volatility=d.annualized_volatility;r.diagnostics=d;r.secondary_value=best.secondary;r.solver.equality_rank=best.solver.equality_rank;r.solver.stationarity_residual=best.solver.residual;r.solver.numerical_canonicalization=best.canonicalization;r.solver.converged=true;
 if(best.canonicalization)r.warnings.push('Explicit bounded roundoff canonicalization; no positive active weights discarded or exposure scaling applied');
 r.result_id='factor_implementation_'+canonicalHash({input_hash:r.input_hash,weights,implementation:r.implementation,version:FACTOR_ENGINE_VERSION});
 const projection=controllerProjection(x,r),valid=validateRiskSleeveAllocation(projection);if(valid.status!=='VALID'){r.status='NUMERICAL_FAILURE';r.asset_weights_risk_sleeve=null;r.diagnostics=null;return fail('NUMERICAL_FAILURE','Controller projection certification: '+valid.errors.join(';'));}
 r.controller_projection={origin_mode:'FACTORS',origin_result_id:r.result_id,sleeve:projection};return response();
}
