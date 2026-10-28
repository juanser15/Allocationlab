"""Artifact-only external AL02 audit: NumPy/SciPy, no TS analytics functions."""
from pathlib import Path
import csv,json,hashlib
import numpy as np
from scipy.linalg import lstsq
from datetime import date
r=Path('reports/al02');s=json.loads((r/'scorecards.json').read_text());inp=json.loads((r/'input-snapshot.json').read_text());manifest=json.loads((r/'manifest.json').read_text())
def near(a,b,label):
    assert a is not None and np.isfinite(a) and abs(a-b)<=1e-9+1e-8*abs(b),(label,a,b)
def table(p):
    raw=p.read_bytes();assert b'\n' not in raw.replace(b'\r\n',b''),p
    with p.open(newline='')as f:return list(csv.DictReader(f,strict=True))
prices=inp['prices'];market={p['date']:p['adjusted_close']/prices[i-1]['adjusted_close']-1 for i,p in enumerate(prices)if i}
states=np.array([p['adjusted_close']for p in prices]);states=states/np.maximum.accumulate(states)-1;dd=dict(zip([p['date']for p in prices],states))
counter=json.loads((r/'constant-beta-diagnostic.json').read_text());verified=[]
for name,out in s.items():
    if name in inp['ledgers']:
        ledger=inp['ledgers'][name];rp=np.array([x['dailyReturn']for x in ledger]);dates=[x['date']for x in ledger];start=ledger[0]['intervalStart']
    else:
        source=counter[name]['calibrated_on'];ledger=inp['ledgers'][source];dates=[x['date']for x in ledger];rp=np.array([market[d]*counter[name]['beta_target']for d in dates]);start=ledger[0]['intervalStart']
    rm=np.array([market[d]for d in dates]);wealth=np.cumprod(1+rp);high=np.maximum.accumulate(np.r_[1,wealth])[1:];days=(date.fromisoformat(dates[-1])-date.fromisoformat(start)).days
    near(out['cagr'],wealth[-1]**(365.25/days)-1,name+' CAGR');near(out['annualized_volatility'],np.std(rp,ddof=1)*np.sqrt(252),name+' vol');near(out['max_drawdown'],np.min(wealth/high-1),name+' DD')
    tailmass=.05*len(rp);loss=-np.interp(tailmass,np.arange(len(rp)+1),np.r_[0,np.cumsum(np.sort(rp))])/tailmass;near(out['cvar_95'],loss,name+' CVaR')
    masks={'full':np.ones(len(rp),bool),'up':rm>0,'down':rm<0,**{f'DD{t}':np.array([dd[d]<=-t/100 for d in dates])for t in [5,10,20]},**{f'Q{q}':rm<=np.quantile(rm,q/100,method='linear')for q in [5,1]}}
    for key,mask in masks.items():
        cov=np.cov(rp[mask],rm[mask],ddof=1);expected=cov[0,1]/cov[1,1];actual=out['condition']['full_beta']if key=='full'else out['condition']['upside_beta']if key=='up'else out['condition']['downside_beta']if key=='down'else out['condition']['drawdown_beta'][str(int(key[2:])/100)]if key.startswith('DD')else out['condition']['tail_beta'][str(int(key[1:])/100)]
        near(actual['value'],expected,name+' '+key);assert actual['observations']==int(mask.sum())
    for key,mask in [('upside_capture',rm>0),('downside_capture',rm<0)]:near(out['condition'][key]['value'],(np.prod(1+rp[mask])**(1/mask.sum())-1)/(np.prod(1+rm[mask])**(1/mask.sum())-1),name+' '+key)
    for window in [63,126]:
        recorded=[x for x in table(r/'rolling-beta-cl02.csv')if x['candidate']==name and int(x['window'])==window];assert len(recorded)==len(rp)-window+1
        values=[]
        for i,x in enumerate(recorded):
            cov=np.cov(rp[i:i+window],rm[i:i+window],ddof=1);expected=cov[0,1]/cov[1,1];near(float(x['value']),expected,name+' rolling');values.append(expected)
        if window==63:near(out['average_beta'],float(np.mean(values)),name+' average rolling beta')
    for model,key in [('CAPM','capm'),('TREYNOR_MAZUY','treynor_mazuy')]:
        X=np.column_stack([np.ones(len(rp)),rm]+([rm*rm]if model=='TREYNOR_MAZUY'else[]));coef=lstsq(X,rp)[0];res=rp-X@coef;actual=out[key]
        for i,v in enumerate(coef):near(actual['coefficients'][i],v,name+' '+model+' coefficient')
        if name in inp['ledgers']:
            inv=np.linalg.inv(X.T@X);d=np.abs(np.arange(len(rp))[:,None]-np.arange(len(rp))[None,:]);W=np.where(d<=5,1-d/6,0);cov=inv@(X.T@(W*np.outer(res,res))@X)@inv;se=np.sqrt(np.diag(cov));ts=coef/se
            for i,v in enumerate(se):near(actual['standard_errors'][i],v,name+' '+model+' HAC SE')
            for i,v in enumerate(ts):near(actual['t_statistics'][i],v,name+' '+model+' HAC t')
        else:
            assert actual['inference_status']=='INSUFFICIENT_DATA' and actual['t_alpha']is None and actual['t_beta']is None
        near(actual['r_squared'],1-res@res/((rp-rp.mean())@(rp-rp.mean())),name+' R2')
    if name in inp['ledgers']:
        fees=sum(x['transactionCosts']for x in ledger);turn=sum(sum(abs(t['notional'])for t in x['trades'])/(x['beginningNav']+x['etfPnl']+x['cashPnl'])for x in ledger)
        near(out['costs_nav_units'],fees,name+' fees');near(out['turnover_gross'],turn,name+' turnover');near(out['mean_risky_allocation'],np.mean([x['effectiveSPYBeginning']for x in ledger]),name+' exposure')
    verified.append(dict(candidate=name,status='PASS',observations=len(rp)))
required=['metrics-cl02.csv','rolling-beta-cl02.csv','conditional-beta-cl02.csv','alpha-timing-cl02.csv','capital-efficiency-cl02.csv','controller-replay.csv','pit-estimates.csv']
counts={p:len(table(r/p))for p in required};assert counts['metrics-cl02.csv']==8 and counts['alpha-timing-cl02.csv']==16 and counts['controller-replay.csv']==1392
for p,h in manifest['inputHashes'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h
for p,h in manifest['codeHashes'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h
(r/'independent-verification.json').write_text(json.dumps(dict(status='PASS',candidates=verified,row_counts=counts,method='NumPy cov/std/full benchmark high-water, SciPy SVD OLS, Toeplitz lag5 HAC',engine_calls=0,tolerance=dict(absolute=1e-9,relative=1e-8)),indent=2)+'\n')
print('PASS: 8 scorecards, rolling/conditioned state/capture, HAC regressions, accounting and artifact hashes independently reconstructed')
