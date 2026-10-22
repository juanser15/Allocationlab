# Anchored calendar contract

Version: `ANCHORED_NEXT_TRADING_DAY_V1`. User dates are exact ISO calendar dates, not month starts or quarter starts. Backtest From is the requested OOS start; To is exclusive. Training occurs before From. No request is shortened, moved or given a default date/training/cost.

Monthly boundaries are obtained by adding n calendar months to the original From anchor. Quarterly adds 3n months. Clamp the original day to the destination month’s last day independently: Jan 31 → Feb 28/29 → Mar 31. Never compound a prior clamp. The next boundary is computed from the original anchor, not the previously shifted trading date.

Single trading-calendar rule: NEXT_TRADING_DAY means the first observed session on or after the intended date in the committed empirical calendar. The intended boundaries remain in the spec and identity. Decision date and prior information cutoff are separate actual observation dates. Orders are not produced: the research ledger enters at the next observed close after that decision, using the original next-close accounting. A holiday/weekend is not silently reinterpreted as a month start. Data-vintage verification is not claimed.

Rolling training is [intended boundary minus training months, intended boundary). Expanding keeps the first such training start fixed. Training simulations use that training-start anchor and the same cadence. OOS sleeves run [intended boundary, next intended boundary), clipped only by the explicitly requested To. A final partial interval is explicit in the plan and must contain at least three observed sessions, as required by the existing next-close ledger. Boundaries map to observed sessions; no observations overlap between OOS sleeves.

Dataset bounds are read from the verified committed CSV. The latest supported end-exclusive boundary is the calendar day after its last observation; no future observations are invented. Each fold checks complete information-universe rows, at least two training returns for selection, and the separate 252-observation warmup before training. A positive month count is not a blanket eligibility guarantee. The current model remains stateless; ranking and fixed recurring-turnover/drawdown/exposure constraints still require actual execution.

`planInteractive` is the single deterministic planner consumed by validation, worker execution, results and Audit. Its hash binds request, exact folds, calendar version and snapshot. Planning performs zero backtests. The browser does not derive execution folds. Invalid requests return contextual errors without corrections or attempts.

Representative known answers and real holiday/weekend cases are in the acceptance and unit tests. This is a new explicit identity namespace. Prior month-start V1/V2 plans and IDs are untouched.
