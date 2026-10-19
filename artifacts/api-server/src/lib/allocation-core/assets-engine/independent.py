"""Reconstruct AL03 artifacts independently; never import optimizer, controller or backtester."""
import csv,datetime,hashlib,itertools,json,pathlib,numpy as np
from scipy.optimize import root as solve_root, minimize
from scipy.linalg import lstsq,toeplitz
R=pathlib.Path('reports/al03');load=lambda name:json.loads((R/name).read_text())
readcsv=lambda name:list(csv.DictReader((R/name).open()))
checks={};tol={'absolute':1e-9,'relative':1e-7,'erc_weights_absolute':2e-8}
def near(a,b,atol=1e-9):
    assert np.allclose(a,b,atol=atol,rtol=1e-7),str((a,b))[:250]
def beta(p,m):
    return float(np.cov(p,m,ddof=1)[0,1]/np.var(m,ddof=1)) if len(p)>=2 and np.var(m,ddof=1)>0 else None
def entropy(p):return float(np.exp(-sum(z*np.log(z) for z in p if z>0)))
manifest=load('manifest.json')
for f,h in manifest['code_hashes'].items():assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h
source=pathlib.Path(manifest['data_source']);assert hashlib.sha256(source.read_bytes()).hexdigest()==manifest['data_hash']
prices=list(csv.DictReader(source.open()));dates=[r['Date'] for r in prices];index={d:i for i,d in enumerate(dates)}
bench=np.array([float(r['SPY']) for r in prices]);bm=bench[1:]/bench[:-1]-1;market=dict(zip(dates[1:],bm));dd=dict(zip(dates,bench/np.maximum.accumulate(bench)-1))
returns={a:np.array([float(r[a]) if r[a] else np.nan for r in prices]) for a in manifest['configuration']['universe']}
returns={a:p[1:]/p[:-1]-1 for a,p in returns.items()}
inputs=load('allocation-inputs.json');solves=load('allocation-solves.json');controllers=load('controller-results.json');targets=load('targets.json')
firsteligible={a:next((dates[i+1] for i in range(252,len(dates)-1) if np.isfinite(returns[a][i-252:i]).all()),None) for a in returns}
for row in readcsv('universe-history.csv'):
    a=row['asset'];i=index[row['signal_date']]-1;expected=np.isfinite(returns[a][i-252:i]).all() and i>=252
    assert (row['eligible']=='true')==expected
    assert row['first_eligible']==firsteligible[a]
    assert row['information_cutoff']==dates[index[row['signal_date']]-1]
checks['universe_and_warmup']='PASS'
for key,x in inputs.items():
    ids=sorted(x['assets']);i=index[x['as_of']]-1;X=np.column_stack([returns[a][i-252:i] for a in ids]);m=bm[i-252:i]
    C=np.cov(X,rowvar=False,ddof=1);betas=np.array([beta(X[:,j],m) for j in range(len(ids))]);near(C,x['risk_model']['covariance']);near(betas,[x['beta_estimates']['values'][a] for a in ids]);assert x['information_cutoff']==dates[i]
    solved=solves[key];assert solved['status']=='VALID';q=np.array([solved['weights'][a] for a in ids]);n=len(q)
    assert q.min()>=-1e-10;near(q.sum(),1)
    kind=x['objective']['type']
    if kind=='EQUAL_WEIGHT':oracle=np.ones(n)/n
    elif kind=='MIN_VARIANCE':
        alternatives=[]
        for k in range(1,n+1):
            for support in itertools.combinations(range(n),k):
                sub=C[np.ix_(support,support)];v=np.linalg.solve(sub,np.ones(k));v/=v.sum()
                if v.min()>=-1e-10:
                    candidate=np.zeros(n);candidate[list(support)]=v;alternatives.append(candidate)
        oracle=min(alternatives,key=lambda v:v@C@v)
    else:
        def condition(w):
            rc=w*(C@w);return np.r_[rc[:-1]/(w@C@w)-1/n,w.sum()-1]
        start=1/np.sqrt(np.diag(C));start/=start.sum();answer=solve_root(condition,start,tol=1e-12)
        assert np.max(np.abs(condition(answer.x)))<1e-9;oracle=answer.x
    near(q,oracle,2e-8);d=solved['diagnostics'];near(d['beta_sleeve'],q@betas);near(d['annualized_volatility'],np.sqrt(252*(q@C@q)))
    vals,V=np.linalg.eigh(C);shares=vals*(V.T@q)**2;shares/=shares.sum();near(d['covariance_effective_rank'],entropy(vals/vals.sum()));near(d['pca_effective_risk_bets'],entropy(shares));near(d['hhi'],q@q);near(d['effective_number_weights'],1/(q@q));near(list(d['risk_contributions'].values()),q*(C@q))
    ctr=controllers[key];composition=ctr['composition'];assert composition['status']=='VALID';p=composition['portfolio'];lam=.30/(q@betas);near(p['exposure_multiplier'],lam);near(p['implied_cash_weight'],1-lam);near(p['expected_final_beta'],.3);near([targets['BETA_NORMALIZED|'+key][a] for a in ids],lam*q)
