# AL-07 — Allocation Research Engine v1

AL-07 mechanical certification: **PASS**, scoped to the supplied canonical artifacts and the isolated research engine. Version `allocation-research-1.0.1`. No production PIPE, production decisions, UI, new financial model, optimizer mathematics, signal or forecast was introduced. Missing historical μ, factor and strategy bundles remain **BLOCKED**, not successful simulations. This is an infrastructure acceptance experiment, not a discovery of alpha.

The implementation is under `research/allocation/`. It imports certified AL-03/04/05 allocators, AL-06 gates, AL-01 ExposureController, AL-02 attribution, and the corrected `runBacktestEngine`. CRE fold/search/storage utilities are reused read-only. No certified implementation was edited.

## Architecture and identity

A canonical candidate contains allocation mode, objective/parameters, constraints, risk/expected-return/factor-target/strategy-universe references, both gate policies, independent clocks, estimation settings, cost assumptions, RiskMandate reference and model/config hashes. IDs are the full SHA256 of canonical JSON: `are_<hash>`. Every economic leaf and irrelevant object-key reordering are tested. Candidate identity and campaign data/code identities are distinct: changing future observations does not regenerate already-declared candidates.

GRID enumerates the Cartesian product, requires explicit reduction indices above budget, and rejects duplicate definitions. RANDOM_REPRODUCIBLE requires a seed and samples without replacement using the certified CRE generator. Budget defaults to 200, with an explicit hard maximum in 1–200. Job guards are declared before performance. `DRY_RUN` and `EXECUTE` are explicit modes; execution requires a matching saved dry-run. Dry-run performs no allocator evaluation or backtest. The CLI rejects ambiguous execution flags.

All candidates in one allocator comparison must share the same declared RiskMandate reference. Neither candidate construction nor allocation chooses global cash. A decision reconstructs its exact dated canonical source, model/universe availability, carried risky-sleeve holdings, signal quality when required, certified allocation, certified local sensitivity, portfolio robustness, upstream mandate and final projection. Allocation q is computed once for a job/decision and reused by its raw and normalized books. Execution quantities change only at fills. Both tracks use the existing accounting engine, strict prior-close signals, next-close fills, entry costs and no terminal liquidation.

A source adapter must provide one unambiguous canonical bundle per risk reference/decision date with complete native axes, units, versions and provenance. This release consumes externally supplied artifacts; it does not fit replacement models or infer historical expected returns. Historical ASSETS inputs are available; other historical economic paths remain blocked where required inputs are absent. Factor/strategy routing is mechanically tested using previously certified synthetic inputs.

## Walk-forward and clocks

Traditional evaluates candidates on the outer train/search interval, freezes the selected ID and evaluates the following outer OOS block. Nested compares only the aggregated inner validation ledgers and freezes selection before any outer execution. `selectionOnly` rejects outer jobs, outer prices, snapshot stores and any return date beyond the permitted train cutoff. Outer hashes are not passed into that interface. Selection JSON is durable before outer evaluation.

Rolling removes old selection/evaluation intervals; expanding keeps the original training start. Outer/inner train, test and step clocks are independent. Overlapping OOS intervals are rejected; gaps remain gaps. Signal, rebalance, risk/forecast recalibration and gate clocks are separately declared. Recalibration during traditional training selects already-supplied PIT model artifacts; no model is fitted by ARE. Each inner validation/outer test freezes risk and forecast artifacts available before its train end. Previously observed benchmark history remains available for inherited drawdown state; a 252-session risk-estimation warmup can precede the search-window start. These are separate information sets, not extra training performance rows.

AL-03 requires a common decision-information envelope for covariance/beta inputs. ARE republishes unchanged supplied model values at the decision cutoff, retaining the original artifact, hash, actual observation window and cutoff in `Decision.model_reference`. No observations or fitted coefficients are added. Original native inputs are validated **before** republication, so future/inconsistent source metadata cannot be masked. The updated envelope is not a new fit or independent contemporaneous publication record.

