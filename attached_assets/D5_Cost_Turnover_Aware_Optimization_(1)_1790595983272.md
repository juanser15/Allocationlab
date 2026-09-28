D5 — COST / TURNOVER-AWARE OPTIMIZATION. CLOSED SCOPE.

D4 is accepted. Use dynamic fixtures, not historical IDs.

Optimize the cost of moving from actual holdings to consolidated asset targets. Support assets, capital alpha streams and signed overlays under nominal/D4 robust regularized mean-variance.

No changes to forecasts/risk/selection, liquidity/ADV/impact/capacity, borrow/margin, fills, signals or navigation. No multiperiod planning. Preserve legacy runs.

1. HOLDINGS AND TRADES
Value actual quantities/cash at the observable decision cutoff using positive pre-trade NAV. Never use prior targets, alpha coefficients or future fill prices as holdings. Require explicit initialization.

Use existing asset, capital-alpha and signed-overlay target mappings and cash conventions.

Predicted asset trade fraction is target minus actual exposure. Include held assets outside candidates with zero targets and liquidation costs. Missing valuation blocks computation.

Net alpha instructions FIRST. Unchanged asset targets mean no predicted trades despite coefficient changes.

2. COSTS AND TURNOVER PREFERENCE
Use existing nonnegative fee and slippage bps assumptions, not fabricated spreads.

Predicted one-time cost/NAV equals the sum of absolute underlying trade fractions multiplied by fee-plus-slippage bps divided by 10,000. Preserve the existing common-rate convention.

Traded fraction sums absolute underlying trades, excluding cash; do not halve the nominal used to charge costs.

Add optional nonnegative turnoverPreferenceBps, default zero, multiplied by that same traded fraction. This is a utility penalty, NOT a fee: never debit it from NAV or label it realized cost.

3. DAILY-EQUIVALENT OBJECTIVE
D3 forecasts and D4 objectives are daily; transaction costs are one-time.

Require explicit positive costAmortizationDays h when enabling D5. Freeze h; do not infer it from realized exits or optimize it against performance.

Minimize the existing nominal/robust regularized mean-variance objective PLUS the predicted economic cost and optional turnover-preference penalty, both divided by h.

Show original objective terms, fee/slippage, preference, h and total. This is an amortization assumption, not MPC or predicted holding duration.

D3 mu/uncertainty and D1 covariance remain unchanged. Enable D5 only for regularized mean-variance; preserve existing minimum-variance behavior and reject an unsupported D5/minimum-variance combination explicitly.

4. SOLVING AND SELF-FINANCING
Enforce absolute-trade penalties and existing constraints INSIDE the solve. Preserve D4's exact square-root uncertainty term. No smoothing, post-hoc clipping, equal-weight fallback or success labels for failed solves.

Report convex solver/version, objective, optimality and feasibility residuals. Zero costs/preference must reproduce the existing optimizer.

Preserve A1 self-financing sizing at execution: no cash injection or undeclared borrowing to pay costs. If execution cannot satisfy its supported mandate, return a dated failure. Clearly distinguish pre-cost target constraints, executed post-cost exposures and market drift.

A1 debits external fees/slippage once. Never also debit the objective penalty or standalone-alpha costs.

5. HISTORICAL INTEGRATION AND COMPARISON
Each B3 policy uses its OWN actual holdings path. At each cutoff, obtain existing D3/D1 inputs, solve D5, map/net underlying targets, then execute through A1.

Show estimated cutoff-time costs separately from actual fill costs across price gaps. Never use future execution information in the decision.

Compare cost-blind and cost-aware policies under identical data, dates, initial holdings, forecasts, risk, robustness, constraints and actual execution charges. Cost-blind means ignored in the objective, NOT free execution. No automatic winner or parameter tuning.

6. UI AND IMMUTABILITY
Use existing Optimization/Backtest surfaces and Optimize/Validate actions. Add a compact Cost-aware toggle, rates, h, optional turnover preference and dated holdings summary; no new main tab.

Show current/target holdings, trades, objective breakdown, estimated/actual costs and comparison.

Freeze mode, h, rates, quantities/cash/NAV/cutoff, D3/D1 references, mapped targets, predicted costs, solver evidence and per-decision B3 results using existing snapshots. Replay must not use working holdings/settings. Old runs retain old semantics.

7. ACCEPTANCE — T1 TO T8
T1 ZERO-COST IDENTITY: capital and signed, nominal and robust, with zero fees/slippage/preference reproduce existing optima within 1e-8 on unique-solution fixtures.

T2 ANALYTICAL OPTIMUM: independently solve a one-risky-asset mean-variance problem with absolute trading cost around nonzero holdings. Include no-trade and trading cases, and two h values. Verify piecewise optimum and objective terms, not just reduced turnover. Preference with zero economic fees must not debit cash.

T3 NETTING: verify overlapping signed alphas, zero/nonzero net trades, long-to-short and outside-candidate liquidation; independently reconcile full nominal/costs without double charging.

T4 ACTUAL HOLDINGS/TIMING: use drifted holdings unlike prior targets and a price jump between decision and fill. The solve uses only actual cutoff holdings and is unaffected by later prices. Reconcile actual costs separately; no pre-purchase return or hidden borrowing.

T5 ROBUST CONSTRAINTS/FAILURES: capital and signed MV with positive D4 uncertainty penalty and binding constraints. Verify feasibility, objective and optimality independently. Missing prices, invalid h, negative rates, unsupported objective and infeasibility produce explicit failures, never substitute weights.

T6 B3 COMPARISON: cost-blind and cost-aware with identical actual charges and other assumptions. Require positive risky exposure and at least two executions from predeclared feasible fixtures. Each policy uses its own holdings; both ledgers reconcile. Do not require higher realized performance to pass.

T7 REPLAY: freeze optimization/validation/comparison; change working data/holdings/rates/h and reload. Saved identities and old runs remain unchanged; replay numeric difference <=1e-8.

T8 BROWSER: fresh eight-stream fixtures, signed mode, statistical-factor risk, nonzero uncertainty/robustness, positive fees, explicit h/preference. Optimize, inspect trades/objective, Validate/save comparison; change drafts, retrieve in fresh context and Replay. Require populated results, HTTP success, visible PASS, unchanged references, zero unexpected differences and numeric max <=1e-8.

8. BOUNDED VERIFICATION AND STOP
Use proven DB runners and dynamic-ID fixtures retained through browser tests. Synthetic data is test-only.

One implementation pass and at most one targeted repair pass. Freeze the final revision, then run each suite once: D5 T1–T8/persistence, A1/A2/A2.1/A3, B1/B2/B3, C1/C2/C3, D1/D2/D3/D4 and typecheck. Continue safe independent suites after unrelated failures. Cancelled/skipped required cases and loader errors are not PASS. No reruns until green.

Return D5 COMPLETION REPORT: objective/units, holdings and cost conventions, solver evidence, analytical example, T1–T8 expected/observed results, actual regression summary, UI-created IDs, maximum accounting/replay differences, final revision and exact blocker.

All gates pass: D5 CLOSED, STOP. Otherwise D5 BLOCKED with exact gate, STOP. No D6, liquidity work or new acceptance requirements.
