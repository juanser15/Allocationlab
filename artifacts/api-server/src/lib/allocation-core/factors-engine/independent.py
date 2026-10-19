"""Independent NumPy / SciPy HiGHS / SLSQP verification; never calls AL04 functions."""
import itertools,json,pathlib,csv,hashlib,numpy as np
from scipy.optimize import linprog,minimize
from scipy.linalg import qr,null_space
R=pathlib.Path('reports/al04');read=lambda name:json.loads((R/name).read_text())
def near(a,b,atol=1e-9):assert np.allclose(a,b,atol=atol,rtol=1e-7),str((a,b))[:300]
def aligned(x):
    assets=sorted(x['assets']);factors=sorted(x['target']['factor_ids']);b=x['loadings'];r=x['risk_model'];w=x['tracking_metric'];ai=[r['asset_ids'].index(a) for a in assets];fi=[r['factor_ids'].index(f) for f in factors]
    B=np.array(b['loadings'])[np.ix_([b['factor_ids'].index(f) for f in factors],[b['asset_ids'].index(a) for a in assets])];P=np.array(r['phi'])[np.ix_(fi,fi)];d=r['specific_risk'];D=np.zeros((len(assets),len(assets))) if d['representation']=='ZERO_SPECIFIC_RISK' else np.diag(np.array(d['values'])[ai]) if d['representation']=='DIAGONAL_VARIANCES' else np.array(d['values'])[np.ix_(ai,ai)];W=np.array(w['weights'])[np.ix_([w['factor_ids'].index(f) for f in factors],[w['factor_ids'].index(f) for f in factors])];target=np.array([x['target']['target_exposures'][f] for f in factors]);return assets,factors,B,(P+P.T)/2,(D+D.T)/2,(W+W.T)/2,target
def independent_equalities(E,b):
    scales=np.max(np.abs(E),axis=1);norm=E/np.where(scales==0,1,scales)[:,None];_,V,p=qr(norm.T,pivoting=True);rank=int(np.sum(np.abs(np.diag(V))>1e-12));return E[p[:rank]],b[p[:rank]]
