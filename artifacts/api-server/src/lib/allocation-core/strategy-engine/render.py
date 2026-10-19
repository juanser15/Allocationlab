"""Offline AL05 charts; every chart visibly labelled SYNTHETIC MECHANICAL FIXTURE."""
import json,pathlib,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'reports/al05');out=root/'charts';out.mkdir(exist_ok=True)
rows=json.loads((root/'synthetic-results.json').read_text());valid=[r for r in rows if r['result']['status']=='VALID'];base=[r for r in valid if r['id'] in ['EQUAL_CAPITAL','MIN_VARIANCE','ERC','MEAN_VARIANCE','MAX_SHARPE']]
plt.rcParams.update({'font.size':9,'figure.dpi':130})
def save(name,title):
    plt.title(title+'\nSYNTHETIC MECHANICAL FIXTURE — not alpha evidence');plt.tight_layout();plt.savefig(out/(name+'.png'));plt.close()
labels=[r['id'] for r in base];weights=np.array([[r['result']['allocations'][f'STRATEGY_{i}'] for i in range(3)] for r in base]);x=np.arange(len(base))
plt.figure(figsize=(9,4));bottom=np.zeros(len(base))
for i in range(3):plt.bar(x,weights[:,i],bottom=bottom,label='Strategy instance '+str(i));bottom+=weights[:,i]
plt.xticks(x,labels);plt.ylabel('Allocated stream risk capital');plt.legend();save('01-stream-allocations','Strategy capital allocations by declared objective')
plt.figure(figsize=(9,4));width=.25
for i in range(3):plt.bar(x+(i-1)*width,[r['result']['return_risk']['normalized_shares'][f'STRATEGY_{i}'] for r in base],width,label='Strategy '+str(i))
plt.xticks(x,labels);plt.ylabel('Share of stream-return variance');plt.legend();save('02-return-risk-contributions','Strategy-return risk contributions')
chosen=[r for r in valid if r['id'] in ['signed-opposing','internal-residual','post-map-shared-asset-cap','signed-net-band']]
plt.figure(figsize=(9,4));xx=np.arange(len(chosen));assets=sorted({a for r in chosen for a in r['result']['aggregation']['instrument_exposures']})
for i,a in enumerate(assets):plt.bar(xx+(i-(len(assets)-1)/2)*.3,[r['result']['aggregation']['instrument_exposures'].get(a,0) for r in chosen],.3,label=a)
plt.axhline(0,color='black',lw=.5);plt.xticks(xx,[r['id'] for r in chosen],rotation=10);plt.ylabel('Signed exposure per stream capital');plt.legend();save('03-instrument-exposures','H·a after algebraic netting')
plt.figure(figsize=(9,4));plt.bar(xx-.2,[r['result']['aggregation']['pre_net_gross'] for r in chosen],.4,label='Before netting');plt.bar(xx+.2,[r['result']['aggregation']['post_net_gross'] for r in chosen],.4,label='After netting');plt.xticks(xx,[r['id'] for r in chosen],rotation=10);plt.legend();plt.ylabel('Gross instrument exposure');save('04-gross-netting','Pre-net versus post-net gross exposure')
plt.figure(figsize=(9,4));plt.bar(x-.2,[r['result']['strategy_return_beta'] for r in base],.4,label='Allocated strategy-return beta');plt.bar(x+.2,[r['result']['current_position_beta'] for r in base],.4,label='Current-position beta');plt.xticks(x,labels);plt.ylabel('Beta to supplied benchmark');plt.legend();save('05-beta-concepts','Different return-space and current-position risk concepts')
plt.figure(figsize=(9,4));plt.bar(x-.25,[r['result']['return_risk']['effective_allocations'] for r in base],.25,label='Effective strategy allocations');plt.bar(x,[r['result']['return_risk']['covariance_effective_rank'] for r in base],.25,label='Return covariance effective rank');plt.bar(x+.25,[r['result']['return_risk']['pca_effective_risk_bets'] for r in base],.25,label='Strategy portfolio PCA bets');plt.xticks(x,labels);plt.ylabel('Separate dimensions/count diagnostics');plt.legend();save('06-stream-effective-bets','Allocation count, covariance rank and PCA risk bets')
turn=[r for r in valid if r['result']['aggregation']['strategy_turnover_l1'] is not None];xx=np.arange(len(turn))
plt.figure(figsize=(8,4));plt.bar(xx-.2,[r['result']['aggregation']['strategy_turnover_l1'] for r in turn],.4,label='Strategy allocations');plt.bar(xx+.2,[r['result']['aggregation']['instrument_turnover_l1'] for r in turn],.4,label='Instrument exposures');plt.xticks(xx,[r['id'] for r in turn],rotation=10);plt.ylabel('Gross L1 turnover (not actual execution cost)');plt.legend();save('07-turnover-spaces','Stream versus instrument turnover')
print(json.dumps({'charts':len(list(out.glob('*.png'))),'label':'SYNTHETIC','historical_economic_chart':'BLOCKED_MISSING_CANONICAL_ALPHA_STREAM_ARTIFACTS'}))
