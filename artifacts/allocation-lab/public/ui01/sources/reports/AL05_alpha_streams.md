# AL-05 — Strategy Allocation & Aggregation Engine v1

**PASS — mechanical certification, 15/15 criteria.** Version `strategy-allocation-1.0.1`. Final synthetic tests **83 PASS / 0 FAIL / 0 skipped**; independent NumPy/SciPy verification **162 PASS / 0 FAIL**. Historical economic replay is explicitly **BLOCKED_MISSING_CANONICAL_ALPHA_STREAM_ARTIFACTS**. This certifies the tested mechanics, not profitability, market-timing skill or statistical alpha.

Repository `/workspace/Allocationlab`, `juanser15/Allocationlab`, branch `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`. The initial pending calculator correction and all previous work remain untouched. SHA256 checkpoint and final comparison preserve **3,137 prior files**, including CL-01/02/03/04, CRE, AL-01/02/03/04, production, optimizer implementations, configs, manifests/lockfiles and prior report ZIPs. No reset, checkout, install, network/service access, push, merge, deploy, production adapter or historical backtest.

## Canonical architecture and units

`RiskMandate` remains upstream and unchanged. AL-05 receives externally supplied **StrategyInstances** and solves only `a`, nonnegative fractions of strategy risk capital with `sum(a)=1`. No global cash, final NAV exposure, target beta, multiplier or cash-yield objective exists in its optimization variable or accepted input schema. `AlphaStream` is only a technical compatibility alias and `ALPHA_STREAMS` the existing mode name. Neither asserts Jensen/statistical alpha; residual alpha requires an explicit return model such as the frozen AL-02 CAPM implementation.

Each instance declares instance/family/underlying-universe IDs, underlying IDs, version, canonical parameterization hash and configuration, availability, net per-capital history, optional external forecast, dated unit position map and execution convention. Multiple methods on SPY remain different strategy instances; even perfectly correlated streams are retained. Exact economic duplicates are rejected by canonical identity unless explicitly distinct execution sleeves are declared. Family/underlying grouping never aggregates return columns before optimization.

Historical units are `NET_RETURN_PER_UNIT_CAPITAL` or `NET_PNL_PER_UNIT_CAPITAL`, **daily and per beginning stream capital**, with matching covariance/forecast conventions. Fixed-initial-capital dollar P&L requires an external conversion; AL-05 does not invent one. Gross returns, dollar P&L and signal scores cannot be mixed or relabelled. Covariance is external, finite, symmetric/PSD within explicit numerical tolerances, versioned, hashed and PIT; the optimizer never estimates it. Per-instance forecasts are retained, but μ objectives consume an explicit canonical aggregate expected-return vector. No silent historical-mean substitution.

After allocation, `x=H·a` where H is instrument × strategy and entries are signed instrument exposure per unit allocated stream capital. All instrument/stream contributions are retained. Positive and negative contributions net algebraically; columns are neither normalized nor deduplicated. `pre_net_gross=sum(a_s*sum_i(abs(H_i,s)))`, `post_net_gross=sum(abs(x))`, `post_net_net=sum(x)` and netting benefit reconcile independently.

Three separate funding concepts are maintained:

1. ExposureController **global implementation cash**, only produced downstream.
2. `sum(a_s * internal_residual_s)`, **stream-held internal capital**, never globally redeployed or added to cash.
3. Signed financing/collateral requirements, not inferred from `1-net(x)`.

A fully internal-residual stream can have no current positions without invalidating strategy allocation. Long-only funded maps must reconcile positions plus their explicitly declared internal residual; signed/financing maps need not have net one and are never normalized.

## Solver and two constraint spaces

| Objective | Version / implementation | Required μ |
|---|---|---|
| EQUAL_CAPITAL | 1.0.0, exact equal capital | No |
| MIN_VARIANCE | 1.0.0, `min a′Σa` | No |
| MEAN_VARIANCE | 1.0.0, `max a′μ − gamma/2 a′Σa`, positive explicit gamma | Yes |
| MAX_SHARPE | 1.0.1, explicit daily `rf_stream` | Yes |
| ERC | 1.0.0, equal `a_s(Σa)_s` | No |

