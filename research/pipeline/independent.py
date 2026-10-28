"""PIPE-01 external audit: no TS engine, allocator, gate or selector invocation.

Trades are reconstructed with a piecewise-linear self-financing oracle (no
bisection). Economic replay equality to frozen AL07 is additionally exact.
"""
import csv
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import sys
import numpy as np

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'reports/pipe01')
ABS = 1e-9  # NAV100 currency / diagnostic absolute error; exact artifact checks use ==.
checks = []


def load(path):
    return json.loads(pathlib.Path(path).read_text(), parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s)))


def close(a, b, tolerance=ABS):
    assert a is not None and b is not None and math.isfinite(a) and math.isfinite(b) and abs(a-b) <= tolerance, (a, b)


def check(name, fn):
    try:
        evidence = fn()
        checks.append(dict(criterion=name, status='PASS', evidence=evidence))
    except Exception as error:
        checks.append(dict(criterion=name, status='FAIL', error=repr(error)))


with open('reports/cl02/adjusted-closes.csv', newline='') as f:
    prices = {r['Date']: {a: float(v) for a, v in r.items() if a != 'Date' and v and v not in ('NA', 'NaN')} for r in csv.DictReader(f)}


def post_cost_nav(pre, old_market_values, targets, cost):
    """Solve A+c*sum(abs(q*A-old))=pre on each exact sign interval."""
    ids = set(old_market_values) | set(targets)
    breaks = sorted({0., pre} | {old_market_values.get(a, 0)/targets[a] for a in ids if targets.get(a, 0) > 0 and 0 < old_market_values.get(a, 0)/targets[a] < pre})
    for lo, hi in zip(breaks[:-1], breaks[1:]):
        mid = (lo+hi)/2
        signs = {a: 1 if targets.get(a, 0)*mid-old_market_values.get(a, 0) >= 0 else -1 for a in ids}
        slope = sum(signs[a]*targets.get(a, 0) for a in ids)
        intercept = -sum(signs[a]*old_market_values.get(a, 0) for a in ids)
        answer = (pre-cost*intercept)/(1+cost*slope)
        if lo-1e-12 <= answer <= hi+1e-12:
            return answer
    raise AssertionError('No self-financing sign interval')


def accounting_oracle(book, source_prices, track):
    cash, quantities, nav = 100., {}, 100.
    contexts = {d['context']['decision_date']: d for d in book['decisions']}
    for row in book['ledger']:
        date, start = row['date'], row['intervalStart']
        beginning_cash = cash
        asset_pnl = sum(v*(source_prices[date][a]-source_prices[start][a]) for a, v in quantities.items())
        cash_pnl = cash * book['decisions'][0]['context']['costs']['cash_yield_daily']
        pre = nav+asset_pnl+cash_pnl
        fee, expected_trades = 0., {}
        if row['executionSignalDate'] is not None:
            decision = contexts[row['executionSignalDate']]
            assert decision['context']['execution']['date'] == date
            target = decision['sleeve']['asset_weights_risk_sleeve'] if track == 'RAW' else decision['final_target']['final_asset_weights']
            old = {a: v*source_prices[date][a] for a, v in quantities.items()}
            rate = decision['context']['costs']['bps']/10000
            after = post_cost_nav(pre, old, target, rate)
            new = {a: after*w/source_prices[date][a] for a, w in target.items() if w > 0}
            expected_trades = {a: new.get(a, 0)-quantities.get(a, 0) for a in set(quantities) | set(new)}
            expected_trades = {a: v for a, v in expected_trades.items() if abs(v) > 1e-12}
            fee = sum(abs(v*source_prices[date][a]) for a, v in expected_trades.items())*rate
            quantities = new
            cash = after-sum(v*source_prices[date][a] for a, v in quantities.items())
            nav = after
        else:
            cash += cash_pnl
            nav = pre
        close(row['beginningCash'], beginning_cash)
        close(row['etfPnl'], asset_pnl)
        close(row['cashPnl'], cash_pnl)
        close(row['transactionCosts'], fee)
        close(row['endingCash'], cash)
        close(row['endingNav'], nav)
        assert set(expected_trades) == {t['ticker'] for t in row['trades']}
        for trade in row['trades']:
            close(trade['quantity'], expected_trades[trade['ticker']])
            close(trade['notional'], trade['quantity']*source_prices[date][trade['ticker']])
        for position in row['endingPositions']:
            close(position['quantity'], quantities[position['ticker']])
        close(nav, cash+sum(v*source_prices[date][a] for a, v in quantities.items()))
        assert cash >= -ABS and all(v >= 0 for v in quantities.values())
    return len(book['ledger'])


