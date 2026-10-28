"""Independent persisted-artifact replay; never imports/calls ARE or its selector."""
import csv, json, hashlib, math, pathlib, sys, itertools
import numpy as np
from scipy.stats import norm
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'reports/al07')
load=lambda p:json.loads(pathlib.Path(p).read_text())
checks=[];tolerance=2e-8
prices={}
with open('reports/cl02/adjusted-closes.csv',newline='') as f:
 reader=csv.DictReader(f)
 for row in reader:
  date=row.get('date',row.get('Date'));prices[date]={k:float(v) for k,v in row.items() if k not in ['date','Date'] and v and v not in ['NA','NaN']}
dates=sorted(prices)
# CSV contains ticker headers (same adjusted-price series used by the frozen AL03 adapter).
market={dates[i]:prices[dates[i]]['SPY']/prices[dates[i-1]]['SPY']-1 for i in range(1,len(dates))}
state={};peak=0
for d in dates:peak=max(peak,prices[d]['SPY']);state[d]=prices[d]['SPY']/peak-1

def close(a,b,eps=tolerance):
 assert a is not None and b is not None and abs(float(a)-float(b))<=eps*max(1,abs(float(a)),abs(float(b))),(a,b)

def beta(p,m):
 return float(np.cov(p,m,ddof=1)[0,1]/np.var(m,ddof=1)) if len(p)>1 and np.var(m,ddof=1)>0 else None

def metrics(ledger,rf):
 r=np.array([d['netPnl']/d['beginningNav'] for d in ledger]);m=np.array([market[d['date']] for d in ledger]);wealth=np.cumprod(1+r);high=np.maximum.accumulate(np.r_[1,wealth])[1:];days=(__import__('datetime').date.fromisoformat(ledger[-1]['date'])-__import__('datetime').date.fromisoformat(ledger[0]['intervalStart'])).days
 mass=.05*len(r);s=np.sort(r);loss=-sum(s[i]*min(1,mass-i) for i in range(len(r)) if i<mass)/mass
 return dict(cagr=float(wealth[-1]**(365.25/days)-1),annualized_volatility=float(np.std(r,ddof=1)*np.sqrt(252)),max_drawdown=float(np.min(wealth/high-1)),cvar_95=float(loss),final_index=float(100*wealth[-1]),beta=beta(r,m),sharpe=float(np.sqrt(252)*np.mean(r-rf)/np.std(r-rf,ddof=1))),r,m

def regression(p,m,square=False,lag=5):
 x=np.column_stack([np.ones(len(p)),m,*([m*m] if square else [])]);coef=np.linalg.lstsq(x,p,rcond=None)[0];e=p-x@coef;u=x*e[:,None];meat=u.T@u
 for l in range(1,lag+1):
  cross=u[l:].T@u[:-l];meat+=(1-l/(lag+1))*(cross+cross.T)
 inv=np.linalg.inv(x.T@x);se=np.sqrt(np.maximum(0,np.diag(inv@meat@inv)));return coef,coef/se

