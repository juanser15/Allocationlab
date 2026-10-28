"""Independent AL06 NumPy/SciPy stats oracle. No gate/allocator/controller calls."""
import csv,hashlib,json,math,pathlib,sys
import numpy as np
from scipy.stats import rankdata
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'reports/al06');observations=json.loads((root/'portfolio-gate-replay.json').read_text());signals=json.loads((root/'signal-gate-reference-results.json').read_text());checks=[]
def near(a,b,tol=2e-8):
    if b is None:assert a is None,(a,b)
    else:assert a is not None and abs(a-b)<=tol,(a,b,tol)
def entropy(p):
    p=np.asarray(p);p=p[p>0];return float(np.exp(-np.sum(p*np.log(p))))
def stats(c,w):
    e,V=np.linalg.eigh(c);e=np.maximum(e,0);total=e.sum();b=e*(V.T@w)**2
    return {'covariance_rank':entropy(e/total) if total>0 else None,'pc1_share':float(max(e)/total) if total>0 else None,'pca_bets':entropy(b/b.sum()) if b.sum()>0 else None,'variance':float(w@c@w)}

def source_view(s):
    x=s['input'];r=s['result'];mode=s['mode'];tol=x['solver']['feasibility_tolerance'];status=r['status'] if r else s['source_status'];source_valid=status=='VALID';slacks=[]
    if mode=='ASSETS':
        ids=sorted(x['assets']);w=r['weights'] or {};a=w;idx=[x['risk_model']['axis_ids'].index(i) for i in ids];C=np.array(x['risk_model']['covariance'])[np.ix_(idx,idx)];beta=r['diagnostics']['beta_sleeve'] if r['diagnostics'] else None;sleeve=r['sleeve'];sc=None
    elif mode=='FACTORS':
        ids=sorted(x['assets']);fs=sorted(x['target']['factor_ids']);w=(r['asset_weights_risk_sleeve'] if r else None) or {};a=w
        B=np.array(x['loadings']['loadings'])[np.ix_([x['loadings']['factor_ids'].index(f) for f in fs],[x['loadings']['asset_ids'].index(i) for i in ids])]
        P=np.array(x['risk_model']['phi'])[np.ix_([x['risk_model']['factor_ids'].index(f) for f in fs],[x['risk_model']['factor_ids'].index(f) for f in fs])];P=(P+P.T)/2;d=x['risk_model']['specific_risk']
        if d['representation']=='ZERO_SPECIFIC_RISK':D=np.zeros((len(ids),len(ids)))
        elif d['representation']=='DIAGONAL_VARIANCES':D=np.diag([d['values'][x['risk_model']['asset_ids'].index(i)] for i in ids])
        else:ii=[x['risk_model']['asset_ids'].index(i) for i in ids];D=np.array(d['values'])[np.ix_(ii,ii)];D=(D+D.T)/2
        C=B.T@P@B+D;beta=r['estimated_market_beta'] if r else None;sleeve=r['controller_projection']['sleeve'] if r and r['controller_projection'] else None;sc=None
        if source_valid:
            achieved=B@np.array([w[i] for i in ids]);target=np.array([x['target']['target_exposures'][f] for f in fs]);res=achieved-target
            if x['implementation']['mode']=='EXACT_FACTOR_TARGET':assert max(abs(res))<=x['solver']['factor_tolerance']
    else:
        ids=sorted({i for stream in x['streams'] for i in stream['unit_position_map']['exposures']});strategy_ids=sorted(s['strategy_instance_id'] for s in x['streams']);a=r['allocations'] or {};w=(r['aggregation']['instrument_exposures'] if r['aggregation'] else None) or {};C=None;beta=r['current_position_beta'];sleeve=r['controller_projection'];sc=x['strategy_constraints']
        ii=[x['risk_model']['axis_ids'].index(i) for i in strategy_ids];strategy_C=np.array(x['risk_model']['covariance'])[np.ix_(ii,ii)]
        if x['asset_covariance']:
            ii=[x['asset_covariance']['axis_ids'].index(i) for i in ids];C=np.array(x['asset_covariance']['covariance'])[np.ix_(ii,ii)]
        if source_valid:
            H=np.array([[stream['unit_position_map']['exposures'].get(i,0) for stream in x['streams']] for i in ids]);av=np.array([a[s['strategy_instance_id']] for s in x['streams']]);mapped=H@av
            for i,v in zip(ids,mapped):near(w[i],float(v),1e-12)
            for s,b in sc['bounds'].items():assert a[s]>=b['min']-tol and a[s]<=b['max']+tol
            for g in sc['family_caps']:assert sum(a[s['strategy_instance_id']] for s in x['streams'] if s['strategy_family_id']==g['id'])<=g['max']+tol
            for g in sc['underlying_group_caps']:assert sum(a[s['strategy_instance_id']] for s in x['streams'] if set(s['underlying_ids'])&set(g['underlying_ids']))<=g['max']+tol
            if sc['max_active_strategies'] is not None:assert sum(v>0 for v in a.values())<=sc['max_active_strategies']
            ic=x['implementation_constraints'];net=sum(w.values());gross=sum(abs(v) for v in w.values())
            for i,b in ic['instrument_bounds'].items():
                if b['max_absolute'] is not None:assert abs(w[i])<=b['max_absolute']+tol
                if b['min_net'] is not None:assert w[i]>=b['min_net']-tol
                if b['max_net'] is not None:assert w[i]<=b['max_net']+tol
            if ic['max_gross'] is not None:assert gross<=ic['max_gross']+tol
            if ic['max_net'] is not None:assert net<=ic['max_net']+tol
            if ic['min_net'] is not None:assert net>=ic['min_net']-tol
    if C is not None:C=(C+C.T)/2
    if source_valid and mode!='STRATEGY_STREAMS':
        constraints=x['constraints'];assert abs(sum(w.values())-1)<=tol and min(w.values())>=0
        for i in ids:
            b=constraints['asset_bounds'].get(i,{'min':0,'max':1});assert w[i]>=b['min']-tol and w[i]<=b['max']+tol
        for g in constraints['group_caps']:assert sum(w[i] for i in g['assets'])<=g['max']+tol
    return status,ids,w,a,C,beta,sleeve

