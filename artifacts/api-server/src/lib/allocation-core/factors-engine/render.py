"""Six AL04 synthetic-only charts from persisted artifacts, no optimizer calls."""
import json,pathlib,numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
R=pathlib.Path('reports/al04');out=R/'charts';out.mkdir(exist_ok=True)
allrows=json.loads((R/'synthetic-fixtures.json').read_text());rows=[r for r in allrows if r['response']['status']=='VALID'];stress=json.loads((R/'sensitivity-details.json').read_text());plt.rcParams.update({'figure.dpi':140,'font.size':9,'axes.grid':True,'grid.alpha':.2})
def finish(name):plt.tight_layout();plt.savefig(out/(name+'.png'),bbox_inches='tight');plt.close()
selected=[r for r in rows if r['id'] in ['square-exact','explicit-approximate','singular-W-explicit-unpenalized-factor','negative-risk-contribution']]
fig,axes=plt.subplots(2,2,figsize=(11,7))
for ax,r in zip(axes.flat,selected):
    d=r['response']['result']['diagnostics'];f=sorted(d['target_factor_exposures']);loc=np.arange(len(f));ax.bar(loc-.16,[d['target_factor_exposures'][k] for k in f],width=.32,label='External target');ax.bar(loc+.16,[d['achieved_factor_exposures'][k] for k in f],width=.32,label='Achieved Bq');ax.set_xticks(loc,f);ax.axhline(0,color='black',lw=.7);ax.set_title('SYNTHETIC '+r['id']);ax.legend()
finish('target-vs-achieved-factor-exposures')
plt.figure(figsize=(11,5));loc=np.arange(len(rows));sys=[r['response']['result']['diagnostics']['systematic_variance'] for r in rows];spec=[r['response']['result']['diagnostics']['specific_variance'] for r in rows];plt.bar(loc,sys,label='Systematic e Phi e');plt.bar(loc,spec,bottom=sys,label='Specific q D q');plt.xticks(loc,[r['id'] for r in rows],rotation=65,ha='right');plt.yscale('log');plt.ylabel('Daily variance (log scale)');plt.title('SYNTHETIC systematic + specific risk');plt.legend();finish('systematic-vs-specific-risk')
fig,axes=plt.subplots(1,2,figsize=(10,4))
for ax,name in zip(axes,['square-exact','negative-risk-contribution']):
    r=next(r for r in rows if r['id']==name);d=r['response']['result']['diagnostics'];f=sorted(d['factor_risk_contributions']);v=[d['factor_risk_contributions'][k] for k in f];ax.bar(f,v,color=['#3c8dbc' if z>=0 else '#c84642' for z in v]);ax.axhline(0,color='black',lw=.7);ax.set_title('SYNTHETIC '+name);ax.set_ylabel('Signed RC factor (daily variance)')
finish('factor-risk-contributions')
plt.figure(figsize=(11,5));loc=np.arange(len(rows));bottom=np.zeros(len(rows));assets=['ASSET_0','ASSET_1','ASSET_2']
for a in assets:
    w=np.array([r['response']['result']['asset_weights_risk_sleeve'].get(a,0) for r in rows]);plt.bar(loc,w,bottom=bottom,label=a);bottom+=w
plt.xticks(loc,[r['id'] for r in rows],rotation=65,ha='right');plt.ylim(0,1.05);plt.ylabel('q: fraction of risky sleeve, no global cash');plt.title('SYNTHETIC tradable asset implementation weights');plt.legend();finish('asset-implementation-weights')
plt.figure(figsize=(8,4))
for r in selected:
    v=r['response']['result']['diagnostics']['factor_eigenvalues'];plt.plot(np.arange(1,len(v)+1),v,marker='o',label=r['id'])
plt.xlabel('Factor covariance eigenvalue index');plt.ylabel('Eigenvalue in declared factor-return units');plt.title('SYNTHETIC Phi eigenspectrum — not asset PCA bets');plt.legend(fontsize=8);finish('factor-covariance-eigen-spectrum')
fig,axes=plt.subplots(1,2,figsize=(11,5));labels=[r['id'] for r in rows];means=[np.mean([s['q_l1'] for s in stress if s['fixture']==r['id'] and s['status']=='VALID']) for r in rows];fails=[sum(s['status']=='INFEASIBLE' for s in stress if s['fixture']==r['id']) for r in rows];loc=np.arange(len(rows));axes[0].barh(loc,means);axes[0].set_yticks(loc,labels,fontsize=7);axes[0].set_xlabel('Mean L1 q change, feasible stresses');axes[1].barh(loc,fails,color='#c84642');axes[1].set_yticks(loc,labels,fontsize=7);axes[1].set_xlabel('Declared stress scenarios that are INFEASIBLE');fig.suptitle('SYNTHETIC sensitivity; no robustness optimization or fallback');finish('sensitivity-diagnostics')
print('Charts',len(list(out.glob('*.png'))))
