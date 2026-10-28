"""Presentation only, reading persisted PIPE-01 CSVs; no backtest/search."""
import csv
import json
import pathlib
from collections import Counter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

root = pathlib.Path('reports/pipe01')
out = root/'charts'
out.mkdir(exist_ok=True)
plt.rcParams.update({'figure.dpi': 130, 'axes.grid': True, 'grid.alpha': .2, 'font.size': 10})


def rows(name):
    with open(root/name, newline='') as f:
        return list(csv.DictReader(f))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(out/name, bbox_inches='tight')
    plt.close(fig)


fig, ax = plt.subplots(figsize=(8, 13))
names = ['DecisionContext validated', 'RiskMandate resolved', 'SignalQualityGate PASS or declared NOT_REQUIRED', 'Certified allocator ASSETS / FACTORS / STRATEGY_STREAMS', 'Certified PIT SleeveRiskEstimate', 'PortfolioRobustnessGate PASS', 'AL01 ExposureController', 'FinalPortfolioTarget', 'Declared research execution', 'Accounting reconciliation', 'AL02 realized attribution']
for i, name in enumerate(names):
    y = len(names)-i
    ax.text(.5, y, name, ha='center', va='center', bbox=dict(boxstyle='round,pad=.6', facecolor='#e6f0ff', edgecolor='#315a8a'))
    if i < len(names)-1:
        ax.annotate('', xy=(.5, y-.72), xytext=(.5, y-.27), arrowprops=dict(arrowstyle='->', color='#315a8a'))
ax.set(xlim=(0, 1), ylim=(.4, len(names)+.7), title='PIPE 01 canonical stage order\nAny required-stage failure stops subsequent stages')
ax.axis('off')
save(fig, '01-canonical-stage-flow.png')

decisions = sorted([r for r in rows('decision-ledger.csv') if r['book_id'].startswith('AL07_REAL_NESTED_ROLLING') and '_0bps_NORMALIZED' in r['book_id']], key=lambda r: r['date'])
risk = {r['decision_context_id']: r for r in rows('risk-reconciliation.csv') if r['track'] == 'NORMALIZED'}
x = np.array([np.datetime64(r['date']) for r in decisions])
fig, ax = plt.subplots(figsize=(10, 4))
ax.plot(x, [float(r['expected_beta']) for r in decisions], label='Expected final PIT beta / declared target')
ax.plot(x, [float(risk[r['decision_context_id']]['realized_forward_beta']) for r in decisions], marker='.', label='Realized forward beta; after fill / before next fill')
ax.set(title='Expected and realized beta are distinct estimates', ylabel='SPY beta')
ax.legend(fontsize=8)
save(fig, '02-target-versus-realized-beta.png')

fig, ax = plt.subplots(figsize=(10, 4))
ax.step(x, [float(r['exposure_multiplier']) for r in decisions], where='post')
ax.set(title='Exposure multiplier from the unchanged target beta mandate', ylabel='Multiplier')
save(fig, '03-exposure-multiplier.png')

fig, ax = plt.subplots(figsize=(10, 4))
cash = np.array([float(r['implementation_cash']) for r in decisions])
ax.stackplot(x, 1-cash, cash, labels=['Target risky allocation', 'Controller implementation cash'], colors=['#315a8a', '#d9dfe7'], step='post')
ax.set(title='Only the ExposureController determines global implementation cash', ylim=(0, 1), ylabel='Fraction of final NAV')
ax.legend(loc='upper right')
save(fig, '04-risky-allocation-and-cash.png')

equity = rows('oos-equity.csv')
curves = {}
for track in ['RAW', 'NORMALIZED']:
    series = sorted([r for r in equity if r['book_id'].startswith('AL07_REAL_NESTED_ROLLING') and '_5bps_' in r['book_id'] and r['track'] == track], key=lambda r: r['date'])
    returns = np.array([float(r['return']) for r in series])
    value = 100*np.cumprod(1+returns)
    curves[track] = (np.array([np.datetime64(r['date']) for r in series]), value)
fig, ax = plt.subplots(figsize=(10, 4))
for track, (dates, value) in curves.items():
    ax.plot(dates, value, label=track)
ax.set(title='Frozen selected outer OOS books replayed at 5 bps\nResearch index, independent NAV100 sleeves; not a continuous live account', ylabel='Composite research index')
ax.legend()
save(fig, '05-raw-versus-final-equity.png')

fig, ax = plt.subplots(figsize=(10, 4))
for track, (dates, value) in curves.items():
    high = np.maximum.accumulate(np.r_[100, value])[1:]
    ax.plot(dates, 100*(value/high-1), label=track)
ax.set(title='Outer OOS composite drawdown; same selected q, different exposure', ylabel='Drawdown %')
ax.legend()
save(fig, '06-drawdown-comparison.png')

negative = json.loads((root/'negative-fixtures.json').read_text())['decisions']
counts = Counter(r['status'] for r in negative)
fig, axes = plt.subplots(1, 2, figsize=(13, 5))
axes[0].barh(list(counts), list(counts.values()), color='#aa5b51')
axes[0].set(title='Synthetic negative fixtures retained\nExpected rejections; real selected replay has zero failures', xlabel='Recorded synthetic decisions')
blocked = rows('blockers.csv')
axes[1].barh([r['mode'] for r in blocked], [1]*len(blocked), color='#d0a44b')
axes[1].set(title='Scope blockers retained\nHistorical/legacy/signed paths; not fabricated', xlabel='Explicit blocker')
save(fig, '07-failures-and-blockers.png')

account = rows('accounting-reconciliation.csv')
fields = ['nav', 'cash', 'fees', 'pnl', 'nav_change', 'position_quantity', 'continuity', 'position_value']
values = [max(abs(float(r[k])) for r in account) for k in fields]
fig, ax = plt.subplots(figsize=(10, 4))
ax.bar(fields, values, color='#315a8a')
ax.set(title='Maximum absolute independent ledger identity errors\nDeclared absolute acceptance tolerance: 1e-9 NAV100 currency', ylabel='Maximum absolute residual')
ax.tick_params(axis='x', rotation=25)
save(fig, '08-accounting-reconciliation-errors.png')
print('8 charts generated from persisted outputs only')
