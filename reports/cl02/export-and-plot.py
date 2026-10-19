"""Repair research CSV serialization from immutable JSONL; verify metrics and plot.

No backtest, policies or parameters are changed. The originally frozen runner and
its malformed JSON-escaped CSVs remain available as diagnostic evidence.
"""
import csv
import hashlib
import json
import math
import statistics
from datetime import datetime
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path('reports/cl02')
manifest = json.loads((root / 'manifest.json').read_text())
metrics = json.loads((root / 'metrics.json').read_text())
checks = json.loads((root / 'verification.json').read_text())
assert all(c['status'] == 'PASS' for c in checks)
hash_file = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
sources = [root / 'export-and-plot.py', root / 'manifest.json', root / 'metrics.json', root / 'verification.json']
sources += [root / (m['id'] + '.ledger.jsonl') for m in metrics]
supplement = {'purpose': 'RFC4180 exports, independent ledger metric verification and charts; no performance re-run',
              'experimentManifestId': manifest['manifestId'],
              'sources': {str(p): hash_file(p) for p in sources}}
supplement_path = root / 'postprocessing-manifest.json'
if supplement_path.exists():
    assert json.loads(supplement_path.read_text()) == supplement
else:
    supplement_path.write_text(json.dumps(supplement, indent=2)+'\n')

def write_once(path, content):
    if path.exists():
        assert path.read_text() == content, str(path)
    else:
        path.write_text(content)

records_by_id = {}
metric_checks = []
for m in metrics:
    ledger = [json.loads(line) for line in (root / (m['id']+'.ledger.jsonl')).read_text().splitlines()]
    with (root / (m['id']+'.targets.csv')).open() as f:
        target_by_signal = {r['signalDate']: float(r['targetSPY']) for r in csv.DictReader(f)}
    initial = manifest['protocol']['initialNav']
    peak = initial
    target = 0
    records = []
    for d in ledger:
        assert math.isclose(d['transactionCosts'], sum(abs(t['notional']) for t in d['trades'])*m['costBps']/10000, abs_tol=1e-8, rel_tol=0)
        if d['executionSignalDate']:
            target = target_by_signal[d['executionSignalDate']]
        peak = max(peak, d['endingNav'])
        r = dict(d)
        r['dailyReturn'] = d['endingNav']/d['beginningNav']-1
        r['targetSPY'] = target
        r['effectiveSPYBeginning'] = sum(p['marketValue'] for p in d['beginningPositions'])/d['beginningNav']
        r['effectiveSPYClose'] = sum(p['marketValue'] for p in d['endingPositions'])/d['endingNav']
        r['drawdown'] = d['endingNav']/peak-1
        records.append(r)
    returns = [r['dailyReturn'] for r in records]
    excess = [r-manifest['protocol']['sharpeReference']['daily'] for r in returns]
    days = (datetime.fromisoformat(m['end'])-datetime.fromisoformat(m['baselineDate'])).days
    recomputed = {
        'CAGR': (records[-1]['endingNav']/initial)**(365.25/days)-1,
        'annualizedVolatility': statistics.stdev(returns)*math.sqrt(252),
        'Sharpe': statistics.mean(excess)/statistics.stdev(excess)*math.sqrt(252),
        'maxDrawdown': min(r['drawdown'] for r in records),
        'meanTargetSPYAllLedgerCloses': statistics.mean(r['targetSPY'] for r in records),
        'meanEffectiveSPYBeginning': statistics.mean(r['effectiveSPYBeginning'] for r in records),
        'totalCosts': sum(r['transactionCosts'] for r in records),
        'grossTurnover': sum(sum(abs(t['notional']) for t in r['trades'])/(r['beginningNav']+r['etfPnl']+r['cashPnl']) for r in records),
    }
    for key, value in recomputed.items():
        assert math.isclose(value, m[key], abs_tol=1e-8, rel_tol=0), (m['id'], key, value, m[key])
    metric_checks.append({'id': m['id'], 'status': 'PASS', 'independentlyRecomputed': recomputed})
    # Standard CSV quoting: objects are JSON cells, RFC4180 double quotes.
    import io
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(records[0]))
    writer.writeheader()
    for row in records:
        writer.writerow({k: json.dumps(v, separators=(',', ':')) if isinstance(v, (list, dict)) else v for k, v in row.items()})
    output = root / (m['id']+'.ledger.standard.csv')
    write_once(output, stream.getvalue())
    with output.open(newline='') as f:
        parsed = list(csv.DictReader(f))
    assert len(parsed) == len(ledger) and all(None not in r for r in parsed)
    assert json.loads(parsed[0]['endingPositions']) == ledger[0]['endingPositions']
    records_by_id[m['id']] = records
    print(m['id'], 'metrics / fees / RFC4180 round-trip PASS')
write_once(root / 'metric-verification.json', json.dumps(metric_checks, indent=2)+'\n')
assert len({tuple(r['date'] for r in rs) for rs in records_by_id.values()}) == 1

colors = {'A': '#263b58', 'B': '#00868b', 'B_control': '#a36b20'}
labels = {'A': '100% SPY', 'B': 'Cash rule 10–20%', 'B_control': 'Retrospective constant-exposure control'}
for cost in [0, 5]:
    fig, axes = plt.subplots(3, 1, figsize=(13, 10), sharex=True)
    for candidate in colors:
        rs = records_by_id[f'{candidate}_{cost}bps']
        dates = [datetime.fromisoformat(r['date']) for r in rs]
        # Include the common baseline NAV explicitly.
        baseline = datetime.fromisoformat(manifest['protocol']['actualBaseline'])
        axes[0].plot([baseline]+dates, [100]+[r['endingNav']/manifest['protocol']['initialNav']*100 for r in rs], color=colors[candidate], label=labels[candidate])
        axes[1].plot([baseline]+dates, [0]+[r['drawdown']*100 for r in rs], color=colors[candidate])
        axes[2].plot(dates, [r['targetSPY']*100 for r in rs], color=colors[candidate], linestyle='--', label=labels[candidate]+' target')
        axes[2].plot(dates, [r['effectiveSPYClose']*100 for r in rs], color=colors[candidate], linewidth=0.7, alpha=0.7, label=labels[candidate]+' effective close')
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
    output = root / f'equity-drawdown-exposure-{cost}bps.png'
    if not output.exists():
        fig.savefig(output, dpi=160)
    plt.close(fig)

table = '| Case | CAGR | Volatility | Sharpe (daily excess over 0) | Max DD | Recovery of max DD | Target SPY mean* | Effective SPY mean** | Gross turnover | Costs (NAV units) |\n|---|---:|---:|---:|---:|---|---:|---:|---:|---:|\n'
for m in metrics:
    pct = lambda key: f"{m[key]*100:.2f}%"
    recovery = m['maxDrawdownRecovery'] or 'PENDING'
    table += f"| {m['id']} | {pct('CAGR')} | {pct('annualizedVolatility')} | {m['Sharpe']:.3f} | {pct('maxDrawdown')} | {recovery} | {pct('meanTargetSPYAllLedgerCloses')} | {pct('meanEffectiveSPYBeginning')} | {m['grossTurnover']:.3f}x | {m['totalCosts']:.2f} |\n"
table += '\n*Daily post-close target, including initial waiting cash. **Beginning-of-interval exposure. Full post-entry target mean and closing effective exposure in metrics.csv.\n'
write_once(root / 'metrics.md', table)
print(table)
