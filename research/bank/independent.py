"""BANK01 independent replay: NumPy statistics, SciPy clustering, explicit policy
oracle and persisted CSV replay. Does not call TS bank/selector/allocator functions."""
from pathlib import Path
import json,csv,hashlib,math,collections,datetime
import numpy as np
from scipy.cluster.hierarchy import linkage,fcluster
from scipy.spatial.distance import squareform
R=Path('reports/bank01'); checks=[]
def check(name,fn):
 try: fn();checks.append({'criterion':name,'status':'PASS'})
 except Exception as e: checks.append({'criterion':name,'status':'FAIL','reason':str(e)})
def close(a,b,atol=1e-10):
 assert np.allclose(a,b,atol=atol,rtol=1e-10),f'{a} != {b}'
def timestamp(x):return datetime.datetime.fromisoformat(x.replace('Z','+00:00')).replace(tzinfo=datetime.timezone.utc)
def visible(p,x):return timestamp(p['as_of'])<=timestamp(x['decision_date']) and timestamp(p['information_cutoff'])<=timestamp(x['information_cutoff']) and timestamp(p['available_at'])<=timestamp(x['information_cutoff'])
def latest(items,x):
 a=[i for i in items if visible(i,x)];return max(a,key=lambda i:timestamp(i['as_of'])) if a else None
