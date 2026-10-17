# AL-03 — Assets Allocation Engine v1

**PASS: 15/15 acceptance criteria; 44/44 synthetic individual cases, zero skipped.** Five versioned objectives, common canonical risk-sleeve result, 531 historical allocations, 1,062 historical and 19 synthetic sensitivity rows, 12 controlled economic replays and eight charts. Independent reconstruction reconciles all 531 allocations and 44,484 ledger rows. This certifies tested allocation mechanics; it is not an alpha discovery or a robustness gate.

## Canonical boundary

`allocateAssets(input)` decides **q only**, units `fraction_of_risk_capital`, convention LONG_ONLY_FULLY_INVESTED. Long-only q sums to one within an explicit numerical tolerance. Its input contract rejects cash, masterCash, totalCash, cash yield, target beta and exposure multiplier fields, including within constraints/objectives. It does not import a production optimizer, create forecasts, fit covariance or choose RiskMandate.

External `ExpectedReturns` is nullable for EW/min-var/ERC and mandatory for mean-var/Max Sharpe. CovarianceRiskModel is supplied, with exact asset axis, daily return-squared units, model/version, SHA256 provenance, finite square values, symmetry/PSD checks and strict prior-decision availability. All used risk/forecast artifacts have the same decision-universe axis and information cutoff. The external adapter delegates covariance and asset-beta fitting unchanged to AL02: 252 complete prior sessions and sample covariance. It is not part of the optimizer.

The output is a validated AL01 RiskSleeveAllocationResult, plus objective/solver diagnostics and stable input/result IDs. Beta is attached as q'beta_assets, vol as sqrt(252*q'Sigma*q); neither is an objective or a normalization of q. Subsequently the unchanged `composeMandatedPortfolio` consumes the same immutable RiskMandate for every q at a date. Only that controller generates lambda, final NAV weights and implied cash. Controller output does not flow back into allocation.

## Objective registry and numerical contract

| Objective | Version | Exact decision criterion / solver |
|---|---|---|
| EQUAL_WEIGHT | 1.0.0 | q_i=1/N exactly; incompatible bounds/caps/cardinality/turnover return INFEASIBLE, never projection under another objective. |
| MIN_VARIANCE | 1.0.0 | min q'Sigma*q over the declared long-only fully invested polytope. |
| MEAN_VARIANCE | 1.0.0 | max q'mu-gamma/2*q'Sigma*q; gamma explicitly positive, never estimated. |
| MAX_SHARPE | 1.0.1 | max (q'mu-rf_sleeve)/sqrt(q'Sigma*q), daily units; rf_sleeve explicitly supplied, including zero. No cash variable. |
| ERC / risk parity | 1.0.0 | Equal positive risk budgets RC_i/variance=1/N; cyclic coordinate solution of convex log-risk-budget problem, then q=x/sum(x). Exact ERC conflicting with constraints is INFEASIBLE; nonconvergence NUMERICAL_FAILURE. |

MIN_VARIANCE/MEAN_VARIANCE use deterministic exhaustive convex KKT active faces, with positive objective scaling solely for conditioning, no diagonal lift or pseudoinverse. PSD flat directions are covered by lower-dimensional faces. Asset bounds, group/sector caps, gross-L1 turnover vs previous q and max active names are supported. Cardinality is an explicit union of supports, not a heuristic. Turnover cap is **sum(abs(q-previous_q))**, not half-L1 and not executed NAV turnover. Feasibility is rechecked independently before canonical output validation.

For positive feasible excess return, Max Sharpe uses exact Schaible transformation: a=mu-rf_sleeve*1, y=q/(a'q), minimize y'Sigma*y subject to a'y=1; Aq>=b transforms to (A-b*1')y>=0 and q=y/sum(y). Synthetic diagonal tangency and constrained SciPy oracle verify the transformation. For nonpositive excess over the entire feasible polytope, the maximum finite Sharpe occurs at a feasible vertex. With b=-a and covariance norm, b'q >= min_v(b'v/||v||)*sum(theta_v*||v||) >= min_v(...)*||q|| proves the vertex certificate. This is the same objective, not a fallback. Zero excess with positive variance returns Sharpe zero. Positive-return zero-variance feasible support makes finite Sharpe undefined/unbounded and returns INSUFFICIENT_DATA even if another support has a finite ratio.

