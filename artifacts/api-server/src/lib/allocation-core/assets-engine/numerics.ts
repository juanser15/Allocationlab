export const dot=(a:number[],b:number[])=>a.reduce((s,x,i)=>s+x*b[i],0);
export const mv=(a:number[][],x:number[])=>a.map(row=>dot(row,x));
export const quadratic=(a:number[][],x:number[])=>dot(x,mv(a,x));
/** Deterministic pivoted elimination. A singular system is rejected, never pseudoinverted. */
export function linear(a:number[][],b:number[]):number[]|null {
 const n=b.length,m=a.map((r,i)=>[...r,b[i]]),scale=Math.max(...a.flat().map(Math.abs));
 if(!scale)return null;
 for(let k=0;k<n;k++) {let p=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[p][k]))p=i;
  if(Math.abs(m[p][k])<=64*Number.EPSILON*n*scale)return null;[m[k],m[p]]=[m[p],m[k]];
  const d=m[k][k];for(let j=k;j<=n;j++)m[k][j]/=d;
  for(let i=0;i<n;i++)if(i!==k){const t=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=t*m[k][j];}}
 const x=m.map(r=>r[n]);return x.every(Number.isFinite)?x:null;
}
export function* combinations(n:number,k:number,start=0,prefix:number[]=[]):Generator<number[]> {
 if(k===0){yield prefix;return;}for(let i=start;i<=n-k;i++)yield*combinations(n,k-1,i+1,[...prefix,i]);
}
export function choose(n:number,k:number){let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;}
/** Jacobi eigendecomposition, eigenvectors in columns, sorted descending. */
export function eigen(matrix:number[][],maxIterations=10000) {
 const n=matrix.length,a=matrix.map(r=>[...r]),v=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0) as number[]);
 const scale=Math.max(...matrix.flat().map(Math.abs));let iterations=0,converged=scale===0;
 for(;iterations<maxIterations&&!converged;iterations++) {
  let p=0,q=0,largest=0;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)if(Math.abs(a[i][j])>largest){largest=Math.abs(a[i][j]);p=i;q=j;}
  if(largest<=64*Number.EPSILON*Math.max(1,n)*scale){converged=true;break;}
  const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(angle),s=Math.sin(angle);
  const pp=a[p][p],qq=a[q][q],pq=a[p][q];
  for(let k=0;k<n;k++)if(k!==p&&k!==q){const kp=a[k][p],kq=a[k][q];a[k][p]=a[p][k]=c*kp-s*kq;a[k][q]=a[q][k]=s*kp+c*kq;}
  a[p][p]=c*c*pp-2*c*s*pq+s*s*qq;a[q][q]=s*s*pp+2*c*s*pq+c*c*qq;a[p][q]=a[q][p]=0;
  for(let k=0;k<n;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-s*kq;v[k][q]=s*kp+c*kq;}
 }
 const order=Array.from({length:n},(_,i)=>i).sort((i,j)=>a[j][j]-a[i][i]||i-j);
 return {values:order.map(i=>a[i][i]),vectors:v.map(r=>order.map(i=>r[i])),iterations,converged};
}
