# BANK-01 — Dynamic Signal and Strategy Bank

**PASS — mechanical research certification.** 71/71 cases PASS; 544/544 independent checks PASS. The bank determines eligibility/activation only. It neither promotes research nor creates capital allocations, modifies RiskMandate, builds fallback targets or invokes execution.

The historical replay is **BLOCKED_MISSING_STRATEGY_HISTORY**. Frozen PIPE-02 contains zero real promotions. Every replayed state in this block is explicitly QA_ONLY, with externally supplied synthetic approval assertions; no historical or actual approval was created.

## Preservation

Repository `juanser15/Allocationlab`, `/workspace/Allocationlab`; branch `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. Initial dirty calculator and all tracked/untracked certified baselines were preserved. Checkpoint: **9,031 files**, including CL/CRE/AL/PIPE reports/results/source, production and manifests/lockfiles. The post-run SHA-256 comparison found **zero changes**. No reset, checkout, commit, push, merge or deploy. No services or network financial data were used.

## Implementation

`Entry`, immutable temporal `State`, `ActiveSetPolicy` and `ActiveSetArtifact` separate SIGNAL information from STRATEGY_INSTANCE returns. `active_strategy_ids` is distinct from `active_signal_ids`; no score correlation substitutes for strategy-return correlation. Duplicate economic identity is rejected unless separate execution sleeves are declared. Same underlying and same family remain valid distinct instances.

PIT sample covariance/correlation supports exactly 63/126/252-session declared windows, explicit minimum observations and common-session missingness. No pairwise imputation or denominator epsilon. Deterministic hierarchical SINGLE/COMPLETE/AVERAGE linkage uses distance sqrt((1−rho)/2), declared thresholds and lexicographic ties. Membership hashes remain stable for identical member sets; model/cluster artifacts bind their information set.

Default declared reference policy preserves eligible correlated streams. Only explicit caps/redundancy thresholds deactivate temporarily. All five representative selectors are tested. Frozen research evidence is checked against promotion identity and timing. The real scope reads certified PIPE-02 governance state; it cannot accept an ad-hoc QA promotion or self-promote. External manual holds/suspension/retirement remain binding.

Diagnostics keep nominal instances, equal-unit reference count, covariance rank, strategy PCA risk bets, underlying counts/concentration and implementation PCA bets separate. Actual capital-allocation HHI/effective count remain null because BANK-01 assigns no capital. Marginal before/after tests use an explicitly labelled equal-unit diagnostic probe. Optional unit maps preserve algebraic signs/internal residual; nothing becomes global cash. Beta/factor/sector/region similarities are diagnostic only.

The AL-05 handoff returns IDs/reference only and requires an exact active-axis PIT bundle, validated by certified AL-05 validation. It does not slice covariance, alter constraints, normalize old holdings or solve an allocation. PIPE-02 bank/router and AL-05 implementations remain untouched.

## Synthetic stress and replay

Nine declared fixture families A–I: five highly correlated approved QA controls; same family across low-correlation markets; shared SPY underlying with mixed P&L; changing clusters; re-entry; negatively correlated shared-underlying P&L; crisis correlation spike; a missing observation; regime-ineligible approved instance. These are mathematical controls, not newly created financial strategies or evidence of economic excellence.

Each fixture is evaluated at six explicitly supplied decision dates under preserve and cluster-cap-one policies: **108 decisions, 540 entry-decision rows**, **448 active / 92 inactive**. All attempts are retained; no runtime decision failed. A separate exact full round-trip fixture demonstrates ACTIVE → INACTIVE → ACTIVE with promotion unchanged, and its inputs/results are persisted in `activation-roundtrip-evidence.json` and independently replayed.

First execution wrote 108 immutable records. Repetition wrote **zero new records**, reused all 108 and preserved record hashes. Economic/diagnostic artifacts and eight PNG charts were byte-identical across repeated runs (239 compared files). Telemetry/log timestamps are excluded from economic identity. Content-hash tampering, changed code and attempts to replace a prior decision are rejected. No daily scheduler is implied by the rolling estimator.

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
| 01 | PROMOTED / ACTIVE / ALLOCATED remain distinct | PASS | tests 01–03, 22, 37, 65; activation-results.csv |
| 02 | Correlation estimates are point-in-time | PASS | tests 09 (63/126/252), 19, 44, 54, 55, 62; independent NumPy oracle |
| 03 | Dynamic clusters are causal | PASS | tests 11, 19, 30, 31, 57; independent SciPy linkage replay |
| 04 | Same-asset strategies remain distinct | PASS | tests 05–08, 33; underlying-concentration.csv |
| 05 | Cross-market same-family diversification is preserved | PASS | tests 04, 15, 53; family diagnostics |
| 06 | Correlation never automatically retires | PASS | tests 03, 06, 30, 65; unchanged promotion states |
| 07 | Representative selection is explicit and deterministic | PASS | test 13 (five selectors), 14, 51, 52 |
| 08 | Strategy and underlying diversification remain distinct | PASS | tests 10, 32–35; NumPy eigen/PCA and HHI oracle |
| 09 | No allocation or RiskMandate mutation | PASS | tests 02, 36, 37, 64; static runtime import/call boundary |
| 10 | Future data cannot rewrite historical active sets | PASS | tests 19–21, 26, 43–45, 54, 55 |
| 11 | Clustering and input-order reproducibility | PASS | tests 12, 13, 38, 57; reproducibility.json; hash-verification.json |
| 12 | Historical replay valid or explicitly blocked | PASS | BLOCKED_MISSING_STRATEGY_HISTORY; blockers.csv; AL05 frozen artifact evidence |
| 13 | Independent known-answer verification | PASS | 71/71 TS cases; 544/544 NumPy/SciPy/storage/preservation checks |
| 14 | Strict typecheck | PASS | typecheck-certification.log; exit 0; all new TS and imported certified dependencies |
| 15 | git diff --check | PASS | diff-check.log; exit 0; additional new-source whitespace checks |
| 16 | Previous baselines unchanged | PASS | preservation.json: 9031 frozen files byte-identical; original branch/commit/status retained |

## New files and outputs

- `research/bank/adapters.ts`
- `research/bank/bank.test.ts`
- `research/bank/cli.ts`
- `research/bank/contracts.ts`
- `research/bank/engine.ts`
- `research/bank/finalize.py`
- `research/bank/fixtures.ts`
- `research/bank/independent.py`
- `research/bank/render.py`
- `research/bank/statistics.ts`
- `research/bank/storage.ts`
- `research/bank/validation.ts`
- `research/bank/verify-hashes.mjs`

Reports: `reports/BANK01_active_set.md`, `reports/BANK01_methodology.md`, and `reports/bank01/` with required CSVs, correlation matrices, immutable records, manifests, checkpoints, full test/independent verification, reproducibility/resume evidence and eight charts. Prior baseline source is read/imported only; no production adapter is introduced.

## Executed commands and exit codes

Commands below are recorded verbatim as argument arrays in `commands.json`. The initial failing fixture run is preserved separately; its shell batch ended after printing the log, so that batch's exit 0 does not certify its failing cases. The explicit handoff regression returned exit 1 as recorded. All final certification commands returned 0. Existing installed dependencies were reused; no manifest/lockfile change or reinstall.

| Command | Exit | Log |
| --- | --- | --- |
| `./artifacts/api-server/node_modules/.bin/esbuild research/bank/bank.test.ts research/bank/cli.ts --bundle --platform=node --format=esm --packages=external --metafile=reports/bank01/build-metafile.json --outdir=artifacts/api-server/dist/bank01 --out-extension:.js=.mjs` | 0 | `reports/bank01/build.log` |
| `node artifacts/api-server/dist/bank01/bank.test.mjs reports/bank01/test-results.json` | 0 | `reports/bank01/tests.log` |
| `./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/bank/adapters.ts research/bank/bank.test.ts research/bank/cli.ts research/bank/contracts.ts research/bank/engine.ts research/bank/fixtures.ts research/bank/statistics.ts research/bank/storage.ts research/bank/validation.ts` | 0 | `reports/bank01/typecheck.log` |
| `node artifacts/api-server/dist/bank01/cli.mjs` | 0 | `reports/bank01/certify.log` |
| `python3 research/bank/independent.py` | 0 | `reports/bank01/independent.log` |
| `node artifacts/api-server/dist/bank01/bank.test.mjs reports/bank01/handoff-regression-before.json` | 1 | `reports/bank01/handoff-regression-before.log` |
| `./artifacts/api-server/node_modules/.bin/esbuild research/bank/bank.test.ts research/bank/cli.ts --bundle --platform=node --format=esm --packages=external --metafile=reports/bank01/build-metafile.json --outdir=artifacts/api-server/dist/bank01 --out-extension:.js=.mjs` | 0 | `reports/bank01/build-final.log` |
| `node artifacts/api-server/dist/bank01/bank.test.mjs reports/bank01/test-results.json` | 0 | `reports/bank01/tests-final.log` |
| `./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/bank/adapters.ts research/bank/bank.test.ts research/bank/cli.ts research/bank/contracts.ts research/bank/engine.ts research/bank/fixtures.ts research/bank/statistics.ts research/bank/storage.ts research/bank/validation.ts` | 0 | `reports/bank01/typecheck-final.log` |
| `node artifacts/api-server/dist/bank01/cli.mjs` | 0 | `reports/bank01/certify-final.log` |
| `python3 research/bank/independent.py` | 0 | `reports/bank01/independent-final.log` |
| `python3 research/bank/render.py` | 0 | `reports/bank01/charts.log` |
| `node artifacts/api-server/dist/bank01/cli.mjs` | 0 | `reports/bank01/certify-repeat.log` |
| `python3 research/bank/render.py` | 0 | `reports/bank01/charts-repeat.log` |
| `node research/bank/verify-hashes.mjs` | 0 | `reports/bank01/hash-verification.log` |
| `git diff --check` | 0 | `reports/bank01/diff-check.log` |
| `./artifacts/api-server/node_modules/.bin/esbuild research/bank/bank.test.ts research/bank/cli.ts --bundle --platform=node --format=esm --packages=external --metafile=reports/bank01/build-metafile.json --outdir=artifacts/api-server/dist/bank01 --out-extension:.js=.mjs` | 0 | `reports/bank01/build-certification.log` |
| `node artifacts/api-server/dist/bank01/bank.test.mjs reports/bank01/test-results.json` | 0 | `reports/bank01/tests-certification.log` |
| `./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/bank/adapters.ts research/bank/bank.test.ts research/bank/cli.ts research/bank/contracts.ts research/bank/engine.ts research/bank/fixtures.ts research/bank/statistics.ts research/bank/storage.ts research/bank/validation.ts` | 0 | `reports/bank01/typecheck-certification.log` |
| `node artifacts/api-server/dist/bank01/cli.mjs` | 0 | `reports/bank01/certification.log` |
| `python3 research/bank/independent.py` | 0 | `reports/bank01/independent-certification.log` |
| `python3 research/bank/render.py` | 0 | `reports/bank01/charts-certification.log` |
| `node artifacts/api-server/dist/bank01/cli.mjs` | 0 | `reports/bank01/certification-resume.log` |
| `python3 research/bank/render.py` | 0 | `reports/bank01/charts-reproducibility.log` |
| `node research/bank/verify-hashes.mjs` | 0 | `reports/bank01/hash-certification.log` |
| `git diff --check` | 0 | `reports/bank01/diff-check.log` |
| `git diff --check` | 0 | `reports/bank01/diff-check.log` |
| `node research/bank/verify-hashes.mjs` | 0 | `reports/bank01/hash-certification.log` |
| `python3 research/bank/finalize.py` | 0 | `reports/bank01/finalization.log` |

## Final cases

| Case | Result |
| --- | --- |
| 01 PROMOTED does not imply ACTIVE: explicit cluster policy | PASS |
| 02 ACTIVE does not mean ALLOCATED: result contains IDs and no capital decisions | PASS |
| 03 high correlation default retains five promoted strategies; no retirement | PASS |
| 04 same-family cross-market low-correlation streams remain active | PASS |
| 05 same-asset streams are distinct; underlying and strategy counts separate | PASS |
| 06 negatively correlated same-asset P&L remains distinct; no positive-rho pruning | PASS |
| 07 exact duplicate economics rejected despite distinct labels | PASS |
| 08 explicitly separate execution sleeves permit duplicate economic identity | PASS |
| 09 rolling 63 exact sessions and sample covariance independent oracle | PASS |
| 09 rolling 126 exact sessions and sample covariance independent oracle | PASS |
| 09 rolling 252 exact sessions and sample covariance independent oracle | PASS |
| 10 exact orthogonal sample: covariance, rank, PC1, reference variance | PASS |
| 11 single vs complete vs average linkage known connected chain | PASS |
| 12 clustering invariant to input ordering and stable IDs | PASS |
| 13 deterministic representative LEXICOGRAPHIC_POLICY | PASS |
| 13 deterministic representative BEST_FROZEN_RESEARCH_SCORE | PASS |
| 13 deterministic representative HIGHEST_PSR_FROM_PROMOTION_EVIDENCE | PASS |
| 13 deterministic representative LOWEST_TURNOVER | PASS |
| 13 deterministic representative LOWEST_CORRELATION_TO_ACTIVE_SET | PASS |
| 14 missing frozen selector evidence => INSUFFICIENT_DATA, no lexicographic fallback | PASS |
| 15 family/underlying/total caps operate on strategy IDs, not combined returns | PASS |
| 16 explicit pairwise rho and marginal rank restrictions only | PASS |
| 17 missing observations explicit; no imputation/pairwise inconsistent covariance | PASS |
| 18 zero variance undefined correlation: no epsilon or invented rho | PASS |
| 19 no full-sample covariance: future mutation leaves full artifact unchanged | PASS |
| 20 future retirement/promotion/suspension cannot rewrite historical set | PASS |
| 21 delayed publication of past-effective suspension stays unavailable | PASS |
| 22 retired/suspended/manual-hold/not-promoted/expired reasons explicit | PASS |
| 23 missing/future strategy version cannot enter active set | PASS |
| 24 regime eligibility and missing regime are explicit | PASS |
| 25 preferred regime is diagnostic only; no hidden restriction | PASS |
| 26 future regime and evidence mutation cannot change past choice | PASS |
| 27 mandatory signal gate fail/missing/stale prevents activation, no fallback | PASS |
| 28 SIGNAL separate from strategy; scores never enter correlation | PASS |
| 29 signal-score return units and mixed dollar/P&L conventions rejected | PASS |
| 30 temporal changing clusters and exit/re-entry retain promotion | PASS |
| 31 crisis correlation spike observable causally | PASS |
| 32 marginal independent orthogonal rank oracle before/after | PASS |
| 33 signed map diagnostic never creates cash or normalizes internal capital | PASS |
| 34 certified asset-risk artifact supplies separate implementation PCA bets | PASS |
| 35 beta/factor/sector similarity diagnostic cannot prune | PASS |
| 36 allocator handoff rejects inactive streams; no axis/constraint rewriting | PASS |
| 37 RiskMandate/allocations/cash input rejected and upstream objects not mutated | PASS |
| 38 same frozen input => exact immutable IDs/hash | PASS |
| 39 resume and interrupted sequence => zero duplicate records | PASS |
| 40 tampered artifact/journal rejected, never silently reused | PASS |
| 41 immutable history refuses replacement after relevant input or code change | PASS |
| 42 real scope refuses unverified external QA promotion | PASS |
| 43 future map/beta/risk/signal artifacts cannot change past artifact | PASS |
| 44 mutation inside correlation window changes relevant artifact | PASS |
| 45 future entry/return arrival cannot affect historical universe | PASS |
| 46 NaN/Infinity visible returns rejected explicitly | PASS |
| 47 stale returns distinguish DATA from insufficient history | PASS |
| 48 zero policy cap explicitly deactivates all without retirement or fallback | PASS |
| 49 unsupported policy, hidden cash target, ambiguous snapshot rejected | PASS |
| 50 incomplete optional correlation leaves eligible entries active with explicit coverage | PASS |
| 51 two equal frozen scores break ties by strategy ID exactly | PASS |
| 52 evidence created after promotion cannot replace frozen research score | PASS |
| 53 same family has no hidden penalty outside declared caps | PASS |
| 54 historical session calendar ignores appended future sessions | PASS |
| 55 strategy returns with delayed availability excluded before statistics | PASS |
| 56 global required signal gate and allowed-regime policy are explicit | PASS |
| 57 model linkage ties invariant under permuted covariance axes | PASS |
| 58 empty eligible bank gives immutable empty set without invented fallback | PASS |
| 59 PIT cutoff after decision rejected; inconsistent artifact metadata rejected | PASS |
| 60 certified PIPE02 unpromoted state is consumed read-only, never self-promotes | PASS |
| 61 unversioned/mismatching history cannot substitute current strategy data | PASS |
| 62 no in-window deletion masked by minimum observations | PASS |
| 63 non-PSD implementation covariance rejected explicitly | PASS |
| 64 AL05 bundle cannot retain inactive IDs on covariance/forecast axes | PASS |
| 65 full activation round trip: ACTIVE then INACTIVE then ACTIVE; promotion unchanged | PASS |
