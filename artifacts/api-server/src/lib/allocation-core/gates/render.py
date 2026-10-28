"""Offline AL06 charts. No performance, selection or invented legacy history."""
import json,pathlib,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'reports/al06');out=root/'charts';out.mkdir(exist_ok=True)
rows=json.loads((root/'portfolio-gate-replay.json').read_text());signals=json.loads((root/'signal-gate-reference-results.json').read_text());plt.rcParams.update({'font.size':9,'figure.dpi':125})
def save(name,title,label):
    plt.title(title+'\n'+label);plt.tight_layout();plt.savefig(out/(name+'.png'));plt.close()
# Legacy time-series unavailable; explicit blocker instead of synthetic historical substitution.
(out/'01-signal-history-status.json').write_text(json.dumps({'status':'BLOCKED_MISSING_LEGACY_NODE3_SOURCE','legacy_node3':'LEGACY_NODE3_SOURCE_NOT_PRESENT_IN_CURRENT_REPOSITORY','chart_not_fabricated':True},indent=2)+'\n')
fig,axes=plt.subplots(1,3,figsize=(13,4));names=['pc1_share','dispersion','rank_stability']
for ax,name in zip(axes,names):
    for i,s in enumerate(signals):
        v=next(c['value'] for c in s['result']['components'] if c['check']==name)
        if v is not None:ax.bar(i,v)
    ax.set_title(name);ax.set_xticks(range(len(signals)),[s['case_id'].replace('SYNTHETIC_','') for s in signals],rotation=45,ha='right')
fig.suptitle('NEW CANONICAL SYNTHETIC FIXTURES — not a Node3 reconstruction');fig.tight_layout();fig.savefig(out/'02-signal-reference-diagnostics.png');plt.close(fig)
asset=[r for r in rows if r['input']['source']['mode']=='ASSETS' and r['result']['diagnostics'].get('asset_risk_breadth')]
plt.figure(figsize=(10,4))
for strategy in ['EQUAL_WEIGHT','MIN_VARIANCE','ERC']:
    subset=[r for r in asset if r['input']['source']['input']['objective']['type']==strategy];plt.plot([r['input']['as_of'] for r in subset],[r['result']['diagnostics']['asset_risk_breadth']['pca_bets'] for r in subset],label=strategy)
dates=sorted({r['input']['as_of'] for r in asset});plt.xticks(range(0,len(dates),24),[dates[i] for i in range(0,len(dates),24)],rotation=25);plt.ylabel('Portfolio PCA entropy bets');plt.legend();save('03-portfolio-risk-bets','Frozen AL03 risk breadth through allocation dates','Historical research observation; covariance rank != portfolio bets')
modes=['ASSETS','FACTORS','STRATEGY_STREAMS'];plt.figure(figsize=(8,4))
for i,m in enumerate(modes):
    v=[r['result']['diagnostics']['asset_concentration']['hhi'] for r in rows if r['input']['source']['mode']==m and r['result']['diagnostics'].get('asset_concentration') and r['result']['diagnostics']['asset_concentration']['hhi'] is not None];plt.scatter([i]*len(v),v,s=9,alpha=.35)
plt.xticks(range(3),modes);plt.ylabel('Instrument normalized absolute HHI');save('04-concentration','Mapped instrument concentration across modes','AL04/05 synthetic; signed absolute HHI is not capital diversification')
plt.figure(figsize=(8,4))
for i,m in enumerate(modes):
    vals=[]
    for r in rows:
        if r['input']['source']['mode']!=m:continue
        c=next((c for c in r['result']['components'] if c['check']=='allocation_l1'),None)
        if c and c['value'] is not None:vals.append(c['value'])
    plt.scatter([i]*len(vals),vals,s=10,alpha=.35)
plt.xticks(range(3),modes);plt.ylabel('Maximum declared stress allocation L1');save('05-sensitivity','Supplied local sensitivity artifacts','Failed stresses remain explicit; no generated perturbations')
fig,axes=plt.subplots(1,2,figsize=(10,4))
for i,m in enumerate(modes):
    v=[]
    for r in rows:
        if r['input']['source']['mode']!=m:continue
        t=r['result']['diagnostics'].get('turnover',{})
        for k,z in t.items():
            if z is not None:v.append(z)
    axes[0].scatter([i]*len(v),v,s=9,alpha=.35)
axes[0].set_xticks(range(3),modes,rotation=15);axes[0].set_title('Separate turnover observations');axes[0].set_ylabel('Gross L1 (not fee notional)')
costs=[r for r in rows if r['result']['diagnostics'].get('costs',{}).get('incremental') is not None]
for i,r in enumerate(costs):axes[1].bar(i,r['result']['diagnostics']['costs']['incremental']['amount'])
axes[1].set_title('Supplied incremental cost only');axes[1].set_ylabel('Declared capital currency; no unit conversion');fig.suptitle('Embedded strategy costs never recharged; missing costs stay unavailable');fig.tight_layout();fig.savefig(out/'06-turnover-costs.png');plt.close(fig)
strategy=[r for r in rows if r['input']['source']['mode']=='STRATEGY_STREAMS' and r['result']['diagnostics'].get('correlation')]
plt.figure(figsize=(11,4));x=np.arange(len(strategy));plt.bar(x,[r['result']['diagnostics']['correlation']['largest_correlation_cluster'] for r in strategy]);plt.xticks(x,[r['case_id'].split('|')[-1] for r in strategy],rotation=70,ha='right');plt.ylabel('Largest abs-correlation >= 0.9 cluster');save('07-strategy-correlation','Correlation/redundancy diagnostics','Frozen synthetic strategies retained; never automatically pruned')
plt.figure(figsize=(9,4));statuses=['PASS','FAIL','INSUFFICIENT_DATA','INVALID_INPUT','NUMERICAL_FAILURE'];bottom=np.zeros(3)
for status in statuses:
    count=np.array([sum(r['result']['status']==status and r['input']['source']['mode']==m for r in rows) for m in modes]);plt.bar(modes,count,bottom=bottom,label=status);bottom+=count
plt.ylabel('Observed allocations (not promotion/execution)');plt.legend();save('08-gate-outcomes','Robustness gate outcome by mode','Fixed QA policies; no winner or economic tuning')
print(json.dumps({'charts':len(list(out.glob('*.png'))),'legacy_signal_chart':'BLOCKED_MISSING_LEGACY_NODE3_SOURCE'}))