def metrics_oracle(book, source_prices):
    ledger = book['ledger']
    r = np.array([d['netPnl']/d['beginningNav'] for d in ledger])
    m = np.array([source_prices[d['date']]['SPY']/source_prices[d['intervalStart']]['SPY']-1 for d in ledger])
    wealth = np.cumprod(1+r)
    high = np.maximum.accumulate(np.r_[1, wealth])[1:]
    days = (dt.date.fromisoformat(ledger[-1]['date'])-dt.date.fromisoformat(ledger[0]['intervalStart'])).days
    sample = np.sort(r)
    mass = .05*len(sample)
    cvar = -sum(v*min(1, mass-i) for i, v in enumerate(sample) if i < mass)/mass
    oracle = dict(cagr=float(wealth[-1]**(365.25/days)-1), annualized_volatility=float(np.std(r, ddof=1)*np.sqrt(252)), max_drawdown=float(min(wealth/high-1)), cvar_95=float(cvar), final_index=float(100*wealth[-1]), beta=float(np.cov(r, m, ddof=1)[0, 1]/np.var(m, ddof=1)))
    actual = book['attribution']['metrics']
    for key, value in oracle.items():
        close(actual[key], value)
    return oracle


books = [load(p)['value'] for p in sorted((ROOT/'replay/books').glob('*.json'))]
for book in books:
    def verify_book(book=book):
        match = re.fullmatch(r'(AL07_REAL_.*)_(\d+)_(\d+)bps_(RAW|NORMALIZED)', book['book_id'])
        assert match is not None
        campaign, fold, bps, track = match.groups()
        original_root = pathlib.Path('reports/al07/campaigns')/campaign
        selected = load(original_root/'selections'/f'{fold}.json')
        original = next(load(p)['value'] for p in (original_root/'jobs').glob('*.json') if (lambda j: j['stage'] == 'outer' and j['outer_fold'] == int(fold) and j['scenario_bps'] == int(bps))(load(p)['value']))
        assert book['status'] == 'VALID'
        assert book['ledger'] == original['tracks'][track]['ledger']
        assert book['attribution']['metrics'] == original['tracks'][track]['metrics']
        assert book['attribution']['attribution'] == original['tracks'][track]['attribution']
        for decision, frozen in zip(book['decisions'], original['decisions']):
            c = decision['context']
            assert c['decision_date'] == frozen['date'] and c['information_cutoff'] < c['decision_date'] < c['execution']['date']
            assert c['candidate']['candidate_id'] == selected['candidate_id'] == original['candidate_id']
            assert hashlib.sha256(pathlib.Path(c['selection_lock']['source_id']).read_bytes()).hexdigest() == c['selection_lock']['selection_hash']
            assert decision['allocation'] == frozen['allocation']
            assert decision['projection'] == frozen['projection']
            assert decision['robustness_gate'] == frozen['portfolio_gate']
            assert c['risk_mandate_hash'] == frozen['mandate_hash']
            assert decision['final_target']['final_asset_weights'] == frozen['normalized']
            q = decision['sleeve']['asset_weights_risk_sleeve']
            model = decision['allocation']['input']
            ids = model['assets']
            w = np.array([q[a] for a in ids])
            b = np.array([model['beta_estimates']['values'][a] for a in ids])
            C = np.array(model['risk_model']['covariance'])
            sleeve_beta = float(w@b)
            close(decision['sleeve']['estimated_market_beta'], sleeve_beta)
            close(decision['sleeve']['estimated_volatility'], float(np.sqrt(252*w@C@w)))
            mandate = decision['stages'][1]['output']['mandate']
            multiplier = mandate['primary_target']['target']/sleeve_beta
            close(decision['projection']['portfolio']['exposure_multiplier'], multiplier)
            close(decision['final_target']['implementation_cash'], 1-multiplier*sum(q.values()))
            assert len(decision['stages']) == 8
            assert [s['stage'] for s in decision['stages']] == ['VALIDATE_CONTEXT', 'RESOLVE_MANDATE', 'SIGNAL_GATE', 'ALLOCATOR', 'SLEEVE_RISK', 'ROBUSTNESS_GATE', 'EXPOSURE_CONTROLLER', 'FINAL_TARGET']
            assert all(s['decision_context_id'] == c['decision_context_id'] for s in decision['stages'])
            assert decision['signal_status'] == 'NOT_REQUIRED' and not c['signal_gate_required']
            assert frozen['model_reference']['original_training_cutoff'] < original['interval_start']
        count = accounting_oracle(book, prices, track)
        metrics = metrics_oracle(book, prices)
        return dict(intervals=count, decisions=len(book['decisions']), exact_AL07_match=True, accounting_oracle='PIECEWISE_LINEAR_CLOSED_FORM', metrics=metrics)
    check(book['book_id'], verify_book)

