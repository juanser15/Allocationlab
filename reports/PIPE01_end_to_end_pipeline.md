# PIPE-01 — Canonical End-to-End Research Pipeline Certification

**PASS — mechanical research certification**, version `canonical-research-pipeline-1.0.2`. No financial model, optimizer, signal, strategy, forecast, gate, selection rule or production decision was added. No alpha or economic-winner claim. PIPE-02 is not opened.

Repository: `juanser15/Allocationlab`, `/workspace/Allocationlab`, branch `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. The existing dirty calculator and all prior untracked work were preserved. `reports/pipe01/checkpoint.json` froze **6,940 existing files**, branch, commit and status before edits. `preservation.json` verifies all 6,940 hashes unchanged, including CL-01/02/03/04, CRE, AL-01 through AL-07, calculator, B1/B2/B3, routes, UI, DB, manifests and lockfiles. No reset, checkout, push, merge, deploy or production-service access occurred. Existing dependencies and the DB test shim were reused.

## Canonical flow and identity

New code is isolated under `research/pipeline/`. Contracts, decision orchestration, accounting adapter, frozen-data adapter, fixtures, tests, independent verifier and exporters are separate files. Production and certified mathematics remain unchanged.

`DecisionContext -> RiskMandate -> SignalQualityGate -> allocator -> sleeve risk -> PortfolioRobustnessGate -> ExposureController -> FinalPortfolioTarget -> research execution -> accounting/AL02 attribution`.

Every stage carries the same `decision_context_id`. Context identity binds the decision date, strict prior-close cutoff, execution date/convention, eligible universe, previous risky holdings, persisted selected candidate and selection-file hash, native artifact hashes, both candidate gate policies, RiskMandate, costs and the actual historical price information set. Key-order canonicalization is inherited from AL-01. No stage can advance the cutoff or replace the selected candidate, policy, scenario or native holdings/universe. Supplied future ranking snapshots are excluded from historical identity and evaluation; future root/native metadata is rejected rather than republished.

Each successful canonical context has ten ordered stage records. No required failure creates a target or fallback. Required signal gate states retain PASS/FAIL/INSUFFICIENT_DATA/INVALID_INPUT/NUMERICAL_FAILURE. `NOT_REQUIRED` needs an explicit nonforecast exemption, no consumed signal and candidate consistency. MEAN_VARIANCE/MAX_SHARPE cannot use that exemption. Required signal coverage must cover the tradable decision universe. Gate dates are declared allocation dates, not an implicit daily clock.

Routing is exclusively ASSETS -> AL-03, FACTORS -> AL-04, STRATEGY_STREAMS -> AL-05. Native modules own all optimization, mapping, risk calculations and numerical tolerances. AL-06 evaluates signal structure and portfolio robustness. The only final exposure composition is AL-01 `composeMandatedPortfolio`. AL-02 supplies realized metrics and regression attribution through the unchanged AL-07 analytics adapter. No selector, candidate generation or fitting routine is invoked by PIPE-01.

The native allocators already attach their certified risk diagnostics. The separate SLEEVE_RISK stage validates and references that exact unscaled sleeve, asset betas, beta model/window/cutoff/hash, covariance-derived volatility and risk provenance; it does not fit a replacement estimator or overwrite q. Missing compatible risk/projection stops promotion explicitly. The original AL-07 training-only model reference is retained in the bundle identity, with original fields available in the frozen selected decision. Its unchanged covariance and beta window remain visible in native inputs.

## Units, cash and failure behavior

Allocator q/strategy allocations remain fractions of risky-sleeve capital. Asset/factor q is long-only/net-one; compatible strategy H*a is checked by AL-05/AL-06. The controller alone produces `lambda*q` in final NAV units, implied implementation cash and expected final risk. `expected_beta = lambda*beta_sleeve`; beta is never inferred from the sum of weights. Final targets bind the context, mandate hash, allocation, robustness gate, composition, exact weights/cash, expected risk, gross/net, execution and provenance.

Stream internal residual, unallocated mapping residual and signed financing are not global cash. A strategy allocation can be valid yet lack a controller-compatible projection; PIPE-01 records MISSING_SLEEVE_RISK and creates no executable target. Signed financing remains outside the primary controller. There is no master-cash field or downstream cash override. Unknown context cash targets are rejected. Gates cannot modify allocations or mandates; post-gate target/stage tampering is rejected by the execution adapter.

Specific persisted failure states include missing artifacts, signal-gate failures by reason/status, allocation infeasibility/input/numerical/insufficient-data errors, missing sleeve risk, robustness failure, exposure infeasibility, execution failure and accounting failure. `negative-fixtures.json` retains **16 synthetic expected rejections**, including their stage traces; these are distinguished from real replay failures in `failure-summary.csv`. Failed completed decisions/books remain durable. No equal-weight, old-portfolio or extra-cash fallback exists.

AL-06 already calls the certified controller as a **feasibility diagnostic** inside robustness. Consequently an impossible beta request is rejected at ROBUSTNESS_GATE/TARGET_RISK_FEASIBILITY before the pipeline controller stage. PIPE-01 preserves that earlier rejection instead of weakening AL-06 to force a later EXPOSURE_INFEASIBLE. The exposure stage is still guarded independently. Diagnostic composition inside AL-06 is not an executable target/promotion.

## Real selected AL-07 replay

The replay consumes only persisted outer selections and selected outer jobs from:

- `AL07_REAL_NESTED_ROLLING`;
- `AL07_REAL_TRADITIONAL_EXPANDING`.

Original sources remain the frozen AL-03 PIT inputs/mandates and CL-02 adjusted closes, with their original vendor, dividend, availability, vintage and survivorship limitations. No new data, forecasts or factor/strategy history was invented. Outer OOS dates are **2020 and 2021**, previously inspected periods rather than a new holdout. Both frozen protocols selected EQUAL_WEIGHT in both outer folds; PIPE-01 verifies those identities and never reranks candidates.

Protocol is unchanged: monthly rebalance; `next_close`; callback rows strictly `< signalDate`; training-only supplied risk artifacts frozen inside each outer sleeve; SPY benchmark; target market beta 0.30; NAV100/cash at each outer-fold start; 0/5bps on actual absolute traded instrument notional; zero additional slippage; constant-zero cash yield and risk-free reference; no terminal liquidation. Quantities are maintained between fills. Cash-yield results remain a zero-yield research diagnostic, not a historical cash-yield certification.

| Replay evidence | Result |
|---|---:|
| Frozen selected outer jobs | 8 |
| RAW / normalized execution books | 16 |
| Unique immutable decision contexts | 96 |
| Canonical final decision rows / targets | 96 / 96 |
| Canonical stage rows | 960 |
| Separate RAW diagnostic decision views | 96 |
| Daily execution/accounting rows across both tracks/protocols/scenarios | 4,040 |
| Exact replay comparisons | 208 PASS / 0 FAIL |
| Real replay stage/accounting failures | 0 |
| Candidate search / selection reruns | 0 |

The 208 checks comprise 16 exact full-ledger comparisons and 192 per-book decision comparisons across both tracks. They verify selected ID, full native allocation, q, mandate, lambda, final weights, complete composition, expected risk and robustness output. Exact ledger hashes include every trade, quantity, fee, NAV and return-driving P&L field. No tolerance masks a semantic mismatch. The independent verifier additionally checks the complete AL-02 attribution and metrics against frozen AL-07 objects by exact decoded-JSON equality.

RAW books are **diagnostic sidecars**, not final-target execution/promotion. `final-targets.csv` and `decision-ledger.csv` contain one NORMALIZED row per context, with raw return/risk columns where relevant. `*-tracks.csv`, `raw-diagnostic-stages.jsonl`, execution ledgers and risk reconciliation retain both views. Canonical stages include normalized execution/accounting only. `finalize.py` deterministically separates these audit views without recalculating performance.

Independent outer sleeves are retained. Their concatenated returns form a **research index, not a continuous live account**. Entry fees are charged again at each independent fold; there is no terminal liquidation or carry into the next fold. The replay reproduces the frozen expected/realized exposure differences and does not reinterpret lower beta or smaller drawdown as alpha.

## Accounting and independent verification

Research execution calls the actual corrected `runBacktestEngine`, with explicit targets, `d5GrossTradeCosts=true`, shorting disabled and no binding turnover cap. Complete price rows remain available for valuation/fills; only the decision information set is filtered. Before execution the adapter checks context, stage, target, allocation/gate and risk-sleeve identities against the frozen request.

For every ledger row, reconciliation checks NAV=cash+position value; cash plus interest minus signed trade notional/fees; ETF and cash P&L; NAV change; position quantities; fill notional; NAV continuity; no shorts/leverage; fees=absolute actual notional*bps. Tolerance is **1e-9 absolute NAV100 currency**, not a parameter-selection tolerance. Known-answer oracle fixtures use **1e-12** for arithmetic comparisons. Frozen replay comparisons use exact hashes/objects.

For a first purchase with risky fraction lambda and cost rate c, the existing engine targets **post-cost NAV**, so the independent closed-form oracle is `NAV_after=100/(1+c*lambda)`, not `100-100*c*lambda`. `independent.py` reconstructs general rebalance fills with an independent **piecewise-linear sign-interval solution** of `A + c*sum(abs(q_i*A-old_market_value_i)) = NAV_before`, not the engine's 80-step bisection. It then rebuilds holdings/cash/P&L and recalculates CAGR/calendar days, annualized sample volatility, MaxDD, CVaR95, final index and realized beta using NumPy. No TS pipeline, optimizer, gate or selector is called by that verifier.

**20/20 independent blocks PASS**: 16 real books, three synthetic mode paths and persistence/source checks. Exact selected-candidate and source-file identity checks supplement the independent accounting/metric oracle. JSON round-trip, CSV RFC4180 column counts, stage/context referential consistency and no duplicate canonical IDs pass.

Expected PIT beta/vol and realized forward beta/vol have separate columns. Forward risk uses ledger return pairs **strictly after the fill and strictly before the next fill**; sample length/status are recorded. It is a descriptive short-period realized estimate, not a target or a new prediction. Period return uses fill-inclusive/next-fill-exclusive ledger intervals and can contain carried-book P&L on the fill date; this convention is explicit rather than attributed silently to new positions. Both `realized_beta-target_beta` and `realized_beta-expected_beta` are reported for final portfolios. Realized estimators never feed back into historical decisions.

## Tests, retained failures and hardening

**39/39 tests PASS, 0 failed, 0 skipped**. `test-results.json` lists individual cases A through AH (L has six separate mutation cases). Tests use actual certified functions and the actual accounting engine, not mocked allocators/controllers. They cover all requested A–R cases, complete three-mode execution, all six future mutation traps, actual fill-price mutation, no double cash, compatible versus residual strategy maps, signal PASS/FAIL, constraint/solver-stage propagation, expected versus realized risk, exact known answers, context/target tampering, durable failures, cache integrity and resume. An execution failure emits no later accounting/attribution stage.

Initial evidence is retained, not overwritten:

- `tests-first.log` / `test-results-first.json`: 29 PASS, 2 FAIL; decimal literals incorrectly demanded exact binary equality and the initial entry-cost oracle assumed pre-cost target notionals. The independent oracle was corrected to explicit division and the documented post-cost self-financing equation. The existing 1e-12 numerical assertion was retained; production formulas/tolerances did not change. `tests-second.log` preserves the remaining cost-oracle failure.
- `tests-envelope-before.log` / corresponding JSON: 33 PASS, 4 FAIL. PIPE-01 now binds envelope policies/cost scenarios/holdings/universe to the selected candidate/native input and scopes future ranking observations out of identity/evaluation.
- `tests-cache-before.log`: 37 PASS, 1 FAIL. Durable decision identity now uses the same PIT-scoped bundle, so an unavailable future ranking cannot invalidate a completed historical decision.
- `tests-stage-before.log`: 38 PASS, 1 FAIL. The stage exporter previously emitted ACCOUNTING_ATTRIBUTION after an execution failure. It now stops at failed EXECUTION; no accounting stage is claimed to have run.

All fixes are confined to new PIPE-01 code. Earlier source/economics are archived in `pre-envelope-validation/` and `pre-stage-order-validation/`. Both earlier 16-book runs agreed economically with AL-07; code identity changed, so each final correction was verified using a distinct bounded replay. There were **48 total real book simulations across three code-validation versions**, of which **16 belong to the final certified version**. These are not resume duplicates or selection/cost/parameter experiments. Subsequent same-code resumes execute zero new books.

## Resume, reproducibility and commands

Completed decisions and failed decisions persist by immutable context identity; book results persist by exact request, code and decision identities with checksums. Reuse rejects corrupt state and changed execution identity. The atomic execution unit is **one independent outer-fold book**. A hard process crash inside an uncommitted pure simulation can require recomputing that uncommitted book; no partial fills are published. No committed book is executed twice. This does not claim broker-level transactional recovery or resumable individual fills.

Tests pause after 0/1/mid decisions and one book; a completed run can regenerate a missing summary without execution. The real final replay paused after 12 decisions/one book; resumed with 15 new books/one reused; then repeated with **0 new decisions, 0 new executions, 16 reused books**. All 112 committed decision/book artifacts retain identical economics. Canonical export SHA256 reproducibility is recorded separately in `reproducibility.json`.

Commands and exit codes are retained in `commands.json`. Final commands, all exit 0:

```bash
./artifacts/api-server/node_modules/.bin/esbuild research/pipeline/pipeline.test.ts research/pipeline/cli.ts --bundle --platform=node --format=esm --packages=external --alias:@workspace/db=./artifacts/api-server/src/lib/calculator.a1.db-shim.ts --outdir=artifacts/api-server/dist/pipe01 --out-extension:.js=.mjs
node artifacts/api-server/dist/pipe01/pipeline.test.mjs reports/pipe01
./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict research/pipeline/*.ts
node artifacts/api-server/dist/pipe01/cli.mjs --pause-after-one-book
node artifacts/api-server/dist/pipe01/cli.mjs
python research/pipeline/finalize.py
python research/pipeline/independent.py reports/pipe01
MPLCONFIGDIR=/tmp/pipe01-mpl XDG_CACHE_HOME=/tmp/pipe01-cache python research/pipeline/render.py
git diff --check
```

The CLI does only the frozen selected replay; it has no selection/search execution mode. For canonical exports run `finalize.py` after the CLI. Tests and replay builds use installed dependencies and the existing DB shim; no manifest/lockfile/install change is required. Strict typecheck covers new TS modules and transitive certified imports; it is not a claim that unrelated workspace build targets were newly audited.

## Outputs, matrix and limits

All requested JSONL/CSV ledgers, final targets, accounting/risk reconciliation, failure/blocker tables, exact replay comparisons, resume/reproducibility/independent verification, synthetic complete/negative traces, eight PNG charts and case-level command/test evidence are under `reports/pipe01/`. `verification.json` is the machine-readable acceptance matrix. The source patch and ZIP inventory identify every added file. Download packaging preserves the prior full ZIPs and baselines.

| Criterion | Status | Evidence |
|---|---|---|
| 1. Strict canonical stage order | PASS | A–H, AH; 960 canonical stage rows |
| 2. Upstream semantics unchanged | PASS | S, AC–AE; exact native/gate/composition comparisons |
| 3. One RiskMandate per decision | PASS | I, R, S; immutable context and stage mandate hash |
| 4. No double cash | PASS | J, K; residual/signed incompatibility retained |
| 5. Sleeve q versus final NAV weights | PASS | I; native q and final lambda*q separate |
| 6. Robustness cannot modify q | PASS | G, S, AB; source hashes and post-gate chain checks |
| 7. Expected versus realized risk | PASS | N; risk-reconciliation.csv |
| 8. PIT / no lookahead | PASS | Six L traps, M, X, Y, AF, AG |
| 9. Execution / accounting | PASS | O, W, Z; 4,040 reconciled rows; piecewise-linear oracle |
| 10. Frozen AL-07 ASSETS reconciliation | PASS | 208 exact checks; 16 full ledgers; no selection rerun |
| 11. FACTORS synthetic E2E | PASS | B; exact known q and real accounting |
| 12. STRATEGY_STREAMS synthetic E2E | PASS | C; certified compatible H*a and accounting |
| 13. Resume / idempotence | PASS | P, Q, T, U, AG; real pause/repeat evidence |
| 14. Strict typecheck | PASS | typecheck-delivery.log, exit 0 |
| 15. git diff --check | PASS | diff-check.json; new-file checks too |
| 16. Prior baselines intact | PASS | preservation.json; 6,940 hashes unchanged |

Historical FACTORS and STRATEGY_STREAMS remain blocked for missing canonical PIT bundles; their mechanical tests are explicitly synthetic. No stream timing/P&L is invented from a static position map. Legacy Node-3 source/history remains unavailable; no legacy formula/threshold equivalence is claimed. Real selected nonforecast allocations explicitly use NOT_REQUIRED; a historical required-signal campaign is not certified here. Signed-financing execution is outside scope. Constants and calendars in synthetic fixtures are mathematical controls, not market data. Zero cash yield, two outer years, inherited universe/vendor assumptions and permissive AL-06 QA thresholds do not certify economic robustness, execution realism or alpha. No production routes, UI, optimizer changes or PIPE-02 follow this certification.
