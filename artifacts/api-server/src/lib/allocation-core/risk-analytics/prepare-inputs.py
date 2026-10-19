"""Read frozen CL02 only; independent NumPy/SciPy oracles; no backtester imports."""
from pathlib import Path
import csv,json,hashlib
import numpy as np
from scipy.linalg import lstsq
ROOT=Path('reports/al02');ROOT.mkdir(exist_ok=True)
def rows(path):
    with path.open(newline='') as f:return list(csv.DictReader(f))
def dump(path,obj):path.write_text(json.dumps(obj,indent=2,allow_nan=False)+'\n')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=Path('reports/cl02');names=[f'{c}_{bps}bps' for c in ['A','B','B_control'] for bps in [0,5]]
price_rows=rows(source/'adjusted-closes.csv')
prices=[dict(date=r['Date'],adjusted_close=float(r['SPY'])) for r in price_rows]
asset_returns=[dict(date=r['Date'],values={k:float(r[k])/float(price_rows[i-1][k])-1 for k in ['SPY','TLT']})for i,r in enumerate(price_rows)if i>0]
ledgers={}
for name in names:
    values=[]
    for raw in rows(source/(name+'.ledger.standard.csv')):
        r={k:float(raw[k]) for k in ['beginningNav','beginningCash','endingNav','endingCash','etfPnl','cashPnl','transactionCosts','slippage','netPnl','dailyReturn','targetSPY','effectiveSPYBeginning','effectiveSPYClose']}
        r.update({k:raw[k] for k in ['date','intervalStart','signalDate','executionSignalDate']})
        r['trades']=json.loads(raw['trades']);r['beginningPositions']=json.loads(raw['beginningPositions']);r['endingPositions']=json.loads(raw['endingPositions'])
        actual=sum(abs(t['notional']) for t in r['trades']);bps=int(name.split('_')[-1][:-3])
        assert abs(r['transactionCosts']-actual*bps/10000)<1e-7
        assert abs(r['endingNav']-r['endingCash']-sum(p['marketValue']for p in r['endingPositions']))<1e-7
        assert abs(r['endingNav']-r['beginningNav']-r['netPnl'])<1e-7
        assert abs(r['dailyReturn']-r['netPnl']/r['beginningNav'])<1e-12
        values.append(r)
    ledgers[name]=values
dump(ROOT/'input-snapshot.json',dict(prices=prices,asset_returns=asset_returns,ledgers=ledgers))
# Independent regression reference: SciPy SVD least-squares; direct unscaled design.
# HAC meat is a full Toeplitz weighted residual covariance matrix, not core lag loops.
oracles={}
for model in ['CAPM','TREYNOR_MAZUY']:
    x=np.repeat(np.arange(-4,5)*.01,3);noise=np.tile([.0003,-.0006,.0003],9);rf=np.full(len(x),.00001)
    gamma=0 if model=='CAPM' else 3
    y=.0002+.7*x+gamma*x*x+noise
    X=np.column_stack([np.ones(len(x)),x]+([x*x]if gamma else []));coef=lstsq(X,y)[0];res=y-X@coef
    inv=np.linalg.inv(X.T@X);covOLS=inv*(res@res)/(len(x)-X.shape[1])
    lag=5;distance=np.abs(np.arange(len(x))[:,None]-np.arange(len(x))[None,:]);weights=np.where(distance<=lag,1-distance/(lag+1),0)
    covHAC=inv@(X.T@(weights*np.outer(res,res))@X)@inv
    from datetime import date,timedelta
    pairs=[dict(date=(date(2026,1,1)+timedelta(days=i)).isoformat(),portfolio=float(y[i]+rf[i]),market=float(x[i]+rf[i]),rf=float(rf[i]))for i in range(len(x))]
    oracles[model]=dict(pairs=pairs,coefficients=coef.tolist(),OLS=dict(covariance=covOLS.tolist(),standard_errors=np.sqrt(np.diag(covOLS)).tolist(),t=(coef/np.sqrt(np.diag(covOLS))).tolist()),HAC=dict(covariance=covHAC.tolist(),standard_errors=np.sqrt(np.diag(covHAC)).tolist(),t=(coef/np.sqrt(np.diag(covHAC))).tolist()),r_squared=float(1-res@res/((y-y.mean())@(y-y.mean()))))
# Conditioned beta state oracle with history before sample starts in drawdown.
from datetime import date,timedelta
x=np.linspace(-.025,.035,200);y=.65*x+2*x*x+.0001*np.sin(np.arange(200))
history=[dict(date='2024-12-30',adjusted_close=150.),dict(date='2024-12-31',adjusted_close=100.)];pairs=[];price=100.
for i,(a,b) in enumerate(zip(x,y)):
    d=(date(2025,1,1)+timedelta(days=i)).isoformat();price*=1+a;history.append(dict(date=d,adjusted_close=price));pairs.append(dict(date=d,portfolio=float(b),market=float(a),rf=0.))
dd=np.array([p['adjusted_close'] for p in history]);dd=dd/np.maximum.accumulate(dd)-1;dd=dd[2:]
def beta(mask):
    v=np.cov(y[mask],x[mask],ddof=1);return dict(value=float(v[0,1]/v[1,1]),observations=int(np.sum(mask)))
masks={'full':np.ones(len(x),dtype=bool),'upside':x>0,'downside':x<0,**{f'DD{int(t*100)}':dd<=-t for t in [.05,.10,.20]},**{f'Q{int(q*100)}':x<=np.quantile(x,q,method='linear')for q in [.05,.01]}}
conditional={name:beta(mask)for name,mask in masks.items()}
for name,mask in [('up_capture',x>0),('down_capture',x<0)]:conditional[name]=float((np.prod(1+y[mask])**(1/np.sum(mask))-1)/(np.prod(1+x[mask])**(1/np.sum(mask))-1))
dump(ROOT/'oracle-fixtures.json',dict(regressions=oracles,conditional=dict(pairs=pairs,history=history,expected=conditional),oracle_methods={'regression':'scipy.linalg.lstsq SVD, direct unscaled X','HAC':'Toeplitz Bartlett lag-5, no df correction, matrix sandwich','beta':'numpy.cov ddof=1','capture':'independent product/power','drawdown':'numpy.maximum.accumulate full benchmark history'}))
inputs={str(source/(name+'.ledger.standard.csv')):sha(source/(name+'.ledger.standard.csv'))for name in names}
inputs[str(source/'adjusted-closes.csv')]=sha(source/'adjusted-closes.csv');inputs[str(source/'manifest.json')]=sha(source/'manifest.json')
dump(ROOT/'input-hashes.json',inputs)
print('Read-only CL02 snapshot + independent oracles saved; 6 ledgers,',len(prices),'SPY price sessions')
