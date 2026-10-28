"""Independent CL04 auditor: read persisted artifacts, no engine calls/imports.

Sample variance uses the pairwise identity, folds integer month arithmetic,
ranking a separate comparator. Absolute 1e-8 + relative 1e-10 tolerances.
Checks frozen CL03 campaigns read-only as well as synthetic QA campaigns.
"""
import csv
import io
import json
import math
import hashlib
import sys
from pathlib import Path
from functools import cmp_to_key

REQUIRED = ['manifest.json','candidate-space.json','candidates.csv','folds.csv',
 'inner-results.csv','outer-results.csv','selected-by-fold.csv','failures.csv',
 'oos-ledger.csv','oos-equity.csv','selection-stability.csv','summary.json','REPORT.md']

def load(p):
    return json.loads(p.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))

def table(p, strict):
    raw=p.read_bytes()
    if strict:
        assert b'\n' not in raw.replace(b'\r\n',b''), f'RFC4180 line ending {p}'
    with p.open(newline='') as f:
        parsed=list(csv.reader(f,strict=True))
    assert parsed and all(len(r)==len(parsed[0]) for r in parsed[1:]), str(p)
    output=io.StringIO(newline=''); csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator='\r\n' if strict else '\n').writerows(parsed)
    assert output.getvalue().encode()==raw, f'CSV quote round trip {p}'
    return [dict(zip(parsed[0],r)) for r in parsed[1:]]

def near(a,b,label):
    if b is None: assert a is None, label; return
    assert math.isfinite(a) and math.isfinite(b) and abs(a-b)<=1e-8+1e-10*abs(b), (label,a,b)

def metric(rows,ref):
    n=len(rows); assert n>0
    x=[r['net_return']-ref for r in rows]
    var=sum((a-b)**2 for i,a in enumerate(x) for b in x[i+1:])/(n*(n-1)) if n>1 else 0
    mean=x[0]+math.fsum(v-x[0] for v in x)/n
    index=1.; high=1.; dd=0.
    for r in rows:
        assert r['net_return']>-1
        index*=1+r['net_return']; high=max(high,index);dd=min(dd,index/high-1)
    cagr=index**(252/n)-1;turn=math.fsum(r['turnover'] for r in rows)
    return dict(observations=n,cagr=cagr,net_sharpe=mean/math.sqrt(var)*math.sqrt(252) if var else None,
        max_drawdown=dd,return_drawdown_ratio=cagr/-dd if dd<0 else None,volatility=math.sqrt(var)*math.sqrt(252),
        turnover=turn,turnover_annualized=turn*252/n,costs=math.fsum(r['costs'] for r in rows),
        exposure=math.fsum(r['exposure'] for r in rows)/n,final_index=index*100)

def match(a,b,label):
    for k,v in b.items():near(a[k],v,f'{label}.{k}')

def month(d): return int(d[:4])*12+int(d[5:7])-1
def date(m): return f'{m//12:04}-{m%12+1:02}-01'
def frames(start,end,train,test,step,window,outer=None):
    out=[];t=month(start)+train
    while t+test<=month(end):
        f=dict(outer_fold=len(out) if outer is None else outer,train_start=date(t-train) if window=='rolling' else start,
               train_end=date(t),test_start=date(t),test_end=date(t+test))
        if outer is not None:f['inner_fold']=len(out)
        out.append(f);t+=step
    return out

def observations(ledger,scenario):
    result=[]
    for d in ledger:
        nav=d['beginningNav']; assert nav>0 and d['endingNav']>0
        bp=d['beginningPositions'];ep=d['endingPositions'];trades=d['trades']
        actual=math.fsum(abs(t['notional']) for t in trades)
        near(d['transactionCosts'],actual*scenario/10000,'fees=actual notional*bps')
        near(d['endingNav'],d['endingCash']+math.fsum(p['quantity']*p['price'] for p in ep),'NAV book')
        near(d['endingNav'],nav+d['etfPnl']+d['cashPnl']-d['transactionCosts']-d['slippage'],'NAV reconciliation')
        near(d['endingCash'],d['beginningCash']+d['cashPnl']-math.fsum(t['notional'] for t in trades)-d['transactionCosts']-d['slippage'],'cash reconciliation')
        assert d['endingCash']>=-1e-8 and all(p['quantity']>=0 for p in ep)
        if not d.get('executionSignalDate'): assert not trades
        result.append(dict(date=d['date'],net_return=d['netPnl']/nav,turnover=actual/(nav+d['etfPnl']+d['cashPnl']),
          costs=d['transactionCosts'],exposure=math.fsum(p['marketValue'] for p in bp)/nav))
    return result

