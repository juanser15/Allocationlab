"""Independent arithmetic replay of persisted PIPE03 decisions. No optimizer,
BANK clustering, gate evaluator, controller or logical router invocation."""
from pathlib import Path
import json,math,hashlib,csv,collections
import numpy as np
R=Path('reports/pipe03');checks=[]
def read(p):return json.loads((R/p).read_text())
def check(name,f):
 try:f();checks.append({'criterion':name,'status':'PASS'})
 except Exception as e:checks.append({'criterion':name,'status':'FAIL','reason':str(e)})
def near(a,b,t=1e-9):assert np.allclose(a,b,atol=t,rtol=1e-9),f'{a} != {b}'
inputs=read('acceptance-inputs.json');outputs=read('acceptance-results.json');summary=read('run-summary.json');independent=[]
for source,record in zip(inputs,outputs):
 r=source['request'];d=record['result'];case=record['case_id'];bank=next(s['artifact']for s in r['active_sets']if s['artifact']['hash']==r['active_set_hash']);ids=sorted(bank['active_strategy_ids']);full=r['strategy_snapshots'][0]
 def membership():
  assert record['expected_status']==d['status'],(d['status'],d['reason']);assert ids==sorted(d['active_ids']);assert d['excluded']==bank['inactive'];assert all(e['promotion_status']=='PROMOTED'for e in bank['entries']if e['status']=='ELIGIBLE_ACTIVE')
  if d['projection']:
   x=d['projection']['input'];assert sorted(s['strategy_instance_id']for s in x['streams'])==ids
   assert sorted(x['risk_model']['axis_ids'])==ids
   if x['expected_returns']:assert sorted(x['expected_returns']['values'])==ids
   assert all(k in ids for k in x['strategy_constraints']['bounds'])
   positions={s['strategy_instance_id']:s['unit_position_map']for s in x['streams']};assert set(positions)==set(ids)
   axis=full['risk_model']['axis_ids'];ix=[axis.index(id)for id in ids];near(x['risk_model']['covariance'],np.array(full['risk_model']['covariance'])[np.ix_(ix,ix)],1e-15)
  else:assert d['pipeline']is None
 check('active universe and covariance projection '+case,membership)
 def governing_configuration():
  ref=r['source_candidate']['spec']['strategy_universe'];assert ref=={'id':'BANK01:'+bank['policy_id'],'version':bank['policy_version'],'configuration_hash':bank['policy_hash']}
  if d['certificate']:assert d['certificate']['identity']['candidate_id']==r['source_candidate']['candidate_id'];assert d['certificate']['identity']['allocation_mode']=='STRATEGY_STREAMS'
 check('source configuration and frozen active-policy governance identity '+case,governing_configuration)
 if d['pipeline']and d['pipeline']['allocation']:
  p=d['pipeline'];alloc=p['allocation'];a=alloc['result'];x=alloc['input'];weights=a['allocations']
  def allocation_oracle():
   cov=np.array(x['risk_model']['covariance']);assert np.count_nonzero(cov-np.diag(np.diag(cov)))==0
   axis=x['risk_model']['axis_ids'];positive=[id for id in axis if x['strategy_constraints']['bounds'].get(id,{}).get('max',1)>0]
   raw={id:1 if x['objective']['type']=='EQUAL_CAPITAL'else 1/math.sqrt(cov[axis.index(id),axis.index(id)])if x['objective']['type']=='ERC'else 1/cov[axis.index(id),axis.index(id)]for id in positive};den=sum(raw.values());expected={id:raw.get(id,0)/den for id in axis}
   near([weights[id]for id in axis],[expected[id]for id in axis],2e-8);near(sum(weights.values()),1);assert all(v>=0 for v in weights.values())
   assert set(weights)==set(ids)
   w=np.array([weights[id]for id in axis]);variance=w@cov@w;near(a['return_risk']['variance'],variance,1e-13);near(a['return_risk']['annualized_volatility'],math.sqrt(252*variance))
   beta=sum(weights[id]*x['strategy_betas']['values'][id]for id in ids);near(a['strategy_return_beta'],beta)
  check('closed-form independent strategy allocation oracle '+case,allocation_oracle)
  def mapping():
   asset_ids=sorted(set(i for s in x['streams']for i in s['unit_position_map']['exposures']));expo={i:sum(weights[s['strategy_instance_id']]*s['unit_position_map']['exposures'].get(i,0)for s in x['streams'])for i in asset_ids}
   agg=a['aggregation'];assert set(expo)==set(agg['instrument_exposures'])
   for i,v in expo.items():near(agg['instrument_exposures'][i],v);near(sum(agg['contributions'][i].values()),v)
   pre=sum(weights[s['strategy_instance_id']]*sum(abs(v)for v in s['unit_position_map']['exposures'].values())for s in x['streams']);post=sum(abs(v)for v in expo.values());net=sum(expo.values());near(agg['pre_net_gross'],pre);near(agg['post_net_gross'],post);near(agg['post_net_net'],net);near(agg['netting_benefit'],pre-post)
   residual=sum(weights[s['strategy_instance_id']]*s['unit_position_map']['internal_residual_capital']for s in x['streams']);near(agg['internal_residual_capital'],residual)
   if post:near(agg['absolute_normalized_asset_hhi'],sum((abs(v)/post)**2 for v in expo.values()))
   beta=sum(v*x['asset_betas']['values'][i]for i,v in expo.items());near(a['current_position_beta'],beta)
   ac=x['asset_covariance'];v=np.array([expo[i]for i in ac['axis_ids']]);near(a['implementation_risk']['variance'],v@np.array(ac['covariance'])@v,1e-13)
  check('independent H a gross net contribution residual beta reconciliation '+case,mapping)
  def unchanged_and_gate():
   mandate=next(s['output']['mandate']for s in p['stages']if s['stage']=='RESOLVE_MANDATE');assert mandate==r['bundle_template']['mandate']
   passed=next(s['output']for s in p['stages']if s['stage']=='ALLOCATOR');assert passed==p['allocation'];assert p['source_unchanged']and d['source_unchanged']
   gate=p['robustness_gate']or d['additional_robustness'];assert gate is not None
   if d['status']=='ROBUSTNESS_GATE_FAIL':assert gate['status']=='FAIL'and a['aggregation']['absolute_normalized_asset_hhi']>r['bundle_template']['robustness_policy']['thresholds']['hhi']['value']
   if d['status']=='VALID':assert gate['status']=='PASS'
  check('exact allocator gate and RiskMandate immutability '+case,unchanged_and_gate)
  def controller():
   target=p['final_target'];beta=a['current_position_beta'];m=r['bundle_template']['mandate'];goal=m['primary_target']['target']
   if d['status']=='VALID':
    lam=goal/beta;assert 0<=lam<=1;near(target['expected_final_beta'],goal);expo=a['aggregation']['instrument_exposures'];near(target['implementation_cash'],1-lam*sum(expo.values()));near(target['net_exposure']+target['implementation_cash'],1)
    for id,v in expo.items():near(target['final_asset_weights'][id],lam*v)
    near(target['expected_final_volatility'],lam*a['implementation_risk']['annualized_volatility']);assert d['certificate']['target']==target;assert a['aggregation']['internal_residual_capital']==0
   else:
    assert target is None and d['certificate']is None
    if d['compatibility_blocker']:
     assert a['controller_compatibility']=='SIGNED_OR_NON_NET_ONE_EXPOSURE';assert all(s['stage']!='EXPOSURE_CONTROLLER'for s in p['stages'])
  check('independent lambda target risk and single implementation cash '+case,controller)
 def routing():
  rt=d['routing'];assert rt is not None;assert rt['action']=='NO_NEW_TARGET';assert rt['selected_certified_target']is None;assert rt['primary_failure_reason']==d['reason'];assert rt['promotion_status']is None
  assert 'PROMOTION_NOT_ALLOWED'in rt['conditions'];assert r['routing']['fallbacks']==[]
 check('existing router no approval no fallback preserves primary failure '+case,routing)
 def stages():
  for i,s in enumerate(d['stages']):assert s['sequence']==i+1 and s['integration_id']==d['integration_id']and s['market_information_cutoff']==r['information_cutoff']
  assert d['stages'][0]['stage']=='FROZEN_BANK01_ACTIVE_SET'
  if d['pipeline']:
   names=[s['stage']for s in d['pipeline']['stages']];assert 'EXECUTION'not in names and 'ACCOUNTING_ATTRIBUTION'not in names
   assert names.index('ALLOCATOR')<names.index('SLEEVE_RISK')
  assert d['stages'][-1]['stage']=='PIPE02_LOGICAL_ROUTING'
 check('stage sequence market cutoff and nonexecution boundary '+case,stages)
 independent.append({'case_id':case,'active_ids':ids,'status':d['status'],'allocations':d['pipeline']['allocation']['result']['allocations']if d['pipeline']and d['pipeline']['allocation']else None,'routing_action':d['routing']['action']})