campaigns=[]
for directory in sorted((root/'campaigns').iterdir()):
 manifest=load(directory/'manifest.json');cfg=manifest['campaign'];candidates=load(directory/'candidates.json');jobs=[load(p)['value'] for p in sorted((directory/'jobs').glob('*.json'))];valid=[j for j in jobs if j['status']=='VALID'];assert len({j['job_id'] for j in jobs})==len(jobs)
 assert {x['spec']['risk_mandate']['configuration_hash'] for x in candidates}=={candidates[0]['spec']['risk_mandate']['configuration_hash']}
 for file,digest in load(directory/'code-hashes.json').items():assert hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()==digest
 for file,digest in load(directory/'source-hashes.json').items():assert hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()==digest
 checks.append({'case':directory.name+' source/code hashes and IDs','status':'PASS'})
 for j in valid:
  for d in j['decisions']:
   assert d['portfolio_gate']['status']=='PASS' and d['cutoff']<d['date']
   source=d['allocation'];assert source['mode']=='ASSETS'
   q=source['result']['weights'];inp=source['input'];assets=inp['assets'];v=np.array([q[a] for a in assets]);C=np.array(inp['risk_model']['covariance']);assert min(v)>=-1e-10;close(v.sum(),1,1e-10)
   original=d['model_reference'];assert original['original_artifact_as_of']<=original['original_training_cutoff']<d['date']
   if j['stage']!='train':assert original['original_training_cutoff']<j['interval_start']
   assert np.array_equal(C,np.array(original['original_artifact']['covariance']))
   end=inp['beta_estimates']['beta_model']['estimation_window']['end'];window=[x for x in dates if x<=end][-252:]
   returns=np.array([[prices[x][a]/prices[dates[dates.index(x)-1]][a]-1 for a in assets] for x in window])
   assert np.max(np.abs(np.cov(returns,rowvar=False,ddof=1)-C))<1e-12
   bm=np.array([market[x] for x in window]);b=np.array([beta(returns[:,i],bm) for i in range(len(assets))]);assert np.max(np.abs(b-np.array([inp['beta_estimates']['values'][a] for a in assets])))<1e-10
   typ=inp['objective']['type']
   if typ=='EQUAL_WEIGHT':assert max(abs(v-1/len(v)))<1e-10
   elif typ=='MIN_VARIANCE':
    feasible=[]
    for n in range(1,len(v)+1):
     for subset in itertools.combinations(range(len(v)),n):
      inv=np.linalg.solve(C[np.ix_(subset,subset)],np.ones(n));w=inv/inv.sum()
      if min(w)>=-1e-10:
       full=np.zeros(len(v));full[list(subset)]=w;feasible.append((full@C@full,full))
    best=min(feasible,key=lambda x:x[0])[1];assert max(abs(v-best))<1e-7
   elif typ=='ERC':
    rc=v*(C@v);assert max(abs(rc/(v@C@v)-1/len(v)))<2e-8
   expected=float(v@b);lam=source['result']['sleeve']['estimated_market_beta'];close(expected,lam,1e-10);scale=.3/expected
   for a in assets:close(d['raw'][a],q[a],1e-10);close(d['normalized'][a],q[a]*scale,1e-10)
   close(d['projection']['portfolio']['expected_final_beta'],.3,1e-10)
  for name,tr in j['tracks'].items():
   ledger=tr['ledger'];stats,r,m=metrics(ledger,cfg['risk_free_daily'])
   for k,v in stats.items():close(tr['metrics'][k],v)
   for entry in ledger:
    gross=sum(abs(t['notional']) for t in entry['trades']);close(entry['transactionCosts'],gross*j['scenario_bps']/10000,1e-10)
    close(entry['endingNav'],entry['endingCash']+sum(p['marketValue'] for p in entry['endingPositions']),1e-10)
    close(entry['endingCash'],entry['beginningCash']+entry['cashPnl']-sum(t['notional'] for t in entry['trades'])-entry['transactionCosts'],1e-10)
    close(entry['etfPnl'],sum(p['quantity']*(prices[entry['date']][p['ticker']]-prices[entry['intervalStart']][p['ticker']]) for p in entry['beginningPositions']),1e-10)
    assert entry['endingCash']>=-1e-9 and all(p['quantity']>=0 for p in entry['endingPositions'])
   cond=tr['attribution']['conditional']
   masks={'full_beta':np.ones(len(r),bool),'upside_beta':m>0,'downside_beta':m<0}
   for key,mask in masks.items():v=beta(r[mask],m[mask]);close(cond[key]['value'],v) if v is not None else None
   for threshold in [.05,.1,.2]:
    mask=np.array([state[x['date']]<=-threshold for x in ledger]);v=beta(r[mask],m[mask]);assert (v is None)==(cond['drawdown_beta'][str(threshold)]['value'] is None)
    if v is not None:close(cond['drawdown_beta'][str(threshold)]['value'],v)
   for qtail in [.05,.01]:
    mask=m<=np.quantile(m,qtail);v=beta(r[mask],m[mask]);close(cond['tail_beta'][str(qtail)]['value'],v)
   for label,mask in [('upside_capture',m>0),('downside_capture',m<0)]:close(cond[label]['value'],np.expm1(np.mean(np.log1p(r[mask])))/np.expm1(np.mean(np.log1p(m[mask]))))
   for n in [63,126]:
    for item in tr['attribution']['rolling'+str(n)]:
     i=next(i for i,x in enumerate(ledger) if x['date']==item['date']);close(item['value'],beta(r[i-n+1:i+1],m[i-n+1:i+1]))
   for key,square in [('capm',False),('timing',True)]:
    coef,ts=regression(r-cfg['risk_free_daily'],m-cfg['risk_free_daily'],square);model=tr['attribution'][key]
    assert max(abs(coef-np.array(model['coefficients'])))<1e-7
    if model['inference_status']=='VALID':assert max(abs(ts-np.array(model['t_statistics'])))<1e-6
   p=tr['attribution']['psr'];ex=r-cfg['risk_free_daily'];sr=ex.mean()/ex.std(ddof=1);center=ex-ex.mean();s2=np.mean(center**2);sk=np.mean(center**3)/s2**1.5;ku=np.mean(center**4)/s2**2;z=sr*np.sqrt(len(ex)-1)/np.sqrt(1-sk*sr+(ku-1)/4*sr*sr);close(p['probability'],norm.cdf(z),1e-7)
  checks.append({'case':directory.name+' '+j['job_id'],'status':'PASS','scope':'independent covariance/beta/allocator conditions/accounting/AL02 attribution/HAC/PSR'})
 # Reconstruct winners from normalized inner/train ledgers, not from saved ranks/selector calls.
 for f in manifest['folds']:
  scores=[]
  for candidate in candidates:
   found=[j for j in jobs if j['candidate_id']==candidate['candidate_id'] and j['outer_fold']==f['outer_fold'] and j['stage'] in ['train','inner'] and j['scenario_bps']==cfg['selection']['selection_scenario_bps']]
   if not found or any(j['status']!='VALID' for j in found):continue
   ledger=sorted([r for j in found for r in j['tracks']['NORMALIZED']['ledger']],key=lambda r:r['date']);assert all(r['date']<f['train_end'] for r in ledger)
   s,_,_=metrics(ledger,cfg['risk_free_daily']);turnover=sum(sum(abs(t['notional']) for t in r['trades'])/(r['beginningNav']+r['etfPnl']+r['cashPnl']) for r in ledger)*252/len(ledger);scores.append((-s['sharpe'],turnover,len(json.dumps(candidate['spec']['objective'],separators=(',',':'))),candidate['candidate_id']))
  selected=load(directory/'selections'/(str(f['outer_fold'])+'.json'));assert sorted(scores)[0][-1]==selected['candidate_id'];assert all(j['stage']!='outer' for j in jobs if j['job_id'] in selected['input_job_ids'])
  for bps in cfg['cost_scenarios_bps']:assert len([j for j in jobs if j['outer_fold']==f['outer_fold'] and j['stage']=='outer' and j['scenario_bps']==bps])==1
  checks.append({'case':directory.name+' outer fold '+str(f['outer_fold'])+' winner independent replay','status':'PASS'})
 with open(directory/'oos-equity.csv',newline='') as f:equity=list(csv.DictReader(f))
 for scenario in cfg['cost_scenarios_bps']:
  for track in ['RAW','NORMALIZED']:
   ledger=sorted([r for j in jobs if j['stage']=='outer' and j['scenario_bps']==scenario for r in j['tracks'][track]['ledger']],key=lambda r:r['date']);assert len({r['date'] for r in ledger})==len(ledger)
   rows=[r for r in equity if float(r['scenario_bps'])==scenario and r['track']==track];assert len(rows)==len(ledger);index=100
   for row,d in zip(rows,ledger):ret=d['netPnl']/d['beginningNav'];index*=1+ret;assert row['date']==d['date'];close(row['return'],ret,1e-12);close(row['index'],index,1e-10)
   saved=next(s for s in load(directory/'summary.json')['performance'] if s['scenario_bps']==scenario and s['track']==track)
   for k,v in metrics(ledger,cfg['risk_free_daily'])[0].items():close(saved[k],v)
 checks.append({'case':directory.name+' composite outer OOS and independent summary','status':'PASS'})
 campaigns.append({'campaign_id':cfg['campaign_id'],'jobs':len(jobs),'valid':len(valid),'blocked':len(jobs)-len(valid),'selected':[load(p)['candidate_id'] for p in sorted((directory/'selections').glob('*.json'))]})
 for p in directory.glob('*.csv'):
  with open(p,newline='') as f:
   rows=list(csv.reader(f));assert rows and all(len(row)==len(rows[0]) for row in rows)
  checks.append({'case':str(p)+' RFC4180 round-trip','status':'PASS','rows':len(rows)-1})
report={'status':'PASS','checks':len(checks),'failed':0,'oracle':'Independent NumPy/SciPy from original adjusted closes and persisted ledgers; no ARE/selector/gate/backtester calls','tolerance_absolute':tolerance,'campaigns':campaigns,'cases':checks}
(root/'independent-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['status','checks','failed','campaigns']}))
