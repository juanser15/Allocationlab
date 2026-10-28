"""Read AL02 artifacts only; no formulas reimplemented for analytics outputs."""
from pathlib import Path
import json,csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime
r=Path('reports/al02');out=r/'charts';out.mkdir(exist_ok=True);scores=json.loads((r/'scorecards.json').read_text())
with(r/'rolling-beta-cl02.csv').open(newline='')as f:rolling=list(csv.DictReader(f))
styles={'B':('Dynamic B','#1f77b4'),'B_control':('Constant exposure','#ff7f0e'),'CF':('Constant beta retrospective','#2ca02c')}
def names(bps):return[(f'B_{bps}bps','B'),(f'B_control_{bps}bps','B_control'),(f'B_constant_beta_diagnostic_from_{bps}bps','CF')]
fig,axes=plt.subplots(2,2,figsize=(13,8),sharex=True)
for col,bps in enumerate([0,5]):
 for row,window in enumerate([63,126]):
  ax=axes[row,col]
  for name,kind in names(bps):
   v=[x for x in rolling if x['candidate']==name and int(x['window'])==window];label,color=styles[kind]
   ax.plot([datetime.fromisoformat(x['date'])for x in v],[float(x['value'])for x in v],label=label,color=color,lw=1)
  ax.set_title(f'{window} sessions; source {bps} bps');ax.set_ylabel('Realized rolling beta');ax.grid(alpha=.2)
axes[0,0].legend(fontsize=8);fig.tight_layout();fig.savefig(out/'rolling-beta-dynamic-vs-constant.png',dpi=140);plt.close(fig)
fig,axes=plt.subplots(1,2,figsize=(12,5))
for ax,bps in zip(axes,[0,5]):
 for i,(name,kind)in enumerate(names(bps)):
  label,color=styles[kind];c=scores[name]['condition'];ax.bar(i-.16,c['upside_beta']['value'],width=.3,color=color,label=label);ax.bar(i+.16,c['downside_beta']['value'],width=.3,color=color,hatch='//',alpha=.6)
 ax.set_xticks(range(3),['Dynamic','Constant exposure','Constant beta']);ax.set_title(f'{bps} bps source; solid upside / hatched downside');ax.set_ylabel('Conditional beta');ax.grid(axis='y',alpha=.2)
fig.tight_layout();fig.savefig(out/'upside-downside-beta.png',dpi=140);plt.close(fig)
for key,points,labels,filename in [('drawdown_beta',['0.05','0.1','0.2'],['DD ≤ -5%','DD ≤ -10%','DD ≤ -20%'],'drawdown-beta-term-structure.png'),('tail_beta',['0.05','0.01'],['Q5%','Q1%'],'tail-beta-term-structure.png')]:
 fig,axes=plt.subplots(1,2,figsize=(12,5))
 for ax,bps in zip(axes,[0,5]):
  for name,kind in names(bps):
   label,color=styles[kind];ax.plot(labels,[scores[name]['condition'][key][p]['value']for p in points],marker='o',label=label,color=color)
  ax.set_title(f'{bps} bps source');ax.set_ylabel('Realized conditioned beta');ax.grid(alpha=.2)
 axes[0].legend(fontsize=8);fig.tight_layout();fig.savefig(out/filename,dpi=140);plt.close(fig)
fig,ax=plt.subplots(figsize=(9,6))
for bps,marker in [(0,'o'),(5,'x')]:
 for name,kind in names(bps):
  s=scores[name];label,color=styles[kind];ax.scatter(s['average_beta'],s['cagr']*100,color=color,marker=marker);ax.annotate(f'{label} ({bps} bps source)',(s['average_beta'],s['cagr']*100),fontsize=7,xytext=(3,5),textcoords='offset points')
 s=scores[f'A_{bps}bps'];ax.scatter(s['average_beta'],s['cagr']*100,color='gray',marker=marker);ax.annotate(f'A {bps} bps',(s['average_beta'],s['cagr']*100),fontsize=8)
ax.set_xlabel('Mean realized rolling63 beta (retrospective)');ax.set_ylabel('Calendar CAGR (%)');ax.grid(alpha=.2);fig.tight_layout();fig.savefig(out/'cagr-vs-average-beta.png',dpi=140);plt.close(fig)
fig,axes=plt.subplots(1,2,figsize=(13,6))
for ax,bps in zip(axes,[0,5]):
 for i,(name,kind)in enumerate(names(bps)):
  s=scores[name];alpha=s['capm']['alpha_annualized'];# market component from actual annual mean minus regression intercept.
  with(r/'equity-cl02.csv').open(newline='')as f:returns=[float(x['net_return'])for x in csv.DictReader(f)if x['candidate']==name]
  total=sum(returns)/len(returns)*252;component=total-alpha
  ax.bar(i,component*100,color=styles[kind][1],label='Market beta component'if i==0 else None);ax.bar(i,alpha*100,bottom=component*100,color='purple',label='CAPM intercept component'if i==0 else None)
  ta=s['capm']['t_alpha'];tg=s['treynor_mazuy']['t_gamma'];ax.text(i,total*100+.15,f'tα={ta:.3f}\ntγ={tg:.3f}'if ta is not None and tg is not None else 't-stats unidentified\nzero residual noise',ha='center',fontsize=8)
 ax.set_xticks(range(3),['Dynamic B','Constant exposure','Constant beta']);ax.set_title(f'{bps} bps source; CF frictionless');ax.set_ylabel('252 × daily mean excess return (%)');ax.grid(axis='y',alpha=.2)
axes[0].legend(fontsize=8);fig.suptitle('Linear CAPM attribution, not CAGR; no alpha/skill claim');fig.tight_layout();fig.savefig(out/'dynamic-vs-constant-beta-attribution.png',dpi=140);plt.close(fig)
print('Saved 6 required charts from persisted AL02 outputs')