for obs in observations:
    x=obs['input'];p=obs['policy'];r=obs['result'];s=x['source'];status,ids,w,a,C,beta,sleeve=source_view(s);source_valid=status=='VALID'
    values={};mechanical_fail=not source_valid;missing=False
    if source_valid:
        v=np.array([w[i] for i in ids]);gross=np.abs(v).sum();norm=np.abs(v)/gross if gross>0 else None
        values.update(largest_weight=float(max(norm)) if norm is not None else None,hhi=float(norm@norm) if norm is not None else None,top3_share=float(sum(sorted(norm,reverse=True)[:3])) if norm is not None else None,effective_weights=1/float(norm@norm) if norm is not None else None)
        for k in ['largest_weight','hhi','top3_share','effective_weights']:near(next(c['value'] for c in r['components'] if c['check']==k),values[k])
        if C is not None:
            breadth=stats(C,v);actual=r['diagnostics']['asset_risk_breadth']
            for k in ['covariance_rank','pc1_share','pca_bets','variance']:near(actual[k],breadth[k])
        elif p['robustness_methodology']['require_risk_artifact']:missing=True
        if s['mode']=='STRATEGY_STREAMS':
            native=s['input'];sid=sorted(a);ii=[native['risk_model']['axis_ids'].index(i) for i in sid];cs=np.array(native['risk_model']['covariance'])[np.ix_(ii,ii)];br=stats(cs,np.array([a[i] for i in sid]));actual=r['diagnostics']['strategy_risk_breadth']
            for k in ['covariance_rank','pc1_share','pca_bets']:near(actual[k],br[k])
            pair=[cs[i,j]/math.sqrt(cs[i,i]*cs[j,j]) for i in range(len(sid)) for j in range(i+1,len(sid)) if cs[i,i]>0 and cs[j,j]>0]
            near(r['diagnostics']['correlation']['max_pairwise_correlation'],max(pair) if pair else None)
            near(r['diagnostics']['correlation']['median_pairwise_correlation'],float(np.median(pair)) if pair else None)
        compatible=sleeve is not None;mechanical_fail|=not compatible
        if compatible:
            m=x['risk_mandate'];metric=m['primary_target']['metric'];d=beta if metric=='MARKET_BETA' else r['diagnostics']['asset_risk_breadth']['annualized_volatility'] if metric=='VOLATILITY' else 1
            target=m['primary_target']['target'];requested=target/d if d and abs(d)>64*np.finfo(float).eps else 0 if target==0 else None
            cc=m['constraints'];net=sum(w.values());gross=sum(abs(z) for z in w.values());lo=max(0,cc['min_risky_allocation']/net,(1-cc['cash_ceiling'])/net);hi=min(1/net,cc['max_risky_allocation']/net,(1-cc['cash_floor'])/net,cc['max_gross_exposure']/gross,cc['max_net_exposure']/net)
            risk=r['diagnostics']['risk_mandate_compatibility'];near(risk['requested_multiplier'],requested);near(risk['feasible_multiplier_interval']['lower'],lo);near(risk['feasible_multiplier_interval']['upper'],hi)
            feasible=requested is not None and lo-1e-10<=requested<=hi+1e-10 and lo<=hi+1e-10
            mechanical_fail|=not feasible
            if feasible:near(risk['implied_implementation_cash'],1-requested*net);near(risk['expected_final_beta'],requested*beta)
        sens=x['sensitivity'];rows=sens['rows'] if sens else [];uses_mu=s['input'].get('objective',{}).get('type') in ['MEAN_VARIANCE','MAX_SHARPE'];required=[f for f in p['robustness_methodology']['sensitivity_required_families'] if f!='MU' or uses_mu];missing|=any(not any(row['family']==f for row in rows) for f in required)
        failed=any(row['status']!='VALID' for row in rows);required_failed=any(row['status']!='VALID' and row['family'] in required for row in rows)
        valid_l1=[row['allocation_l1'] for row in rows if row['allocation_l1'] is not None and row['status']=='VALID'];values['allocation_l1']=None if failed or not valid_l1 else max(valid_l1)
        near(next(c['value'] for c in r['components'] if c['check']=='allocation_l1'),values['allocation_l1'])
        policy_fail=required_failed
        for key in p['mandatory_checks']:
            threshold=p['thresholds'][key];value=values.get(key)
            if key=='allocation_l1' and failed:policy_fail=True
            elif value is None:missing=True
            elif threshold['operator']=='MIN' and value<threshold['value'] or threshold['operator']=='MAX' and value>threshold['value']:policy_fail=True
        expected='FAIL' if mechanical_fail or policy_fail else 'INSUFFICIENT_DATA' if missing else 'PASS'
    else:expected='FAIL'
    assert r['status']==expected,(obs['case_id'],r['status'],expected,r['errors'],r['hard_failures'])
    assert r['eligible_for_promotion']==(expected=='PASS');assert r['eligible_for_allocation'] is False
    checks.append({'case':obs['case_id'],'status':'PASS','verified_gate_outcome':expected,'scope':'independent constraints/PCA/concentration/sensitivity/risk feasibility/outcome; no gate calls'})

