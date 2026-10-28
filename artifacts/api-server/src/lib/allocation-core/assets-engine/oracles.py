"""Independent synthetic oracles: NumPy eigensystem and SciPy constrained optimization."""
import json,pathlib,numpy as np
from scipy.optimize import minimize
out=pathlib.Path('reports/al03');out.mkdir(exist_ok=True,parents=True)
C=np.array([[.0004,.00008,.00003],[.00008,.0002,.00002],[.00003,.00002,.0003]])
mu=np.array([.0006,.0003,.0004]);prev=np.array([.5,.3,.2]);bounds=[(.1,.7)]*3
constraints=[{'type':'eq','fun':lambda q:q.sum()-1},{'type':'ineq','fun':lambda q:.6-q[0]-q[1]}]
fixtures=[]
for name in ['MIN_VARIANCE','MEAN_VARIANCE','MAX_SHARPE','ERC']:
    gamma=4.;rf=.00005
    def objective(q):
        v=q@C@q
        if name=='MIN_VARIANCE':return v
        if name=='MEAN_VARIANCE':return -(q@mu-gamma/2*v)
        if name=='MAX_SHARPE':return -(q@mu-rf)/np.sqrt(v)
        return np.sum((q*(C@q)/v-1/3)**2)
    cons=constraints if name!='ERC' else [constraints[0]]
    bs=bounds if name!='ERC' else [(1e-8,1)]*3
    solved=minimize(lambda q:objective(q)*10000 if name in ['MIN_VARIANCE','MEAN_VARIANCE'] else objective(q),np.ones(3)/3,bounds=bs,constraints=cons,method='SLSQP',options={'ftol':1e-13,'maxiter':2000})
    assert solved.success,solved.message
    q=solved.x;vals,vec=np.linalg.eigh(C);shares=vals*(vec.T@q)**2;shares=shares/shares.sum();e=vals/vals.sum()
    fixtures.append({'objective':name,'covariance':C.tolist(),'mu':mu.tolist(),'gamma':gamma,'rf':rf,'weights':q.tolist(),
      'bounds':bs,'group_cap':name!='ERC','variance':float(q@C@q),'risk_contributions':(q*(C@q)).tolist(),
      'eigenvalues':sorted(vals.tolist(),reverse=True),'effective_rank':float(np.exp(-sum(e*np.log(e)))),'pca_enb':float(np.exp(-sum(shares*np.log(shares))))})
(out/'oracle-fixtures.json').write_text(json.dumps({'source':'NumPy eigh + independent SciPy SLSQP (no engine calls)','fixtures':fixtures},indent=2)+'\n')
print('Independent oracle fixtures',len(fixtures))