inputs=json.loads((R/'synthetic-inputs.json').read_text()); results=json.loads((R/'synthetic-results.json').read_text());manifest=json.loads((R/'manifest.json').read_text())
independent=[]
for item in results:
 x=inputs[item['input_index']]['input'];r=item['result'];p=x['policy'];tag=item['fixture_id']+' '+r['decision_date'];ids=r['correlation']['axis_ids'];N=len(ids)
 def stats():
  window=sorted(d for d in x['session_calendar'] if d<=x['information_cutoff'])[-p['correlation']['window_sessions']:]
  assert r['correlation']['window_dates']==window
  obs={id:{o['date']:o for o in x['returns'][id]['observations'] if o['date']<=x['information_cutoff'] and o['available_at']<=x['information_cutoff']} for id in ids}
  data=np.array([[obs[id][d]['value'] for id in ids]for d in window]);cov=np.atleast_2d(np.cov(data,rowvar=False,ddof=1)) if N else np.zeros((0,0))
  close(cov,r['correlation']['covariance']);corr=np.atleast_2d(np.corrcoef(data,rowvar=False)) if N>1 else np.ones((1,1)) if N else np.zeros((0,0));close(corr,r['correlation']['correlation'])
 check('sample covariance and Pearson oracle '+tag,stats)
 def clusters():
  if N>1:
   corr=np.array(r['correlation']['correlation']);d=np.sqrt(np.maximum(0,(1-corr)/2));np.fill_diagonal(d,0)
   z=linkage(squareform(d,checks=False),method=p['clustering']['linkage'].lower());lab=fcluster(z,math.sqrt((1-p['clustering']['correlation_threshold'])/2),criterion='distance');g=collections.defaultdict(list)
   for id,label in zip(ids,lab):g[int(label)].append(id)
   expected=sorted(sorted(v)for v in g.values())
  else:expected=[[id]for id in ids]
  assert expected==sorted(c['members']for c in r['clustering']['clusters'])
  for c in r['clustering']['clusters']:
   vals=[r['correlation']['correlation'][ids.index(a)][ids.index(b)]for i,a in enumerate(c['members'])for b in c['members'][i+1:]]
   if vals:close(c['within_average_correlation'],sum(vals)/len(vals))
   else:assert c['within_average_correlation'] is None
  for z in r['clustering']['between']:
   a=next(c['members']for c in r['clustering']['clusters']if c['cluster_id']==z['left']);b=next(c['members']for c in r['clustering']['clusters']if c['cluster_id']==z['right']);v=[r['correlation']['correlation'][ids.index(i)][ids.index(j)]for i in a for j in b];close(z['average_correlation'],sum(v)/len(v))
 check('SciPy independent hierarchical clusters '+tag,clusters)
 def eligibility_and_caps():
  eligible=[];reasons={}
  for e in sorted(x['entries'],key=lambda e:e['entry_id']):
   s=latest([s for s in x['states']if s['entry_id']==e['entry_id']and s['effective_at']<=x['decision_date']],x)
   reason=None
   if not s or s['promotion_status']!='PROMOTED':reason='NOT_PROMOTED'
   elif s['manual_hold']:reason='MANUAL_HOLD'
   elif not(e['valid_from']<=x['decision_date']and(e['valid_until'] is None or x['decision_date']<e['valid_until'])and e['version_available_at']<=x['information_cutoff']):reason='UNAVAILABLE'
   regime=latest(x['regimes'],x)
   if reason is None and (e['allowed_regimes'] or e['prohibited_regimes'] or p['regime_allowed']):
    if not regime:reason='MISSING_REGIME'
    elif regime['state']in e['prohibited_regimes']or(e['allowed_regimes']and regime['state']not in e['allowed_regimes'])or(p['regime_allowed']and regime['state']not in p['regime_allowed']):reason='REGIME'
   observations=[o for o in x['returns'][e['strategy_instance_id']]['observations']if o['date']<=x['information_cutoff']and o['available_at']<=x['information_cutoff']]
   window=sorted(d for d in x['session_calendar']if d<=x['information_cutoff'])[-p['correlation']['window_sessions']:]
   if reason is None and len(observations)<p['minimum_strategy_history']:reason='SHORT_HISTORY'
   if reason is None and not all(d in {o['date']for o in observations} for d in window):reason='MISSING_DATA'
   if reason is None:eligible.append(e['strategy_instance_id'])
   else:reasons[e['strategy_instance_id']]=reason
  expected=[];counts=collections.Counter()
  for id in sorted(eligible):
   cluster_id=next(c['cluster_id']for c in r['clustering']['clusters']if id in c['members'])
   if p['maximum_per_cluster']is not None and counts[cluster_id]>=p['maximum_per_cluster']:continue
   expected.append(id);counts[cluster_id]+=1
  assert r['active_strategy_ids']==expected,(r['active_strategy_ids'],expected)
  for id,reason in reasons.items():assert id not in r['active_strategy_ids']
  return expected
 check('independent eligibility and active-set replay '+tag,eligibility_and_caps)
 def riskbreadth():
  index=[ids.index(id)for id in r['active_strategy_ids']];c=np.array(r['correlation']['covariance'])[np.ix_(index,index)];n=len(index);d=r['diagnostics']['strategy'];assert d['count']==n
  if not n:return
  values,vectors=np.linalg.eigh(c);v=values.clip(0);s=v.sum();entropy=lambda v:math.exp(-sum(z*math.log(z)for z in v if z>0));close(d['covariance_effective_rank'],entropy(v/s));close(d['pc1_variance_share'],v[-1]/s)
  q=np.ones(n)/n;close(d['predicted_daily_variance'],q@c@q)
  repeated=np.any(np.abs(np.diff(v))<=p['numerical_tolerance']*max(abs(v))) if n>1 else False
  if not repeated or sum(v>p['numerical_tolerance']*s)==1:
   contrib=v*(vectors.T@q)**2
   if contrib.sum()>0:close(d['pca_effective_bets'],entropy(contrib/contrib.sum()),2e-8)
  if repeated:assert d['pca_repeated_eigenvalue_caveat']
 check('NumPy eigen entropy and PCA-risk-bets oracle '+tag,riskbreadth)
 def underlying():
  es=[e for e in x['entries']if e['strategy_instance_id']in r['active_strategy_ids']];counts=collections.Counter(u for e in es for u in e['underlying_ids']);assert r['diagnostics']['strategies_per_underlying']==dict(counts);assert r['diagnostics']['nominal_underlying_count']==len(counts)
  maps=[latest([m for m in x['position_maps']if m['entry_id']==e['entry_id']],x)for e in es];exposure=collections.defaultdict(float)
  if maps:
   for m in maps:
    for a,v in m['exposures'].items():exposure[a]+=v/len(maps)
   g=sum(abs(v)for v in exposure.values());hhi=sum((abs(v)/g)**2 for v in exposure.values())if g else None
   if hhi:close(r['diagnostics']['underlying_hhi_reference'],hhi)
  assert r['diagnostics']['strategy_allocation_hhi']is None
  assert r['diagnostics']['effective_strategy_allocation_count']is None
 check('separate underlying exposure reference oracle '+tag,underlying)
 independent.append({'fixture_id':item['fixture_id'],'decision_date':r['decision_date'],'active_strategy_ids':r['active_strategy_ids']})

