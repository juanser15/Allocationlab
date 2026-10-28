import {canonicalHash,metadata,object,timestamp,validateRiskSleeveAllocation} from '../validation';
import {CONTRACT_VERSION,LONG_ONLY,type RiskSleeveAllocationResult,type AllocationStatus} from '../contracts';
import {ENGINE_VERSION,OBJECTIVE_REGISTRY,type AssetsEngineInput,type EngineResult,type RiskDiagnostics} from './contracts';
import {dot,mv,quadratic,eigen,combinations,choose,linear} from './numerics';
import {faceQp,type Halfspace} from './solver';

export function validateAssetsInput(value:unknown):string[] {
 const errors:string[]=[];
 try {
 const r=object(value,['schema_version','convention','assets','risk_model','expected_returns','beta_estimates','previous_holdings','constraints','objective','solver','as_of','information_cutoff','provenance'],'assets_input',errors);
 metadata(r,'input',errors);const x=r as unknown as AssetsEngineInput;
 if(x.schema_version!==ENGINE_VERSION||x.convention!=='LONG_ONLY_FULLY_INVESTED')errors.push('Version/convention invalid');
 if(timestamp(x.information_cutoff)!==null&&timestamp(x.as_of)!==null&&timestamp(x.information_cutoff)!>=timestamp(x.as_of)!)errors.push('Strict prior-decision cutoff required');
 if(!Array.isArray(x.assets)||!x.assets.length||new Set(x.assets).size!==x.assets.length||x.assets.some(a=>typeof a!=='string'||!a.trim()||['__proto__','constructor','prototype','CASH','masterCash','totalCash'].includes(a)))return [...errors,'Unique risky instrument IDs required; no cash instrument'];
 const ids=[...x.assets].sort(),same=(a:string[])=>Array.isArray(a)&&a.length===ids.length&&[...a].sort().every((z,i)=>z===ids[i]);
 const point=(v:unknown,name:string,keys:string[])=>{const p=object(v,[...keys,'as_of','information_cutoff','provenance'],name,errors);metadata(p,name,errors,x,true);return p;};
 const c=point(x.risk_model,'covariance',['representation','units','axis_ids','covariance']);
 if(c.representation!=='COVARIANCE'||c.units!=='daily_decimal_return_squared'||!same(c.axis_ids as string[]))errors.push('Covariance units/axis mismatch');
 if(!x.risk_model.provenance.model)errors.push('Covariance model/version required');
 if(!Array.isArray(c.covariance)||(c.covariance as number[][]).length!==ids.length||(c.covariance as number[][]).some(row=>!Array.isArray(row)||row.length!==ids.length||row.some(v=>!Number.isFinite(v))))errors.push('Finite square covariance required');
 const cfg=object(x.solver,['feasibility_tolerance','stationarity_tolerance','psd_tolerance','symmetry_tolerance','erc_relative_tolerance','max_iterations','max_faces','max_supports'],'solver',errors);
 for(const [key,v]of Object.entries(cfg))if(typeof v!=='number'||!Number.isFinite(v)||v<=0||key.startsWith('max_')&&!Number.isInteger(v))errors.push('Invalid solver setting '+key);
 if(Object.keys(cfg).length!==8)errors.push('All solver settings required');
 const b=point(x.beta_estimates,'betas',['values','beta_model']);if(!same(Object.keys(b.values as object))||Object.values(b.values as object).some(v=>!Number.isFinite(v)))errors.push('Finite beta vector on same axis required');
 const bm=object(x.beta_estimates.beta_model,['benchmark','estimation_window','estimator','as_of','information_cutoff','data_hash'],'beta_model',errors);
 if(!bm.benchmark||!['OLS_COV_VARIANCE_SAMPLE_V1','SUPPLIED_ASSET_BETAS_V1'].includes(String(bm.estimator))||timestamp(bm.as_of)===null||timestamp(bm.as_of)!>timestamp(x.information_cutoff)!||bm.information_cutoff!==x.information_cutoff||bm.data_hash!==x.beta_estimates.provenance.data_hash)errors.push('Invalid/future beta model identity');
 const w=x.beta_estimates.beta_model.estimation_window;
 if(!w||timestamp(w.start)===null||timestamp(w.end)===null||w.start>w.end||w.end>x.information_cutoff||!Number.isInteger(w.observations)||w.observations<2)errors.push('Invalid beta estimation window');
 if(x.beta_estimates.information_cutoff!==x.information_cutoff||x.risk_model.information_cutoff!==x.information_cutoff)errors.push('Risk and beta models require the same information cutoff');
 const o=object(x.objective,['type',...(x.objective?.type==='MEAN_VARIANCE'?['gamma']:x.objective?.type==='MAX_SHARPE'?['rf_sleeve']:[])],'objective',errors);
 if(!Object.hasOwn(OBJECTIVE_REGISTRY,String(o.type)))errors.push('Unknown objective; no switching');
 if(x.objective.type==='MEAN_VARIANCE'&&(!Number.isFinite(x.objective.gamma)||x.objective.gamma<=0))errors.push('Explicit positive gamma required');
 if(x.objective.type==='MAX_SHARPE'&&!Number.isFinite(x.objective.rf_sleeve))errors.push('Explicit finite rf_sleeve required');
 if(x.expected_returns!==null){const mu=point(x.expected_returns,'expected_returns',['units','values']);if(mu.units!=='daily_decimal_return'||!same(Object.keys(mu.values as object))||Object.values(mu.values as object).some(v=>!Number.isFinite(v))||mu.information_cutoff!==x.information_cutoff||!x.expected_returns.provenance.model)errors.push('Expected return axis/units/model/cutoff invalid');}
 if((x.objective.type==='MAX_SHARPE'||x.objective.type==='MEAN_VARIANCE')&&x.expected_returns===null)errors.push('Objective requires external ExpectedReturns artifact');
 const cons=object(x.constraints,['asset_bounds','group_caps','max_active_names','turnover_cap'],'constraints',errors);
 if(Object.keys(cons).length!==4)errors.push('All constraints explicitly declared');
 for(const [id,bound]of Object.entries(x.constraints.asset_bounds)){const b=object(bound,['min','max'],'bounds.'+id,errors);if(!ids.includes(id)||!Number.isFinite(b.min)||!Number.isFinite(b.max)||Number(b.min)<0||Number(b.max)>1)errors.push('Invalid sleeve asset bound');}
 for(const g of x.constraints.group_caps){object(g,['id','assets','max'],'group',errors);if(!g.id||!g.assets.length||new Set(g.assets).size!==g.assets.length||g.assets.some(a=>!ids.includes(a))||!Number.isFinite(g.max)||g.max<0||g.max>1)errors.push('Invalid group cap');}
 if(x.constraints.max_active_names!==null&&(!Number.isInteger(x.constraints.max_active_names)||x.constraints.max_active_names<1||x.constraints.max_active_names>ids.length))errors.push('Invalid max active names');
 if(x.constraints.turnover_cap!==null&&(!Number.isFinite(x.constraints.turnover_cap)||x.constraints.turnover_cap<0||x.constraints.turnover_cap>2||!x.previous_holdings))errors.push('Turnover cap requires previous q and limit [0,2]');
 if(x.previous_holdings){const p=point(x.previous_holdings,'previous_q',['units','asset_weights']);const ws=x.previous_holdings.asset_weights;if(p.units!=='fraction_of_risk_capital'||!same(Object.keys(ws))||Object.values(ws).some(v=>!Number.isFinite(v)||v<0)||Math.abs(Object.values(ws).reduce((s,v)=>s+v,0)-1)>x.solver.feasibility_tolerance)errors.push('Previous sleeve q must be fully invested on decision axis');}
 canonicalHash(value);
 } catch(error){errors.push('Malformed/nonfinite canonical input: '+String(error));}
 return errors;
}

