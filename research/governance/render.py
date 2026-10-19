"""Read-only charts of persisted governance classifications; no performance."""
import collections
import json
import pathlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = pathlib.Path('reports/pipe02')
charts = root/'charts'
charts.mkdir(exist_ok=True)
plt.rcParams.update({'figure.dpi': 130, 'font.size': 10, 'axes.grid': True, 'grid.alpha': .2})
load = lambda name: json.loads((root/name).read_text())
routes = [json.loads(s) for s in (root/'routing-ledger.jsonl').read_text().splitlines()]
reg = load('bank-registry-full.json')


def save(fig, name):
    fig.tight_layout()
    fig.savefig(charts/name, bbox_inches='tight')
    plt.close(fig)


fig, ax = plt.subplots(figsize=(12, 5))
positions = {'RESEARCH': (0, 2), 'VALIDATED': (2, 2), 'PROMOTABLE': (4, 2), 'PROMOTED': (6, 2), 'SUSPENDED': (8, 2), 'RETIRED': (10, 2)}
for state, (x, y) in positions.items():
    ax.text(x, y, state, ha='center', va='center', bbox=dict(boxstyle='round,pad=.5', facecolor='#e6effa', edgecolor='#315a8a'))
for a, b in [('RESEARCH', 'VALIDATED'), ('VALIDATED', 'PROMOTABLE'), ('PROMOTABLE', 'PROMOTED'), ('PROMOTED', 'SUSPENDED'), ('SUSPENDED', 'RETIRED')]:
    x1, y1 = positions[a]
    x2, y2 = positions[b]
    ax.annotate('', xy=(x2-.6, y2), xytext=(x1+.6, y1), arrowprops=dict(arrowstyle='->', color='#315a8a'))
ax.annotate('Explicit authorized decision', xy=(5, 2), xytext=(5, 3), ha='center', arrowprops=dict(arrowstyle='->'))
ax.annotate('Authorized resume', xy=(6, 1.7), xytext=(8, 1.2), ha='center', arrowprops=dict(arrowstyle='->', connectionstyle='arc3,rad=-.3'))
ax.text(6, 0, 'Activation is separate: ACTIVE / INACTIVE\nNeither state assigns capital or submits trades', ha='center', bbox=dict(boxstyle='round,pad=.7', facecolor='#edf3e8'))
ax.set(xlim=(-1, 11), ylim=(-.7, 3.7), title='Promotion lifecycle and independent externally supplied activation')
ax.axis('off')
save(fig, '01-promotion-lifecycle.png')

fig, ax = plt.subplots(figsize=(8, 4))
counts = collections.Counter(d['decision'] for d in reg['decisions'])
ax.bar(['QA APPROVE', 'QA REJECT', 'QA DEFER', 'Actual research APPROVE'], [counts['APPROVE'], counts['REJECT'], counts['DEFER'], 0], color=['#517fa4', '#be8279', '#d0ae62', '#7a7a7a'])
ax.set(title='Main certification registry: approvals are QA simulations only\nREJECT is additionally tested in a separate synthetic branch', ylabel='Explicit decision records')
ax.tick_params(axis='x', rotation=12)
save(fig, '02-promotion-decision-outcomes.png')

actions = ['USE_PRIMARY_TARGET', 'HOLD_PREVIOUS_CERTIFIED_TARGET', 'USE_PREAPPROVED_FALLBACK', 'NO_NEW_TARGET', 'BLOCKED']
colors = ['#517fa4', '#7aa57a', '#c6a558', '#9b9b9b', '#ba706a']
causes = sorted(set(x['record']['selected_condition'] or 'POLICY_NOT_AVAILABLE_OR_INVALID' for x in routes))
fig, ax = plt.subplots(figsize=(12, 6))
left = [0]*len(causes)
for action, color in zip(actions, colors):
    value = [sum(x['record']['action'] == action and (x['record']['selected_condition'] or 'POLICY_NOT_AVAILABLE_OR_INVALID') == cause for x in routes) for cause in causes]
    ax.barh(causes, value, left=left, label=action, color=color)
    left = [a+b for a, b in zip(left, value)]
