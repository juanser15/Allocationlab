"""Independent NumPy/SciPy replay of persisted AL05 inputs; no engine calls."""
import csv, hashlib, itertools, json, math, pathlib, sys
import numpy as np
from scipy.optimize import minimize
ROOT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'reports/al05')
rows=json.loads((ROOT/'synthetic-results.json').read_text())
stresses=json.loads((ROOT/'sensitivity-results.json').read_text())
checks=[]
def near(a,b,tol=2e-9):
    assert a is not None and b is not None and abs(a-b)<=tol, (a,b,tol)
def risk_oracle(c,a):
    vals,vec=np.linalg.eigh(c); vals=np.maximum(vals,0)
    def enb(p):
        p=p[p>0];return float(np.exp(-np.sum(p*np.log(p))))
    total=vals.sum(); bets=vals*(vec.T@a)**2
    return float(a@c@a), enb(vals/total) if total>0 else None, enb(bets/bets.sum()) if bets.sum()>0 else None

def setup(x):
    ids=[s['strategy_instance_id'] for s in x['streams']]; n=len(ids);axis=x['risk_model']['axis_ids'];idx=[axis.index(i) for i in ids]
    cov=np.array(x['risk_model']['covariance'])[np.ix_(idx,idx)]; cov=(cov+cov.T)/2
    assets=sorted({k for s in x['streams'] for k in s['unit_position_map']['exposures']}); H=np.array([[s['unit_position_map']['exposures'].get(k,0) for s in x['streams']] for k in assets])
    mu=np.array([x['expected_returns']['values'][i] for i in ids]) if x['expected_returns'] else None
    return ids,assets,cov,H,mu

def inequalities(x,ids,assets,H,a):
    sc=x['strategy_constraints']; ic=x['implementation_constraints']; z=[]
    for i,s in enumerate(ids):
        b=sc['bounds'].get(s,{'min':0,'max':1});z.extend([a[i]-b['min'],b['max']-a[i]])
    for g in sc['family_caps']:z.append(g['max']-sum(a[i] for i,s in enumerate(x['streams']) if s['strategy_family_id']==g['id']))
    for g in sc['underlying_group_caps']:z.append(g['max']-sum(a[i] for i,s in enumerate(x['streams']) if set(s['underlying_ids'])&set(g['underlying_ids'])))
    if sc['turnover_cap'] is not None:z.append(sc['turnover_cap']-sum(abs(a[i]-x['previous_allocation']['allocations'][s]) for i,s in enumerate(ids)))
    v=H@a
    for s,b in ic['instrument_bounds'].items():
        i=assets.index(s)
        if b['max_absolute'] is not None:z.append(b['max_absolute']-abs(v[i]))
        if b['min_net'] is not None:z.append(v[i]-b['min_net'])
        if b['max_net'] is not None:z.append(b['max_net']-v[i])
    for g in ic['group_limits']:
        values=[v[assets.index(s)] for s in g['instruments']];net=sum(values) if g['basis']=='NET' else sum(abs(vv) for vv in values)
        if g['min'] is not None:z.append(net-g['min'])
        if g['max'] is not None:z.append(g['max']-net)
    if ic['max_gross'] is not None:z.append(ic['max_gross']-sum(abs(v)))
    if ic['min_net'] is not None:z.append(sum(v)-ic['min_net'])
    if ic['max_net'] is not None:z.append(ic['max_net']-sum(v))
    return np.array(z)

def oracle_objective(x,c,mu,a):
    obj=x['objective'];v=float(a@c@a)
    if obj['type']=='MIN_VARIANCE':return v
    if obj['type']=='MEAN_VARIANCE':return float(a@mu-obj['gamma']/2*v)
    if obj['type']=='MAX_SHARPE':return float((a@mu-obj['rf_stream'])/math.sqrt(v))
    if obj['type']=='EQUAL_CAPITAL':return float(np.sum((a-1/len(a))**2))
    if obj['type']=='ERC':return float(np.sum((a*(c@a)/v-1/len(a))**2))
    raise AssertionError(obj)

