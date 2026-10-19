# AL-04 — Factor/scoring/D1 mapping (read only)

No production adapter or producer model was built. No factor signals/targets/returns were forecast or fitted. All existing source/artifacts are preserved at branch `work`, commit `1163a0b574b573004372a3a2fc8752810dea7ef9`, including prior pending changes. Machine evidence: [classification CSV](al04/factor-classification.csv), [source evidence](al04/mapping-evidence.json).

## Taxonomy and current objects

| Existing object | Classification | Meaning / canonical consequence |
|---|---|---|
| `FactorDefinition` in `factor-library.ts:15-40` | SIGNAL_FEATURE | Configuration of a calculation over adjusted prices, winsorization/normalization, direction and regime scoring weights. It does not define factor returns, loadings or a covariance model. |
| momentum, trend_quality, volatility, drawdown_risk_fit, mean_reversion, relative_strength, diversification_benefit | SIGNAL_FEATURE | These seven frozen `source-factor-library.response.json` entries use percentile ranks. Their names/families do not make them economic risk factors. Do not convert scores, percentile ranks, baseWeight/regimeWeights or benchmarkTicker into factor-exposure targets or rows of B. |
| Other `FactorCalculationType` variants: return_over_volatility, ma_distance, downside_beta, residual_momentum, correlation_stability, drawdown_recovery | SIGNAL_FEATURE or UNSUPPORTED/AMBIGUOUS | Calculation types remain features unless a separate certified return/loading model exists. `factor-library.ts:102+` marks several calculations unavailable; no new implementation or reinterpretation here. A feature named downside_beta is not automatically a canonical beta exposure model. |
| D1 correlation PCA risk basis | STATISTICAL_FACTOR | Genuine statistical covariance decomposition of aligned candidate alpha-stream gross returns. It is not a macro view or an economic Value/Momentum target. |
| Economic factor-return portfolios/models | ECONOMIC_FACTOR category, no certified artifact stream found | AL04 contracts accept externally supplied factor-return/loadings semantics and units. Current feature definitions do not satisfy them. No economic model was invented for replay. |
| Tradable factor portfolios with explicit capital/return implementation | TRADABLE_FACTOR_PORTFOLIO category, no certified artifact stream found | A tradable ETF/sector asset alone does not provide a factor-return/loading model or external target. No silent asset-to-factor promotion. |
| Generic “factor” names, scores, or matrices without axes/units/PIT metadata | UNSUPPORTED/AMBIGUOUS | Reject as canonical target/B/Phi/D until the producer supplies complete semantics. |

The last two category entries describe missing types, not discovered live financial models. Synthetic fixtures with those declared roles certify mathematics only.

## D1 exact axes, dimensions and units

`d1-factor-model.ts:230` accepts a T x N matrix of aligned **gross daily candidate alpha-stream returns**, candidate IDs and factor count. It has no date/provenance envelope of its own. `allocation-b2.ts:544-545` allows D1 choices only for `alpha_streams`; the actual call at 617-626 supplies those candidates' gross return matrix. Existing B2 dates/cutoff are carried outside the D1 object; its input alignment accepts dates no later than the explicitly supplied cutoff (`allocation-b2.ts:586+`). This is not a dated canonical asset-loading stream, and it was not re-run.

Let S be sample daily covariance (denominator T-1), s_i its daily standard deviations, R=diag(s)^-1 S diag(s)^-1, V its correlation eigenvectors and lambda the retained eigenvalues.