def oracle(x):
    assets,factors,B,P,D,W,target=aligned(x);n=len(assets);C=B.T@P@B+D;K=x['constraints']['max_active_names'] or n;previous=np.array([x['previous_holdings']['asset_weights'][a] for a in assets]) if x['previous_holdings'] else None;secondary=x['implementation']['secondary'];exact=x['implementation']['mode']=='EXACT_FACTOR_TARGET';answers=[]
    for support in itertools.combinations(range(n),K):
        bounds=[(x['constraints']['asset_bounds'].get(a,{}).get('min',0),x['constraints']['asset_bounds'].get(a,{}).get('max',1)) if i in support else (0,0) for i,a in enumerate(assets)]
        E=np.ones((1,n));b=np.ones(1)
        if exact:E=np.vstack([E,B]);b=np.r_[b,target]
        A=[];d=[]
        for g in x['constraints']['group_caps']:A.append([float(a in g['assets']) for a in assets]);d.append(g['max'])
        cap=x['constraints']['turnover_cap']
        if cap is not None:
            for signs in itertools.product([-1,1],repeat=n):A.append(signs);d.append(cap+np.array(signs)@previous)
        A=np.array(A).reshape(-1,n);d=np.array(d)
        primal=linprog(np.zeros(n),A_ub=A if len(A) else None,b_ub=d if len(A) else None,A_eq=E,b_eq=b,bounds=bounds,method='highs')
        if not primal.success:
            assert primal.status==2,primal.message
            continue
        q=primal.x;eq,eb=independent_equalities(E,b)
        def constraints(eq,eb):
            return [{'type':'eq','fun':lambda q:eq@q-eb,'jac':lambda q:eq}]+([{'type':'ineq','fun':lambda q:d-A@q,'jac':lambda q:-A}] if len(A) else [])
        if not exact:
            H=B.T@W@B;linear=B.T@W@target;scale=max(np.abs(H).max(),np.abs(linear).max(),np.finfo(float).tiny)
            opt=minimize(lambda q:((B@q-target)@W@(B@q-target))/scale,q,jac=lambda q:2*(H@q-linear)/scale,method='SLSQP',constraints=constraints(eq,eb),bounds=bounds,options={'ftol':1e-13,'maxiter':2000})
            assert opt.success,opt.message;q=opt.x;primary=(B@q-target)@W@(B@q-target)
            if secondary is not None:E=np.vstack([E,W@B]);b=np.r_[b,W@B@q];eq,eb=independent_equalities(E,b)
        else:primary=0
        if secondary=='TURNOVER':
            # N independent absolute-value auxiliaries, unlike AL04's single sign epigraph.
            f=np.r_[np.zeros(n),np.ones(n)];A2=np.vstack([np.column_stack([A,np.zeros_like(A)]),np.column_stack([np.eye(n),-np.eye(n)]),np.column_stack([-np.eye(n),-np.eye(n)])]);b2=np.r_[d,previous,-previous]
            lp=linprog(f,A_ub=A2,b_ub=b2,A_eq=np.column_stack([E,np.zeros_like(E)]),b_eq=b,bounds=bounds+[(0,None)]*n,method='highs');assert lp.success,lp.message;q=lp.x[:n];second=np.abs(q-previous).sum()
        elif secondary is not None:
            covariance=D if secondary=='SPECIFIC_VARIANCE' else C;scale=max(np.abs(covariance).max(),np.finfo(float).tiny)
            # Exact unique equality solution needs no redundant optimizer step.
            if eq.shape[0]==n:q=np.linalg.solve(eq,eb)
            else:
                opt=minimize(lambda q:q@covariance@q/scale,q,jac=lambda q:2*covariance@q/scale,method='SLSQP',constraints=constraints(eq,eb),bounds=bounds,options={'ftol':1e-14,'maxiter':2000});assert opt.success,opt.message;q=opt.x
            second=q@covariance@q
        else:second=None
        assert np.max(np.abs(E@q-b))<1e-7
        answers.append({'q':q,'tracking':float((B@q-target)@W@(B@q-target)),'secondary':float(second) if second is not None else None})
    if not answers:return None
    primary=min(a['tracking'] for a in answers);allowed=[a for a in answers if exact or a['tracking']<=primary+x['solver']['tracking_tie_tolerance']]
    return min(allowed,key=lambda a:a['secondary'] if a['secondary'] is not None else 0)
def entropy(p):return float(np.exp(-sum(z*np.log(z) for z in p if z>0)))
fixtures=read('synthetic-fixtures.json');stress=read('sensitivity-details.json');checked=[]
for row in fixtures:
    x=row['input'];response=row['response'];ref=oracle(x)
    if ref is None:assert response['status']=='INFEASIBLE';checked.append({'fixture':row['id'],'status':'PASS','expected':'INFEASIBLE'});continue
    assert response['status']=='VALID',response['errors'];r=response['result'];diag=r['diagnostics'];assets,factors,B,P,D,W,target=aligned(x);q=np.array([r['asset_weights_risk_sleeve'][a] for a in assets]);e=B@q;res=e-target;C=B.T@P@B+D
    assert q.min()>=0;near(q.sum(),1);near(diag['weighted_residual_objective'],ref['tracking']);near(r['secondary_value'],ref['secondary']) if ref['secondary'] is not None else None
    criterion=x['implementation']['secondary'];curvature=D if criterion=='SPECIFIC_VARIANCE' else C if criterion=='TOTAL_VARIANCE' else B.T@W@B if criterion is None else None
    if curvature is not None:
        tangent=null_space(np.ones((1,len(q))));reduced=tangent.T@curvature@tangent
        if reduced.size and np.linalg.eigvalsh(reduced).min()>0:near(q,ref['q'],3e-7)
    near(np.array([diag['achieved_factor_exposures'][f] for f in factors]),e);near(np.array([diag['residual'][f] for f in factors]),res);near(diag['l2_residual'],np.linalg.norm(res));near(diag['maximum_absolute_miss'],np.max(np.abs(res)));near(diag['systematic_variance'],e@P@e);near(diag['specific_variance'],q@D@q);near(diag['total_variance'],q@C@q);near(diag['asset_covariance_variance'],q@C@q);near(diag['annualized_volatility'],np.sqrt(252*q@C@q));near(r['estimated_market_beta'],sum(q[i]*x['beta_estimates']['values'][a] for i,a in enumerate(assets)))
    contribution=e*(P@e);near([diag['factor_risk_contributions'][f] for f in factors],contribution);near(contribution.sum(),diag['systematic_variance'])
    if np.any(contribution<0):assert diag['systematic_factor_entropy_bets'] is None and diag['systematic_risk_concentration'] is None
    vals=np.linalg.eigvalsh(P);near(diag['factor_covariance_effective_rank'],entropy(vals/vals.sum()));near(diag['dominant_factor_eigenvalue_share'],vals.max()/vals.sum());ev,V=np.linalg.eigh(C);shares=ev*(V.T@q)**2;shares/=shares.sum();near(diag['asset_diagnostics']['pca_effective_risk_bets'],entropy(shares));near(diag['asset_diagnostics']['hhi'],q@q);near(diag['asset_diagnostics']['effective_number_weights'],1/(q@q));projection=r['controller_projection'];assert projection['origin_mode']=='FACTORS';assert projection['origin_result_id']==r['result_id'];assert projection['sleeve']['asset_weights_risk_sleeve']==r['asset_weights_risk_sleeve']
    if x['implementation']['mode']=='EXACT_FACTOR_TARGET':assert np.abs(res).max()<=x['solver']['factor_tolerance']
    checked.append({'fixture':row['id'],'status':'PASS','expected':'VALID'})
