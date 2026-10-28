import {dot,quadratic,linear,combinations,choose,mv} from './numerics';
import type {SolverConfiguration} from './contracts';
export interface Halfspace {a:number[];b:number;name:string;} // a'x >= b
export interface QpResult {status:'VALID'|'INFEASIBLE'|'NUMERICAL_FAILURE';x:number[]|null;value:number|null;faces:number;residual:number|null;reason:string|null;}
/** Convex QP, exhaustive active faces, bounded explicit workload. Covers PSD flat directions by lower-dimensional faces. */
export function faceQp(h:number[][],f:number[],eq:number[],rhs:number,c:Halfspace[],cfg:SolverConfiguration):QpResult {
 const n=f.length,total=Array.from({length:n},(_,k)=>choose(c.length,k)).reduce((s,x)=>s+x,0);
 const fail=(status:QpResult['status'],reason:string,faces=0):QpResult=>({status,x:null,value:null,faces,residual:null,reason});
 if(total>cfg.max_faces)return fail('NUMERICAL_FAILURE',`Active-face workload ${total} exceeds declared max_faces ${cfg.max_faces}`);
 // Objective scaling is positive and leaves the optimum unchanged; no diagonal lift.
 const scale=Math.max(...h.flat().map(Math.abs),...f.map(Math.abs));
 const hh=h.map(r=>r.map(x=>scale?x/scale:0)),ff=f.map(x=>scale?x/scale:0);
 let best:number[]|null=null,value=Infinity,faces=0,residual:number|null=null,feasibleVertex=false;
 for(let k=0;k<n;k++)for(const indices of combinations(c.length,k)) {
  faces++;const e=[eq,...indices.map(i=>c[i].a)],b=[rhs,...indices.map(i=>c[i].b)];
  const mat=[...hh.map((row,i)=>[...row,...e.map(r=>r[i])]),...e.map(row=>[...row,...e.map(()=>0)])];
  const solved=linear(mat,[...ff.map(x=>-x),...b]);if(!solved)continue;
  const x=solved.slice(0,n);if(Math.abs(dot(eq,x)-rhs)>cfg.feasibility_tolerance||c.some(z=>dot(z.a,x)<z.b-cfg.feasibility_tolerance))continue;
  if(k===n-1)feasibleVertex=true;
  // With a'x>=b and stationarity Hx+f+E'lambda=0, active inequality multipliers must be <=0.
  const dual=solved.slice(n+1);if(dual.some(z=>z>cfg.stationarity_tolerance))continue;
  const r=Math.max(...mv(hh,x).map((z,i)=>Math.abs(z+ff[i]+e.reduce((s,row,j)=>s+row[i]*solved[n+j],0))));
  if(r>cfg.stationarity_tolerance)continue;
  const v=.5*quadratic(h,x)+dot(f,x);
  if(v<value){value=v;best=x;residual=r;}
 }
 if(best)return {status:'VALID',x:best,value,faces,residual,reason:null};
 // Test primal feasibility independently as a zero-Hessian LP, via vertices.
 for(const ids of combinations(c.length,n-1)) {
  const x=linear([eq,...ids.map(i=>c[i].a)],[rhs,...ids.map(i=>c[i].b)]);
  if(x&&c.every(z=>dot(z.a,x)>=z.b-cfg.feasibility_tolerance)){feasibleVertex=true;break;}
 }
 return fail(feasibleVertex?'NUMERICAL_FAILURE':'INFEASIBLE',feasibleVertex?'No numerically certified KKT point':'No feasible point in bounded sleeve polytope',faces);
}
