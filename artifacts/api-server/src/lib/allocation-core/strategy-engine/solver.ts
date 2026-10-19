/** Certified AL03 linear algebra/active-face QP reused in strategy-return space.
 * H is applied inside constraints, never by aggregating strategies before solving. */
import {faceQp,type Halfspace} from '../assets-engine/solver';
import {dot,mv,quadratic,combinations,choose,linear} from '../assets-engine/numerics';
import type {StrategyInput,StrategyResult} from './contracts';
export function halfspaces(x:StrategyInput,ids:string[],support=ids):Halfspace[]{
 const c:Halfspace[]=[],N=support.length,rows:Record<string,number[]>={};
 const stream=(id:string)=>x.streams.find(s=>s.strategy_instance_id===id)!;
 const assets=[...new Set(x.streams.flatMap(s=>Object.keys(s.unit_position_map.exposures)))].sort();
 for(const a of assets)rows[a]=support.map(s=>stream(s).unit_position_map.exposures[a]??0);
 const add=(row:number[],min:number|null,max:number|null,name:string)=>{if(min!==null)c.push({a:row,b:min,name:name+':min'});if(max!==null)c.push({a:row.map(v=>-v),b:-max,name:name+':max'});};
 for(let i=0;i<N;i++){const b=x.strategy_constraints.bounds[support[i]]??{min:0,max:1};add(support.map((_,j)=>i===j?1:0),b.min,b.max,'strategy:'+support[i]);}
 for(const g of x.strategy_constraints.family_caps)add(support.map(id=>stream(id).strategy_family_id===g.id?1:0),null,g.max,'family:'+g.id);
 for(const g of x.strategy_constraints.underlying_group_caps)add(support.map(id=>stream(id).underlying_ids.some(a=>g.underlying_ids.includes(a))?1:0),null,g.max,'underlying_group:'+g.id);
 if(x.strategy_constraints.turnover_cap!==null){if(2**N>x.solver.max_faces)throw Error('Turnover sign workload exceeds max_faces');const prev=x.previous_allocation!.allocations,base=ids.filter(id=>!support.includes(id)).reduce((s,id)=>s+prev[id],0);
  for(let mask=0;mask<2**N;mask++){const signs=support.map((_,i)=>(mask>>i)&1?1:-1);c.push({a:signs.map(v=>-v),b:base-x.strategy_constraints.turnover_cap-dot(signs,support.map(id=>prev[id])),name:'strategy_turnover:'+mask});}}
 for(const [a,b]of Object.entries(x.implementation_constraints.instrument_bounds)){add(rows[a],b.min_net,b.max_net,'instrument_net:'+a);if(b.max_absolute!==null)add(rows[a],-b.max_absolute,b.max_absolute,'instrument_abs:'+a);}
 const sum=(rs:number[][])=>support.map((_,i)=>rs.reduce((s,r)=>s+r[i],0));
 const gross=(as:string[],max:number,name:string)=>{if(2**as.length>x.solver.max_faces)throw Error('Post-net gross sign workload exceeds max_faces');
  for(let mask=0;mask<2**as.length;mask++)add(sum(as.map((a,j)=>rows[a].map(v=>v*((mask>>j)&1?1:-1)))),null,max,name+':'+mask);};
 for(const g of x.implementation_constraints.group_limits)if(g.basis==='NET')add(sum(g.instruments.map(a=>rows[a])),g.min,g.max,'asset_group:'+g.id);else if(g.max!==null)gross(g.instruments,g.max,'asset_group_gross:'+g.id);
 add(sum(Object.values(rows)),x.implementation_constraints.min_net,x.implementation_constraints.max_net,'aggregate_net');
 if(x.implementation_constraints.max_gross!==null)gross(assets,x.implementation_constraints.max_gross,'aggregate_post_net_gross');
 return c;
}
export function objectiveValue(x:StrategyInput,a:Record<string,number>):number{
 const ids=Object.keys(a).sort(),v=ids.map(id=>a[id]),idx=ids.map(id=>x.risk_model.axis_ids.indexOf(id)),s=idx.map(i=>idx.map(j=>(x.risk_model.covariance[i][j]+x.risk_model.covariance[j][i])/2)),varr=quadratic(s,v),mu=ids.map(id=>x.expected_returns?.values[id]??0);
 switch(x.objective.type){case'EQUAL_CAPITAL':return v.reduce((z,w)=>z+(w-1/v.length)**2,0);case'MIN_VARIANCE':return varr;case'MEAN_VARIANCE':return dot(v,mu)-x.objective.gamma/2*varr;case'MAX_SHARPE':return(dot(v,mu)-x.objective.rf_stream)/Math.sqrt(varr);case'ERC':return mv(s,v).reduce((z,w,i)=>z+(w*v[i]/varr-1/v.length)**2,0);}
}
export function solve(x:StrategyInput,telemetry:StrategyResult['solver']):{status:StrategyResult['status'];reason:string|null;weights:Record<string,number>|null}{
 const fail=(status:StrategyResult['status'],reason:string)=>({status,reason,weights:null}),ids=x.streams.map(s=>s.strategy_instance_id).sort(),n=ids.length,idx=ids.map(id=>x.risk_model.axis_ids.indexOf(id)),cov=idx.map(i=>idx.map(j=>(x.risk_model.covariance[i][j]+x.risk_model.covariance[j][i])/2));
 const k=x.strategy_constraints.max_active_strategies??n,tol=x.solver.feasibility_tolerance;
 if(Object.values(x.strategy_constraints.bounds).some(b=>b.min>b.max))return fail('INFEASIBLE','Strategy lower bound exceeds upper bound');
 if(choose(n,k)>x.solver.max_supports)return fail('NUMERICAL_FAILURE','Declared max_supports exceeded');
 let best:Record<string,number>|null=null,bestLoss=Infinity;
 try{
 if(x.objective.type==='EQUAL_CAPITAL'||x.objective.type==='ERC'){
  let v=ids.map(()=>1/n);telemetry.method=x.objective.type==='ERC'?'AL03_CONVEX_LOG_RISK_BUDGET_COORDINATE_V1':'EXPLICIT_EQUAL_CAPITAL_V1';
  if(x.objective.type==='ERC'){
   if(cov.some((r,i)=>r[i]===0))return fail('INSUFFICIENT_DATA','Zero-variance strategy: exact positive ERC budget undefined');
   let raw=ids.map((_,i)=>1/Math.sqrt(cov[i][i])),converged=false;
   for(let it=0;it<x.solver.max_iterations;it++){for(let i=0;i<n;i++){const aa=cov[i][i],b=dot(cov[i],raw)-aa*raw[i],disc=Math.sqrt(b*b+4*aa/n);raw[i]=b>=0?2/n/(disc+b):(disc-b)/(2*aa);}
    const sum=raw.reduce((s,z)=>s+z,0);v=raw.map(z=>z/sum);const variance=quadratic(cov,v),rc=mv(cov,v).map((z,i)=>z*v[i]);
    telemetry.iterations=it+1;const r=Math.max(...rc.map(z=>Math.abs(z/variance-1/n)));telemetry.stationarity_residual=Number.isFinite(r)?r:null;
    if(Number.isFinite(r)&&r<=x.solver.erc_relative_tolerance){converged=true;break;}}
   if(!converged)return fail('NUMERICAL_FAILURE','ERC did not converge; no equal-capital fallback');
  }
  if(k<n||halfspaces(x,ids).some(c=>dot(c.a,v)<c.b-tol))return fail('INFEASIBLE','Exact equal-capital/ERC allocation violates declared strategy or post-mapping constraints');
  best=Object.fromEntries(ids.map((id,i)=>[id,v[i]]));telemetry.supports=1;
 }else{
  let numerical:string|null=null,zeroRisk=false,definedSharpe=false,feasibleSharpe=false,lastReason='No feasible strategy support';
  for(const choice of combinations(n,k)){
   const support=choice.map(i=>ids[i]);telemetry.supports++;
   if(ids.some(id=>!support.includes(id)&&(x.strategy_constraints.bounds[id]?.min??0)>0))continue;
   const c=halfspaces(x,ids,support),s=choice.map(i=>choice.map(j=>cov[i][j])),mu=support.map(id=>x.expected_returns?.values[id]??0),eq=support.map(()=>1);
   let solution;
   if(x.objective.type==='MAX_SHARPE'){
    telemetry.method='AL03_SCHAIBLE_POSITIVE_OR_NONPOSITIVE_VERTICES_V1';const excess=mu.map(z=>z-(x.objective as {rf_stream:number}).rf_stream);
    const premium=faceQp(s.map(r=>r.map(()=>0)),excess.map(v=>-v),eq,1,c,x.solver);telemetry.faces+=premium.faces;
    if(premium.status!=='VALID'){if(premium.status==='NUMERICAL_FAILURE')numerical=premium.reason;lastReason=premium.reason!;continue;}
    feasibleSharpe=true;
    if(dot(excess,premium.x!)>0){const scale=Math.max(...excess.map(Math.abs));solution=faceQp(s.map(r=>r.map(v=>2*v)),support.map(()=>0),excess.map(v=>v/scale),1/scale,c.map(z=>({...z,a:z.a.map(v=>v-z.b),b:0})),x.solver);
     if(solution.status==='VALID'){const sum=solution.x!.reduce((t,z)=>t+z,0);solution.x=solution.x!.map(z=>z/sum);if(quadratic(s,solution.x)<=0){zeroRisk=true;continue;}definedSharpe=true;}
    }else{
     // AL03 triangle-inequality vertex oracle for nonpositive excess.
     if(choose(c.length,support.length-1)>x.solver.max_faces)return fail('NUMERICAL_FAILURE','Sharpe vertex workload exceeds max_faces');
     let v:number[]|null=null,score=-Infinity,faces=0;
     for(const active of combinations(c.length,support.length-1)){faces++;const a=linear([eq,...active.map(i=>c[i].a)],[1,...active.map(i=>c[i].b)]);if(!a||c.some(z=>dot(z.a,a)<z.b-tol))continue;const varr=quadratic(s,a);if(varr<=0)continue;const ratio=dot(excess,a)/Math.sqrt(varr);if(Number.isFinite(ratio)&&ratio>score){score=ratio;v=a;}}
     if(!v){lastReason='No defined positive-variance Sharpe allocation';continue;}definedSharpe=true;solution={status:'VALID' as const,x:v,value:score,faces,residual:null,reason:null};
    }
   }else{const gamma=x.objective.type==='MEAN_VARIANCE'?x.objective.gamma:2;solution=faceQp(s.map(r=>r.map(v=>gamma*v)),x.objective.type==='MEAN_VARIANCE'?mu.map(v=>-v):support.map(()=>0),eq,1,c,x.solver);}
   telemetry.faces+=solution.faces;
   if(solution.status!=='VALID'){if(solution.status==='NUMERICAL_FAILURE')numerical=solution.reason;lastReason=solution.reason!;continue;}
   const a=Object.fromEntries(ids.map(id=>[id,support.includes(id)?solution.x![support.indexOf(id)]:0]));
   const value=objectiveValue(x,a),loss=x.objective.type==='MIN_VARIANCE'?value:-value;
   if(Number.isFinite(loss)&&loss<bestLoss){best=a;bestLoss=loss;telemetry.stationarity_residual=solution.residual;}
  }
  // Never certify a global cardinality optimum after skipping a failed feasible support.
  if(numerical)return fail('NUMERICAL_FAILURE',numerical);
  if(zeroRisk)return fail('INSUFFICIENT_DATA','Positive-return zero-variance feasible support makes finite Sharpe undefined/unbounded');
  if(!best)return fail(x.objective.type==='MAX_SHARPE'&&feasibleSharpe&&!definedSharpe?'INSUFFICIENT_DATA':'INFEASIBLE',lastReason);
 }
 // Bounded roundoff correction, not economic normalization. Never rounds a positive allocation away.
 const before=ids.map(id=>best![id]),v=before.map(z=>z<0&&z>=-tol?0:z),sum=v.reduce((s,z)=>s+z,0),largest=v.indexOf(Math.max(...v));
 if(Math.abs(sum-1)>tol||v.some(z=>z<0))return fail('NUMERICAL_FAILURE','Unscaled allocation failed simplex reconciliation');v[largest]+=1-sum;
 telemetry.numerical_canonicalization_l1=v.reduce((s,z,i)=>s+Math.abs(z-before[i]),0);
 if(telemetry.numerical_canonicalization_l1>2*tol||v.some(z=>z<0)||halfspaces(x,ids).some(c=>dot(c.a,v)<c.b-tol))return fail('NUMERICAL_FAILURE','Roundoff canonicalization failed original constraints');
 telemetry.active_constraints=halfspaces(x,ids).filter(c=>Math.abs(dot(c.a,v)-c.b)<=tol).map(c=>c.name);telemetry.converged=true;
 return{status:'VALID',reason:null,weights:Object.fromEntries(ids.map((id,i)=>[id,v[i]]))};
 }catch(e){return fail('NUMERICAL_FAILURE',String(e));}
}