for date in sorted({k.split('|')[1] for k in controllers}):
    mandates=[v['mandate_hash'] for k,v in controllers.items() if k.endswith('|'+date)];assert len(set(mandates))==1
checks['pit_covariance_beta_and_objectives']='PASS';checks['pca_and_diagnostics']='PASS';checks['immutable_shared_mandate']='PASS'
for row in readcsv('sensitivity.csv'):
    key=row['strategy']+'|'+row['signal_date'];base=solves[key];x=inputs[key];ids=sorted(x['assets']);q=np.array([base['weights'][a] for a in ids]);p=np.array([json.loads(row['weights'])[a] for a in ids]);C=np.array(x['risk_model']['covariance']);level=float(row['scenario'].split('-')[-1]);C2=(1-level)*C+level*np.diag(np.diag(C));b=np.array([x['beta_estimates']['values'][a] for a in ids]);near(float(row['weight_l1']),np.abs(q-p).sum());near(float(row['max_weight_change']),np.abs(q-p).max());near(float(row['beta_change']),(p-q)@b);near(float(row['vol_change']),np.sqrt(252*p@C2@p)-np.sqrt(252*q@C@q));assert row['status']=='VALID'
checks['local_sensitivity']='PASS'
synthetic=load('synthetic-objective-results.json');syntheticsens=readcsv('sensitivity-synthetic.csv')
for row in syntheticsens:
    base=next(r for r in synthetic if r['input']['objective']['type']==row['objective']);x=base['input'];kind=row['objective'];ids=sorted(x['assets']);C=np.array(x['risk_model']['covariance']);mu=np.array([x['expected_returns']['values'][a] for a in ids]) if x['expected_returns'] else np.zeros(len(ids));gamma=x['objective'].get('gamma',1);rf=x['objective'].get('rf_sleeve',0);scenario=row['scenario']
    if scenario.startswith('covariance'):
        level=float(scenario.split('-')[-1]);C=(1-level)*C+level*np.diag(np.diag(C))
    elif scenario.startswith('gamma'):gamma*=float(scenario.split('-')[-1])
    elif scenario.startswith('mu-scale'):mu*=float(scenario.split('-')[-1])
    elif scenario.startswith('mu-rank'):
        distinct=np.unique(mu);gap=np.diff(distinct).min() if len(distinct)>1 else 0
        mu+=np.array([.01*gap*(np.where(distinct==v)[0][0]-(len(distinct)-1)/2)/max(1,len(distinct)) for v in mu])
        assert np.array_equal(np.argsort(mu),np.argsort([x['expected_returns']['values'][a] for a in ids]))
    def loss(q):
        var=q@C@q
        if kind=='EQUAL_WEIGHT':return sum((q-1/len(q))**2)
        if kind=='MIN_VARIANCE':return var*10000
        if kind=='MEAN_VARIANCE':return -(q@mu-gamma/2*var)*10000
        if kind=='MAX_SHARPE':return -(q@mu-rf)/np.sqrt(var)
        return sum((q*(C@q)/var-1/len(q))**2)
    ref=minimize(loss,np.ones(len(ids))/len(ids),method='SLSQP',bounds=[(0,1)]*len(ids),constraints=[{'type':'eq','fun':lambda q:q.sum()-1}],options={'ftol':1e-13,'maxiter':2000})
    assert ref.success;weights=json.loads(row['weights']);q=np.array([weights[a] for a in ids]);near(q,ref.x,1e-6);assert row['status']=='VALID'
