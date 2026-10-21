# Backend-authoritative model definition

`exposure-model-definition.ts` reads the committed calculator's regime component declarations, weights and thresholds using narrow structural parsing, reads the committed model/policy definition through the existing candidate generator, and obtains versions from the actual registry. Unexpected source structure fails closed. No financial implementation or fixture is changed. The frontend receives this metadata through ordinary V2 capabilities and completed result enrichment.

Model: **Current Regime Score — baseline**. Decision: dynamic SPY/cash exposure. Information window: 252 prior observations. Selection metric: net Sharpe after the explicitly supplied selection costs. Reselection occurs at every B3A walk-forward rebalance. The output is a target exposure; realized beginning-of-period exposure can drift after the next-close fill.

Current component weights read from source: trend 25%, breadth 20%, volatility 20%, liquidity 10%, credit 10%, commodities 8%, cross-asset 7%. Dollar, rates and earnings are unavailable in this model. Available weighted components are renormalized by their available total. Price-proxy availability is labelled in the expandable explanation; information-series tickers are explicitly distinguished from portfolio holdings.

Score range is 0–100. Source thresholds are Risk-On ≥70, Constructive ≥55, Neutral ≥40, Cautious ≥25, otherwise Risk-Off. The thresholds label the score; they are not new trading rules. The selected cash-band policy maps the continuous score to cash inside its declared range; SPY target equals one minus cash. The current policy set contains cash ranges 10–20%, 10–40%, 20–20%, 20–40%, and a constant 100% SPY policy. Actual candidate IDs depend on the requested cadence and come from each selected job, never a copied fixture ID.

The fixed model and policy versions, weights, thresholds, cash mapping and complete candidate policy set are exposed under “How the exposure rule works.” No source code is displayed. No new signal or model family is added.

Every completed fold exposes actual decision/training/OOS dates, selected exposure policy and parameters, training net Sharpe, average realized SPY/cash exposure, turnover and simulated costs. Candidate IDs, fit keys, job hashes and result hashes remain in advanced details. These values are read from the actual sealed selected-job artifacts, whose manifest and financial hashes are verified before use.
