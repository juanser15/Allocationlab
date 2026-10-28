"""External classification oracle: reads packets/ledgers; never imports PIPE-02.
No performance, optimizer, backtest or selection is run here.
"""
import csv
import datetime as dt
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'reports/pipe02')
checks = []


def load(path):
    return json.loads(pathlib.Path(path).read_text())


def lines(path):
    return [json.loads(s) for s in pathlib.Path(path).read_text().splitlines() if s]


def stamp(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).replace(tzinfo=dt.timezone.utc).timestamp()


def available(x, at, cutoff):
    return stamp(x['as_of']) <= stamp(at) and stamp(x['information_cutoff']) <= stamp(cutoff) and stamp(x['provenance']['available_at']) <= stamp(cutoff)


def window(at, start, end):
    return stamp(start) <= stamp(at) and (end is None or stamp(at) < stamp(end))


def check(name, fn):
    try:
        detail = fn()
        checks.append(dict(criterion=name, status='PASS', evidence=detail))
    except Exception as e:
        checks.append(dict(criterion=name, status='FAIL', error=repr(e)))


def eval_oracle(e, p):
    failures, missing = [], []
    if e['identity']['allocation_mode'] not in p['eligible_modes']:
        failures.append('mode')
    for wanted, actual in [(p['required_certifications'], e['certifications']), (p['required_gates'], e['gate_statuses'])]:
        for key in wanted:
            if key not in actual:
                missing.append(key)
            elif actual[key] != 'PASS':
                failures.append(key)
    if e['oos_folds'] < p['minimum_oos_folds'] or e['observations'] < p['minimum_observations']:
        failures.append('sample')
    if e['robustness_status'] != p['required_robustness_status'] or e['reproducibility_status'] != p['required_reproducibility_status']:
        failures.append('mechanical')
    missing += [b for b in e['blockers'] if b not in p['allowed_unresolved_blockers']]
    for metric, threshold in p['economic_hurdles'].items():
        value = e['metrics'][metric]
        if value is None:
            missing.append(metric)
        elif (threshold['operator'] == 'MIN' and value < threshold['value']) or (threshold['operator'] == 'MAX' and value > threshold['value']):
            failures.append(metric)
    return 'NOT_PROMOTABLE' if failures else 'DEFERRED_BLOCKED' if missing else 'PROMOTABLE'


def bank(reg, entry, at, cutoff):
    defs = [d for d in reg['definitions'] if d['entry_id'] == entry and available(d, at, cutoff)]
    if not defs:
        return None
    assert len(defs) == 1
    definition = defs[0]
    state, active, previous, count = 'RESEARCH', 'INACTIVE', None, 0
    events = sorted([e for e in reg['events'] if e['entry_id'] == entry and stamp(e['effective_at']) <= stamp(at) and stamp(e['available_at']) <= stamp(cutoff)], key=lambda e: e['sequence'])
    transitions = {'VALIDATE': ('RESEARCH', 'VALIDATED'), 'MAKE_PROMOTABLE': ('VALIDATED', 'PROMOTABLE'), 'APPROVE': ('PROMOTABLE', 'PROMOTED'), 'REJECT': ('PROMOTABLE', 'VALIDATED'), 'DEFER': ('PROMOTABLE', 'VALIDATED'), 'SUSPEND': ('PROMOTED', 'SUSPENDED'), 'RESUME': ('SUSPENDED', 'PROMOTED')}
    for event in events:
        count += 1
        assert event['sequence'] == count and event['previous_event_hash'] == previous and event['from_state'] == state and state != 'RETIRED'
        action = event['action']
        if action in transitions:
            assert state == transitions[action][0]
            expected = transitions[action][1]
        elif action == 'RETIRE':
            expected = 'RETIRED'
        else:
            assert action in ('ACTIVATE', 'DEACTIVATE') and state == 'PROMOTED'
            expected = state
        assert expected == event['to_state']
        if action in ('APPROVE', 'REJECT', 'DEFER'):
            decision = next(d for d in reg['decisions'] if d['hash'] == event['promotion_decision_hash'])
            authority = next(a for a in reg['authorities'] if a['hash'] == decision['authority_hash'])
            assert decision['authorized_by'] in authority['actor_refs'] and decision['decision'] == action and decision['scope'] == definition['scope'] == authority['scope']
            assert stamp(decision['decision_time']) <= stamp(event['effective_at']) and stamp(decision['available_at']) <= stamp(event['available_at'])
        expected_active = 'ACTIVE' if action == 'ACTIVATE' else 'INACTIVE' if action == 'DEACTIVATE' or expected != state else active
        assert event['activation_status'] == expected_active
        state, active, previous = expected, expected_active, event['hash']
    return dict(definition=definition, promotion=state, activation=active)


