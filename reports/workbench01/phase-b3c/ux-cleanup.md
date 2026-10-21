# Capital Exposure & Cash Management

Starting branch: `workbench-v1`. Starting commit: `7ee5c52f2df4f969959a5a043bce6cba1840473f` (verified with a clean working tree before editing).

The primary page now asks for a Backtest Period (From / To), walk-forward type, training months, rebalance frequency and one Trading Costs input. Dates and all other financial fields start empty. To remains an exclusive boundary, explained beside the field. The existing exact fold map, review requirement, outdated-plan invalidation and plan/execution equivalence check remain in place. Primary actions are PREVIEW WALK-FORWARD and RUN BACKTEST.

One concise availability line formats the actual first/last observation returned by capabilities. The large empirical-data documentation panel and permanently displayed evaluation eligibility boundaries are removed. Insufficient-history errors use backend blocker details and the requested training months; the form never repairs dates or history.

Standard-mode submission explicitly sets `selection_cost_bps = transaction_cost_bps = Trading Costs`. This is a deliberate standard-mode economic convention, visible in the plan and advanced audit. The V2 API continues accepting distinct, explicit cost assumptions. No rounding, fixture default or new backend financial restriction is introduced.

The model summary precedes the fold map. It explains SPY versus cash, the 252-observation baseline rule, net-Sharpe policy selection, and reselection at each portfolio rebalance. The page explicitly says that it does not allocate among ETFs and that this deterministic baseline is not an HMM, Markov-switching model or machine-learning classifier.

Results use compact metric rows, three meaningful full-width charts, a readable policy-by-fold table and collapsed additional diagnostics/audit evidence. There is no winner, recommendation, broker control or trading authorization. RESEARCH ONLY, TEMPORARY STORAGE and DATA VINTAGE NOT INDEPENDENTLY VERIFIED remain visible.

Responsive and empirical browser evidence is recorded in `browser-acceptance.json` and `screenshots/`. The frontend formats returned numbers and dates; it does not calculate returns, betas, costs, financial differences, hashes or policy selection.
