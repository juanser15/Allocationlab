/** Sample covariance + deterministic hierarchical linkage. No allocation decision. */
import {eigen,dot,quadratic} from '../../artifacts/api-server/src/lib/allocation-core/assets-engine/numerics';
import {seal,canonicalHash} from '../governance/common';
import type {Breadth,Clustering,Correlation,Policy} from './contracts';
export function covariance(rows:number[][]):number[][] {
 if(rows.length<2||!rows[0]?.length||rows.some(r=>r.length!==rows[0].length||r.some(v=>!Number.isFinite(v))))throw Error('Invalid covariance observations');
 const means=rows[0].map((_,j)=>rows.reduce((s,r)=>s+r[j],0)/rows.length);
 return means.map((a,i)=>means.map((b,j)=>rows.reduce((s,r)=>s+(r[i]-a)*(r[j]-b),0)/(rows.length-1)));
}
export function pearson(cov:number[][],tolerance:number):number[][] {
 if(cov.some((r,i)=>!Number.isFinite(r[i])||r[i]<=0))throw Error('INSUFFICIENT_DATA: zero variance; no denominator epsilon');
 return cov.map((r,i)=>r.map((v,j)=>{const rho=v/Math.sqrt(cov[i][i]*cov[j][j]);if(!Number.isFinite(rho)||Math.abs(rho)>1+tolerance)throw Error('NUMERICAL_FAILURE: correlation bounds');return i===j?1:Math.max(-1,Math.min(1,rho));}));
}
const average=(v:number[])=>v.length?v.reduce((s,x)=>s+x,0)/v.length:null;
export function cluster(model:Correlation,p:Policy):Clustering {
 const ids=model.axis_ids;let groups=ids.map(id=>[id]).sort((a,b)=>a[0]<b[0]?-1:1);const merges:Clustering['merges']=[];
 const dist=(a:string,b:string)=>Math.sqrt(Math.max(0,(1-model.correlation[ids.indexOf(a)][ids.indexOf(b)])/2));
 const key=(a:string[])=>JSON.stringify(a);
 const limit=Math.sqrt((1-p.clustering.correlation_threshold)/2);
 while(groups.length>1){let best:{i:number;j:number;distance:number;key:string}|null=null;
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const values=groups[i].flatMap(a=>groups[j].map(b=>dist(a,b))),distance=p.clustering.linkage==='SINGLE'?Math.min(...values):p.clustering.linkage==='COMPLETE'?Math.max(...values):average(values)!;
   const pairKey=key(groups[i])+'|'+key(groups[j]);if(!best||distance<best.distance||distance===best.distance&&pairKey<best.key)best={i,j,distance,key:pairKey};
  }
  if(!best||best.distance>limit)break;
  merges.push({left:groups[best.i],right:groups[best.j],distance:best.distance});const combined=[...groups[best.i],...groups[best.j]].sort();groups=groups.filter((_,i)=>i!==best!.i&&i!==best!.j).concat([combined]).sort((a,b)=>key(a)<key(b)?-1:1);
 }
 const clusters=groups.map(m=>({cluster_id:'cluster_'+canonicalHash(m),members:m,size:m.length,within_average_correlation:average(m.flatMap((a,i)=>m.slice(i+1).map(b=>model.correlation[ids.indexOf(a)][ids.indexOf(b)])))}));
 const between=clusters.flatMap((a,i)=>clusters.slice(i+1).map(b=>({left:a.cluster_id,right:b.cluster_id,average_correlation:average(a.members.flatMap(x=>b.members.map(y=>model.correlation[ids.indexOf(x)][ids.indexOf(y)])))!})));
 const body={model_hash:model.hash,policy_hash:p.hash,clusters,between,merges};return seal({cluster_artifact_id:'clusters_'+canonicalHash(body),...body});
}
/** AL03 eigen/entropy/PCA methodology on a declared equal-unit diagnostic probe.
 * It produces no investment weights. Degenerate eigenspaces are labelled. */
export function breadth(cov:number[][],corr:number[][],tolerance:number,probe?:number[]):Breadth {
 const n=cov.length,empty:Breadth={count:n,covariance_effective_rank:null,pca_effective_bets:null,pc1_variance_share:null,average_pairwise_correlation:null,predicted_daily_variance:null,smallest_eigenvalue:null,pca_repeated_eigenvalue_caveat:false};if(!n)return empty;
 const e=eigen(cov);if(!e.converged)throw Error('NUMERICAL_FAILURE: Jacobi did not converge');const scale=Math.max(...e.values.map(Math.abs));if(e.values.some(v=>v< -tolerance*scale))throw Error('Invalid PSD covariance');
 const l=e.values.map(v=>Math.max(0,v)),total=l.reduce((s,v)=>s+v,0),q=probe??l.map(()=>1/n),entropy=(p:number[])=>Math.exp(-p.reduce((s,v)=>s+(v>0?v*Math.log(v):0),0));
 const components=l.map((v,k)=>v*dot(q,e.vectors.map(r=>r[k]))**2),variance=components.reduce((s,v)=>s+v,0);
 return{count:n,covariance_effective_rank:total>0?entropy(l.map(v=>v/total)):null,pca_effective_bets:variance>0?entropy(components.map(v=>v/variance)):null,pc1_variance_share:total>0?l[0]/total:null,average_pairwise_correlation:average(corr.flatMap((r,i)=>r.slice(i+1))),predicted_daily_variance:quadratic(cov,q),smallest_eigenvalue:Math.min(...e.values),pca_repeated_eigenvalue_caveat:l.some((v,i)=>i>0&&Math.abs(v-l[i-1])<=tolerance*scale)};
}
export function subset(model:Correlation,ids:string[],tolerance:number):Breadth {const axis=ids.filter(id=>model.axis_ids.includes(id)).sort(),indices=axis.map(id=>model.axis_ids.indexOf(id));return breadth(indices.map(i=>indices.map(j=>model.covariance[i][j])),indices.map(i=>indices.map(j=>model.correlation[i][j])),tolerance);}