Reuses AL-03 `faceQp`, deterministic linear algebra, support enumeration and eigen diagnostics without changing their source. Convex QPs use bounded exhaustive active-face KKT certification. Positive-excess Sharpe uses the exact AL-03 Schaible transformation `y=a/(premium′a)`, minimizing `y′Σy`, `premium′y=1`, with every homogeneous constraint transformed from `Aa>=b` to `(A-b1′)y>=0`; recover `a=y/sum(y)`. For nonpositive excess, the AL-03 triangle-inequality argument gives a feasible-vertex maximum. A positive-return zero-variance feasible support makes finite Sharpe undefined/unbounded and returns INSUFFICIENT_DATA. An infeasible polytope remains INFEASIBLE, not missing data.

ERC uses the same certified convex-log risk-budget coordinate equations as AL-03. Exact ERC and exact equal capital are either feasible under all declared constraints or INFEASIBLE; no constrained approximate ERC or hidden equal-capital fallback. Nonconvergence is NUMERICAL_FAILURE.

Strategy constraints: min/max instance allocations, family caps, underlying-strategy-group caps, max active strategies and gross-L1 strategy turnover. Multi-underlying instances belong once to a declared group if any underlying matches. Previous allocation must be supplied on the declared strategy axis; automatic membership migration is outside this version.

Post-mapping constraints operate **inside the solver on H·a**: absolute instrument caps, net instrument lower/upper limits, sector/group net limits or convex gross upper limits, aggregate post-net gross cap and net range. Gross constraints enumerate signed linear faces, so offsetting positions receive genuine netting and several SPY strategies cannot bypass a SPY cap. A nonzero gross-exposure **floor** is nonconvex and explicitly unsupported, never ignored. Constraints do not contain cash or NAV variables.

Declared defaults: feasibility **1e-10**, stationarity **1e-9**, daily covariance symmetry/PSD **1e-12**, ERC relative contribution **1e-8**, max iterations **10,000**, max faces **100,000**, max supports **4,096**. Workload breaches fail explicitly. A failed feasible support prevents certification of a global cardinality optimum. Within-tolerance covariance asymmetry uses the explicit symmetric part with warning and preserves original hashes; no eigenvalue lift. Small negative allocation roundoff alone may be zeroed, with an additive simplex correction bounded to 2×feasibility tolerance in L1, logged and checked against all original constraints. Positive small weights are not discarded; no exposure scaling. Negative computed portfolio variance fails rather than masquerading as zero volatility.

## Distinct risk, attribution and controller diagnostics

Return-space risk is `a′Σ_strategy a`: expected return when supplied, annualized volatility sqrt(252×variance), MRC, RC, signed RC shares when meaningful, allocation HHI/effective count, covariance entropy effective rank and portfolio PCA entropy risk bets. Correlation/clustering is descriptive (`abs correlation >=0.90`, connected components); zero-variance correlations are null. Nothing is pruned.

Current-position risk uses x and separately supplied instrument covariance/betas. `strategy_return_beta=sum(a_s beta_stream_s)` and `current_position_beta=sum(x_i beta_asset_i)` retain distinct method, benchmark, window, cutoff and model provenance. A frozen-AL-02 PIT diagnostic adapter estimates strategy-return betas by sample Cov/Var over declared 63/126/252 sessions; no epsilon denominator. These diagnostics never drive the allocation objective. Current x risk is not forced to equal historical strategy-return covariance risk.

Diversification distinguishes nominal strategy count, effective capital-allocation count, strategy covariance effective rank, strategy portfolio PCA bets, nominal underlying count, absolute-normalized instrument HHI/effective exposure count, asset covariance effective rank and current-position PCA bets. These are not one “number of bets”; PCA entropy is **not minimum-torsion ENB**, and repeated eigenvalues can make portfolio PCA bets basis-dependent. HHI of signed instrument exposure uses `abs(x)/sum(abs(x))`; all-zero exposure has null instrument concentration/count.

Strategy-instance and family performance contributions from supplied per-capital outcomes sum to strategy-space portfolio P&L. Instrument exposure contributions sum to H·a. **Underlying instrument P&L is NOT_IDENTIFIABLE_FROM_CURRENT_H_SNAPSHOT** for dynamic strategies; it is persisted as null with explicit reason, not fabricated from a buy-and-hold return. There is no certified real underlying P&L attribution while the historical ledger bundle is missing.

Strategy allocation turnover and instrument exposure turnover are separate gross-L1 quantities, with the latter including instruments exited from a previous map. Neither is automatically an actual NAV trade. Embedded internal costs/cash yield remain in NET history. Optional incremental cost records must be non-embedded **actual instrument trade notional**, unique trade IDs, capital-currency units and explicit bps/method; `sum(abs(notional)*bps/10000)` is reported separately. They are not subtracted again from net strategy histories. No actual master execution book or financing-account performance is claimed.