def route_oracle(i):
    p, primary, at, cutoff = i['policy'], i['primary'], i['as_of'], i['information_cutoff']
    if not available(p, at, cutoff) or i['scope'] != p['scope']:
        return 'BLOCKED', None
    state = bank(i['registry'], i['primary_entry_id'], at, cutoff)
    certs = {c['hash']: c for c in i['certificates'] if c['scope'] == i['scope'] and available(c, at, cutoff)}
    cert = certs.get(primary['target_certificate_hash'])
    seen = []
    if not state or state['promotion'] != 'PROMOTED':
        seen.append('PROMOTION_NOT_ALLOWED')
    if state and (state['activation'] != 'ACTIVE' or not window(at, state['definition']['valid_from'], state['definition']['valid_until'])):
        seen.append('ENTRY_INACTIVE')
    health = i['data_health']
    healthy = health is not None and available(health, at, cutoff) and health['status'] == 'HEALTHY' and health['kind'] in p['accepted_data_health_kinds'] and stamp(health['data_as_of']) <= stamp(cutoff) and (stamp(at)-stamp(health['data_as_of']))/86400 <= p['maximum_data_age_days']
    if not healthy:
        seen.append('DATA_STALE')
    status = primary['status']
    if status == 'VALID':
        if cert is None:
            seen.append('MISSING_ARTIFACT')
        elif (stamp(at)-stamp(cert['origin_decision_date']))/86400 > p['primary_max_age_days']:
            seen.append('DATA_STALE')
    else:
        mapping = {'SIGNAL_GATE_FAIL': 'SIGNAL_GATE_FAIL', 'SIGNAL_GATE_INSUFFICIENT_DATA': 'SIGNAL_INSUFFICIENT_DATA', 'ROBUSTNESS_GATE_FAIL': 'ROBUSTNESS_GATE_FAIL', 'EXPOSURE_INFEASIBLE': 'RISK_TARGET_INFEASIBLE', 'BLOCKED_MISSING_ARTIFACTS': 'MISSING_ARTIFACT', 'MISSING_SLEEVE_RISK': 'MISSING_ARTIFACT'}
        if status not in mapping:
            return 'BLOCKED', None
        seen.append(mapping[status])
    condition = next((c for c in p['condition_priority'] if c in (seen or ['PRIMARY_PIPELINE_PASS'])), None)
    rule = p['rules'].get(condition)
    if rule is None:
        return 'BLOCKED', None
    action = rule['action']
    if action == 'USE_PRIMARY_TARGET':
        return (action, cert['target']) if condition == 'PRIMARY_PIPELINE_PASS' and cert else ('BLOCKED', None)
    if action == 'HOLD_PREVIOUS_CERTIFIED_TARGET':
        previous = certs.get(i['previous_target_hash'])
        invalid = previous is None
        if previous:
            invalid |= (stamp(at)-stamp(previous['origin_decision_date']))/86400 > p['hold']['maximum_target_age_days']
            invalid |= p['hold']['risk_mandate_must_match'] and previous['target']['risk_mandate_hash'] != primary['risk_mandate_hash']
            if p['hold']['require_mechanical_recertification']:
                invalid |= not any(r['target_certificate_hash'] == previous['hash'] and r['status'] == 'VALID' and available(r, at, cutoff) and r['as_of'][:10] == at[:10] and all(r['required_checks'].get(c) == 'PASS' for c in p['hold']['recertification_checks']) for r in i['recertifications'])
        history = sorted([r for r in i['previous_routes'] if r['routing_stream_id'] == i['routing_stream_id'] and stamp(r['routing_timestamp']) < stamp(at) and stamp(r['information_cutoff']) <= stamp(cutoff)], key=lambda r: r['routing_timestamp'])
        held = 0
        for r in reversed(history):
            if r['action'] != 'HOLD_PREVIOUS_CERTIFIED_TARGET' or r['status'] != 'VALID':
                break
            held += 1
        invalid |= held >= p['hold']['maximum_consecutive_holds'] or p['hold']['require_current_data_health'] and not healthy
        return (p['hold']['on_invalid'], None) if invalid else (action, previous['target'])
    if action == 'USE_PREAPPROVED_FALLBACK':
        f = next((f for f in i['fallbacks'] if f['hash'] == rule['fallback_hash'] and available(f, at, cutoff)), None)
        invalid = f is None
        fc = None
        if f:
            b = bank(i['registry'], f['bank_entry_id'], at, cutoff)
            approved_before = bank(i['registry'], f['bank_entry_id'], f['provenance']['available_at'], f['provenance']['available_at'])
            fc = certs.get(f['target_certificate_hash'])
            invalid |= stamp(f['provenance']['available_at']) >= stamp(at) or not window(at, f['valid_from'], f['valid_until'])
            invalid |= not b or b['promotion'] != 'PROMOTED' or b['activation'] != 'ACTIVE' or fc is None
            invalid |= not approved_before or approved_before['promotion'] != 'PROMOTED'
            if fc:
                invalid |= stamp(fc['provenance']['available_at']) > stamp(f['provenance']['available_at']) or stamp(fc['as_of']) > stamp(f['provenance']['available_at'])
                invalid |= fc['target']['risk_mandate_hash'] != primary['risk_mandate_hash'] and not p['fallback']['allow_different_preapproved_risk_mandate']
        return (p['fallback']['on_invalid'], None) if invalid else (action, fc['target'])
    return action, None