ax.set(title='Routing actions by explicitly selected cause', xlabel='Logical records, not executions')
ax.legend(fontsize=7, loc='lower right')
save(fig, '03-routing-actions-by-cause.png')

groups = [('ARCHIVAL_IDENTITY_REPLAY_QA_NOT_EX_ANTE', 'Archival identity replay QA'), ('CURRENT_REAL_GOVERNANCE_UNAPPROVED', 'Current real governance'), ('ORIGINAL_DATE_PIT_GOVERNANCE_UNAVAILABLE', 'Original dates PIT'), ('SYNTHETIC_', 'Synthetic failure sequences')]
fig, axes = plt.subplots(2, 2, figsize=(12, 7))
short = ['Primary', 'Hold', 'Fallback', 'No target', 'Blocked']
for ax, (group, title) in zip(axes.flat, groups):
    subset = [x for x in routes if x['experiment_id'] == group or group == 'SYNTHETIC_' and x['experiment_id'].startswith(group)]
    ax.bar(short, [sum(x['record']['action'] == a for x in subset) for a in actions], color=colors)
    ax.set(title=title, ylabel='Logical decisions')
    ax.tick_params(axis='x', rotation=15)
fig.suptitle('Exact target replay does not imply historical or actual approval', y=1.02)
save(fig, '04-primary-hold-fallback-no-target.png')

import csv
with open(root/'bank-registry.csv', newline='') as f:
    bank = list(csv.DictReader(f))
categories = sorted(set((b['promotion_status'], b['activation_status']) for b in bank))
fig, ax = plt.subplots(figsize=(10, 4))
for j, scope in enumerate(['RESEARCH_GOVERNANCE', 'QA_ONLY']):
    ax.bar([i-.18+j*.36 for i in range(len(categories))], [sum((b['promotion_status'], b['activation_status']) == key and b['scope'] == scope for b in bank) for key in categories], width=.36, label=scope)
ax.set_xticks(range(len(categories)), [' / '.join(k) for k in categories])
ax.set(title='Actual entries remain PROMOTABLE / INACTIVE\nQA lifecycle examples include a separate virtual 2027 retirement', ylabel='Bank entries')
ax.legend()
save(fig, '05-bank-promotion-activation-states.png')

fig, ax = plt.subplots(figsize=(9, 4))
usage = [sum(x['record']['action'] == a for x in routes) for a in ['HOLD_PREVIOUS_CERTIFIED_TARGET', 'USE_PREAPPROVED_FALLBACK']]
ax.bar(['Synthetic HOLD old A', 'Synthetic preapproved F', 'Actual fallback use'], [*usage, 0], color=['#7aa57a', '#c6a558', '#9b9b9b'])
ax.set(title='Fallback use is explicit and synthetic in this certification', ylabel='Logical selections')
save(fig, '06-fallback-usage.png')

failed = [x['record'] for x in routes if x['record']['primary_status'] != 'VALID']
statuses = sorted(set(x['primary_status'] for x in failed))
fig, ax = plt.subplots(figsize=(12, 4))
left = [0]*len(statuses)
for action, color in zip(actions, colors):
    vals = [sum(r['primary_status'] == s and r['action'] == action for r in failed) for s in statuses]
    ax.barh(statuses, vals, left=left, label=action, color=color)
    left = [a+b for a, b in zip(left, vals)]
ax.set(title='Primary failures remain failures even when HOLD or fallback succeeds', xlabel='Synthetic primary-failure records')
ax.legend(fontsize=7, loc='lower right')
save(fig, '07-primary-failure-routing-distribution.png')
print('7 charts generated from persisted governance records only')