def roundtrip():
 packet=json.loads((R/'activation-roundtrip-evidence.json').read_text());expected=[['CONTROL_0','CONTROL_1','CONTROL_2'],['CONTROL_0','CONTROL_2'],['CONTROL_0','CONTROL_1','CONTROL_2']]
 for x,r,winner in zip(packet['inputs'],packet['results'],expected):
  assert r['active_strategy_ids']==winner
  window=sorted(d for d in x['session_calendar']if d<=x['information_cutoff'])[-63:]
  data=np.array([[next(o['value']for o in x['returns'][id]['observations']if o['date']==d)for id in ['CONTROL_0','CONTROL_1','CONTROL_2']]for d in window]);corr=np.corrcoef(data,rowvar=False)
  if len(winner)==2:close(corr[0,1],1)
  else:assert max(corr[0,1],corr[0,2],corr[1,2])<.8
  assert all(e['promotion_status']=='PROMOTED'for e in r['entries'])
check('independent full ACTIVE INACTIVE ACTIVE roundtrip with constant promotion',roundtrip)

def storage():
 expected=['bank-snapshots.csv','eligibility-results.csv','activation-results.csv','cluster-history.csv','cluster-diagnostics.csv','strategy-diversification.csv','underlying-concentration.csv','marginal-diversification.csv','active-set-history.csv','blockers.csv','failure-summary.csv']
 counts={}
 for file in expected:
  raw=(R/file).read_bytes();assert b'\r\n'in raw
  with (R/file).open(newline='')as f:reader=csv.DictReader(f);rows=list(reader);assert all(None not in row for row in rows)
  counts[file]=len(rows)
 assert counts['active-set-history.csv']==len(results)==manifest['decision_count']==108
 assert counts['activation-results.csv']==counts['eligibility-results.csv']==counts['bank-snapshots.csv']==5*108
 assert counts['failure-summary.csv']==0
 with (R/'active-set-history.csv').open(newline='')as f:
  rows=list(csv.DictReader(f));keys=[(r['fixture_id'],r['decision_date'])for r in rows];assert len(keys)==len(set(keys))
  for row,res in zip(rows,results):assert json.loads(row['active_strategy_ids'])==res['result']['active_strategy_ids']
 for item in results:
  r=item['result'];stored=json.loads((R/'correlation-matrices'/f"{r['correlation_model_id']}.json").read_text());assert stored==r['correlation']
 assert len(list((R/'records').glob('*.json')))==len(results)
 (R/'storage-validation.json').write_text(json.dumps({'status':'PASS','csv_row_counts':counts,'json_round_trip':'PASS','unique_decisions':len(results)},indent=2)+'\n')
check('RFC4180 row counts IDs immutable records and JSON round-trip',storage)

def preservation():
 checkpoint=json.loads((R/'checkpoint.json').read_text());changed=[]
 for p,h in checkpoint['files'].items():
  path=Path(p)
  if not path.is_file()or hashlib.sha256(path.read_bytes()).hexdigest()!=h:changed.append(p)
 assert not changed,changed
 (R/'preservation.json').write_text(json.dumps({'status':'PASS','frozen_files':len(checkpoint['files']),'changed':changed,'branch':checkpoint['branch'],'commit':checkpoint['commit']},indent=2)+'\n')
check('all prior certified baseline files byte-identical',preservation)

def source_scope():
 runtime=['contracts.ts','validation.ts','statistics.ts','engine.ts','adapters.ts','storage.ts']
 import re
 for file in runtime:
  text=(Path('research/bank')/file).read_text()
  for pattern in [r'import.*allocateStrategies',r'import.*allocateAssets',r'import.*allocateFactors',r'import.*proposeEvent',r'import.*evaluatePromotion',r'fetch\(',r'https?://',r'child_process',r'from .*(?:router|pipeline/engine)']:
   assert not re.search(pattern,text),f'{file}: {pattern}'
 assert not any(p.name in ['package.json','pnpm-lock.yaml'] for p in Path('research/bank').rglob('*'))
check('bank runtime has no allocation promotion target routing network or execution calls',source_scope)
(R/'independent-active-set-replay.json').write_text(json.dumps(independent,indent=2)+'\n')
result={'status':'PASS'if all(x['status']=='PASS'for x in checks)else'FAIL','methodology':'BANK01_INDEPENDENT_NUMPY_SCIPY_CSV_REPLAY_1.0.0','tolerances':{'absolute':1e-10,'relative':1e-10,'PCA_bets_absolute':2e-8},'checks':checks,'pass':sum(x['status']=='PASS'for x in checks),'fail':sum(x['status']=='FAIL'for x in checks),'historical_replay':'BLOCKED_MISSING_STRATEGY_HISTORY'}
(R/'independent-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items()if k!='checks'}))
for c in checks:
 if c['status']=='FAIL':print(c)
raise SystemExit(0 if result['status']=='PASS' else 1)
