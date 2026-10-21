# Aligned benchmark accounting

Methodology: `capital-exposure-controls-1.0.0`. This is post-processing of a completed successful V2 experiment. It never enters the campaign worker, training, selection, fold planner or run identity.

All three tracks have exactly the original dynamic OOS dates and outer-fold boundaries. Every fold is an independent research sleeve starting with NAV 100 in cash. Each sleeve's daily net returns are concatenated and compounded using the certified capital engine's aggregation convention. The displayed index is this composite; it is not a continuously funded account across folds. Costs are summed research-NAV units across independent sleeves, not live currency fees.

The first observed fold date is the signal date. Entry occurs at the next observed close. The first two beginning exposures are cash, including the entry day's pre-fill return. There is no terminal liquidation. Missing observations are not interpolated. Cash uses the committed campaign's daily cash yield (currently zero), and cost rate is the explicit OOS transaction cost. Slippage remains the existing zero-slippage convention.

**Dynamic exposure:** original selected-job ledger/observations and original result index/drawdown, unchanged. The dynamic financial hash remains the certified result's hash.

**Passive SPY:** enter 100% SPY at each fold's next-close entry, charge the supplied rate on the actual cost-adjusted entered notional, then hold. No maintenance trade and no terminal liquidation. This includes initial entry costs at every fold; there is no zero-cost passive shortcut.

**Retrospective static matched-beta diagnostic:** a single constant target SPY proportion lambda over the completed sample. It uses the same cash/entry/reset rules and maintains that target at subsequent daily closes. These predeclared maintenance trades charge the same rate on actual notional. It omits unnecessary terminal maintenance. Maintaining constant exposure differs from a buy-and-hold mixed account whose weights drift; this difference is explicit. The daily-maintenance rule is not an additional dynamic signal or candidate.

The cost-adjusted trade is self-financing. If pretrade NAV is V, old SPY value A and fee rate k, then post-cost NAV is `(V + k*A)/(1 + k*lambda)` for purchases or `(V - k*A)/(1 - k*lambda)` for sales. Cost equals `k * abs(lambda * post_cost_NAV - A)`. This matches the unchanged calculator's cost-adjusted passive entry in an independent known-answer test.

Performance measures reuse `research/capital/metrics.ts::summarize`: CAGR uses 252 divided by actual OOS observations, net Sharpe uses sample variance and the committed reference daily return, and drawdown uses the compounded OOS index. This preserves the original dynamic metrics exactly. Risk diagnostics reuse AL-02 `conditionalMetrics`: full/upside/downside beta, market-drawdown thresholds 5/10/20%, lower tails 5/1%, and upside/downside capture. Market drawdown uses actual SPY price history available up to the final diagnostic date. Beta reference is raw SPY adjusted-close return on every aligned OOS date, including entry-lag rows; the net passive track's beta can therefore differ from one.

Certified AL-02 CAPM regression is reused with its committed default HAC Newey–West inference and five lags. Daily intercept and standard error are annualized by 252; t-statistic is unchanged. Sample size, inference status/reason, method and configuration remain available. Undefined/insufficient conditional samples or regression inference retain explicit diagnostic statuses; no metric is fabricated. No positive-return, Sharpe or timing comparison generates an alpha claim.

Capital efficiency reuses certified diagnostic ratios. CAGR per realized beta is shown only for positive defined beta; exposure efficiency requires a positive meaningful denominator. These diagnostics do not replace standard return/risk metrics or establish timing skill.