ERC uses RC_i=q_i*(Sigma*q)_i, MRC_i=(Sigma*q)_i and variance=sum(RC). Zero-variance assets cannot receive an equal positive risk budget and return INSUFFICIENT_DATA. No equal-weight fallback, clipping, risk quality gate or robustness optimization. Status remains explicit VALID/INFEASIBLE/INVALID_INPUT/NUMERICAL_FAILURE/INSUFFICIENT_DATA.

Declared defaults: feasibility 1e-10, stationarity normalized 1e-9, symmetry absolute 1e-12 and PSD absolute 1e-12 in daily covariance units, ERC max absolute risk-share error 1e-8, 10,000 iterative steps, 100,000 KKT faces and 4,096 supports. Covariance within symmetry tolerance uses its symmetric part with a warning; no eigenvalue lift. Eigenvalues within PSD tolerance are reported; negative numerical eigenvalues are zeroed only for entropy share diagnostics, not silently regularized in the optimization objective. Zero portfolio variance leaves relative RC/PCA rank undefined, not fabricated. Near-singular elimination is rejected, never pseudo-inverted. Workload limits fail explicitly, never truncate; the exact-face solver is intended for small universes (default unconstrained box-face budget usually covers up to eight assets), not certified as a large-universe optimizer.

## Diagnostics and local sensitivity

Every valid allocation includes gross/net exposure; variance/annualized vol/beta; MRC, RC and fractional RC; HHI=sum(q_i^2), effective weight count=1/HHI, largest weight and top-3 share; gross-L1 turnover vs previous target q (null at first decision); active asset bounds. Group/cap feasibility is certified, although active_bounds lists asset bounds only.