registry = load(ROOT/'bank-registry-full.json')
certificates = lines(ROOT/'certified-targets.jsonl')
outputs = lines(ROOT/'routing-ledger.jsonl')
inputs = lines(ROOT/'routing-inputs.jsonl')


def routing():
    assert len(inputs) == len(outputs)
    count = {}
    for item, result in zip(inputs, outputs):
        i = item['input']
        if item['registry_ref'] == 'MAIN':
            i = dict(i, registry=registry, certificates=certificates)
        expected_action, expected_target = route_oracle(i)
        r = result['record']
        assert r['action'] == expected_action, (item['experiment_id'], r['action'], expected_action)
        assert r['selected_certified_target'] == expected_target
        assert r['primary_status'] == i['primary']['status'] and r['primary_failure_reason'] == i['primary']['reason']
        count[expected_action] = count.get(expected_action, 0)+1
    return dict(records=len(outputs), actions=count, no_original_router_calls=True)


def promotions():
    policies = {p['hash']: p for p in registry['policies']}
    packets = {p['hash']: p for p in registry['evidence']}
    for v in registry['evaluations']:
        assert eval_oracle(packets[v['evidence_hash']], policies[v['policy_hash']]) == v['status']
    extra = load(ROOT/'promotion-known-answers.json')
    for example in extra:
        assert eval_oracle(example['evidence'], example['policy']) == example['evaluation']['status']
    for decision in registry['decisions']:
        assert decision['scope'] == 'QA_ONLY', 'No actual research approval authorized'
    for definition in registry['definitions']:
        at = '2027-03-02' if definition['entry_id'].startswith('ENTRY_') else '2026-10-17T00:06:00Z'
        state = bank(registry, definition['entry_id'], at, at)
        if definition['scope'] == 'RESEARCH_GOVERNANCE':
            assert state['promotion'] == 'PROMOTABLE' and state['activation'] == 'INACTIVE'
    return dict(evaluations=len(registry['evaluations']), additional_known_answers=len(extra), transitions=len(registry['events']), actual_promotions=0)


