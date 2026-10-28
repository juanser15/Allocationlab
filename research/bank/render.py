"""Synthetic QA charts only, deterministic fixed inputs and no economic claims."""
import json,collections
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path('reports/bank01');O=R/'charts';O.mkdir(exist_ok=True)
rows=json.loads((R/'synthetic-results.json').read_text())
plt.rcParams.update({'font.size':9,'axes.grid':True,'grid.alpha':.18,'figure.dpi':125})
def series(name):return [r['result']for r in rows if r['fixture_id']==name]
def save(name,title):
 plt.gcf().suptitle('SYNTHETIC QA — '+title,fontsize=12);plt.tight_layout(rect=[0,0,1,.95]);plt.savefig(O/name,metadata={'Software':'Allocation Lab BANK01 deterministic synthetic verification'});plt.close()
r=series('reentry_CAP1');dates=[x['decision_date']for x in r]
plt.figure(figsize=(9,4));plt.plot(dates,[sum(e['promotion_status']=='PROMOTED'for e in x['entries'])for x in r],label='Externally supplied QA promoted');plt.plot(dates,[len(x['active_strategy_ids'])for x in r],marker='o',label='Computed active');plt.ylabel('Strategy instances');plt.xticks(rotation=25);plt.legend();save('01-active-promoted.png','Promoted and active are distinct')
plt.figure(figsize=(9,4))
for name in ['crisis_PRESERVE','same-family-markets_PRESERVE']:
 r=series(name);plt.plot([x['decision_date']for x in r],[x['diagnostics']['strategy']['average_pairwise_correlation']for x in r],marker='o',label=name)
plt.xticks(rotation=25);plt.ylabel('PIT rolling 63-session mean correlation');plt.ylim(-.15,1.05);plt.legend();save('02-rolling-correlation.png','Return correlation changes causally')
r=series('changing-clusters_CAP1');members=[]
for x in r:
 cs=sorted(x['clustering']['clusters'],key=lambda c:c['members']);members.append([next(i for i,c in enumerate(cs)if id in c['members'])for id in ['CONTROL_'+str(i)for i in range(5)]])
plt.figure(figsize=(9,4));plt.imshow(np.array(members).T,aspect='auto',interpolation='nearest',cmap='tab10',vmin=0,vmax=9);plt.yticks(range(5),['CONTROL_'+str(i)for i in range(5)]);plt.xticks(range(len(r)),[x['decision_date']for x in r],rotation=25);plt.colorbar(label='Display cluster number (artifact IDs persisted)');save('03-cluster-history.png','Dynamic clusters; numbering is display-only')
plt.figure(figsize=(9,4))
for name in ['crisis_PRESERVE','same-family-markets_PRESERVE','same-asset_PRESERVE']:
 r=series(name);plt.plot([x['decision_date']for x in r],[x['diagnostics']['strategy']['pca_effective_bets']for x in r],marker='o',label=name)
plt.xticks(rotation=25);plt.ylabel('PCA risk bets of equal-unit DIAGNOSTIC probe');plt.legend();save('04-effective-strategy-bets.png','Strategy breadth is not nominal count')
plt.figure(figsize=(9,4));r=series('same-asset_PRESERVE')[-1];d=r['diagnostics']['strategies_per_underlying'];plt.bar(list(d),list(d.values()));plt.ylabel('Distinct strategy instances');save('05-underlying-counts.png','Five instances may share one underlying')
plt.figure(figsize=(9,4));r=series('same-family-markets_PRESERVE')[-1];d=r['diagnostics']['strategies_per_family'];plt.bar(list(d),list(d.values()));plt.ylabel('Active strategy instances');save('06-family-counts.png','Same family across markets remains distinct')
fig,axes=plt.subplots(1,2,figsize=(9,4))
for ax,name in zip(axes,['crisis_PRESERVE','same-family-markets_PRESERVE']):
 r=series(name)[-1];im=ax.imshow(r['correlation']['correlation'],vmin=-1,vmax=1,cmap='coolwarm');ax.set_title(name);ax.set_xticks(range(5),range(5));ax.set_yticks(range(5),range(5));ax.grid(False)
fig.colorbar(im,ax=axes.ravel().tolist(),shrink=.7,label='Strategy-return Pearson correlation');fig.suptitle('SYNTHETIC QA — same estimator, different information sets');fig.savefig(O/'07-correlation-heatmaps.png',metadata={'Software':'Allocation Lab BANK01 deterministic synthetic verification'});plt.close()
c=collections.Counter(e['status']for row in rows for e in row['result']['entries']);plt.figure(figsize=(10,4));plt.barh(list(c),list(c.values()));plt.xlabel('Entry-decision observations');save('08-activation-reasons.png','Activation and inactivity remain explicit')
print(json.dumps({'charts':len(list(O.glob('*.png'))),'scope':'SYNTHETIC_QA_ONLY'}))
