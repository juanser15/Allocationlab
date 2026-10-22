# Results contract

Only backend-produced data is displayed. Sources are the certified ledger, capital `summarize`, AL-02 analytics and unchanged B3C control/matched-beta routines. Source-equivalence and empirical reconciliation are acceptance gates.

The compact result includes the exact plan, model/turnover versions, selected policies with actual training candidate scores/metrics/turnover, OOS turnover decomposition, aligned dynamic/passive/matched-beta points, benchmark metrics, matched-beta feasibility diagnostic, attribution and four deterministic financial hashes. Each selected book exposes actual targets, cutoffs, candidate ID and job/result hashes in Audit. Learned fit artifacts are not invented for a stateless model. Full training ledgers are not retained by interactive runs; exhaustive reference materialization is explicit and separate.

Primary KPI strip: CAGR, annualized volatility, net Sharpe, max drawdown, realized market beta, average SPY exposure and realized simulated cost. The table adds certified conditioned betas/captures, average exposure, recurring/total/initial turnover. Annualized return is the certified observed-session CAGR convention, displayed with its definition; no separate frontend annualization formula exists. Unavailable diagnostics remain explicitly unsupported, never zero filled. If the unchanged matched-beta routine declares a cost setting unsupported, the dynamic and passive results remain available and the matched track/metrics/turnover are explicitly NOT_SUPPORTED; no substitute benchmark is created.

Research-index, drawdown and exposure/cash charts use actual returned points without smoothing. Cash display is the returned cash allocation, not 1 minus a locally estimated exposure. All controls use the same OOS sessions and independent-fold accounting. Entry costs remain charged. The control methodology itself is unchanged.

Attribution reports differences of separately compounded CAGR: Dynamic − Passive; Matched Beta − Passive; Dynamic − Matched Beta. The identity reconciles numerically. No winner, investment recommendation or alpha claim is generated. Matched beta is retrospective, not an ex-ante strategy.

Temporary labels are sessionStorage display metadata only. Identical submission is idempotent. Explicit rerun retains run identity and creates a new immutable attempt. A failed latest attempt remains visible separately from an earlier successful result. Prior certification results and hashes are not migrated to the new contract.
