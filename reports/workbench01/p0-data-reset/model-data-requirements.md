# Model data requirements — baseline audit and P0 validation contract

This audit describes the committed Render-preview implementation at `5e95245a3ee279d836212d6fc41943c7620a3411`. It authorizes no changes to financial formulas, model families, policy definitions, forecast methods or benchmark accounting.

## Mandatory inputs by current model

| Model | Mandatory price input | Actual feature history | Optional inputs |
|---|---|---|---|
| CURRENT | SPY, plus every explicitly traded ETF for portfolio execution | `computeRegime()` can evaluate from 10 available rows. The coordinated engine passes up to 252 prior observations. Individual components have their own availability thresholds. | Additional reference-universe symbols and proxies. Missing optional symbols must not block an otherwise valid SPY/cash design. |
| TREND | SPY | 200 prior SPY prices for its existing SMA-200 decision | Other reference symbols are not consumed by the trend rule. |
| TREND_VOL | SPY | 253 prior SPY prices to produce 252 log returns; existing volatility windows are 21 and 252 returns, plus SMA-200 | Other reference symbols are not consumed by the trend/volatility rule. |
| HMM | SPY | Exactly the user's training-window SPY log returns. Existing validation requires nonempty finite returns and rejects constant/degenerate samples; EM convergence is checked during execution. There is no certified universal 200/252-row HMM quota. | Other reference symbols are not consumed by this HMM. |

Source authority: `research/coordinated/engine.ts::classify` and `runCoordinated`, `research/coordinated/models.ts::fitGaussianHMM`. A capital-only study trades SPY/cash. A portfolio run additionally needs actual valid history for its explicitly selected traded ETFs. This is an execution-universe requirement, not a universal regime reference-universe requirement.

Asset forecasts retain their separate committed requirements in `research/coordinated/forecasts.ts`: manual score features consume their enabled lookback+skip history; learned signal forecasts also consume their explicit training and horizon history. P0 must report those requirements when applicable, without changing their mathematics.

## CURRENT component availability and renormalization

The unchanged authority is `artifacts/api-server/src/lib/calculator.ts::computeRegime`.

| Component | Existing base weight | Existing availability behavior |
|---|---:|---|
| Trend | 0.25 | Uses symbols with at least 50 prices; 200-price information contributes when available. |
| Breadth | 0.20 | Uses valid 20-session changes (21 prices) across available symbols. |
| Volatility | 0.20 | Uses available 20-return realized volatility. |
| Liquidity proxy | 0.10 | Uses available short return-dispersion series. |
| Credit proxy | 0.10 | Unavailable when sufficient XLF history is absent. |
| Commodity proxy | 0.08 | Unavailable when sufficient XLE/XLB history is absent. |
| Cross-asset confirmation | 0.07 | Unavailable unless at least three symbols have the required history and correlations can be computed. |

Dollar, rates and earnings-revision components are explicitly unavailable in this price-only model. For every component whose score is non-null, the existing formula adds `score × base_weight` and divides by the sum of weights of those available components. It does not fill missing proxy prices. Confidence uses the existing count of computed/proxy components. The UI must display the resulting availability and confidence rather than claiming full information coverage.

The historical certified `research/capital/registry.ts::current_regime` adapter has a stricter complete-input-set check and a minimum-200-row contract. That legacy certification path must not be silently relaxed or have its old identities rewritten. New persisted-dataset validation must bind to the actual selected product model contract.

## Training and causal feature history

Training length is exactly user supplied. For rolling windows, training begins the selected number of calendar months before each decision boundary. For expanding windows, its initial start remains fixed. A fixed feature lookback may use observations before the training start, but never at or after the same decision cutoff. HMM learning uses the actual selected training interval.

P0 preflight must report the requested backtest start/end, computed training start, feature-history start or exact required/available observation count, selected dataset first/last dates, and required symbols. If history is missing, return the exact requested and available dates. Never move the evaluation start, enlarge training, forward-fill, interpolate or change the dataset to make a design pass.

CURRENT's full 252-observation information horizon is not an unconditional eligibility minimum: its actual component availability logic supports reduced information. TREND and TREND_VOL have fixed feature-history requirements. HMM convergence/degeneracy cannot be guaranteed solely from a calendar preview. A successful preflight is a necessary-data check, not an execution guarantee.

A requested end beyond the active dataset must state that dataset's exact last date. All capability bounds must come from the explicitly selected persisted version. No fallback to the internal snapshot is permitted when that version is absent or invalid.
