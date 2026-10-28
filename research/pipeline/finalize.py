"""Canonical audit exports only: one final decision/target per context.

RAW books are diagnostic sidecars. Preserve their complete track views while
keeping canonical final-target execution separate. No financial calculation.
"""
import csv
import json
import pathlib

root = pathlib.Path('reports/pipe01')


def csv_rows(path):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def write_csv(path, records, keys=None):
    if keys is None:
        keys = list(dict.fromkeys(k for r in records for k in r))
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=keys, quoting=csv.QUOTE_ALL, lineterminator='\r\n')
        w.writeheader()
        w.writerows(records)


for name in ['decision-ledger', 'final-targets']:
    rows = csv_rows(root/(name+'.csv'))
    if any(r['track'] == 'RAW' for r in rows):
        (root/(name+'-tracks.csv')).write_bytes((root/(name+'.csv')).read_bytes())
    else:
        rows = csv_rows(root/(name+'-tracks.csv'))
    final = [r.copy() for r in rows if r['track'] == 'NORMALIZED']
    assert len(final) == len({r['decision_context_id'] for r in final}) == 96
    if name == 'decision-ledger':
        raw = {r['decision_context_id']: r for r in rows if r['track'] == 'RAW'}
        for r in final:
            d = raw[r['decision_context_id']]
            r.update(raw_diagnostic_book_id=d['book_id'], raw_sleeve_period_return=d['realized_next_period_return'], raw_sleeve_forward_beta=d['realized_forward_beta'], raw_sleeve_forward_volatility=d['realized_forward_volatility'])
    write_csv(root/(name+'.csv'), final)

path = root/'pipeline-stage-ledger.jsonl'
stages = [json.loads(s) for s in path.read_text().splitlines()]
is_raw = lambda s: s['stage'] in ('EXECUTION', 'ACCOUNTING_ATTRIBUTION') and s['output']['book_id'].endswith('_RAW')
if any(is_raw(s) for s in stages):
    (root/'pipeline-stage-ledger-tracks.jsonl').write_bytes(path.read_bytes())
else:
    stages = [json.loads(s) for s in (root/'pipeline-stage-ledger-tracks.jsonl').read_text().splitlines()]
for filename, records in [('pipeline-stage-ledger.jsonl', [s for s in stages if not is_raw(s)]), ('raw-diagnostic-stages.jsonl', [s for s in stages if is_raw(s)])]:
    (root/filename).write_text(''.join(json.dumps(s, separators=(',', ':'), ensure_ascii=False)+'\n' for s in records))
negative = json.loads((root/'negative-fixtures.json').read_text())['decisions']
failure_rows = [dict(scope='SYNTHETIC_EXPECTED_REJECTION', decision_context_id=d['decision_context_id'], date=d['context']['decision_date'], status=d['status'], reason=d['reason'], last_stage=d['stages'][-1]['stage'] if d['stages'] else '', executable_weights=False) for d in negative]
write_csv(root/'failure-summary.csv', failure_rows)
summary = json.loads((root/'summary.json').read_text())
summary.update(canonical_decision_rows=96, canonical_final_targets=96, canonical_stage_rows=sum(not is_raw(s) for s in stages), raw_diagnostic_rows=96, recorded_synthetic_expected_failures=len(failure_rows))
(root/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
print('Canonical exports: 96 decisions, 96 final targets, 960 stages; RAW diagnostic sidecars retained')