def persistence():
 required=['active-set-inputs.csv','allocator-universe.csv','strategy-allocation.csv','mapped-exposures.csv','robustness-results.csv','risk-composition.csv','routing-results.csv','blockers.csv'];counts={}
 for n in required:
  raw=(R/n).read_bytes();assert b'\r\n'in raw
  with (R/n).open(newline='')as f:rows=list(csv.DictReader(f));assert all(None not in x for x in rows)
  counts[n]=len(rows)
 assert counts['active-set-inputs.csv']==100
 assert counts['risk-composition.csv']==counts['routing-results.csv']==20
 assert counts['strategy-allocation.csv']==80
 assert counts['allocator-universe.csv']==80
 assert counts['mapped-exposures.csv']==60
 stages=[json.loads(l)for l in (R/'stage-ledger.jsonl').read_text().splitlines()];assert len(stages)==sum(len(r['result']['stages'])for r in outputs)
 assert len(list((R/'records').glob('*.json')))==20
 assert len({r['result']['integration_id']for r in outputs})==20
 assert summary['expected_status_mismatches']==[]
 (R/'storage-validation.json').write_text(json.dumps({'status':'PASS','csv_rows':counts,'stage_rows':len(stages),'records':20},indent=2)+'\n')
check('CSV RFC4180 JSON roundtrip referential counts stage journal',persistence)