Compatibility is conservative: actual x is nonnegative, net one within feasibility tolerance, active maps are declared long-only funded and aggregate internal residual is exactly zero. Otherwise allocation can still be VALID but controller status is `SIGNED_OR_NON_NET_ONE_EXPOSURE`, normalization `BLOCKED_BY_SIGNED_EXPOSURE_CONTROLLER_SCOPE`. No `cash=1-net(x)` field or silent normalization. Compatible x with asset beta/covariance can produce an explicit **unscaled instrument projection** into frozen AL-01 RiskSleeve (ASSETS envelope for its existing controller contract, originating ALPHA_STREAMS result ID/mode retained). It is neither a production adapter nor strategy allocation reoptimization. Without asset-risk artifacts, compatibility can be established but projection is insufficient-data. Two different beta mandates change only the downstream controller multiplier/cash; AL-05 a is unchanged.

## PIT and reproducibility

Strict `information_cutoff < decision`. Child histories, maps, covariance/μ/beta/risk artifacts and previous allocation require admissible as-of/publication/provenance. The historical-store adapter first selects a frozen definition/configuration version, then only returns available by cutoff and the latest available historical map/covariance version. Future payloads are excluded **before** value validation or hashing, including deliberately corrupted future observations. Ambiguous historical versions fail. A current/final map or current definition is never silently backdated.

Tests mutate future maps, returns, covariance, forecasts, configuration and beta; also test delayed historical-store inputs, current invalid/future artifacts, exact source hashes and object-key order. The manifest and frozen synthetic inputs are saved before optimization. Repeating certification reproduced **17 manifest/economic JSON/CSV files byte-for-byte**. Source hashes cover new code and unchanged AL-01/02/03 dependencies. Same underlying/high correlation is not an identity duplicate.

## Certification results and retained initial failure

All fixtures are visibly **SYNTHETIC**, externally declared for mechanical verification, not new financial strategies or forecasts.

* 83 individual tests, every name/result in `reports/al05/test-results.json` and `tests.log`; 0 skipped.
* 22 persisted fixture results: **19 VALID**, one expected INFEASIBLE bounds case, two expected INSUFFICIENT_DATA missing-μ cases. Failures stay in allocation/risk/compatibility outputs, with errors and null weights.
* 125 deterministic perturbations: **122 VALID**, **3 expected INFEASIBLE exact equal-capital/ERC cap conflicts**, all retained. Perturbations include diagonal covariance shrink 1%/5%, μ scaling ±10%/rank-preserving noise where applicable, first-strategy caps 40%/80%, H exposure scaling ±1% explicitly marked financing semantics, actual-notional cost bps 0/10 where supplied. No robustness optimization.
* Independent NumPy/SciPy **162 PASS**: separate SLSQP objective solving/closed-form equal/ERC, H/contributions/netting/constraints, both risk spaces and betas, diversification, costs, attribution, CSV round-trip/IDs/counts, frozen source hashes. Objective absolute tolerance 2e-9; accounting 1e-12; equal/ERC weight tolerance 3e-8; diagnostics 2e-9. Known-answer JS tests include stricter closed-form objective weights and independent beta oracles.
* Initial **71 PASS / 1 FAIL** retained in `test-results-initial.json` and `tests-initial.log`: PSD eigencertificate nonconvergence was incorrectly INVALID_INPUT. Minimal AL-05 fix returns NUMERICAL_FAILURE when structural validation succeeds but numerical certification does not. Expectations were not changed. Added separate ERC-coordinate nonconvergence after successful eigencertification and infeasible max-Sharpe classification regression. Version bumped to 1.0.1. No baseline logic changed.
* The initial shell wrapper ended with `cat`, so its shell exit was 0 although the log contained a test failure; it is excluded from acceptance. Final test commands run without that suffix and returned 0. The additional new-file whitespace checker initially mistook `git diff --no-index` exit 1 (difference) for a whitespace failure; corrected the checker to inspect `--check` output. No files were altered to hide a whitespace issue.

## Historical replay and concrete limits

See `AL05_alpha_mapping.md` and `reports/al05/blocked-artifacts.json`. Complete original B1 preparation packages are local LFS pointers to 170 MB and 379 MB payloads. The available legacy allocation response has two strategies, one 252-session window, one H/d snapshot and one gross-based forecast, not the required historical definition/map/model availability sequence. No downloads, reattempt loop, current-map backfill or new backtests.