## Gates, selection and costs

SignalQualityGate runs at the declared allocation decisions where required. Nonforecast acceptance objectives have the explicit exemption `NONFORECAST_OBJECTIVES`; no signal is consumed. Required-signal synthetic campaigns prove PASS/FAIL and no bypass. The canonical signal methodology is AL-06's new `CANONICAL_SIGNAL_STRUCTURE_1.0.0`; legacy Node-3 equivalence remains uncertified because its original source is unavailable.

PortfolioRobustnessGate PASS is mandatory at every relevant decision. Invalid input, solver failure, missing risk/sensitivity, incompatible controller, unauthorized clipping and policy failures cannot be averaged away or replaced by fallback. The selector also rejects a forged VALID job whose mandatory gate did not PASS. Gate results, source allocations, failed stresses and failure reasons remain persisted.

Selectors are explicitly versioned: SHARPE, SORTINO, CAGR, MAX_DRAWDOWN_ADJUSTED, CAPM_ALPHA, UTILITY_RETURN_MINUS_RISK and MULTI_METRIC_LEXICOGRAPHIC. Sharpe uses daily excess returns and sample standard deviation; Sortino uses the full-sample RMS of negative daily excess returns, annualized by sqrt(252). Drawdown-adjusted return is CAGR/abs(MaxDD), undefined when DD is zero. Utility is CAGR minus the declared aversion times annual volatility squared. Lexicographic priorities/directions and optional economic hurdles are fixed before execution. Null/unidentified primary metrics cannot win. No universal alpha hurdle or weighted quality score is hidden.

The acceptance selector is normalized net SHARPE at **5bps**, declared before observing performance. Hurdles are empty. Costs are research assumptions: 0 and 5bps times actual absolute instrument trade notional, additional slippage zero. Ledger fees, cash, positions and NAV independently reconcile. Cash yield and risk-free reference are both the frozen **constant zero research assumption**: these experiments do not certify historical cash-yield performance. Strategy internal NET costs are not recharged. Strategy economic execution requires genuine external unit-NAV paths and certified PIT map history; master costs without actual instrument notional are explicitly blocked. Signed/non-net-one implementation is outside the present long-only controller and is never converted into `cash=1-net`.

## Acceptance campaign and results

Both real campaigns use the frozen CL-02 adjusted closes and AL-03 supplied 252-session risk/beta artifacts. Search dates: **2018-01-01 to 2022-01-01 exclusive**; outer OOS: **2020 and 2021**. Traditional uses expanding training, nested uses rolling training. Outer train/test/step: 24/12/12 months; nested inner: 12/6/6 months. Rebalance monthly; target market beta **0.30** from the existing AL-03 mandate. No parameters, gates or costs were changed after observing results.

| Campaign | Configurations | Outer / inner folds | Attempts | VALID | BLOCKED | Certified-run backtests |
|---|---:|---:|---:|---:|---:|---:|
| Traditional expanding | 7 | 2 / 0 | 40 | 16 | 24 | 32 |
| Nested rolling | 7 | 2 / 4 | 68 | 28 | 40 | 56 |

Evaluable: EQUAL_WEIGHT, MIN_VARIANCE, ERC. Blocked: MEAN_VARIANCE/MAX_SHARPE (`BLOCKED_MISSING_PIT_EXPECTED_RETURNS`), FACTORS (`BLOCKED_MISSING_FACTOR_ARTIFACTS`) and STRATEGY_STREAMS (`BLOCKED_MISSING_STRATEGY_ARTIFACTS`). The missing factor neutral and strategy equal-capital controls are retained as blocked controls; equal-weight is the live asset control. Zero gate/solver failures occurred in the final real campaigns under the fixed **permissive QA policies**, not an institutional investment recommendation.

The candidate registry and data snapshot hashes are identical across protocols. Both procedurally selected Equal Weight in both outer folds, so their outer curves agree. This agreement is a consistency result, not a declaration of an economic winner. Unselected outer candidate performance was not calculated or fed back into selection.