def optimum(x):
    ids,assets,c,H,mu=setup(x);n=len(ids);o=x['objective']['type'];sc=x['strategy_constraints'];k=sc['max_active_strategies'] or n
    if o=='EQUAL_CAPITAL':return np.ones(n)/n
    if o=='ERC':
        # Independent diagonal closed-form oracle (certification ERC inputs diagonal).
        assert np.max(np.abs(c-np.diag(np.diag(c))))<1e-15
        a=1/np.sqrt(np.diag(c));return a/sum(a)
    best=None;value=math.inf
    def loss(a):
        v=oracle_objective(x,c,mu,a)
        return v*1e6 if o=='MIN_VARIANCE' else -v*(1e4 if o=='MEAN_VARIANCE' else 1)
    for support in itertools.combinations(range(n),k):
        def full(u):
            a=np.zeros(n);a[list(support)]=u;return a
        constraints=[{'type':'eq','fun':lambda u:sum(u)-1},{'type':'ineq','fun':lambda u:inequalities(x,ids,assets,H,full(u))}]
        starts=[np.ones(k)/k]+[np.eye(k)[i]*.99+.01/k for i in range(k)]
        for u in starts:
            fit=minimize(lambda u:loss(full(u)),u,method='SLSQP',bounds=[(0,1)]*k,constraints=constraints,options={'ftol':1e-12,'maxiter':2000})
            a=full(fit.x)
            if abs(sum(a)-1)<2e-8 and min(inequalities(x,ids,assets,H,a))>=-2e-8 and math.isfinite(loss(a)) and loss(a)<value:
                best=a;value=loss(a)
    assert best is not None, ('independent solver could not certify feasibility',x['objective'])
    return best

for case in rows+stresses:
    x=case['input'];r=case['result'];label=case.get('id',case.get('case_id','stress'))+(':'+case['perturbation']+':'+str(case['level']) if 'perturbation' in case else '')
    if r['status']!='VALID':
        assert r['allocations'] is None
        if r['status']=='INSUFFICIENT_DATA':assert x['expected_returns'] is None and x['objective']['type'] in ['MEAN_VARIANCE','MAX_SHARPE']
        elif r['status']=='INFEASIBLE':
            if x['objective']['type'] in ['EQUAL_CAPITAL','ERC']:
                ids,assets,c,H,mu=setup(x);a=optimum(x);assert min(inequalities(x,ids,assets,H,a)) < -1e-10
            else:assert sum(b['min'] for b in x['strategy_constraints']['bounds'].values())>1
        else:raise AssertionError((label,r['status'],r['errors']))
        checks.append({'case':label,'status':'PASS','scope':'explicit expected failure preserved'});continue
    ids,assets,c,H,mu=setup(x);a=np.array([r['allocations'][s] for s in ids]);near(float(a.sum()),1,1e-10);assert min(a)>=0;assert min(inequalities(x,ids,assets,H,a))>=-1.01e-10
    if x['strategy_constraints']['max_active_strategies'] is not None:assert np.sum(a>0)<=x['strategy_constraints']['max_active_strategies']
    reference=optimum(x);near(oracle_objective(x,c,mu,a),oracle_objective(x,c,mu,reference),2e-9)
    if x['objective']['type'] in ['EQUAL_CAPITAL','ERC']:assert np.max(np.abs(a-reference))<3e-8
    g=r['aggregation'];v=H@a
    for j,asset in enumerate(assets):
        near(g['instrument_exposures'][asset],float(v[j]),1e-12)
        for i,s in enumerate(ids):near(g['contributions'][asset][s],float(H[j,i]*a[i]),1e-12)
        near(g['instruments'][asset]['gross_positive'],float(np.maximum(H[j]*a,0).sum()),1e-12)
        near(g['instruments'][asset]['gross_negative_absolute'],float(np.maximum(-H[j]*a,0).sum()),1e-12)
    pre=float(np.abs(H).sum(axis=0)@a);post=float(np.abs(v).sum());near(g['pre_net_gross'],pre,1e-12);near(g['post_net_gross'],post,1e-12);near(g['post_net_net'],float(v.sum()),1e-12);near(g['netting_benefit'],pre-post,1e-12)
    near(g['internal_residual_capital'],sum(a[i]*s['unit_position_map']['internal_residual_capital'] for i,s in enumerate(x['streams'])),1e-12)
    variance,rank,bets=risk_oracle(c,a);near(r['return_risk']['variance'],variance,1e-12);near(r['return_risk']['annualized_volatility'],math.sqrt(252*variance));near(r['return_risk']['hhi'],float(a@a));near(r['return_risk']['effective_allocations'],1/float(a@a))
    near(r['return_risk']['covariance_effective_rank'],rank);near(r['return_risk']['pca_effective_risk_bets'],bets)
    for i,s in enumerate(ids):near(r['return_risk']['contributions'][s],float(a[i]*(c@a)[i]),1e-12)
    if x['strategy_betas']:near(r['strategy_return_beta'],sum(a[i]*x['strategy_betas']['values'][s] for i,s in enumerate(ids)),1e-12)
    if x['asset_betas']:near(r['current_position_beta'],sum(v[i]*x['asset_betas']['values'][s] for i,s in enumerate(assets)),1e-12)
    if x['asset_covariance']:
        ac=x['asset_covariance'];ii=[ac['axis_ids'].index(s) for s in assets];mat=np.array(ac['covariance'])[np.ix_(ii,ii)];var,rank,bets=risk_oracle(mat,v)
        near(r['implementation_risk']['variance'],var,1e-12)
        near(r['implementation_risk']['covariance_effective_rank'],rank)
        if bets is None:assert r['implementation_risk']['pca_effective_risk_bets'] is None
        else:near(r['implementation_risk']['pca_effective_risk_bets'],bets)
        assert 'effective_allocations' not in r['implementation_risk']
    compatible=bool(np.all(v>=0) and abs(v.sum()-1)<=x['solver']['feasibility_tolerance'] and all(s['unit_position_map']['funding']=='LONG_ONLY_FUNDED' for i,s in enumerate(x['streams']) if a[i]>0) and g['internal_residual_capital']==0)
    assert (r['controller_compatibility']=='CONTROLLER_COMPATIBLE_LONG_ONLY_NET_ONE')==compatible
    if not compatible:assert r['controller_projection'] is None
    if x['incremental_cost']:
        cost=x['incremental_cost'];near(r['incremental_cost']['amount'],sum(abs(t['signed_notional'])*cost['bps']/10000 for t in cost['trades']),1e-12);assert r['incremental_cost']['embedded_internal_costs_recharged'] is False
    if x['previous_allocation']:
        p=x['previous_allocation'];near(g['strategy_turnover_l1'],sum(abs(a[i]-p['allocations'][s]) for i,s in enumerate(ids)),1e-12)
        union=set(assets)|set(p['instrument_exposures']);near(g['instrument_turnover_l1'],sum(abs(g['instrument_exposures'].get(s,0)-p['instrument_exposures'].get(s,0)) for s in union),1e-12)
    assert not any(s in r for s in ['cash','masterCash','totalCash','risk_mandate'])
    checks.append({'case':label,'status':'PASS','scope':'independent optimization/risk/H/constraints/costs'})

