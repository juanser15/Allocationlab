"""Research-only campaign charts/report from persisted CSV and JSON; no backtests."""
import csv
import json
import sys
from pathlib import Path
from datetime import datetime
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def table(path):
    with path.open(newline='') as f:
        return list(csv.DictReader(f))

def render(root):
    root = Path(root)
    manifest = json.loads((root/'manifest.json').read_text())
    summary = json.loads((root/'summary.json').read_text())
    config = manifest['campaign']
    metric = config['selection_metric']
    primary = config['selection_cost_bps']
    eq = table(root/'oos-equity.csv')
    candidates = table(root/'candidates.csv')
    ranked = table(root/'candidate-rankings.csv')
    outer = table(root/'outer-results.csv')
    stability = table(root/'selection-stability.csv')
    selected = table(root/'selected-by-fold.csv')
    specs = {r['candidate_id']: r for r in candidates}
    mode = summary['validation_mode']
    selection_basis = 'inner OOS' if mode == 'nested' else 'traditional TRAIN'
    fig, axes = plt.subplots(2, 1, sharex=True, figsize=(11, 7))
    for scenario in config['transaction_cost_bps']:
        rows = [r for r in eq if float(r['scenario']) == scenario]
        dates = [datetime.fromisoformat(r['date']) for r in rows]
        axes[0].plot(dates, [float(r['index']) for r in rows], label=f'{scenario} bps')
        axes[1].plot(dates, [float(r['drawdown'])*100 for r in rows])
    axes[0].set_ylabel('Concatenated outer OOS index')
    axes[1].set_ylabel('Drawdown (%)')
    axes[0].legend()
    fig.suptitle(f'{config["experiment_id"]}: {mode}; independent fold sleeves')
    fig.tight_layout(); fig.savefig(root/'outer-oos-equity-drawdown.png', dpi=140); plt.close(fig)
    fig, ax = plt.subplots(figsize=(9, 5))
    for fold in sorted(set(r['outer_fold'] for r in ranked)):
        scores = [float(r['score']) for r in ranked if r['outer_fold'] == fold and r.get('score')]
        if scores:
            ax.hist(scores, bins=min(12, max(3, len(scores))), alpha=.5, label=f'outer {fold}')
    ax.set_xlabel(f'{metric}, {selection_basis} selection distribution')
    ax.set_ylabel('Candidates'); ax.legend(); fig.tight_layout()
    fig.savefig(root/'candidate-performance-distribution.png', dpi=140); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 6))
    for r in outer:
        if float(r['scenario']) != primary or not r.get('outer_score'):
            continue
        x, y = float(r['selection_score']), float(r['outer_score'])
        ax.scatter(x, y); ax.annotate('fold '+r['outer_fold'], (x, y))
    ax.set_xlabel(f'Selected {selection_basis} {metric}')
    ax.set_ylabel(f'Outer OOS {metric}'); ax.grid(alpha=.2)
    fig.tight_layout(); fig.savefig(root/'inner-vs-outer-score.png', dpi=140); plt.close(fig)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    axes[0].bar([r['candidate_id'][2:10] for r in stability], [float(r['selection_frequency']) for r in stability])
    axes[0].tick_params(axis='x', rotation=60); axes[0].set_ylabel('Selection frequency')
    numeric = {}
    for row in selected:
        if not row['candidate_id']:
            continue
        spec = specs[row['candidate_id']]
        for section in ['model_parameters', 'exposure_parameters']:
            for key, value in json.loads(spec[section]).items():
                if isinstance(value, (int, float)):
                    numeric.setdefault(section+'.'+key, []).append((int(row['outer_fold']), value))
    for key, values in numeric.items():
        axes[1].plot([v[0] for v in values], [v[1] for v in values], marker='o', label=key)
    axes[1].set_xlabel('Outer fold'); axes[1].set_ylabel('Selected parameter value'); axes[1].legend(fontsize=7)
    fig.tight_layout(); fig.savefig(root/'selection-stability.png', dpi=140); plt.close(fig)
    # Heatmap only where two numeric policy dimensions actually define a grid.
    band = [r for r in candidates if r['exposure_policy'] == 'cash_band']
    fig, ax = plt.subplots(figsize=(8, 5))
    if band:
        xs = sorted(set(json.loads(r['exposure_parameters'])['cash_min'] for r in band))
        ys = sorted(set(json.loads(r['exposure_parameters'])['cash_max'] for r in band))
        grid = np.full((len(ys), len(xs)), np.nan)
        for r in band:
            p = json.loads(r['exposure_parameters'])
            values = [float(v['score']) for v in ranked if v['candidate_id'] == r['candidate_id'] and v.get('score')]
            if values:
                grid[ys.index(p['cash_max']), xs.index(p['cash_min'])] = np.mean(values)
        image = ax.imshow(grid, origin='lower', aspect='auto')
        ax.set_xticks(range(len(xs)), [str(x) for x in xs]); ax.set_yticks(range(len(ys)), [str(y) for y in ys])
        ax.set_xlabel('cash_min'); ax.set_ylabel('cash_max'); fig.colorbar(image, ax=ax, label=f'mean {selection_basis} score')
    else:
        ax.text(.5, .5, 'NOT_AVAILABLE: no two-dimensional numeric grid', ha='center')
    fig.tight_layout(); fig.savefig(root/'local-sensitivity-heatmap.png', dpi=140); plt.close(fig)
    lines = [f'# {config["experiment_id"]}', '', f'Status: **{summary["status"]}**. Mode: **{mode}**, window: {config["window_type"]}.',
             f'Experiment hash: `{summary["experiment_hash"]}`.', '',
             f'{summary["unique_candidates"]} unique candidates; {summary["total_backtest_jobs"]} persisted evaluation jobs; {summary["invalid_jobs"]} invalid, {summary["failed_jobs"]} failed.',
             f'Selection fixed in advance: `{metric}` at {primary} bps; basis: **{selection_basis}**, never outer test.', '',
             '| Scenario | Outer-OOS CAGR (252 sessions) | Volatility | Net Sharpe | Max DD | Mean effective exposure | Annual gross turnover | Sum fees (fold NAV units) |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    for m in summary['outer_oos']:
        if 'cagr' in m:
            sharpe = f'{m["net_sharpe"]:.3f}' if m['net_sharpe'] is not None else 'N/A'
            lines.append(f'| {m["scenario"]} bps | {m["cagr"]:.2%} | {m["volatility"]:.2%} | {sharpe} | {m["max_drawdown"]:.2%} | {m["exposure"]:.2%} | {m["turnover_annualized"]:.3f}x | {m["costs"]:.4f} |')
    lines += ['', '## Selected configurations', '', '| Outer fold | Candidate | Selection score | Rank |', '|---|---|---:|---:|']
    for r in selected:
        lines.append(f'| {r["outer_fold"]} | {r["candidate_id"]} | {r["score"]} | {r["rank"]} |')
    lines += ['', '## Limitations', '', f'Data: {config["data_provenance"]}. Existing historical data, not a new holdout.',
              f'Cash daily yield={config["cash_yield"]["daily"]}; Sharpe daily reference={config["cash_yield"]["reference_daily"]}. Costs are research assumptions per actual notional, not observed trading costs.',
              'Model input/state may update as-of each signal. Learned estimator/normalization/policy parameters remain frozen within inner and outer OOS.',
              'Independent fold books start NAV 100/cash; entry costs are included. Composite outer-return index is not a continuous carried-holdings ledger or calendar CAGR. No synthetic liquidation is charged or claimed.',
              'No statistical significance or alpha discovery claim. **DSR = NOT_IMPLEMENTED**.',
              *summary['limitations'], '', '## Artifacts', '',
              'manifest.json, campaign.frozen.json, candidate-space.json, candidates.csv, folds.csv, inner-results.csv, candidate-rankings.csv, outer-results.csv, selected-by-fold.csv, failures.csv, oos-ledger.csv, oos-equity.csv, selection-stability.csv, local-sensitivity.csv, candidate-oos-similarity.csv, summary.json, jobs/ and cache/.', '',
              '![Outer OOS](outer-oos-equity-drawdown.png)', '![Distribution](candidate-performance-distribution.png)',
              '![Selection versus test](inner-vs-outer-score.png)', '![Stability](selection-stability.png)', '![Sensitivity](local-sensitivity-heatmap.png)', '']
    (root/'REPORT.md').write_text('\n'.join(lines))
    print(root, summary['status'])

def compare(a, b, destination):
    a, b, destination = Path(a), Path(b), Path(destination)
    aa = json.loads((a/'summary.json').read_text()); bb = json.loads((b/'summary.json').read_text())
    assert aa['candidate_definitions_hash'] == bb['candidate_definitions_hash'], 'Candidate definitions differ'
    ca = json.loads((a/'manifest.json').read_text())['campaign']; cb = json.loads((b/'manifest.json').read_text())['campaign']
    assert ca['dates'] == cb['dates'] and ca['transaction_cost_bps'] == cb['transaction_cost_bps']
    destination.mkdir(parents=True, exist_ok=True)
    fig, axes = plt.subplots(2, 1, sharex=True, figsize=(11, 7))
    for root, summary in [(a, aa), (b, bb)]:
        rows = [r for r in table(root/'oos-equity.csv') if float(r['scenario']) == ca['selection_cost_bps']]
        dates = [datetime.fromisoformat(r['date']) for r in rows]
        axes[0].plot(dates, [float(r['index']) for r in rows], label=summary['validation_mode'])
        axes[1].plot(dates, [float(r['drawdown'])*100 for r in rows])
    axes[0].legend(); axes[0].set_ylabel('Outer OOS index'); axes[1].set_ylabel('Drawdown (%)')
    fig.suptitle('Traditional versus nested: identical candidate definitions, selection cost scenario')
    fig.tight_layout(); fig.savefig(destination/'traditional-vs-nested.png', dpi=140); plt.close(fig)
    (destination/'comparison.json').write_text(json.dumps({'candidate_definitions_hash': aa['candidate_definitions_hash'],
        'traditional': aa['outer_oos'], 'nested': bb['outer_oos'], 'claim': 'pipeline comparison only; not alpha discovery'}, indent=2)+'\n')

if __name__ == '__main__':
    if sys.argv[1] == '--compare':
        compare(*sys.argv[2:5])
    else:
        for path in sys.argv[1:]:
            render(path)