| Selected outer-OOS track, both protocols | Cost | CAGR | Volatility | MaxDD | Full realized beta | Net daily-excess Sharpe |
|---|---:|---:|---:|---:|---:|---:|
| Raw risky sleeve | 0bps | 26.20% | 25.13% | -30.65% | 0.974 | 1.051 |
| Normalized final portfolio | 0bps | 7.64% | 6.97% | -9.27% | 0.269 | 1.090 |
| Raw risky sleeve | 5bps | 26.12% | 25.13% | -30.65% | 0.974 | 1.049 |
| Normalized final portfolio | 5bps | 7.62% | 6.97% | -9.27% | 0.269 | 1.087 |

Normalization reduces systematic exposure and realized risk/return. Expected PIT target beta and realized forward/full beta are different; realized 0.269 is not silently relabelled 0.30. Positive CAPM residual estimates remain descriptive regression outputs, with HAC t-statistics, not proof of robust alpha. The sample was previously inspected in earlier blocks and is not a new holdout.

AL-02 supplies full/rolling63/126/conditional DD5/10/20/tailQ5/Q1 betas, captures, CAPM/HAC (lag 5), Treynor-Mazuy/HAC, CAGR, vol, DD and CVaR95. Pooled curves compound **only outer daily returns** from independent NAV100/cash sleeves; this research index is not a continuous live account. Calendar CAGR follows AL-02, including elapsed calendar gaps without inserting fabricated returns. Per-fold metrics and min/max/median/dispersion/positive/control-beating fractions remain visible; beta magnitude has no universal best/worst ordering.

Declared retrospective same-average-beta and same-volatility SPY references are frictionless daily diagnostics, not executable ex ante strategies. They do not affect selection or replace the equal-weight control. Their zero reference fees differ from a 5bps execution scenario and are labelled. Return-decay and cross-sectional APIs require meaningful canonical signal/ranking timestamps; acceptance rows are NOT_APPLICABLE rather than invented alpha/deciles. Empirical response tables contain actual evaluated stages and failed/blocked holes without interpolation; the acceptance dimension is categorical objective, not a gamma/forecast grid.

## PSR, persistence and independent replay

PSR methodology `probabilistic-sharpe-1.0.0` uses daily observed Sharpe S, annual benchmark Sharpe divided by sqrt(252), n observations, population-central-moment skewness g3 and non-excess kurtosis g4:

`PSR = Phi((S-S0)*sqrt(n-1) / sqrt(1-g3*S + (g4-1)*S^2/4))`.

Sharpe's standard deviation is sample/ddof1. Skew/kurtosis are uncorrected standardized central moments. The normal CDF uses Abramowitz–Stegun 26.2.17, error bound 7.5e-8. Independent NumPy/SciPy known-answer checks include zero/symmetric probability 0.5, a nonzero benchmark and degenerate inputs. PSR assumes IID/stationarity/finite fourth moment and is a diagnostic; no autocorrelation/multiple-testing correction or promotion rule is invented. **DSR = NOT_IMPLEMENTED**.

Campaign config/candidates/data/code/folds/clocks/gate policies/costs/selection are frozen before execution. Start/end times and invocation counters are separate telemetry. Jobs persist by candidate/outer/inner/stage/scenario with checksums; pending IDs and selection dependencies survive interruption. Failed/blocked completed attempts remain completed. Resume validates config, scoped historical identity and checksums and reruns only pending work. Whole-campaign snapshot/config changes are rejected for same-directory resume; historical computation cache keys are scoped and do not contain unrelated future data. Cache identity includes runtime code, input/config/provenance/cutoffs and native result-affecting values. Corrupt entries are rejected.