for row in stress:
    ref=oracle(row['perturbed_input']);assert row['status']==('INFEASIBLE' if ref is None else 'VALID'),(row['fixture'],row['scenario'],row['status'])
    if ref is None:assert row['weights'] is None;continue
    x=row['perturbed_input'];assets,factors,B,P,D,W,target=aligned(x);q=np.array([row['weights'][a] for a in assets]);res=B@q-target;C=B.T@P@B+D
    near(res@W@res,ref['tracking']);base=next(f['response']['result'] for f in fixtures if f['id']==row['fixture']);old=np.array([base['asset_weights_risk_sleeve'][a] for a in assets]);near(row['q_l1'],np.abs(q-old).sum());near(row['max_weight_change'],np.abs(q-old).max());near(row['factor_residual_l2_change'],np.linalg.norm(res)-base['diagnostics']['l2_residual']);near(row['weighted_residual_change'],res@W@res-base['diagnostics']['weighted_residual_objective']);near(row['beta_change'],sum(q[i]*x['beta_estimates']['values'][a] for i,a in enumerate(assets))-base['estimated_market_beta']);near(row['vol_change'],np.sqrt(252*q@C@q)-base['estimated_volatility'])
    secondary=x['implementation']['secondary'];actual=q@D@q if secondary=='SPECIFIC_VARIANCE' else q@C@q if secondary=='TOTAL_VARIANCE' else np.abs(q-np.array([x['previous_holdings']['asset_weights'][a] for a in assets])).sum() if secondary=='TURNOVER' else None
    if actual is not None:near(actual,ref['secondary'])
manifest=read('manifest.json')
for f,h in manifest['code_hashes'].items():assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h
counts={}
for f in ['factor-implementation-results.csv','factor-risk-diagnostics.csv','factor-residuals.csv','factor-diversification.csv','factor-sensitivity.csv']:
    data=(R/f).read_bytes();assert b'\r\n' in data;counts[f]=len(list(csv.DictReader((R/f).open())))
assert counts['factor-implementation-results.csv']==len(fixtures);assert counts['factor-sensitivity.csv']==len(stress)
out={'status':'PASS','method':'Independent NumPy identities/eigh + SciPy HiGHS feasibility/turnover LP (N auxiliaries) + SLSQP constrained quadratic oracle; unique base q also compared; no engine functions called','fixtures':checked,'stress_rows_checked':len(stress),'row_counts':counts,'tolerance':{'absolute':1e-9,'relative':1e-7,'unique_scipy_weights_absolute':3e-7},'real_backtests':0,'historical_replay':'BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS'}
(R/'independent-verification.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