def frozen_sources():
    catalog = load(ROOT/'source-catalog.json')
    for ref in catalog:
        assert hashlib.sha256(pathlib.Path(ref['path']).read_bytes()).hexdigest() == ref['sha256']
    # Evidence statistics are copied from original selected normalized OOS rows.
    for e in registry['evidence']:
        if not e['frozen_campaign_id'].startswith('AL07_REAL_'):
            continue
        source = load(pathlib.Path('reports/al07/campaigns')/e['frozen_campaign_id']/'summary.json')
        frozen = next(r for r in source['performance'] if r['track'] == 'NORMALIZED' and r['scenario_bps'] == e['cost_scenario_bps'])
        expected = dict(cagr=frozen['cagr'], capm_alpha=frozen['alpha'], psr=None, max_drawdown=abs(frozen['max_drawdown']), average_beta=None, downside_beta=frozen['downside_beta'], tail_beta=frozen['tail_beta'], turnover=frozen['turnover'])
        assert e['metrics'] == expected and e['observations'] == frozen['observations'] and e['oos_folds'] == len(source['selections'])
        canonical_refs = json.dumps([dict(path=r['path'], sha256=r['sha256']) for r in e['refs']], sort_keys=True, separators=(',', ':'))
        assert e['provenance']['data_hash'] == hashlib.sha256(canonical_refs.encode()).hexdigest()
        assert 'reports/pipe01/verification.json' in e['provenance']['source_ids']
    archived = [x for x in outputs if x['experiment_id'] == 'ARCHIVAL_IDENTITY_REPLAY_QA_NOT_EX_ANTE']
    assert len(archived) == 96
    original_targets = {load(p)['value']['final_target']['target_id']: load(p)['value']['final_target'] for p in pathlib.Path('reports/pipe01/replay/decisions').glob('*.json')}
    assert all(x['record']['selected_certified_target'] == original_targets[x['record']['selected_certified_target']['target_id']] for x in archived)
    for cert in certificates:
        if not cert['source']['path'].startswith('reports/pipe01/'):
            continue
        assert cert['provenance']['data_hash'] == cert['source']['sha256']
        definition = next(d for d in registry['definitions'] if d['scope'] == cert['scope'] and d['identity'] == cert['identity'])
        assert set(cert['target']['final_asset_weights']) <= set(definition['underlying_ids'])
    return dict(frozen_source_hashes=len(catalog), exact_PIPE01_targets=96, performance_recalculated=False)


def persistence():
    counts = {}
    for p in ROOT.glob('*.csv'):
        with open(p, newline='') as f:
            rows = list(csv.reader(f, strict=True))
        assert rows and all(len(r) == len(rows[0]) for r in rows)
        counts[p.name] = len(rows)-1
    keys = [(r['experiment_id'], r['record']['decision_context_id'], r['record']['routing_stream_id'], r['record']['routing_timestamp']) for r in outputs]
    assert len(keys) == len(set(keys))
    for p in ROOT.glob('*.json'):
        value = load(p)
        assert json.loads(json.dumps(value, allow_nan=False)) == value
    assert all(x['record']['selected_certified_target'] is None for x in outputs if x['record']['action'] in ('BLOCKED', 'NO_NEW_TARGET'))
    return dict(CSV_counts=counts, unique_routing_business_keys=len(keys))


check('Independent logical routing oracle and exact target equality', routing)
check('Independent promotion thresholds and temporal lifecycle', promotions)
check('Frozen evidence byte hashes and copied metrics / PIPE01 identity', frozen_sources)
check('Persistence / RFC4180 / JSON roundtrip / no target on rejection', persistence)
result = dict(status='PASS' if all(c['status'] == 'PASS' for c in checks) else 'FAIL', checks=checks, financial_model_runs=0, backtests=0, original_router_calls=0)
(ROOT/'independent-verification.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
for c in checks:
    print(c['status'], c['criterion'], c.get('error', ''))
sys.exit(0 if result['status'] == 'PASS' else 1)