examples = load(ROOT/'synthetic-e2e.json')
for example in examples:
    def synthetic(example=example):
        book, request = example['result'], example['request']
        native = book['decisions'][0]['allocation']
        if example['mode'] == 'FACTORS':
            q = native['result']['asset_weights_risk_sleeve']
            close(q['ASSET_0'], .25, 1e-12)
            close(q['ASSET_1'], .75, 1e-12)
        if example['mode'] == 'STRATEGY_STREAMS':
            a = native['result']['allocations']
            close(a['STRATEGY_0'], .5, 1e-12)
            close(a['STRATEGY_1'], .5, 1e-12)
            exposures = {}
            for stream in native['input']['streams']:
                for instrument, exposure in stream['unit_position_map']['exposures'].items():
                    exposures[instrument] = exposures.get(instrument, 0)+a[stream['strategy_instance_id']]*exposure
            assert exposures == book['decisions'][0]['sleeve']['asset_weights_risk_sleeve']
        return dict(ledger_intervals=accounting_oracle(book, {p['date']: p['prices'] for p in request['prices']}, request['track']), label='SYNTHETIC')
    check('SYNTHETIC '+example['mode'], synthetic)


def storage():
    counts = {}
    for path in sorted(ROOT.glob('*.csv')):
        with open(path, newline='') as f:
            rows = list(csv.reader(f, strict=True))
        assert rows and all(len(r) == len(rows[0]) for r in rows)
        counts[path.name] = len(rows)-1
    contexts = [json.loads(line) for line in (ROOT/'decision-contexts.jsonl').read_text().splitlines()]
    assert len(contexts) == len({c['decision_context_id'] for c in contexts}) == 96
    stages = [json.loads(line) for line in (ROOT/'pipeline-stage-ledger.jsonl').read_text().splitlines()]
    assert len(stages) == len({s['stage_id'] for s in stages})
    assert all(s['decision_context_id'] in {c['decision_context_id'] for c in contexts} for s in stages)
    for path in ROOT.glob('*.json'):
        x = load(path)
        assert json.loads(json.dumps(x, allow_nan=False)) == x
    for path, digest in load(ROOT/'replay-source-hashes.json').items():
        assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest() == digest
    assert all(r['value']['status'] == 'VALID' for r in [load(p) for p in (ROOT/'replay/books').glob('*.json')])
    return dict(CSV_rows=counts, contexts=len(contexts), stages=len(stages), no_duplicate_stage_ids=True)


check('Persistence / RFC4180 / JSON / source preservation', storage)
out = dict(status='PASS' if all(c['status'] == 'PASS' for c in checks) else 'FAIL', passed=sum(c['status'] == 'PASS' for c in checks), failed=sum(c['status'] == 'FAIL' for c in checks), absolute_tolerance=ABS, artifact_comparison='EXACT decoded JSON equality, no numerical tolerance', checks=checks)
(ROOT/'independent-verification.json').write_text(json.dumps(out, indent=2, allow_nan=False)+'\n')
for c in checks:
    print(c['status'], c['criterion'], c.get('error', ''))
sys.exit(0 if out['status'] == 'PASS' else 1)
