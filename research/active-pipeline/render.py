"""Supplementary synthetic integration diagrams, no economic performance claim."""
from pathlib import Path
import json,collections
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=Path('reports/pipe03');O=R/'charts';O.mkdir(exist_ok=True)
rows=json.loads((R/'acceptance-results.json').read_text());plt.rcParams.update({'figure.dpi':125,'font.size':9})
fig,ax=plt.subplots(figsize=(12,3));ax.axis('off')
labels=['Frozen BANK01\nActiveSet','Active-axis\nartifact projection','AL05 via\nPIPE01','AL06\nRobustness','AL01/02\nController','Certified target\nPIPE02 routing']
for i,label in enumerate(labels):
 ax.text(i,.5,label,ha='center',va='center',bbox={'boxstyle':'round','fc':'#e5f0fc','ec':'#2c557a'})
 if i<len(labels)-1:ax.annotate('',xy=(i+.78,.5),xytext=(i+.25,.5),arrowprops={'arrowstyle':'->','color':'#2c557a'})
ax.set_xlim(-.5,5.5);ax.set_ylim(0,1);fig.suptitle('PIPE03 — target integration only; no execution');fig.tight_layout();fig.savefig(O/'01-stage-flow.png',metadata={'Software':'PIPE03 deterministic synthetic diagrams'});plt.close(fig)
c=collections.Counter(r['result']['status']for r in rows);fig,ax=plt.subplots(figsize=(10,4));ax.barh(list(c),list(c.values()));ax.set_xlabel('Synthetic cases');ax.set_title('Primary pipeline outcomes — expected blocks retained');fig.tight_layout();fig.savefig(O/'02-primary-outcomes.png',metadata={'Software':'PIPE03 deterministic synthetic diagrams'});plt.close(fig)
fig,ax=plt.subplots(figsize=(10,4));chosen=[r for r in rows if r['case_id'].endswith('MIN_VARIANCE')][:5];labels=[r['case_id'].replace('_MIN_VARIANCE','')for r in chosen];active=[len(r['result']['active_ids'])for r in chosen];allocated=[sum(v>0 for v in r['result']['pipeline']['allocation']['result']['allocations'].values())for r in chosen];ax.barh(labels,[5]*len(labels),label='Promoted QA controls',color='#cbd5e1');ax.barh(labels,active,label='Active',color='#4f8eb9',height=.6);ax.barh(labels,allocated,label='Positive capital',color='#24577c',height=.3);ax.legend();ax.set_xlabel('Distinct strategy instances');ax.set_title('Promoted, active and allocated remain different concepts');fig.tight_layout();fig.savefig(O/'03-membership.png',metadata={'Software':'PIPE03 deterministic synthetic diagrams'});plt.close(fig)
fig,ax=plt.subplots(figsize=(8,3));ax.barh(['Certified primary targets','NO_NEW_TARGET routes','New promotions'],[16,20,0],color=['#357e99','#ad8157','#64748b']);ax.set_xlabel('Synthetic case count');ax.set_title('Mechanical target validity does not imply governance approval');fig.tight_layout();fig.savefig(O/'04-routing-boundary.png',metadata={'Software':'PIPE03 deterministic synthetic diagrams'});plt.close(fig)
print(json.dumps({'charts':4,'scope':'SYNTHETIC_MECHANICAL_INTEGRATION'}))
