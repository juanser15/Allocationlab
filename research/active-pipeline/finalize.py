"""Report certification from persisted evidence; no pipeline/search recalculation."""
from pathlib import Path
import json,hashlib,subprocess
R=Path('reports/pipe03')
def read(n):return json.loads((R/n).read_text())
c=read('checkpoint.json');tests=read('test-results.json');ind=read('independent-verification.json');m=read('manifest.json');s=read('run-summary.json');repro=read('reproducibility.json');resume=read('resume-evidence.json');h=read('hash-verification.json');commands=read('commands.json')
changed=[p for p,v in c['files'].items()if not Path(p).is_file()or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=v];assert not changed,changed
assert tests['passed']==46 and tests['failed']==0 and tests['skipped']==0
assert ind['status']==h['status']==repro['status']=='PASS'and ind['failed']==0
assert s['completed']==20 and not s['expected_status_mismatches']
assert resume['final_repeat']['reused']==20 and resume['final_repeat']['pipeline_runs']==0
assert all(x['previous_hashes_preserved']for x in resume['steps'])
assert next(x for x in commands if x['log'].endswith('typecheck-release.log'))['exit_code']==0
assert next(x for x in commands if x['log'].endswith('diff-check.log'))['exit_code']==0
criteria=[
('01','ActiveSetArtifact is the sole eligible strategy universe','A, H, Q, X, AQ, AR, AT; frozen-source membership integrity; allocator-universe.csv'),
('02','Inactive strategies cannot reach AL05','B, D, R, Y, Z; active-only mu/Sigma/H/constraints/output; excluded BANK reasons retained'),
('03','BANK01 eligibility and AL05 allocation remain separate','A–F, C active zero; static scope check; no BANK clustering/allocator math in new core'),
('04','PIT and no-lookahead','G, W, AG, AH; exact dated immutable snapshots and strict previous-close cutoff'),
('05','Strategy and underlying mappings reconcile','F, L, P, Q, T, AJ–AL; independent H*a gross/net/residual/beta oracles'),
('06','Robustness cannot alter allocations','I, J, M; exact AL05 stage/result equality; immutable source guards'),
('07','RiskMandate unchanged','K, U, V; unchanged requested mandate hash and certified composition'),
('08','No double cash','L, P, T, V; internal residual and signed/non-net-one paths explicitly blocked'),
('09','PIPE02 routing semantics preserved','M, AC, AN, AS; source-configuration governance identity; no dynamic fallback/promotion'),
('10','Historical replay honestly blocked','blockers.csv; frozen AL05 LFS/missing-history evidence and missing historical governance'),
('11','Idempotence and resume','N, O, AD–AF, AO, AP; pauses 0/1/10/20; final 20 reused with zero pipeline reruns'),
('12','Independent verification','159 arithmetic/storage/preservation checks; independent canonical hash/stage/target validation'),
('13','Strict typecheck','typecheck-release.log; exit 0, all new TS and imported certified dependencies'),
('14','git diff --check','diff-check.log; exit 0; new-source whitespace diagnostics checked separately'),
('15','All prior baselines unchanged',f"preservation.json; {len(c['files'])} frozen files byte-identical; same branch/commit")]
(R/'preservation.json').write_text(json.dumps({'status':'PASS','files':len(c['files']),'changed':changed,'branch':c['branch'],'commit':c['commit'],'original_dirty_calculator_preserved':True},indent=2)+'\n')
verification={'block':'PIPE-03','status':'PASS','scope':'MECHANICAL_SYNTHETIC_INTEGRATION_CERTIFICATION_ONLY','version':m['version'],'criteria':[{'id':id,'criterion':name,'status':'PASS','evidence':e}for id,name,e in criteria],'tests':{'passed':46,'failed':0,'skipped':0},'independent_checks':{'passed':ind['passed'],'failed':0},'acceptance_decisions':20,'valid_primary_targets':16,'expected_primary_failures':4,'routing_actions':s['routing_actions'],'new_promotions':0,'historical_replay':'BLOCKED_MISSING_STRATEGY_HISTORY','historical_governance':'BLOCKED_MISSING_HISTORICAL_PIT_GOVERNANCE','new_configuration_routing':'NO_NEW_TARGET_MISSING_PROMOTION','candidate_search_runs':0,'backtests_executed':0,'execution_connections':0,'source_code_hash':m['code_hash'],'manifest_hash':m['hash'],'baseline_files_preserved':len(c['files']),'no_UI':True,'no_follow_on_block_opened':True}
(R/'verification.json').write_text(json.dumps(verification,indent=2)+'\n')
rows='\n'.join('| '+id+' | '+n+' | PASS | '+e+' |'for id,n,e in criteria)
case_table='\n'.join('| '+r['case'].replace('|','\\|')+' | '+r['status']+' |'for r in tests['cases'])
cmd_table='\n'.join('| `'+(' '.join(r['command'])).replace('|','\\|')+'` | '+str(r['exit_code'])+' | `'+r['log']+'` |'for r in commands)
files='\n'.join('- `'+str(p)+'`'for p in sorted(Path('research/active-pipeline').glob('*'))if p.is_file())
Path('reports/PIPE03_active_set_integration.md').write_text(f'''# PIPE-03 — Active Set Integration Certification

**PASS — mechanical research integration.** All 15 acceptance criteria pass. **46/46 tests, zero skipped; 159/159 independent checks.** Twenty synthetic decisions completed, with 16 valid primary targets and four deliberately blocked primary paths. No strategies or promotions were created, no financial model/optimizer changed, and no search/backtest/execution was run.

All 20 integration routes are **NO_NEW_TARGET**, because the new source allocation configurations have no supplied promotion approval. This is distinct from mechanical target validity. A separate pre-approved control from frozen PIPE-02 returns its exact original target. PIPE-03 does not manufacture an APPROVE record to make a positive route appear.

## Preservation and location

Only `research/active-pipeline/`, this report and `reports/pipe03/` were added. Repository: `juanser15/Allocationlab`, path `/workspace/Allocationlab`, branch `{c['branch']}`, commit `{c['commit']}`. The initial tracked modification in calculator.ts was preserved unchanged, along with every prior tracked/untracked baseline. SHA-256 checkpoint: **{len(c['files']):,} existing files**, including BANK-01 and its ZIP. No reset, checkout, commit, push, merge, deploy, production route/UI/DB change, credential or service access.

## Canonical integration

`Frozen BANK01 ActiveSet -> explicit active-axis artifact projection -> AL05 through unchanged PIPE01 -> exact AL06 robustness observation -> certified AL01/02 controller when compatible -> immutable mechanical target certificate -> unchanged PIPE02 router`.

The new core never invokes BANK clustering, strategy creation, optimizer mathematics, research selection, governance promotion or research execution. AL-05's own correlation clusters remain diagnostics; PIPE-03 does not use them to filter the bank universe a second time.

`Request` binds a fixed source candidate, exact decision/cutoff, frozen ActiveSet hash and source bytes, supplied canonical strategy snapshots, unchanged RiskMandate/gate policies and a separate logical routing environment. The integration checks that the source configuration explicitly cites the BANK policy ID/version/hash. It reads only a matching dated ActiveSet available by the decision. Rehashed edits cannot impersonate the original persisted record: the loader verifies actual source-file SHA-256, the matching result payload and matching frozen bank definitions. Future library records are filtered before validation or input identity.

The source integrity loader currently supports BANK-01's persisted certification-row catalogs. It does not reconstruct missing historical strategy artifacts. Catalog versions are immutable: extending history means a new snapshot/version, preserving old referenced bytes. Its cache binds path, SHA and file metadata; economic identities bind content, not filesystem times. Hashes verify supplied content integrity; they are not external authentication or new promotion authority.

## Active-only AL05 bundle

Every stream ID passed to AL-05 equals exactly the frozen active set, including active instances that later receive zero capital. Inactive IDs are absent from strategy mu, strategy covariance/betas, H columns, constraints and allocation output. They remain in the source bank and are persisted with their BANK status/reason.

Covariance is a principal submatrix of an externally supplied PIT artifact, with no refit, shrinkage or changed objective. Mu and betas are selected on that same axis; map rows and asset risk artifacts follow the active H instrument union. Full source artifacts are validated before projection, and the resulting bundle passes the certified BANK/AL05 handoff validation. Missing artifacts do not shrink the active set or cause historical-mean estimates.

Projection changes are explicitly recorded. A zero-minimum inactive bound can be removed because inactive allocation is already fixed at zero. Nonnegative family/group upper limits on absent members remain equivalent; empty asset constraints are removed only when zero satisfies them. Inactive positive minimums or incompatible empty-group floors return explicit infeasibility. An upper cardinality bound larger than the reduced universe becomes the equivalent universe-size bound, never a looser cap. No positive inactive previous holding is renormalized away: the path is BLOCKED_PREVIOUS_ALLOCATION_AXIS until an explicit exit-accounting contract exists. Off-axis actual incremental-cost trades are also blocked rather than invented.

PROMOTED, ACTIVE and ALLOCATED remain distinct. Same-family/different-market and same-underlying instances retain separate return axes through the optimizer. Only afterward does certified AL-05 aggregate `x = H a`, preserving contributions, gross/net, algebraic netting, concentration and internal residual capital.

## Source identity and compiled decision identity

The fixed source configuration is the research/governance approval unit. The per-decision compiled candidate adapts that explicitly authorized configuration to the frozen active axis so unchanged PIPE-01 can verify exact native constraints. Its identity additionally binds active membership and source snapshots. This compilation is deterministic and performs no candidate search or reranking.

The target certificate and PIPE-02 primary reference retain **the fixed source candidate identity/hash**, while the certified target retains its original compiled PIPE-01 context identity. If a matching available registry definition exists, its exact source identity is reused. An unrelated approved configuration cannot authorize the new target. Neither identity is rewritten inside a target. This bridge is covered by AS/AT and the frozen positive router control AN.

## Gates, controller and cash

PIPE-01 invokes AL-05 exactly once per pending pipeline decision. The ALLOCATOR stage payload and the allocation observed by AL-06 are equal; no re-optimization or allocation mutation occurs in the gate. The supplied mandate remains byte/value identical, and its hash is retained by the target.

Only a controller-compatible long-only/net-one instrument projection proceeds to final composition. `lambda = target_beta / beta_sleeve`, final instrument weights are lambda times the unchanged sleeve, and global implementation cash comes exclusively from the certified controller. There is no cash decision in bank, projection, allocator or router.

For signed/non-net-one/internal-residual cases, unchanged PIPE-01 stops at missing compatible sleeve risk. PIPE-03 additionally observes the exact AL-05 result with AL-06 for diagnostics, retaining the original primary failure and **BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE**. It creates no final target/cash. Internal strategy residual remains internal; net signed exposure is never relabelled as cash.

## Point in time and clocks

Market information uses the strict previous-close cutoff of PIPE-01. Strategy/map/risk artifact envelopes cannot exceed it; current/final definitions cannot substitute for missing dated snapshots. The active set is available by the decision date and must exactly match that decision/cutoff. The pipeline cannot silently advance either.

Logical routing has a separately explicit governance/availability cutoff on the decision date, allowing a mechanically generated target to exist before routing. It does not advance the target's market-information cutoff. Both clocks are persisted in the ledger/CSV. Future activation, correlation/retirement records and future risk/history/map/beta snapshots cannot change old decisions. Unavailable future payloads are ignored, including a malformed/NaN future covariance in the mutation fixture. A changed historical snapshot or changed code conflicts with an immutable completed decision.

Calendar-only synthetic rows are passed to the existing execution-date resolver. Their price maps are empty and never used for valuation, fills or P&L. The inherited `next_close` convention/date is target metadata only: PIPE-03 executes no accounting engine, orders, broker or paper connection. There are no performance or realized-risk claims in this block.

## Synthetic acceptance and independent reconciliation

The acceptance uses existing frozen BANK-01 QA mathematical controls and AL-05's certified external diagonal-covariance fixtures. The supplied diagonal model is a known-answer control, not a historical covariance estimate fitted to the control return paths. It generates no financial forecast or new strategy. Histories and identity definitions are reused from frozen BANK artifacts.

Cases: same family across markets, shared underlying, correlated strategies preserved, explicit cluster cap and regime exclusion, each with Equal Capital / Min Variance / ERC. Additional cases cover active-zero allocation, mandatory robustness threshold failure, internal residual, signed exposure and inactive positive-minimum conflict.

Totals: **20 decisions, 100 bank-entry rows, 80 active allocator/output allocation rows, 60 mapped instrument rows, 16 mechanical targets, four expected primary failures**. Every attempt remains persisted. The four failures are one robustness failure, two controller-scope blocks and one inactive-minimum infeasibility. None is relabelled PASS to create a target or fallback.

Python independently reconstructs diagonal min-var inverse-variance weights, diagonal ERC inverse-vol weights, equal capital, covariance projection, H*a/contributions/gross/net/netting/internal residual, strategy vs position beta, volatility, lambda/final risk/cash, gate/source immutability, routing rejection and persistence. It invokes no core allocator, gate, controller, BANK clustering or router. RFC4180 CSV/JSON round trips, referential counts and the complete stage journal are checked. Separate Node crypto validation checks canonical hashes, stage payloads/IDs, targets and frozen source/dependency hashes without importing the core hash routine.

Arithmetic oracle tolerances: absolute/relative 1e-9, optimizer weight absolute 2e-8, variance absolute 1e-13. Known-answer TS tests use 1e-10 by default and 1e-8 for ERC weights, unchanged from their first execution. No tolerance was increased to hide a failure.

## Resume and reproducibility

The explicit interruption sequence stops after 0, 1, 10 and 20 total decisions. Earlier records keep the same bytes. The final identical replay reuses **20/20**, invokes the pipeline/allocator **zero** times, and adds **zero** duplicate records. Failed decisions remain durable. Atomic immutable record publication rejects input/code conflicts and tampering.

Release reproducibility compares deterministic CSVs, stage ledger, input/result/manifest JSON, durable records and four supplementary charts; telemetry logs/counters are excluded. The stored hashes match. Reports are reproducible views of immutable decision records, not mutable replacements for history.

## Corrections and pre/post evidence

Initial 35 tests passed, then four independent allocation/oracle cases and three persistence/router controls passed. Strict typecheck initially caught literal-version widening and missing test union narrowing; those new-source type issues were fixed without changing runtime answers or expectations. The campaign initially refused to start because the reader used `status` for AL-05, whose frozen schema uses `mechanical_status`. The loader now checks that explicit field; the failed startup log is retained, with zero jobs executed before correction.

Two new provenance tests reproduced **42 PASS / 2 FAIL**: a rehashed ActiveSet or a false claimed source SHA could be accepted without checking the original bytes. The source-integrity adapter fixed this; initial logs, source snapshots and outputs are preserved under `pre-source-integrity/` and `tests-source-regression-before.*`. The original 20 complete results were unchanged after that guard.

Two further identity tests reproduced **44 PASS / 2 FAIL**: the governance certificate referenced the daily compiled candidate instead of the fixed source configuration, and a source configuration did not explicitly bind BANK policy. The integration-only certificate/compiler bridge now preserves those distinctions; `pre-governance-identity/` and `tests-governance-regression-before.*` retain the evidence. The original 20 allocations, aggregations, mandate/composition/economic target fields and routing actions remain unchanged. Context/target hashes were intentionally reidentified to bind the corrected source configuration, recorded in `pre-post-comparison.json`.

Final suite: **46 PASS, zero FAIL, zero skipped**. No certified baseline was edited.

## Blockers and limits

Real historical strategy replay remains **BLOCKED_MISSING_STRATEGY_HISTORY** and **BLOCKED_MISSING_HISTORICAL_PIT_GOVERNANCE**. The concrete AL-05 history sources `reports/oct2026-backtests/alpha2-preparation.response.json` and `reports/oct2026-backtests/alpha-no-commodities-hrhgcyld/preparation.response.json` are LFS pointers; complete versioned strategy ledgers/maps/PIT risk bundles are unavailable. Frozen PIPE-02 contains zero actual promotions. No download, history fabrication or retrospective promotion was attempted.

All approvals/activation assumptions used for strategy eligibility are explicitly frozen QA fixtures, not evidence that promotion was known on those calendar dates. The separate frozen PIPE-02 positive control is a previously certified target, not approval of the new StrategyStreams configuration. The new paths correctly return NO_NEW_TARGET until separately authorized governance artifacts exist.

The v1 adapter expects an exact dated canonical strategy bundle, has no signed-financing controller and conservatively blocks positive off-axis prior capital/exit costs. Acceptance uses the declared zero-bps/no-execution target scenario; it does not measure actual execution costs, return, timing skill or alpha. No AL-07 search, BANK-policy optimization, strategy promotion, fallback construction, financial model, production consumer, UI or follow-on block was implemented.

## Acceptance matrix

| ID | Criterion | Status | Evidence |
| --- | --- | --- | --- |
{rows}

## Files added

{files}

Required outputs are in `reports/pipe03/`: active-set-inputs.csv, allocator-universe.csv, strategy-allocation.csv, mapped-exposures.csv, robustness-results.csv, risk-composition.csv, routing-results.csv, stage-ledger.jsonl, blockers.csv, verification.json, independent-verification.json, reproducibility.json and resume-evidence.json. Additional manifests, immutable records, input/result catalogs, pre/post evidence, command logs, source diff and four charts support review.

## Executed commands and exits

Installed dependencies and the existing runner were reused. No manifest/lockfile edit, reinstall or network service was needed. The DB shim is the already-certified A1 build adapter; it prevents an unused database import and does not simulate any allocator/gate/controller under test. Nonzero pre-fix runs are preserved and do not count as release passes. Final tests, strict typecheck, acceptance, independent verification and git diff --check exit 0.

| Command | Exit | Log |
| --- | --- | --- |
{cmd_table}

## Individual release tests

| Case | Status |
| --- | --- |
{case_table}
''')
print(json.dumps({'status':'PASS','criteria':15,'tests':46,'independent_checks':ind['passed'],'baseline_files':len(c['files'])}))