| D1 field / code | Axis / shape | Units and identity | AL04 mapping conditions |
|---|---|---|---|
| `candidateIds`, lines 45-68 | N selected alpha-stream candidates | IDs of return columns; “alpha” here is legacy stream terminology, not CAPM residual alpha. | Cannot relabel as tradable asset IDs. |
| `omega`, 302-305 | **N alpha x K factor** | omega_ik=s_i*V_ik; daily-return loading scale per standardized factor shock. | B would be omega transpose only if the N columns were certified tradable asset returns. They currently are alpha streams. |
| `phi`, 306-308 | K x K | diag(correlation eigenvalues); dimensionless covariance of standardized shocks, not daily economic-factor return covariance. | For a valid such producer, declare factor units DAILY_RETURN_LOADING and factor-return units STANDARDIZED_DAILY_SHOCK; do not label omega as a dimensionless market beta. |
| `xi`, 311-322 | N alpha x N alpha, diagonal | Daily specific return variance = max(roundoff-clamped residual variance, declared floor fraction * sample variance). Floor default 1e-6, reported by D1. | Could become D only with a certified matching asset axis and explicit producer provenance/floor configuration. AL04 adds no floor and never substitutes missing D with zero. |
| `gamma`, 323 / reconstructCovariance 217+ | N alpha x N alpha | Daily covariance omega*phi*omega' + xi. This matrix is **not** AL03's scalar risk-aversion gamma. | Not an asset covariance unless axes/returns/model semantics are separately certified. |
| `factorExposure`, 428-431 | K vector | omega' * alpha capital coefficients; daily-return loading exposure. It need not sum one and is not capital weights or market beta. | Cannot substitute tradable q for alpha coefficients or call this an asset beta exposure. |
| `factorVarianceContributions`, 430-433 | K vector | e_k*(phi*e)_k; signed Euler systematic variance contributions. | Algebra is compatible once factor coordinate/units are valid. No conversion to positive capital weights. |
| `portfolioVolatility`, 433-436 | Scalar | sqrt(daily modeled variance), **not annualized**. | AL04 annualization is sqrt252, explicit. |
| Diagnostics `factorCovarianceEigenvalues/EffectiveRank`, 370-391 | N modeled candidate covariance spectrum | Computed from **gamma eigenvalues**, despite the field name; not necessarily the K x K phi spectrum. | Do not copy into AL04 factor_covariance_effective_rank, which describes Phi. Asset PCA bets and factor dimensions are separate. |

D1 default factor count is min(5,N-1,T-1), with explicit counts rejected if incompatible; degenerate factor bases are warned via eigengap/basis diagnostics. Truncated correlation PCA may change signs/rotations across windows. A persistent economic target requires explicit coordinate identity/basis alignment and dates; an index called PC1 is not automatically the same exposure through time.

## Why no D1 adapter is safe now

Although omega/Phi/Xi are genuine statistical risk arrays, their current candidate axis is alpha-stream returns. The streams may trade overlapping ETFs, retain cash and use different time-varying execution/P&L conventions. Current instrument exposure map H and stream coefficients b give q=H*b, while factor exposure is omega'*b. A tradable loading B would require a certified relation B*H=omega' for the relevant information sets and return semantics; it cannot be obtained by silently inverting or pseudoinverting H. The same instrument q can result from streams with different historical returns. A producer fitted to actual asset return columns, with dated targets, units, basis IDs, hashes and explicit D, is needed instead.

The existing bare D1 object omits as_of, information_cutoff, data/config hashes, source IDs and factor-target identity. B2's surrounding envelope helps audit its original candidate risk model but does not supply a complete canonical tradable factor artifact stream at every decision date. No adapter is created in AL04.

## Frozen AL01 boundary

AL01's FACTORS detail admits only `UNIQUE_SQUARE_EXACT`; modifying it would violate preservation. AL04 therefore defines `factor-implementation-1.0.2`, a general FACTORS result with q, method, target/residual, model/mapping references and separate beta provenance. A pure **research-only instrument projection** carries the same q/risk into the frozen AL01 controller's ASSETS instrument envelope, with origin_mode=FACTORS, origin result ID, source link and explicit warning. It is not a factor/scoring or D1 producer adapter, does not optimize/normalize q economically, and does not falsely claim square-exact mapping. Full factor-volatility provenance remains in the origin result; the legacy controller's risk-provenance hash field remains bound to the supplied beta estimator as its validator requires.

## Historical replay blocker

**BLOCKED_MISSING_CANONICAL_FACTOR_ARTIFACTS.** Missing concrete inputs are a dated external FactorExposureTarget, FACTORS_BY_ASSETS tradable loading matrix, compatible Phi plus explicit D and tracking metric for **every decision date**. Available `reports/cl02/adjusted-closes.csv` is an asset price snapshot; `reports/oct2026-backtests/source-factor-library.response.json` is a feature configuration. Neither is that factor artifact stream. The bounded source/artifact inspection found no such complete bundle. No backtest, retry loop, score conversion, target search or producer fitting is attempted. This blocks economic replay only; mechanical certification is separate.