function constraints(x:AssetsEngineInput,ids:string[],support:string[]):Halfspace[] {
 const c:Halfspace[]=[];for(const [i,id]of support.entries()){const a=support.map((_,j)=>i===j?1:0),b=x.constraints.asset_bounds[id]??{min:0,max:1};c.push({a,b:b.min,name:id+':min'},{a:a.map(v=>-v),b:-b.max,name:id+':max'});}
 for(const g of x.constraints.group_caps)c.push({a:support.map(a=>g.assets.includes(a)?-1:0),b:-g.max,name:'group:'+g.id});
 if(x.constraints.turnover_cap!==null){const old=x.previous_holdings!.asset_weights,base=ids.filter(a=>!support.includes(a)).reduce((s,a)=>s+old[a],0);
  for(let mask=0;mask<2**support.length;mask++){const signs=support.map((_,j)=>(mask>>j)&1?1:-1);c.push({a:signs.map(v=>-v),b:base-x.constraints.turnover_cap-dot(signs,support.map(a=>old[a])),name:'turnover:'+mask});}}
 return c;
}
export function portfolioDiagnostics(q:Record<string,number>,x:AssetsEngineInput):RiskDiagnostics {
 const ids=Object.keys(q).sort(),indices=ids.map(a=>x.risk_model.axis_ids.indexOf(a)),cov=indices.map(i=>indices.map(j=>x.risk_model.covariance[i][j])),v=ids.map(a=>q[a]),m=mv(cov,v),variance=dot(v,m),er=eigen(cov,x.solver.max_iterations);
 const hhi=dot(v,v),eigenvalues=er.values.map(z=>Math.max(0,z)),total=eigenvalues.reduce((s,z)=>s+z,0);
 const entropy=(p:number[])=>Math.exp(-p.reduce((s,z)=>s+(z>0?z*Math.log(z):0),0));
 const pca=eigenvalues.map((z,j)=>z*dot(v,er.vectors.map(r=>r[j]))**2),pv=pca.reduce((s,z)=>s+z,0),shares=pv>0?pca.map(z=>z/pv):null;
 return {variance,annualized_volatility:Math.sqrt(Math.max(0,252*variance)),beta_sleeve:dot(v,ids.map(a=>x.beta_estimates.values[a])),
 marginal_risk:Object.fromEntries(ids.map((a,i)=>[a,m[i]])),risk_contributions:Object.fromEntries(ids.map((a,i)=>[a,v[i]*m[i]])),risk_contribution_fractions:variance>0?Object.fromEntries(ids.map((a,i)=>[a,v[i]*m[i]/variance])):null,
 gross_exposure:v.reduce((s,z)=>s+Math.abs(z),0),net_exposure:v.reduce((s,z)=>s+z,0),hhi,effective_number_weights:1/hhi,largest_weight:Math.max(...v),top3_share:[...v].sort((a,b)=>b-a).slice(0,3).reduce((s,z)=>s+z,0),
 turnover_gross_l1:x.previous_holdings?ids.reduce((s,a)=>s+Math.abs(q[a]-x.previous_holdings!.asset_weights[a]),0):null,
 active_bounds:ids.flatMap(a=>{const b=x.constraints.asset_bounds[a]??{min:0,max:1};return [...(Math.abs(q[a]-b.min)<=x.solver.feasibility_tolerance?[a+':min']:[]),...(Math.abs(q[a]-b.max)<=x.solver.feasibility_tolerance?[a+':max']:[])];}),
 covariance_effective_rank:total>0?entropy(eigenvalues.map(z=>z/total)):null,pca_effective_risk_bets:shares?entropy(shares):null,eigenvalues:er.values,pca_risk_shares:shares};
}
export function objectiveValue(x:AssetsEngineInput,q:Record<string,number>):number {
 const ids=Object.keys(q).sort(),v=ids.map(a=>q[a]),c=ids.map(a=>ids.map(b=>x.risk_model.covariance[x.risk_model.axis_ids.indexOf(a)][x.risk_model.axis_ids.indexOf(b)])),variance=quadratic(c,v),mu=ids.map(a=>x.expected_returns?.values[a]??0);
 switch(x.objective.type){case 'EQUAL_WEIGHT':return v.reduce((s,z)=>s+(z-1/v.length)**2,0);case 'MIN_VARIANCE':return variance;
 case 'MEAN_VARIANCE':return dot(v,mu)-x.objective.gamma/2*variance;case 'MAX_SHARPE':return(dot(v,mu)-x.objective.rf_sleeve)/Math.sqrt(variance);
 case 'ERC':return mv(c,v).reduce((s,z,i)=>s+(v[i]*z/variance-1/v.length)**2,0);}
}
export function allocateAssets(value:unknown):EngineResult {
 const errors=validateAssetsInput(value),x=value as AssetsEngineInput,objective=x?.objective??{type:'EQUAL_WEIGHT'};
 const result:EngineResult={status:'INVALID_INPUT',errors,warnings:[],input_hash:null,result_id:null,objective,objective_version:OBJECTIVE_REGISTRY[objective.type]?.version??'UNKNOWN',weights:null,objective_value:null,diagnostics:null,sleeve:null,
 solver:{method:'EXHAUSTIVE_CONVEX_KKT_FACES_V1',iterations:0,faces_examined:0,supports_examined:0,stationarity_residual:null,convergence_tolerance:x?.solver?.stationarity_tolerance??0,constraint_tolerance:x?.solver?.feasibility_tolerance??0,converged:false}};
 if(errors.length)return result;
 const ids=[...x.assets].sort(),indices=ids.map(a=>x.risk_model.axis_ids.indexOf(a)),cov=indices.map(i=>indices.map(j=>x.risk_model.covariance[i][j]));
 result.input_hash=canonicalHash({...x,assets:ids,risk_model:{...x.risk_model,axis_ids:ids,covariance:cov}});
 const fail=(status:AllocationStatus,reason:string)=>{result.status=status;result.errors.push(reason);return result;};
 if(cov.some((row,i)=>row[i]<0||row.some((v,j)=>Math.abs(v-cov[j][i])>x.solver.symmetry_tolerance)))return fail('INVALID_INPUT','Asymmetric covariance or negative diagonal');
 // Within symmetry tolerance use the explicitly declared numerical symmetric part; no eigenvalue lift.
 const sym=cov.map((r,i)=>r.map((v,j)=>(v+cov[j][i])/2)),eig=eigen(sym,x.solver.max_iterations);
 if(!eig.converged)return fail('NUMERICAL_FAILURE','Covariance eigendecomposition did not converge');
 if(Math.min(...eig.values)<-x.solver.psd_tolerance)return fail('INVALID_INPUT','Covariance not PSD within declared daily-unit tolerance');
 if(cov.some((r,i)=>r.some((v,j)=>v!==sym[i][j])))result.warnings.push('Explicit within-tolerance covariance symmetrization');
 if(Math.min(...eig.values)<0)result.warnings.push('Covariance has negative eigenvalue within declared numerical PSD tolerance; no lift applied');
 const n=ids.length,K=x.constraints.max_active_names??n;
 if(x.constraints.turnover_cap!==null&&2**K>x.solver.max_faces)return fail('NUMERICAL_FAILURE','Turnover sign-face workload exceeds declared max_faces');
 for(const id of ids){const b=x.constraints.asset_bounds[id]??{min:0,max:1};if(b.min>b.max)return fail('INFEASIBLE','Asset lower bound exceeds upper bound');}
 if(choose(n,K)>x.solver.max_supports)return fail('NUMERICAL_FAILURE','Declared max_supports exceeded');
 let best:Record<string,number>|null=null,bestValue=Infinity;
 if(x.objective.type==='EQUAL_WEIGHT'||x.objective.type==='ERC') {
  result.solver.method=x.objective.type==='ERC'?'CONVEX_LOG_RISK_BUDGET_COORDINATE_V1':'EXPLICIT_EQUAL_WEIGHT_V1';
  let v=ids.map(()=>1/n);
  if(x.objective.type==='ERC') {
   if(sym.some((r,i)=>r[i]===0))return fail('INSUFFICIENT_DATA','ERC positive risk budget is undefined for a zero variance asset');
   let raw=ids.map((_,i)=>1/Math.sqrt(sym[i][i])),converged=false;
   for(let it=0;it<x.solver.max_iterations;it++){for(let i=0;i<n;i++){const a=sym[i][i],b=dot(sym[i],raw)-a*raw[i],disc=Math.sqrt(b*b+4*a/n);raw[i]=b>=0?2/n/(disc+b):(disc-b)/(2*a);}
    const sum=raw.reduce((s,z)=>s+z,0);v=raw.map(z=>z/sum);const variance=quadratic(sym,v),rc=mv(sym,v).map((z,i)=>z*v[i]);
    result.solver.iterations=it+1;const residual=Math.max(...rc.map(z=>Math.abs(z/variance-1/n)));result.solver.stationarity_residual=residual;
    if(Number.isFinite(residual)&&residual<=x.solver.erc_relative_tolerance){converged=true;break;}}
   if(!converged)return fail('NUMERICAL_FAILURE','ERC did not converge to declared equal-risk tolerance');
  }
  if(K<n||constraints(x,ids,ids).some(c=>dot(c.a,v)<c.b-x.solver.feasibility_tolerance))return fail('INFEASIBLE','Exact equal-weight/ERC portfolio conflicts with declared constraints; no approximate fallback');
  best=Object.fromEntries(ids.map((a,i)=>[a,v[i]]));result.solver.supports_examined=1;
 } else {
  let numerical=false,reason='No feasible support',positiveExcess=false,zeroRisk=false;
  for(const selection of combinations(n,K)) {
   const support=selection.map(i=>ids[i]);result.solver.supports_examined++;
   if(ids.some(a=>!support.includes(a)&&(x.constraints.asset_bounds[a]?.min??0)>0))continue;
   const c=constraints(x,ids,support),s=selection.map(i=>selection.map(j=>sym[i][j])),mu=support.map(a=>x.expected_returns?.values[a]??0),eq=support.map(()=>1);
   let solved;
   if(x.objective.type==='MAX_SHARPE') {
    result.solver.method='SCHAIBLE_POSITIVE_OR_NONPOSITIVE_VERTEX_CERTIFICATION_V1';
    const rf=x.objective.rf_sleeve,excess=mu.map(z=>z-rf);
    // Establish existence of positive expected excess on the original feasible polytope.
    const premium=faceQp(s.map(r=>r.map(()=>0)),excess.map(z=>-z),eq,1,c,x.solver);result.solver.faces_examined+=premium.faces;
    if(premium.status!=='VALID'){numerical ||= premium.status==='NUMERICAL_FAILURE';reason=premium.reason!;continue;}
    if(dot(excess,premium.x!)<=0) {
     // For nonpositive excess, let b=-a. For any convex mix of vertices,
     // b'q >= min_v(b'v/||v||Sigma)*sum(theta_v ||v||Sigma) >= min_v(...)*||q||Sigma.
     // Thus the largest finite nonpositive Sharpe is attained at a feasible vertex.
     let vertex:number[]|null=null,score=-Infinity,faces=0;
     for(const active of combinations(c.length,support.length-1)){faces++;const v=linear([eq,...active.map(i=>c[i].a)],[1,...active.map(i=>c[i].b)]);
      if(!v||c.some(z=>dot(z.a,v)<z.b-x.solver.feasibility_tolerance))continue;
      const variance=quadratic(s,v);if(variance<=0)continue;const ratio=dot(excess,v)/Math.sqrt(variance);
      if(Number.isFinite(ratio)&&ratio>score){score=ratio;vertex=v;}}
     if(!vertex){reason='No positive-variance point with defined finite Sharpe';continue;}
     solved={status:'VALID' as const,x:vertex,value:score,faces,residual:null,reason:null};
    } else {
    positiveExcess=true;
    // Schaible: y=q/(a'q), minimize y'Sigma y, a'y=1, Aq>=b => (A-b1')y>=0.
    const scale=Math.max(...excess.map(Math.abs));
    solved=faceQp(s.map(r=>r.map(z=>2*z)),support.map(()=>0),excess.map(z=>z/scale),1/scale,c.map(z=>({...z,a:z.a.map(v=>v-z.b),b:0})),x.solver);
    if(solved.status==='VALID'){const sum=solved.x!.reduce((t,z)=>t+z,0);solved.x=solved.x!.map(z=>z/sum);if(quadratic(s,solved.x)<=0){zeroRisk=true;reason='Positive-return zero-variance portfolio: finite Sharpe undefined';continue;}}
    }
   } else {const gamma=x.objective.type==='MEAN_VARIANCE'?x.objective.gamma:2;
    solved=faceQp(s.map(r=>r.map(z=>gamma*z)),x.objective.type==='MEAN_VARIANCE'?mu.map(z=>-z):support.map(()=>0),eq,1,c,x.solver);}
   result.solver.faces_examined+=solved.faces;
   if(solved.status!=='VALID'){numerical ||= solved.status==='NUMERICAL_FAILURE';reason=solved.reason!;continue;}
   const q=Object.fromEntries(ids.map(a=>[a,support.includes(a)?solved.x![support.indexOf(a)]:0]));
   const val=objectiveValue({...x,risk_model:{...x.risk_model,axis_ids:ids,covariance:sym}},q),loss=x.objective.type==='MIN_VARIANCE'?val:-val;
   if(Number.isFinite(loss)&&loss<bestValue){best=q;bestValue=loss;result.solver.stationarity_residual=solved.residual;}
  }
  if(x.objective.type==='MAX_SHARPE'&&zeroRisk)return fail('INSUFFICIENT_DATA','Positive-return zero-variance feasible support makes finite MAX_SHARPE undefined/unbounded');
  if(!best)return fail(numerical?'NUMERICAL_FAILURE':x.objective.type==='MAX_SHARPE'&&!positiveExcess?'INSUFFICIENT_DATA':'INFEASIBLE',reason);
 }
 const normalizedInput={...x,risk_model:{...x.risk_model,axis_ids:ids,covariance:sym}};
 const vector=ids.map(a=>best![a]);
 if(Math.abs(vector.reduce((s,v)=>s+v,0)-1)>x.solver.feasibility_tolerance||constraints(x,ids,ids).some(c=>dot(c.a,vector)<c.b-x.solver.feasibility_tolerance))return fail('NUMERICAL_FAILURE','Final unscaled q failed independent primal reconciliation');
 result.weights=best;result.objective_value=objectiveValue(normalizedInput,best);result.diagnostics=portfolioDiagnostics(best,normalizedInput);
 if(!Number.isFinite(result.objective_value)||!Object.values(best).every(Number.isFinite)||!Number.isFinite(result.diagnostics.annualized_volatility))return fail('NUMERICAL_FAILURE','Nonfinite solution diagnostics');
 result.status='VALID';result.solver.converged=true;
 const body:Omit<RiskSleeveAllocationResult,'allocation_id'>={schema_version:CONTRACT_VERSION,allocation_mode:'ASSETS',as_of:x.as_of,information_cutoff:x.information_cutoff,provenance:{...x.provenance,configuration_hash:canonicalHash({objective:x.objective,constraints:x.constraints,solver:x.solver}),model:{id:ENGINE_VERSION,version:OBJECTIVE_REGISTRY[x.objective.type].version}},input_snapshot_id:'snapshot_'+result.input_hash!,status:'VALID',asset_weight_units:'fraction_of_risk_capital',asset_weights_risk_sleeve:best,gross_exposure:result.diagnostics.gross_exposure,net_exposure:result.diagnostics.net_exposure,estimated_market_beta:result.diagnostics.beta_sleeve,estimated_volatility:result.diagnostics.annualized_volatility,asset_market_betas:x.beta_estimates.values,beta_model:x.beta_estimates.beta_model,risk_model_provenance:{as_of:x.risk_model.as_of,information_cutoff:x.risk_model.information_cutoff,provenance:x.risk_model.provenance},risk_measurement_status:'AVAILABLE',explicit_unallocated_risk_budget:0,convention:structuredClone(LONG_ONLY),turnover_estimate:result.diagnostics.turnover_gross_l1,mode_specific_details:{allocation_mode:'ASSETS',asset_decision_weights:best},warnings:result.warnings,errors:[]};
 result.sleeve={...body,allocation_id:'allocation_'+canonicalHash(body)};
 const canonical=validateRiskSleeveAllocation(result.sleeve);if(canonical.status!=='VALID'){result.sleeve=null;return fail('NUMERICAL_FAILURE','Canonical sleeve certification: '+canonical.errors.join(';'));}
 result.result_id='assets_'+canonicalHash({input_hash:result.input_hash,weights:best,version:ENGINE_VERSION});return result;
}