Jacobi eigendecomposition supplies covariance effective rank exp(entropy(lambda/sum(lambda))). PCA risk shares are lambda_j*(v_j'q)^2/variance; portfolio PCA effective risk bets=exp(entropy(shares)). This is **entropy PCA-ENB, not minimum-torsion ENB**. A degenerate eigenspace has basis-dependent PCA shares; canonical asset order is deterministic, not a unique financial decomposition. Independent NumPy reconstruction agrees on the tested fixtures/history. Target-q concentration/PCA diagnostics are averaged across rebalance dates, not execution-drifted holdings.

`localSensitivity(input,result)` is the separate research stress orchestrator called for every replay allocation and all five synthetic objective examples. Fixed perturbations: covariance diagonal shrink 1%/5%; mean-var gamma 0.8x/1.0x/1.2x; mu objectives 0.9x/1.1x plus deterministic rank-preserving noise bounded by 1% of the smallest distinct mu gap (ties unchanged; no distinct gap explicitly labelled). No parameter selection follows these outputs. L1/max weight change, beta/vol change and objective change are persisted with scenario/input hashes; both perturbed-objective and original-objective changes are exported, avoiding comparison of different objective definitions. Historical first three objectives do not require mu and therefore only have covariance stress rows; synthetic outputs demonstrate gamma/mu paths. All 1,081 stress rows are VALID.

## Frozen economic replay

Universe is the declared today-fixed equity ETF list **SPY, XLK, XLV, XLC**, with historical availability gating. Source is the exact CL02 adjusted-closes.csv, copied byte-for-byte to `al03/adjusted-closes-input.csv` and hashed in manifest. First observations SPY/XLK/XLV: 2010-10-01; XLC: 2018-06-19. These are snapshot availability dates, not certified official inception dates. First eligible decision sessions after 252 complete aligned return observations: 2011-10-03 for the first three, 2019-06-21 for XLC; monthly XLC entry is 2019-07-01. Prior XLC rows are NOT_YET_OBSERVED or insufficient warmup; no pre-inception/backfilled prices/returns. Every rebalance persists eligible/excluded universe, reason, count and first eligible date.

Protocol frozen before performance: monthly signals, next_close fills, rows strictly < signalDate, initial NAV/cash 100000, start setting 2012-01-01, end 2026-09-30. The actual return ledger begins 2012-01-04 with intervalStart 2012-01-03; 3,707 intervals per campaign and 177 rebalances. Holdings retain quantities between fills. Raw target is q; normalized target is lambda*q from the same declared **MARKET_BETA 0.30**, no leverage/short, REJECT constraints and no parameter adjustment after results. All 531 compositions are feasible; expected final beta equals .30 at decision time. Realized full/forward beta is a different measurement and is not forced to equal .30.

EW/min-var/ERC are executed, each raw and beta-normalized at 0/5 bps, slippage zero. Production runBacktestEngine and existing offline A1 DB shim are reused; no production service access and no second accounting engine. The backtester still computes its existing regime labels for logging; they do not determine these explicit allocation targets. Fees equal actual absolute bought/sold notional*bps/10000, checked alongside P&L, cash, holdings, NAV and next-close dates; no implicit trades between fills. Cash/RF yield is the existing CL02 research zero assumption, not a historical T-bill series. Trade turnover is gross notional/pretrade NAV, annualized252/n separately from q turnover.

**Historical MEAN_VARIANCE/MAX_SHARPE are blocked only for missing inputs:** no canonical external daily ExpectedReturns artifact for this universe at every 2012-2026 decision cutoff. Existing current/legacy forecasts do not supply that PIT history. No historical-mean heuristic was invented. Both objectives and all their stress paths are certified on labelled synthetic artifacts, not marketed as economic strategies.

## Recorded results (no winner claim)

CAGR uses CL02 calendar convention (365.25/days from initial intervalStart), vol sample daily sqrt252, DD initial NAV high-water, CVaR95 empirical expected daily loss with fractional tail mass. Conditional betas and rolling63 reuse AL02 market-risk-metrics-1.1.0, with benchmark peaks inherited from all available history. CAPM uses AL02 HAC Newey-West Bartlett lag5, no small-sample correction; alpha annual=252*daily intercept. Intercept and t-stat are descriptive residual model outputs, not claims of robust alpha.

| Candidate | CAGR | Vol | MaxDD | Realized full beta | Gross turnover (whole sample) | Fees NAV units | CAPM annual residual bps | HAC t-intercept |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| EQUAL_WEIGHT_RAW_0bps | 16.326% | 16.731% | -30.654% | 0.99099 | 4.1378x | 0.00 | 134.09 | 1.533 |
| EQUAL_WEIGHT_RAW_5bps | 16.309% | 16.731% | -30.654% | 0.99099 | 4.1374x | 710.44 | 132.69 | 1.517 |
| EQUAL_WEIGHT_BETA_NORMALIZED_0bps | 4.993% | 4.902% | -9.374% | 0.28961 | 2.0342x | 0.00 | 55.54 | 2.048 |
| EQUAL_WEIGHT_BETA_NORMALIZED_5bps | 4.986% | 4.902% | -9.375% | 0.28961 | 2.0342x | 144.03 | 54.85 | 2.022 |
| MIN_VARIANCE_RAW_0bps | 12.740% | 15.028% | -31.441% | 0.82566 | 16.9373x | 0.00 | 47.03 | 0.283 |
| MIN_VARIANCE_RAW_5bps | 12.675% | 15.027% | -31.446% | 0.82561 | 16.9360x | 2670.61 | 41.34 | 0.249 |
| MIN_VARIANCE_BETA_NORMALIZED_0bps | 4.558% | 5.472% | -10.687% | 0.29299 | 7.0034x | 0.00 | 11.64 | 0.173 |
| MIN_VARIANCE_BETA_NORMALIZED_5bps | 4.533% | 5.471% | -10.688% | 0.29297 | 7.0032x | 527.39 | 9.29 | 0.138 |
| ERC_RAW_0bps | 15.657% | 16.199% | -30.570% | 0.95436 | 4.8431x | 0.00 | 123.76 | 1.326 |
| ERC_RAW_5bps | 15.638% | 16.199% | -30.571% | 0.95435 | 4.8427x | 814.92 | 122.13 | 1.308 |
| ERC_BETA_NORMALIZED_0bps | 4.934% | 4.940% | -9.545% | 0.29042 | 2.1586x | 0.00 | 48.84 | 1.634 |
| ERC_BETA_NORMALIZED_5bps | 4.926% | 4.940% | -9.546% | 0.29042 | 2.1586x | 153.94 | 48.11 | 1.609 |

The raw sleeves have materially different market risk, so raw CAGR differences cannot be attributed to allocation skill. At the same PIT beta target, realized full betas are close but not identical: approximately .28961 EW, .29299 min-var and .29042 ERC at zero costs. At 5 bps, recorded normalized CAGR is 4.986%/4.533%/4.926% respectively, with vol 4.902%/5.472%/4.940%. Min-var's raw lower vol does not translate into lower normalized realized vol or drawdown in this sample; it also has more turnover and concentration. These are observations for a fixed universe/protocol, not a winner selection or evidence of future dominance.

The central attribution question is only partially economic: the controller equalizes **estimated** beta, then composition-dependent realized risk, residual returns and costs remain. Full realized beta is not literally equalized ex post. Sector exposures, a today-fixed surviving ETF universe, zero RF, snapshot adjustments, repeated use of the sample and no independent holdout/multiple-testing inference limit any skill conclusion. Even an observed HAC t around2 in one normalized curve does not establish robust allocation alpha. No signal/model discovery, objectives tuned on results, aggregate score or next block is created.

## Independent oracles, corrections and reproduction

44 individual cases cover inverse-variance q, two-asset mean-var derivative, symmetric equal assets, diagonal inverse-vol ERC, constrained SciPy optimization, positive and nonpositive Max Sharpe, zero variance/cardinality, impossible bounds/groups, PSD/axis/units, order permutation, future mutation of returns/forecasts, AL02 beta/vol reconciliation, cash-field rejection for all objectives, immutable mandates, turnover/cardinality bounds, workload/nonconvergence, PCA reconstruction and repeat IDs/output.

Initial FAIL evidence is retained: shared synthetic covariance contaminated later cases (37PASS/4FAIL); canonical snapshot prefix missing (40PASS/1FAIL); boundary extensions exposed unsupported nonpositive Sharpe and a positive zero-variance support hidden by a finite support (41PASS/3FAIL). Research-only fixes preserve the oracle expectations and are versioned in Max Sharpe1.0.1. The former nonpositive-domain unavailable test was replaced by the complete objective's independent known-answer contract; the original restricted implementation/test is archived, not presented as full support. Final 44PASS/0FAIL/0SKIP.

Runner-only failures are also recorded: missing existing offline DB build alias before calculation, incorrect DD dictionary key in summary, fixture relative import path, and initial replay type errors. Evidence/manifests/source/partial results are preserved under pre-summary-interface-fix and pre-sharpe-boundary-hardening. Boundary hardening changes only Max Sharpe; re-running the first three historical objectives with unchanged parameters left all 26 comparable allocation/economic/ledger outputs byte-identical. Final same-manifest repeat reuses 12 SHA-verified completed ledgers and reproduces 29 outputs including current manifest and synthetic stress files.

Independent Python never calls optimizer/controller/backtester. NumPy reconstructs PIT covariance/beta, covariance/PCA entropy, ledger returns/metrics and conditional states; a separate support enumeration reconstructs min-var, SciPy root reconstructs ERC, SciPy SVD/HAC score products reconstruct CAPM; independent SLSQP verifies all synthetic stress variants. All 531 q values, 12 scorecards and 44,484 ledger rows agree. Comparisons: independent replay abs1e-9+rel1e-7 generally, q abs2e-8; synthetic tests default abs1e-8, constrained SciPy q abs3e-7/PCA abs2e-6 and SLSQP stress q abs1e-6; tolerances are declared, not increased after FAIL.

`manifest.json` freezes configuration, source data, code and baseline hashes before performance. Final strict TypeScript --strict/--noEmit over every new .ts and transitive imports passes; existing manifests/lockfiles unchanged and no dependencies installed. `git diff --check` passes; new-source/report whitespace is checked separately. Baseline checkpoint/preservation verifies **2929/2929** prior files unchanged, including all CL01-04/CRE/AL01/AL02/calculator/B1/B2/B3/routes/UI/DB/manifests/lockfiles and AL02 ZIP. Branch work; commit1163a0b574b573004372a3a2fc8752810dea7ef9; prior pending changes preserved, no reset/checkout/commit/push/merge/deploy.

## Files, commands and downloadable package

New isolated core: `artifacts/api-server/src/lib/allocation-core/assets-engine/` contracts.ts, numerics.ts, solver.ts, engine.ts, artifacts.ts, sensitivity.ts, engine.test.ts, replay.ts; independent oracles/replay/chart helpers oracles.py, independent.py, render.py and fixtures.mjs. No connection to API/routes/UI or B2 adapter.

Required reports: allocation-results.csv, risk-diagnostics.csv, diversification-diagnostics.csv, sensitivity.csv, universe-history.csv, economic-replay.csv, verification.json and eight charts. Additional full input/solve/controller/target JSON, real ledgers, rolling-beta/equity data, scorecards, source snapshot, synthetic outputs, manifests/hashes and pre/post logs permit audit/reproduction. CSV RFC4180/CRLF; JSON is finite and round-trip checked.

[commands.json](al03/commands.json) contains commands, cwd, exit codes and every initial/final failure log. Final build uses the existing esbuild binary and A1 DB alias; Node tests/replay/fixtures, Python oracles/independent/charts, strict tsc and git diff checks all exit0. [Machine verification](al03/verification.json), [B2 mapping](AL03_B2_mapping.md), [economic table](al03/economic-replay.csv).

A single `AL03_reports.zip` bundles these reports/evidence, the exact adjusted-close input and new research sources. It requires the preserved repository baseline and installed existing dependencies to reproduce accounting; it is not a deployable application.

## Charts

![Risk sleeve allocations](al03/charts/allocations-through-time.png)
![Raw CAGR beta](al03/charts/cagr-vs-beta-before-normalization.png)
![Normalized CAGR beta](al03/charts/cagr-vs-beta-after-normalization.png)
![Vol DD](al03/charts/volatility-drawdown-comparison.png)
![Effective bets](al03/charts/effective-bets-through-time.png)
![Turnover](al03/charts/turnover.png)
![Concentration](al03/charts/weight-concentration.png)
![Sensitivity](al03/charts/sensitivity-heatmap.png)

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| 1. No global cash variable | PASS | engine.ts strict input contract; cash/target/lambda injection tests for all 5 objectives |
| 2. All objectives known-answer | PASS | 44 individual cases + NumPy/SciPy independent oracles |
| 3. PIT/no lookahead | PASS | Future mutation test; strict prior AL02 window; covariance/forecast PIT rejection |
| 4. Explicit infeasibility | PASS | Impossible bounds, ERC incompatibility, singular variance and workload/nonconvergence cases |
| 5. Beta/vol AL02 reconciliation | PASS | q beta and q covariance tests; 531 independent PIT reconstructions |
| 6. Diversification independently verified | PASS | NumPy eigh/entropy/HHI for 531 allocations and synthetic fixtures |
| 7. Reproducible sensitivity | PASS | 1062 historical +19 all-objective synthetic stress rows; identical output hashes |
| 8. Explicit universe/inception handling | PASS | universe-history.csv; actual first observation +252 complete aligned returns; independent oracle |
| 9. Raw and beta-normalized replay | PASS | 12 valid campaigns: EW/MIN_VARIANCE/ERC x RAW/NORMALIZED x0/5bps; historical MV/MAX_SHARPE blocked for missing canonical mu |
| 10. RiskMandate unchanged | PASS | Shared immutable .30 mandate hash at every rebalance across objectives; controller tests |
| 11. B2 mapping complete | PASS | reports/AL03_B2_mapping.md; read-only source mapping |
| 12. Independent verification | PASS | independent-verification.json: 531 allocations +44484 ledger rows +12 scorecards |
| 13. Strict typecheck | PASS | typecheck.txt exit0, strict noEmit all new TS and transitive imports |
| 14. git diff --check | PASS | diff-check.txt exit0; source-whitespace.json |
| 15. Baselines unchanged | PASS | preservation.json 2929/2929 hashes unchanged |

Certification ends at AL03. No Portfolio Robustness Gate, allocation research engine, new forecast/alpha streams, production adapter or AL04.
