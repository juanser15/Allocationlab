# Owner-approved strategic-target correction

PR: [#3](https://github.com/juanser15/Allocationlab/pull/3). Starting repair commit: `55abe601c15cf9f86b077ea47c469083a7b22648`. Source handoff remains `90b7b7e2e7ff0a04364be58f8f59cfd801a8e382`.

Authority: [Issue #2 owner amendment](https://github.com/juanser15/Allocationlab/issues/2#issuecomment-6490494153), PR #3 review, and the owner's instruction to finish this correction. The first repair's 72 source-only passes did **not** establish this corrected temporal contract. Historical evidence is preserved; revised test results are recorded separately in `correction-test-results.json`.

## Corrected financial scope

Cardinality and per-ETF minimum/maximum weights are strategic **total-NAV** construction constraints. At each scheduled allocation rebalance the constrained solver uses the baseline exposure/risk policy, current causal estimates and actual drifted prior holdings. Its output is independently audited before capital scaling. Numerical support search, objective, cost convention and constraints inside that solve are unchanged.

Both DAILY and REBALANCE_ONLY capital clocks then apply the causal HMM/capital policy to the frozen strategic proportions. A positive effective holding below 2.5% or 3% is permitted. Explicit cash is permitted. Neither case triggers another allocation solve, support pruning, weight uplift or a substitute cash policy. Market drift through construction bounds also causes no corrective trade by itself. At the next scheduled allocation rebalance, the newly constructed target must satisfy the construction mandate again.

The previous `assertFrozenOverlayMandate` rule was wrong for this contract and has been replaced with effective-policy safety checks. The institutional ledger callback no longer applies construction floors to every overlay order. It checks funding, finite long-only weights, eligible assets and exposure. Engine checks additionally enforce the actual overlay's risk/exposure policy. Ledger self-financing, next-close execution, transaction costs, slippage and cash formulas are unchanged.

Audit evidence is separate:

- `optimized_nav_weights`, `construction_constraint_residuals` and `mandate_evidence`: strategic targets at scheduled construction.
- `effective_nav_weights`, `effective_policy_residuals` and `capital_target_evidence`: commanded capital-overlay targets and execution safety.
- `construction_floor_deviation_due_to_overlay`: informational departure, never an error.
- Ledger holdings/quantities/NAV: actual executed and subsequently drifted positions, not a maintenance-floor promise.

The methodology is explicitly versioned as `cardinality-active-support-2.0.0`, with scope `STRATEGIC_NAV_TARGET_AT_SCHEDULED_REBALANCE`. Source/version identity changes for new runs; no old spec, result, attempt status or financial hash is rewritten. Existing historical failure aliases remain readable. No-mandate and isolated SPY/cash numerical paths retain their public golden expectations.

## Regression cases

Tests cover the owner's exact strategic vector `[0.30, 0.20, 0.15, 0.10, 0.03]`, halved to `[0.15, 0.10, 0.075, 0.05, 0.015]`, through the actual self-financing ledger with costs. Separate 2.5% and 3% cases cover reduced positive exposure under both monitoring clocks, cash/re-entry, frozen intramonth composition and market drift below the floor/above the construction cap. The next scheduled optimization uses actual drifted holdings for its cost objective.

HTTP source-only acceptance exercises 12 candidate assets, maximum ten strategic holdings and more than 85 causal signals for each floor, followed by an immutable deterministic rerun. Strategic constraints and effective safety are asserted independently. Impossible strategic budgets still fail before run creation. Hard execution-safety violations still fail. No future observations enter prior decisions.

These are explicitly synthetic/analytical source tests. They are not the owner's private 22-ETF historical campaign and do not establish PostgreSQL/production-worker or deployed-browser certification.

## Executable-date correction

The old UI refreshed bounds only when dataset ID changed and retained a second stale copy from a previous plan. It could display an old executable range while the server correctly rejected the current selected universe/training design.

Bounds requests are now correlated with the current non-date design and immutable dataset identity. Changing selected assets, model, forecast/lookback, training or other configuration immediately hides old metadata and refreshes it. Late successes/errors from superseded requests are ignored. The plan is likewise tied to the exact submitted draft, and a changed draft cannot use a delayed plan to launch a run.

Automatic metadata refresh does not change populated From/To dates. Only the explicit full-range action can replace them; edits made while that request is pending remain protected. Empty initial-calendar initialization retains its existing behavior. Displayed metadata distinguishes dataset coverage, common required price history, limiting tickers, training length, feature history and the current earliest executable date, all from the backend. Tests retain a selected 2012 date while displaying a current 2020 executable boundary, and prove that outdated responses cannot restore the old range.

History/Audit interpret recorded methodology/code identity without changing stored attempts. A failure from an old or unrecorded engine is historical evidence, not proof of a defect in the revised engine. The screenshots alone do not identify worker SHA, attempt code version or creation time.

## Release boundary

The correction suites pass **91/91**. The portable supplemental audit records **985 passed, one failed and five explicit database/seed skips** across 69 suites. The single failure is the historical `interactive.test.ts` literal byte-comparison against a ledger snapshot that predates the separate capital clock. The test and all five compared source files are byte-identical to `55abe601`; no expected value or financial implementation was changed to hide it. The entire source audit is therefore not all-green. See `source-only-audit-results.json` and its baseline hash proof. Backend/frontend typechecks and production builds pass.

No Replit application, production database, private dataset, deployment, merge or main-branch change is included. Full private-runtime acceptance remains pending on the revised SHA in a separately approved isolated Replit verification checkout. Apply only the reviewed repair delta to the original lineage, never the source-only handoff snapshot wholesale.