# Persisted attribution replay without original attribution or engine functions.
for name,key in [('strategy-attribution.csv','strategy_instance_id'),('family-attribution.csv','strategy_family_id')]:
    records=list(csv.DictReader((ROOT/name).open(newline='')))
    for case in set(r['case_id'] for r in records):
        group=[r for r in records if r['case_id']==case];near(sum(float(r['pnl_per_unit_capital']) for r in group),float(group[0]['portfolio_strategy_pnl']),1e-12)
    checks.append({'case':name,'status':'PASS','scope':'independent attribution reconciliation'})
for path in sorted(ROOT.glob('*.csv')):
    with path.open(newline='') as f:
        parsed=list(csv.reader(f,strict=True));assert parsed and all(len(row)==len(parsed[0]) for row in parsed)
    with path.open(newline='') as f:
        parsed=list(csv.DictReader(f));assert all(row.get('case_id') in {r['id'] for r in rows} for row in parsed if row.get('case_id'))
    expected={'alpha-allocation-results.csv':sum(len(r['input']['streams']) for r in rows),'alpha-return-risk.csv':len(rows),'alpha-beta-diagnostics.csv':len(rows),'alpha-diversification.csv':len(rows),'controller-compatibility.csv':len(rows),'alpha-sensitivity.csv':len(stresses),'economic-replay.csv':5}
    if path.name in expected:assert len(parsed)==expected[path.name], (path.name,len(parsed),expected[path.name])
    if path.name=='alpha-allocation-results.csv':
        for case in rows:
            subset=[row for row in parsed if row['case_id']==case['id']]
            assert {row['strategy_instance_id'] for row in subset}=={s['strategy_instance_id'] for s in case['input']['streams']}
            assert all(row['status']==case['result']['status'] for row in subset)
    checks.append({'case':path.name,'status':'PASS','scope':'CSV round-trip / referential IDs / expected counts','rows':len(parsed)})
manifest=json.loads((ROOT/'manifest.json').read_text())
for path,digest in {**manifest['code_hashes'],**manifest.get('reused_code_hashes',{})}.items():assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==digest
checks.append({'case':'manifest code hashes','status':'PASS','scope':'frozen before performance, exact source bytes'})
report={'status':'PASS','oracle':'independent NumPy + SciPy SLSQP; closed-form diagonal ERC/EQUAL; no engine calls','tolerances':{'objective_absolute':2e-9,'accounting_absolute':1e-12,'weights_equal_erc':3e-8,'diagnostics':2e-9},'checks':checks,'passed':len(checks),'failed':0}
(ROOT/'independent-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['status','passed','failed']}))