def preservation():
 c=read('checkpoint.json');bad=[p for p,h in c['files'].items()if not Path(p).is_file()or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h];assert not bad,bad
 (R/'preservation.json').write_text(json.dumps({'status':'PASS','files':len(c['files']),'changed':bad,'branch':c['branch'],'commit':c['commit']},indent=2)+'\n')
check('all certified baselines and production byte-identical',preservation)

def scope():
 for file in ['engine.ts','projection.ts','storage.ts']:
  s=(Path('research/active-pipeline')/file).read_text()
  for token in ['evaluateActiveSet(', 'cluster(', 'allocateStrategies(', 'runBacktestEngine(', 'executeBook(', 'proposeEvent(', 'register(', 'runCampaign(', 'fetch(']:assert token not in s,(file,token)
 assert read('manifest.json')['promotions_created']==0
check('no Bank computation optimizer math search promotion or execution in integration',scope)
result={'status':'PASS'if all(c['status']=='PASS'for c in checks)else'FAIL','methodology':'PIPE03_INDEPENDENT_ARITHMETIC_PERSISTED_REPLAY_1.0.0','passed':sum(c['status']=='PASS'for c in checks),'failed':sum(c['status']=='FAIL'for c in checks),'checks':checks,'tolerances':{'default_absolute_relative':1e-9,'optimizer_weights_absolute':2e-8,'variance_absolute':1e-13},'historical_replay':'BLOCKED_MISSING_STRATEGY_HISTORY'}
(R/'independent-replay.json').write_text(json.dumps(independent,indent=2)+'\n');(R/'independent-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='checks'}))
for c in checks:
 if c['status']=='FAIL':print(c)
raise SystemExit(0 if result['status']=='PASS'else 1)