def audit(root):
    strict='cl04' in str(root); tables={}
    for name in REQUIRED: assert (root/name).is_file(), f'missing {root/name}'
    for p in root.glob('*.csv'): tables[p.name]=table(p,strict)
    for p in root.rglob('*.json'):
        v=load(p); assert json.loads(json.dumps(v,allow_nan=False))==v
    manifest=load(root/'manifest.json'); c=manifest['campaign'];summary=load(root/'summary.json')
    assert manifest['experiment_hash']==summary['experiment_hash']
    assert load(root/'candidate-space.json')==c['candidate_space']
    candidates={r['candidate_id']:r for r in tables['candidates.csv']}
    assert len(candidates)==len(tables['candidates.csv'])==summary['unique_candidates']
    outer=frames(c['dates']['start'],c['dates']['end_exclusive'],c['train_months'],c['test_months'],c['step_months'],c['window_type'])
    expected=[dict(f,type='outer') for f in outer]
    if c['validation_mode']=='nested':
        for f in outer:
            expected.extend(dict(v,type='inner') for v in frames(f['train_start'],f['train_end'],c['inner_train_months'],c['inner_test_months'],c['inner_step_months'],c.get('inner_window_type',c['window_type']),f['outer_fold']))
    assert len(tables['folds.csv'])==len(expected)
    fold_key=lambda r:(str(r['outer_fold']),r['type'],str(r.get('inner_fold','')))
    assert len(set(fold_key(r) for r in tables['folds.csv']))==len(expected)
    for r,e in zip(sorted(tables['folds.csv'],key=fold_key),sorted(expected,key=fold_key)):
        assert all(r[k]==str(v) for k,v in e.items()), ('fold oracle',r,e)
    records=[load(p) for p in root.glob('jobs/**/*.json')]; jobs=[v['result'] for v in records]
    assert len(jobs)==summary['total_backtest_jobs']==len(set((j['candidate_id'],j['outer_fold'],j['inner_fold'],j['stage'],j['scenario']) for j in jobs))
    derived={}
    for j in jobs:
        assert j['candidate_id'] in candidates and j['experiment_hash']==summary['experiment_hash']
        if j['status']!='VALID':continue
        obs=observations(j['ledger'],j['scenario']); assert len(obs)==len(j['observations'])
        for a,b in zip(j['observations'],obs):
            assert a['date']==b['date']
            for k in ['net_return','turnover','costs','exposure']:near(a[k],b[k],k)
        metrics=metric(obs,c['cash_yield']['reference_daily']);match(j['metrics'],metrics,'job metrics')
        derived[id(j)]=obs
        near(j['ledger'][0]['beginningNav'],100,'sleeve initial NAV');near(j['ledger'][0]['beginningCash'],100,'sleeve initial cash')
        assert not j['ledger'][0]['beginningPositions']
        if j['stage']=='outer':assert all(outer[j['outer_fold']]['test_start']<=d['date']<outer[j['outer_fold']]['test_end'] for d in j['ledger'])
        if j['stage']=='inner':assert max(d['date'] for d in j['ledger'])<outer[j['outer_fold']]['test_start']
    def selection_compare(a,b):
        # Match exact declared metric ordering; no oracle tie tolerance.
        for x,y in [(b['score'],a['score']),(a['m']['turnover_annualized'],b['m']['turnover_annualized']),(a['complexity'],b['complexity']),(a['id'],b['id'])]:
            if x!=y:return -1 if x<y else 1
        return 0
    winners=[]
    for f in outer:
        ranked=[]
        for cid,spec in candidates.items():
            scoring=[j for j in jobs if j['candidate_id']==cid and j['outer_fold']==f['outer_fold'] and j['scenario']==c['selection_cost_bps'] and j['stage']==('inner' if c['validation_mode']=='nested' else 'train')]
            if not scoring or any(j['status']!='VALID' for j in scoring):continue
            obs=[r for j in sorted(scoring,key=lambda j:j['inner_fold'] or 0) for r in derived[id(j)]]
            m=metric(obs,c['cash_yield']['reference_daily']);lim=c['constraints'];score=m[c['selection_metric']]
            if score is None or m['turnover_annualized']>lim.get('max_turnover',math.inf) or -m['max_drawdown']>lim.get('max_drawdown',math.inf) or m['exposure']<lim.get('min_exposure',0) or m['exposure']>lim.get('max_exposure',1):continue
            complexity=len(json.loads(spec['model_parameters']))+len(json.loads(spec['transformations']))+len(json.loads(spec['exposure_parameters']))
            ranked.append(dict(id=cid,m=m,score=score,complexity=complexity))
        ranked.sort(key=cmp_to_key(selection_compare));chosen=ranked[0]['id'] if ranked else ''
        selected=tables['selected-by-fold.csv'][f['outer_fold']];assert selected['candidate_id']==chosen, ('independent winner',selected,ranked)
        if ranked:near(float(selected['score']),ranked[0]['score'],'selection score'); assert selected['rank']=='1'
        winners.append(chosen)
    assert len(tables['selected-by-fold.csv'])==len(outer)
    assert len(tables['inner-results.csv'])==sum(j['stage']=='inner' for j in jobs)
    assert len(tables['outer-results.csv'])==sum(j['stage']=='outer' for j in jobs)
    assert len(tables['selection-stability.csv'])==len(candidates)
    for r in tables['inner-results.csv']:
        assert any(j['stage']=='inner' and j['candidate_id']==r['candidate_id'] and str(j['outer_fold'])==r['outer_fold'] and str(j['inner_fold'])==r['inner_fold'] and str(j['scenario'])==r['scenario'] for j in jobs)
    for j in jobs:
        if j['status']!='VALID':assert any(r['candidate_id']==j['candidate_id'] and r['status']==j['status'] for r in tables['failures.csv'])
    composite=[];checked_rows=0
    for scenario in c['transaction_cost_bps']:
        sleeves=sorted([j for j in jobs if j['stage']=='outer' and j['scenario']==scenario and j['status']=='VALID'],key=lambda j:j['outer_fold'])
        obs=[r for j in sleeves for r in derived[id(j)]]
        equity=[r for r in tables['oos-equity.csv'] if float(r['scenario'])==scenario]
        ledger=[r for r in tables['oos-ledger.csv'] if float(r['scenario'])==scenario]
        assert len(obs)==len(equity)==len(ledger)==len(set(r['date'] for r in obs))
        index=100;high=100
        for a,b,l in zip(obs,equity,ledger):
            index*=1+a['net_return'];high=max(high,index)
            assert a['date']==b['date']==l['date'] and b['candidate_id']==winners[int(b['outer_fold'])]
            near(float(b['index']),index,'OOS index');near(float(b['drawdown']),index/high-1,'OOS DD')
            near(float(l['netPnl'])/float(l['beginningNav']),a['net_return'],'CSV ledger returns')
            checked_rows+=1
        m=metric(obs,c['cash_yield']['reference_daily']);match(next(v for v in summary['outer_oos'] if v['scenario']==scenario),m,'summary');composite.append(dict(scenario=scenario,**m))
    hashes={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file() and p.name!='progress.json'}
    return dict(root=str(root),status='PASS',csv_rfc4180='PASS' if strict else 'baseline LF preserved; parse/quote round-trip PASS',
      candidates=len(candidates),folds=len(outer),jobs=len(jobs),oos_rows=checked_rows,winners=winners,reconstructed_outer_oos=composite,
      source_hashes=hashes,engine_calls=0,tolerance=dict(absolute=1e-8,relative=1e-10))

if __name__=='__main__':
    results=[]
    for path in sys.argv[1:]:
        try:results.append(audit(Path(path)))
        except Exception as e:
            results.append(dict(root=path,status='FAIL',error=str(e)));raise
    Path('reports/cl04/independent-replay.json').write_text(json.dumps(dict(status='PASS',campaigns=results),indent=2,allow_nan=False)+'\n')
    print(json.dumps([dict(root=r['root'],status=r['status'],jobs=r['jobs'],oos_rows=r['oos_rows']) for r in results]))
