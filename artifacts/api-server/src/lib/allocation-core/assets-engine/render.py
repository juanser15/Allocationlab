"""AL03 plotting from persisted research artifacts only."""
import csv,json,pathlib,numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=pathlib.Path('reports/al03');out=R/'charts';out.mkdir(exist_ok=True)
read=lambda name:list(csv.DictReader((R/name).open()))
types=['EQUAL_WEIGHT','MIN_VARIANCE','ERC'];labels=['Equal Weight','Min Variance','ERC'];colors=['#3274a1','#e1812c','#3a923a']
plt.rcParams.update({'figure.dpi':140,'axes.grid':True,'grid.alpha':.2,'font.size':9})
def finish(name):plt.tight_layout();plt.savefig(out/(name+'.png'),bbox_inches='tight');plt.close()
alloc=read('allocation-results.csv');diag=read('diversification-diagnostics.csv');econ=read('economic-replay.csv');sens=read('sensitivity.csv')
fig,axes=plt.subplots(3,1,figsize=(11,8),sharex=True)
for ax,kind,label in zip(axes,types,labels):
    rows=[r for r in alloc if r['strategy']==kind];d=np.array([r['signal_date'] for r in rows],dtype='datetime64');qs=[json.loads(r['weights']) for r in rows];assets=['SPY','XLK','XLV','XLC'];ax.stackplot(d,*[[q.get(a,0) for q in qs] for a in assets],labels=assets,alpha=.8);ax.set_title(label+' — risky sleeve q; XLC only after observed warmup');ax.set_ylim(0,1)
axes[0].legend(ncol=4,loc='upper left');finish('allocations-through-time')
for mode,suffix,title in [('RAW','before','Raw risky sleeves'),('BETA_NORMALIZED','after','After same PIT target beta = 0.30')]:
    plt.figure(figsize=(7,5))
    for kind,label,color in zip(types,labels,colors):
        r=next(r for r in econ if r['strategy']==kind and r['mode']==mode and r['cost_bps']=='5');x=float(r['full_beta']);y=float(r['cagr'])*100;plt.scatter(x,y,color=color,s=70);plt.annotate(label,(x,y),xytext=(5,5),textcoords='offset points')
    plt.xlabel('Realized full sample beta (not the PIT target)');plt.ylabel('Net CAGR calendar %');plt.title(title+' — 5 bps research costs');finish('cagr-vs-beta-'+suffix+'-normalization')
fig,axes=plt.subplots(1,2,figsize=(11,4))
for ax,field,title in zip(axes,['annualized_volatility','max_drawdown'],['Annualized volatility %','Maximum drawdown loss %']):
    for j,mode in enumerate(['RAW','BETA_NORMALIZED']):
        y=[abs(float(next(r for r in econ if r['strategy']==kind and r['mode']==mode and r['cost_bps']=='5')[field]))*100 for kind in types];ax.bar(np.arange(3)+(j-.5)*.35,y,width=.35,label=mode)
    ax.set_xticks(np.arange(3),labels);ax.set_title(title);ax.legend()
finish('volatility-drawdown-comparison')
fig,axes=plt.subplots(2,1,figsize=(10,6),sharex=True)
for kind,label,color in zip(types,labels,colors):
    rows=[r for r in diag if r['strategy']==kind];d=np.array([r['signal_date'] for r in rows],dtype='datetime64');axes[0].plot(d,[float(r['pca_effective_risk_bets']) for r in rows],label=label,color=color);axes[1].plot(d,[float(r['effective_number_weights']) for r in rows],label=label,color=color)
axes[0].set_title('Portfolio entropy PCA effective risk bets — not minimum torsion ENB');axes[1].set_title('Weight effective number = 1 / HHI');axes[0].legend();finish('effective-bets-through-time')
fig,axes=plt.subplots(2,1,figsize=(10,6),sharex=True)
for ax,mode in zip(axes,['RAW','BETA_NORMALIZED']):
    for kind,label,color in zip(types,labels,colors):
        ledger=[json.loads(s) for s in (R/(kind+'_'+mode+'_5bps.ledger.jsonl')).read_text().splitlines()];rows=[r for r in ledger if r['executionSignalDate']];ax.plot(np.array([r['date'] for r in rows],dtype='datetime64'),[sum(abs(t['notional']) for t in r['trades'])/(r['beginningNav']+r['etfPnl']+r['cashPnl']) for r in rows],label=label,color=color)
    ax.set_title(mode+' — actual gross traded notional / pretrade NAV');ax.legend()
finish('turnover')
plt.figure(figsize=(10,4))
for kind,label,color in zip(types,labels,colors):
    rows=[r for r in diag if r['strategy']==kind];plt.plot(np.array([r['signal_date'] for r in rows],dtype='datetime64'),[float(r['hhi']) for r in rows],label=label,color=color)
plt.title('Risk sleeve concentration HHI through time');plt.legend();finish('weight-concentration')
matrix=np.array([[np.mean([float(r['weight_l1']) for r in sens if r['strategy']==kind and r['scenario']=='covariance-diagonal-shrink-'+str(level)]) for level in [.01,.05]] for kind in types]);plt.figure(figsize=(7,4));plt.imshow(matrix,aspect='auto',cmap='YlOrRd');plt.yticks(range(3),labels);plt.xticks(range(2),['1% diagonal shrink','5% diagonal shrink']);plt.colorbar(label='Mean local weight L1 change');
for i in range(3):
    for j in range(2):plt.text(j,i,f'{matrix[i,j]:.4f}',ha='center',va='center')
plt.title('Declared local sensitivity; no robustness optimization');finish('sensitivity-heatmap')
print('Charts',len(list(out.glob('*.png'))))