checks['all_five_objectives_synthetic_sensitivity']='PASS'
scorecards=load('scorecards.json');economic=readcsv('economic-replay.csv');roll=readcsv('rolling-beta.csv');rows_checked=0;summary=[]
for name,s in scorecards.items():
    ledger=[json.loads(line) for line in (R/(name+'.ledger.jsonl')).read_text().splitlines()];rp=np.array([r['netPnl']/r['beginningNav'] for r in ledger]);rm=np.array([market[r['date']] for r in ledger]);dates_eval=[r['date'] for r in ledger];wealth=np.cumprod(1+rp);days=(datetime.date.fromisoformat(dates_eval[-1])-datetime.date.fromisoformat(ledger[0]['intervalStart'])).days
    near(s['cagr'],wealth[-1]**(365.25/days)-1);near(s['annualized_volatility'],np.std(rp,ddof=1)*np.sqrt(252));near(s['max_drawdown'],np.min(wealth/np.maximum.accumulate(np.r_[1,wealth])[1:]-1));near(s['final_index'],100*wealth[-1]);near(s['full_beta'],beta(rp,rm))
    tailmass=.05*len(rp);cdf=np.r_[0,np.cumsum(np.sort(rp))];es=-np.interp(tailmass,np.arange(len(rp)+1),cdf)/tailmass;near(s['cvar_95'],es)
    conditions={'upside_beta':rm>0,'downside_beta':rm<0,'dd10_beta':np.array([dd[d] for d in dates_eval])<=-.1,'dd20_beta':np.array([dd[d] for d in dates_eval])<=-.2,'tail_q5_beta':rm<=np.quantile(rm,.05),'tail_q1_beta':rm<=np.quantile(rm,.01)}
    for field,mask in conditions.items():near(s[field],beta(rp[mask],rm[mask]))
    X=np.column_stack([np.ones(len(rp)),rm]);coef,*_=lstsq(X,rp);u=rp-X@coef;n=len(u);L=5
    # Independent covariance via score cross-products and shifted matrix multiplication (not TS implementation).
    Z=X*u[:,None];meat=Z.T@Z
    for lag in range(1,L+1):g=Z[lag:].T@Z[:-lag];meat+=(1-lag/(L+1))*(g+g.T)
    bread=np.linalg.inv(X.T@X);se=np.sqrt(np.diag(bread@meat@bread));near(s['capm_alpha_annualized'],252*coef[0]);near(s['capm_alpha_hac_t'],coef[0]/se[0]);near(s['capm_beta'],coef[1])
    expectedrolling=np.array([beta(rp[i-62:i+1],rm[i-62:i+1]) for i in range(62,n)]);got=[r for r in roll if r['candidate']==name];assert len(got)==len(expectedrolling);near(np.array([float(r['value']) for r in got]),expectedrolling);near(s['mean_rolling63_beta'],expectedrolling.mean())
    turnover=0;fees=0;previous={};last_cash=manifest['configuration']['initial_nav'];initial_nav=last_cash
    for r in ledger:
        begin={p['ticker']:p['quantity'] for p in r['beginningPositions']};end={p['ticker']:p['quantity'] for p in r['endingPositions']};assert set(begin)==set(previous)
        for a,v in begin.items():near(v,previous[a]);near(r['beginningCash'],last_cash,1e-7)
        trade={t['ticker']:t['quantity'] for t in r['trades']};assert all(abs(end.get(a,0)-begin.get(a,0)-trade.get(a,0))<1e-7 for a in set(end)|set(begin)|set(trade));assert not r['trades'] or r['executionSignalDate']
        gross=sum(abs(t['notional']) for t in r['trades']);fees+=r['transactionCosts'];turnover+=gross/(r['beginningNav']+r['etfPnl']+r['cashPnl']);near(r['transactionCosts'],gross*s['cost_bps']/10000,1e-7);near(r['endingNav'],r['endingCash']+sum(p['marketValue'] for p in r['endingPositions']),1e-7);near(r['endingCash'],r['beginningCash']-sum(t['notional'] for t in r['trades'])-r['transactionCosts'],1e-7)
        idx=index[r['date']];pnl=sum(v*(float(prices[idx][a])-float(prices[idx-1][a])) for a,v in begin.items());near(r['etfPnl'],pnl,1e-7);near(r['netPnl'],r['endingNav']-r['beginningNav'],1e-7)
        if r['executionSignalDate']:
            sig=r['executionSignalDate'];assert dates[index[sig]+1]==r['date'];q=targets[s['mode']+'|'+s['strategy']+'|'+sig]
            for a in manifest['configuration']['universe']:near(next((p['weight'] for p in r['endingPositions'] if p['ticker']==a),0),q.get(a,0))
        previous=end;last_cash=r['endingCash'];rows_checked+=1
    near(s['turnover_gross'],turnover);near(s['costs_nav_units'],fees,1e-7);near(ledger[-1]['endingNav']/initial_nav,wealth[-1]);summary.append({'candidate':name,'status':'PASS','observations':n})
checks['metrics_conditional_rolling_capm_hac']='PASS';checks['real_ledger_accounting_execution']='PASS'
assert len(economic)==12 and len(scorecards)==12
for f in ['allocation-results.csv','risk-diagnostics.csv','diversification-diagnostics.csv','sensitivity.csv','universe-history.csv','economic-replay.csv']:
    data=(R/f).read_bytes();assert b'\r\n' in data;list(csv.DictReader((R/f).open()))
checks['persistence_rfc4180']='PASS'
output={'status':'PASS','checks':checks,'allocations_independently_reconstructed':len(inputs),'ledger_rows_reconciled':rows_checked,'scorecards':summary,'tolerances':tol,'method':'NumPy sample covariance/eigh, independent support min-var, SciPy root ERC, SVD CAPM + HAC score covariance'}
(R/'independent-verification.json').write_text(json.dumps(output,indent=2)+'\n');print(json.dumps(output))
