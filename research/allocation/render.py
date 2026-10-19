import csv,json,pathlib
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root=pathlib.Path('reports/al07');out=root/'charts';out.mkdir(exist_ok=True)
read=lambda n:list(csv.DictReader(open(root/(n+'.csv'),newline='')))
short=lambda s:'Nested rolling' if 'NESTED' in s else 'Traditional expanding'
colors={'RAW':'#bf6334','NORMALIZED':'#246399'}
def save(name,title):plt.title(title);plt.tight_layout();plt.savefig(out/name,dpi=160);plt.close()
outer=read('outer-oos-results');sel=read('inner-selection')
plt.figure(figsize=(8,4))
for o in outer:
 if o.get('track')!='NORMALIZED' or o.get('scenario_bps')!='5':continue
 selected=next(s for s in sel if s['campaign_id']==o['campaign_id'] and s['outer_fold']==o['outer_fold'] and s['selected']=='true');m=json.loads(selected['metrics']);plt.scatter(m['sharpe'],float(o['sharpe']),label=short(o['campaign_id'])+' fold '+o['outer_fold'])
plt.xlabel('Train / inner-OOS net Sharpe');plt.ylabel('Outer-OOS net Sharpe');plt.legend(fontsize=8);save('01-inner-vs-outer.png','Selection input versus subsequent OOS (5bps)')
ranks=read('inner-fold-ranks');plt.figure(figsize=(9,4));ids=sorted({r['candidate_id'] for r in ranks if r['status']=='VALID'})
for id in ids:
 rows=[r for r in ranks if r['candidate_id']==id and 'NESTED' in r['campaign_id']];plt.plot(range(len(rows)),[float(r['rank']) for r in rows],marker='o',label=id[4:12])
plt.ylabel('Candidate rank (lower first)');plt.xlabel('Inner validation fold');plt.legend(title='Candidate ID',fontsize=8);save('02-ranking-stability.png','Inner candidate ranking stability')
pooled=read('performance-summary');rows=[r for r in pooled if r['scenario_bps']=='5'];plt.figure(figsize=(8,4))
for i,r in enumerate(rows):plt.bar(i,100*float(r['cagr']),color=colors[r['track']])
plt.xticks(range(len(rows)),[short(r['campaign_id'])+'\n'+r['track'] for r in rows],fontsize=8);plt.ylabel('CAGR (%)');save('03-raw-vs-normalized.png','Selected outer-OOS sleeves; same target beta 0.30')
plt.figure(figsize=(7,4))
for r in rows:plt.scatter(float(r['beta']),100*float(r['cagr']),color=colors[r['track']]);plt.annotate(short(r['campaign_id'])+' '+r['track'],(float(r['beta']),100*float(r['cagr'])),fontsize=7)
plt.xlabel('Realized full beta');plt.ylabel('CAGR (%)');save('04-cagr-vs-beta.png','Realized beta differs from the PIT target; no alpha claim')
plt.figure(figsize=(8,4));x=np.arange(len(rows));plt.bar(x-.15,[float(r['downside_beta']) for r in rows],.3,label='Downside beta');plt.bar(x+.15,[float(r['tail_beta']) for r in rows],.3,label='Q5 tail beta');plt.xticks(x,[short(r['campaign_id'])+'\n'+r['track'] for r in rows],fontsize=8);plt.legend();save('05-downside-tail.png','Outer-OOS risk asymmetry (5bps)')
surface=read('empirical-response-surface');plt.figure(figsize=(10,4));chosen=[r for r in surface if r['stage']=='inner' and r['scenario_bps']=='5'];types=sorted({r['parameter.objective.type'] for r in chosen if r.get('parameter.objective.type')})
for i,obj in enumerate(types):
 valid=[json.loads(r['normalized_metrics'])['sharpe'] for r in chosen if r['parameter.objective.type']==obj and r['status']=='VALID'];plt.scatter([i]*len(valid),valid,label=obj)
 if not valid:plt.text(i,0,'BLOCKED',ha='center',fontsize=8)
plt.xticks(range(len(types)),types,rotation=20);plt.ylabel('Inner OOS net Sharpe');save('06-parameter-response.png','Categorical objective response; missing candidates not interpolated')
plt.figure(figsize=(8,4))
for campaign in sorted({r['campaign_id'] for r in outer}):
 rr=[r for r in outer if r['campaign_id']==campaign and r['track']=='NORMALIZED' and r['scenario_bps']=='5'];plt.plot([int(r['outer_fold']) for r in rr],[float(r['sharpe']) for r in rr],marker='o',label=short(campaign))
plt.legend();plt.xlabel('Outer fold');plt.ylabel('Net Sharpe');save('07-fold-performance.png','Visible fold dispersion, not just pooled performance')
wins=read('selection-frequency');plt.figure(figsize=(10,4));selected=[r for r in wins if int(r['outer_selections'])>0];plt.bar(range(len(selected)),[int(r['outer_selections']) for r in selected]);plt.xticks(range(len(selected)),[short(r['campaign_id'])+'\n'+r['candidate_id'][4:12] for r in selected]);plt.ylabel('Outer selections');save('08-selection-frequency.png','Procedural selection frequency; no economic winner declaration')
fail=read('failure-summary');plt.figure(figsize=(9,4));reasons=sorted({r['reason'] for r in fail});plt.barh(reasons,[sum(r['reason']==reason for r in fail) for reason in reasons]);plt.xlabel('Retained attempts');plt.yticks(fontsize=8);save('09-blocker-distribution.png','Missing inputs remain blocked, not failed optimizers')
p=read('psr');values=[float(r['probability']) for r in p if r['stage']=='outer' and r['track']=='NORMALIZED' and r['status']=='VALID'];plt.figure(figsize=(7,4));plt.hist(values,bins=np.linspace(0,1,11));plt.xlabel('PSR probability vs zero annual Sharpe');plt.ylabel('Outer sleeve count');save('10-psr.png','IID diagnostic only; DSR NOT_IMPLEMENTED')
print(json.dumps({'charts':len(list(out.glob('*.png'))),'status':'PASS'}))
