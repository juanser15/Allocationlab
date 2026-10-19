"""Plots and summary from already verified production-engine ledgers only."""
import csv
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime

root = Path('reports/cl02')
manifest = json.loads((root / 'manifest.json').read_text())
checks = json.loads((root / 'verification.json').read_text())
assert all(x['status'] == 'PASS' for x in checks)
metrics = json.loads((root / 'metrics.json').read_text())
colors = {'A': '#263b58', 'B': '#00868b', 'B_control': '#a36b20'}
labels = {'A': '100% SPY', 'B': 'Cash rule 10–20%', 'B_control': 'Retrospective constant-exposure control'}
for cost in [0, 5]:
    fig, axes = plt.subplots(3, 1, figsize=(13, 10), sharex=True)
    for candidate in colors:
        name = f'{candidate}_{cost}bps'
        with (root / f'{name}.ledger.csv').open() as f:
            ledger = list(csv.DictReader(f))
        dates = [datetime.fromisoformat(r['date']) for r in ledger]
        axes[0].plot(dates, [float(r['endingNav']) / manifest['protocol']['initialNav'] * 100 for r in ledger], color=colors[candidate], label=labels[candidate])
        axes[1].plot(dates, [float(r['drawdown']) * 100 for r in ledger], color=colors[candidate])
        axes[2].plot(dates, [float(r['targetSPY']) * 100 for r in ledger], color=colors[candidate], linestyle='--', label=labels[candidate]+' target')
        axes[2].plot(dates, [float(r['effectiveSPYClose']) * 100 for r in ledger], color=colors[candidate], linewidth=0.7, alpha=0.7, label=labels[candidate]+' effective close')
    axes[0].set_ylabel('NAV index (start = 100)')
    axes[1].set_ylabel('Drawdown (%)')
    axes[2].set_ylabel('SPY exposure (%)')
    axes[2].set_ylim(0, 105)
    for ax in axes:
        ax.grid(alpha=0.2)
    axes[0].legend(fontsize=9)
    axes[2].legend(fontsize=7, ncol=2)
    fig.suptitle(f'CL-02 — {cost} bps per actual traded notional; cash yield 0\nConditional on frozen adjusted-close snapshot; not a new holdout', fontsize=12)
    fig.tight_layout()
    path = root / f'equity-drawdown-exposure-{cost}bps.png'
    if not path.exists():
        fig.savefig(path, dpi=160)
    plt.close(fig)
    print(path)

header = '| Case | CAGR | Volatility | Sharpe (daily excess over 0) | Max DD | Recovery of max DD | Target SPY mean* | Effective SPY mean** | Gross turnover | Costs (NAV units) |\n|---|---:|---:|---:|---:|---|---:|---:|---:|---:|\n'
body = ''
for m in metrics:
    pct = lambda key: f"{m[key]*100:.2f}%"
    recovery = m['maxDrawdownRecovery'] or 'PENDING'
    body += f"| {m['id']} | {pct('CAGR')} | {pct('annualizedVolatility')} | {m['Sharpe']:.3f} | {pct('maxDrawdown')} | {recovery} | {pct('meanTargetSPYAllLedgerCloses')} | {pct('meanEffectiveSPYBeginning')} | {m['grossTurnover']:.3f}x | {m['totalCosts']:.2f} |\n"
table = header+body+'\n*Daily post-close target, including initial waiting cash. **Beginning-of-interval exposure. Full post-entry target mean and closing effective exposure in metrics.csv.\n'
path = root / 'metrics.md'
if path.exists():
    assert path.read_text() == table
else:
    path.write_text(table)
print(table)