All five historical objectives are **BLOCKED_MISSING_CANONICAL_ALPHA_STREAM_ARTIFACTS**. Mean-variance/max-Sharpe additionally have **BLOCKED_MISSING_PIT_MU_ALPHA** for a historical canonical NET μ sequence. D1 gamma can be a valid strategy-return covariance in its original strategy axis; it is not rejected due to AL-04. Its current B2 producer uses gross streams and the bare model lacks the complete PIT envelope; NET units/axes/availability/version/provenance must be certified externally before adapting.

Consequently historical CAGR/vol/MaxDD/CVaR/Sharpe/conditional beta/CAPM-HAC and raw-versus-beta-normalized economic comparisons are **NOT EVALUATED**, not zero or extrapolated from synthetic fixtures. Existing AL-02 analytics remain available but are not called to manufacture a replay. No alpha, significance, winner or skill claim. Signed financing, live continuous accounting, target-versus-execution integration, automatic universe migration, nonconvex gross floors and large-universe scalable solvers remain outside certification; explicit workload limits are preserved.

## Files and commands

Only additions in `artifacts/api-server/src/lib/allocation-core/strategy-engine/` (12 files): `contracts.ts`, `validation.ts`, `solver.ts`, `engine.ts`, `history.ts`, `analytics.ts`, `fixtures.ts`, `sensitivity.ts`, `engine.test.ts`, `certify.ts`, `independent.py`, `render.py`. Main report, mapping and all CSV/JSON/log/chart evidence are in `reports/al05/` and the **single ZIP `reports/AL05_reports.zip`**. No prior source/report/config file modified.

Exact commands, exit codes and purpose are persisted in `reports/al05/commands.json`. Principal verification commands, from repository root unless noted:

```bash
# cwd artifacts/api-server
./node_modules/.bin/esbuild src/lib/allocation-core/strategy-engine/engine.test.ts src/lib/allocation-core/strategy-engine/certify.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/al05 --out-extension:.js=.mjs
# cwd repository root
node artifacts/api-server/dist/al05/engine.test.mjs reports/al05
node artifacts/api-server/dist/al05/certify.mjs reports/al05
python artifacts/api-server/src/lib/allocation-core/strategy-engine/independent.py reports/al05
./node_modules/.bin/tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --types node --typeRoots artifacts/api-server/node_modules/@types --skipLibCheck --strict artifacts/api-server/src/lib/allocation-core/strategy-engine/*.ts
MPLCONFIGDIR=/tmp/al05-mpl XDG_CACHE_HOME=/tmp/al05-cache python artifacts/api-server/src/lib/allocation-core/strategy-engine/render.py reports/al05
git diff --check
```

All final commands exited **0**. Strict typecheck covers the new isolated research module and its transitive TypeScript dependencies, not an unrelated project-wide audit. New untracked text files were additionally checked with `git diff --no-index --check`; exit 1 means differences from `/dev/null`, empty output confirms no whitespace errors. Seven labelled synthetic charts satisfy the required mechanics charts; economic comparison chart is blocked with the replay.

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1. StrategyInstance terminology, no alpha claim | PASS | Contracts, mapping, warnings |
| 2. Nonnegative capital allocation semantics | PASS | A/B/C, bounds/family/underlying/cardinality tests |
| 3. Objectives independent oracles | PASS | A–E, independent SLSQP/closed-form |
| 4. H·a reconciles | PASS | F, contribution matrix, independent replay |
| 5. Opposing exposure netting | PASS | Signed fixture, pre/post gross |
| 6. Internal residual not global cash | PASS | H, fully internal residual test |
| 7. Return risk versus position risk distinct | PASS | J–L, separate artifacts/beta methods |
| 8. Signed cannot silently enter controller | PASS | I, compatibility CSV |
| 9. PIT/no lookahead | PASS | M/N, historical-store future mutations |
| 10. B1/B2/D1 mapping complete | PASS | AL05_alpha_mapping.md |
| 11. Sensitivity reproducible | PASS | 125 records; repeat hashes |
| 12. Replay valid or explicitly blocked | PASS | Five explicit replay blockers, no fabrication |
| 13. Strict typecheck | PASS | tsc exit 0 |
| 14. git diff --check | PASS | exit 0; new-file checks |
| 15. Baselines preserved | PASS | 3,137 hashes unchanged |

Machine-readable status: `reports/al05/verification.json`. AL-05 stops here; AL-06 was not opened.
