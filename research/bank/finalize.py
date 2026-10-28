"""Assemble BANK01 evidence without recalculating economic/activation decisions."""
from pathlib import Path
import json,hashlib,subprocess
R=Path('reports/bank01')
def read(n):return json.loads((R/n).read_text())
criteria=[
('01','PROMOTED / ACTIVE / ALLOCATED remain distinct','tests 01–03, 22, 37, 65; activation-results.csv'),
('02','Correlation estimates are point-in-time','tests 09 (63/126/252), 19, 44, 54, 55, 62; independent NumPy oracle'),
('03','Dynamic clusters are causal','tests 11, 19, 30, 31, 57; independent SciPy linkage replay'),
('04','Same-asset strategies remain distinct','tests 05–08, 33; underlying-concentration.csv'),
('05','Cross-market same-family diversification is preserved','tests 04, 15, 53; family diagnostics'),
('06','Correlation never automatically retires','tests 03, 06, 30, 65; unchanged promotion states'),
('07','Representative selection is explicit and deterministic','test 13 (five selectors), 14, 51, 52'),
('08','Strategy and underlying diversification remain distinct','tests 10, 32–35; NumPy eigen/PCA and HHI oracle'),
('09','No allocation or RiskMandate mutation','tests 02, 36, 37, 64; static runtime import/call boundary'),
('10','Future data cannot rewrite historical active sets','tests 19–21, 26, 43–45, 54, 55'),
('11','Clustering and input-order reproducibility','tests 12, 13, 38, 57; reproducibility.json; hash-verification.json'),
('12','Historical replay valid or explicitly blocked','BLOCKED_MISSING_STRATEGY_HISTORY; blockers.csv; AL05 frozen artifact evidence'),
('13','Independent known-answer verification','71/71 TS cases; 544/544 NumPy/SciPy/storage/preservation checks'),
('14','Strict typecheck','typecheck-certification.log; exit 0; all new TS and imported certified dependencies'),
('15','git diff --check','diff-check.log; exit 0; additional new-source whitespace checks'),
('16','Previous baselines unchanged','preservation.json: 9031 frozen files byte-identical; original branch/commit/status retained'),
]
tests=read('test-results.json');ind=read('independent-verification.json');repro=read('reproducibility.json');checkpoint=read('checkpoint.json');commands=read('commands.json');manifest=read('manifest.json');summary=read('run-summary.json');resume=read('resume-evidence.json')
changed=[p for p,h in checkpoint['files'].items()if not Path(p).is_file()or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
assert not changed,changed
assert tests['fail']==ind['fail']==0 and tests['pass']==71 and ind['pass']==544
assert repro['status']=='PASS' and resume['record_hashes_unchanged'] and resume['duplicate_records']==0
assert all(c['exit_code']==0 for c in commands if c['log'].endswith(('typecheck-certification.log','diff-check.log','tests-certification.log','independent-certification.log')))
(R/'preservation.json').write_text(json.dumps({'status':'PASS','frozen_files':len(checkpoint['files']),'changed':changed,'branch':checkpoint['branch'],'commit':checkpoint['commit'],'tracked_dirty_calculator':'Preserved unchanged from initial checkpoint'},indent=2)+'\n')
verification={'block':'BANK-01','status':'PASS','scope':'MECHANICAL_RESEARCH_CERTIFICATION_ONLY','version':manifest['version'],'criteria':[{'id':id,'criterion':name,'status':'PASS','evidence':evidence}for id,name,evidence in criteria],'tests':{'pass':tests['pass'],'fail':tests['fail']},'independent_checks':{'pass':ind['pass'],'fail':ind['fail']},'synthetic_decisions':summary['decisions'],'historical_replay':'BLOCKED_MISSING_STRATEGY_HISTORY','historical_governance':'BLOCKED_MISSING_HISTORICAL_PROMOTION_GOVERNANCE','code_hash':manifest['code_hash'],'manifest_hash':manifest['hash'],'reproducibility_status':repro['status'],'preserved_files':len(checkpoint['files']),'no_production_changes':True,'no_real_promotions':True,'no_allocations_created':True,'no_follow_on_block_opened':True}
(R/'verification.json').write_text(json.dumps(verification,indent=2)+'\n')
case_rows='\n'.join('| '+c['case'].replace('|','\\|')+' | '+c['status']+' |'for c in tests['cases'])
matrix='\n'.join('| '+id+' | '+name+' | PASS | '+evidence+' |'for id,name,evidence in criteria)
files='\n'.join('- `'+str(p)+'`'for p in sorted(Path('research/bank').glob('*'))if p.is_file())
command_rows='\n'.join('| `'+(' '.join(c['command'])).replace('|','\\|')+'` | '+str(c['exit_code'])+' | `'+c['log']+'` |'for c in commands)
report=f'''# BANK-01 — Dynamic Signal and Strategy Bank

**PASS — mechanical research certification.** 71/71 cases PASS; 544/544 independent checks PASS. The bank determines eligibility/activation only. It neither promotes research nor creates capital allocations, modifies RiskMandate, builds fallback targets or invokes execution.

The historical replay is **BLOCKED_MISSING_STRATEGY_HISTORY**. Frozen PIPE-02 contains zero real promotions. Every replayed state in this block is explicitly QA_ONLY, with externally supplied synthetic approval assertions; no historical or actual approval was created.

## Preservation

Repository `juanser15/Allocationlab`, `/workspace/Allocationlab`; branch `{checkpoint['branch']}`, commit `{checkpoint['commit']}`. Initial dirty calculator and all tracked/untracked certified baselines were preserved. Checkpoint: **{len(checkpoint['files']):,} files**, including CL/CRE/AL/PIPE reports/results/source, production and manifests/lockfiles. The post-run SHA-256 comparison found **zero changes**. No reset, checkout, commit, push, merge or deploy. No services or network financial data were used.

## Implementation

`Entry`, immutable temporal `State`, `ActiveSetPolicy` and `ActiveSetArtifact` separate SIGNAL information from STRATEGY_INSTANCE returns. `active_strategy_ids` is distinct from `active_signal_ids`; no score correlation substitutes for strategy-return correlation. Duplicate economic identity is rejected unless separate execution sleeves are declared. Same underlying and same family remain valid distinct instances.

PIT sample covariance/correlation supports exactly 63/126/252-session declared windows, explicit minimum observations and common-session missingness. No pairwise imputation or denominator epsilon. Deterministic hierarchical SINGLE/COMPLETE/AVERAGE linkage uses distance sqrt((1−rho)/2), declared thresholds and lexicographic ties. Membership hashes remain stable for identical member sets; model/cluster artifacts bind their information set.

Default declared reference policy preserves eligible correlated streams. Only explicit caps/redundancy thresholds deactivate temporarily. All five representative selectors are tested. Frozen research evidence is checked against promotion identity and timing. The real scope reads certified PIPE-02 governance state; it cannot accept an ad-hoc QA promotion or self-promote. External manual holds/suspension/retirement remain binding.

Diagnostics keep nominal instances, equal-unit reference count, covariance rank, strategy PCA risk bets, underlying counts/concentration and implementation PCA bets separate. Actual capital-allocation HHI/effective count remain null because BANK-01 assigns no capital. Marginal before/after tests use an explicitly labelled equal-unit diagnostic probe. Optional unit maps preserve algebraic signs/internal residual; nothing becomes global cash. Beta/factor/sector/region similarities are diagnostic only.

The AL-05 handoff returns IDs/reference only and requires an exact active-axis PIT bundle, validated by certified AL-05 validation. It does not slice covariance, alter constraints, normalize old holdings or solve an allocation. PIPE-02 bank/router and AL-05 implementations remain untouched.

## Synthetic stress and replay

Nine declared fixture families A–I: five highly correlated approved QA controls; same family across low-correlation markets; shared SPY underlying with mixed P&L; changing clusters; re-entry; negatively correlated shared-underlying P&L; crisis correlation spike; a missing observation; regime-ineligible approved instance. These are mathematical controls, not newly created financial strategies or evidence of economic excellence.

Each fixture is evaluated at six explicitly supplied decision dates under preserve and cluster-cap-one policies: **108 decisions, 540 entry-decision rows**, **448 active / 92 inactive**. All attempts are retained; no runtime decision failed. A separate exact full round-trip fixture demonstrates ACTIVE → INACTIVE → ACTIVE with promotion unchanged, and its inputs/results are persisted in `activation-roundtrip-evidence.json` and independently replayed.

First execution wrote 108 immutable records. Repetition wrote **zero new records**, reused all 108 and preserved record hashes. Economic/diagnostic artifacts and eight PNG charts were byte-identical across repeated runs ({repro['files_compared']} compared files). Telemetry/log timestamps are excluded from economic identity. Content-hash tampering, changed code and attempts to replace a prior decision are rejected. No daily scheduler is implied by the rolling estimator.

## Independent verification

Python NumPy independently recomputes sample covariance, Pearson correlation, covariance entropy rank, diagnostic variance/PCA risk bets and underlying HHI. SciPy hierarchical linkage independently reconstructs cluster membership. A separate policy replay reconstructs eligibility and active IDs from persisted inputs, without invoking the TS selector. CSV validation checks RFC4180 quoting/CRLF, row counts, references and JSON round trips. A standalone Node crypto script checks canonical hashes and frozen source/dependency hashes without importing the bank hash implementation.

Numerical comparisons: default oracle absolute/relative tolerance 1e-10, PCA-bet absolute 2e-8; direct TS sample-covariance checks use 1e-16. The declared policy's numerical tolerance is 1e-12. Numerical tolerances are not economic thresholds. Repeated-eigenvalue PCA basis dependence is explicitly flagged rather than treated as invariant risk-bet attribution.

## Failures and corrections preserved

Initial execution: **35 PASS / 21 FAIL**. Twenty failures came from modifying already-frozen QA definitions in fixture preparation; one came from a handoff fixture whose returns did not cover its decision cutoff. Preparation was corrected without changing expected answers; subsequent original 56/56 passed. Initial logs/results remain under `tests-initial.log`, `test-results-initial.json` and `pre-hardening/`.

An additional handoff regression then reproduced acceptance of a bundle whose stream list was filtered but whose covariance retained an inactive ID (**69 PASS / 1 FAIL**). The new BANK-only adapter now delegates full input validation to certified AL-05. The failing regression and pre/post snapshots remain in `handoff-regression-before.*`, `pre-hardening/` and `post-handoff-before-roundtrip/`. No certified mathematics was edited. Final suite adds the complete three-state activation round trip: **71/71 PASS**, with no skipped cases or increased tolerances.

## Historical blocker and limits

Concrete unavailable bundles: `reports/oct2026-backtests/alpha2-preparation.response.json` and `reports/oct2026-backtests/alpha-no-commodities-hrhgcyld/preparation.response.json` are LFS pointers, as frozen in `reports/al05/blocked-artifacts.json`. Complete original strategy ledgers/definition versions, historical dated position maps/availability and NET PIT risk artifacts are unavailable. The historical promotion chain is also absent; actual PIPE-02 research entries remain PROMOTABLE/INACTIVE. No fetch/retry loop or fabrication was attempted. A retrospective RESEARCH_ONLY_BANK_REPLAY was not presented as a governed historical replay.

Certification covers this v1 deterministic policy contract, known answers and declared stress fixtures. It does not establish economic value, data-vendor authenticity, capacity, large-bank performance or successful historical strategy activation. SIGNAL scores are not recomputed, regimes are externally supplied, and optional real factor/asset-risk similarity is not certified from missing historical artifacts. No EWMA/shrinkage, dynamic threshold research, optimization, quality-gate rewrite, production consumer, broker connection or PIPE-03 was added.

## Acceptance matrix

| ID | Criterion | Status | Evidence |
| --- | --- | --- | --- |
{matrix}

## New files and outputs

{files}

Reports: `reports/BANK01_active_set.md`, `reports/BANK01_methodology.md`, and `reports/bank01/` with required CSVs, correlation matrices, immutable records, manifests, checkpoints, full test/independent verification, reproducibility/resume evidence and eight charts. Prior baseline source is read/imported only; no production adapter is introduced.

## Executed commands and exit codes

Commands below are recorded verbatim as argument arrays in `commands.json`. The initial failing fixture run is preserved separately; its shell batch ended after printing the log, so that batch's exit 0 does not certify its failing cases. The explicit handoff regression returned exit 1 as recorded. All final certification commands returned 0. Existing installed dependencies were reused; no manifest/lockfile change or reinstall.

| Command | Exit | Log |
| --- | --- | --- |
{command_rows}

## Final cases

| Case | Result |
| --- | --- |
{case_rows}
'''
Path('reports/BANK01_active_set.md').write_text(report)
print(json.dumps({'status':'PASS','tests':tests['pass'],'independent':ind['pass'],'preserved':len(checkpoint['files']),'criteria':len(criteria)}))