Final evidence: **30/30 tests**, no skipped; **96 independent replay bundles/checks** and **1,713 independent serialization/checksum checks**. Independent Python reconstructs covariance/beta from original prices, allocator conditions, costs/cash/NAV/P&L, AL-02 metrics/conditional/rolling/capture/HAC/PSR, winners from saved inner/train ledgers and outer composite summaries without invoking ARE or its selector. Repeating both campaigns creates **0 new jobs / 0 backtests**; **124 completed-job/economic-output hashes** stay byte-identical. A real pause after one blocked attempt and synthetic pauses after 0/1/mid/last-before-summary jobs are retained.

## Retained failures and scope

Initial tests exposed the common-cutoff envelope mismatch and then the native `information_cutoff <= as_of` invariant. The research adapter now creates an explicit publication envelope and preserves the original observation window. Initial 15 PASS/4 FAIL runs are retained; the affected expectations were not weakened. A later assertion originally checked publication-envelope date instead of actual model training date; it now checks the stored original cutoff and requires a non-null winner/changed outer returns, preserving the intended leakage test.

An independent new future-metadata regression deliberately produced **28 PASS / 1 FAIL**: the envelope could mask a future original model date. Version 1.0.1 adds the original native-input validation before republication, signal/root temporal guards and a signal cache key based on its actual PIT information hash. The FAIL reproduction remains. Pre-guard source/campaign results are preserved under `reports/al07/pre-source-validation/`; changing code invalidates execution identity, so both bounded campaigns were rerun explicitly. Their economic summaries agree byte-for-byte before/after on the genuine supplied inputs. These reruns are distinct code-validation experiments, not resume duplicates. The final certified campaigns execute 88 backtests; the retained pre-guard campaigns also executed 88.

A validator export-name compile error, an initial esbuild path error and an independent Python path-join error are preserved in logs; they were corrected without changes to production or tolerances. No failed case was omitted. All source modifications are new research files.

Limitations: no new decision-model fitting interface in this version (supplied artifacts only); incomplete historical μ/factor/strategy inputs; no real signal-gate history replay; no signed-financing execution controller; no invented master-cost notionals; no DSR/statistical-significance guarantee; fixed ETF list/vintage/dividend/survivorship assumptions inherited from CL-02/AL-03; QA thresholds and two outer folds do not establish economic robustness. No HMM, Markov, new signal/strategy or end-to-end production PIPE was opened.

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1. Traditional WF | PASS | Exact boundary tests, real expanding campaign |
| 2. Nested WF | PASS | Inner-only rankings, persisted selection before outer jobs |
| 3. Rolling / expanding | PASS | Fold oracle, separate inner override, real configurations |
| 4. Deterministic/reproducible search | PASS | GRID and seeded RANDOM, key-order/economic-leaf tests |
| 5. Candidate budget | PASS | 1/2/10/50/100/200 and explicit reduction/guard tests |
| 6. No outer-OOS leakage | PASS | Selector rejects outer data/hashes; mutation trap; original-source regression |
| 7. Gates preserved | PASS | Required signal PASS/FAIL, no fallback, forged VALID rejection, AL-06 imports |
| 8. Raw + normalized tracks | PASS | Same q; independent ledgers; shared unchanged mandate |
| 9. AL-02 attribution | PASS | Imported analytics and independent NumPy/SciPy replay |
| 10. Missing artifacts blocked | PASS | Four blocked configurations retained per campaign |
| 11. Cache / resume | PASS | Corrupt cache rejection, scoped mutation, pauses, 0 duplicate jobs/backtests |
| 12. PSR oracle | PASS | Independent SciPy equation/CDF checks; DSR explicitly absent |
| 13. Real acceptance | PASS | Both protocols completed, no economic-winner claim |
| 14. Strict typecheck | PASS | Isolated research and transitive TypeScript dependencies; exit 0 |
| 15. git diff --check | PASS | Tracked and new-source whitespace checks |
| 16. Baselines intact | PASS | 3,267 pre-existing SHA256 matches; branch/commit unchanged |

Machine status: `reports/al07/verification.json`. Case-level tests, commands/exit codes, source patch, registry, failures, independently verified results, immutable source inputs, charts and provenance are included in **`reports/AL07_reports.zip`**. No production PIPE follows this closure.
