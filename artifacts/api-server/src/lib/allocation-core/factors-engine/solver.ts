import {dot,linear,mv,quadratic,combinations,choose} from '../assets-engine/numerics';
import type {Halfspace,QpResult} from '../assets-engine/solver';
import type {FactorSolver} from './contracts';
export interface Equality {a:number[];b:number;name:string;tolerance:number;}
export interface MultiResult extends QpResult {equality_rank:number;}
/** Rank detection only. Never solves by inverting B or applies a pseudoinverse. */
function independentEqualities(eq:Equality[],n:number,cfg:FactorSolver) {
 const rows=eq.map((e,i)=>{const scale=Math.max(...e.a.map(Math.abs));return{v:[...e.a.map(x=>scale?x/scale:x),scale?e.b/scale:e.b],index:i};});
 let rank=0;const selected:number[]=[];
 for(let col=0;col<n&&rank<rows.length;col++){let pivot=rank;for(let i=rank+1;i<rows.length;i++)if(Math.abs(rows[i].v[col])>Math.abs(rows[pivot].v[col]))pivot=i;
  if(Math.abs(rows[pivot].v[col])<=cfg.rank_tolerance)continue;[rows[rank],rows[pivot]]=[rows[pivot],rows[rank]];selected.push(rows[rank].index);
  const d=rows[rank].v[col];for(let j=col;j<=n;j++)rows[rank].v[j]/=d;
  for(let i=rank+1;i<rows.length;i++){const z=rows[i].v[col];for(let j=col;j<=n;j++)rows[i].v[j]-=z*rows[rank].v[j];}rank++;}
 const conflict=rows.slice(rank).some(row=>Math.max(...row.v.slice(0,n).map(Math.abs))<=cfg.rank_tolerance&&Math.abs(row.v[n])>cfg.factor_tolerance);
 return{eq:selected.map(i=>eq[i]),rank,conflict};
}
export function multiEqualityQp(h:number[][],f:number[],equalities:Equality[],constraints:Halfspace[],cfg:FactorSolver):MultiResult {
 const n=f.length,{eq,rank,conflict}=independentEqualities(equalities,n,cfg);
 const failure=(status:QpResult['status'],reason:string,faces=0):MultiResult=>({status,x:null,value:null,faces,residual:null,reason,equality_rank:rank});
 if(conflict)return failure('INFEASIBLE','Inconsistent factor/simplex/support equalities');
 const free=n-rank,total=Array.from({length:free+1},(_,k)=>choose(constraints.length,k)).reduce((s,v)=>s+v,0);
 if(total>cfg.max_faces)return failure('NUMERICAL_FAILURE',`KKT workload ${total} exceeds explicit max_faces ${cfg.max_faces}`);
 const scale=Math.max(...h.flat().map(Math.abs),...f.map(Math.abs)),H=h.map(r=>r.map(v=>scale?v/scale:0)),F=f.map(v=>scale?v/scale:0);
 const feasible=(x:number[])=>equalities.every(e=>Math.abs(dot(e.a,x)-e.b)<=e.tolerance)&&constraints.every(c=>dot(c.a,x)>=c.b-cfg.feasibility_tolerance);
 let best:number[]|null=null,bestValue=Infinity,residual:number|null=null,faces=0,hasFeasible=false;
 for(let k=0;k<=free;k++)for(const active of combinations(constraints.length,k)) {
  faces++;const e=[...eq,...active.map(i=>({a:constraints[i].a,b:constraints[i].b,name:constraints[i].name,tolerance:cfg.feasibility_tolerance}))];
  const normalized=e.map(row=>{const scale=Math.max(...row.a.map(Math.abs));return{a:row.a.map(v=>scale?v/scale:v),b:scale?row.b/scale:row.b};});
  const mat=[...H.map((r,i)=>[...r,...normalized.map(row=>row.a[i])]),...normalized.map(row=>[...row.a,...normalized.map(()=>0)])];
  const ans=linear(mat,[...F.map(v=>-v),...normalized.map(row=>row.b)]);if(!ans)continue;const x=ans.slice(0,n);if(!feasible(x))continue;hasFeasible=true;
  if(ans.slice(n+rank).some(v=>v>cfg.stationarity_tolerance))continue;
  const r=Math.max(...mv(H,x).map((v,i)=>Math.abs(v+F[i]+normalized.reduce((s,row,j)=>s+row.a[i]*ans[n+j],0))));if(r>cfg.stationarity_tolerance)continue;
  const value=.5*quadratic(h,x)+dot(f,x);if(value<bestValue){best=x;bestValue=value;residual=r;}
 }
 if(best)return{status:'VALID',x:best,value:bestValue,faces,residual,reason:null,equality_rank:rank};
 // Bounded simplex/turnover epigraph has a vertex whenever it is feasible.
 for(const active of combinations(constraints.length,free)) {
  const e=[...eq,...active.map(i=>({a:constraints[i].a,b:constraints[i].b,name:constraints[i].name,tolerance:cfg.feasibility_tolerance}))];
  const ans=linear(e.map(row=>row.a),e.map(row=>row.b));if(ans&&feasible(ans)){hasFeasible=true;break;}
 }
 return failure(hasFeasible?'NUMERICAL_FAILURE':'INFEASIBLE',hasFeasible?'No certified nonsingular KKT face':'No feasible constrained factor implementation',faces);
}
