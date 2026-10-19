"""Consolidate finished campaigns only; no research/selection execution."""
import csv,json,pathlib,hashlib,shutil
root=pathlib.Path('reports/al07');load=lambda p:json.loads(pathlib.Path(p).read_text())
directories=sorted((root/'campaigns').iterdir());registry=[]
names=['candidate-registry','job-registry','folds','candidate-results','inner-selection','outer-oos-results','performance-summary','risk-attribution','gate-outcomes','failure-summary','parameter-sensitivity','selection-stability','psr','alpha-decay','cross-sectional-analysis','inner-fold-ranks','selection-frequency','fold-performance-stability','comparable-controls','selection-bias','empirical-response-surface','oos-equity']
for name in names:
 rows=[]
 for d in directories:
  with open(d/(name+'.csv'),newline='') as f:rows.extend([{'campaign_id':d.name,**row} for row in csv.DictReader(f)])
 keys=list(dict.fromkeys(k for row in rows for k in row)) or ['campaign_id','status','reason']
 with open(root/(name+'.csv'),'w',newline='') as f:
  writer=csv.DictWriter(f,keys,quoting=csv.QUOTE_ALL,lineterminator='\r\n');writer.writeheader();writer.writerows(rows)
for d in directories:
 manifest=load(d/'manifest.json');summary=load(d/'summary.json');registry.append({'campaign_id':d.name,'manifest_hash':hashlib.sha256((d/'manifest.json').read_bytes()).hexdigest(),'candidate_registry_hash':manifest['candidate_registry_hash'],'data_snapshot_hash':manifest['data_snapshot_hash'],'code_hash':manifest['code_hash'],'folds':manifest['folds'],'validation_mode':manifest['campaign']['validation_mode'],'window_type':manifest['campaign']['window_type'],'summary':summary,'first_execution':load(root/'telemetry-first-complete.json')[d.name]})
assert len({r['candidate_registry_hash'] for r in registry})==1
assert len({r['data_snapshot_hash'] for r in registry})==1
(root/'campaign-registry.json').write_text(json.dumps({'status':'COMPLETE','campaigns':registry,'same_candidate_definitions':True,'same_data':True,'economic_winner_claim':False},indent=2)+'\n')
(root/'cache-manifest.json').write_text(json.dumps({d.name:load(d/'cache-manifest.json') for d in directories},indent=2)+'\n')
# Preserve exact frozen source files in the downloadable evidence package.
for file in ['reports/cl02/adjusted-closes.csv','reports/al03/allocation-inputs.json','reports/al03/allocation-solves.json','reports/al03/controller-results.json','reports/al03/sensitivity.csv']:
 dst=root/'inputs'/file;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,dst)
# Explicit decision-date universe and actual model training cutoff.
rows=[]
for d in directories:
 for file in sorted((d/'jobs').glob('*.json')):
  job=load(file)['value']
  for decision in job['decisions']:
   rows.append({'campaign_id':d.name,'job_id':job['job_id'],'candidate_id':job['candidate_id'],'date':decision['date'],'information_cutoff':decision['cutoff'],'eligible_universe':json.dumps(decision['eligible_universe']),'original_model_cutoff':(decision.get('model_reference') or {}).get('original_training_cutoff'),'source_model_hash':(decision.get('model_reference') or {}).get('original_artifact_hash'),'status':decision['status'],'reason':decision['reason']})
with open(root/'universe-history.csv','w',newline='') as f:
 w=csv.DictWriter(f,list(rows[0]),quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
# The pre-guard and certified economic returns agree on these genuine historical inputs.
comparisons=[]
for d in directories:
 before=load(root/'pre-source-validation'/'campaigns'/d.name/'summary.json')['performance'];after=load(d/'summary.json')['performance'];assert before==after;comparisons.append({'campaign_id':d.name,'economic_summary_unchanged_after_source_guard':True})
(root/'pre-post-economics.json').write_text(json.dumps({'status':'PASS','comparisons':comparisons,'code_identity_changed_and_old_results_preserved':True},indent=2)+'\n')
print(json.dumps({'campaigns':len(registry),'csv_tables':len(names)+1,'decision_universe_rows':len(rows),'same_definitions':True,'pre_post_economics':'PASS'}))