for obs in signals:
    x=obs['input'];p=obs['policy'];r=obs['result'];ids=sorted(x['eligible_assets']);current={i:x['current_ranking']['scores'][i]['value'] for i in ids if x['current_ranking']['scores'][i]['value'] is not None};valid=sorted(current);values={'coverage':len(valid)/len(ids),'dispersion':float(np.std([current[i] for i in valid],ddof=p['signal_methodology']['dispersion_ddof']))}
    M=np.array([x['signal_matrix']['rows'][i] for i in valid]);C=np.cov(M,rowvar=False,ddof=1);ev=np.linalg.eigvalsh(C);values['pc1_share']=float(ev[-1]/sum(ev)) if sum(ev)>0 else None
    cs=[]
    for h in sorted(x['historical_rankings'],key=lambda h:h['as_of']):
        if h['as_of']>=x['current_ranking']['as_of'] or h['provenance']['data_available_at']>=x['information_cutoff']:continue
        common=sorted(set(valid)&set(h['scores']));fraction=len(common)/max(len(valid),len(h['scores']))
        if len(common)>=p['minimum_observations'] and fraction>=p['signal_methodology']['minimum_rank_intersection_fraction']:
            aa=rankdata([current[i] for i in common],method='average');bb=rankdata([h['scores'][i]['value'] for i in common],method='average')
            if np.var(aa)>0 and np.var(bb)>0:cs.append(float(np.corrcoef(aa,bb)[0,1]))
    values['rank_stability']=float(np.mean(cs)) if len(cs)>=p['signal_methodology']['minimum_rank_snapshots'] else None
    failures=[];missing=False
    for key in p['mandatory_checks']:
        t=p['thresholds'][key];value=values[key];near(next(c['value'] for c in r['components'] if c['check']==key),value)
        if value is None:missing=True
        elif t['operator']=='MIN' and value<t['value'] or t['operator']=='MAX' and value>t['value']:
            if key=='coverage' and p['coverage_failure_status']=='INSUFFICIENT_DATA':missing=True
            else:failures.append(key)
    expected='FAIL' if failures else 'INSUFFICIENT_DATA' if missing else 'PASS';assert r['status']==expected,(obs['case_id'],r['status'],expected);assert r['eligible_for_allocation']==(expected=='PASS')
    checks.append({'case':obs['case_id'],'status':'PASS','scope':'independent new canonical signal formula oracle; no legacy Node3 compatibility claim'})

for f in root.glob('*.csv'):
    with f.open(newline='') as handle:rows=list(csv.reader(handle,strict=True));assert rows and all(len(row)==len(rows[0]) for row in rows)
    with f.open(newline='') as handle:records=list(csv.DictReader(handle))
    expected={'portfolio-gate-results.csv':len(observations),'signal-gate-results.csv':len(signals),'portfolio-gate-components.csv':sum(len(o['result']['components']) for o in observations),'signal-gate-components.csv':sum(len(o['result']['components']) for o in signals)}
    if f.name in expected:assert len(records)==expected[f.name]
    checks.append({'case':f.name,'status':'PASS','scope':'RFC4180 parse/count','rows':len(records)})
manifest=json.loads((root/'manifest.json').read_text())
for f,h in {**manifest['code_hashes'],**manifest['frozen_source_hashes'],**manifest.get('reused_code_hashes',{})}.items():assert hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()==h
checks.append({'case':'manifest and immutable source hashes','status':'PASS'})
report={'status':'PASS','scope':'NEW_CANONICAL_SIGNAL_AND_FROZEN_PORTFOLIO_MECHANICS; legacy audit BLOCKED_SOURCE_NOT_AVAILABLE','passed':len(checks),'failed':0,'oracle':'Independent NumPy covariance/eigh + SciPy average rank + explicit constraint/feasibility/threshold formulas','tolerance_absolute':2e-8,'checks':checks};(root/'independent-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['status','passed','failed','scope']}))
